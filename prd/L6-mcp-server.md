> Part of [DocAlign PRD](../PRD.md)

## 10. Layer 6: MCP Server

### 10.1 Purpose

Serve verified documentation to AI coding agents. Accept drift reports from agents. Bidirectional communication between DocAlign and coding agents.

### 10.2 Functional Requirements

**MCP server setup:**
- Works with Claude Code (via `~/.claude/settings.json`), Cursor (via `.cursor/mcp.json`), and other MCP-compatible agents
- Invoked as `npx @docalign/mcp-server --repo <path>`

**Tool 1: `get_docs`**
- Search project documentation for information about a topic
- Returns relevant documentation sections with verification status (verified, stale, uncertain)
- Option to filter to verified-only documentation
- Groups results by source file/section with health metadata

**Tool 2: `get_doc_health`**
- Check the freshness/accuracy status of a specific documentation file or the entire repo
- Accepts a file path, directory, or omit for repo-wide health
- Returns claim counts, verification status breakdown, health score

**Tool 3: `report_drift`**
- Agent reports a suspected documentation inaccuracy discovered while working with the code
- Accepts: doc file, line number, claim text, actual behavior description, evidence files
- Creates or links to existing claim record, queues re-verification

**Tool 4: `list_stale_docs`**
- List documentation files with known inaccuracies or that haven't been verified recently
- Useful for agents to know which docs to be cautious about before starting work

### 10.3 Server Architecture

MCP server reads from PostgreSQL, the same database used by the GitHub App. For local development, developers run PostgreSQL locally (e.g., via Docker or a local Postgres install).

**Local mode:**
- MCP server runs as a local process spawned by the agent's IDE/CLI
- Connects to PostgreSQL (local instance or remote hosted database)
- Reads repo files directly from the filesystem
- Writes drift reports to the database

**Remote mode (future):**
- Local MCP server proxies API calls to hosted DocAlign service (`api.docalign.dev`)
- For repos with GitHub App installed
- Connects to the same PostgreSQL backend (or a read replica)

### 10.4 Inputs and Outputs

**Inputs:**
- Agent queries (topic searches, health checks, drift reports)
- PostgreSQL database

**Outputs:**
- Documentation sections with verification metadata
- Health scores and claim breakdowns
- Drift report acknowledgments

### 10.5 Open Questions

(None currently -- MCP is a v2 feature.)

> Technical detail: see phases/technical-reference.md Section 3.7 (MCP tool schemas, server architecture diagrams)

