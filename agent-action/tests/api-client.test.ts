import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocAlignApiClient } from '../src/api-client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('DocAlignApiClient', () => {
  let client: DocAlignApiClient;

  beforeEach(() => {
    client = new DocAlignApiClient(
      'https://api.docalign.dev',
      'docalign_testtoken',
      'repo-123',
      'run-456',
    );
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPendingTasks', () => {
    it('fetches pending tasks with auth header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: [{ id: 'task-1', type: 'verification', status: 'pending', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T01:00:00Z' }] }),
      });

      const result = await client.getPendingTasks('scan-789');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.docalign.dev/api/tasks/pending?scan_run_id=scan-789',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer docalign_testtoken',
          }),
        }),
      );
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe('task-1');
    });

    it('returns empty list when no tasks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: [] }),
      });

      const result = await client.getPendingTasks();
      expect(result.tasks).toHaveLength(0);
    });
  });

  describe('claimTask', () => {
    it('claims task with action_run_id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'task-1',
          repo_id: 'repo-123',
          scan_run_id: 'scan-1',
          type: 'verification',
          status: 'in_progress',
          payload: { type: 'verification' },
          claimed_by: 'run-456',
          error: null,
          expires_at: '2026-01-01T01:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          completed_at: null,
        }),
      });

      const task = await client.claimTask('task-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.docalign.dev/api/tasks/task-1?action_run_id=run-456',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(task.status).toBe('in_progress');
      expect(task.claimed_by).toBe('run-456');
    });

    it('throws on 409 (already claimed)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ error: 'DOCALIGN_E205', message: 'Task already completed.' }),
      });

      await expect(client.claimTask('task-1')).rejects.toEqual(
        expect.objectContaining({ status: 409, error: 'DOCALIGN_E205' }),
      );
    });

    it('throws on 410 (expired)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 410,
        statusText: 'Gone',
        json: () => Promise.resolve({ error: 'DOCALIGN_E204', message: 'Task expired.' }),
      });

      await expect(client.claimTask('task-1')).rejects.toEqual(
        expect.objectContaining({ status: 410, error: 'DOCALIGN_E204' }),
      );
    });

    it('throws on 404 (not found)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'TASK_NOT_FOUND', message: 'Task not found' }),
      });

      await expect(client.claimTask('task-999')).rejects.toEqual(
        expect.objectContaining({ status: 404 }),
      );
    });
  });

  describe('submitTaskResult', () => {
    it('submits result with correct payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'accepted', task_id: 'task-1' }),
      });

      const result = await client.submitTaskResult('task-1', {
        success: true,
        data: { type: 'verification', verdict: 'verified', confidence: 0.95, reasoning: 'Matched', evidence_files: [] },
        metadata: { duration_ms: 1500, model_used: 'claude-sonnet' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.docalign.dev/api/tasks/task-1/result',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
      expect(result.status).toBe('accepted');
    });
  });

  describe('retry on 500/503', () => {
    it('retries on 500 and succeeds on second attempt', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error', json: () => Promise.resolve({ error: 'INTERNAL_ERROR' }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) });

      const result = await client.getPendingTasks();
      expect(result.tasks).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 503 and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', json: () => Promise.resolve({ error: 'UNAVAILABLE' }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tasks: [] }) });

      const result = await client.getPendingTasks();
      expect(result.tasks).toHaveLength(0);
    });
  });
});
