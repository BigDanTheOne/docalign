import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import { PostgresAdapter } from '../../src/shared/pg-adapter';
import type { StorageAdapter } from '../../src/shared/storage-adapter';
import { POSTGRES_AVAILABLE } from '../infra-guard';


describe.skipIf(!POSTGRES_AVAILABLE)('(requires infra)', () => {
  const TEST_DB_URL = process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';

  let db: DatabaseClient;
  let adapter: StorageAdapter;

  // Tables are expected to exist via migrations (npm run migrate:up)

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);
    adapter = new PostgresAdapter(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    // Clean all rows between tests (preserving table structure)
    await db.query('DELETE FROM agent_tasks');
    await db.query('DELETE FROM scan_runs');
    await db.query('DELETE FROM repos');
  });

  describe('PostgresAdapter', () => {
    // === Repos CRUD ===

    describe('repos', () => {
      it('creates a repo with defaults', async () => {
        const repo = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });

        expect(repo.id).toBeDefined();
        expect(repo.github_owner).toBe('acme');
        expect(repo.github_repo).toBe('webapp');
        expect(repo.github_installation_id).toBe(12345);
        expect(repo.default_branch).toBe('main');
        expect(repo.status).toBe('onboarding');
        expect(repo.total_claims).toBe(0);
        expect(repo.verified_claims).toBe(0);
        expect(repo.token_hash).toBeNull();
        expect(repo.created_at).toBeInstanceOf(Date);
        expect(repo.updated_at).toBeInstanceOf(Date);
      });

      it('creates a repo with custom values', async () => {
        const repo = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'api',
          github_installation_id: 99999,
          default_branch: 'develop',
          status: 'active',
          token_hash: 'abc123hash',
        });

        expect(repo.default_branch).toBe('develop');
        expect(repo.status).toBe('active');
        expect(repo.token_hash).toBe('abc123hash');
      });

      it('gets a repo by id', async () => {
        const created = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });

        const found = await adapter.getRepoById(created.id);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
        expect(found!.github_owner).toBe('acme');
      });

      it('returns null for nonexistent repo', async () => {
        const found = await adapter.getRepoById('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });

      it('updates a repo', async () => {
        const created = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });

        const updated = await adapter.updateRepo(created.id, {
          status: 'active',
          health_score: 0.85,
          total_claims: 42,
        });

        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('active');
        expect(updated!.health_score).toBeCloseTo(0.85);
        expect(updated!.total_claims).toBe(42);
        expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
      });

      it('returns null when updating nonexistent repo', async () => {
        const updated = await adapter.updateRepo('00000000-0000-0000-0000-000000000000', {
          status: 'active',
        });
        expect(updated).toBeNull();
      });

      it('deletes a repo', async () => {
        const created = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });

        const deleted = await adapter.deleteRepo(created.id);
        expect(deleted).toBe(true);

        const found = await adapter.getRepoById(created.id);
        expect(found).toBeNull();
      });

      it('returns false when deleting nonexistent repo', async () => {
        const deleted = await adapter.deleteRepo('00000000-0000-0000-0000-000000000000');
        expect(deleted).toBe(false);
      });

      it('enforces unique constraint on github_owner + github_repo', async () => {
        await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });

        await expect(
          adapter.createRepo({
            github_owner: 'acme',
            github_repo: 'webapp',
            github_installation_id: 99999,
          }),
        ).rejects.toThrow();
      });
    });

    // === Scan Runs CRUD ===

    describe('scan_runs', () => {
      let repoId: string;

      beforeEach(async () => {
        const repo = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });
        repoId = repo.id;
      });

      it('creates a scan run with defaults', async () => {
        const scanRun = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'pr',
          commit_sha: 'abc123',
        });

        expect(scanRun.id).toBeDefined();
        expect(scanRun.repo_id).toBe(repoId);
        expect(scanRun.trigger_type).toBe('pr');
        expect(scanRun.commit_sha).toBe('abc123');
        expect(scanRun.status).toBe('queued');
        expect(scanRun.claims_checked).toBe(0);
        expect(scanRun.comment_posted).toBe(false);
        expect(scanRun.created_at).toBeInstanceOf(Date);
      });

      it('creates a scan run with trigger_ref', async () => {
        const scanRun = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'pr',
          trigger_ref: '42',
          commit_sha: 'def456',
        });

        expect(scanRun.trigger_ref).toBe('42');
      });

      it('gets a scan run by id', async () => {
        const created = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'push',
          commit_sha: 'abc123',
        });

        const found = await adapter.getScanRunById(created.id);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
      });

      it('returns null for nonexistent scan run', async () => {
        const found = await adapter.getScanRunById('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });

      it('updates a scan run', async () => {
        const created = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'pr',
          commit_sha: 'abc123',
        });

        const updated = await adapter.updateScanRun(created.id, {
          status: 'completed',
          claims_checked: 10,
          claims_drifted: 2,
          claims_verified: 7,
          claims_uncertain: 1,
          completed_at: new Date(),
        });

        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('completed');
        expect(updated!.claims_checked).toBe(10);
        expect(updated!.claims_drifted).toBe(2);
        expect(updated!.claims_verified).toBe(7);
        expect(updated!.claims_uncertain).toBe(1);
        expect(updated!.completed_at).toBeInstanceOf(Date);
      });

      it('deletes a scan run', async () => {
        const created = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'pr',
          commit_sha: 'abc123',
        });

        const deleted = await adapter.deleteScanRun(created.id);
        expect(deleted).toBe(true);

        const found = await adapter.getScanRunById(created.id);
        expect(found).toBeNull();
      });

      it('cascades delete when repo is deleted', async () => {
        const scanRun = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'pr',
          commit_sha: 'abc123',
        });

        await adapter.deleteRepo(repoId);

        const found = await adapter.getScanRunById(scanRun.id);
        expect(found).toBeNull();
      });
    });

    // === Agent Tasks CRUD ===

    describe('agent_tasks', () => {
      let repoId: string;
      let scanRunId: string;

      beforeEach(async () => {
        const repo = await adapter.createRepo({
          github_owner: 'acme',
          github_repo: 'webapp',
          github_installation_id: 12345,
        });
        repoId = repo.id;

        const scanRun = await adapter.createScanRun({
          repo_id: repoId,
          trigger_type: 'pr',
          commit_sha: 'abc123',
        });
        scanRunId = scanRun.id;
      });

      it('creates an agent task with defaults', async () => {
        const task = await adapter.createAgentTask({
          repo_id: repoId,
          scan_run_id: scanRunId,
          type: 'verification',
          payload: { type: 'verification', claim: 'test' },
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        expect(task.id).toBeDefined();
        expect(task.repo_id).toBe(repoId);
        expect(task.scan_run_id).toBe(scanRunId);
        expect(task.type).toBe('verification');
        expect(task.status).toBe('pending');
        expect(task.claimed_by).toBeNull();
        expect(task.error).toBeNull();
        expect(task.completed_at).toBeNull();
        expect(task.created_at).toBeInstanceOf(Date);
      });

      it('gets an agent task by id', async () => {
        const created = await adapter.createAgentTask({
          repo_id: repoId,
          scan_run_id: scanRunId,
          type: 'claim_extraction',
          payload: { type: 'claim_extraction', doc_files: ['README.md'] },
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        const found = await adapter.getAgentTaskById(created.id);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
        expect(found!.type).toBe('claim_extraction');
      });

      it('returns null for nonexistent agent task', async () => {
        const found = await adapter.getAgentTaskById('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });

      it('updates an agent task', async () => {
        const created = await adapter.createAgentTask({
          repo_id: repoId,
          scan_run_id: scanRunId,
          type: 'verification',
          payload: { type: 'verification' },
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        const updated = await adapter.updateAgentTask(created.id, {
          status: 'in_progress',
          claimed_by: 'run-12345',
        });

        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('in_progress');
        expect(updated!.claimed_by).toBe('run-12345');
      });

      it('deletes an agent task', async () => {
        const created = await adapter.createAgentTask({
          repo_id: repoId,
          scan_run_id: scanRunId,
          type: 'verification',
          payload: { type: 'verification' },
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        const deleted = await adapter.deleteAgentTask(created.id);
        expect(deleted).toBe(true);

        const found = await adapter.getAgentTaskById(created.id);
        expect(found).toBeNull();
      });

      it('cascades delete when scan run is deleted', async () => {
        const task = await adapter.createAgentTask({
          repo_id: repoId,
          scan_run_id: scanRunId,
          type: 'verification',
          payload: { type: 'verification' },
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        await adapter.deleteScanRun(scanRunId);

        const found = await adapter.getAgentTaskById(task.id);
        expect(found).toBeNull();
      });

      it('cascades delete when repo is deleted', async () => {
        const task = await adapter.createAgentTask({
          repo_id: repoId,
          scan_run_id: scanRunId,
          type: 'verification',
          payload: { type: 'verification' },
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        await adapter.deleteRepo(repoId);

        const found = await adapter.getAgentTaskById(task.id);
        expect(found).toBeNull();
      });
    });

    // === Transaction support ===

    describe('transactions', () => {
      it('commits on success', async () => {
        await db.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO repos (github_owner, github_repo, github_installation_id)
             VALUES ($1, $2, $3)`,
            ['tx-org', 'tx-repo', 11111],
          );
        });

        const result = await db.query<{ github_owner: string }>(
          "SELECT github_owner FROM repos WHERE github_owner = 'tx-org'",
        );
        expect(result.rows).toHaveLength(1);
      });

      it('rolls back on error', async () => {
        await expect(
          db.transaction(async (tx) => {
            await tx.query(
              `INSERT INTO repos (github_owner, github_repo, github_installation_id)
               VALUES ($1, $2, $3)`,
              ['rollback-org', 'rollback-repo', 22222],
            );
            throw new Error('Intentional test error');
          }),
        ).rejects.toThrow('Intentional test error');

        const result = await db.query<{ github_owner: string }>(
          "SELECT github_owner FROM repos WHERE github_owner = 'rollback-org'",
        );
        expect(result.rows).toHaveLength(0);
      });
    });

    // === Connection pool lifecycle ===

    describe('connection pool', () => {
      it('connects and runs a query', async () => {
        const result = await db.query<{ result: number }>('SELECT 1 as result');
        expect(result.rows[0].result).toBe(1);
      });

      it('handles concurrent queries', async () => {
        // Create a repo first for concurrent reads
        const repo = await adapter.createRepo({
          github_owner: 'concurrent',
          github_repo: 'test',
          github_installation_id: 33333,
        });

        const results = await Promise.all([
          adapter.getRepoById(repo.id),
          adapter.getRepoById(repo.id),
          adapter.getRepoById(repo.id),
        ]);

        for (const r of results) {
          expect(r).not.toBeNull();
          expect(r!.id).toBe(repo.id);
        }
      });
    });
  });
});
