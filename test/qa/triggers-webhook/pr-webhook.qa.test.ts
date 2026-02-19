import { describe, it, expect, vi } from 'vitest';
import { handlePRWebhook } from '../../../src/layers/L4-triggers/pr-webhook';
import type { PRWebhookPayload } from '../../../src/shared/types';
import type { StorageAdapter } from '../../../src/shared/storage-adapter';
import type { TriggerService } from '../../../src/layers/L4-triggers/trigger-service';

function makePayload(overrides: Partial<PRWebhookPayload> = {}): PRWebhookPayload {
  return {
    action: 'opened',
    number: 42,
    pull_request: { head: { sha: 'abc123', ref: 'feature/test' }, base: { ref: 'main' } },
    repository: { id: 1, full_name: 'org/repo', owner: { login: 'org' }, name: 'repo' },
    installation: { id: 100 },
    ...overrides,
  };
}

function makeDeps(repoResult: unknown = { id: 'repo-1' }, enqueueResult: string = 'scan-1') {
  return {
    storage: { getRepoByOwnerAndName: vi.fn().mockResolvedValue(repoResult) } as Partial<StorageAdapter> as StorageAdapter,
    triggerService: { enqueuePRScan: vi.fn().mockResolvedValue(enqueueResult) } as Partial<TriggerService> as TriggerService,
  };
}

describe('handlePRWebhook', () => {
  it('enqueues scan when repo found and deps provided', async () => {
    const deps = makeDeps();
    const result = await handlePRWebhook(makePayload(), 'del-1', deps);
    expect(result.status).toBe(200);
    expect(result.body.scan_enqueued).toBe(true);
    expect(result.body.scan_run_id).toBe('scan-1');
    expect(deps.storage.getRepoByOwnerAndName).toHaveBeenCalledWith('org', 'repo');
    expect(deps.triggerService.enqueuePRScan).toHaveBeenCalledWith(
      'repo-1', 42, 'abc123', 100, 'del-1',
    );
  });

  it('returns scan_enqueued=false when repo not found', async () => {
    const deps = makeDeps(null);
    const result = await handlePRWebhook(makePayload(), 'del-2', deps);
    expect(result.status).toBe(200);
    expect(result.body.scan_enqueued).toBe(false);
  });

  it('returns received=true when owner is missing', async () => {
    const payload = makePayload();
    payload.repository.owner.login = '';
    const deps = makeDeps();
    const result = await handlePRWebhook(payload, 'del-3', deps);
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(true);
  });

  it('returns received=true when no deps provided', async () => {
    const result = await handlePRWebhook(makePayload(), 'del-4');
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(true);
  });

  it('handles enqueuePRScan failure gracefully', async () => {
    const deps = makeDeps();
    deps.triggerService.enqueuePRScan.mockRejectedValue(new Error('queue down'));
    const result = await handlePRWebhook(makePayload(), 'del-5', deps);
    expect(result.status).toBe(200);
    expect(result.body.scan_enqueued).toBe(false);
  });

  it('works with synchronize action', async () => {
    const deps = makeDeps();
    const result = await handlePRWebhook(makePayload({ action: 'synchronize' }), 'del-6', deps);
    expect(result.status).toBe(200);
    expect(result.body.scan_enqueued).toBe(true);
  });
});
