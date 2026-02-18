---
title: "CLI Reference"
summary: "Complete reference for all docalign CLI commands, flags, environment variables, and exit codes."
description: "Covers installation (global npm or npx). Commands: scan (--json, --exclude), check <file> (--verbose), extract [file] (--force, --dry-run), fix [file], status, configure (--exclude, --min-severity, --reset), init (adds MCP to .claude/mcp.json + installs skill), viz (--output, --no-open, --exclude), mcp (--repo, starts MCP server), help. Environment variables: ANTHROPIC_API_KEY. Exit codes: 0 (success), 1 (drift detected), 2 (usage error)."
category: reference
read_when:
  - You need the exact syntax for a docalign command or flag
  - You are writing a CI script and need to know exit codes
  - You want to understand what docalign init does
related:
  - docs/guides/checking-files.md
  - docs/guides/fixing-drift.md
  - docs/guides/mcp-integration.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# CLI Reference

## Installation

```bash
npm install -g docalign    # Global install
npx docalign scan          # Or run directly with npx
```

## Commands

### docalign scan

Scan the entire repository for documentation drift.

```bash
docalign scan
docalign scan --json
docalign scan --exclude=docs/archive/old.md,docs/legacy.md
```

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON instead of formatted text |
| `--exclude=FILE[,FILE]` | Comma-separated list of files to skip |

**Output:** Lists each doc file with its claim count and drift status. Summary shows total verified, drifted, and health score.

### docalign check \<file\>

Check a single documentation file for drift.

```bash
docalign check README.md
docalign check README.md --verbose
```

| Flag | Description |
|------|-------------|
| `--verbose` | Show all claims, not just drifted ones |

**Output:** Each claim found in the file with its verification result. Verbose mode includes verified claims.

### docalign extract [file]

Extract semantic claims using Claude. Finds behavior, architecture, and config claims that regex can't catch.

```bash
docalign extract                    # All doc files
docalign extract README.md          # Single file
docalign extract README.md --force  # Re-extract even if unchanged
docalign extract --dry-run          # Preview without saving
```

| Flag | Description |
|------|-------------|
| `--force` | Re-extract all sections, even if content hasn't changed |
| `--dry-run` | Show what would be extracted without saving |

**Requirements:** `claude` CLI installed and authenticated (Claude Code).

<!-- docalign:semantic id="sem-e23ce2967fee2194" claim="Extracted claims saved to .docalign/semantic/" -->
**Storage:** Extracted claims saved to `.docalign/semantic/`, included in future `check` and `scan` runs.

### docalign fix [file]

Generate and apply fix suggestions for drifted documentation.

```bash
docalign fix                # Fix all files with drift
docalign fix README.md      # Fix a specific file
```

<!-- docalign:semantic id="sem-046d26fea2645e44" claim="docalign fix requires ANTHROPIC_API_KEY for LLM-powered fixes; without it, only deterministic suggestions are available" -->
**Requirements:** `ANTHROPIC_API_KEY` for LLM-powered fixes. Without it, only deterministic suggestions (version replacements, path corrections) are available.

### docalign status

Show current configuration, MCP integration status, and environment info.

```bash
docalign status
```

**Output:** Active config file path, enabled claim types, MCP server status, `ANTHROPIC_API_KEY` presence, and any config warnings.

### docalign configure

Create or update `.docalign.yml` interactively.

```bash
docalign configure
docalign configure --exclude=docs/archive/**
docalign configure --min-severity=medium
docalign configure --reset
```

| Flag | Description |
|------|-------------|
| `--exclude=PATTERN[,PATTERN]` | Add exclude patterns to doc_patterns |
| `--min-severity=LEVEL` | Set minimum severity (`low`, `medium`, `high`) |
| `--reset` | Reset config to defaults |

### docalign init

Set up DocAlign for Claude Code integration.

```bash
docalign init
```

**What it does:**
<!-- docalign:semantic id="sem-e04ddc09ca6c89f1" claim="docalign init adds DocAlign MCP server to .claude/mcp.json" -->
1. Adds DocAlign MCP server to `.claude/mcp.json`
<!-- docalign:semantic id="sem-ab882ee276c75146" claim="docalign init installs the docalign skill for Claude Code" -->
2. Installs the `docalign` skill for Claude Code

### docalign viz

Generate an interactive knowledge graph showing doc-to-code relationships.

```bash
docalign viz
docalign viz --output=report.html
docalign viz --no-open
docalign viz --exclude=docs/internal/**
```

| Flag | Description |
|------|-------------|
| `--output=PATH` | Output path (default: `.docalign/viz.html`) |
| `--no-open` | Don't auto-open in browser |
| `--exclude=FILE[,FILE]` | Comma-separated files to exclude |

**Output:** Self-contained HTML with a Cytoscape.js graph. Nodes = doc files and code files. Edges = claims. Colors = verification status.

### docalign mcp

Start the MCP server for integration with Claude Code, Cursor, or other MCP clients.

```bash
docalign mcp --repo .
docalign mcp --repo /path/to/project
```

| Flag | Description |
|------|-------------|
| `--repo=PATH` | Path to repository root (required) |

Typically called by the MCP client, not directly. See [MCP Integration](../guides/mcp-integration.md).

### docalign help

Show usage information and available commands.

```bash
docalign help
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
<!-- docalign:semantic id="sem-anthropic-api-key-enables" claim="ANTHROPIC_API_KEY enables LLM verification (Tier 3), fix generation, and semantic extraction" -->
| `ANTHROPIC_API_KEY` | Enables LLM verification (Tier 3), fix generation, and semantic extraction |

## Exit Codes

<!-- docalign:semantic id="sem-e8baf3fcb76e5806" claim="Exit code 0 = success (no drift found), 1 = drift detected, 2 = usage error" -->
| Code | Meaning |
|------|---------|
| `0` | Success (no drift found, or command completed) |
| `1` | Drift detected (claims failed verification) |
| `2` | Usage error (unknown command, missing arguments) |
