# MCP Setup Example

Shows how to configure DocAlign as an MCP server for Claude Code.

## Contents

- `settings.json` — MCP server configuration for Claude Code

## Setup

1. Copy the `mcpServers` entry from `settings.json` into your
   Claude Code MCP settings (`.claude/settings.json` or equivalent)
2. Restart Claude Code to pick up the new server
3. Claude can now use `check_doc`, `scan_docs`, `get_docs`,
   and `register_claims` tools to monitor your documentation

## Tools Available

| Tool | Description |
|------|-------------|
| `check_doc` | Check a doc for drift against code |
| `scan_docs` | Repo-wide health score |
| `get_docs` | Search docs by topic or code file |
| `register_claims` | Persist semantic claims |
