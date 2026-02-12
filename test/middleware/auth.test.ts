import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createAuthMiddleware } from '../../src/middleware/auth';
import { generateRepoToken } from '../../src/shared/token';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import type { Server } from 'http';

const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';

let db: DatabaseClient;
let server: Server;
let baseUrl: string;
let repoId: string;
let validToken: string;

beforeAll(async () => {
  db = createDatabaseClient(TEST_DB_URL);

  // Create a repo with a token
  const { token, hash } = generateRepoToken();
  validToken = token;
  const result = await db.query<{ id: string }>(
    `INSERT INTO repos (github_owner, github_repo, github_installation_id, token_hash, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['authtest-owner', 'authtest-repo', 88888, hash, 'active'],
  );
  repoId = result.rows[0].id;

  const app = express();
  app.use(express.json());
  app.get('/api/test', createAuthMiddleware(db), (req, res) => {
    res.json({ ok: true, repoId: req.repoId });
  });

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
  await db.query('DELETE FROM repos WHERE github_owner = $1', ['authtest-owner']);
  await db.end();
});

describe('auth middleware', () => {
  it('valid Bearer token passes and attaches repoId', async () => {
    const res = await fetch(`${baseUrl}/api/test?repo_id=${repoId}`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repoId).toBe(repoId);
  });

  it('missing Authorization header returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/test?repo_id=${repoId}`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('DOCALIGN_TOKEN');
  });

  it('invalid token returns 401', async () => {
    const fakeToken = 'docalign_' + 'f'.repeat(64);
    const res = await fetch(`${baseUrl}/api/test?repo_id=${repoId}`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('missing repo_id returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/test`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('repo_id');
  });

  it('repo_id mismatch returns 401', async () => {
    const res = await fetch(
      `${baseUrl}/api/test?repo_id=00000000-0000-0000-0000-000000000000`,
      { headers: { Authorization: `Bearer ${validToken}` } },
    );
    expect(res.status).toBe(401);
  });
});
