import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import type { Server } from 'http';
import type { Application } from 'express';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import { createApp } from '../../src/app';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import { createRedisClient } from '../../src/shared/redis';
import { createScanQueue } from '../../src/shared/queue';
import { PostgresAdapter } from '../../src/shared/pg-adapter';
import { generateRepoToken } from '../../src/shared/token';
import type { ServerConfig } from '../../src/shared/types';
import { POSTGRES_AVAILABLE, REDIS_AVAILABLE } from '../infra-guard';

// Test config
const TEST_WEBHOOK_SECRET = 'test-webhook-secret-for-integration-tests';
const TEST_API_SECRET = 'a'.repeat(64);
const DB_URL = 'postgres://docalign:docalign@localhost:5432/docalign_dev';
const REDIS_URL = 'redis://localhost:6379';

function signPayload(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe.skipIf(!POSTGRES_AVAILABLE || !REDIS_AVAILABLE)('E1 Integration: End-to-End Endpoint Sweep', () => {
  let app: Application;
  let server: Server;
  let db: DatabaseClient;
  let redis: Redis;
  let scanQueue: Queue;
  let storage: PostgresAdapter;
  let baseUrl: string;
  let repoId: string;
  let tokenValue: string;

  beforeAll(async () => {
    db = createDatabaseClient(DB_URL);
    redis = createRedisClient(REDIS_URL);
    scanQueue = createScanQueue(redis);
    storage = new PostgresAdapter(db);

    const config: ServerConfig = {
      port: 0,
      node_env: 'test',
      log_level: 'error',
      database_url: DB_URL,
      redis_url: REDIS_URL,
      github_app_id: '12345',
      github_private_key: 'test-key',
      github_webhook_secret: TEST_WEBHOOK_SECRET,
      github_webhook_secret_old: undefined,
      docalign_api_secret: TEST_API_SECRET,
    };

    app = createApp({ redis, scanQueue, db, config, storage });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // Clean up test data from prior runs
    await db.query("DELETE FROM agent_tasks WHERE repo_id IN (SELECT id FROM repos WHERE github_repo = 'test-integration-repo')");
    await db.query("DELETE FROM scan_runs WHERE repo_id IN (SELECT id FROM repos WHERE github_repo = 'test-integration-repo')");
    await db.query("DELETE FROM repos WHERE github_repo = 'test-integration-repo'");
  });

  afterAll(async () => {
    if (repoId) {
      await db.query('DELETE FROM agent_tasks WHERE repo_id = $1', [repoId]);
      await db.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
      await db.query('DELETE FROM repos WHERE id = $1', [repoId]);
    }

    server?.close();
    await scanQueue.close();
    await new Promise<void>((resolve) => {
      redis.on('end', resolve);
      redis.disconnect();
    });
    await db.end();
  });

  // === Health Endpoint ===

  it('GET /health returns 200 with status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('uptime_seconds');
    expect(body).toHaveProperty('redis');
    expect(body).toHaveProperty('queue_depth');
  });

  // === Webhook Endpoint ===

  it('POST /webhook with valid signature returns 200', async () => {
    const payload = JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 1,
        head: { sha: 'abc123', ref: 'feature-branch' },
        base: { ref: 'main' },
      },
      repository: {
        full_name: 'test-owner/test-repo',
        default_branch: 'main',
      },
      installation: { id: 999 },
    });

    const signature = signPayload(payload, TEST_WEBHOOK_SECRET);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': crypto.randomUUID(),
      },
      body: payload,
    });

    expect(res.status).toBe(200);
  });

  it('POST /webhook with invalid signature returns 401', async () => {
    const payload = JSON.stringify({ action: 'opened' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=invalid',
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': crypto.randomUUID(),
      },
      body: payload,
    });

    expect(res.status).toBe(401);
  });

  // === Repo creation via installation webhook ===

  it('POST /webhook installation.created creates repo record', async () => {
    const payload = JSON.stringify({
      action: 'created',
      installation: {
        id: 99999,
        account: { login: 'test-owner' },
      },
      repositories: [
        { full_name: 'test-owner/test-integration-repo', default_branch: 'main' },
      ],
    });

    const signature = signPayload(payload, TEST_WEBHOOK_SECRET);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'installation',
        'X-GitHub-Delivery': crypto.randomUUID(),
      },
      body: payload,
    });

    expect(res.status).toBe(200);

    // Verify repo was created
    const result = await db.query(
      "SELECT * FROM repos WHERE github_owner = 'test-owner' AND github_repo = 'test-integration-repo'",
    );
    expect(result.rows.length).toBe(1);
    repoId = result.rows[0].id;
  });

  // === Token generation + Auth ===

  it('generates a DOCALIGN_TOKEN for the repo', async () => {
    expect(repoId).toBeDefined();

    const { token, hash } = generateRepoToken();
    tokenValue = token;

    await storage.updateRepo(repoId, { token_hash: hash });

    const repo = await storage.getRepoById(repoId);
    expect(repo?.token_hash).toBe(hash);
  });

  // === Agent Task API ===

  it('GET /api/tasks/pending returns empty list initially', async () => {
    expect(repoId).toBeDefined();
    expect(tokenValue).toBeDefined();

    const res = await fetch(`${baseUrl}/api/tasks/pending?repo_id=${repoId}`, {
      headers: { Authorization: `Bearer ${tokenValue}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([]);
  });

  it('full task lifecycle: create → claim → submit result', async () => {
    expect(repoId).toBeDefined();
    expect(tokenValue).toBeDefined();

    // 1. Create a scan run and task directly in DB
    const scanRun = await storage.createScanRun({
      repo_id: repoId,
      trigger_type: 'pr',
      commit_sha: 'abc123def',
    });

    const task = await storage.createAgentTask({
      repo_id: repoId,
      scan_run_id: scanRun.id,
      type: 'verification',
      payload: { claim_id: 'test-claim-1' },
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    // 2. GET /api/tasks/pending should show the task
    const pendingRes = await fetch(`${baseUrl}/api/tasks/pending?repo_id=${repoId}`, {
      headers: { Authorization: `Bearer ${tokenValue}` },
    });

    expect(pendingRes.status).toBe(200);
    const pendingBody = await pendingRes.json();
    expect(pendingBody.tasks.length).toBe(1);
    expect(pendingBody.tasks[0].id).toBe(task.id);

    // 3. GET /api/tasks/:id claims the task
    const claimRes = await fetch(
      `${baseUrl}/api/tasks/${task.id}?repo_id=${repoId}&action_run_id=test-run-123`,
      { headers: { Authorization: `Bearer ${tokenValue}` } },
    );

    expect(claimRes.status).toBe(200);
    const claimBody = await claimRes.json();
    expect(claimBody.status).toBe('in_progress');
    expect(claimBody.claimed_by).toBe('test-run-123');

    // 4. POST /api/tasks/:id/result submits the result
    const resultRes = await fetch(`${baseUrl}/api/tasks/${task.id}/result?repo_id=${repoId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        data: {
          type: 'verification',
          verdict: 'verified',
          confidence: 0.95,
          reasoning: 'The claim is accurate',
        },
        metadata: {
          duration_ms: 1500,
          model_used: 'claude-sonnet-4-20250514',
          tokens_used: 500,
        },
      }),
    });

    expect(resultRes.status).toBe(200);
    const resultBody = await resultRes.json();
    expect(resultBody.status).toBe('accepted');
    expect(resultBody.task_id).toBe(task.id);

    // 5. Verify task is now completed in DB
    const completed = await storage.getAgentTaskById(task.id);
    expect(completed?.status).toBe('completed');
  });

  // === Auth errors ===

  it('GET /api/tasks/pending without token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/pending?repo_id=some-repo`);
    expect(res.status).toBe(401);
  });

  it('GET /api/tasks/pending without repo_id returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/pending`, {
      headers: { Authorization: `Bearer ${tokenValue}` },
    });
    expect(res.status).toBe(400);
  });

  // === Dismiss Endpoint ===

  it('GET /api/dismiss without token returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/dismiss`);
    expect(res.status).toBe(400);
  });
});
