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

**Output:** Shows each claim found in the file with its verification result. In verbose mode, includes verified claims too.

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

**Requirements:** Requires `claude` CLI to be installed and authenticated (Claude Code).

**Storage:** Extracted claims are saved to `.docalign/semantic/` and automatically included in future `check` and `scan` runs.

### docalign fix [file]

Generate and apply fix suggestions for drifted documentation.

```bash
docalign fix                # Fix all files with drift
docalign fix README.md      # Fix a specific file
```

**Requirements:** Requires `ANTHROPIC_API_KEY` for LLM-powered fix generation. Without it, only deterministic fix suggestions (like version number replacements) are available.

### docalign status

Show current configuration, MCP integration status, and environment info.

```bash
docalign status
```

**Output:** Shows active config file path, enabled claim types, MCP server status, and whether `ANTHROPIC_API_KEY` is set.

### docalign configure

Create or update the `.docalign.yml` configuration file interactively.

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

Set up DocAlign for Claude Code integration. Configures MCP server and installs the DocAlign skill.

```bash
docalign init
```

**What it does:**
1. Adds DocAlign MCP server to `.claude/mcp.json`
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
| `--output=PATH` | Output path for HTML file (default: `.docalign/viz.html`) |
| `--no-open` | Don't auto-open the HTML in a browser |
| `--exclude=FILE[,FILE]` | Comma-separated files to exclude |

**Output:** A self-contained HTML file with a Cytoscape.js graph. Nodes represent doc files and code files. Edges represent claims linking them. Colors indicate verification status.

### docalign mcp

Start the MCP server for integration with Claude Code, Cursor, or other MCP clients.

```bash
docalign mcp --repo .
docalign mcp --repo /path/to/project
```

| Flag | Description |
|------|-------------|
| `--repo=PATH` | Path to the repository root (required) |

This is typically called by the MCP client, not directly by users. See [mcp.md](mcp.md) for integration details.

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
