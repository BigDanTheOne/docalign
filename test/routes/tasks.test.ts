import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createTaskRoutes } from '../../src/routes/tasks';
import { createAuthMiddleware } from '../../src/middleware/auth';
import { generateRepoToken } from '../../src/shared/token';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import type { Server } from 'http';
import { POSTGRES_AVAILABLE } from '../infra-guard';


describe.skipIf(!POSTGRES_AVAILABLE)('(requires infra)', () => {
  const TEST_DB_URL =
    process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';

  let db: DatabaseClient;
  let server: Server;
  let baseUrl: string;
  let repoId: string;
  let scanRunId: string;
  let validToken: string;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);

    // Create repo with token
    const { token, hash } = generateRepoToken();
    validToken = token;
    const repoResult = await db.query<{ id: string }>(
      `INSERT INTO repos (github_owner, github_repo, github_installation_id, token_hash, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      ['tasktest-owner', 'tasktest-repo', 77777, hash, 'active'],
    );
    repoId = repoResult.rows[0].id;

    // Create scan run
    const scanResult = await db.query<{ id: string }>(
      `INSERT INTO scan_runs (repo_id, trigger_type, commit_sha, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [repoId, 'pr', 'abc123', 'running'],
    );
    scanRunId = scanResult.rows[0].id;

    // Set up Express app
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/tasks', createAuthMiddleware(db), createTaskRoutes(db));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM agent_tasks WHERE repo_id = $1', [repoId]);
    await db.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await db.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await db.end();
  });

  beforeEach(async () => {
    // Clean up tasks between tests
    await db.query('DELETE FROM agent_tasks WHERE repo_id = $1', [repoId]);
  });

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${validToken}` };
  }

  describe('GET /api/tasks/pending', () => {
    it('returns pending tasks filtered by repo_id', async () => {
      // Create a pending task
      await db.query(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 minutes')`,
        [repoId, scanRunId, 'verification', 'pending', JSON.stringify({ type: 'verification' })],
      );

      const res = await fetch(`${baseUrl}/api/tasks/pending?repo_id=${repoId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].type).toBe('verification');
      expect(body.tasks[0].status).toBe('pending');
    });

    it('all endpoints require DOCALIGN_TOKEN auth', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/pending?repo_id=${repoId}`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/tasks/:id (claim)', () => {
    it('claims task atomically and returns full detail', async () => {
      const taskResult = await db.query<{ id: string }>(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [repoId, scanRunId, 'verification', 'pending', JSON.stringify({ type: 'verification' })],
      );
      const taskId = taskResult.rows[0].id;

      const res = await fetch(
        `${baseUrl}/api/tasks/${taskId}?repo_id=${repoId}&action_run_id=run-123`,
        { headers: authHeaders() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(taskId);
      expect(body.status).toBe('in_progress');
      expect(body.claimed_by).toBe('run-123');
      expect(body.payload).toBeDefined();
    });

    it('concurrent claims result in one 200 and one 409', async () => {
      const taskResult = await db.query<{ id: string }>(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [repoId, scanRunId, 'verification', 'pending', JSON.stringify({ type: 'verification' })],
      );
      const taskId = taskResult.rows[0].id;

      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/tasks/${taskId}?repo_id=${repoId}&action_run_id=run-a`, {
          headers: authHeaders(),
        }),
        fetch(`${baseUrl}/api/tasks/${taskId}?repo_id=${repoId}&action_run_id=run-b`, {
          headers: authHeaders(),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('expired task returns 410', async () => {
      const taskResult = await db.query<{ id: string }>(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '1 hour')
         RETURNING id`,
        [repoId, scanRunId, 'verification', 'pending', JSON.stringify({ type: 'verification' })],
      );
      const taskId = taskResult.rows[0].id;

      const res = await fetch(`${baseUrl}/api/tasks/${taskId}?repo_id=${repoId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(410);
    });
  });

  describe('POST /api/tasks/:id/result', () => {
    it('accepts valid result and updates status to completed', async () => {
      // Create and claim a task
      const taskResult = await db.query<{ id: string }>(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, claimed_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [repoId, scanRunId, 'verification', 'in_progress', JSON.stringify({ type: 'verification' }), 'run-x'],
      );
      const taskId = taskResult.rows[0].id;

      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/result?repo_id=${repoId}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            type: 'verification',
            verdict: 'drifted',
            confidence: 0.95,
            reasoning: 'Code uses argon2, not bcrypt',
            evidence_files: ['src/auth/password.ts'],
          },
          metadata: { duration_ms: 2340, model_used: 'claude-sonnet-4-20250514' },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('accepted');
      expect(body.task_id).toBe(taskId);

      // Verify DB state
      const updated = await db.query<{ status: string }>(
        'SELECT status FROM agent_tasks WHERE id = $1',
        [taskId],
      );
      expect(updated.rows[0].status).toBe('completed');
    });

    it('Zod validation rejects invalid verdict/confidence', async () => {
      const taskResult = await db.query<{ id: string }>(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, claimed_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [repoId, scanRunId, 'verification', 'in_progress', JSON.stringify({ type: 'verification' }), 'run-y'],
      );
      const taskId = taskResult.rows[0].id;

      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/result?repo_id=${repoId}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            type: 'verification',
            verdict: 'INVALID_VERDICT',
            confidence: 2.0,
          },
          metadata: { duration_ms: 100 },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('DOCALIGN_E202');
    });

    it('double submission returns 409', async () => {
      const taskResult = await db.query<{ id: string }>(
        `INSERT INTO agent_tasks (repo_id, scan_run_id, type, status, payload, claimed_by, expires_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '30 minutes', NOW())
         RETURNING id`,
        [repoId, scanRunId, 'verification', 'completed', JSON.stringify({ type: 'verification' }), 'run-z'],
      );
      const taskId = taskResult.rows[0].id;

      const res = await fetch(`${baseUrl}/api/tasks/${taskId}/result?repo_id=${repoId}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: { type: 'verification', verdict: 'verified', confidence: 1.0 },
          metadata: { duration_ms: 100 },
        }),
      });
      expect(res.status).toBe(409);
    });
  });
});
