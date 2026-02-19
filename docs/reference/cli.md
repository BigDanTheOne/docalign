---
title: "CLI Reference"
summary: "Complete reference for all DocAlign CLI commands, flags, environment variables, and exit codes."
description: "Documents all 9 CLI commands: scan (full repo scan, --json, --exclude), check (single file, --verbose), extract (semantic claims, --force, --dry-run), fix (drift fixes), status (config and MCP status), configure (interactive config, --exclude, --min-severity, --reset), init (Claude Code MCP setup), viz (knowledge graph, --output, --no-open, --exclude), mcp (start MCP server, --repo). Also covers ANTHROPIC_API_KEY environment variable and exit codes (0/1/2)."
category: reference
read_when:
  - You need the exact syntax for a docalign command
  - You need to know what flags a command accepts
  - You want to understand exit codes
related:
  - docs/getting-started.md
  - docs/reference/configuration.md
  - docs/guides/checking-files.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
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

**Output:** Each claim found in the file with its verification result (drifted claims only).

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

<!-- docalign:semantic id="sem-88b10afe24b64a20" claim="Without ANTHROPIC_API_KEY, only deterministic suggestions (version replacements, path corrections) are available for fix" -->
**Requirements:** `ANTHROPIC_API_KEY` for LLM-powered fixes. Without it, only deterministic suggestions (version replacements, path corrections) are available.

### docalign status

Show current configuration, MCP integration status, and environment info.

```bash
docalign status
```

<!-- docalign:semantic id="sem-81de6b5b50c968d5" claim="docalign status outputs active config file path, MCP server status, ANTHROPIC_API_KEY presence, and any config warnings" -->
**Output:** Active config file path, MCP server status, `ANTHROPIC_API_KEY` presence, and any config warnings.

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
<!-- docalign:semantic id="sem-e04ddc09ca6c89f1" claim="docalign init writes MCP server config and post-commit hooks to .claude/settings.local.json" -->
1. Writes MCP server config and post-commit hooks to `.claude/settings.local.json`
<!-- docalign:semantic id="sem-ab882ee276c75146" claim="docalign init installs docalign and docalign-setup skills to .claude/skills/ and ~/.claude/skills/" -->
2. Installs `docalign` and `docalign-setup` skills to `.claude/skills/` and `~/.claude/skills/`
3. Adds a setup trigger to `CLAUDE.md` — the interactive setup wizard runs automatically on the next Claude Code launch

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

<!-- docalign:semantic id="sem-a5a01f8f7dba6eae" claim="docalign viz outputs self-contained HTML with a Cytoscape.js graph. Nodes = doc files and code files. Edges = claims. Colors = verification status." -->
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
| `ANTHROPIC_API_KEY` | Enables LLM verification (Tier 3), fix generation, and semantic extraction |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (no drift found, or command completed) |
| `1` | Drift detected (claims failed verification) |
| `2` | Usage error (unknown command, missing arguments) |
