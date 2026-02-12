import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type Redis from 'ioredis';
import { createRedisClient } from '../../src/shared/redis';
import { createScanQueue, SCAN_QUEUE_NAME } from '../../src/shared/queue';
import type { Queue } from 'bullmq';

const TEST_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redis: Redis;
let queue: Queue;

beforeAll(() => {
  redis = createRedisClient(TEST_REDIS_URL);
  queue = createScanQueue(redis);
});

afterEach(async () => {
  await queue.obliterate({ force: true });
});

afterAll(async () => {
  await queue.close();
  redis.disconnect();
});

describe('BullMQ Scan Queue', () => {
  it('creates queue with correct name', () => {
    expect(queue.name).toBe(SCAN_QUEUE_NAME);
    expect(queue.name).toBe('docalign-scan');
  });

  it('enqueues a job and retrieves it', async () => {
    const job = await queue.add('test-scan', { repoId: 'abc', scanType: 'pr' });
    expect(job.id).toBeDefined();
    expect(job.name).toBe('test-scan');

    const retrieved = await queue.getJob(job.id!);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.data.repoId).toBe('abc');
  });

  it('returns correct job counts', async () => {
    await queue.add('count-test-1', { repoId: '1' });
    await queue.add('count-test-2', { repoId: '2' });

    const counts = await queue.getJobCounts('waiting', 'active');
    expect(counts.waiting).toBe(2);
    expect(counts.active).toBe(0);
  });

  it('closes gracefully within timeout', async () => {
    const testQueue = createScanQueue(redis);
    await testQueue.add('close-test', { repoId: 'close' });

    const start = Date.now();
    await testQueue.close();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30_000);
  });
});
