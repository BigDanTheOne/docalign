import { describe, it, expect, vi } from 'vitest';
import { isCancelled, clearCancellationKey } from '../../../src/layers/L4-triggers/cancellation';
import type Redis from 'ioredis';

function mockRedis(overrides: Record<string, unknown> = {}): Redis {
  return {
    exists: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    ...overrides,
  } as unknown as Redis;
}

describe('cancellation – edge cases', () => {
  it('isCancelled returns false for non-existent scan', async () => {
    const redis = mockRedis({ exists: vi.fn().mockResolvedValue(0) });
    const result = await isCancelled(redis, 'nonexistent-job-id');
    expect(result).toBe(false);
    expect(redis.exists).toHaveBeenCalledWith('cancel:nonexistent-job-id');
  });

  it('clearCancellationKey is idempotent (double clear does not throw)', async () => {
    const redis = mockRedis({ del: vi.fn().mockResolvedValue(0) }); // 0 = key didn't exist
    await expect(clearCancellationKey(redis, 'already-cleared')).resolves.not.toThrow();
    await expect(clearCancellationKey(redis, 'already-cleared')).resolves.not.toThrow();
  });

  it('isCancelled handles Redis error gracefully', async () => {
    const redis = mockRedis({ exists: vi.fn().mockRejectedValue(new Error('connection lost')) });
    const result = await isCancelled(redis, 'some-job');
    expect(result).toBe(false); // Should return false on error, not throw
  });
});
