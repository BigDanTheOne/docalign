/**
 * QA Acceptance Tests — T5: Triggers Webhook Handler Tests
 *
 * These tests verify that dedicated unit test files exist and cover
 * the required scenarios for pr-webhook, push-webhook, and webhook-verify.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

const testRoot = resolve(__dirname, '../../../../layers/L4-triggers');

describe('QA: Webhook handler test files exist', () => {
  it('pr-webhook.test.ts exists', () => {
    expect(existsSync(resolve(testRoot, 'pr-webhook.test.ts'))).toBe(true);
  });

  it('push-webhook.test.ts exists', () => {
    expect(existsSync(resolve(testRoot, 'push-webhook.test.ts'))).toBe(true);
  });

  it('webhook-verify.test.ts exists', () => {
    expect(existsSync(resolve(testRoot, 'webhook-verify.test.ts'))).toBe(true);
  });
});

describe('QA: pr-webhook handler unit coverage', () => {
  it('handlePRWebhook returns scan_enqueued when repo exists', async () => {
    const { handlePRWebhook } = await import(
      '../../../../../src/layers/L4-triggers/pr-webhook'
    );
    const mockStorage = {
      getRepoByOwnerAndName: async () => ({ id: 'repo-1' }),
    };
    const mockTriggerService = {
      enqueuePRScan: async () => 'scan-123',
    };
    const payload = {
      action: 'opened',
      number: 42,
      pull_request: { head: { sha: 'abc123' } },
      repository: { owner: { login: 'test-owner' }, name: 'test-repo' },
      installation: { id: 999 },
    };
    const result = await handlePRWebhook(payload as any, 'delivery-1', {
      storage: mockStorage as any,
      triggerService: mockTriggerService as any,
    });
    expect(result.status).toBe(200);
    expect(result.body.scan_enqueued).toBe(true);
  });

  it('handlePRWebhook returns received:true when no deps', async () => {
    const { handlePRWebhook } = await import(
      '../../../../../src/layers/L4-triggers/pr-webhook'
    );
    const payload = {
      action: 'opened',
      number: 1,
      pull_request: { head: { sha: 'x' } },
      repository: { owner: { login: 'o' }, name: 'r' },
      installation: { id: 1 },
    };
    const result = await handlePRWebhook(payload as any, 'delivery-2');
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(true);
  });
});

describe('QA: push-webhook handler unit coverage', () => {
  it('handlePushWebhook returns 200 stub response', async () => {
    const { handlePushWebhook } = await import(
      '../../../../../src/layers/L4-triggers/push-webhook'
    );
    const payload = { ref: 'refs/heads/main' };
    const result = await handlePushWebhook(payload as any, 'delivery-3');
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(true);
  });
});

describe('QA: webhook-verify unit coverage', () => {
  it('verifyWebhookSignature validates correct signature', async () => {
    const crypto = await import('crypto');
    const { verifyWebhookSignature } = await import(
      '../../../../../src/layers/L4-triggers/webhook-verify'
    );
    const body = Buffer.from('{"test":true}');
    const secret = 'my-secret';
    const sig =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('verifyWebhookSignature rejects wrong signature', async () => {
    const { verifyWebhookSignature } = await import(
      '../../../../../src/layers/L4-triggers/webhook-verify'
    );
    const body = Buffer.from('{"test":true}');
    expect(verifyWebhookSignature(body, 'sha256=invalid', 'secret')).toBe(
      false,
    );
  });
});
