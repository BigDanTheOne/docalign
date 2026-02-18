import { emitter } from '../events/emitter';
import { query } from '../db/client';

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  userId: string;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  title: string;
  userId: string;
  assigneeId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
}

export class TaskService {
  static async createTask(input: CreateTaskInput): Promise<Task> {
    const rows = await query<Task>(
      `INSERT INTO tasks (title, user_id, assignee_id, status)
       VALUES ($1, $2, $3, 'todo')
       RETURNING id, title, status, user_id as "userId", assignee_id as "assigneeId",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [input.title, input.userId, input.assigneeId ?? null]
    );

    const task = rows[0];
    if (!task) {
      throw new Error('Failed to create task');
    }
    return task;
  }

  static async getTaskById(id: string): Promise<Task | null> {
    const rows = await query<Task>(
      `SELECT id, title, status, user_id as "userId", assignee_id as "assigneeId",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM tasks WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  static async listTasksByUser(userId: string): Promise<Task[]> {
    return query<Task>(
      `SELECT id, title, status, user_id as "userId", assignee_id as "assigneeId",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM tasks WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
  }

  static async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(input.title);
    }
    if (input.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(input.status);
    }
    if (input.assigneeId !== undefined) {
      fields.push(`assignee_id = $${idx++}`);
      values.push(input.assigneeId);
    }

    if (fields.length === 0) return TaskService.getTaskById(id);

    values.push(id);
    const rows = await query<Task>(
      `UPDATE tasks SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, title, status, user_id as "userId", assignee_id as "assigneeId",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      values
    );

    const task = rows[0] ?? null;

    if (task && input.status === 'done') {
      emitter.emit('task.completed', task);
    }

    return task;
  }

  static async completeTask(id: string): Promise<Task | null> {
    const rows = await query<Task>(
      `UPDATE tasks SET status = 'done', updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, status, user_id as "userId", assignee_id as "assigneeId",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [id]
    );

    const task = rows[0] ?? null;

    if (task) {
      emitter.emit('task.completed', task);
    }

    return task;
  }

  static async deleteTask(id: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'DELETE FROM tasks WHERE id = $1 RETURNING id',
      [id]
    );
    return rows.length > 0;
  }
}
