import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { processPRScan } from '../../../src/layers/L4-triggers/pr-scan-processor';
import type { PRScanDependencies } from '../../../src/layers/L4-triggers/pr-scan-processor';
import { createScanRun, getScanRun } from '../../../src/layers/L4-triggers/scan-store';
import type { VerificationResult } from '../../../src/shared/types';
import { LearningServiceStub } from '../../../src/layers/L7-learning';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

 
function makeFakeJob(data: Record<string, unknown>) {
  return {
    id: data.jobId || `pr-scan-${data.repoId}-${data.prNumber}`,
    data,
    progress: vi.fn(),
    log: vi.fn(),
    updateProgress: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('processPRScan', () => {
  let pool: Pool;
  let redis: Redis;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'pr-scan-test', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await redis.quit();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
  });

  function makeDeps(overrides: Partial<PRScanDependencies> = {}): PRScanDependencies {
    return {
      pool,
      redis,
      codebaseIndex: {
        updateFromDiff: vi.fn().mockResolvedValue({ entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] }),
        fileExists: vi.fn(),
        getFileTree: vi.fn(),
        findSymbol: vi.fn(),
        getEntityByFile: vi.fn(),
        getEntityById: vi.fn(),
        findRoute: vi.fn(),
        searchRoutes: vi.fn(),
        getDependencyVersion: vi.fn(),
        scriptExists: vi.fn(),
        getAvailableScripts: vi.fn(),
        searchSemantic: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
      mapper: {
        mapClaim: vi.fn().mockResolvedValue([]),
        findClaimsByCodeFiles: vi.fn().mockResolvedValue([]),
        getMappingsForClaim: vi.fn().mockResolvedValue([]),
        refreshMapping: vi.fn(),
        updateCodeFilePaths: vi.fn().mockResolvedValue(0),
        removeMappingsForFiles: vi.fn().mockResolvedValue(0),
        getEntityLineCount: vi.fn(),
      },
      verifier: {
        verifyDeterministic: vi.fn().mockResolvedValue(null),
        routeClaim: vi.fn(),
        buildPath1Evidence: vi.fn(),
        storeResult: vi.fn(),
        mergeResults: vi.fn().mockResolvedValue([]),
        getLatestResult: vi.fn(),
      },
      learning: new LearningServiceStub(),
      fetchPRFiles: vi.fn().mockResolvedValue([]),
      getFileContent: vi.fn().mockResolvedValue(null),
      ...overrides,
    };
  }

  it('completes with zero files changed', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '1',
      commitSha: 'sha1',
    });

    const deps = makeDeps();
    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 1,
      headSha: 'sha1',
      installationId: 1,
    });

    await processPRScan(job, deps);

    const updated = await getScanRun(pool, scanRun.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.total_duration_ms).toBeGreaterThan(0);
  });

  it('transitions to running then completed', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '2',
      commitSha: 'sha2',
    });

    const deps = makeDeps();
    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 2,
      headSha: 'sha2',
      installationId: 1,
    });

    await processPRScan(job, deps);

    const updated = await getScanRun(pool, scanRun.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.started_at).toBeDefined();
  });

  it('classifies files and calls codebase index for code files', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '3',
      commitSha: 'sha3',
    });

    const deps = makeDeps({
      fetchPRFiles: vi.fn().mockResolvedValue([
        { filename: 'src/app.ts', status: 'modified', additions: 5, deletions: 2 },
        { filename: 'README.md', status: 'modified', additions: 3, deletions: 1 },
      ]),
    });
    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 3,
      headSha: 'sha3',
      installationId: 1,
    });

    await processPRScan(job, deps);

    expect(deps.codebaseIndex.updateFromDiff).toHaveBeenCalledWith(
      repoId,
      expect.arrayContaining([expect.objectContaining({ filename: 'src/app.ts' })]),
      expect.any(Function),
    );
  });

  it('handles renames by updating mappings', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '4',
      commitSha: 'sha4',
    });

    const deps = makeDeps({
      fetchPRFiles: vi.fn().mockResolvedValue([
        { filename: 'new-name.ts', status: 'renamed', previous_filename: 'old-name.ts', additions: 0, deletions: 0 },
      ]),
    });
    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 4,
      headSha: 'sha4',
      installationId: 1,
    });

    await processPRScan(job, deps);

    expect(deps.mapper.updateCodeFilePaths).toHaveBeenCalledWith(
      repoId,
      [{ old_path: 'old-name.ts', new_path: 'new-name.ts' }],
    );
  });

  it('handles deletions by removing mappings', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '5',
      commitSha: 'sha5',
    });

    const deps = makeDeps({
      fetchPRFiles: vi.fn().mockResolvedValue([
        { filename: 'deleted.ts', status: 'removed', additions: 0, deletions: 10 },
      ]),
    });
    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 5,
      headSha: 'sha5',
      installationId: 1,
    });

    await processPRScan(job, deps);

    expect(deps.mapper.removeMappingsForFiles).toHaveBeenCalledWith(repoId, ['deleted.ts']);
  });

  it('cancels at check 1 and saves partial', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '6',
      commitSha: 'sha6',
    });

    const jobId = `pr-scan-${repoId}-6`;

    // Set cancel key
    await redis.set(`cancel:${jobId}`, '1', 'EX', 60);

    const deps = makeDeps({
      fetchPRFiles: vi.fn().mockResolvedValue([
        { filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 0 },
      ]),
    });
    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 6,
      headSha: 'sha6',
      installationId: 1,
      jobId,
    });
    job.id = jobId;

    await processPRScan(job, deps);

    const updated = await getScanRun(pool, scanRun.id);
    expect(updated!.status).toBe('cancelled');

    // Cleanup
    await redis.del(`cancel:${jobId}`);
  });

  it('verifies claims and tracks stats', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '7',
      commitSha: 'sha7',
    });

    // Insert a claim
    const claimId = randomUUID();
    await pool.query(
      `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type,
         testability, extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, $2, 'README.md', 1, 'Uses express 4', 'dependency_version', 'syntactic', '{}', '{}', 1.0, 'regex', 'pending')`,
      [claimId, repoId],
    );

    const verificationResult: VerificationResult = {
      id: randomUUID(),
      claim_id: claimId,
      repo_id: repoId,
      scan_run_id: scanRun.id,
      verdict: 'drifted',
      confidence: 0.95,
      tier: 1,
      severity: 'high',
      reasoning: 'Version mismatch',
      specific_mismatch: 'Expected 4.x, found 5.0',
      suggested_fix: null,
      evidence_files: ['package.json'],
      token_cost: 0,
      duration_ms: 50,
      post_check_result: null,
      verification_path: 1,
      created_at: new Date(),
    };

    const deps = makeDeps({
      fetchPRFiles: vi.fn().mockResolvedValue([
        { filename: 'README.md', status: 'modified', additions: 1, deletions: 0 },
      ]),
      verifier: {
        verifyDeterministic: vi.fn().mockResolvedValue(verificationResult),
        routeClaim: vi.fn(),
        buildPath1Evidence: vi.fn(),
        storeResult: vi.fn(),
        mergeResults: vi.fn().mockResolvedValue([verificationResult]),
        getLatestResult: vi.fn(),
      },
    });

    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 7,
      headSha: 'sha7',
      installationId: 1,
    });

    await processPRScan(job, deps);

    const updated = await getScanRun(pool, scanRun.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.claims_checked).toBe(1);
    expect(updated!.claims_drifted).toBe(1);
  });

  it('records co-changes when both code and doc files changed', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '8',
      commitSha: 'sha8',
    });

    const learning = new LearningServiceStub();
    const recordSpy = vi.spyOn(learning, 'recordCoChanges');

    const deps = makeDeps({
      learning,
      fetchPRFiles: vi.fn().mockResolvedValue([
        { filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 0 },
        { filename: 'README.md', status: 'modified', additions: 1, deletions: 0 },
      ]),
    });

    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 8,
      headSha: 'sha8',
      installationId: 1,
    });

    await processPRScan(job, deps);

    expect(recordSpy).toHaveBeenCalledWith(
      repoId,
      ['src/app.ts'],
      ['README.md'],
      'sha8',
    );
  });

  it('sets status to failed on error', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'pr',
      triggerRef: '9',
      commitSha: 'sha9',
    });

    const deps = makeDeps({
      fetchPRFiles: vi.fn().mockRejectedValue(new Error('GitHub API error')),
    });

    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      prNumber: 9,
      headSha: 'sha9',
      installationId: 1,
    });

    await expect(processPRScan(job, deps)).rejects.toThrow('GitHub API error');

    const updated = await getScanRun(pool, scanRun.id);
    expect(updated!.status).toBe('failed');
  });
});
