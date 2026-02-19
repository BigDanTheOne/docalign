import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processPRScan } from '../../../src/layers/L4-triggers/pr-scan-processor';
import type { PRScanDependencies } from '../../../src/layers/L4-triggers/pr-scan-processor';
import type { Job } from 'bullmq';
import type { PRScanJobData } from '../../../src/layers/L4-triggers/trigger-service';

describe('pr-scan-processor – edge cases', () => {
  let mockDeps: PRScanDependencies;
  let mockJob: Job<PRScanJobData>;

  beforeEach(() => {
    // Set up minimal mocks
    mockDeps = {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as PRScanDependencies['pool'],
      redis: {} as unknown as PRScanDependencies['redis'],
      codebaseIndex: {} as unknown as PRScanDependencies['codebaseIndex'],
      mapper: {} as unknown as PRScanDependencies['mapper'],
      verifier: {} as unknown as PRScanDependencies['verifier'],
      learning: {} as unknown as PRScanDependencies['learning'],
      fetchPRFiles: vi.fn().mockResolvedValue([]),
      getFileContent: vi.fn().mockResolvedValue(null),
      createCheckRun: vi.fn().mockResolvedValue(null),
      updateCheckRun: vi.fn(),
    };

    mockJob = {
      id: 'test-job-123',
      data: {
        scanRunId: 'scan-123',
        repoId: 'repo-1',
        prNumber: 42,
        headSha: 'abc123',
        installationId: 1,
      },
    } as Job<PRScanJobData>;
  });

  it('handles missing head SHA gracefully', async () => {
    // The processor requires head_sha in the job data.
    // If it's missing (empty string), the processor should still execute
    // but may fail when trying to create check runs or fetch content.

    const jobWithoutSha = {
      ...mockJob,
      data: {
        ...mockJob.data,
        headSha: '', // Empty string simulates missing SHA
      },
    };

    // The processor should handle this without unhandled rejection.
    // It will proceed but may skip certain operations.
    await expect(
      processPRScan(jobWithoutSha, mockDeps)
    ).resolves.not.toThrow();

    // Verify scan status was updated (even if processing was minimal)
    expect(mockDeps.pool.query).toHaveBeenCalled();
  });

  it('handles GitHub API failure without unhandled rejection', async () => {
    // Mock the GitHub API call to reject with a network error
    mockDeps.fetchPRFiles = vi.fn().mockRejectedValue(new Error('Network error: API unavailable'));

    // The processor should catch the error and update scan status to 'failed'
    await expect(
      processPRScan(mockJob, mockDeps)
    ).rejects.toThrow('Network error: API unavailable');

    // Verify that scan status was updated to failed
    expect(mockDeps.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scan_runs'),
      expect.arrayContaining([mockJob.data.scanRunId, 'failed'])
    );
  });
});
