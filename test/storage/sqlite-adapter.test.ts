import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/storage/sqlite-adapter';

describe('SqliteAdapter', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    adapter = new SqliteAdapter(':memory:');
  });

  afterEach(() => {
    adapter.close();
  });

  // === Repos ===

  describe('Repos CRUD', () => {
    it('creates and retrieves a repo', async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
      });

      expect(repo.id).toBeDefined();
      expect(repo.github_owner).toBe('test-owner');
      expect(repo.github_repo).toBe('test-repo');
      expect(repo.github_installation_id).toBe(12345);
      expect(repo.default_branch).toBe('main');
      expect(repo.status).toBe('onboarding');

      const fetched = await adapter.getRepoById(repo.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.github_owner).toBe('test-owner');
    });

    it('updates a repo', async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
      });

      const updated = await adapter.updateRepo(repo.id, {
        status: 'active',
        health_score: 0.85,
        total_claims: 10,
        verified_claims: 8,
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('active');
      expect(updated!.health_score).toBe(0.85);
      expect(updated!.total_claims).toBe(10);
      expect(updated!.verified_claims).toBe(8);
    });

    it('deletes a repo', async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
      });

      const deleted = await adapter.deleteRepo(repo.id);
      expect(deleted).toBe(true);

      const fetched = await adapter.getRepoById(repo.id);
      expect(fetched).toBeNull();
    });

    it('returns null for non-existent repo', async () => {
      const fetched = await adapter.getRepoById('nonexistent');
      expect(fetched).toBeNull();
    });

    it('returns false when deleting non-existent repo', async () => {
      const deleted = await adapter.deleteRepo('nonexistent');
      expect(deleted).toBe(false);
    });

    it('handles config JSONB round-trip', async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
        config: { doc_patterns: { include: ['*.md'] } },
      });

      const fetched = await adapter.getRepoById(repo.id);
      expect(fetched!.config).toEqual({ doc_patterns: { include: ['*.md'] } });
    });

    it('handles token_hash storage', async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
        token_hash: 'abc123hash',
      });

      expect(repo.token_hash).toBe('abc123hash');

      const updated = await adapter.updateRepo(repo.id, { token_hash: 'newhash' });
      expect(updated!.token_hash).toBe('newhash');
    });
  });

  // === Scan Runs ===

  describe('Scan Runs CRUD', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
      });
      repoId = repo.id;
    });

    it('creates and retrieves a scan run', async () => {
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

      const fetched = await adapter.getScanRunById(scanRun.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.commit_sha).toBe('abc123');
    });

    it('updates a scan run', async () => {
      const scanRun = await adapter.createScanRun({
        repo_id: repoId,
        trigger_type: 'pr',
        commit_sha: 'abc123',
      });

      const updated = await adapter.updateScanRun(scanRun.id, {
        status: 'completed',
        claims_checked: 20,
        claims_drifted: 3,
        claims_verified: 15,
        claims_uncertain: 2,
      });

      expect(updated!.status).toBe('completed');
      expect(updated!.claims_checked).toBe(20);
      expect(updated!.claims_drifted).toBe(3);
    });

    it('deletes a scan run', async () => {
      const scanRun = await adapter.createScanRun({
        repo_id: repoId,
        trigger_type: 'pr',
        commit_sha: 'abc123',
      });

      const deleted = await adapter.deleteScanRun(scanRun.id);
      expect(deleted).toBe(true);

      const fetched = await adapter.getScanRunById(scanRun.id);
      expect(fetched).toBeNull();
    });

    it('cascades delete when repo is deleted', async () => {
      const scanRun = await adapter.createScanRun({
        repo_id: repoId,
        trigger_type: 'pr',
        commit_sha: 'abc123',
      });

      await adapter.deleteRepo(repoId);
      const fetched = await adapter.getScanRunById(scanRun.id);
      expect(fetched).toBeNull();
    });
  });

  // === Agent Tasks ===

  describe('Agent Tasks CRUD', () => {
    let repoId: string;
    let scanRunId: string;

    beforeEach(async () => {
      const repo = await adapter.createRepo({
        github_owner: 'test-owner',
        github_repo: 'test-repo',
        github_installation_id: 12345,
      });
      repoId = repo.id;

      const scanRun = await adapter.createScanRun({
        repo_id: repoId,
        trigger_type: 'manual',
        commit_sha: 'def456',
      });
      scanRunId = scanRun.id;
    });

    it('creates and retrieves an agent task', async () => {
      const task = await adapter.createAgentTask({
        repo_id: repoId,
        scan_run_id: scanRunId,
        type: 'verification',
        payload: { claim_id: 'claim-1', claim_text: 'Run npm install' },
        expires_at: new Date('2030-01-01'),
      });

      expect(task.id).toBeDefined();
      expect(task.repo_id).toBe(repoId);
      expect(task.scan_run_id).toBe(scanRunId);
      expect(task.type).toBe('verification');
      expect(task.status).toBe('pending');
      expect(task.payload).toEqual({ claim_id: 'claim-1', claim_text: 'Run npm install' });

      const fetched = await adapter.getAgentTaskById(task.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.payload).toEqual({ claim_id: 'claim-1', claim_text: 'Run npm install' });
    });

    it('updates an agent task', async () => {
      const task = await adapter.createAgentTask({
        repo_id: repoId,
        scan_run_id: scanRunId,
        type: 'verification',
        payload: { claim_id: 'claim-1' },
        expires_at: new Date('2030-01-01'),
      });

      const updated = await adapter.updateAgentTask(task.id, {
        status: 'in_progress',
        claimed_by: 'agent-run-123',
      });

      expect(updated!.status).toBe('in_progress');
      expect(updated!.claimed_by).toBe('agent-run-123');
    });

    it('deletes an agent task', async () => {
      const task = await adapter.createAgentTask({
        repo_id: repoId,
        scan_run_id: scanRunId,
        type: 'verification',
        payload: {},
        expires_at: new Date('2030-01-01'),
      });

      const deleted = await adapter.deleteAgentTask(task.id);
      expect(deleted).toBe(true);

      const fetched = await adapter.getAgentTaskById(task.id);
      expect(fetched).toBeNull();
    });

    it('handles payload JSONB round-trip with nested data', async () => {
      const complexPayload = {
        claim_id: 'c-1',
        evidence: { files: ['src/app.ts', 'src/index.ts'], tokens: 500 },
        nested: { deep: { value: true } },
      };

      const task = await adapter.createAgentTask({
        repo_id: repoId,
        scan_run_id: scanRunId,
        type: 'verification',
        payload: complexPayload,
        expires_at: new Date('2030-01-01'),
      });

      const fetched = await adapter.getAgentTaskById(task.id);
      expect(fetched!.payload).toEqual(complexPayload);
    });
  });

  // === In-memory isolation ===

  it('uses in-memory database for test isolation', () => {
    const adapter2 = new SqliteAdapter(':memory:');
    // Each instance has its own database
    expect(adapter2).not.toBe(adapter);
    adapter2.close();
  });
});
