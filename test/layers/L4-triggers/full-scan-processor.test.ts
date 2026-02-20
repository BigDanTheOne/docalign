import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { processFullScan } from '../../../src/layers/L4-triggers/full-scan-processor';
import { createScanRun, getScanRun } from '../../../src/layers/L4-triggers/scan-store';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

 
function makeFakeJob(data: Record<string, unknown>) {
  return {
    id: `full-scan-${data.repoId}-${Date.now()}`,
    data,
    progress: vi.fn(),
    log: vi.fn(),
    updateProgress: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('processFullScan', () => {
  let pool: Pool;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'full-scan-test', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
  });

  it('transitions through running to completed', async () => {
    const scanRun = await createScanRun(pool, {
      repoId,
      triggerType: 'scheduled',
      triggerRef: null,
      commitSha: 'HEAD',
    });

    const job = makeFakeJob({
      scanRunId: scanRun.id,
      repoId,
      installationId: 1,
    });

    await processFullScan(job, pool);

    const updated = await getScanRun(pool, scanRun.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.started_at).toBeDefined();
    expect(updated!.completed_at).toBeDefined();
    expect(updated!.total_duration_ms).toBeGreaterThan(0);
  });

  describe('edge cases', () => {
    it('handles missing scanRun gracefully', async () => {
      const nonExistentScanId = randomUUID();
      const job = makeFakeJob({
        scanRunId: nonExistentScanId,
        repoId,
        installationId: 1,
      });

      await processFullScan(job, pool);

      const result = await getScanRun(pool, nonExistentScanId);
      expect(result).toBeNull();
    });

    it('handles manual trigger type', async () => {
      const scanRun = await createScanRun(pool, {
        repoId,
        triggerType: 'manual',
        triggerRef: null,
        commitSha: 'HEAD',
      });

      const job = makeFakeJob({
        scanRunId: scanRun.id,
        repoId,
        installationId: 1,
      });

      await processFullScan(job, pool);

      const updated = await getScanRun(pool, scanRun.id);
      expect(updated!.status).toBe('completed');
      expect(updated!.trigger_type).toBe('manual');
    });

    it('handles scan with specific commit SHA', async () => {
      const scanRun = await createScanRun(pool, {
        repoId,
        triggerType: 'scheduled',
        triggerRef: null,
        commitSha: 'abc123def456',
      });

      const job = makeFakeJob({
        scanRunId: scanRun.id,
        repoId,
        installationId: 1,
      });

      await processFullScan(job, pool);

      const updated = await getScanRun(pool, scanRun.id);
      expect(updated!.status).toBe('completed');
      expect(updated!.commit_sha).toBe('abc123def456');
    });
  });
});
