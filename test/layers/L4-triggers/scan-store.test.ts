import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createScanRun, updateScanStatus, getScanRun, getActiveScanRuns } from '../../../src/layers/L4-triggers/scan-store';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe('scan-store', () => {
  let pool: Pool;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'scan-store-test', 1, 'main', 'active')`,
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

  describe('createScanRun', () => {
    it('creates a scan run with queued status', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '42',
        commitSha: 'abc123',
      });

      expect(run.id).toBeDefined();
      expect(run.repo_id).toBe(repoId);
      expect(run.trigger_type).toBe('pr');
      expect(run.trigger_ref).toBe('42');
      expect(run.commit_sha).toBe('abc123');
      expect(run.status).toBe('queued');
      expect(run.claims_checked).toBe(0);
      expect(run.claims_drifted).toBe(0);
      expect(run.comment_posted).toBe(false);
    });

    it('creates a scheduled scan with null triggerRef', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'scheduled',
        triggerRef: null,
        commitSha: 'HEAD',
      });

      expect(run.trigger_type).toBe('scheduled');
      expect(run.trigger_ref).toBeNull();
    });
  });

  describe('updateScanStatus', () => {
    it('updates status to running with started_at', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '1',
        commitSha: 'sha1',
      });

      await updateScanStatus(pool, run.id, 'running');

      const updated = await getScanRun(pool, run.id);
      expect(updated!.status).toBe('running');
      expect(updated!.started_at).toBeDefined();
    });

    it('updates status to completed with completed_at', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '1',
        commitSha: 'sha1',
      });

      await updateScanStatus(pool, run.id, 'completed', {
        claims_checked: 10,
        claims_drifted: 2,
        claims_verified: 8,
        total_duration_ms: 5000,
      });

      const updated = await getScanRun(pool, run.id);
      expect(updated!.status).toBe('completed');
      expect(updated!.completed_at).toBeDefined();
      expect(updated!.claims_checked).toBe(10);
      expect(updated!.claims_drifted).toBe(2);
      expect(updated!.claims_verified).toBe(8);
      expect(updated!.total_duration_ms).toBe(5000);
    });

    it('updates comment_posted and check_run_id', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '1',
        commitSha: 'sha1',
      });

      await updateScanStatus(pool, run.id, 'completed', {
        comment_posted: true,
        check_run_id: 12345,
      });

      const updated = await getScanRun(pool, run.id);
      expect(updated!.comment_posted).toBe(true);
      expect(Number(updated!.check_run_id)).toBe(12345);
    });

    it('updates status to cancelled with completed_at', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '1',
        commitSha: 'sha1',
      });

      await updateScanStatus(pool, run.id, 'cancelled');

      const updated = await getScanRun(pool, run.id);
      expect(updated!.status).toBe('cancelled');
      expect(updated!.completed_at).toBeDefined();
    });

    it('updates status to failed with completed_at', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '1',
        commitSha: 'sha1',
      });

      await updateScanStatus(pool, run.id, 'failed');

      const updated = await getScanRun(pool, run.id);
      expect(updated!.status).toBe('failed');
      expect(updated!.completed_at).toBeDefined();
    });
  });

  describe('getScanRun', () => {
    it('returns null for non-existent ID', async () => {
      const result = await getScanRun(pool, randomUUID());
      expect(result).toBeNull();
    });

    it('returns the scan run for valid ID', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '5',
        commitSha: 'deadbeef',
      });

      const fetched = await getScanRun(pool, run.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(run.id);
      expect(fetched!.trigger_ref).toBe('5');
    });
  });

  describe('getActiveScanRuns', () => {
    it('returns queued and running scans', async () => {
      await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '1', commitSha: 'a' });
      const running = await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '2', commitSha: 'b' });
      await updateScanStatus(pool, running.id, 'running');
      const completed = await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '3', commitSha: 'c' });
      await updateScanStatus(pool, completed.id, 'completed');

      const active = await getActiveScanRuns(pool, repoId);
      expect(active).toHaveLength(2); // queued + running
      expect(active.every((r) => r.status === 'queued' || r.status === 'running')).toBe(true);
    });

    it('returns empty for no active scans', async () => {
      const result = await getActiveScanRuns(pool, repoId);
      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('updateScanStatus handles non-existent scan ID gracefully', async () => {
      const nonExistentId = randomUUID();
      await updateScanStatus(pool, nonExistentId, 'completed');
      const result = await getScanRun(pool, nonExistentId);
      expect(result).toBeNull();
    });

    it('createScanRun handles very long commit SHA', async () => {
      const longSha = 'a'.repeat(100);
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '99',
        commitSha: longSha,
      });
      expect(run.commit_sha).toBe(longSha);
    });

    it('updateScanStatus handles zero values for stats', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '100',
        commitSha: 'sha100',
      });

      await updateScanStatus(pool, run.id, 'completed', {
        claims_checked: 0,
        claims_drifted: 0,
        claims_verified: 0,
        total_duration_ms: 0,
      });

      const updated = await getScanRun(pool, run.id);
      expect(updated!.claims_checked).toBe(0);
      expect(updated!.claims_drifted).toBe(0);
      expect(updated!.claims_verified).toBe(0);
      expect(updated!.total_duration_ms).toBe(0);
    });

    it('updateScanStatus handles partial stats update', async () => {
      const run = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: '101',
        commitSha: 'sha101',
      });

      await updateScanStatus(pool, run.id, 'completed', {
        claims_checked: 5,
      });

      const updated = await getScanRun(pool, run.id);
      expect(updated!.claims_checked).toBe(5);
      expect(updated!.claims_drifted).toBe(0); // unchanged from default
    });

    it('getActiveScanRuns returns scans in reverse creation order (newest first)', async () => {
      const run1 = await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '201', commitSha: 'sha201' });
      const run2 = await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '202', commitSha: 'sha202' });

      const active = await getActiveScanRuns(pool, repoId);
      expect(active).toHaveLength(2);
      // Ordered by created_at DESC, so newest (run2) comes first
      expect(active[0].id).toBe(run2.id);
      expect(active[1].id).toBe(run1.id);
    });

    it('getActiveScanRuns excludes cancelled and failed scans', async () => {
      await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '301', commitSha: 'sha301' });
      const cancelled = await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '302', commitSha: 'sha302' });
      const failed = await createScanRun(pool, { repoId, triggerType: 'pr', triggerRef: '303', commitSha: 'sha303' });

      await updateScanStatus(pool, cancelled.id, 'cancelled');
      await updateScanStatus(pool, failed.id, 'failed');

      const active = await getActiveScanRuns(pool, repoId);
      expect(active).toHaveLength(1); // Only the queued one
      expect(active[0].trigger_ref).toBe('301');
    });
  });
});
