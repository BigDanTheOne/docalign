import { emitter } from '../events/emitter';
import { logger } from '../middleware/logger';
import type { Task } from './TaskService';

export class NotificationService {
  private static initialized = false;

  static init(): void {
    if (NotificationService.initialized) return;

    emitter.on('task.completed', (task: Task) => {
      logger.info(
        { taskId: task.id, userId: task.userId },
        `Task "${task.title}" completed — notifying user`
      );
      NotificationService.sendCompletionNotification(task).catch((err) => {
        logger.error({ err, taskId: task.id }, 'Failed to send completion notification');
      });
    });

    NotificationService.initialized = true;
    logger.info('NotificationService initialized — listening for task.completed events');
  }

  private static async sendCompletionNotification(task: Task): Promise<void> {
    // In a real implementation this would send an email, push notification, etc.
    // For now we log the event as a structured record.
    logger.info(
      {
        event: 'task.completed',
        taskId: task.id,
        taskTitle: task.title,
        userId: task.userId,
        assigneeId: task.assigneeId,
      },
      'Task completion notification dispatched'
    );
  }
}
