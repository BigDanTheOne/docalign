---
title: "MCP Tools Reference"
summary: "Complete reference for all 10 DocAlign MCP tools with parameters and return values."
description: "Documents all 10 MCP tools: check_doc (file drift check), check_section (heading-scoped check), get_doc_health (repo health score 0-100, top 10 hotspots), list_drift (files with drift, max_results), get_docs_for_file (reverse lookup by code file), get_docs (semantic search, verified_only, max_results), fix_doc (fix suggestions), report_drift (manual drift reporting, stored in .docalign/reports/), deep_check (syntactic + semantic + unchecked sections), register_claims (persist semantic claims to .docalign/semantic/)."
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

<!-- docalign:semantic id="sem-b3917ca98905a59a" claim="DocAlign exposes 10 tools via the Model Context Protocol" -->
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

<!-- docalign:semantic id="sem-53f2f1e80e34ab6e" claim="top 10 hotspot files ranked by drift count" -->
**Returns:** Health score (0-100), total claims scored, verified/drifted counts, doc files scanned, duration, and top 10 hotspot files ranked by drift count.

## list_drift

List all documentation files with drift, ordered by severity.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
<!-- docalign:semantic id="sem-dde552c7c3a8f016" claim="list_drift max_results default is 20, maximum is 50" -->
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
<!-- docalign:semantic id="sem-2ad0bbee3a2316c7" claim="get_docs verified_only defaults to false" -->
| `verified_only` | boolean | no | false | Only return sections where all claims are verified |
<!-- docalign:semantic id="sem-d1c8a6b737b72872" claim="get_docs max_results default is 10, maximum is 50" -->
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

<!-- docalign:semantic id="sem-b7c9965117bd6abb" claim="report_drift stores the report locally in .docalign/reports/" -->
Report a documentation inaccuracy discovered during work. Stores the report locally for tracking.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `doc_file` | string | yes | Documentation file with the inaccuracy |
| `claim_text` | string | yes | The inaccurate text in the doc |
| `actual_behavior` | string | yes | What the code actually does |
| `line_number` | number | no | Approximate line number |
| `evidence_files` | string[] | no | Code files showing actual behavior |

**Returns:** Acknowledgment with report ID.

## deep_check

Deep documentation audit combining syntactic and semantic analysis.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | yes | Path to doc file |

<!-- docalign:semantic id="sem-3d696512828525c6" claim="deep_check returns syntactic findings, semantic findings, unchecked sections, coverage, and warnings" -->
**Returns:**
- **Syntactic findings:** All regex-extracted claims with verification results
- **Semantic findings:** All LLM-extracted claims from `.docalign/semantic/` with verification status
- **Unchecked sections:** Doc sections with no claims (candidates for `docalign extract`)
- **Coverage:** Percentage of sections with at least one claim
- **Warnings:** e.g., "No semantic claims stored. Run `docalign extract` first."

## register_claims

<!-- docalign:semantic id="sem-bf455f64c4746bc2" claim="register_claims stores claims to .docalign/semantic/ for future verification" -->
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
