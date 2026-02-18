---
title: "Configuration Reference"
summary: "Complete reference for all .docalign.yml configuration sections, fields, types, defaults, and examples."
description: "Covers zero-config defaults, full YAML example, and all 14 configuration sections: doc_patterns (include/exclude globs with default patterns), code_patterns, verification (min_severity, max_claims_per_pr, auto_fix, auto_fix_threshold), claim_types (11 boolean toggles), suppress (file/pattern/claim_type/package rules, max 200), schedule (full_scan frequency), agent (concurrency, timeout_seconds), trigger (on_pr_open, on_push, on_ready_for_review, on_command), llm (verification_model, extraction_model, embedding_model), check (min_severity_to_block), mapping (semantic_threshold, path1_max_evidence_tokens, max_agent_files_per_claim), url_check (enabled, timeout_ms, max_per_domain, exclude_domains), coverage (enabled, min_entity_importance). Includes error handling codes E501/E502."
category: reference
read_when:
  - You need to know every configuration option and its default
  - You want to understand what error codes mean in docalign status
  - You are writing or reviewing a .docalign.yml file
related:
  - docs/guides/custom-configuration.md
  - docs/guides/suppressing-findings.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Configuration Reference

DocAlign works with zero configuration. All settings have sensible defaults. To customize, create `.docalign.yml` at your repo root.

## Zero-Config Behavior

With no config file, DocAlign:
- Scans `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**/*.md`, and similar patterns
- Excludes `node_modules/`, `vendor/`, `.git/`, `CHANGELOG.md`, `LICENSE.md`
- Enables all 11 claim types
- Reports all severities (low, medium, high)
<!-- docalign:semantic id="sem-bfb95a67c763998c" claim="max_claims_per_pr defaults to 50" -->
- Checks up to 50 claims per PR
<!-- docalign:semantic id="sem-c4b30f44787c9cb0" claim="url check timeout defaults to 5000ms" -->
<!-- docalign:semantic id="sem-9cc4fce5b07901d5" claim="url check max per domain defaults to 5" -->
- Checks URLs with 5s timeout, max 5 per domain

## Full Example

<!-- docalign:skip reason="illustrative_example" description="Full YAML configuration example showing all options with illustrative values, not factual claims about current defaults" -->
```yaml
# .docalign.yml

doc_patterns:
  include:
    - 'README.md'
    - 'docs/**/*.md'
  exclude:
    - 'docs/archive/**'

code_patterns:
  include: ['**']
  exclude: ['node_modules/**', 'dist/**']

verification:
  min_severity: low
  max_claims_per_pr: 50
  auto_fix: false
  auto_fix_threshold: 0.9

claim_types:
  path_reference: true
  dependency_version: true
  command: true
  api_route: true
  code_example: true
  behavior: true
  architecture: true
  config: true
  convention: true
  environment: true
  url_reference: true

suppress:
  - file: 'docs/legacy.md'
  - pattern: 'internal-.*'
  - claim_type: url_reference
  - package: 'private-pkg'

schedule:
  full_scan: weekly
  full_scan_day: sunday

agent:
  concurrency: 5
  timeout_seconds: 120

trigger:
  on_pr_open: true
  on_push: false
  on_ready_for_review: true
  on_command: true

llm:
  verification_model: claude-sonnet-4-20250514
  extraction_model: claude-sonnet-4-20250514
  embedding_model: text-embedding-3-small
  embedding_dimensions: 1536

check:
  min_severity_to_block: null

mapping:
  semantic_threshold: 0.7
  path1_max_evidence_tokens: 8000
  max_agent_files_per_claim: 10

url_check:
  enabled: true
  timeout_ms: 5000
  max_per_domain: 5
  exclude_domains: []

coverage:
  enabled: false
  min_entity_importance: exported
```
<!-- /docalign:skip -->

## Sections

### doc_patterns

Controls which documentation files are scanned.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `include` | `string[]` | See below | Glob patterns for doc files to include |
| `exclude` | `string[]` | See below | Glob patterns for doc files to exclude |

<!-- docalign:semantic id="sem-37d5923b20b66dc8" claim="default include patterns include readme.md, contributing.md, architecture.md, claude.md, agents.md, docs/**/*.md" -->
**Default include:** `README.md`, `README.mdx`, `README.rst`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `COPILOT-INSTRUCTIONS.md`, `.cursorrules`, `docs/**/*.md`, `docs/**/*.mdx`, `doc/**/*.md`, `wiki/**/*.md`, `adr/**/*.md`, `ADR-*.md`, `**/CLAUDE.md`, `**/AGENTS.md`, `api/**/*.md`

<!-- docalign:semantic id="sem-9d38781c65ffd830" claim="default exclude patterns are node_modules/**, vendor/**, .git/**, **/changelog.md, **/license.md" -->
**Default exclude:** `node_modules/**`, `vendor/**`, `.git/**`, `**/CHANGELOG.md`, `**/LICENSE.md`

### code_patterns

Controls which code files are indexed for verification.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `include` | `string[]` | `['**']` | Glob patterns for code files |
| `exclude` | `string[]` | See below | Glob patterns to exclude |

**Default exclude:** `node_modules/**`, `.git/**`, `dist/**`, `build/**`, `vendor/**`, `__pycache__/**`

### verification

Controls verification behavior.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
<!-- docalign:semantic id="sem-87cf951e9eee906c" claim="min_severity defaults to 'low'" -->
| `min_severity` | `'low' \| 'medium' \| 'high'` | `'low'` | Minimum severity to report |
<!-- docalign:semantic id="sem-01d74ba41446a85a" claim="max_claims_per_pr defaults to 50" -->
| `max_claims_per_pr` | `number` (1-200) | `50` | Max claims to verify per PR scan |
<!-- docalign:semantic id="sem-c4e61a8eedc1704f" claim="auto_fix defaults to false" -->
| `auto_fix` | `boolean` | `false` | Automatically apply high-confidence fixes |
<!-- docalign:semantic id="sem-2364081f258f7429" claim="auto_fix_threshold defaults to 0.9" -->
| `auto_fix_threshold` | `number` (0.5-1.0) | `0.9` | Minimum confidence for auto-fix |

### claim_types

Enable or disable specific claim type extraction. Set to `false` to skip extraction and verification for that type.

| Field | Type | Default |
|-------|------|---------|
| `path_reference` | `boolean` | `true` |
| `dependency_version` | `boolean` | `true` |
| `command` | `boolean` | `true` |
| `api_route` | `boolean` | `true` |
| `code_example` | `boolean` | `true` |
| `behavior` | `boolean` | `true` |
| `architecture` | `boolean` | `true` |
| `config` | `boolean` | `true` |
| `convention` | `boolean` | `true` |
| `environment` | `boolean` | `true` |
| `url_reference` | `boolean` | `true` |

### suppress

Suppress specific findings. Each rule is an object with at least one field. Multiple fields in a rule are AND-combined.

| Field | Type | Description |
|-------|------|-------------|
| `file` | `string` | Suppress all findings in this file (glob pattern) |
| `pattern` | `string` | Suppress findings matching this regex |
| `claim_type` | `string` | Suppress all findings of this claim type |
| `package` | `string` | Suppress findings about this package |

**Examples:**

```yaml
suppress:
  # Ignore an entire file
  - file: 'docs/legacy.md'

  # Ignore a specific pattern across all files
  - pattern: 'internal-.*-service'
# Ignore all URL checks
  - claim_type: url_reference

  # Ignore a specific package
  - package: '@internal/private-pkg'

  # Combine: ignore path claims in a specific file
  - file: 'docs/examples.md'
    claim_type: path_reference
```

<!-- docalign:semantic id="sem-d9e1392b85ba6f3e" claim="max 200 suppress rules" -->
Max 200 suppress rules.

### schedule

Controls automated full scans (server mode).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
<!-- docalign:semantic id="sem-a1b407d08ef5d9ea" claim="full_scan defaults to weekly" -->
| `full_scan` | `'daily' \| 'weekly' \| 'monthly' \| 'never'` | `'weekly'` | Full scan frequency |
<!-- docalign:semantic id="sem-55478243183ace36" claim="full_scan_day defaults to sunday" -->
| `full_scan_day` | `string` | `'sunday'` | Day of week for weekly scans |

### agent

Controls the agent execution environment (server mode).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
<!-- docalign:semantic id="sem-f710a085191679e2" claim="agent concurrency defaults to 5" -->
| `concurrency` | `number` (1-20) | `5` | Max concurrent verification tasks |
<!-- docalign:semantic id="sem-62afcdeca5191623" claim="agent timeout_seconds defaults to 120" -->
| `timeout_seconds` | `number` (30-600) | `120` | Task timeout |
| `command` | `string` | (none) | Custom agent command |

### trigger

Controls when scans are triggered (server mode, GitHub App).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `on_pr_open` | `boolean` | (none) | Scan when PR is opened |
| `on_push` | `boolean` | (none) | Scan on push to default branch |
| `on_ready_for_review` | `boolean` | (none) | Scan when PR marked ready for review |
| `on_command` | `boolean` | (none) | Scan on `/docalign` PR comment command |

### llm

Controls LLM model selection.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
<!-- docalign:semantic id="sem-bed68af0d71c6e60" claim="verification_model defaults to claude-sonnet-4-20250514" -->
| `verification_model` | `string` | `'claude-sonnet-4-20250514'` | Model for Tier 3 verification |
<!-- docalign:semantic id="sem-17e3229f92e84ee1" claim="extraction_model defaults to claude-sonnet-4-20250514" -->
| `extraction_model` | `string` | `'claude-sonnet-4-20250514'` | Model for semantic extraction |
<!-- docalign:semantic id="sem-28787a9fb190ae3a" claim="embedding_model defaults to text-embedding-3-small" -->
| `embedding_model` | `string` | `'text-embedding-3-small'` | Model for embeddings |
<!-- docalign:semantic id="sem-0d755ec3ceec7aed" claim="embedding_dimensions defaults to 1536" -->
| `embedding_dimensions` | `number` (64-4096) | `1536` | Embedding vector dimensions |

### check

Controls check command behavior.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `min_severity_to_block` | `'low' \| 'medium' \| 'high'` | (none) | Minimum severity for non-zero exit code |

<!-- docalign:semantic id="sem-e7f9f510c97e2c35" claim="docalign check exits with code 1 if findings meet min_severity_to_block threshold" -->
When set, `docalign check` exits with code 1 only if findings meet this severity threshold. Without it, any drifted claim causes exit code 1.

### mapping

Controls claim-to-code mapping parameters.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
<!-- docalign:semantic id="sem-db35285fc5746f82" claim="semantic_threshold defaults to 0.7" -->
| `semantic_threshold` | `number` (0-1) | `0.7` | Minimum similarity for semantic matching |
| `path1_max_evidence_tokens` | `number` (100-100000) | `8000` | Max tokens for evidence collection |
| `max_agent_files_per_claim` | `number` (1-50) | `10` | Max code files to examine per claim |

### url_check

Controls URL dead link checking.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable URL checking |
<!-- docalign:semantic id="sem-c4b30f44787c9cb0" claim="url check timeout defaults to 5000ms" -->
| `timeout_ms` | `number` (1000-30000) | `5000` | HTTP request timeout in milliseconds |
<!-- docalign:semantic id="sem-9cc4fce5b07901d5" claim="url check max per domain defaults to 5" -->
| `max_per_domain` | `number` (1-50) | `5` | Max requests per domain per scan |
| `exclude_domains` | `string[]` | `[]` | Domains to skip checking |

### coverage

Controls undocumented entity detection.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
<!-- docalign:semantic id="sem-9a93bb463c5e4df8" claim="coverage enabled defaults to false" -->
| `enabled` | `boolean` | `false` | Enable coverage analysis |
| `min_entity_importance` | `'exported' \| 'public' \| 'all'` | `'exported'` | Minimum entity visibility to track |

When enabled, reports code entities (functions, classes, routes) with no documentation claims referencing them.

## Error Handling

- **Missing config file:** Uses all defaults silently
- **Empty config file:** Uses all defaults silently
- **Invalid YAML syntax:** Warning `E501`, uses all defaults
- **Invalid field values:** Warning `E502` per field, uses default for that field
- **Unknown keys:** Warning `E502` with "Did you mean?" suggestion using Levenshtein distance
- **Invalid regex in suppress pattern:** Warning, rule is ignored

Warnings are shown in `docalign status` output.
