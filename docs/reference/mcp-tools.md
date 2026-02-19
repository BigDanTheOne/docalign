---
title: "MCP Tools Reference"
summary: "Complete reference for all 4 DocAlign MCP tools with parameters and return values."
description: "Documents all 4 MCP tools: check_doc (file drift check, optional section and deep params), scan_docs (repo health score + hotspot list, max_results), get_docs (topic search and code-file reverse lookup), register_claims (persist semantic claims to .docalign/semantic/)."
category: reference
read_when:
  - You need exact parameter names and types for an MCP tool
  - You want to understand what an MCP tool returns
  - You are building an integration with DocAlign's MCP server
related:
  - docs/guides/mcp-integration.md
  - docs/guides/checking-files.md
  - docs/guides/semantic-extraction.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# MCP Tools Reference

<!-- docalign:semantic id="sem-b3917ca98905a59a" -->
DocAlign exposes 4 tools via the Model Context Protocol. Each tool is documented with its parameters and return format.

## check_doc

Check a documentation file for drift against the codebase. Can optionally scope the check to a specific section, or run a full deep audit that includes semantic claims and unchecked sections.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `file` | string | yes | -- | Path to doc file relative to repo root |
| `section` | string | no | -- | Section heading to scope the check to (e.g., "Installation"). If omitted, checks the whole file. |
| `deep` | boolean | no | false | If true, includes semantic claims, unchecked sections, and coverage metrics in addition to syntactic claims. |

**Returns:** Total claims, verified count, drifted count, duration, and detailed findings for each drifted claim (claim text, type, line, severity, reasoning, evidence files). When `deep=true`, also returns semantic findings, unchecked sections, coverage stats, and warnings.

## scan_docs

Scan the repository for documentation drift. Returns a health score for the whole repo plus an ordered list of files with the most drift.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `max_results` | number | no | 20 | Maximum hotspot files to return (1-50) |

<!-- docalign:semantic id="sem-53f2f1e80e34ab6e" -->
**Returns:** Health score (0-100), total claims scored, verified/drifted counts, doc files scanned, duration, and ordered hotspot list (file + drifted claim count) limited to `max_results`.

## get_docs

Search project documentation by topic, or find all docs that reference a specific code file. Provide `query` for topic search, `code_file` for reverse lookup, or both to get combined results.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | no | -- | Topic to search for (e.g., "authentication", "API endpoints") |
| `code_file` | string | no | -- | Code file path (relative to repo root) to find docs that reference it |
<!-- docalign:semantic id="sem-2ad0bbee3a2316c7" -->
| `verified_only` | boolean | no | false | Only return sections where all claims are verified |
<!-- docalign:semantic id="sem-d1c8a6b737b72872" -->
| `max_results` | number | no | 10 | Max results to return (1-50) |

At least one of `query` or `code_file` is required.

**Returns:** When `query` provided: ranked doc sections with content, verification status, and relevance score. When `code_file` provided: list of referencing docs with doc file, line number, claim text, verdict, and severity.

## register_claims

<!-- docalign:semantic id="sem-bf455f64c4746bc2" -->
Persist semantic claims discovered during agent analysis. Stores them to `.docalign/semantic/` for future verification.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `claims` | array | yes | Array of claim objects (see below) |

**Claim object fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_file` | string | yes | Doc file path |
| `line_number` | number | yes | Line in the doc |
| `claim_text` | string | yes | The claim text |
| `claim_type` | `'behavior' \| 'architecture' \| 'config'` | yes | Claim category |
| `keywords` | string[] | yes | Search indexing keywords |
| `evidence_entities` | `[{ symbol, file }]` | no | Code symbols referenced |
| `evidence_assertions` | `[{ pattern, scope, expect, description }]` | no | Grep-verifiable patterns |
| `verification` | `{ verdict, confidence, reasoning }` | no | Pre-verification result |

**Returns:** Count of registered claims and their IDs.
