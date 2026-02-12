import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Claim, ScanStatus } from '../../shared/types';
import type { MapperService } from '../L2-mapper';
import { createScanRun, updateScanStatus, getScanRun } from './scan-store';
import { deduplicateClaims } from './prioritize';
import logger from '../../shared/logger';

export interface PRScanJobData {
  scanRunId: string;
  repoId: string;
  prNumber: number;
  headSha: string;
  installationId: number;
}

export interface FullScanJobData {
  scanRunId: string;
  repoId: string;
  installationId: number;
}

export interface TriggerService {
  enqueuePRScan(repoId: string, prNumber: number, headSha: string, installationId: number, deliveryId: string): Promise<string>;
  enqueueFullScan(repoId: string, installationId: number): Promise<string>;
  cancelScan(scanRunId: string): Promise<void>;
  updateScanStatus(scanRunId: string, status: ScanStatus, stats?: Record<string, unknown>): Promise<void>;
  resolveScope(repoId: string, changedCodeFiles: string[], docClaims: Claim[], mapper: MapperService): Promise<Claim[]>;
}

/**
 * Create the L4 trigger service.
 * TDD-4 Sections 4.1, 4.3, 4.4, 4.5, 4.6.
 */
export function createTriggerService(
  pool: Pool,
  queue: Queue,
  redis: Redis,
): TriggerService {
  return {
    /**
     * Enqueue a PR scan.
     * TDD-4 Section 4.1.
     *
     * - Creates a scan_runs record
     * - Enqueues a BullMQ job with dedup (pr-scan-{repoId}-{prNumber})
     * - If existing active job, sets cancel key in Redis
     */
    async enqueuePRScan(repoId, prNumber, headSha, installationId, deliveryId) {
      // Check rate limit (simplified: just check recent scans)
      const recentScans = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM scan_runs
         WHERE repo_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
        [repoId],
      );
      if (recentScans.rows[0].cnt >= 100) {
        throw new Error('Rate limit exceeded: 100 scans per day per repo');
      }

      const scanRun = await createScanRun(pool, {
        repoId,
        triggerType: 'pr',
        triggerRef: String(prNumber),
        commitSha: headSha,
      });

      const jobId = `pr-scan-${repoId}-${prNumber}`;

      // Check for existing active job - cancel it
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          await redis.set(`cancel:${jobId}`, '1', 'EX', 600);
          logger.info({ deliveryId, jobId, state }, 'Cancelling existing job for PR');
        }
      }

      const jobData: PRScanJobData = {
        scanRunId: scanRun.id,
        repoId,
        prNumber,
        headSha,
        installationId,
      };

      await queue.add('pr-scan', jobData, {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      logger.info({ deliveryId, scanRunId: scanRun.id, prNumber }, 'PR scan enqueued');
      return scanRun.id;
    },

    /**
     * Enqueue a full repository scan.
     * TDD-4 Section 4.3.
     */
    async enqueueFullScan(repoId, installationId) {
      const scanRun = await createScanRun(pool, {
        repoId,
        triggerType: 'scheduled',
        triggerRef: null,
        commitSha: 'HEAD',
      });

      const jobId = `full-scan-${repoId}-${Date.now()}`;

      const jobData: FullScanJobData = {
        scanRunId: scanRun.id,
        repoId,
        installationId,
      };

      await queue.add('full-scan', jobData, {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      logger.info({ scanRunId: scanRun.id, repoId }, 'Full scan enqueued');
      return scanRun.id;
    },

    /**
     * Cancel a scan run.
     * TDD-4 Section 4.5.
     */
    async cancelScan(scanRunId) {
      const scanRun = await getScanRun(pool, scanRunId);
      if (!scanRun) return;

      if (scanRun.status === 'queued') {
        // Just update status directly
        await updateScanStatus(pool, scanRunId, 'cancelled');
        return;
      }

      if (scanRun.status === 'running') {
        // Set cancel flag in Redis for the worker to pick up
        // We need to find the BullMQ job ID to set the cancel key
        const jobPrefix = scanRun.trigger_type === 'pr'
          ? `pr-scan-${scanRun.repo_id}-${scanRun.trigger_ref}`
          : `full-scan-${scanRun.repo_id}`;

        await redis.set(`cancel:${jobPrefix}`, '1', 'EX', 600);
        logger.info({ scanRunId }, 'Cancel flag set for running scan');
        return;
      }

      // Already completed/failed/cancelled - no-op
    },

    /**
     * Update scan status.
     */
    async updateScanStatus(scanRunId, status, stats) {
      await updateScanStatus(pool, scanRunId, status, stats);
    },

    /**
     * Resolve scope: find all claims affected by changed files.
     * TDD-4 Section 4.4.
     *
     * 1. docClaims: claims from changed doc files (provided by L1)
     * 2. Reverse lookup: claims mapped to changed code files (via L2)
     * 3. Deduplicate by claim ID
     */
    async resolveScope(repoId, changedCodeFiles, docClaims, mapper) {
      const allClaims = [...docClaims];

      // Reverse lookup: find claims mapped to changed code files
      if (changedCodeFiles.length > 0) {
        const mappings = await mapper.findClaimsByCodeFiles(repoId, changedCodeFiles);
        if (mappings.length > 0) {
          const claimIds = [...new Set(mappings.map((m) => m.claim_id))];
          for (const claimId of claimIds) {
            const claimResult = await pool.query('SELECT * FROM claims WHERE id = $1', [claimId]);
            if (claimResult.rows.length > 0) {
              allClaims.push(claimResult.rows[0] as Claim);
            }
          }
        }
      }

      return deduplicateClaims(allClaims);
    },
  };
}
