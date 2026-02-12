import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type { Job } from 'bullmq';
import type { PRScanJobData } from './trigger-service';
import type { Claim, LearningService, VerificationResult, Finding } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import type { MapperService } from '../L2-mapper';
import type { VerifierService } from '../L3-verifier';
import { classifyFiles } from './classify-files';
import { prioritizeClaims, deduplicateClaims } from './prioritize';
import { updateScanStatus } from './scan-store';
import { isCancelled } from './cancellation';
import logger from '../../shared/logger';

export interface PRScanDependencies {
  pool: Pool;
  redis: Redis;
  codebaseIndex: CodebaseIndexService;
  mapper: MapperService;
  verifier: VerifierService;
  learning: LearningService;
  // GitHub API callbacks (injected to decouple from Octokit)
  fetchPRFiles: (repoId: string, prNumber: number, installationId: number) => Promise<Array<{
    filename: string;
    status: string;
    previous_filename?: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>>;
  getFileContent: (repoId: string, filePath: string, ref: string, installationId: number) => Promise<string | null>;
  createCheckRun?: (repoId: string, headSha: string, installationId: number) => Promise<number | null>;
  updateCheckRun?: (checkRunId: number, conclusion: string, summary: string, installationId: number) => Promise<void>;
}

interface ScanStats {
  claims_checked: number;
  claims_drifted: number;
  claims_verified: number;
  claims_uncertain: number;
  total_token_cost: number;
  total_duration_ms: number;
}

/**
 * Process a PR scan job.
 * TDD-4 Section 4.7, Appendix A (steps 1-24).
 *
 * This is the main pipeline orchestrator for PR scans.
 */
export async function processPRScan(
  job: Job<PRScanJobData>,
  deps: PRScanDependencies,
): Promise<void> {
  const { scanRunId, repoId, prNumber, headSha, installationId } = job.data;
  const jobId = job.id || `pr-scan-${repoId}-${prNumber}`;
  const startTime = Date.now();

  const stats: ScanStats = {
    claims_checked: 0,
    claims_drifted: 0,
    claims_verified: 0,
    claims_uncertain: 0,
    total_token_cost: 0,
    total_duration_ms: 0,
  };

  try {
    // Step 1: Transition to running
    await updateScanStatus(deps.pool, scanRunId, 'running');
    let checkRunId: number | null = null;
    if (deps.createCheckRun) {
      checkRunId = await deps.createCheckRun(repoId, headSha, installationId);
      if (checkRunId) {
        await updateScanStatus(deps.pool, scanRunId, 'running', { check_run_id: checkRunId });
      }
    }

    // Step 2: Fetch PR diff
    const rawFiles = await deps.fetchPRFiles(repoId, prNumber, installationId);
    const fileChanges = rawFiles.map((f) => ({
      filename: f.filename,
      status: f.status as 'added' | 'modified' | 'removed' | 'renamed',
      previous_filename: f.previous_filename,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    // Step 3: Classify files
    const classified = classifyFiles(fileChanges);

    // Step 4: Update codebase index for code changes
    if (classified.code_files.length > 0) {
      const fetchContent = async (filePath: string) =>
        deps.getFileContent(repoId, filePath, headSha, installationId);
      await deps.codebaseIndex.updateFromDiff(repoId, classified.code_files, fetchContent);
    }

    // Step 4b: Update mappings for renames
    if (classified.renames.length > 0) {
      const renamePairs = classified.renames
        .filter((r) => r.previous_filename)
        .map((r) => ({ old_path: r.previous_filename!, new_path: r.filename }));
      if (renamePairs.length > 0) {
        await deps.mapper.updateCodeFilePaths(repoId, renamePairs);
      }
    }

    // Step 4c: Remove mappings for deletions
    if (classified.deletions.length > 0) {
      await deps.mapper.removeMappingsForFiles(
        repoId,
        classified.deletions.map((d) => d.filename),
      );
    }

    // CANCELLATION CHECK 1
    if (await isCancelled(deps.redis, jobId)) {
      await savePartialAndExit(deps.pool, scanRunId, stats, startTime);
      return;
    }

    // Step 5: Delete claims for removed doc files
    const deletedDocs = classified.deletions.filter((d) =>
      ['.md', '.mdx', '.rst', '.txt', '.adoc'].some((ext) => d.filename.endsWith(ext)),
    );
    for (const doc of deletedDocs) {
      await deps.pool.query('DELETE FROM claims WHERE repo_id = $1 AND source_file = $2', [repoId, doc.filename]);
    }

    // Step 6: Re-extract claims for changed doc files
    const newClaims: Claim[] = [];
    for (const doc of classified.doc_files) {
      const content = await deps.getFileContent(repoId, doc.filename, headSha, installationId);
      if (content) {
        // Re-extract: delete old claims, insert new ones
        await deps.pool.query('DELETE FROM claims WHERE repo_id = $1 AND source_file = $2', [repoId, doc.filename]);
        // Extraction is done by L1 - for now we rely on existing claims
        // In the full pipeline, L1.reExtract would be called here
      }
    }

    // Step 7: Map new claims (if any were extracted)
    for (const claim of newClaims) {
      await deps.mapper.mapClaim(repoId, claim);
    }

    // CANCELLATION CHECK 2
    if (await isCancelled(deps.redis, jobId)) {
      await savePartialAndExit(deps.pool, scanRunId, stats, startTime);
      return;
    }

    // Step 8: Resolve scope (find all affected claims)
    const docClaims: Claim[] = [];
    for (const doc of classified.doc_files) {
      const result = await deps.pool.query(
        'SELECT * FROM claims WHERE repo_id = $1 AND source_file = $2',
        [repoId, doc.filename],
      );
      docClaims.push(...(result.rows as Claim[]));
    }

    const codePaths = classified.code_files.map((f) => f.filename);
    const reverseMappings = codePaths.length > 0
      ? await deps.mapper.findClaimsByCodeFiles(repoId, codePaths)
      : [];

    const reverseClaimIds = [...new Set(reverseMappings.map((m) => m.claim_id))];
    const reverseClaims: Claim[] = [];
    for (const claimId of reverseClaimIds) {
      const result = await deps.pool.query('SELECT * FROM claims WHERE id = $1', [claimId]);
      if (result.rows.length > 0) {
        reverseClaims.push(result.rows[0] as Claim);
      }
    }

    const allClaims = deduplicateClaims([...docClaims, ...reverseClaims]);

    // Step 9: Filter suppressed claims
    const unsuppressed: Claim[] = [];
    for (const claim of allClaims) {
      const suppressed = await deps.learning.isClaimSuppressed(claim);
      if (!suppressed) {
        unsuppressed.push(claim);
      }
    }

    // Step 10: Prioritize and cap claims
    const prioritized = prioritizeClaims(unsuppressed);

    // Zero claims short-circuit
    if (prioritized.length === 0) {
      // Still record co-changes even if no claims need verification
      if (classified.code_files.length > 0 && classified.doc_files.length > 0) {
        await deps.learning.recordCoChanges(
          repoId,
          classified.code_files.map((f) => f.filename),
          classified.doc_files.map((f) => f.filename),
          headSha,
        );
      }
      stats.total_duration_ms = Date.now() - startTime;
      await updateScanStatus(deps.pool, scanRunId, 'completed', stats);
      return;
    }

    stats.claims_checked = prioritized.length;

    // Step 11: Run deterministic verification (Tiers 1-2)
    const results: Array<{ claim: Claim; result: VerificationResult }> = [];
    for (const claim of prioritized) {
      const mappings = await deps.mapper.getMappingsForClaim(claim.id);
      const result = await deps.verifier.verifyDeterministic(claim, mappings);
      if (result) {
        results.push({ claim, result });

        if (result.verdict === 'drifted') stats.claims_drifted++;
        else if (result.verdict === 'verified') stats.claims_verified++;
        else stats.claims_uncertain++;

        if (result.token_cost) stats.total_token_cost += result.token_cost;
      }
    }

    // CANCELLATION CHECK 3
    if (await isCancelled(deps.redis, jobId)) {
      await savePartialAndExit(deps.pool, scanRunId, stats, startTime);
      return;
    }

    // Steps 12-16: Agent tasks (routing, evidence building, dispatch, waiting)
    // For MVP, deterministic-only. Agent tasks will be added in E5.

    // Step 17: Merge results (deterministic only for now)
    // Already have all results from step 11

    // Step 19: Build findings
    const _findings: Finding[] = results.map(({ claim, result }) => ({
      claim,
      result,
      fix: null, // Fixes generated by agent tasks in E5
      suppressed: false,
    }));

    // CANCELLATION CHECK 4
    if (await isCancelled(deps.redis, jobId)) {
      await savePartialAndExit(deps.pool, scanRunId, stats, startTime);
      return;
    }

    // Steps 20-22: Post PR comment and update Check Run
    // These will be wired up when the full reporter service is integrated

    // Step 23: Record co-changes
    if (classified.code_files.length > 0 && classified.doc_files.length > 0) {
      await deps.learning.recordCoChanges(
        repoId,
        classified.code_files.map((f) => f.filename),
        classified.doc_files.map((f) => f.filename),
        headSha,
      );
    }

    // Step 24: Update scan status
    stats.total_duration_ms = Date.now() - startTime;
    await updateScanStatus(deps.pool, scanRunId, 'completed', stats);

    logger.info(
      { scanRunId, repoId, prNumber, ...stats },
      'PR scan completed',
    );
  } catch (err) {
    stats.total_duration_ms = Date.now() - startTime;
    await updateScanStatus(deps.pool, scanRunId, 'failed', stats).catch(() => {});
    logger.error({ scanRunId, repoId, prNumber, err }, 'PR scan failed');
    throw err;
  }
}

async function savePartialAndExit(
  pool: Pool,
  scanRunId: string,
  stats: ScanStats,
  startTime: number,
): Promise<void> {
  stats.total_duration_ms = Date.now() - startTime;
  await updateScanStatus(pool, scanRunId, 'cancelled', stats);
  logger.info({ scanRunId, ...stats }, 'Scan cancelled, partial results saved');
}
