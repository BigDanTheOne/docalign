import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import { createWebhookRoute } from '../../src/routes/webhook';
import type { StorageAdapter } from '../../src/shared/storage-adapter';
import type { RepoRow } from '../../src/shared/types';
import type { Server } from 'http';

const TEST_SECRET = 'test-webhook-secret-1234';
const TEST_SECRET_OLD = 'old-webhook-secret-5678';

function signPayload(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeHeaders(
  body: string,
  secret: string,
  event = 'ping',
  deliveryId = 'test-delivery-1',
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': signPayload(body, secret),
    'x-github-event': event,
    'x-github-delivery': deliveryId,
  };
}

// Minimal mock storage adapter
function createMockStorage(): StorageAdapter & { repos: RepoRow[] } {
  const repos: RepoRow[] = [];
  return {
    repos,
    async createRepo(data) {
      const repo: RepoRow = {
        id: crypto.randomUUID(),
        github_owner: data.github_owner,
        github_repo: data.github_repo,
        github_installation_id: data.github_installation_id,
        default_branch: data.default_branch ?? 'main',
        status: data.status ?? 'onboarding',
        last_indexed_commit: null,
        last_full_scan_at: null,
        config: data.config ?? {},
        health_score: null,
        total_claims: 0,
        verified_claims: 0,
        token_hash: data.token_hash ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      repos.push(repo);
      return repo;
    },
    async getRepoById() {
      return null;
    },
    async updateRepo() {
      return null;
    },
    async deleteRepo() {
      return false;
    },
    async createScanRun() {
      throw new Error('Not implemented');
    },
    async getScanRunById() {
      return null;
    },
    async updateScanRun() {
      return null;
    },
    async deleteScanRun() {
      return false;
    },
    async createAgentTask() {
      throw new Error('Not implemented');
    },
    async getAgentTaskById() {
      return null;
    },
    async updateAgentTask() {
      return null;
    },
    async deleteAgentTask() {
      return false;
    },
  };
}

let server: Server;
let baseUrl: string;
let mockStorage: ReturnType<typeof createMockStorage>;

beforeAll(async () => {
  mockStorage = createMockStorage();
  const app = express();
  app.use(
    '/webhook',
    createWebhookRoute({
      webhookSecret: TEST_SECRET,
      webhookSecretOld: TEST_SECRET_OLD,
      storage: mockStorage,
    }),
  );

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
});

describe('POST /webhook — Signature Verification (E1-07)', () => {
  it('valid signature returns 200', async () => {
    const body = JSON.stringify({ action: 'ping' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('invalid signature returns 401', async () => {
    const body = JSON.stringify({ action: 'ping' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        'x-github-event': 'ping',
        'x-github-delivery': 'test-delivery-2',
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('missing headers return 401', async () => {
    const body = JSON.stringify({ action: 'ping' });
    // Missing x-hub-signature-256
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'ping',
        'x-github-delivery': 'test-delivery-3',
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('dual-secret rotation accepts old secret', async () => {
    const body = JSON.stringify({ action: 'ping' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET_OLD),
      body,
    });
    expect(res.status).toBe(200);
  });

  it('wrong content-type returns 415', async () => {
    const body = JSON.stringify({ action: 'ping' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-hub-signature-256': signPayload(body, TEST_SECRET),
        'x-github-event': 'ping',
        'x-github-delivery': 'test-delivery-4',
      },
      body,
    });
    expect(res.status).toBe(415);
  });

  it('unrecognized event returns 200 with received:true', async () => {
    const body = JSON.stringify({ action: 'test' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'unknown_event'),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});

describe('POST /webhook — Event Routing (E1-08)', () => {
  it('pull_request.opened routes to PR handler stub', async () => {
    const body = JSON.stringify({
      action: 'opened',
      number: 42,
      pull_request: { head: { sha: 'abc123', ref: 'feature' }, base: { ref: 'main' } },
      repository: { id: 1, full_name: 'acme/app', owner: { login: 'acme' }, name: 'app' },
      installation: { id: 100 },
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'pull_request'),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('push to default branch routes to push handler stub', async () => {
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      after: 'sha-after',
      before: 'sha-before',
      commits: [],
      repository: { id: 1, full_name: 'acme/app', default_branch: 'main' },
      installation: { id: 100 },
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'push'),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('push to non-default branch returns 200 with no processing', async () => {
    const body = JSON.stringify({
      ref: 'refs/heads/feature-branch',
      after: 'sha-after',
      before: 'sha-before',
      commits: [],
      repository: { id: 1, full_name: 'acme/app', default_branch: 'main' },
      installation: { id: 100 },
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'push'),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('installation.created creates repo records in DB', async () => {
    const reposBefore = mockStorage.repos.length;
    const body = JSON.stringify({
      action: 'created',
      installation: { id: 200, account: { login: 'testorg', type: 'Organization' } },
      repositories: [
        { id: 1001, full_name: 'testorg/repo-a', private: false },
        { id: 1002, full_name: 'testorg/repo-b', private: true },
      ],
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'installation'),
      body,
    });
    expect(res.status).toBe(200);
    expect(mockStorage.repos.length).toBe(reposBefore + 2);
    expect(mockStorage.repos.find((r) => r.github_repo === 'repo-a')).toBeDefined();
    expect(mockStorage.repos.find((r) => r.github_repo === 'repo-b')).toBeDefined();
  });

  it('installation.deleted returns 200', async () => {
    const body = JSON.stringify({
      action: 'deleted',
      installation: { id: 200, account: { login: 'testorg', type: 'Organization' } },
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'installation'),
      body,
    });
    expect(res.status).toBe(200);
  });

  it('pull_request.closed returns 200 with no scan', async () => {
    const body = JSON.stringify({
      action: 'closed',
      number: 43,
      pull_request: { head: { sha: 'abc123', ref: 'feature' }, base: { ref: 'main' } },
      repository: { id: 1, full_name: 'acme/app', owner: { login: 'acme' }, name: 'app' },
      installation: { id: 100 },
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'pull_request'),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('issue_comment.created with @docalign review acknowledges', async () => {
    const body = JSON.stringify({
      action: 'created',
      comment: { body: 'Please @docalign review this PR' },
      issue: { number: 44, pull_request: {} },
      repository: { id: 1, full_name: 'acme/app' },
      installation: { id: 100 },
    });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: makeHeaders(body, TEST_SECRET, 'issue_comment'),
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});
