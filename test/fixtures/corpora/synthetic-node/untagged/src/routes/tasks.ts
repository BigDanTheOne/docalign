import { Router } from 'express';
import { z } from 'zod';
import { TaskService } from '../services/TaskService';
import { createError } from '../middleware/errorHandler';
import type { Request } from 'express';

const router = Router();

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(255),
  assigneeId: z.string().uuid().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

router.get('/api/v1/tasks', async (req: Request, res, next) => {
  try {
    // Tasks are scoped to the authenticated user via req.user.id
    const tasks = await TaskService.listTasksByUser(req.user.id);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

router.post('/api/v1/tasks', async (req: Request, res, next) => {
  try {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.flatten())
      );
    }

    const task = await TaskService.createTask({
      title: parsed.data.title,
      userId: req.user.id,
      assigneeId: parsed.data.assigneeId,
    });
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

router.patch('/api/v1/tasks/:id', async (req: Request, res, next) => {
  try {
    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.flatten())
      );
    }

    const task = await TaskService.getTaskById(req.params.id);
    if (!task) {
      return next(createError('Task not found', 404, 'TASK_NOT_FOUND'));
    }

    if (task.userId !== req.user.id) {
      return next(createError('Forbidden', 403, 'FORBIDDEN'));
    }

    const updated = await TaskService.updateTask(req.params.id, parsed.data);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/api/v1/tasks/:id', async (req: Request, res, next) => {
  try {
    const task = await TaskService.getTaskById(req.params.id);
    if (!task) {
      return next(createError('Task not found', 404, 'TASK_NOT_FOUND'));
    }

    if (task.userId !== req.user.id) {
      return next(createError('Forbidden', 403, 'FORBIDDEN'));
    }

    await TaskService.deleteTask(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export { router as taskRoutes };
