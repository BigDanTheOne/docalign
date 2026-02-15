---
title: "MCP Integration"
description: "Use when setting up DocAlign as an MCP server for Claude Code, Cursor, or other AI coding agents."
category: "guide"
related:
  - docs/reference/mcp-tools.md
  - docs/guides/checking-files.md
---

# MCP Integration

DocAlign includes a Model Context Protocol (MCP) server that gives AI coding agents live access to documentation verification. Works with Claude Code, Cursor, and any MCP-compatible client.

## Quick setup (Claude Code)

```bash
docalign init
```

This automatically:
1. Adds the DocAlign MCP server to `.claude/mcp.json`
2. Installs the `docalign` skill

After setup, your AI agent has 10 documentation tools available.

## Manual setup

Add to your MCP config (`.claude/mcp.json` for Claude Code, or equivalent for other clients):

```json
{
  "mcpServers": {
    "docalign": {
      "command": "npx",
      "args": ["docalign", "mcp", "--repo", "."]
    }
  }
}
```

## What agents can do

With MCP integration, your AI agent can:

### Find docs affected by code changes

After changing `src/auth/middleware.ts`:

```
Use get_docs_for_file with file_path="src/auth/middleware.ts"
```

Returns all doc claims that reference that file, showing which docs might need updating.

### Check if documentation is accurate

```
Use check_doc with file="README.md" for a quick check
Use deep_check with file="README.md" for a thorough audit
```

`check_doc` runs syntactic checks. `deep_check` adds semantic claims and shows unchecked sections.

### Search documentation by topic

```
Use get_docs with query="authentication"
```

Returns doc sections about authentication ranked by relevance, with verification status.

### Fix stale documentation

```
1. Use list_drift to see which files have drift
2. Use fix_doc on each file to get fix suggestions
```

### Report a doc error found during work

```
Use report_drift with the file, the wrong text, and what the code actually does
```

Reports are stored locally in `.docalign/reports/` for tracking.

### Get a quality overview

```
Use get_doc_health
```

Returns a 0-100 health score, verified vs drifted counts, and the worst files.

## Verify it's working

Run `docalign status` to check MCP integration status. Or ask your AI agent to run `get_doc_health` -- if it returns a score, the integration is working.

## All 10 tools

See [MCP Tools Reference](../reference/mcp-tools.md) for complete documentation of every tool with parameters and return values.
