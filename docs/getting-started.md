---
title: "Getting Started with DocAlign"
summary: "Installation guide and first scan walkthrough for DocAlign, covering prerequisites, basic commands, and understanding results."
description: "Walks users through installing DocAlign via npm, running their first scan, understanding the output format (verdicts, severity, health score), and optionally setting up MCP integration and semantic extraction."
category: guide
read_when:
  - You are new to DocAlign and want to set it up
  - You need to understand what docalign scan output means
related:
  - docs/guides/checking-files.md
  - docs/explanation/how-it-works.md
  - docs/reference/cli.md
  - docs/guides/mcp-integration.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Getting Started

This guide walks you through installing DocAlign, running your first scan, and understanding the output.

## Prerequisites

- Node.js 18+
- A repository with markdown documentation

## Install

```bash
npm install -g docalign
```

Or run directly without installing:

```bash
npx docalign scan
```

## Run Your First Scan

Navigate to your repository root and run:

```bash
docalign scan
```

DocAlign automatically finds documentation files (`README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more) and scans them for verifiable claims.

### Sample Output

<!-- docalign:skip reason="sample_output" description="Illustrative CLI output with invented file paths, claim counts, and health score numbers" -->
```
Scanning repository...

README.md (12 claims)
  DRIFT  [high]  Line 15: File path "src/auth/middleware.ts" — file not found
  DRIFT  [medium]  Line 28: Dependency "express@4.17" — package.json has 4.18.2
  DRIFT  [low]  Line 42: Command "npm run deploy" — no "deploy" script in package.json

docs/setup.md (8 claims)
  DRIFT  [medium]  Line 5: Environment variable "REDIS_URL" — not found in .env or .env.example

Summary: 20 claims scanned, 16 verified, 4 drifted
Health score: 80/100
```
<!-- /docalign:skip -->

## Check a Single File

For detailed results on one file:

```bash
docalign check README.md --verbose
```

<!-- docalign:semantic id="sem-b83c64788ff816a8" claim="--verbose flag shows all claims, including verified ones. Without it, only drifted claims appear." -->
The `--verbose` flag shows all claims, including verified ones. Without it, only drifted claims appear.

## Understanding Results

Each finding has three parts:

<!-- docalign:semantic id="sem-4535ce4f9cce1280" claim="Verdicts are verified, drifted, or uncertain" -->
- **Verdict**: `verified` (claim matches code), `drifted` (claim contradicts code), or `uncertain` (not enough evidence)
- **Severity**: `high` (likely to cause problems), `medium` (should fix), `low` (minor or cosmetic)
- **Evidence**: What DocAlign found in the codebase

### Health Score

<!-- docalign:semantic id="sem-c15bb7a3969534f7" claim="Health score is calculated as score = 100 * verified / (verified + drifted), uncertain claims don't count" -->
The health score is calculated as:
```
score = 100 * verified / (verified + drifted)
```

Uncertain claims don't count. A score of 100 means every checkable claim matches the code.

## Set Up for AI Agents (MCP)

If you use Claude Code, Cursor, or another MCP client:

```bash
docalign init
```

This configures the MCP server so your AI agent can query documentation health, find stale docs, and get fix suggestions. See [MCP Integration](guides/mcp-integration.md).

## Optional: Semantic Extraction

For deeper analysis, extract behavior and architecture claims using Claude:

```bash
docalign extract
```

This finds claims that regex can't catch, like "Authentication uses JWT tokens" or "Services communicate via REST." See [Semantic Extraction](guides/semantic-extraction.md).

## Optional: Configuration

DocAlign works with zero configuration, but you can customize what it scans:

```bash
docalign configure
```

Or create `.docalign.yml` manually. See [Custom Configuration](guides/custom-configuration.md).

## Next Steps

- [Checking Files](guides/checking-files.md) -- Scan repos, check files, interpret results
- [How It Works](explanation/how-it-works.md) -- Understand the extract-verify-report pipeline
- [Checks Reference](reference/checks.md) -- See all 11 claim types and cross-cutting checks
- [CLI Reference](reference/cli.md) -- All commands, flags, and options
