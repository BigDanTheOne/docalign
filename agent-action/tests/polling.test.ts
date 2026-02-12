import { describe, it, expect, vi } from 'vitest';
import { runPollingLoop } from '../src/polling';
import type { DocAlignApiClient, TaskDetailResponse, TaskResultPayload } from '../src/api-client';
import type { TaskProcessor, TaskResult } from '../src/task-processor';
import type { ActionConfig } from '../src/config';

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    docalignToken: 'token',
    serverUrl: 'https://api.test',
    anthropicApiKey: 'sk-test',
    openaiApiKey: null,
    scanRunId: 'scan-1',
    repoId: 'repo-1',
    maxTasks: 10,
    pollIntervalMs: 10, // fast for tests
    actionRunId: 'run-1',
    llm: { verificationModel: 'm', extractionModel: 'm', triageModel: 'm', embeddingModel: 'm', embeddingDimensions: 1536 },
    verification: { maxClaimsPerPr: 50, autoFix: false, autoFixThreshold: 0.9 },
    mapping: { path1MaxEvidenceTokens: 8000, maxAgentFilesPerClaim: 10 },
    agent: { concurrency: 5, timeoutSeconds: 120, command: undefined },
    ...overrides,
  };
}

function makeTask(id: string, type = 'verification'): TaskDetailResponse {
  return {
    id,
    repo_id: 'repo-1',
    scan_run_id: 'scan-1',
    type,
    status: 'in_progress',
    payload: { type },
    claimed_by: 'run-1',
    error: null,
    expires_at: '2026-01-01T01:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
  };
}

describe('runPollingLoop', () => {
  it('processes tasks in FIFO order', async () => {
    const processedIds: string[] = [];

    const client = {
      getPendingTasks: vi.fn()
        .mockResolvedValueOnce({
          tasks: [
            { id: 'task-1', type: 'verification', status: 'pending', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T01:00:00Z' },
            { id: 'task-2', type: 'verification', status: 'pending', created_at: '2026-01-01T00:01:00Z', expires_at: '2026-01-01T01:00:00Z' },
          ],
        })
        .mockResolvedValue({ tasks: [] }),
      claimTask: vi.fn().mockImplementation((id: string) => Promise.resolve(makeTask(id))),
      submitTaskResult: vi.fn().mockResolvedValue({ status: 'accepted', task_id: '' }),
    } as unknown as DocAlignApiClient;

    const processor: TaskProcessor = {
      processTask: vi.fn().mockImplementation(async (task: TaskDetailResponse) => {
        processedIds.push(task.id);
        return { success: true, data: { type: 'verification' } } as TaskResult;
      }),
    };

    const stats = await runPollingLoop(client, processor, makeConfig());

    expect(processedIds).toEqual(['task-1', 'task-2']);
    expect(stats.tasksProcessed).toBe(2);
    expect(stats.tasksFailed).toBe(0);
  });

  it('skips tasks that return 409/410/404 on claim', async () => {
    const client = {
      getPendingTasks: vi.fn()
        .mockResolvedValueOnce({
          tasks: [
            { id: 'task-1', type: 'verification', status: 'pending', created_at: 't', expires_at: 't' },
            { id: 'task-2', type: 'verification', status: 'pending', created_at: 't', expires_at: 't' },
          ],
        })
        .mockResolvedValue({ tasks: [] }),
      claimTask: vi.fn()
        .mockRejectedValueOnce({ status: 409, error: 'DOCALIGN_E205', message: 'Already claimed' })
        .mockResolvedValueOnce(makeTask('task-2')),
      submitTaskResult: vi.fn().mockResolvedValue({ status: 'accepted', task_id: '' }),
    } as unknown as DocAlignApiClient;

    const processor: TaskProcessor = {
      processTask: vi.fn().mockResolvedValue({ success: true, data: { type: 'verification' } }),
    };

    const stats = await runPollingLoop(client, processor, makeConfig());

    expect(stats.tasksSkipped).toBe(1);
    expect(stats.tasksProcessed).toBe(1);
  });

  it('submits failure when processor throws', async () => {
    const client = {
      getPendingTasks: vi.fn()
        .mockResolvedValueOnce({
          tasks: [{ id: 'task-1', type: 'verification', status: 'pending', created_at: 't', expires_at: 't' }],
        })
        .mockResolvedValue({ tasks: [] }),
      claimTask: vi.fn().mockResolvedValue(makeTask('task-1')),
      submitTaskResult: vi.fn().mockResolvedValue({ status: 'accepted', task_id: '' }),
    } as unknown as DocAlignApiClient;

    const processor: TaskProcessor = {
      processTask: vi.fn().mockRejectedValue(new Error('LLM failed')),
    };

    const stats = await runPollingLoop(client, processor, makeConfig());

    expect(stats.tasksFailed).toBe(1);
    expect(client.submitTaskResult).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ success: false, error: 'LLM failed' }),
    );
  });

  it('exits after maxTasks', async () => {
    const client = {
      getPendingTasks: vi.fn().mockResolvedValue({
        tasks: [
          { id: 'task-1', type: 'verification', status: 'pending', created_at: 't', expires_at: 't' },
          { id: 'task-2', type: 'verification', status: 'pending', created_at: 't', expires_at: 't' },
        ],
      }),
      claimTask: vi.fn().mockImplementation((id: string) => Promise.resolve(makeTask(id))),
      submitTaskResult: vi.fn().mockResolvedValue({ status: 'accepted', task_id: '' }),
    } as unknown as DocAlignApiClient;

    const processor: TaskProcessor = {
      processTask: vi.fn().mockResolvedValue({ success: true, data: { type: 'verification' } }),
    };

    const stats = await runPollingLoop(client, processor, makeConfig({ maxTasks: 3 }));
    expect(stats.tasksProcessed).toBeLessThanOrEqual(3);
  });

  it('exits after consecutive empty polls', async () => {
    const client = {
      getPendingTasks: vi.fn().mockResolvedValue({ tasks: [] }),
    } as unknown as DocAlignApiClient;

    const processor: TaskProcessor = {
      processTask: vi.fn(),
    };

    const stats = await runPollingLoop(client, processor, makeConfig());

    expect(stats.tasksProcessed).toBe(0);
    expect(client.getPendingTasks).toHaveBeenCalledTimes(5); // maxConsecutiveEmpty
  });

  it('populates metadata in submitted results', async () => {
    const client = {
      getPendingTasks: vi.fn()
        .mockResolvedValueOnce({
          tasks: [{ id: 'task-1', type: 'verification', status: 'pending', created_at: 't', expires_at: 't' }],
        })
        .mockResolvedValue({ tasks: [] }),
      claimTask: vi.fn().mockResolvedValue(makeTask('task-1')),
      submitTaskResult: vi.fn().mockResolvedValue({ status: 'accepted', task_id: '' }),
    } as unknown as DocAlignApiClient;

    const processor: TaskProcessor = {
      processTask: vi.fn().mockResolvedValue({
        success: true,
        data: { type: 'verification' },
        metadata: { model_used: 'claude-sonnet', tokens_used: 500, cost_usd: 0.003 },
      }),
    };

    await runPollingLoop(client, processor, makeConfig());

    const submitCall = (client.submitTaskResult as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = submitCall[1] as TaskResultPayload;
    expect(payload.metadata.model_used).toBe('claude-sonnet');
    expect(payload.metadata.tokens_used).toBe(500);
    expect(payload.metadata.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
