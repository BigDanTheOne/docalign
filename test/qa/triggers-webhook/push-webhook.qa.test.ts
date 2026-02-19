import { describe, it, expect } from 'vitest';
import { handlePushWebhook } from '../../../src/layers/L4-triggers/push-webhook';
import type { PushWebhookPayload } from '../../../src/shared/types';

function makePayload(overrides: Partial<PushWebhookPayload> = {}): PushWebhookPayload {
  return {
    ref: 'refs/heads/main',
    after: 'abc123',
    before: 'def456',
    commits: [{ id: 'abc123', added: [], removed: [], modified: ['README.md'] }],
    repository: { id: 1, full_name: 'org/repo', default_branch: 'main' },
    installation: { id: 100 },
    ...overrides,
  };
}

describe('handlePushWebhook', () => {
  it('returns 200 with received=true (stub)', async () => {
    const result = await handlePushWebhook(makePayload(), 'del-1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
  });

  it('handles different refs', async () => {
    const result = await handlePushWebhook(makePayload({ ref: 'refs/heads/feature/x' }), 'del-2');
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(true);
  });
});
