# MCP Server Guide

The Taskflow MCP server exposes task management capabilities to AI coding agents via the Model Context Protocol. This guide explains how to configure it for use with Claude Code.

---

## Prerequisites

Requires MCP protocol version 1.0 or higher. Ensure your MCP client supports this version before proceeding.

---

## Configuration

The MCP server is configured in `.claude/mcp.json`. This file tells Claude Code how to launch and connect to the server.

A minimal configuration looks like this:

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "node",
      "args": ["dist/mcp/server.js", "--repo", "/path/to/your/repo"],
      "cwd": "/path/to/your/repo"
    }
  }
}
```

Replace `/path/to/your/repo` with the actual path to your repository root. The `cwd` field scopes the server to the current repository.

---

## Available Tools

The MCP server exposes 4 tools: `get_tasks`, `create_task`, `complete_task`, `get_users`.

| Tool | Description |
|---|---|
| `get_tasks` | List tasks for the authenticated user |
| `create_task` | Create a new task |
| `complete_task` | Mark a task as done |
| `get_users` | List users in the system |

---

## Tool Schemas

### create_task

The `create_task` tool accepts `title` (string, required) and `assigneeId` (string, optional).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Task title |
| `assigneeId` | string | No | User ID to assign the task to |

Example tool call with placeholder values:
```json
{
  "tool": "create_task",
  "parameters": {
    "title": "Review PR #42",
    "assigneeId": "u_01"
  }
}
```

### complete_task

`complete_task` sets the task status to `done` and emits the `task.completed` event, which triggers the `NotificationService`. It accepts a single `taskId` parameter.

### get_tasks

Returns the list of tasks. Accepts optional `status` filter.

### get_users

Returns the list of users. No required parameters.

---

## Database Connection

The MCP server shares the database connection with the REST API. Both import and use the connection pool from `src/db/client.ts`. This means the MCP server requires the same `DATABASE_URL` environment variable as the REST API, and both services read from and write to the same PostgreSQL database.

The agent intelligently routes requests to the right tool based on the user's intent.

---

## Running the Server

Build the project first, then start the MCP server:

```bash
npm run build
node dist/mcp/server.js
```

The server communicates over stdio, which is the transport Claude Code uses when it launches the process.
