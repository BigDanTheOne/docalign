---
title: "Getting Started"
summary: "Step-by-step guide to installing DocAlign, running your first scan, and setting up MCP integration for AI agents."
description: "Covers installation via npm/npx, running docalign scan, reading results (verdict, severity, health score formula), checking a single file with --verbose, setting up MCP with docalign init, running semantic extraction, and optional configuration. Includes next-step links."
category: tutorial
read_when:
  - You are installing DocAlign for the first time
  - You want to run your first documentation scan
  - You need to understand the scan output format or health score
related:
  - docs/guides/checking-files.md
  - docs/explanation/how-it-works.md
  - docs/reference/cli.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Getting Started

This guide walks you through installing DocAlign, running your first scan, and understanding the output.

## Prerequisites

<!-- docalign:semantic id="sem-2ecf29e3717aa1a0" claim="Node.js 18+ is required" -->
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

<!-- docalign:semantic id="sem-6b490a1895817ed2" claim="DocAlign automatically finds documentation files (README.md, docs/**/*.md, CONTRIBUTING.md, and more)" -->
DocAlign automatically finds documentation files (`README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more) and scans them for verifiable claims.

### Sample Output

```
Scanning repository...

<!-- docalign:skip reason="sample_output" description="Sample CLI output block showing illustrative scan results with invented file paths, dependency versions, and health score (already marked with docalign:skip in source)" -->
README.md (12 claims)
  DRIFT  [high]  Line 15: File path "src/auth/middleware.ts" — file not found
  DRIFT  [medium]  Line 28: Dependency "express@4.17" — package.json has 4.18.2
  DRIFT  [low]  Line 42: Command "npm run deploy" — no "deploy" script in package.json

docs/setup.md (8 claims)
  DRIFT  [medium]  Line 5: Environment variable "REDIS_URL" — not found in .env or .env.example

Summary: 20 claims scanned, 16 verified, 4 drifted
Health score: 80/100
```

## Check a Single File

<!-- /docalign:skip -->
For detailed results on one file:

```bash
docalign check README.md --verbose
```

The `--verbose` flag shows all claims, including verified ones. Without it, only drifted claims appear.

<!-- docalign:skip reason="capability_description" description="Description of verdict/severity/evidence output fields — illustrative tool output structure, not falsifiable code behavior (already marked with docalign:skip in source)" -->
## Understanding Results

Each finding has three parts:

- **Verdict**: `verified` (claim matches code), `drifted` (claim contradicts code), or `uncertain` (not enough evidence)
- **Severity**: `high` (likely to cause problems), `medium` (should fix), `low` (minor or cosmetic)
- **Evidence**: What DocAlign found in the codebase

### Health Score

<!-- /docalign:skip -->
<!-- docalign:semantic id="sem-ab68259683d0cf5a" claim="The health score is calculated as: score = 100 * verified / (verified + drifted)" -->
The health score is calculated as:
<!-- docalign:skip reason="illustrative_example" description="Health score formula block — mathematical formula shown as documentation, not a verifiable code implementation pattern (already marked with docalign:skip in source)" -->

```
score = 100 * verified / (verified + drifted)
```

<!-- docalign:semantic id="sem-84073b33eb73ba0a" claim="Uncertain claims don't count toward the health score" -->
Uncertain claims don't count. A score of 100 means every checkable claim matches the code.

## Set Up for AI Agents (MCP)

If you use Claude Code, Cursor, or another MCP client:

```bash
docalign init
<!-- /docalign:skip -->
```

<!-- docalign:semantic id="sem-7b78d863f926878d" claim="docalign init configures the MCP server" -->
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

