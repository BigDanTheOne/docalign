# DocAlign

[![npm version](https://img.shields.io/npm/v/docalign)](https://www.npmjs.com/package/docalign)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

Detects when your documentation drifts from code reality.

DocAlign extracts verifiable claims from your docs — file paths, dependency versions, CLI commands, API routes, code examples, config values, URLs — and checks each one against the actual codebase. Zero config. Works as a **CLI** or as an **MCP server** for AI coding agents.

## Quick Start

```bash
npx docalign scan
```

Check a single file:

```bash
npx docalign check README.md --verbose
```

No configuration needed. DocAlign auto-discovers doc files and applies sensible defaults.

## What It Finds

**Syntactic checks** (regex-based, zero config):

<!-- docalign:skip reason="capability_description" description="What It Finds table listing hypothetical detection examples (e.g. 'src/auth.ts referenced but doesn't exist') — illustrative capability descriptions, not factual claims about the current codebase" -->
| Category | Example |
|----------|---------|
| File paths | `src/auth.ts` referenced but doesn't exist |
| Dependencies | README says `express 4.17`, package.json has `4.18` |
| CLI commands | `npm run deploy` but no `deploy` script defined |
| API routes | `GET /api/users` not found in route handlers |
| Code examples | Import from `./utils/helpers` but symbol not exported |
| Env variables | `DATABASE_URL` documented but missing from `.env.example` |
| Config values | "Defaults to port 3000" but code uses 8080 |
| URLs | Dead links (HTTP 404) in documentation |

Plus: anchor validation, cross-doc consistency, frontmatter checks, nav config links, deprecation detection, license/changelog consistency, and fuzzy suggestions.

**Semantic checks** (LLM-powered, optional):

Behavior claims, architecture decisions, and config assumptions — verified against actual code using Claude.

<!-- /docalign:skip -->
See [Checks Reference](docs/reference/checks.md) for all claim types and cross-cutting checks.

## Commands

| Command | Description |
|---------|-------------|
| `docalign scan` | Scan entire repository |
| `docalign check <file>` | Check a single doc file |
| `docalign extract [file]` | Extract semantic claims using Claude |
| `docalign fix [file]` | Apply suggested fixes |
| `docalign init` | Set up Claude Code integration (MCP + skill) |
| `docalign viz` | Generate interactive knowledge graph |

See [CLI Reference](docs/reference/cli.md) for all commands, flags, and output formats.

## MCP Integration

DocAlign works as an MCP server, giving AI coding agents live access to documentation verification:

```bash
docalign init    # Auto-configures MCP + installs skill for Claude Code
<!-- docalign:skip reason="user_instruction" description="JSON snippet showing how to manually add docalign to an MCP config — user instruction showing example configuration, not a factual claim about the project's current state" -->
```

Or add manually to your MCP config:

```json
{
  "mcpServers": {
    "docalign": {
      "command": "npx",
      "args": ["docalign", "mcp", "--repo", "."]
<!-- /docalign:skip -->
    }
  }
}
```

10 tools available: `check_doc`, `check_section`, `get_doc_health`, `list_drift`, `get_docs_for_file`, `get_docs`, `fix_doc`, `report_drift`, `deep_check`, `register_claims`.

See [MCP Integration Guide](docs/guides/mcp-integration.md) for setup, or [MCP Tools Reference](docs/reference/mcp-tools.md) for tool details.

## Semantic Extraction

`docalign extract` uses Claude to find claims that regex can't catch — behavior descriptions, architecture decisions, config assumptions:

```bash
docalign extract                    # All doc files
docalign extract README.md          # Single file
docalign extract README.md --force  # Re-extract even if unchanged
```

See [Semantic Extraction Guide](docs/guides/semantic-extraction.md) for details.

## Configuration

<!-- docalign:skip reason="user_instruction" description="Sample .docalign.yml configuration block — illustrates what a user could put in their config file, not a factual claim about the project's current defaults or behaviour" -->
DocAlign works with zero configuration. To customize, create `.docalign.yml`:

```yaml
doc_patterns:
  include: ['README.md', 'docs/**/*.md']
  exclude: ['docs/archive/**']

claim_types:
  url_reference: false  # Skip dead link checks

verification:
  min_severity: medium  # Only report medium+ issues

suppress:
  - file: 'docs/legacy.md'  # Ignore this file entirely
```

<!-- /docalign:skip -->
See [Configuration Reference](docs/reference/configuration.md) for all options.

## How It Works

**Extract** verifiable claims from docs (regex + table parsing) → **Verify** each claim against the codebase (file existence, version comparison, AST symbol resolution) → **Report** results via CLI, MCP tools, or PR comments. Optional LLM verification handles claims that can't be checked deterministically.

See [How It Works](docs/explanation/how-it-works.md) for the full pipeline explanation.

## Documentation

**Getting started:** [Installation & first scan](docs/getting-started.md)

**Guides:** [Checking files](docs/guides/checking-files.md) · [Semantic extraction](docs/guides/semantic-extraction.md) · [MCP integration](docs/guides/mcp-integration.md) · [Fixing drift](docs/guides/fixing-drift.md) · [Suppressing findings](docs/guides/suppressing-findings.md) · [Custom configuration](docs/guides/custom-configuration.md)

**Reference:** [CLI](docs/reference/cli.md) · [Configuration](docs/reference/configuration.md) · [Checks](docs/reference/checks.md) · [MCP tools](docs/reference/mcp-tools.md)

**Explanation:** [How it works](docs/explanation/how-it-works.md) · [Verification tiers](docs/explanation/verification-tiers.md)

**Contributing:** [Architecture](docs/contributing/architecture.md) · [Design patterns](docs/contributing/design-patterns.md) · [Adding a check](docs/contributing/adding-a-check.md) · [Testing](docs/contributing/testing.md)

[Troubleshooting](docs/troubleshooting.md)

## License

MIT
