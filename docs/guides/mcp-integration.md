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
<!-- docalign:semantic id="sem-af8351d975968695" -->
1. Registers the DocAlign MCP server globally via `claude mcp add --scope user`
2. Installs the `docalign` and `docalign-setup` skills to `.claude/skills/docalign/`
3. Adds permissions and a PostToolUse hook to `.claude/settings.local.json`
4. Triggers the interactive setup wizard on next Claude Code launch

<!-- docalign:semantic id="sem-9db76114419e7312" -->
After setup, your AI agent has 4 local documentation tools available.

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

The local MCP server uses stdio transport and communicates over stdin/stdout.

You can also start the MCP server manually:
```bash
docalign mcp --repo <path>
```

## Local tools

The local MCP server provides 4 tools: `check_doc`, `scan_docs`, `get_docs`, and `register_claims`.

### check_doc — Check if documentation is accurate

```
Use check_doc with file="README.md" for a quick check
Use check_doc with file="README.md", deep=true for a thorough audit
```

`check_doc` runs syntactic checks. With `deep=true` it also adds semantic claims and shows unchecked sections.

### scan_docs — Get a quality overview

```
Use scan_docs
```

<!-- docalign:semantic id="sem-63f2b4167bcf748c" status="verified" -->
Returns a 0-100 health score, verified vs drifted counts, and the worst files.

### get_docs — Find docs by topic or code file

```
Use get_docs with query="authentication"
Use get_docs with code_file="src/auth/middleware.ts"
```

<!-- docalign:semantic id="sem-2d5a71308583e52c" status="drifted" -->
Returns doc sections ranked by relevance, with verification status. Use `code_file` to find all docs that reference a specific source file.

### register_claims — Persist semantic claims

```
Use register_claims with claims=[{source_file: "README.md", line_number: 10, ...}]
```

Saves semantic claims discovered during analysis to `.docalign/semantic/` for future verification.

### Fix stale documentation

When `check_doc` or `scan_docs` reports drift, Claude Code can fix the documentation directly: it reads the drift report, checks the referenced code files, and edits the documentation to match reality. No separate fix command needed.

## Remote-only tools (hosted server mode)

The hosted DocAlign server mode provides additional tools (`get_docs_for_file`, `get_doc_health`, `list_stale_docs`, `report_drift`) that require a PostgreSQL database. These remote tools are not available locally — only the 4 tools above are available in local/CLI mode.

## Verify it's working

Run `docalign status` to check MCP integration status. Or ask your AI agent to run `scan_docs` — if it returns a health score, the integration is working.
