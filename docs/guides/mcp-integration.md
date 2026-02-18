# MCP Integration

DocAlign includes a Model Context Protocol (MCP) server that gives AI coding agents live access to documentation verification. Works with Claude Code, Cursor, and any MCP-compatible client.

## Quick setup (Claude Code)
<!-- docalign:skip reason="user_instruction" description="Quick setup section (docalign:skip already present) telling the reader to run 'docalign init' — user instructions with setup steps" -->

```bash
docalign init
```

This automatically:
1. Adds the DocAlign MCP server to `.claude/mcp.json`
2. Installs the `docalign` skill

After setup, your AI agent has 10 documentation tools available.

## Manual setup
<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Manual setup instructions (docalign:skip already present) telling the reader to add a JSON config block to their MCP config file — illustrative config template" -->

Add to your MCP config (`.claude/mcp.json` for Claude Code, or equivalent for other clients):

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

## What agents can do

<!-- /docalign:skip -->
With MCP integration, your AI agent can:

### Find docs affected by code changes

After changing `src/auth/middleware.ts`:

<!-- docalign:skip reason="illustrative_example" description="Example showing hypothetical agent usage with 'src/auth/middleware.ts' — illustrative usage template, not a claim about project behavior" -->
```
Use get_docs_for_file with file_path="src/auth/middleware.ts"
```

Returns all doc claims that reference that file, showing which docs might need updating.

### Check if documentation is accurate

```
<!-- /docalign:skip -->
Use check_doc with file="README.md" for a quick check
<!-- docalign:skip reason="illustrative_example" description="Example showing how an agent would invoke check_doc and deep_check with 'README.md' — illustrative usage instructions" -->
Use deep_check with file="README.md" for a thorough audit
```

`check_doc` runs syntactic checks. `deep_check` adds semantic claims and shows unchecked sections.

### Search documentation by topic

```
<!-- /docalign:skip -->
Use get_docs with query="authentication"
<!-- docalign:skip reason="illustrative_example" description="Example showing agent usage of get_docs with query='authentication' — illustrative usage template" -->
```

Returns doc sections about authentication ranked by relevance, with verification status.

### Fix stale documentation

```
<!-- /docalign:skip -->
1. Use list_drift to see which files have drift
<!-- docalign:skip reason="user_instruction" description="Step-by-step instructions telling the reader to use list_drift then fix_doc — user instructions" -->
2. Use fix_doc on each file to get fix suggestions
```

### Report a doc error found during work

```
<!-- /docalign:skip -->
Use report_drift with the file, the wrong text, and what the code actually does
<!-- docalign:skip reason="user_instruction" description="Instructions telling the reader to use report_drift — user instructions" -->
```

Reports are stored locally in `.docalign/reports/` for tracking.

### Get a quality overview

```
<!-- /docalign:skip -->
Use get_doc_health
<!-- docalign:skip reason="user_instruction" description="Instructions telling the reader to use get_doc_health — user instructions" -->
```

Returns a 0-100 health score, verified vs drifted counts, and the worst files.

## Verify it's working

Run `docalign status` to check MCP integration status. Or ask your AI agent to run `get_doc_health` -- if it returns a score, the integration is working.
<!-- /docalign:skip -->

<!-- docalign:skip reason="user_instruction" description="Instructions telling the reader to run 'docalign status' or ask agent to run 'get_doc_health' — user instructions (docalign:skip already present)" -->
## All 10 tools

See [MCP Tools Reference](../reference/mcp-tools.md) for complete documentation of every tool with parameters and return values.

<!-- /docalign:skip -->