/**
 * QA: Full PR comment pipeline integration tests.
 * Exercises: scan results → comment formatting → GitHub API posting (mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildSummaryComment,
  determineOutcome,
  determineCheckConclusion,
} from '../../../src/layers/L5-reporter/comment-formatter';
import type {
  Finding,
  PRCommentPayload,
  Claim,
  VerificationResult,
  HealthScore,
} from '../../../src/shared/types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeHealthScore(overrides: Partial<HealthScore> = {}): HealthScore {
  return {
    total_claims: 10, verified: 8, drifted: 2, uncertain: 0, pending: 0,
    score: 0.8, by_file: [], by_type: {}, hotspots: [],
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1', repo_id: 'repo-1', source_file: 'README.md', line_number: 10,
    claim_text: 'Uses express 4.x', claim_type: 'dependency_version',
    testability: 'syntactic', extracted_value: {}, keywords: [],
    extraction_confidence: 1.0, extraction_method: 'regex',
    verification_status: 'drifted', last_verified_at: null, embedding: null,
    last_verification_result_id: null, parent_claim_id: null,
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    id: 'result-1', claim_id: 'claim-1', repo_id: 'repo-1', scan_run_id: 'scan-1',
    verdict: 'drifted', confidence: 0.95, tier: 1, severity: 'high',
    reasoning: 'Version mismatch detected',
    specific_mismatch: 'Expected express 4.x but found 5.0.0',
    suggested_fix: null, evidence_files: ['package.json'], token_cost: null,
    duration_ms: null, post_check_result: null, verification_path: 1,
    created_at: new Date(),
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return { claim: makeClaim(), result: makeResult(), fix: null, suppressed: false, ...overrides };
}

function makePayload(overrides: Partial<PRCommentPayload> = {}): PRCommentPayload {
  return { findings: [], health_score: makeHealthScore(), scan_run_id: 'scan-run-abc', agent_unavailable_pct: 0, ...overrides };
}

// ── Mock GitHub API layer (mirrors post-comment.mjs logic) ──────────

interface MockGitHubState {
  comments: Array<{ id: number; body: string }>;
  apiCalls: Array<{ method: string; path: string; body?: unknown }>;
  nextError?: { status: number; message: string };
}

function createMockGitHub(): MockGitHubState & { fetch: typeof globalThis.fetch } {
  const state: MockGitHubState = { comments: [], apiCalls: [] };

  const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    state.apiCalls.push({ method, path: urlStr, body });

    if (state.nextError) {
      const err = state.nextError;
      state.nextError = undefined;
      return new Response(JSON.stringify({ message: err.message }), { status: err.status });
    }

    // GET comments (list)
    if (method === 'GET' && urlStr.includes('/comments')) {
      return new Response(JSON.stringify(state.comments), { status: 200 });
    }
    // POST comment (create)
    if (method === 'POST' && urlStr.includes('/comments')) {
      const newComment = { id: state.comments.length + 1, body: body.body };
      state.comments.push(newComment);
      return new Response(JSON.stringify(newComment), { status: 201 });
    }
    // PATCH comment (update)
    if (method === 'PATCH' && urlStr.includes('/comments/')) {
      const idMatch = urlStr.match(/comments\/(\d+)/);
      const id = idMatch ? parseInt(idMatch[1], 10) : -1;
      const existing = state.comments.find(c => c.id === id);
      if (existing) existing.body = body.body;
      return new Response(JSON.stringify(existing), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  }) as unknown as typeof globalThis.fetch;

  return { ...state, get comments() { return state.comments; }, get apiCalls() { return state.apiCalls; }, set nextError(v) { state.nextError = v; }, fetch: mockFetch };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('QA: PR comment pipeline — full integration', () => {
  describe('scan results → format → post (create flow)', () => {
    it('creates a new comment when no existing comment is found', async () => {
      const gh = createMockGitHub();
      const payload = makePayload({
        findings: [makeFinding()],
      });
      const scanRunId = 'scan-run-integration-01';
      const commentBody = buildSummaryComment(payload, scanRunId);

      // Simulate post-comment.mjs flow: search then create
      const listResp = await gh.fetch('https://api.github.com/repos/owner/repo/issues/1/comments?per_page=50', { method: 'GET' });
      const comments = await listResp.json() as Array<{ id: number; body: string }>;
      const existing = comments.find(c => c.body.includes('<!-- docalign-summary'));

      expect(existing).toBeUndefined();

      const marker = `<!-- docalign-summary scan-run-id=${scanRunId} -->`;
      expect(commentBody).toContain(marker);

      const createResp = await gh.fetch('https://api.github.com/repos/owner/repo/issues/1/comments', {
        method: 'POST',
        body: JSON.stringify({ body: commentBody }),
      });
      expect(createResp.status).toBe(201);
      expect(gh.comments).toHaveLength(1);
      expect(gh.comments[0].body).toContain('DocAlign Scan Results');
      expect(gh.comments[0].body).toContain('🔴 HIGH');
    });
  });

  describe('scan results → format → post (update flow)', () => {
    it('updates an existing comment when marker is found', async () => {
      const gh = createMockGitHub();
      const oldBody = '<!-- docalign-summary scan-run-id=old-scan -->\n## DocAlign Scan Results\nOld content';
      gh.comments.push({ id: 42, body: oldBody });

      const payload = makePayload({ findings: [makeFinding()] });
      const newBody = buildSummaryComment(payload, 'scan-run-update-01');

      // Search
      const listResp = await gh.fetch('https://api.github.com/repos/owner/repo/issues/1/comments?per_page=50', { method: 'GET' });
      const comments = await listResp.json() as Array<{ id: number; body: string }>;
      const existing = comments.find(c => c.body.includes('<!-- docalign-summary'));
      expect(existing).toBeDefined();
      expect(existing!.id).toBe(42);

      // Update
      const updateResp = await gh.fetch(`https://api.github.com/repos/owner/repo/issues/comments/${existing!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: newBody }),
      });
      expect(updateResp.status).toBe(200);
      expect(gh.comments[0].body).toContain('scan-run-update-01');
      expect(gh.comments[0].body).not.toContain('Old content');
    });
  });

  describe('zero findings edge case', () => {
    it('produces a clean no-claims comment and posts successfully', async () => {
      const gh = createMockGitHub();
      const payload = makePayload({ findings: [] });
      const body = buildSummaryComment(payload, 'scan-zero');

      expect(determineOutcome(payload)).toBe('no_claims_in_scope');
      expect(body).toContain('No documentation claims were affected');
      expect(body).not.toContain('Drifted');

      const resp = await gh.fetch('https://api.github.com/repos/owner/repo/issues/1/comments', {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      expect(resp.status).toBe(201);
    });

    it('produces all-verified when findings exist but none drifted', () => {
      const payload = makePayload({
        findings: [
          makeFinding({ result: makeResult({ verdict: 'verified' }) }),
          makeFinding({ claim: makeClaim({ id: 'c2' }), result: makeResult({ verdict: 'verified' }) }),
        ],
      });
      expect(determineOutcome(payload)).toBe('all_verified');
      const body = buildSummaryComment(payload, 'scan-verified');
      expect(body).toContain('✅ All documentation claims verified');
    });
  });
});
