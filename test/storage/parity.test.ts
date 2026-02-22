import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { StorageAdapter } from '../../src/shared/storage-adapter';
import { SqliteAdapter } from '../../src/storage/sqlite-adapter';
import { PostgresAdapter } from '../../src/shared/pg-adapter';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import { POSTGRES_AVAILABLE } from '../infra-guard';

const DB_URL = 'postgres://docalign:docalign@localhost:5432/docalign_dev';

interface TestContext {
  adapter: StorageAdapter;
  cleanup: () => Promise<void>;
}

async function createSqliteContext(): Promise<TestContext> {
  const adapter = new SqliteAdapter(':memory:');
  return {
    adapter,
    cleanup: async () => (adapter as SqliteAdapter).close(),
  };
}

let pgDb: DatabaseClient;

async function createPostgresContext(): Promise<TestContext> {
  const adapter = new PostgresAdapter(pgDb);
  // Clean tables for a fresh start
  await pgDb.query('DELETE FROM agent_tasks WHERE repo_id IN (SELECT id FROM repos WHERE github_owner = $1)', ['parity-test']);
  await pgDb.query('DELETE FROM scan_runs WHERE repo_id IN (SELECT id FROM repos WHERE github_owner = $1)', ['parity-test']);
  await pgDb.query("DELETE FROM repos WHERE github_owner = 'parity-test'");
  return {
    adapter,
    cleanup: async () => {
      await pgDb.query('DELETE FROM agent_tasks WHERE repo_id IN (SELECT id FROM repos WHERE github_owner = $1)', ['parity-test']);
      await pgDb.query('DELETE FROM scan_runs WHERE repo_id IN (SELECT id FROM repos WHERE github_owner = $1)', ['parity-test']);
      await pgDb.query("DELETE FROM repos WHERE github_owner = 'parity-test'");
    },
  };
}

describe.skipIf(!POSTGRES_AVAILABLE)('Storage Parity Tests', () => {
  beforeAll(async () => {
    pgDb = createDatabaseClient(DB_URL);
  });

  afterAll(async () => {
    await pgDb.end();
  });

  describe.each([
    { name: 'sqlite', createContext: createSqliteContext },
    { name: 'postgresql', createContext: createPostgresContext },
  ])('$name', ({ createContext }) => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await createContext();
    });

    afterAll(async () => {
      if (ctx) await ctx.cleanup();
    });

    // === Repo CRUD parity ===

    it('creates a repo with correct fields', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-1',
        github_installation_id: 42,
      });

      expect(repo.id).toBeDefined();
      expect(typeof repo.id).toBe('string');
      expect(repo.github_owner).toBe('parity-test');
      expect(repo.github_repo).toBe('parity-repo-1');
      expect(repo.github_installation_id).toBe(42);
      expect(repo.default_branch).toBe('main');
      expect(repo.status).toBe('onboarding');
      expect(repo.total_claims).toBe(0);
      expect(repo.verified_claims).toBe(0);
    });

    it('retrieves repo by ID', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-get',
        github_installation_id: 42,
      });

      const fetched = await ctx.adapter.getRepoById(repo.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(repo.id);
      expect(fetched!.github_owner).toBe('parity-test');
    });

    it('returns null for non-existent repo', async () => {
      const fetched = await ctx.adapter.getRepoById('00000000-0000-0000-0000-000000000000');
      expect(fetched).toBeNull();
    });

    it('updates a repo', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-update',
        github_installation_id: 42,
      });

      const updated = await ctx.adapter.updateRepo(repo.id, {
        status: 'active',
        health_score: 0.75,
        total_claims: 5,
        verified_claims: 3,
      });

      expect(updated!.status).toBe('active');
      expect(updated!.health_score).toBe(0.75);
      expect(updated!.total_claims).toBe(5);
      expect(updated!.verified_claims).toBe(3);
    });

    it('deletes a repo', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-delete',
        github_installation_id: 42,
      });

      expect(await ctx.adapter.deleteRepo(repo.id)).toBe(true);
      expect(await ctx.adapter.getRepoById(repo.id)).toBeNull();
    });

    it('handles config JSON round-trip', async () => {
      const config = { doc_patterns: { include: ['*.md'] }, nested: { deep: true } };
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-config',
        github_installation_id: 42,
        config,
      });

      const fetched = await ctx.adapter.getRepoById(repo.id);
      expect(fetched!.config).toEqual(config);
    });

    // === Scan Run CRUD parity ===

    it('creates and retrieves a scan run', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-scan',
        github_installation_id: 42,
      });

      const scanRun = await ctx.adapter.createScanRun({
        repo_id: repo.id,
        trigger_type: 'manual',
        commit_sha: 'abc123',
      });

      expect(scanRun.id).toBeDefined();
      expect(scanRun.repo_id).toBe(repo.id);
      expect(scanRun.trigger_type).toBe('manual');
      expect(scanRun.commit_sha).toBe('abc123');
      expect(scanRun.status).toBe('queued');
      expect(scanRun.claims_checked).toBe(0);

      const fetched = await ctx.adapter.getScanRunById(scanRun.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.commit_sha).toBe('abc123');
    });

    it('updates a scan run', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-scan-update',
        github_installation_id: 42,
      });

      const scanRun = await ctx.adapter.createScanRun({
        repo_id: repo.id,
        trigger_type: 'manual',
        commit_sha: 'def456',
      });

      const updated = await ctx.adapter.updateScanRun(scanRun.id, {
        status: 'completed',
        claims_checked: 10,
        claims_drifted: 2,
      });

      expect(updated!.status).toBe('completed');
      expect(updated!.claims_checked).toBe(10);
      expect(updated!.claims_drifted).toBe(2);
    });

    it('deletes a scan run', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-scan-delete',
        github_installation_id: 42,
      });

      const scanRun = await ctx.adapter.createScanRun({
        repo_id: repo.id,
        trigger_type: 'manual',
        commit_sha: 'ghi789',
      });

      expect(await ctx.adapter.deleteScanRun(scanRun.id)).toBe(true);
      expect(await ctx.adapter.getScanRunById(scanRun.id)).toBeNull();
    });

    // === Agent Task CRUD parity ===

    it('creates and retrieves an agent task', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-task',
        github_installation_id: 42,
      });

      const scanRun = await ctx.adapter.createScanRun({
        repo_id: repo.id,
        trigger_type: 'manual',
        commit_sha: 'task123',
      });

      const task = await ctx.adapter.createAgentTask({
        repo_id: repo.id,
        scan_run_id: scanRun.id,
        type: 'verification',
        payload: { claim_id: 'c-1', extra: { nested: true } },
        expires_at: new Date('2030-01-01'),
      });

      expect(task.id).toBeDefined();
      expect(task.repo_id).toBe(repo.id);
      expect(task.type).toBe('verification');
      expect(task.status).toBe('pending');

      const fetched = await ctx.adapter.getAgentTaskById(task.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.payload).toEqual({ claim_id: 'c-1', extra: { nested: true } });
    });

    it('updates an agent task', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-task-update',
        github_installation_id: 42,
      });

      const scanRun = await ctx.adapter.createScanRun({
        repo_id: repo.id,
        trigger_type: 'manual',
        commit_sha: 'task456',
      });

      const task = await ctx.adapter.createAgentTask({
        repo_id: repo.id,
        scan_run_id: scanRun.id,
        type: 'verification',
        payload: {},
        expires_at: new Date('2030-01-01'),
      });

      const updated = await ctx.adapter.updateAgentTask(task.id, {
        status: 'in_progress',
        claimed_by: 'runner-1',
      });

      expect(updated!.status).toBe('in_progress');
      expect(updated!.claimed_by).toBe('runner-1');
    });

    it('deletes an agent task', async () => {
      const repo = await ctx.adapter.createRepo({
        github_owner: 'parity-test',
        github_repo: 'parity-repo-task-delete',
        github_installation_id: 42,
      });

      const scanRun = await ctx.adapter.createScanRun({
        repo_id: repo.id,
        trigger_type: 'manual',
        commit_sha: 'task789',
      });

      const task = await ctx.adapter.createAgentTask({
        repo_id: repo.id,
        scan_run_id: scanRun.id,
        type: 'verification',
        payload: {},
        expires_at: new Date('2030-01-01'),
      });

      expect(await ctx.adapter.deleteAgentTask(task.id)).toBe(true);
      expect(await ctx.adapter.getAgentTaskById(task.id)).toBeNull();
    });
  });
});
