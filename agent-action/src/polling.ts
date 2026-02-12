/**
 * Task polling loop: claim, route, process, submit.
 * Implements: tdd-infra.md Sections 4.3-4.6 (client-side contract).
 */
import type { ActionConfig } from './config';
import type { DocAlignApiClient, TaskDetailResponse, ApiError } from './api-client';
import type { TaskProcessor } from './task-processor';

export interface PollingStats {
  tasksProcessed: number;
  tasksFailed: number;
  tasksSkipped: number;
  totalDurationMs: number;
}

/**
 * Poll for pending tasks, claim them in FIFO order, and process sequentially.
 */
export async function runPollingLoop(
  client: DocAlignApiClient,
  processor: TaskProcessor,
  config: ActionConfig,
): Promise<PollingStats> {
  const stats: PollingStats = {
    tasksProcessed: 0,
    tasksFailed: 0,
    tasksSkipped: 0,
    totalDurationMs: 0,
  };
  const startTime = Date.now();

  let consecutiveEmpty = 0;
  const maxConsecutiveEmpty = 5;

  while (stats.tasksProcessed + stats.tasksFailed + stats.tasksSkipped < config.maxTasks) {
    // 1. Poll for pending tasks
    let taskList;
    try {
      taskList = await client.getPendingTasks(config.scanRunId);
    } catch (err) {
      console.error('[polling] Error fetching pending tasks:', err);
      await sleep(config.pollIntervalMs);
      continue;
    }

    // 2. No tasks → check exit condition
    if (taskList.tasks.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= maxConsecutiveEmpty) {
        console.log('[polling] No more pending tasks. Exiting.');
        break;
      }
      await sleep(config.pollIntervalMs);
      continue;
    }

    consecutiveEmpty = 0;

    // 3. Process tasks in FIFO order (already sorted by created_at ASC from server)
    for (const taskSummary of taskList.tasks) {
      if (stats.tasksProcessed + stats.tasksFailed + stats.tasksSkipped >= config.maxTasks) {
        break;
      }

      // 3a. Claim the task
      let task: TaskDetailResponse;
      try {
        task = await client.claimTask(taskSummary.id);
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 409 || apiErr.status === 410 || apiErr.status === 404) {
          // Already claimed, expired, or not found — skip
          stats.tasksSkipped++;
          continue;
        }
        console.error(`[polling] Error claiming task ${taskSummary.id}:`, err);
        stats.tasksFailed++;
        continue;
      }

      // 3b. Process the task
      const taskStart = Date.now();
      try {
        const result = await processor.processTask(task);

        // 3c. Submit result
        await client.submitTaskResult(task.id, {
          success: result.success,
          error: result.error,
          data: result.data,
          metadata: {
            duration_ms: Date.now() - taskStart,
            model_used: result.metadata?.model_used,
            tokens_used: result.metadata?.tokens_used,
            cost_usd: result.metadata?.cost_usd,
          },
        });

        stats.tasksProcessed++;
      } catch (err) {
        console.error(`[polling] Error processing task ${task.id}:`, err);

        // Submit failure
        try {
          await client.submitTaskResult(task.id, {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            data: { type: task.type },
            metadata: { duration_ms: Date.now() - taskStart },
          });
        } catch (submitErr) {
          console.error(`[polling] Error submitting failure for task ${task.id}:`, submitErr);
        }

        stats.tasksFailed++;
      }
    }
  }

  stats.totalDurationMs = Date.now() - startTime;
  return stats;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
