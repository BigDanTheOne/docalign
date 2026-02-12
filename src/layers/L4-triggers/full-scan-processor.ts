import type { Pool } from 'pg';
import type { Job } from 'bullmq';
import type { FullScanJobData } from './trigger-service';
import { updateScanStatus } from './scan-store';
import logger from '../../shared/logger';

/**
 * Process a full repository scan job (stub).
 * TDD-4 Section 4.9.
 *
 * For MVP, transitions through lifecycle without doing real work.
 * Full implementation deferred to post-MVP.
 */
export async function processFullScan(
  job: Job<FullScanJobData>,
  pool: Pool,
): Promise<void> {
  const { scanRunId, repoId } = job.data;
  const startTime = Date.now();

  try {
    // Transition to running
    await updateScanStatus(pool, scanRunId, 'running');

    // Stub: full scan implementation deferred
    logger.info({ scanRunId, repoId }, 'Full scan stub - completing immediately');

    const duration = Date.now() - startTime;
    await updateScanStatus(pool, scanRunId, 'completed', {
      total_duration_ms: duration,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    await updateScanStatus(pool, scanRunId, 'failed', {
      total_duration_ms: duration,
    }).catch(() => {});
    logger.error({ scanRunId, repoId, err }, 'Full scan failed');
    throw err;
  }
}
