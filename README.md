# DocAlign

Detects when your documentation drifts from code reality.

DocAlign scans your repo, extracts verifiable claims from documentation (file paths, dependency versions, commands, API routes, code examples, config values, URLs, and more), and checks each one against the actual codebase. Works as a CLI, as an MCP server for AI coding agents, or both.

## Quick Start

```bash
npx docalign scan
```

Check a single file with detailed output:

```bash
npx docalign check README.md --verbose
```

No configuration needed. DocAlign auto-discovers doc files and applies sensible defaults.

## What It Finds

**Syntactic checks** (regex-based, zero config):

| Category | Examples |
|----------|----------|
| File paths | `src/auth.ts` referenced but doesn't exist |
| Dependency versions | README says `express 4.17` but package.json has `4.18` |
| CLI commands | `npm run deploy` but no `deploy` script in package.json |
| API routes | `GET /api/users` not found in Express/Flask/FastAPI handlers |
| Code examples | Import of `./utils/helpers` but file doesn't export that symbol |
| Environment variables | `DATABASE_URL` documented but not in `.env` or `.env.example` |
| Conventions | "Uses TypeScript strict mode" but `tsconfig.json` says otherwise |
| Config values | "Defaults to port 3000" but code uses 8080 |
| URLs | Dead links (HTTP 404) in documentation |
| Image/asset refs | `![logo](assets/logo.png)` but file missing |
| Table claims | Versions, paths, and commands inside markdown tables |

**Cross-cutting checks:**

- Anchor validation -- `[Setup](#setup)` links to a heading that doesn't exist
- Cross-doc consistency -- `docs/setup.md` says port 3000, `docs/deploy.md` says 8080
- Frontmatter consistency -- YAML `title:` doesn't match the first `# Heading`
- Navigation configs -- Broken links in `mkdocs.yml`, `_sidebar.md`, `mint.json`
- Deprecation detection -- Code has `@deprecated` but docs still reference it
- License consistency -- README says MIT but `package.json` says Apache-2.0
- Changelog consistency -- Latest CHANGELOG entry doesn't match package version
- Fuzzy suggestions -- "Package 'expresss' not found. Did you mean 'express'?"

**Semantic checks** (LLM-powered, optional):

- Behavior claims: "Authentication uses JWT tokens" -- verified against actual auth code
- Architecture decisions: "Services communicate via REST" -- checked against imports
- Config assumptions: "Rate limited to 100 req/min" -- verified against middleware

See [docs/checks.md](docs/checks.md) for the complete reference.

## Commands

| Command | Description |
|---------|-------------|
| `docalign scan` | Scan entire repository |
| `docalign check <file>` | Check a single doc file |
| `docalign extract [file]` | Extract semantic claims using Claude |
| `docalign fix [file]` | Apply suggested fixes |
| `docalign status` | Show configuration and integration status |
| `docalign configure` | Create or update `.docalign.yml` |
| `docalign init` | Set up Claude Code integration (MCP + skill) |
| `docalign viz` | Generate interactive knowledge graph |
| `docalign mcp` | Start MCP server (used by Claude Code) |
| `docalign help` | Show help |

See [docs/cli.md](docs/cli.md) for flags, options, and output formats.

## MCP Integration

DocAlign works as an MCP server, giving AI coding agents live access to documentation verification:

```bash
docalign init    # Auto-configures MCP + installs skill for Claude Code
```

Or add manually to your MCP config:

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

10 tools available: `check_doc`, `check_section`, `get_doc_health`, `list_drift`, `get_docs_for_file`, `get_docs`, `fix_doc`, `report_drift`, `deep_check`, `register_claims`.

See [docs/mcp.md](docs/mcp.md) for tool descriptions and usage patterns.

## Semantic Extraction

`docalign extract` uses Claude to find claims that regex can't catch -- behavior descriptions, architecture decisions, config assumptions. Claude reads the actual code, writes grep-verifiable assertions, and self-checks them before returning.

```bash
docalign extract                    # All doc files
docalign extract README.md          # Single file
docalign extract README.md --force  # Re-extract even if unchanged
```

Extracted claims are stored in `.docalign/semantic/` and verified on every `docalign check` and `docalign scan`.

See [docs/semantic-extraction.md](docs/semantic-extraction.md) for details.

## Configuration

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
  - package: 'internal-pkg'  # Ignore this package
```

See [docs/configuration.md](docs/configuration.md) for all 14 config sections with defaults.

## How It Works

DocAlign follows a three-stage pipeline: **extract** verifiable claims from docs using regex patterns and table parsing, **verify** each claim against the codebase using deterministic checks (file existence, version comparison, AST symbol resolution), and **report** results via CLI, MCP tools, or PR comments. Optional LLM verification handles claims that can't be checked deterministically.

See [docs/how-it-works.md](docs/how-it-works.md) for the full pipeline explanation.

## LLM Verification (Optional)

Set `ANTHROPIC_API_KEY` to enable Tier 3 LLM-powered verification and fix generation:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docalign scan
```

## License

MIT
