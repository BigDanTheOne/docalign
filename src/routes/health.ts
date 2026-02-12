import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import type { HealthResponse } from '../shared/types';

export function createHealthRoute(redis: Redis, scanQueue: Queue, startTime: number) {
  return async (_req: Request, res: Response): Promise<void> => {
    let redisOk = false;
    try {
      const pong = await Promise.race([
        redis.ping(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('Redis ping timeout')), 2000),
        ),
      ]);
      redisOk = pong === 'PONG';
    } catch {
      redisOk = false;
    }

    let activeJobs = 0;
    let waitingJobs = 0;
    if (redisOk) {
      try {
        const counts = await scanQueue.getJobCounts('waiting', 'active');
        activeJobs = counts.active;
        waitingJobs = counts.waiting;
      } catch {
        // Queue count failure implies Redis issues
      }
    }

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const status = redisOk ? 'ok' : 'degraded';

    const response: HealthResponse = {
      status,
      redis: redisOk,
      queue_depth: activeJobs + waitingJobs,
      active_jobs: activeJobs,
      waiting_jobs: waitingJobs,
      uptime_seconds: uptimeSeconds,
    };

    res.status(redisOk ? 200 : 503).json(response);
  };
}
