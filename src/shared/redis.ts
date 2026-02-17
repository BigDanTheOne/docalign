import Redis from 'ioredis';
import logger from './logger';

export function createRedisClient(url: string): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
  });

  redis.on('error', (err) => {
    // Expected during shutdown when commands race with disconnect/quit
    if (err.message === 'Connection is closed.') {
      return;
    }
    logger.error({ err }, 'Redis connection error');
  });

  return redis;
}
