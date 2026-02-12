import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '../shared/db';
import type {
  AgentTaskRow,
  TaskListResponse,
  TaskDetailResponse,
  TaskResultResponse,
} from '../shared/types';
import logger from '../shared/logger';

// Zod schema for task result submission
const AgentTaskResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  data: z.object({
    type: z.string(),
    verdict: z.enum(['verified', 'drifted', 'uncertain']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    reasoning: z.string().optional(),
    evidence_files: z.array(z.string()).optional(),
    specific_mismatch: z.string().optional(),
    suggested_fix: z.string().optional(),
  }).passthrough(),
  metadata: z.object({
    duration_ms: z.number().optional(),
    model_used: z.string().optional(),
    tokens_used: z.number().optional(),
    cost_usd: z.number().optional(),
  }).passthrough(),
});

export function createTaskRoutes(db: DatabaseClient): Router {
  const router = Router();

  // GET /api/tasks/pending — list pending tasks for a repo
  router.get('/pending', async (req, res) => {
    const repoId = req.repoId!;
    const scanRunId = req.query.scan_run_id as string | undefined;

    try {
      let sql = `
        SELECT id, type, status, created_at, expires_at
        FROM agent_tasks
        WHERE repo_id = $1
          AND status = 'pending'
          AND expires_at > NOW()
      `;
      const params: unknown[] = [repoId];

      if (scanRunId) {
        sql += ' AND scan_run_id = $2';
        params.push(scanRunId);
      }

      sql += ' ORDER BY created_at ASC';

      const result = await db.query<AgentTaskRow>(sql, params);

      const response: TaskListResponse = {
        tasks: result.rows.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          created_at: new Date(row.created_at).toISOString(),
          expires_at: new Date(row.expires_at).toISOString(),
        })),
      };

      res.json(response);
    } catch (err) {
      logger.error({ err, repoId }, 'Error fetching pending tasks');
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch pending tasks' });
    }
  });

  // GET /api/tasks/:id — claim a task atomically
  router.get('/:id', async (req, res) => {
    const taskId = req.params.id;
    const repoId = req.repoId!;
    const actionRunId = (req.query.action_run_id as string) || 'unknown';

    try {
      // Atomic claim: UPDATE WHERE claimed_by IS NULL AND not expired
      const result = await db.query<AgentTaskRow>(
        `UPDATE agent_tasks
         SET status = 'in_progress',
             claimed_by = $1,
             expires_at = NOW() + INTERVAL '10 minutes'
         WHERE id = $2
           AND repo_id = $3
           AND claimed_by IS NULL
           AND expires_at > NOW()
         RETURNING *`,
        [actionRunId, taskId, repoId],
      );

      if (result.rowCount === 0) {
        // Determine why claim failed
        const existing = await db.query<AgentTaskRow>(
          'SELECT id, status, claimed_by, expires_at FROM agent_tasks WHERE id = $1',
          [taskId],
        );

        if (existing.rows.length === 0) {
          res.status(404).json({ error: 'TASK_NOT_FOUND', message: 'Task not found' });
          return;
        }

        const task = existing.rows[0];
        if (task.status === 'expired' || new Date(task.expires_at) < new Date()) {
          res.status(410).json({
            error: 'DOCALIGN_E204',
            message: 'Task has expired. Result rejected.',
          });
          return;
        }

        if (task.claimed_by !== null) {
          res.status(409).json({
            error: 'DOCALIGN_E205',
            message: 'Task already completed by another Action run.',
          });
          return;
        }

        res.status(404).json({ error: 'TASK_NOT_FOUND', message: 'Task not found' });
        return;
      }

      const row = result.rows[0];
      logger.info({ taskId, repoId, actionRunId, taskType: row.type }, 'agent_task_claimed');

      const response: TaskDetailResponse = {
        id: row.id,
        repo_id: row.repo_id,
        scan_run_id: row.scan_run_id,
        type: row.type,
        status: row.status,
        payload: row.payload,
        claimed_by: row.claimed_by,
        error: row.error,
        expires_at: new Date(row.expires_at).toISOString(),
        created_at: new Date(row.created_at).toISOString(),
        completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      };

      res.json(response);
    } catch (err) {
      logger.error({ err, taskId, repoId }, 'Error claiming task');
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to claim task' });
    }
  });

  // POST /api/tasks/:id/result — submit task result
  router.post('/:id/result', async (req, res) => {
    const taskId = req.params.id;
    const repoId = req.repoId!;

    // 1. Validate result with Zod
    const parseResult = AgentTaskResultSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'DOCALIGN_E202',
        message: 'Result validation failed.',
        details: parseResult.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
      return;
    }

    const taskResult = parseResult.data;

    try {
      // 2. Check task state
      const existing = await db.query<AgentTaskRow>(
        'SELECT id, status, claimed_by, expires_at, type FROM agent_tasks WHERE id = $1 AND repo_id = $2',
        [taskId, repoId],
      );

      if (existing.rows.length === 0) {
        res.status(404).json({ error: 'TASK_NOT_FOUND', message: 'Task not found' });
        return;
      }

      const task = existing.rows[0];

      if (task.status === 'completed') {
        res.status(409).json({
          error: 'DOCALIGN_E205',
          message: 'Task already completed by another Action run.',
        });
        return;
      }

      if (task.status === 'expired' || new Date(task.expires_at) < new Date()) {
        res.status(410).json({
          error: 'DOCALIGN_E204',
          message: 'Task has expired. Result rejected.',
        });
        return;
      }

      // 3. Update task record
      const newStatus = taskResult.success ? 'completed' : 'failed';
      await db.query(
        `UPDATE agent_tasks
         SET status = $1,
             completed_at = NOW(),
             error = $2
         WHERE id = $3`,
        [newStatus, taskResult.success ? null : (taskResult.error ?? null), taskId],
      );

      logger.info(
        {
          taskId,
          taskType: task.type,
          status: newStatus,
          durationMs: taskResult.metadata.duration_ms,
          model: taskResult.metadata.model_used,
        },
        'agent_task_result',
      );

      const response: TaskResultResponse = {
        status: 'accepted',
        task_id: taskId,
      };

      res.json(response);
    } catch (err) {
      logger.error({ err, taskId, repoId }, 'Error submitting task result');
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to submit task result' });
    }
  });

  return router;
}
