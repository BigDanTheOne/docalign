import express, { type Application } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import logger from './shared/logger';
import { createHealthRoute } from './routes/health';
import { createWebhookRoute } from './routes/webhook';
import { createTaskRoutes } from './routes/tasks';
import { createDismissRoute } from './routes/dismiss';
import { createAuthMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { loadConfig } from './config/defaults';
import { createDatabaseClient, type DatabaseClient } from './shared/db';
import { createRedisClient } from './shared/redis';
import { createScanQueue } from './shared/queue';
import { setupGracefulShutdown } from './shutdown';
import type { StorageAdapter } from './shared/storage-adapter';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { ServerConfig } from './shared/types';

export interface AppDependencies {
  redis: Redis;
  scanQueue: Queue;
  db: DatabaseClient;
  config: ServerConfig;
  storage: StorageAdapter;
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

  // Webhook endpoint (raw body for signature verification, no auth middleware)
  app.use(
    '/webhook',
    createWebhookRoute({
      webhookSecret: deps.config.github_webhook_secret,
      webhookSecretOld: deps.config.github_webhook_secret_old,
      storage: deps.storage,
    }),
  );

  // Dismiss endpoint (HMAC token in query params, no Bearer auth)
  app.use(
    '/api/dismiss',
    createDismissRoute({ db: deps.db, apiSecret: deps.config.docalign_api_secret }),
  );

  // JSON body parsing for authenticated API routes
  app.use('/api', express.json({ limit: '1mb' }));

  // Authenticated API routes
  app.use('/api/tasks', createAuthMiddleware(deps.db), createTaskRoutes(deps.db));

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

  // Import PostgresAdapter dynamically to avoid circular deps at module level
  import('./shared/pg-adapter').then(({ PostgresAdapter }) => {
    const storage = new PostgresAdapter(db);
    const app = createApp({ redis, scanQueue, db, config, storage });

    const server = app.listen(config.port, () => {
      logger.info({ port: config.port, env: config.node_env }, 'DocAlign server started');
    });

    setupGracefulShutdown({ server, scanQueue, redis, db });
  });
}
