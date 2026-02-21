/**
 * E4-13: Vertical Slice Integration Tests (IE-01 + IE-03)
 *
 * Tests the full PR scan pipeline (L0 → L1 → L2 → L3 → L4 → L5)
 * with real services and PostgreSQL. No LLM calls.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { initParser } from '../../src/layers/L0-codebase-index/ast-parser';
import { createCodebaseIndex } from '../../src/layers/L0-codebase-index';
import { createMapper } from '../../src/layers/L2-mapper';
import { createVerifier } from '../../src/layers/L3-verifier';
import { LearningServiceStub } from '../../src/layers/L7-learning';
import { processPRScan } from '../../src/layers/L4-triggers/pr-scan-processor';
import { buildSummaryComment, determineCheckConclusion, determineOutcome } from '../../src/layers/L5-reporter';
import { calculateHealthScore } from '../../src/layers/L5-reporter/health';
import type { PRScanDependencies } from '../../src/layers/L4-triggers/pr-scan-processor';
import type { Job } from 'bullmq';
import type { PRScanJobData } from '../../src/layers/L4-triggers/trigger-service';
import type { Finding } from '../../src/shared/types';
import { POSTGRES_AVAILABLE, REDIS_AVAILABLE } from '../infra-guard';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe.skipIf(!POSTGRES_AVAILABLE || !REDIS_AVAILABLE)('E4-13: Vertical Slice Integration Tests', () => {
  let pool: Pool;
  let redis: Redis;
  let queue: Queue;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('test-vertical-slice', { connection: redis });
    await initParser();
  }, 30_000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.quit();
    await pool.end();
  });

  // ─── IE-01: Syntactic Drift — Express Version Mismatch ───

  describe('IE-01: Dependency version drift', () => {
    let repoId: string;
    let scanRunId: string;

    beforeAll(async () => {
      repoId = randomUUID();
      scanRunId = randomUUID();

      // Create repo
      await pool.query(
        `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
         VALUES ($1, 'amara-dev', 'taskflow', 55001, 'main', 'active')`,
        [repoId],
      );

      // Create scan run
      await pool.query(
        `INSERT INTO scan_runs (id, repo_id, trigger_type, trigger_ref, commit_sha, status,
           claims_checked, claims_drifted, claims_verified, claims_uncertain,
           total_token_cost, total_duration_ms, comment_posted)
         VALUES ($1, $2, 'pr', '47', 'f4e5d6c', 'queued', 0, 0, 0, 0, 0, 0, false)`,
        [scanRunId, repoId],
      );

      // Seed 6 pre-existing claims in README.md (from prior full scan)
      // The version claim is the key one
      await pool.query(
        `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type, testability,
           extracted_value, keywords, extraction_confidence, extraction_method, verification_status, last_verified_at)
         VALUES
           ($1, $2, 'README.md', 7, 'Uses express v4.18.2 for the HTTP server.', 'dependency_version', 'syntactic',
            '{"type":"dependency_version","package":"express","version":"4.18.2"}', '{"express","version"}', 1.0, 'regex', 'verified', NOW() - INTERVAL '3 days'),
           ($3, $2, 'README.md', 12, 'See src/index.ts for entry point.', 'path_reference', 'syntactic',
            '{"path":"src/index.ts"}', '{"path"}', 1.0, 'regex', 'verified', NOW() - INTERVAL '3 days'),
           ($4, $2, 'README.md', 15, 'Run npm run build to compile.', 'command', 'syntactic',
            '{"runner":"npm","script":"build"}', '{"npm","build"}', 1.0, 'regex', 'verified', NOW() - INTERVAL '3 days'),
           ($5, $2, 'README.md', 20, 'Run npm run test to test.', 'command', 'syntactic',
            '{"runner":"npm","script":"test"}', '{"npm","test"}', 1.0, 'regex', 'verified', NOW() - INTERVAL '3 days'),
           ($6, $2, 'README.md', 25, 'Uses uuid for unique IDs.', 'dependency_version', 'syntactic',
            '{"type":"dependency_version","package":"uuid","version":"9.0.0"}', '{"uuid","version"}', 1.0, 'regex', 'verified', NOW() - INTERVAL '3 days'),
           ($7, $2, 'README.md', 30, 'Default port is 3000.', 'config', 'syntactic',
            '{"key":"port","value":"3000"}', '{"port","config"}', 1.0, 'regex', 'verified', NOW() - INTERVAL '3 days')`,
        [
          randomUUID(), repoId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ],
      );

      // Get the express claim ID for mapping
      const expressResult = await pool.query(
        `SELECT id FROM claims WHERE repo_id = $1 AND claim_type = 'dependency_version' AND claim_text LIKE '%express%'`,
        [repoId],
      );
      const expressClaimId = expressResult.rows[0].id;

      // Seed claim_mapping: express version claim → package.json
      await pool.query(
        `INSERT INTO claim_mappings (id, repo_id, claim_id, code_file, mapping_method, confidence)
         VALUES ($1, $2, $3, 'package.json', 'direct_reference', 1.0)`,
        [randomUUID(), repoId, expressClaimId],
      );
    });

    afterAll(async () => {
      await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    });

    it('detects express version drift end-to-end', async () => {
      const codebaseIndex = createCodebaseIndex(pool);
      const learning = new LearningServiceStub();
      const mapper = createMapper(pool, codebaseIndex, learning);
      const verifier = createVerifier(pool, codebaseIndex, mapper);

      // Mock GitHub API — PR #47 changes only package.json
      const deps: PRScanDependencies = {
        pool,
        redis,
        codebaseIndex,
        mapper,
        verifier,
        learning,
        fetchPRFiles: vi.fn().mockResolvedValue([
          {
            filename: 'package.json',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: `@@ -7,7 +7,7 @@
       "start": "node dist/index.js"
     },
     "dependencies": {
-      "express": "^4.18.2",
+      "express": "^4.19.0",
       "uuid": "^9.0.0"
     },`,
          },
        ]),
        getFileContent: vi.fn(async (_repoId: string, filePath: string) => {
          if (filePath === 'package.json') {
            return JSON.stringify({
              name: 'taskflow',
              scripts: {
                build: 'tsc',
                test: 'vitest run',
                start: 'node dist/index.js',
              },
              dependencies: {
                express: '^4.19.0',
                uuid: '^9.0.0',
              },
            });
          }
          return null;
        }),
        createCheckRun: vi.fn().mockResolvedValue(null),
      };

      // Create a mock Job object
      const mockJob = {
        data: {
          scanRunId,
          repoId,
          prNumber: 47,
          headSha: 'f4e5d6c',
          installationId: 55001,
        },
        id: `pr-scan-${repoId}-47`,
        progress: vi.fn(),
        log: vi.fn(),
        updateProgress: vi.fn(),
      } as unknown as Job<PRScanJobData>;

      // Run the full pipeline
      await processPRScan(mockJob, deps);

      // Verify scan run completed with correct stats
      const scanResult = await pool.query('SELECT * FROM scan_runs WHERE id = $1', [scanRunId]);
      const scan = scanResult.rows[0];

      expect(scan.status).toBe('completed');
      expect(scan.claims_checked).toBe(1);
      expect(scan.claims_drifted).toBe(1);
      expect(scan.claims_verified).toBe(0);
      expect(scan.claims_uncertain).toBe(0);
      expect(Number(scan.total_token_cost)).toBe(0); // Deterministic, no LLM
      expect(scan.completed_at).not.toBeNull();

      // Verify the express claim was updated to drifted
      const claimResult = await pool.query(
        `SELECT verification_status FROM claims WHERE repo_id = $1 AND claim_text LIKE '%express v4.18.2%'`,
        [repoId],
      );
      expect(claimResult.rows[0].verification_status).toBe('drifted');

      // Verify a verification_result was stored
      const vrResult = await pool.query(
        `SELECT * FROM verification_results WHERE repo_id = $1 AND verdict = 'drifted'`,
        [repoId],
      );
      expect(vrResult.rows.length).toBeGreaterThanOrEqual(1);
      expect(vrResult.rows[0].tier).toBe(1);
      expect(vrResult.rows[0].token_cost).toBeNull(); // Deterministic
    });

    it('L5 reporter formats findings correctly', async () => {
      // After IE-01, check that L5 can format the output
      const health = await calculateHealthScore(pool, repoId);

      // 6 total claims, 5 verified + 1 drifted
      expect(health.total_claims).toBe(6);
      expect(health.drifted).toBe(1);
      expect(health.verified).toBe(5);
      expect(health.score).toBeCloseTo(5 / 6); // 5/(5+1)

      // Build a finding from the verification result
      const vrResult = await pool.query(
        `SELECT vr.*, c.* FROM verification_results vr
         JOIN claims c ON c.id = vr.claim_id
         WHERE vr.repo_id = $1 AND vr.verdict = 'drifted' LIMIT 1`,
        [repoId],
      );
      expect(vrResult.rows.length).toBe(1);
      const row = vrResult.rows[0];

      const finding: Finding = {
        claim: row,
        result: {
          id: row.id,
          claim_id: row.claim_id,
          repo_id: repoId,
          scan_run_id: scanRunId,
          verdict: row.verdict,
          tier: row.tier,
          reasoning: row.reasoning,
          evidence_files: row.evidence_files,
          severity: row.severity,
          specific_mismatch: row.specific_mismatch,
          token_cost: row.token_cost,
          suggested_fix: row.suggested_fix,
          created_at: row.created_at,
        },
        fix: null,
        suppressed: false,
      };

      const payload = {
        findings: [finding],
        health_score: health,
        agent_unavailable_pct: 0,
      };

      const comment = buildSummaryComment(payload, scanRunId);
      expect(comment).toContain('docalign-summary');
      expect(comment).toContain('Found **1** documentation drift');
      expect(comment).toContain('Drifted | 1');

      const conclusion = determineCheckConclusion(payload);
      expect(conclusion).toBe('neutral'); // Medium severity, not blocking
    });
  });

  // ─── IE-03: Clean PR — No Claims in Scope ───

  describe('IE-03: Clean PR — no documentation drift', () => {
    let repoId: string;
    let scanRunId: string;

    beforeAll(async () => {
      repoId = randomUUID();
      scanRunId = randomUUID();

      // Create repo
      await pool.query(
        `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
         VALUES ($1, 'acme', 'rest-api', 51234567, 'main', 'active')`,
        [repoId],
      );

      // Create scan run
      await pool.query(
        `INSERT INTO scan_runs (id, repo_id, trigger_type, trigger_ref, commit_sha, status,
           claims_checked, claims_drifted, claims_verified, claims_uncertain,
           total_token_cost, total_duration_ms, comment_posted)
         VALUES ($1, $2, 'pr', '18', 'e4a1b2c', 'queued', 0, 0, 0, 0, 0, 0, false)`,
        [scanRunId, repoId],
      );

      // Seed 20 verified claims across README.md and docs/api.md
      // None map to src/utils/helpers.ts
      const claimIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = randomUUID();
        claimIds.push(id);
        await pool.query(
          `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type, testability,
             extracted_value, keywords, extraction_confidence, extraction_method, verification_status, last_verified_at)
           VALUES ($1, $2, 'README.md', $3, $4, 'behavior', 'syntactic',
            '{}', '{}', 1.0, 'regex', 'verified', NOW() - INTERVAL '2 days')`,
          [id, repoId, i + 1, `README claim ${i + 1} about REST API.`],
        );
      }
      for (let i = 0; i < 10; i++) {
        const id = randomUUID();
        claimIds.push(id);
        await pool.query(
          `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type, testability,
             extracted_value, keywords, extraction_confidence, extraction_method, verification_status, last_verified_at)
           VALUES ($1, $2, 'docs/api.md', $3, $4, 'api_route', 'syntactic',
            '{}', '{}', 1.0, 'regex', 'verified', NOW() - INTERVAL '2 days')`,
          [id, repoId, i + 1, `API route claim ${i + 1} for users endpoint.`],
        );
      }

      // Seed claim_mappings for some claims → NOT helpers.ts
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO claim_mappings (id, repo_id, claim_id, code_file, mapping_method, confidence)
           VALUES ($1, $2, $3, 'src/routes/users.ts', 'symbol_search', 0.85)`,
          [randomUUID(), repoId, claimIds[i + 10]],
        );
      }
    });

    afterAll(async () => {
      await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
      await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    });

    it('short-circuits with zero claims in scope', async () => {
      const codebaseIndex = createCodebaseIndex(pool);
      const learning = new LearningServiceStub();
      const mapper = createMapper(pool, codebaseIndex, learning);
      const verifier = createVerifier(pool, codebaseIndex, mapper);

      // Mock GitHub API — PR #18 changes only src/utils/helpers.ts
      const deps: PRScanDependencies = {
        pool,
        redis,
        codebaseIndex,
        mapper,
        verifier,
        learning,
        fetchPRFiles: vi.fn().mockResolvedValue([
          {
            filename: 'src/utils/helpers.ts',
            status: 'modified',
            additions: 11,
            deletions: 0,
            patch: `@@ -5,3 +5,14 @@
 export function slugify(text: string): string {
   return text.toLowerCase().replace(/\\s+/g, '-');
 }
+
+export function formatDate(date: Date): string {
+  return new Intl.DateTimeFormat('en-US').format(date);
+}`,
          },
        ]),
        getFileContent: vi.fn(async (_repoId: string, filePath: string) => {
          if (filePath === 'src/utils/helpers.ts') {
            return `export function slugify(text: string): string {
  return text.toLowerCase().replace(/\\s+/g, '-');
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US').format(date);
}`;
          }
          return null;
        }),
      };

      const mockJob = {
        data: {
          scanRunId,
          repoId,
          prNumber: 18,
          headSha: 'e4a1b2c',
          installationId: 51234567,
        },
        id: `pr-scan-${repoId}-18`,
        progress: vi.fn(),
        log: vi.fn(),
        updateProgress: vi.fn(),
      } as unknown as Job<PRScanJobData>;

      // Run the pipeline
      await processPRScan(mockJob, deps);

      // Verify scan run completed with zero claims
      const scanResult = await pool.query('SELECT * FROM scan_runs WHERE id = $1', [scanRunId]);
      const scan = scanResult.rows[0];

      expect(scan.status).toBe('completed');
      expect(scan.claims_checked).toBe(0); // No claims in scope
      expect(scan.claims_drifted).toBe(0);
      expect(scan.claims_verified).toBe(0);
      expect(scan.claims_uncertain).toBe(0);
      expect(Number(scan.total_token_cost)).toBe(0);
      expect(scan.completed_at).not.toBeNull();

      // All 20 claims remain verified
      const claimsResult = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM claims WHERE repo_id = $1 AND verification_status = 'verified'`,
        [repoId],
      );
      expect(claimsResult.rows[0].cnt).toBe(20);

      // No verification results created
      const vrResult = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM verification_results WHERE repo_id = $1`,
        [repoId],
      );
      expect(vrResult.rows[0].cnt).toBe(0);
    });

    it('L5 reporter renders no-claims-in-scope template', async () => {
      const health = await calculateHealthScore(pool, repoId);

      expect(health.total_claims).toBe(20);
      expect(health.verified).toBe(20);
      expect(health.drifted).toBe(0);
      expect(health.score).toBe(1.0);

      const payload = {
        findings: [] as Finding[],
        health_score: health,
        agent_unavailable_pct: 0,
      };

      const outcome = determineOutcome(payload);
      expect(outcome).toBe('no_claims_in_scope');

      const comment = buildSummaryComment(payload, scanRunId);
      expect(comment).toContain('No documentation claims were affected by this PR');
      expect(comment).toContain('100%');
      expect(comment).not.toContain('Apply all fixes');
      expect(comment).not.toContain('Drifted');

      const conclusion = determineCheckConclusion(payload);
      expect(conclusion).toBe('success');
    });
  });
});
