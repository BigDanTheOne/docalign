import { Queue } from 'bullmq';
import type Redis from 'ioredis';

export const SCAN_QUEUE_NAME = 'docalign-scan';

export function createScanQueue(connection: Redis): Queue {
  return new Queue(SCAN_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });
}
