import type Redis from 'ioredis';
import logger from '../../shared/logger';

/**
 * Check if a scan has been cancelled via Redis key.
 * TDD-4 Appendix B.1.
 */
export async function isCancelled(redis: Redis, jobId: string): Promise<boolean> {
  try {
    return (await redis.exists(`cancel:${jobId}`)) === 1;
  } catch (err) {
    logger.warn({ jobId, err }, 'Failed to check cancellation key');
    return false;
  }
}

/**
 * Clear the cancellation key after processing.
 */
export async function clearCancellationKey(redis: Redis, jobId: string): Promise<void> {
  try {
    await redis.del(`cancel:${jobId}`);
  } catch {
    // Best-effort cleanup
  }
}
