# DocAlign

[![npm version](https://img.shields.io/npm/v/docalign)](https://www.npmjs.com/package/docalign)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

Detects when your documentation drifts from code reality — and tells your AI coding agent about it.

DocAlign extracts verifiable claims from your docs — file paths, dependency versions, CLI commands, API routes, code examples, config values — and checks each one against the actual codebase. Works as an **MCP server** for Claude Code (primary) or as a standalone **CLI**.

## Setup

Run this from the root of your project:

```bash
curl -fsSL https://raw.githubusercontent.com/BigDanTheOne/docalign/main/scripts/install.sh | bash
```

The script checks prerequisites (Node 18+, git), installs DocAlign globally, runs `docalign init` to configure the MCP server and skills, then launches Claude Code. Claude walks you through selecting which docs to monitor and runs the initial extraction — one sub-agent per document, in parallel.

After setup, Claude automatically checks documentation after code changes and answers "are my docs accurate?" directly. No further configuration required.

## How It Works

**On every code change**, Claude's DocAlign skill:

1. Finds docs that reference the changed files (`get_docs` with `code_file` param)
2. Checks those docs for drift (`check_doc`)
3. Reports specific mismatches with suggested fixes

**On first setup**, Claude walks through your doc files, selects which ones to monitor, and extracts semantic claims in parallel — one sub-agent per document. Subsequent checks use cached claims and are fast.

## What It Finds

**Syntactic checks** (regex-based, instant):

| Category | Example |
|----------|---------|
| File paths | `src/auth.ts` referenced but doesn't exist |
| Dependencies | README says `express 4.17`, package.json has `4.18` |
| CLI commands | `npm run deploy` but no `deploy` script defined |
| API routes | `GET /api/users` not found in route handlers |
| Code examples | Import from `./utils/helpers` but symbol not exported |
| Env variables | `DATABASE_URL` documented but missing from `.env.example` |
| Config values | "Defaults to port 3000" but code uses 8080 |
**Semantic checks** (LLM-powered, via Claude):

Behavior claims, architecture decisions, and config assumptions — verified against actual code. Extracted once per document, cached, re-verified on each scan.

See [Checks Reference](docs/reference/checks.md) for all claim types.

## Claude Code Skill

DocAlign ships as a native **Claude Code skill** — an agent workflow that Claude runs automatically, not a tool you have to remember to call.

Once installed, Claude watches every `git commit`. When source files change, the skill:

1. Looks up which docs reference those files
2. Re-verifies each affected doc's claims against the updated code
3. Surfaces any mismatches inline, with the exact line and a suggested fix

The result: **stale documentation gets caught at commit time**, before it reaches reviewers or other developers. No CI step required, no separate lint job — it runs inside the same Claude Code session where you're already working.

You can also invoke it on demand:

- `/docalign` — check docs affected by recent changes
- `/docalign-setup` — first-time interactive setup wizard

To install the skill in your project, run the one-liner in [Setup](#setup) above.

## MCP Tools

Claude Code gets 4 documentation tools:

| Tool | What it does |
|------|-------------|
| `check_doc` | Check a doc file for drift — optionally scoped to a section (`section=`) or with full audit (`deep=true`) |
| `scan_docs` | Repo-wide health score + ordered drift hotspot list |
| `get_docs` | Search docs by topic or reverse-lookup docs that reference a code file (`code_file=`) |
| `register_claims` | Persist semantic claims found during analysis |

See [MCP Tools Reference](docs/reference/mcp-tools.md) for parameters and return values.

## CLI

For one-off checks, CI use, or manual setup:

```bash
npx docalign init              # Manual setup (alternative to install.sh)
npx docalign scan              # Scan entire repository
npx docalign check README.md   # Check a single file
```

See [CLI Reference](docs/reference/cli.md) for all commands and flags.

## Configuration

Works with zero configuration. To customize, create `.docalign.yml`:

```yaml
doc_patterns:
  include: ['README.md', 'docs/**/*.md']
  exclude: ['docs/archive/**']

claim_types:
  url_reference: false   # Skip dead link checks

verification:
  min_severity: medium   # Only report medium+ issues
```
See [Configuration Reference](docs/reference/configuration.md) for all options.

## Documentation

**Getting started:** [Installation & first scan](docs/getting-started.md)

**Guides:** [Checking files](docs/guides/checking-files.md) · [Semantic extraction](docs/guides/semantic-extraction.md) · [MCP integration](docs/guides/mcp-integration.md) · [Fixing drift](docs/guides/fixing-drift.md) · [Suppressing findings](docs/guides/suppressing-findings.md) · [Custom configuration](docs/guides/custom-configuration.md)

**Reference:** [CLI](docs/reference/cli.md) · [Configuration](docs/reference/configuration.md) · [Checks](docs/reference/checks.md) · [MCP tools](docs/reference/mcp-tools.md)

**Explanation:** [How it works](docs/explanation/how-it-works.md) · [Verification tiers](docs/explanation/verification-tiers.md)

**Contributing:** [Architecture](docs/contributing/architecture.md) · [Design patterns](docs/contributing/design-patterns.md) · [Adding a check](docs/contributing/adding-a-check.md) · [Testing](docs/contributing/testing.md)

[Troubleshooting](docs/troubleshooting.md)

## License

MIT
