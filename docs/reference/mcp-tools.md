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

**Returns:** Acknowledgment with report ID.

## deep_check

Deep documentation audit combining syntactic and semantic analysis.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | string | yes | Path to doc file |

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

**Returns:** Count of registered claims and their IDs.
