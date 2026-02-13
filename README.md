# DocAlign

Detects when your documentation drifts from code reality.

DocAlign scans your repo, extracts verifiable claims from docs (file paths, commands, dependency versions, API routes, code examples, environment variables, conventions), and checks them against the actual codebase.

## Quick Start

```bash
npx docalign scan
```

Or check a single file:

```bash
npx docalign check README.md --verbose
```

## What It Finds

- File paths that no longer exist
- CLI commands referencing missing npm scripts
- Dependency versions that don't match package.json
- API routes not defined in code
- Code examples with broken imports or missing symbols
- Environment variables documented but not configured
- Convention claims (strict mode, frameworks) that don't match config

## Commands

```
docalign scan              Scan entire repository
docalign check <file>      Check a single doc file
docalign extract [file]    Extract semantic claims using Claude (requires ANTHROPIC_API_KEY)
docalign fix [file]        Apply suggested fixes (requires ANTHROPIC_API_KEY)
docalign status            Show configuration and integration status
docalign configure         Create or update .docalign.yml
docalign init              Set up Claude Code integration (MCP + skill)
```

## Semantic Extraction

`docalign extract` uses Claude to find claims that regex can't catch: behavior descriptions, architecture decisions, config assumptions. Claude reads the actual code, writes grep-verifiable assertions, and self-checks them before returning.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docalign extract                    # All doc files
docalign extract README.md          # Single file
docalign extract README.md --force  # Re-extract even if unchanged
```

Extracted claims are stored in `.docalign/semantic/` and verified on every `docalign check`.

## LLM Verification (Optional)

Set `ANTHROPIC_API_KEY` to enable Tier 3 LLM-powered verification for claims that can't be checked deterministically:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docalign scan
```

## MCP Server

DocAlign includes an MCP server for Claude Code / Cursor integration:

```bash
docalign init    # Auto-configures MCP + installs skill
```

Or manually add to your MCP config:

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

## License

MIT
