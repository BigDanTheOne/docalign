import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFixRoute, type FixRouteDeps } from '../../../src/routes/fix';
import { generateFixToken } from '../../../src/server/fix/hmac';

/**
 * IE-04: Fix-Commit Integration Test
 *
 * End-to-end scenarios for the two-phase fix workflow:
 * GET /api/fix/apply → confirmation page → POST /api/fix/apply → commit
 *
 * Gates validated: GATE42-019, GATE42-022, GATE42-023, GATE42-025,
 *                  GATE42-028, GATE42-029, GATE42-031, GATE42-036
 */

const API_SECRET = 'ie04-test-secret';
const REPO_ID = 'repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b';
const SCAN_RUN_ID = 'scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4';
const PR_NUMBER = 47;
const OWNER = 'amara-dev';
const REPO = 'taskflow';
const INSTALLATION_ID = 55001;
const BRANCH = 'fix/update-pagination';

const REPO_ROW = { github_owner: OWNER, github_repo: REPO, github_installation_id: INSTALLATION_ID };

// Two standard drifted findings from the IE-04 spec
const FIX_1 = {
  file: 'README.md',
  line_start: 45,
  line_end: 45,
  old_text: 'This project uses express@4.18.2 for the HTTP server.',
  new_text: 'This project uses express@4.19.0 for the HTTP server.',
  reason: 'package.json shows express@4.19.0, not 4.18.2',
  claim_id: 'c-ver-001',
  confidence: 1.0,
};

const FIX_2 = {
  file: 'docs/api.md',
  line_start: 201,
  line_end: 201,
  old_text: 'API returns 20 items per page by default.',
  new_text: 'API returns 25 items per page by default.',
  reason: 'src/api/middleware/pagination.ts sets DEFAULT_PAGE_SIZE = 25',
  claim_id: 'c-pag-002',
  confidence: 0.95,
};

// File contents at current branch HEAD
const README_CONTENT = `# Taskflow\n\nA task management app.\n\n${'filler line\n'.repeat(40)}This project uses express@4.18.2 for the HTTP server.\n\nMore docs below.`;
const API_MD_CONTENT = `# API Reference\n\n${'filler line\n'.repeat(196)}API returns 20 items per page by default.\n\nMore content.`;

/** DB mock for GET flow: repo → scan_run(id) → verification_results */
function makeGetDb(fixes = [FIX_1, FIX_2]) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [REPO_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: SCAN_RUN_ID }] })
      .mockResolvedValueOnce({ rows: fixes }),
    end: vi.fn(),
  };
}

/** DB mock for POST flow: repo → scan_run(trigger_ref) → verification_results */
function makePostDb(fixes = [FIX_1, FIX_2]) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [REPO_ROW] })
      .mockResolvedValueOnce({ rows: [{ trigger_ref: String(PR_NUMBER) }] })
      .mockResolvedValueOnce({ rows: fixes }),
    end: vi.fn(),
  };
}

function makeGitHubClient() {
  return {
    createBlob: vi.fn().mockResolvedValue({ sha: 'blob-sha-1' }),
    createTree: vi.fn().mockResolvedValue({ sha: 'tree-sha-1' }),
    createCommit: vi.fn().mockResolvedValue({ sha: 'c3d4e5f6a7b8c9d0' }),
    updateRef: vi.fn().mockResolvedValue(undefined),
    getRef: vi.fn().mockResolvedValue({ sha: 'base-commit-sha' }),
  };
}

function defaultFileContent(_owner: string, _repo: string, filePath: string) {
  if (filePath === 'README.md') return Promise.resolve(README_CONTENT);
  if (filePath === 'docs/api.md') return Promise.resolve(API_MD_CONTENT);
  return Promise.resolve(null);
}

function makeDeps(overrides: Partial<FixRouteDeps> = {}): FixRouteDeps {
  return {
    db: makeGetDb(),
    apiSecret: API_SECRET,
    getGitHubClient: vi.fn().mockResolvedValue(makeGitHubClient()),
    getPRState: vi.fn().mockResolvedValue('open'),
    getPRBranch: vi.fn().mockResolvedValue(BRANCH),
    getFileContent: vi.fn().mockImplementation(defaultFileContent),
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

describe('IE-04: Fix-Commit Integration', () => {
  let token: string;

  beforeEach(() => {
    token = generateFixToken(API_SECRET, REPO_ID, PR_NUMBER, SCAN_RUN_ID);
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario A: Full success — 2 fixes applied, success comment
  // GATE42-022, GATE42-023, GATE42-029
  // ─────────────────────────────────────────────────────────────
  describe('Scenario A: Full Success (2 fixes)', () => {
    it('GET returns confirmation page with 2 fixes and security headers', async () => {
      const deps = makeDeps({ db: makeGetDb() });
      const app = createTestApp(deps);

      const res = await request(app)
        .get('/api/fix/apply')
        .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });

      expect(res.status).toBe(200);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.text).toContain('2 fixes');
      expect(res.text).toContain('#47');
      expect(res.text).toContain(`${OWNER}/${REPO}`);
      expect(res.text).toContain('README.md');
      expect(res.text).toContain('docs/api.md');
      expect(res.text).toContain('method="POST"');
      expect(res.text).toContain('action="/api/fix/apply"');
    });

    it('POST applies both fixes and returns commit SHA', async () => {
      const deps = makeDeps({ db: makePostDb() });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('all_applied');
      expect(res.body.applied).toBe(2);
      expect(res.body.failed).toBe(0);
      expect(res.body.commit_sha).toBeDefined();
    });

    it('creates commit with docalign[bot] author (GATE42-023)', async () => {
      const ghClient = makeGitHubClient();
      const deps = makeDeps({
        db: makePostDb(),
        getGitHubClient: vi.fn().mockResolvedValue(ghClient),
      });
      const app = createTestApp(deps);

      await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(ghClient.createCommit).toHaveBeenCalledWith(
        OWNER, REPO,
        expect.stringContaining('docs: fix 2 documentation drifts'),
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ name: 'docalign[bot]' }),
      );
    });

    it('posts success comment to PR', async () => {
      const deps = makeDeps({ db: makePostDb() });
      const app = createTestApp(deps);

      await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(deps.postComment).toHaveBeenCalledWith(
        OWNER, REPO, PR_NUMBER,
        expect.stringContaining('Applied 2 fix'),
        INSTALLATION_ID,
      );
      const commentBody = (deps.postComment as ReturnType<typeof vi.fn>).mock.calls[0][3];
      expect(commentBody).toContain('c3d4e5f');
      expect(commentBody).toContain('README.md');
      expect(commentBody).toContain('docs/api.md');
    });

    it('uses force: false on ref update (GATE42-023)', async () => {
      const ghClient = makeGitHubClient();
      const deps = makeDeps({
        db: makePostDb(),
        getGitHubClient: vi.fn().mockResolvedValue(ghClient),
      });
      const app = createTestApp(deps);

      await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(ghClient.updateRef).toHaveBeenCalledWith(
        OWNER, REPO, `heads/${BRANCH}`,
        expect.any(String), false,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario B: Partial success — 1 applied, 1 failed
  // ─────────────────────────────────────────────────────────────
  describe('Scenario B: Partial Success (1 applied, 1 failed)', () => {
    it('applies one fix, reports partial status with breakdown', async () => {
      const deps = makeDeps({
        db: makePostDb(),
        getFileContent: vi.fn().mockImplementation(
          (_owner: string, _repo: string, filePath: string) => {
            if (filePath === 'README.md') return Promise.resolve(README_CONTENT);
            if (filePath === 'docs/api.md') return Promise.resolve('# API Reference\n\nAPI uses cursor-based pagination.\n');
            return Promise.resolve(null);
          },
        ),
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('partial');
      expect(res.body.applied).toBe(1);
      expect(res.body.failed).toBe(1);
      expect(res.body.commit_sha).toBeDefined();
    });

    it('posts partial success comment with applied and failed lists', async () => {
      const deps = makeDeps({
        db: makePostDb(),
        getFileContent: vi.fn().mockImplementation(
          (_owner: string, _repo: string, filePath: string) => {
            if (filePath === 'README.md') return Promise.resolve(README_CONTENT);
            if (filePath === 'docs/api.md') return Promise.resolve('# API Reference\n\nAPI uses cursor-based pagination.\n');
            return Promise.resolve(null);
          },
        ),
      });
      const app = createTestApp(deps);

      await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(deps.postComment).toHaveBeenCalled();
      const commentBody = (deps.postComment as ReturnType<typeof vi.fn>).mock.calls[0][3];
      expect(commentBody).toContain('Partially applied');
      expect(commentBody).toContain('README.md');
      expect(commentBody).toContain('docs/api.md');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario C: Full failure — no commit created
  // ─────────────────────────────────────────────────────────────
  describe('Scenario C: Full Failure (no commit)', () => {
    it('creates no commit when all fixes fail', async () => {
      const deps = makeDeps({
        db: makePostDb(),
        getFileContent: vi.fn().mockResolvedValue('Completely rewritten file with no matching text'),
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('no_fixes_applied');
      expect(res.body.applied).toBe(0);
      expect(res.body.failed).toBe(2);

      // CRITICAL: No commit should be created
      expect(deps.getGitHubClient).not.toHaveBeenCalled();
    });

    it('posts failure comment when all fixes fail', async () => {
      const deps = makeDeps({
        db: makePostDb(),
        getFileContent: vi.fn().mockResolvedValue('Completely rewritten file with no matching text'),
      });
      const app = createTestApp(deps);

      await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(deps.postComment).toHaveBeenCalledWith(
        OWNER, REPO, PR_NUMBER,
        expect.stringContaining('Could not apply fixes'),
        INSTALLATION_ID,
      );
      const commentBody = (deps.postComment as ReturnType<typeof vi.fn>).mock.calls[0][3];
      expect(commentBody).toContain('2 fix(es) failed');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario D: PR is closed — GATE42-028
  // ─────────────────────────────────────────────────────────────
  describe('Scenario D: PR Closed (GATE42-028)', () => {
    it('GET returns 400 when PR is merged', async () => {
      const deps = makeDeps({
        db: makeGetDb(),
        getPRState: vi.fn().mockResolvedValue('merged'),
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get('/api/fix/apply')
        .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });

      expect(res.status).toBe(400);
      expect(res.text).toContain('no longer open');
    });

    it('POST returns 400 when PR is closed', async () => {
      const deps = makeDeps({
        db: makePostDb(),
        getPRState: vi.fn().mockResolvedValue('closed'),
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('no longer open');
    });

    it('does not create any commit when PR is closed', async () => {
      const deps = makeDeps({
        db: makePostDb(),
        getPRState: vi.fn().mockResolvedValue('closed'),
      });
      const app = createTestApp(deps);

      await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(deps.getGitHubClient).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario E: Double-click idempotency — GATE42-031
  // ─────────────────────────────────────────────────────────────
  describe('Scenario E: Double-Click Idempotency (GATE42-031)', () => {
    it('second POST fails all fixes because old_text was already replaced', async () => {
      const contentAfterFix = new Map<string, string>([
        ['README.md', README_CONTENT.replace(FIX_1.old_text, FIX_1.new_text)],
        ['docs/api.md', API_MD_CONTENT.replace(FIX_2.old_text, FIX_2.new_text)],
      ]);

      const deps = makeDeps({
        db: makePostDb(),
        getFileContent: vi.fn().mockImplementation(
          (_owner: string, _repo: string, filePath: string) => {
            return Promise.resolve(contentAfterFix.get(filePath) ?? null);
          },
        ),
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('no_fixes_applied');
      expect(res.body.applied).toBe(0);
      expect(res.body.failed).toBe(2);

      // No commit on double-click
      expect(deps.getGitHubClient).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GATE42-036: Zero fixes → no confirmation page
  // ─────────────────────────────────────────────────────────────
  describe('GATE42-036: Zero Fixes', () => {
    it('GET returns 404 when no fixes exist for the scan', async () => {
      const deps = makeDeps({ db: makeGetDb([]) });
      const app = createTestApp(deps);

      const res = await request(app)
        .get('/api/fix/apply')
        .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });

      expect(res.status).toBe(404);
      expect(res.text).toContain('No Fixes');
    });

    it('POST returns 400 when no fixes exist', async () => {
      const deps = makeDeps({ db: makePostDb([]) });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No applicable fixes');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // $-Pattern Safety — replacement must not interpret $1, $&, etc.
  // ─────────────────────────────────────────────────────────────
  describe('$-Pattern Safety', () => {
    it('correctly applies fix with $-patterns in new_text', async () => {
      const dollarFix = {
        file: 'README.md',
        line_start: 10,
        line_end: 10,
        old_text: 'Costs around fifty dollars',
        new_text: 'Costs $100 (see $& for details, use $$ or $1 and $\' suffix)',
        reason: 'Price updated',
        claim_id: 'c-dollar',
        confidence: 0.9,
      };

      const fileContent = '# Pricing\n\nCosts around fifty dollars per month.\n';
      const ghClient = makeGitHubClient();

      const deps = makeDeps({
        db: makePostDb([dollarFix]),
        getFileContent: vi.fn().mockResolvedValue(fileContent),
        getGitHubClient: vi.fn().mockResolvedValue(ghClient),
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('all_applied');
      expect(res.body.applied).toBe(1);

      // Verify the blob content contains the literal $-patterns
      expect(ghClient.createBlob).toHaveBeenCalledTimes(1);

      // Decode the base64 content passed to createBlob
      const blobCall = ghClient.createBlob.mock.calls[0];
      const blobContent = Buffer.from(blobCall[2], 'base64').toString('utf-8');
      expect(blobContent).toContain('$100');
      expect(blobContent).toContain('$&');
      expect(blobContent).toContain('$$');
      expect(blobContent).toContain('$1');
      expect(blobContent).toContain("$'");
      // Ensure old text is gone
      expect(blobContent).not.toContain('fifty dollars');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // HMAC-only auth — GATE42-025
  // ─────────────────────────────────────────────────────────────
  describe('GATE42-025: HMAC-only Auth', () => {
    it('GET rejects invalid token', async () => {
      const deps = makeDeps({ db: makeGetDb() });
      const app = createTestApp(deps);

      const res = await request(app)
        .get('/api/fix/apply')
        .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token: 'tampered.token', pr_number: PR_NUMBER });

      expect(res.status).toBe(403);
      expect(res.text).toContain('Invalid or expired');
    });

    it('POST rejects token from different scan_run_id', async () => {
      const wrongToken = generateFixToken(API_SECRET, REPO_ID, PR_NUMBER, 'different-scan-id');
      const deps = makeDeps({ db: makePostDb() });
      const app = createTestApp(deps);

      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token: wrongToken });

      expect(res.status).toBe(403);
    });

    it('no Bearer token required — works with HMAC alone', async () => {
      const deps = makeDeps({ db: makePostDb() });
      const app = createTestApp(deps);

      // No Authorization header set — HMAC is the only auth
      const res = await request(app)
        .post('/api/fix/apply')
        .send({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token });

      expect(res.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Fast-forward failure (422) — concurrent push
  // ─────────────────────────────────────────────────────────────
  describe('Fast-Forward Failure', () => {
    it('returns 422 when branch was updated concurrently', async () => {
      const deps = makeDeps({
        db: makePostDb(),
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

  // ─────────────────────────────────────────────────────────────
  // Two-phase flow — GATE42-029
  // GET does not mutate, POST does
  // ─────────────────────────────────────────────────────────────
  describe('GATE42-029: Two-Phase Flow', () => {
    it('GET does not create any commit or post any comment', async () => {
      const deps = makeDeps({ db: makeGetDb() });
      const app = createTestApp(deps);

      await request(app)
        .get('/api/fix/apply')
        .query({ repo: REPO_ID, scan_run_id: SCAN_RUN_ID, token, pr_number: PR_NUMBER });

      expect(deps.getGitHubClient).not.toHaveBeenCalled();
      expect(deps.postComment).not.toHaveBeenCalled();
      expect(deps.getPRBranch).not.toHaveBeenCalled();
    });
  });
});
