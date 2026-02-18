import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { client } from '../db/client';
import { TaskService } from '../services/TaskService';
import { UserService } from '../services/UserService';
import { NotificationService } from '../services/NotificationService';

NotificationService.init();

const server = new Server(
  {
    name: 'taskflow',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.tool('get_tasks', 'List all tasks for the authenticated user',
  z.object({
    userId: z.string().describe('The user ID to fetch tasks for'),
  }),
  async ({ userId }) => {
    const tasks = await TaskService.listTasksByUser(userId);
    return {
      content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }],
    };
  }
);

server.tool('create_task', 'Create a new task',
  z.object({
    title: z.string(),
    assigneeId: z.string().optional(),
    userId: z.string().describe('The user ID creating the task'),
  }),
  async ({ title, assigneeId, userId }) => {
    const task = await TaskService.createTask({ title, userId, assigneeId });
    return {
      content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
    };
  }
);

server.tool('complete_task', 'Mark a task as done and emit task.completed event',
  z.object({
    taskId: z.string().describe('The ID of the task to complete'),
  }),
  async ({ taskId }) => {
    const task = await TaskService.completeTask(taskId);
    if (!task) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Task not found' }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
    };
  }
);

server.tool('get_users', 'List all users in the system',
  z.object({}),
  async () => {
    const users = await UserService.listUsers();
    return {
      content: [{ type: 'text', text: JSON.stringify(users, null, 2) }],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Taskflow MCP server running on stdio\n');
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});

// The MCP server shares the database connection with the REST API
void client;
