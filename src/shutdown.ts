import type { Server } from 'http';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { DatabaseClient } from './shared/db';
import logger from './shared/logger';

export interface ShutdownDependencies {
  server: Server;
  scanQueue: Queue;
  redis: Redis;
  db: DatabaseClient;
}

export async function gracefulShutdown(deps: ShutdownDependencies): Promise<void> {
  logger.info('Graceful shutdown initiated');

  // 1. Stop accepting new HTTP requests
  await new Promise<void>((resolve) => {
    deps.server.close(() => {
      logger.info('HTTP server closed');
      resolve();
    });
  });

  // 2. Close BullMQ queue (waits for in-progress jobs)
  try {
    await deps.scanQueue.close();
    logger.info('BullMQ queue closed');
  } catch (err) {
    logger.error({ err }, 'Error closing BullMQ queue');
  }

  // 3. Disconnect Redis gracefully; tolerate already-closed race during shutdown
  try {
    try {
      await deps.redis.quit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'Connection is closed.') {
        throw err;
      }
    }

    await new Promise<void>((resolve) => {
      const onEnd = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        deps.redis.off('end', onEnd);
        resolve();
      }, 300);
      deps.redis.once('end', onEnd);
      deps.redis.disconnect();
    });

    logger.info('Redis disconnected');
  } catch (err) {
    logger.error({ err }, 'Error disconnecting Redis');
  }

  // 4. Close database pool
  try {
    await deps.db.end();
    logger.info('Database pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database pool');
  }

  logger.info('Shutdown complete');
}

export function setupGracefulShutdown(deps: ShutdownDependencies): void {
  let shuttingDown = false;

  const handler = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await gracefulShutdown(deps);
    process.exit(0);
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}
