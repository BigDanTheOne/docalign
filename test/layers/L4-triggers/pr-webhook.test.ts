import { describe, it, expect, vi } from 'vitest';
import { handlePRWebhook } from '../../../src/layers/L4-triggers/pr-webhook';
import type { PRWebhookPayload } from '../../../src/shared/types';
import type { StorageAdapter } from '../../../src/shared/storage-adapter';
import type { TriggerService } from '../../../src/layers/L4-triggers/trigger-service';

describe('handlePRWebhook', () => {
  const createBasicPayload = (): PRWebhookPayload => ({
    action: 'opened',
    number: 42,
    pull_request: { head: { sha: 'abc123' } },
    repository: {
      owner: { login: 'test-owner' },
      name: 'test-repo',
    },
    installation: { id: 999 },
  });

  describe('happy path', () => {
    it('returns scan_enqueued when repo exists and scan is enqueued', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-123'),
      };
      const payload = createBasicPayload();
      const result = await handlePRWebhook(payload, 'delivery-1', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.scan_enqueued).toBe(true);
      expect(result.body.scan_run_id).toBe('scan-123');
      expect(result.body.received).toBe(true);
      expect(mockStorage.getRepoByOwnerAndName).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
      );
      expect(mockTriggerService.enqueuePRScan).toHaveBeenCalledWith(
        'repo-1',
        42,
        'abc123',
        999,
        'delivery-1',
      );
    });

    it('returns received:true when no deps provided', async () => {
      const payload = createBasicPayload();
      const result = await handlePRWebhook(payload, 'delivery-2');

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBeUndefined();
    });

    it('returns received:true when storage provided but no triggerService', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const payload = createBasicPayload();
      const result = await handlePRWebhook(payload, 'delivery-3', {
        storage: mockStorage as StorageAdapter,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBeUndefined();
      expect(mockStorage.getRepoByOwnerAndName).not.toHaveBeenCalled();
    });
  });

  describe('edge cases: missing repository data', () => {
    it('returns received:true when repository.owner.login is missing', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-123'),
      };
      const payload = {
        ...createBasicPayload(),
        repository: {
          owner: { login: undefined as unknown as string },
          name: 'test-repo',
        },
      };

      const result = await handlePRWebhook(payload, 'delivery-missing-owner', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBeUndefined();
      expect(mockStorage.getRepoByOwnerAndName).not.toHaveBeenCalled();
      expect(mockTriggerService.enqueuePRScan).not.toHaveBeenCalled();
    });

    it('returns received:true when repository.name is missing', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-123'),
      };
      const payload = {
        ...createBasicPayload(),
        repository: {
          owner: { login: 'test-owner' },
          name: undefined as unknown as string,
        },
      };

      const result = await handlePRWebhook(payload, 'delivery-missing-name', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBeUndefined();
      expect(mockStorage.getRepoByOwnerAndName).not.toHaveBeenCalled();
      expect(mockTriggerService.enqueuePRScan).not.toHaveBeenCalled();
    });

    it('returns received:true when both owner and name are missing', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-123'),
      };
      const payload = {
        ...createBasicPayload(),
        repository: {
          owner: { login: undefined as unknown as string },
          name: undefined as unknown as string,
        },
      };

      const result = await handlePRWebhook(payload, 'delivery-missing-both', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBeUndefined();
      expect(mockStorage.getRepoByOwnerAndName).not.toHaveBeenCalled();
      expect(mockTriggerService.enqueuePRScan).not.toHaveBeenCalled();
    });
  });

  describe('edge case: repo not found', () => {
    it('returns scan_enqueued:false when repo does not exist', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => null),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-123'),
      };
      const payload = createBasicPayload();

      const result = await handlePRWebhook(payload, 'delivery-no-repo', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBe(false);
      expect(mockStorage.getRepoByOwnerAndName).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
      );
      expect(mockTriggerService.enqueuePRScan).not.toHaveBeenCalled();
    });
  });

  describe('edge case: enqueuePRScan throws', () => {
    it('returns scan_enqueued:false when enqueuePRScan throws an error', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => {
          throw new Error('Queue service unavailable');
        }),
      };
      const payload = createBasicPayload();

      const result = await handlePRWebhook(payload, 'delivery-enqueue-error', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBe(false);
      expect(mockStorage.getRepoByOwnerAndName).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
      );
      expect(mockTriggerService.enqueuePRScan).toHaveBeenCalledWith(
        'repo-1',
        42,
        'abc123',
        999,
        'delivery-enqueue-error',
      );
    });

    it('returns scan_enqueued:false when enqueuePRScan rejects', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () =>
          Promise.reject(new Error('Redis connection failed')),
        ),
      };
      const payload = createBasicPayload();

      const result = await handlePRWebhook(payload, 'delivery-enqueue-reject', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.received).toBe(true);
      expect(result.body.scan_enqueued).toBe(false);
    });
  });

  describe('different PR actions', () => {
    it('handles synchronize action', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-456'),
      };
      const payload = {
        ...createBasicPayload(),
        action: 'synchronize' as const,
      };

      const result = await handlePRWebhook(payload, 'delivery-sync', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.scan_enqueued).toBe(true);
      expect(result.body.scan_run_id).toBe('scan-456');
    });

    it('handles reopened action', async () => {
      const mockStorage: Partial<StorageAdapter> = {
        getRepoByOwnerAndName: vi.fn(async () => ({ id: 'repo-1' })),
      };
      const mockTriggerService: Partial<TriggerService> = {
        enqueuePRScan: vi.fn(async () => 'scan-789'),
      };
      const payload = {
        ...createBasicPayload(),
        action: 'reopened' as const,
      };

      const result = await handlePRWebhook(payload, 'delivery-reopen', {
        storage: mockStorage as StorageAdapter,
        triggerService: mockTriggerService as TriggerService,
      });

      expect(result.status).toBe(200);
      expect(result.body.scan_enqueued).toBe(true);
      expect(result.body.scan_run_id).toBe('scan-789');
    });
  });
});
