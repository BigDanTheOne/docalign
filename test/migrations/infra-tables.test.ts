import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import { POSTGRES_AVAILABLE } from '../infra-guard';


describe.skipIf(!POSTGRES_AVAILABLE)('(requires infra)', () => {
  const TEST_DB_URL = process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';

  let db: DatabaseClient;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);
  });

  afterAll(async () => {
    await db.end();
  });

  interface ColumnInfo {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }

  interface ConstraintInfo {
    constraint_name: string;
    constraint_type: string;
    check_clause: string | null;
  }

  interface IndexInfo {
    indexname: string;
    indexdef: string;
  }

  async function getColumns(tableName: string): Promise<ColumnInfo[]> {
    const result = await db.query<ColumnInfo>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [tableName],
    );
    return result.rows;
  }

  async function getConstraints(tableName: string): Promise<ConstraintInfo[]> {
    const result = await db.query<ConstraintInfo>(
      `SELECT tc.constraint_name, tc.constraint_type, cc.check_clause
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.check_constraints cc
         ON tc.constraint_name = cc.constraint_name
       WHERE tc.table_name = $1 AND tc.table_schema = 'public'`,
      [tableName],
    );
    return result.rows;
  }

  async function getIndexes(tableName: string): Promise<IndexInfo[]> {
    const result = await db.query<IndexInfo>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE tablename = $1 AND schemaname = 'public'`,
      [tableName],
    );
    return result.rows;
  }

  describe('Infrastructure table migrations', () => {
    it('repos table exists with correct columns', async () => {
      const columns = await getColumns('repos');
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('github_owner');
      expect(columnNames).toContain('github_repo');
      expect(columnNames).toContain('github_installation_id');
      expect(columnNames).toContain('default_branch');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('last_indexed_commit');
      expect(columnNames).toContain('last_full_scan_at');
      expect(columnNames).toContain('config');
      expect(columnNames).toContain('health_score');
      expect(columnNames).toContain('total_claims');
      expect(columnNames).toContain('verified_claims');
      expect(columnNames).toContain('token_hash');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('repos table has correct NOT NULL constraints', async () => {
      const columns = await getColumns('repos');
      const findColumn = (name: string) => columns.find((c) => c.column_name === name);

      expect(findColumn('id')!.is_nullable).toBe('NO');
      expect(findColumn('github_owner')!.is_nullable).toBe('NO');
      expect(findColumn('github_repo')!.is_nullable).toBe('NO');
      expect(findColumn('github_installation_id')!.is_nullable).toBe('NO');
      expect(findColumn('default_branch')!.is_nullable).toBe('NO');
      expect(findColumn('status')!.is_nullable).toBe('NO');
      expect(findColumn('created_at')!.is_nullable).toBe('NO');
      expect(findColumn('updated_at')!.is_nullable).toBe('NO');

      // Nullable columns
      expect(findColumn('last_indexed_commit')!.is_nullable).toBe('YES');
      expect(findColumn('health_score')!.is_nullable).toBe('YES');
      expect(findColumn('token_hash')!.is_nullable).toBe('YES');
    });

    it('repos table has CHECK constraint on status', async () => {
      const constraints = await getConstraints('repos');
      const checkConstraints = constraints.filter((c) => c.constraint_type === 'CHECK');
      const statusCheck = checkConstraints.find((c) => c.check_clause?.includes('onboarding'));
      expect(statusCheck).toBeDefined();
    });

    it('repos table has UNIQUE constraint on (github_owner, github_repo)', async () => {
      const constraints = await getConstraints('repos');
      const unique = constraints.find((c) => c.constraint_type === 'UNIQUE');
      expect(unique).toBeDefined();
      expect(unique!.constraint_name).toBe('repos_owner_repo_unique');
    });

    it('repos table has correct indexes', async () => {
      const indexes = await getIndexes('repos');
      const indexNames = indexes.map((i) => i.indexname);

      expect(indexNames).toContain('repos_github_installation_id_index');
      expect(indexNames).toContain('repos_github_owner_github_repo_index');
    });

    it('scan_runs table exists with correct columns', async () => {
      const columns = await getColumns('scan_runs');
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('repo_id');
      expect(columnNames).toContain('trigger_type');
      expect(columnNames).toContain('trigger_ref');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('commit_sha');
      expect(columnNames).toContain('claims_checked');
      expect(columnNames).toContain('claims_drifted');
      expect(columnNames).toContain('claims_verified');
      expect(columnNames).toContain('claims_uncertain');
      expect(columnNames).toContain('total_token_cost');
      expect(columnNames).toContain('total_duration_ms');
      expect(columnNames).toContain('comment_posted');
      expect(columnNames).toContain('check_run_id');
      expect(columnNames).toContain('started_at');
      expect(columnNames).toContain('completed_at');
      expect(columnNames).toContain('created_at');
    });

    it('scan_runs has FK to repos with CASCADE delete', async () => {
      // Insert a repo
      const repoResult = await db.query<{ id: string }>(
        `INSERT INTO repos (github_owner, github_repo, github_installation_id)
         VALUES ('fk-test-org', 'fk-test-repo', 99999) RETURNING id`,
      );
      const repoId = repoResult.rows[0].id;

      // Insert a scan run
      await db.query(
        `INSERT INTO scan_runs (repo_id, trigger_type, commit_sha) VALUES ($1, 'pr', 'abc123')`,
        [repoId],
      );

      // Delete repo — scan run should cascade
      await db.query('DELETE FROM repos WHERE id = $1', [repoId]);

      const scanResult = await db.query('SELECT * FROM scan_runs WHERE repo_id = $1', [repoId]);
      expect(scanResult.rows).toHaveLength(0);
    });

    it('scan_runs has CHECK constraint on trigger_type', async () => {
      const constraints = await getConstraints('scan_runs');
      const checkConstraints = constraints.filter((c) => c.constraint_type === 'CHECK');
      const triggerCheck = checkConstraints.find((c) => c.check_clause?.includes('pr'));
      expect(triggerCheck).toBeDefined();
    });

    it('scan_runs has CHECK constraint on status', async () => {
      const constraints = await getConstraints('scan_runs');
      const checkConstraints = constraints.filter((c) => c.constraint_type === 'CHECK');
      const statusCheck = checkConstraints.find((c) => c.check_clause?.includes('queued'));
      expect(statusCheck).toBeDefined();
    });

    it('scan_runs has correct indexes', async () => {
      const indexes = await getIndexes('scan_runs');
      const indexNames = indexes.map((i) => i.indexname);

      expect(indexNames).toContain('scan_runs_repo_id_index');
      expect(indexNames).toContain('scan_runs_active_status_idx');
      expect(indexNames).toContain('scan_runs_repo_trigger_started_idx');
    });

    it('agent_tasks table exists with correct columns', async () => {
      const columns = await getColumns('agent_tasks');
      const columnNames = columns.map((c) => c.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('repo_id');
      expect(columnNames).toContain('scan_run_id');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('payload');
      expect(columnNames).toContain('claimed_by');
      expect(columnNames).toContain('error');
      expect(columnNames).toContain('expires_at');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('completed_at');
    });

    it('agent_tasks has FK to repos and scan_runs with CASCADE delete', async () => {
      // Insert repo and scan run
      const repoResult = await db.query<{ id: string }>(
        `INSERT INTO repos (github_owner, github_repo, github_installation_id)
         VALUES ('at-fk-org', 'at-fk-repo', 88888) RETURNING id`,
      );
      const repoId = repoResult.rows[0].id;

      const scanResult = await db.query<{ id: string }>(
        `INSERT INTO scan_runs (repo_id, trigger_type, commit_sha) VALUES ($1, 'pr', 'def456') RETURNING id`,
        [repoId],
      );
      const scanRunId = scanResult.rows[0].id;

      // Insert agent task
      await db.query(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, payload, expires_at)
         VALUES ($1, $2, 'verification', '{"test": true}', NOW() + INTERVAL '30 minutes')`,
        [repoId, scanRunId],
      );

      // Delete scan run — agent task should cascade
      await db.query('DELETE FROM scan_runs WHERE id = $1', [scanRunId]);

      const taskResult = await db.query('SELECT * FROM agent_tasks WHERE scan_run_id = $1', [scanRunId]);
      expect(taskResult.rows).toHaveLength(0);
    });

    it('agent_tasks has CHECK constraint on type', async () => {
      const constraints = await getConstraints('agent_tasks');
      const checkConstraints = constraints.filter((c) => c.constraint_type === 'CHECK');
      const typeCheck = checkConstraints.find((c) => c.check_clause?.includes('verification'));
      expect(typeCheck).toBeDefined();
    });

    it('agent_tasks has CHECK constraint on status', async () => {
      const constraints = await getConstraints('agent_tasks');
      const checkConstraints = constraints.filter((c) => c.constraint_type === 'CHECK');
      const statusCheck = checkConstraints.find((c) => c.check_clause?.includes('pending'));
      expect(statusCheck).toBeDefined();
    });

    it('agent_tasks has correct indexes', async () => {
      const indexes = await getIndexes('agent_tasks');
      const indexNames = indexes.map((i) => i.indexname);

      expect(indexNames).toContain('agent_tasks_pending_idx');
      expect(indexNames).toContain('agent_tasks_scan_run_id_index');
      expect(indexNames).toContain('agent_tasks_expiry_idx');
    });

    it('rejects invalid status values via CHECK constraints', async () => {
      await expect(
        db.query(
          `INSERT INTO repos (github_owner, github_repo, github_installation_id, status)
           VALUES ('test', 'check', 11111, 'invalid_status')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid trigger_type via CHECK constraints', async () => {
      const repoResult = await db.query<{ id: string }>(
        `INSERT INTO repos (github_owner, github_repo, github_installation_id)
         VALUES ('check-org', 'check-repo', 77777) RETURNING id`,
      );
      const repoId = repoResult.rows[0].id;

      await expect(
        db.query(
          `INSERT INTO scan_runs (repo_id, trigger_type, commit_sha)
           VALUES ($1, 'invalid_trigger', 'abc')`,
          [repoId],
        ),
      ).rejects.toThrow();
    });
  });
});
