---
title: "Getting Started"
description: "Use when setting up DocAlign for the first time. Covers installation, first scan, reading output, and next steps."
category: "tutorial"
related:
  - docs/reference/cli.md
  - docs/guides/checking-files.md
  - docs/guides/mcp-integration.md
---

# Getting Started

This guide walks you through installing DocAlign, running your first scan, and understanding the output.

## Prerequisites

- Node.js 18+
- A repository with markdown documentation

<!-- docalign:skip reason="user_instruction" description="Install instructions telling the reader to run npm install or npx — instructions for the end-user, not factual claims about the project" -->
## Install

```bash
npm install -g docalign
```

Or run directly without installing:

```bash
npx docalign scan
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Run Your First Scan tutorial section: instructions directing the user to navigate and run docalign scan" -->
## Run Your First Scan

Navigate to your repository root and run:

```bash
docalign scan
```

DocAlign automatically finds documentation files (`README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more) and scans them for verifiable claims.

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="Sample CLI output block showing invented file paths, package versions, and command names as illustrative examples of drift detection" -->
### Sample Output

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
<!-- docalign:skip reason="user_instruction" description="Check a Single File section: user instruction to run docalign check with a flag" -->
## Check a Single File

For detailed results on one file:

```bash
docalign check README.md --verbose
```

The `--verbose` flag shows all claims, including verified ones. Without it, only drifted claims appear.

<!-- /docalign:skip -->
## Understanding Results

Each finding has three parts:

- **Verdict**: `verified` (claim matches code), `drifted` (claim contradicts code), or `uncertain` (not enough evidence)
- **Severity**: `high` (likely to cause problems), `medium` (should fix), `low` (minor or cosmetic)
- **Evidence**: What DocAlign found in the codebase

### Health Score

The health score is calculated as:

```
score = 100 * verified / (verified + drifted)
```

Uncertain claims don't count. A score of 100 means every checkable claim matches the code.

<!-- docalign:skip reason="user_instruction" description="MCP setup section: user instruction to run docalign init" -->
## Set Up for AI Agents (MCP)

If you use Claude Code, Cursor, or another MCP client:

```bash
docalign init
```

This configures the MCP server so your AI agent can query documentation health, find stale docs, and get fix suggestions. See [MCP Integration](guides/mcp-integration.md).

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Optional semantic extraction section: user instruction to run docalign extract" -->
## Optional: Semantic Extraction

For deeper analysis, extract behavior and architecture claims using Claude:

```bash
docalign extract
```

This finds claims that regex can't catch, like "Authentication uses JWT tokens" or "Services communicate via REST." See [Semantic Extraction](guides/semantic-extraction.md).

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Optional configuration section: user instruction to run docalign configure or create a config file" -->
## Optional: Configuration

DocAlign works with zero configuration, but you can customize what it scans:

```bash
docalign configure
```

Or create `.docalign.yml` manually. See [Custom Configuration](guides/custom-configuration.md).

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Next Steps section: links directing the user to other guides" -->
## Next Steps

- [Checking Files](guides/checking-files.md) -- Scan repos, check files, interpret results
- [How It Works](explanation/how-it-works.md) -- Understand the extract-verify-report pipeline
- [Checks Reference](reference/checks.md) -- See all 11 claim types and cross-cutting checks
- [CLI Reference](reference/cli.md) -- All commands, flags, and options

<!-- /docalign:skip -->