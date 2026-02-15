# DocAlign -- Agent Instructions

DocAlign detects documentation drift. Use it to verify that documentation matches code reality.

## Available via MCP

When the DocAlign MCP server is running, you have 10 tools:

| Tool | Use When |
|------|----------|
| `check_doc` | You need to verify a specific doc file |
| `check_section` | You need to verify one section of a doc |
| `get_doc_health` | You need an overall quality score |
| `list_drift` | You need to find which docs have problems |
| `get_docs_for_file` | You changed code and need to know which docs reference it |
| `get_docs` | You need to find documentation about a topic |
| `fix_doc` | You need fix suggestions for drifted claims |
| `report_drift` | You found a doc inaccuracy during work |
| `deep_check` | You need a thorough audit (syntactic + semantic) |
| `register_claims` | You want to persist semantic claims you discovered |

## Available via CLI

```bash
docalign scan                     # Scan entire repo for drift
docalign check <file>             # Check one doc file
docalign check <file> --verbose   # Show all claims, not just drifted
docalign extract [file]           # Extract semantic claims via Claude
docalign fix [file]               # Generate fix suggestions
docalign status                   # Show config and integration status
```

## Common Workflows

**After changing code:** Run `get_docs_for_file` with the changed file path to find docs that may need updating.

**Before a PR:** Run `docalign scan` or use `get_doc_health` to check overall documentation accuracy.

**Deep audit:** Use `deep_check` on a file to get syntactic + semantic findings and see unchecked sections.

## Configuration

DocAlign works with zero config. Customize via `.docalign.yml` at repo root. See [docs/reference/configuration.md](docs/reference/configuration.md).

## Key Concepts

- **Claim**: A verifiable statement extracted from documentation (file path, version, command, etc.)
- **Verdict**: `verified` (matches code), `drifted` (contradicts code), `uncertain` (can't determine)
- **Severity**: `low`, `medium`, `high` -- how impactful the drift is
- **Health score**: 0-100 based on verified / (verified + drifted) ratio

## Deep Dive

- Full documentation: [docs/](docs/)
- How verification works: [docs/explanation/how-it-works.md](docs/explanation/how-it-works.md)
- All checks: [docs/reference/checks.md](docs/reference/checks.md)
- All MCP tools: [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md)
