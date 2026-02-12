import express, { type Application } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import logger from './shared/logger';
import { createHealthRoute } from './routes/health';
import { errorHandler } from './middleware/error-handler';
import { loadConfig } from './config/defaults';
import { createDatabaseClient } from './shared/db';
import { createRedisClient } from './shared/redis';
import { createScanQueue } from './shared/queue';
import { setupGracefulShutdown } from './shutdown';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';

export interface AppDependencies {
  redis: Redis;
  scanQueue: Queue;
}

export function createApp(deps: AppDependencies): Application {
  const app = express();
  const startTime = Date.now();

  // Security headers
  app.set('trust proxy', true);
  app.use(helmet());

  // Request logging
  app.use(pinoHttp({ logger }));

  // Health endpoint (no auth, no body parsing)
  app.get('/health', createHealthRoute(deps.redis, deps.scanQueue, startTime));

  // JSON body parsing for API routes
  app.use('/api', express.json({ limit: '1mb' }));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

// --- Server startup (only when run directly) ---

if (require.main === module) {
  const config = loadConfig();
  const db = createDatabaseClient(config.database_url);
  const redis = createRedisClient(config.redis_url);
  const scanQueue = createScanQueue(redis);

  const app = createApp({ redis, scanQueue });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.node_env }, 'DocAlign server started');
  });

  setupGracefulShutdown({ server, scanQueue, redis, db });
}
