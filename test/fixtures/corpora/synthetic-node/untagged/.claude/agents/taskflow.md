---
name: taskflow
description: Taskflow API agent for managing tasks via MCP
tools:
  - get_tasks
  - create_task
  - complete_task
  - get_users
---

# Taskflow Agent

Invoked via `/taskflow`. Creates and manages tasks using the Taskflow API MCP server.

## Purpose

The Taskflow agent provides a conversational interface to the Taskflow REST API via MCP tools.
Use it to create tasks from context, list existing tasks, complete tasks, and look up users.

## Available Tools

| Tool | Description |
|---|---|
| `get_tasks` | List tasks for a given user |
| `create_task` | Create a new task with title and optional assignee |
| `complete_task` | Mark a task as done |
| `get_users` | List all users in the system |

## Usage

When invoked via `/taskflow`, the agent reads the current context (open files, recent changes,
conversation history) and creates a task that captures the work to be done.

Example invocation:

```
/taskflow Create a task to refactor the auth middleware
```

The agent will call `create_task` with an appropriate title derived from the context,
assign it to the current user, and return the created task details.
