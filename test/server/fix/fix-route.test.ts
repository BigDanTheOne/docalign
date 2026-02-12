import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFixRoute, type FixRouteDeps } from '../../../src/routes/fix';
import { generateFixToken } from '../../../src/server/fix/hmac';

const API_SECRET = 'test-secret-key';
const REPO_ID = 'repo-123';
const SCAN_RUN_ID = 'scan-456';
const PR_NUMBER = 42;

function makeDeps(overrides: Partial<FixRouteDeps> = {}): FixRouteDeps {
  return {
    db: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn(),
    },
    apiSecret: API_SECRET,
    getGitHubClient: vi.fn().mockResolvedValue({
      createBlob: vi.fn().mockResolvedValue({ sha: 'blob-sha' }),
      createTree: vi.fn().mockResolvedValue({ sha: 'tree-sha' }),
      createCommit: vi.fn().mockResolvedValue({ sha: 'commit-sha-abc123' }),
      updateRef: vi.fn(),
      getRef: vi.fn().mockResolvedValue({ sha: 'base-sha' }),
    }),
    getPRState: vi.fn().mockResolvedValue('open'),
    getPRBranch: vi.fn().mockResolvedValue('feature-branch'),
    getFileContent: vi.fn().mockResolvedValue('Some file content'),
    postComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createTestApp(deps: FixRouteDeps) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/api/fix', createFixRoute(deps));
  return app;
}

describe('Fix Route - GET /api/fix/apply', () => {
  let token: string;

  beforeEach(() => {
    token = generateFixToken(API_SECRET, REPO_ID, PR_NUMBER, SCAN_RUN_ID);
  });

  it('returns 400 for missing query params', async () => {
    const deps = makeDeps();
    const app = createTestApp(deps);

    const res = await request(app).get('/api/fix/apply');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Missing required');
  });

  it('returns 403 for invalid HMAC', async () => {
    const deps = makeDeps();
    const app = createTestApp(deps);

    const res = await request(app)
      .get('/api/fix/apply')
      .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token: 'invalid', pr_number: PR_NUMBER });
    expect(res.status).toBe(403);
    expect(res.text).toContain('Invalid or expired');
  });

  it('returns 404 when repo not found', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        end: vi.fn(),
      },
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .get('/api/fix/apply')
      .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });
    expect(res.status).toBe(404);
    expect(res.text).toContain('Repository not found');
  });

  it('returns 400 when PR is closed', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: SCAN_RUN_ID }] })
          .mockResolvedValueOnce({ rows: [] }),
        end: vi.fn(),
      },
      getPRState: vi.fn().mockResolvedValue('closed'),
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .get('/api/fix/apply')
      .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });
    expect(res.status).toBe(400);
    expect(res.text).toContain('no longer open');
  });

  it('returns 404 when no fixes available', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: SCAN_RUN_ID }] })
          .mockResolvedValueOnce({ rows: [] }),
        end: vi.fn(),
      },
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .get('/api/fix/apply')
      .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });
    expect(res.status).toBe(404);
    expect(res.text).toContain('No Fixes');
  });

  it('returns confirmation page with security headers', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: SCAN_RUN_ID }] })
          .mockResolvedValueOnce({
            rows: [{
              file: 'README.md', line_start: 45, line_end: 45,
              old_text: 'bcrypt', new_text: 'argon2', reason: 'drift', claim_id: 'c1', confidence: 0.9,
            }],
          }),
        end: vi.fn(),
      },
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .get('/api/fix/apply')
      .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });

    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.text).toContain('Confirm');
    expect(res.text).toContain('README.md');
    expect(res.text).toContain('#42');
    expect(res.text).toContain('acme/app');
  });
});

describe('Fix Route - POST /api/fix/apply', () => {
  let token: string;

  beforeEach(() => {
    token = generateFixToken(API_SECRET, REPO_ID, PR_NUMBER, SCAN_RUN_ID);
  });

  it('returns 400 for missing body fields', async () => {
    const deps = makeDeps();
    const app = createTestApp(deps);

    const res = await request(app).post('/api/fix/apply').send({});
    expect(res.status).toBe(400);
  });

  it('returns 403 for invalid HMAC', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ trigger_ref: String(PR_NUMBER) }] }),
        end: vi.fn(),
      },
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .post('/api/fix/apply')
      .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token: 'invalid' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when PR is closed between GET and POST', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ trigger_ref: String(PR_NUMBER) }] }),
        end: vi.fn(),
      },
      getPRState: vi.fn().mockResolvedValue('merged'),
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .post('/api/fix/apply')
      .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no longer open');
  });

  it('applies fixes and returns success', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ trigger_ref: String(PR_NUMBER) }] })
          .mockResolvedValueOnce({
            rows: [{
              file: 'README.md', line_start: 45, line_end: 45,
              old_text: 'Uses bcrypt', new_text: 'Uses argon2id',
              reason: 'drift', claim_id: 'c1', confidence: 0.9,
            }],
          }),
        end: vi.fn(),
      },
      getFileContent: vi.fn().mockResolvedValue('# Auth\nUses bcrypt for hashing.'),
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .post('/api/fix/apply')
      .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('all_applied');
    expect(res.body.applied).toBe(1);
    expect(res.body.commit_sha).toBeDefined();
    expect(deps.postComment).toHaveBeenCalled();
  });

  it('returns no_fixes_applied when all fixes fail', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ trigger_ref: String(PR_NUMBER) }] })
          .mockResolvedValueOnce({
            rows: [{
              file: 'README.md', line_start: 45, line_end: 45,
              old_text: 'Text not in file', new_text: 'New text',
              reason: 'drift', claim_id: 'c1', confidence: 0.9,
            }],
          }),
        end: vi.fn(),
      },
      getFileContent: vi.fn().mockResolvedValue('Completely different content'),
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .post('/api/fix/apply')
      .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_fixes_applied');
    expect(res.body.applied).toBe(0);
    expect(res.body.failed).toBe(1);
  });

  it('returns 422 on fast-forward failure', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ github_owner: 'acme', github_repo: 'app', github_installation_id: 1 }] })
          .mockResolvedValueOnce({ rows: [{ trigger_ref: String(PR_NUMBER) }] })
          .mockResolvedValueOnce({
            rows: [{
              file: 'README.md', line_start: 45, line_end: 45,
              old_text: 'old text', new_text: 'new text',
              reason: 'drift', claim_id: 'c1', confidence: 0.9,
            }],
          }),
        end: vi.fn(),
      },
      getFileContent: vi.fn().mockResolvedValue('Some old text here'),
      getGitHubClient: vi.fn().mockResolvedValue({
        createBlob: vi.fn().mockResolvedValue({ sha: 'blob-sha' }),
        createTree: vi.fn().mockResolvedValue({ sha: 'tree-sha' }),
        createCommit: vi.fn().mockResolvedValue({ sha: 'commit-sha' }),
        updateRef: vi.fn().mockRejectedValue(Object.assign(new Error('Not fast-forward'), { status: 422 })),
        getRef: vi.fn().mockResolvedValue({ sha: 'base-sha' }),
      }),
    });
    const app = createTestApp(deps);

    const res = await request(app)
      .post('/api/fix/apply')
      .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('retry');
  });
});
