---
title: "MCP Integration"
summary: "Guide to setting up DocAlign's MCP server for use with Claude Code, Cursor, and other MCP-compatible AI clients."
description: "Covers quick setup via docalign init (adds to .claude/mcp.json, installs skill), manual JSON config, the 4 available MCP tools (check_doc, scan_docs, get_docs, register_claims), example agent workflows, and how to verify the integration with docalign status."
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
<!-- docalign:semantic id="sem-af8351d975968695" claim="docalign init writes MCP server config to .claude/settings.local.json and installs the docalign skill" -->
1. Writes the DocAlign MCP server config to `.claude/settings.local.json`
2. Installs the `docalign` and `docalign-setup` skills
3. Triggers the interactive setup wizard on next Claude Code launch

<!-- docalign:semantic id="sem-9db76114419e7312" -->
After setup, your AI agent has 4 documentation tools available.

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
Use get_docs with code_file="src/auth/middleware.ts"
```

Returns all doc claims that reference that file, showing which docs might need updating.

### Check if documentation is accurate

```
Use check_doc with file="README.md" for a quick check
Use check_doc with file="README.md", deep=true for a thorough audit
```

`check_doc` runs syntactic checks. With `deep=true` it also adds semantic claims and shows unchecked sections.

### Search documentation by topic

```
Use get_docs with query="authentication"
```

<!-- docalign:semantic id="sem-2d5a71308583e52c" -->
Returns doc sections about authentication ranked by relevance, with verification status.

### Fix stale documentation

When `check_doc` or `scan_docs` reports drift, Claude Code can fix the documentation directly: it reads the drift report, checks the referenced code files, and edits the documentation to match reality. No separate fix command needed.

### Get a quality overview

```
Use scan_docs
```

<!-- docalign:semantic id="sem-63f2b4167bcf748c" -->
Returns a 0-100 health score, verified vs drifted counts, and the worst files.

## Verify it's working

Run `docalign status` to check MCP integration status. Or ask your AI agent to run `scan_docs` — if it returns a health score, the integration is working.
## All 4 tools

See [MCP Tools Reference](../reference/mcp-tools.md) for complete documentation of every tool with parameters and return values.
