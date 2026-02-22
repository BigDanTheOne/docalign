import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { createTriggerService } from '../../../src/layers/L4-triggers/trigger-service';
import type { Claim } from '../../../src/shared/types';
import { POSTGRES_AVAILABLE, REDIS_AVAILABLE } from '../../infra-guard';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function makeClaim(overrides: Partial<Claim> & { id: string }): Claim {
  return {
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: 'test',
    claim_type: 'path_reference',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'pending',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe.skipIf(!POSTGRES_AVAILABLE || !REDIS_AVAILABLE)('TriggerService', () => {
  let pool: Pool;
  let redis: Redis;
  let queue: Queue;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('test-trigger-service', { connection: redis });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'trigger-test', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.quit();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    // Drain the queue
    await queue.drain();
  });

  describe('enqueuePRScan', () => {
    it('creates scan run and enqueues job', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 42, 'sha123', 1, 'delivery-1');

      expect(scanRunId).toBeDefined();

      // Verify scan_run was created
      const result = await pool.query('SELECT * FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].trigger_type).toBe('pr');
      expect(result.rows[0].trigger_ref).toBe('42');
      expect(result.rows[0].status).toBe('queued');

      // Verify job was enqueued
      const job = await queue.getJob(`pr-scan-${repoId}-42`);
      expect(job).toBeDefined();
      expect(job!.data.prNumber).toBe(42);
      expect(job!.data.headSha).toBe('sha123');
    });

    it('rate limits at 100 scans per day', async () => {
      const svc = createTriggerService(pool, queue, redis);

      // Insert 100 scans for today
      for (let i = 0; i < 100; i++) {
        await pool.query(
          `INSERT INTO scan_runs (repo_id, trigger_type, trigger_ref, commit_sha, status,
             claims_checked, claims_drifted, claims_verified, claims_uncertain,
             total_token_cost, total_duration_ms, comment_posted)
           VALUES ($1, 'pr', $2, 'sha', 'completed', 0, 0, 0, 0, 0, 0, false)`,
          [repoId, String(i)],
        );
      }

      await expect(
        svc.enqueuePRScan(repoId, 999, 'sha', 1, 'delivery-ratelimit'),
      ).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('enqueueFullScan', () => {
    it('creates scan run with scheduled trigger type', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueueFullScan(repoId, 1);

      expect(scanRunId).toBeDefined();

      const result = await pool.query('SELECT * FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].trigger_type).toBe('scheduled');
      expect(result.rows[0].trigger_ref).toBeNull();
    });
  });

  describe('cancelScan', () => {
    it('cancels a queued scan directly', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 10, 'sha', 1, 'delivery-cancel');

      await svc.cancelScan(scanRunId);

      const result = await pool.query('SELECT status FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('cancelled');
    });

    it('sets Redis cancel flag for running scan', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 11, 'sha', 1, 'delivery-cancel-running');

      // Manually transition to running
      await pool.query(`UPDATE scan_runs SET status = 'running' WHERE id = $1`, [scanRunId]);

      await svc.cancelScan(scanRunId);

      // Check Redis cancel key was set
      const run = await pool.query('SELECT * FROM scan_runs WHERE id = $1', [scanRunId]);
      const prefix = `pr-scan-${run.rows[0].repo_id}-${run.rows[0].trigger_ref}`;
      const cancelKey = await redis.exists(`cancel:${prefix}`);
      expect(cancelKey).toBe(1);
    });

    it('no-ops for completed scan', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 12, 'sha', 1, 'delivery-cancel-completed');

      await pool.query(`UPDATE scan_runs SET status = 'completed' WHERE id = $1`, [scanRunId]);

      // Should not throw
      await svc.cancelScan(scanRunId);

      const result = await pool.query('SELECT status FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('completed');
    });

    it('no-ops for non-existent scan', async () => {
      const svc = createTriggerService(pool, queue, redis);
      // Should not throw
      await svc.cancelScan(randomUUID());
    });

    it('sets completed_at when cancelling queued scan', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 13, 'sha', 1, 'delivery-cancel-ts');

      await svc.cancelScan(scanRunId);

      const result = await pool.query('SELECT status, completed_at FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('cancelled');
      expect(result.rows[0].completed_at).not.toBeNull();
    });

    it('handles rapid-fire cancel calls idempotently', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 14, 'sha', 1, 'delivery-rapid');

      // Fire multiple cancels simultaneously
      await Promise.all([
        svc.cancelScan(scanRunId),
        svc.cancelScan(scanRunId),
        svc.cancelScan(scanRunId),
      ]);

      const result = await pool.query('SELECT status FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('cancelled');
    });

    it('no-ops for already cancelled scan', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 15, 'sha', 1, 'delivery-already-cancelled');

      await pool.query(`UPDATE scan_runs SET status = 'cancelled', completed_at = NOW() WHERE id = $1`, [scanRunId]);

      // Should not throw
      await svc.cancelScan(scanRunId);

      const result = await pool.query('SELECT status FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('cancelled');
    });

    it('no-ops for failed scan', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 16, 'sha', 1, 'delivery-failed');

      await pool.query(`UPDATE scan_runs SET status = 'failed' WHERE id = $1`, [scanRunId]);

      await svc.cancelScan(scanRunId);

      const result = await pool.query('SELECT status FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('failed');
    });
  });

  describe('updateScanStatus', () => {
    it('delegates to scan-store updateScanStatus', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const scanRunId = await svc.enqueuePRScan(repoId, 20, 'sha', 1, 'delivery-status');

      await svc.updateScanStatus(scanRunId, 'running');

      const result = await pool.query('SELECT status FROM scan_runs WHERE id = $1', [scanRunId]);
      expect(result.rows[0].status).toBe('running');
    });
  });

  describe('resolveScope', () => {
    it('returns docClaims when no code files changed', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const claim = makeClaim({ id: randomUUID(), repo_id: repoId });
      const mockMapper = {
        findClaimsByCodeFiles: vi.fn().mockResolvedValue([]),
        mapClaim: vi.fn(),
        updateCodeFilePaths: vi.fn(),
        removeMappingsForFiles: vi.fn(),
        getMappingsForClaim: vi.fn(),
      };

      const result = await svc.resolveScope(repoId, [], [claim], // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockMapper as any);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(claim.id);
      expect(mockMapper.findClaimsByCodeFiles).not.toHaveBeenCalled();
    });

    it('deduplicates claims from both sources', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const claimId = randomUUID();

      // Insert claim in DB
      await pool.query(
        `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type,
           testability, extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
         VALUES ($1, $2, 'README.md', 1, 'test', 'path_reference', 'syntactic', '{}', '{}', 1.0, 'regex', 'pending')`,
        [claimId, repoId],
      );

      const docClaim = makeClaim({ id: claimId, repo_id: repoId });

      const mockMapper = {
        findClaimsByCodeFiles: vi.fn().mockResolvedValue([{ claim_id: claimId }]),
        mapClaim: vi.fn(),
        updateCodeFilePaths: vi.fn(),
        removeMappingsForFiles: vi.fn(),
        getMappingsForClaim: vi.fn(),
      };

      const result = await svc.resolveScope(repoId, ['src/app.ts'], [docClaim], // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockMapper as any);
      // Same claim from both sources: should appear once
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(claimId);

      // Cleanup
      await pool.query('DELETE FROM claims WHERE id = $1', [claimId]);
    });

    it('merges claims from doc changes and code changes', async () => {
      const svc = createTriggerService(pool, queue, redis);
      const docClaimId = randomUUID();
      const codeClaimId = randomUUID();

      // Insert code-related claim in DB
      await pool.query(
        `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type,
           testability, extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
         VALUES ($1, $2, 'docs/api.md', 5, 'code claim', 'api_route', 'syntactic', '{}', '{}', 0.9, 'regex', 'pending')`,
        [codeClaimId, repoId],
      );

      const docClaim = makeClaim({ id: docClaimId, repo_id: repoId });

      const mockMapper = {
        findClaimsByCodeFiles: vi.fn().mockResolvedValue([{ claim_id: codeClaimId }]),
        mapClaim: vi.fn(),
        updateCodeFilePaths: vi.fn(),
        removeMappingsForFiles: vi.fn(),
        getMappingsForClaim: vi.fn(),
      };

      const result = await svc.resolveScope(repoId, ['src/routes.ts'], [docClaim], // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockMapper as any);
      expect(result).toHaveLength(2);

      // Cleanup
      await pool.query('DELETE FROM claims WHERE id = $1', [codeClaimId]);
    });
  });
});
