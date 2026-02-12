import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import {
  createDismissRoute,
  generateDismissToken,
  validateDismissToken,
} from '../../src/routes/dismiss';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import type { Server } from 'http';

const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';
const TEST_API_SECRET = 'test-api-secret-for-dismiss';

let db: DatabaseClient;
let server: Server;
let baseUrl: string;
let repoId: string;

beforeAll(async () => {
  db = createDatabaseClient(TEST_DB_URL);

  // Create repo
  const repoResult = await db.query<{ id: string }>(
    `INSERT INTO repos (github_owner, github_repo, github_installation_id, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    ['dismiss-owner', 'dismiss-repo', 66666, 'active'],
  );
  repoId = repoResult.rows[0].id;

  const app = express();
  app.use('/api/dismiss', createDismissRoute({ db, apiSecret: TEST_API_SECRET }));

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
  // Clean up (feedback table might not exist)
  try {
    await db.query('DELETE FROM feedback WHERE repo_id = $1', [repoId]);
  } catch {
    // feedback table might not exist yet
  }
  await db.query('DELETE FROM repos WHERE id = $1', [repoId]);
  await db.end();
});

describe('HMAC dismiss token', () => {
  it('generateDismissToken produces deterministic token format', () => {
    const token = generateDismissToken(TEST_API_SECRET, repoId, 42, 'scan-run-1');
    expect(token).toMatch(/^\d+\.[a-f0-9]{64}$/);
  });

  it('validateDismissToken returns true for valid token', () => {
    const token = generateDismissToken(TEST_API_SECRET, repoId, 42, 'scan-run-1');
    const valid = validateDismissToken(token, TEST_API_SECRET, repoId, 42, 'scan-run-1');
    expect(valid).toBe(true);
  });

  it('validateDismissToken returns false for wrong secret', () => {
    const token = generateDismissToken(TEST_API_SECRET, repoId, 42, 'scan-run-1');
    const valid = validateDismissToken(token, 'wrong-secret', repoId, 42, 'scan-run-1');
    expect(valid).toBe(false);
  });

  it('validateDismissToken returns false for expired token (>7 days)', () => {
    // Manually create a token with old timestamp
    const oldTimestamp = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const data = `${repoId}:42:scan-run-1:${oldTimestamp}`;
    const hmac = crypto.createHmac('sha256', TEST_API_SECRET).update(data).digest('hex');
    const expiredToken = `${oldTimestamp}.${hmac}`;

    const valid = validateDismissToken(expiredToken, TEST_API_SECRET, repoId, 42, 'scan-run-1');
    expect(valid).toBe(false);
  });
});

describe('GET /api/dismiss', () => {
  it('valid HMAC token + valid params redirects (302) to GitHub PR URL', async () => {
    const scanRunId = 'scan-run-test';
    const claimId = '00000000-0000-0000-0000-000000000001';
    const token = generateDismissToken(TEST_API_SECRET, repoId, 42, scanRunId);

    const res = await fetch(
      `${baseUrl}/api/dismiss?token=${encodeURIComponent(token)}&claim_id=${claimId}&scan_run_id=${scanRunId}&repo_id=${repoId}&pr_number=42`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://github.com/dismiss-owner/dismiss-repo/pull/42',
    );
  });

  it('invalid HMAC returns 400', async () => {
    const res = await fetch(
      `${baseUrl}/api/dismiss?token=12345.abcdef&claim_id=claim-1&scan_run_id=scan-1&repo_id=${repoId}&pr_number=42`,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('dismiss token');
  });

  it('missing repo returns 404', async () => {
    const fakeRepoId = '00000000-0000-0000-0000-999999999999';
    const token = generateDismissToken(TEST_API_SECRET, fakeRepoId, 42, 'scan-1');

    const res = await fetch(
      `${baseUrl}/api/dismiss?token=${encodeURIComponent(token)}&claim_id=claim-1&scan_run_id=scan-1&repo_id=${fakeRepoId}&pr_number=42`,
    );
    expect(res.status).toBe(404);
  });
});
