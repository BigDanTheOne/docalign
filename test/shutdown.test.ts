import { describe, it, expect } from 'vitest';
import express from 'express';
import { gracefulShutdown } from '../src/shutdown';
import { createRedisClient } from '../src/shared/redis';
import { createScanQueue } from '../src/shared/queue';
import { createDatabaseClient } from '../src/shared/db';
import type { Server } from 'http';
import { POSTGRES_AVAILABLE, REDIS_AVAILABLE } from './infra-guard';

const TEST_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_DB_URL =
  process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';

describe.skipIf(!POSTGRES_AVAILABLE || !REDIS_AVAILABLE)('Graceful Shutdown', () => {
  it('stops accepting new HTTP requests after shutdown', async () => {
    const redis = createRedisClient(TEST_REDIS_URL);
    const queue = createScanQueue(redis);
    const db = createDatabaseClient(TEST_DB_URL);

    const app = express();
    app.get('/test', (_req, res) => res.json({ ok: true }));

    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    // Verify server works before shutdown
    const res = await fetch(`http://localhost:${port}/test`);
    expect(res.status).toBe(200);

    // Shutdown
    await gracefulShutdown({ server, scanQueue: queue, redis, db });

    // Server should no longer accept connections
    await expect(fetch(`http://localhost:${port}/test`)).rejects.toThrow();
  });

  it('closes Redis and DB connections', async () => {
    const redis = createRedisClient(TEST_REDIS_URL);
    const queue = createScanQueue(redis);
    const db = createDatabaseClient(TEST_DB_URL);

    const app = express();
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    // Verify connections work before shutdown
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
    const dbResult = await db.query<{ result: number }>('SELECT 1 as result');
    expect(dbResult.rows[0].result).toBe(1);

    await gracefulShutdown({ server, scanQueue: queue, redis, db });

    // Redis should be fully disconnected
    expect(redis.status).toBe('end');

    // DB should be closed (query should fail)
    await expect(db.query('SELECT 1')).rejects.toThrow();
  });

  it('completes shutdown within reasonable time', async () => {
    const redis = createRedisClient(TEST_REDIS_URL);
    const queue = createScanQueue(redis);
    const db = createDatabaseClient(TEST_DB_URL);

    const app = express();
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    const start = Date.now();
    await gracefulShutdown({ server, scanQueue: queue, redis, db });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
