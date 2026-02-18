---
title: "MCP Tools Reference"
summary: "Complete reference for all 10 DocAlign MCP tools with parameters, required fields, and return formats."
description: "Documents: check_doc (file → claims/verified/drifted/findings), check_section (file+heading → scoped results), get_doc_health (no params → score 0-100/counts/top 10 hotspots), list_drift (max_results → drifted files), get_docs_for_file (file_path → referencing claims with verdicts), get_docs (query/verified_only/max_results → ranked sections), fix_doc (file → fixes with LLM or deterministic suggestions), report_drift (doc_file/claim_text/actual_behavior/line_number/evidence_files → report ID), deep_check (file → syntactic+semantic findings/unchecked sections/coverage/warnings), register_claims (claims array with source_file/line_number/claim_text/claim_type/keywords/evidence_entities/evidence_assertions/verification → count+IDs)."
category: reference
read_when:
  - You need the exact parameter name or type for an MCP tool call
  - You are building an integration that uses DocAlign MCP tools
  - You need to know what a tool returns to process the response
related:
  - AGENTS.md
  - docs/guides/mcp-integration.md
  - docs/guides/semantic-extraction.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# MCP Tools Reference

DocAlign exposes 10 tools via the Model Context Protocol. Each tool is documented with its parameters and return format.

## check_doc

Check a specific documentation file for drift against the codebase.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | yes | Path to doc file relative to repo root |

**Returns:** Total claims, verified count, drifted count, duration, and detailed findings for each drifted claim (claim text, type, line, severity, reasoning, suggested fix, evidence files).

## check_section

Check a specific section of a doc file by heading.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | yes | Path to doc file |
| `heading` | string | yes | Section heading text (e.g., "Installation") |

**Returns:** Same as `check_doc` but scoped to the specified section.

## get_doc_health

Get the overall documentation health score for the repository.

**Parameters:** None.

<!-- docalign:semantic id="sem-758713738bb5579f" claim="get_doc_health returns health score (0-100), total claims scored, verified/drifted counts, doc files scanned, duration, and top 10 hotspot files ranked by drift count" -->
**Returns:** Health score (0-100), total claims scored, verified/drifted counts, doc files scanned, duration, and top 10 hotspot files ranked by drift count.

## list_drift

List all documentation files with drift, ordered by severity.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `max_results` | number | no | 20 | Maximum files to return (1-50) |

**Returns:** List of stale doc files with their drifted claim count, plus total count of files with drift.

## get_docs_for_file

Reverse lookup: find all documentation claims that reference a specific code file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file_path` | string | yes | Path to code file relative to repo root |

**Returns:** List of referencing docs with doc file, line number, claim text, claim type, verdict, and severity.

## get_docs

Search project documentation by topic. Returns relevant doc sections ranked by multi-signal relevance scoring.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | yes | -- | Topic to search for (e.g., "authentication") |
| `verified_only` | boolean | no | false | Only return sections where all claims are verified |
| `max_results` | number | no | 10 | Max sections to return (1-50) |

**Returns:** Ranked doc sections with content, verification status, and relevance score.

## fix_doc

Generate fix suggestions for drifted documentation claims in a file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | yes | Path to doc file |

**Returns:** List of fixes with line number, claim text, severity, and fix details (either LLM-generated line-level replacements or deterministic suggestions).

## report_drift

Report a documentation inaccuracy discovered during work. Stores the report locally for tracking.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `doc_file` | string | yes | Documentation file with the inaccuracy |
| `claim_text` | string | yes | The inaccurate text in the doc |
| `actual_behavior` | string | yes | What the code actually does |
| `line_number` | number | no | Approximate line number |
| `evidence_files` | string[] | no | Code files showing actual behavior |

<!-- docalign:semantic id="sem-6f9f8b1f3b0a2e4f" claim="report_drift stores the report locally and returns acknowledgment with report ID" -->
**Returns:** Acknowledgment with report ID.

## deep_check

Deep documentation audit combining syntactic and semantic analysis.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | yes | Path to doc file |

<!-- docalign:semantic id="sem-a7d333f3ef268b6f" claim="deep_check returns syntactic findings, semantic findings from .docalign/semantic/, unchecked sections, coverage percentage, and warnings" -->
**Returns:**
- **Syntactic findings:** All regex-extracted claims with verification results
- **Semantic findings:** All LLM-extracted claims from `.docalign/semantic/` with verification status
- **Unchecked sections:** Doc sections with no claims (candidates for `docalign extract`)
- **Coverage:** Percentage of sections with at least one claim
- **Warnings:** e.g., "No semantic claims stored. Run `docalign extract` first."

## register_claims

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

<!-- docalign:semantic id="sem-b1d03e3311715859" claim="register_claims persists claims to .docalign/semantic/ and returns count and IDs" -->
**Returns:** Count of registered claims and their IDs.
