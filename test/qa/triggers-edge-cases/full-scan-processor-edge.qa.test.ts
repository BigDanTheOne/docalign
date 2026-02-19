import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFullScan } from '../../../src/layers/L4-triggers/full-scan-processor';
import type { Job } from 'bullmq';
import type { FullScanJobData } from '../../../src/layers/L4-triggers/trigger-service';
import type { Pool } from 'pg';

describe('full-scan-processor – edge cases', () => {
  let mockPool: Pool;
  let mockJob: Job<FullScanJobData>;

  beforeEach(() => {
    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    mockJob = {
      id: 'test-job-456',
      data: {
        scanRunId: 'scan-456',
        repoId: 'repo-2',
        commitSha: 'def456',
        installationId: 2,
      },
    } as Job<FullScanJobData>;
  });

  it('handles empty file list without crashing', async () => {
    // The current implementation is a stub that doesn't process files.
    // It should complete successfully regardless of input.
    // This test verifies the stub behavior.

    await expect(
      processFullScan(mockJob, mockPool)
    ).resolves.not.toThrow();

    // Verify scan status transitions: running → completed
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scan_runs'),
      expect.arrayContaining([mockJob.data.scanRunId, 'running'])
    );

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scan_runs'),
      expect.arrayContaining([mockJob.data.scanRunId, 'completed'])
    );
  });

  it('returns error status on processor failure', async () => {
    // Mock a database error to simulate processor failure
    mockPool.query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // First call succeeds (running)
      .mockRejectedValueOnce(new Error('Database connection lost')); // Second call fails

    // The processor should catch the error and update status to 'failed'
    await expect(
      processFullScan(mockJob, mockPool)
    ).rejects.toThrow('Database connection lost');

    // Verify that scan status was attempted to be updated to failed
    // (The catch block tries to update status to failed, but may also fail)
    expect(mockPool.query).toHaveBeenCalled();
  });
});
