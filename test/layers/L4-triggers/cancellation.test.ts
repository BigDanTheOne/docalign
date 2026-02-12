import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { isCancelled, clearCancellationKey } from '../../../src/layers/L4-triggers/cancellation';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('cancellation', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe('isCancelled', () => {
    it('returns false when no cancel key exists', async () => {
      expect(await isCancelled(redis, 'nonexistent-job')).toBe(false);
    });

    it('returns true when cancel key exists', async () => {
      await redis.set('cancel:test-job-1', '1', 'EX', 60);
      expect(await isCancelled(redis, 'test-job-1')).toBe(true);
      await redis.del('cancel:test-job-1');
    });
  });

  describe('clearCancellationKey', () => {
    it('removes the cancel key', async () => {
      await redis.set('cancel:test-job-2', '1', 'EX', 60);
      expect(await redis.exists('cancel:test-job-2')).toBe(1);

      await clearCancellationKey(redis, 'test-job-2');
      expect(await redis.exists('cancel:test-job-2')).toBe(0);
    });

    it('does not throw for non-existent key', async () => {
      await clearCancellationKey(redis, 'nonexistent-clear');
    });
  });
});
