import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createHealthRoute } from '../../src/routes/health';
import { createRedisClient } from '../../src/shared/redis';
import { createScanQueue } from '../../src/shared/queue';
import type { HealthResponse } from '../../src/shared/types';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import type { Server } from 'http';
import { POSTGRES_AVAILABLE, REDIS_AVAILABLE } from '../infra-guard';

const TEST_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe.skipIf(!POSTGRES_AVAILABLE || !REDIS_AVAILABLE)('GET /health', () => {
  let redis: Redis;
  let queue: Queue;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    redis = createRedisClient(TEST_REDIS_URL);
    queue = createScanQueue(redis);

    const app = express();
    app.get('/health', createHealthRoute(redis, queue, Date.now()));

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
    await queue.close();
    redis.disconnect();
  });

  it('returns 200 with ok status when Redis is up', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body: HealthResponse = await res.json();
    expect(body.status).toBe('ok');
    expect(body.redis).toBe(true);
    expect(typeof body.queue_depth).toBe('number');
    expect(typeof body.active_jobs).toBe('number');
    expect(typeof body.waiting_jobs).toBe('number');
    expect(typeof body.uptime_seconds).toBe('number');
  });

  it('reports uptime_seconds that increases over time', async () => {
    const res1 = await fetch(`${baseUrl}/health`);
    const body1: HealthResponse = await res1.json();

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res2 = await fetch(`${baseUrl}/health`);
    const body2: HealthResponse = await res2.json();

    expect(body2.uptime_seconds).toBeGreaterThanOrEqual(body1.uptime_seconds);
  });
});

describe('GET /health (Redis down)', () => {
  it('returns 503 with degraded status when Redis is unreachable', async () => {
    const failingRedis = {
      ping: () => Promise.reject(new Error('Connection refused')),
    } as unknown as Redis;

    const failingQueue = {
      getJobCounts: () => Promise.resolve({ waiting: 0, active: 0 }),
    } as unknown as Queue;

    const app = express();
    app.get('/health', createHealthRoute(failingRedis, failingQueue, Date.now()));

    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(503);

      const body: HealthResponse = await res.json();
      expect(body.status).toBe('degraded');
      expect(body.redis).toBe(false);
      expect(body.queue_depth).toBe(0);
      expect(body.active_jobs).toBe(0);
      expect(body.waiting_jobs).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
