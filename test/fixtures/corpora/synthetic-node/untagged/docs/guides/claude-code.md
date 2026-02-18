# Claude Code Integration

This guide explains how to use Claude Code with the Taskflow MCP server and the built-in Taskflow agent.

---

## Setup

Before using Claude Code with Taskflow, complete the MCP server setup described in [MCP Server Guide](./mcp.md). Claude Code will automatically discover and load the MCP server configuration from `.claude/mcp.json`.

---

## The Taskflow Agent

A pre-built Claude Code agent is configured in `.claude/agents/taskflow.md`. This agent is designed to help you manage tasks directly from your editor workflow.

The agent has access to all 4 MCP tools: `get_tasks`, `create_task`, `complete_task`, and `get_users`. It uses these tools to query and update the Taskflow API on your behalf.

The agent is scoped to the current repository via the `cwd` setting in `.claude/mcp.json`. This means the agent only operates on tasks associated with this repository — it will not accidentally create tasks in a different project's workspace.

---

## Invoking the Agent

Invoking `/taskflow` creates a task from current context. Claude Code parses your current working state — open files, recent changes, error messages — and uses that context to populate the task title and description.

You can also invoke the agent with an explicit instruction:

```
/taskflow create a task to refactor the auth middleware
```

Example invocation output with placeholder values:
```
Created task t_42: "Refactor auth middleware"
Assigned to: alice@example.com
Status: pending
```

Claude will automatically suggest completing tasks when you say you're done with a piece of work.

---

## Workflow Examples

**Creating a task from a failing test:**

Open the test file, then invoke `/taskflow`. The agent reads the test context and creates a task titled after the failing assertion.

**Completing a task:**

Ask the agent "mark task t_42 as done". It calls `complete_task` with the task ID, which sets the status to `done` and triggers the notification system.

**Reviewing your open tasks:**

Ask "what tasks do I have open?" The agent calls `get_tasks` filtered by status `pending` and `in_progress` and displays the results in chat.

---

## Permissions

The agent operates with the permissions of the authenticated user configured in `.claude/mcp.json`. It cannot access tasks owned by other users unless those users have shared the tasks explicitly.
