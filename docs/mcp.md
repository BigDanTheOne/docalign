# MCP Integration

DocAlign includes a Model Context Protocol (MCP) server that gives AI coding agents live access to documentation verification. Works with Claude Code, Cursor, and any MCP-compatible client.

## Setup

### Quick Setup (Claude Code)

```bash
docalign init
```

This automatically:
1. Adds the DocAlign MCP server to `.claude/mcp.json`
2. Installs the `docalign` skill

### Manual Setup

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

## Tools

### check_doc

Check a specific documentation file for drift against the codebase.

**Parameters:**
- `file` (string, required) -- Path to the doc file relative to repo root

**Returns:** Total claims, verified count, drifted count, duration, and detailed findings for each drifted claim (claim text, type, line, severity, reasoning, suggested fix, evidence files).

### check_section

Check a specific section of a doc file by heading.

**Parameters:**
- `file` (string, required) -- Path to the doc file
- `heading` (string, required) -- Section heading text (e.g., "Installation", "API Reference")

**Returns:** Same as `check_doc` but scoped to the specified section.

### get_doc_health

Get the overall documentation health score for the repository.

**Parameters:** None

**Returns:** Health score (0-100), total claims scored, verified/drifted counts, doc files scanned, duration, and top 10 hotspot files ranked by drift count.

### list_drift

List all documentation files with drift, ordered by severity.

**Parameters:**
- `max_results` (number, optional, default 20) -- Maximum files to return (1-50)

**Returns:** List of stale doc files with their drifted claim count, plus total count of files with drift.

### get_docs_for_file

Reverse lookup: find all documentation claims that reference a specific code file.

**Parameters:**
- `file_path` (string, required) -- Path to the code file relative to repo root

**Returns:** List of referencing docs with doc file, line number, claim text, claim type, verdict, and severity.

### get_docs

Search project documentation by topic. Returns relevant doc sections ranked by multi-signal relevance scoring.

**Parameters:**
- `query` (string, required) -- Topic to search for (e.g., "authentication", "deployment")
- `verified_only` (boolean, optional, default false) -- Only return sections where all claims are verified
- `max_results` (number, optional, default 10) -- Max sections to return (1-50)

**Returns:** Ranked doc sections with content, verification status, and relevance score.

### fix_doc

Generate fix suggestions for drifted documentation claims in a file.

**Parameters:**
- `file` (string, required) -- Path to the doc file

**Returns:** List of fixes with line number, claim text, severity, and fix details (either LLM-generated line-level replacements or deterministic suggestions).

### report_drift

Report a documentation inaccuracy discovered during work. Stores the report locally for tracking.

**Parameters:**
- `doc_file` (string, required) -- Documentation file with the inaccuracy
- `claim_text` (string, required) -- The inaccurate text in the doc
- `actual_behavior` (string, required) -- What the code actually does
- `line_number` (number, optional) -- Approximate line number
- `evidence_files` (string[], optional) -- Code files showing actual behavior

**Returns:** Acknowledgment with report ID.

### deep_check

Deep documentation audit combining syntactic and semantic analysis.

**Parameters:**
- `file` (string, required) -- Path to the doc file

**Returns:**
- **Syntactic findings:** All regex-extracted claims with verification results
- **Semantic findings:** All LLM-extracted claims from `.docalign/semantic/` with their verification status
- **Unchecked sections:** Doc sections with no claims (candidates for `docalign extract`)
- **Coverage:** Percentage of sections that have at least one claim
- **Warnings:** e.g., "No semantic claims stored. Run `docalign extract` first."

### register_claims

Persist semantic claims discovered during agent analysis. Stores them to `.docalign/semantic/` for future verification.

**Parameters:**
- `claims` (array, required) -- Array of claim objects:
  - `source_file` (string) -- Doc file path
  - `line_number` (number) -- Line in the doc
  - `claim_text` (string) -- The claim text
  - `claim_type` (`'behavior' | 'architecture' | 'config'`)
  - `keywords` (string[])
  - `evidence_entities` (array, optional) -- `[{ symbol, file }]`
  - `evidence_assertions` (array, optional) -- `[{ pattern, scope, expect, description }]`
  - `verification` (object, optional) -- `{ verdict, confidence, reasoning }`

**Returns:** Count of registered claims and their IDs.

## Usage Patterns

### "I just changed code, what docs need updating?"

```
Use get_docs_for_file with the changed code file path.
```

This finds all documentation claims that reference your code file, showing which docs might be stale after your change.

### "Is the README accurate?"

```
Use check_doc with "README.md" for a quick check.
Use deep_check with "README.md" for a thorough audit.
```

`check_doc` runs syntactic checks. `deep_check` adds semantic claims and shows unchecked sections.

### "Find documentation about authentication"

```
Use get_docs with query "authentication".
```

Returns doc sections about authentication ranked by relevance, with verification status showing whether the content matches the actual code.

### "Fix all stale documentation"

```
1. Use list_drift to see which files have drift.
2. Use fix_doc on each file to get fix suggestions.
```

### "Report a doc error I noticed"

```
Use report_drift with the file, the wrong text, and what the code actually does.
```

Reports are stored locally in `.docalign/reports/` for tracking.

### "Get an overview of doc quality"

```
Use get_doc_health.
```

Returns a 0-100 health score, total verified vs drifted claims, and the worst-offending files.
