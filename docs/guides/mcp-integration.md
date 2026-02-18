---
title: "MCP Integration"
summary: "Guide to setting up DocAlign's MCP server for use with Claude Code, Cursor, and other MCP-compatible AI clients."
description: "Covers quick setup via docalign init (adds to .claude/mcp.json, installs skill), manual JSON config, the 10 available MCP tools (get_docs_for_file, check_doc, deep_check, get_docs, list_drift, fix_doc, report_drift, get_doc_health, check_section, register_claims), example agent workflows, and how to verify the integration with docalign status."
category: guide
read_when:
  - You want AI coding agents to have access to documentation health
  - You are setting up DocAlign with Claude Code or Cursor
  - The MCP server is not appearing in your AI agent's tools
related:
  - docs/reference/mcp-tools.md
  - docs/getting-started.md
  - docs/troubleshooting.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# MCP Integration

DocAlign includes a Model Context Protocol (MCP) server that gives AI coding agents live access to documentation verification. Works with Claude Code, Cursor, and any MCP-compatible client.

## Quick setup (Claude Code)
```bash
docalign init
```

This automatically:
<!-- docalign:semantic id="sem-af8351d975968695" claim="docalign init adds the docalign MCP server to .claude/mcp.json and installs the docalign skill" -->
1. Adds the DocAlign MCP server to `.claude/mcp.json`
2. Installs the `docalign` skill

<!-- docalign:semantic id="sem-9db76114419e7312" claim="After setup, your AI agent has 10 documentation tools available" -->
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

<!-- docalign:semantic id="sem-80068362bada9be6" claim="get_docs_for_file returns all doc claims that reference that file" -->
Returns all doc claims that reference that file, showing which docs might need updating.

### Check if documentation is accurate

```
Use check_doc with file="README.md" for a quick check
Use deep_check with file="README.md" for a thorough audit
```

<!-- docalign:semantic id="sem-fe87323a6e67dfc2" claim="check_doc runs syntactic checks. deep_check adds semantic claims and shows unchecked sections" -->
`check_doc` runs syntactic checks. `deep_check` adds semantic claims and shows unchecked sections.

### Search documentation by topic

```
Use get_docs with query="authentication"
```

<!-- docalign:semantic id="sem-2d5a71308583e52c" claim="get_docs returns doc sections ranked by relevance with verification status" -->
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

<!-- docalign:semantic id="sem-e8bdb6273f38d68d" claim="reports are stored locally in .docalign/reports/ for tracking" -->
Reports are stored locally in `.docalign/reports/` for tracking.

### Get a quality overview

```
Use get_doc_health
```

<!-- docalign:semantic id="sem-63f2b4167bcf748c" claim="get_doc_health returns a 0-100 health score, verified vs drifted counts, and the worst files" -->
Returns a 0-100 health score, verified vs drifted counts, and the worst files.

## Verify it's working

Run `docalign status` to check MCP integration status. Or ask your AI agent to run `get_doc_health` -- if it returns a score, the integration is working.
## All 10 tools

See [MCP Tools Reference](../reference/mcp-tools.md) for complete documentation of every tool with parameters and return values.
