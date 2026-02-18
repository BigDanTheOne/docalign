# Configuration Reference

DocAlign works with zero configuration. All settings have sensible defaults. To customize, create `.docalign.yml` at your repo root.

## Zero-Config Behavior

With no config file, DocAlign:
- Scans `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**/*.md`, and similar patterns
- Excludes `node_modules/`, `vendor/`, `.git/`, `CHANGELOG.md`, `LICENSE.md`
- Enables all 11 claim types
- Reports all severities (low, medium, high)
- Checks up to 50 claims per PR
- Checks URLs with 5s timeout, max 5 per domain

## Full Example

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

## Sections

### doc_patterns

Controls which documentation files are scanned.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `include` | `string[]` | See below | Glob patterns for doc files to include |
| `exclude` | `string[]` | See below | Glob patterns for doc files to exclude |

**Default include:** `README.md`, `README.mdx`, `README.rst`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `COPILOT-INSTRUCTIONS.md`, `.cursorrules`, `docs/**/*.md`, `docs/**/*.mdx`, `doc/**/*.md`, `wiki/**/*.md`, `adr/**/*.md`, `ADR-*.md`, `**/CLAUDE.md`, `**/AGENTS.md`, `api/**/*.md`

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
| `min_severity` | `'low' \| 'medium' \| 'high'` | `'low'` | Minimum severity to report |
| `max_claims_per_pr` | `number` (1-200) | `50` | Max claims to verify per PR scan |
| `auto_fix` | `boolean` | `false` | Automatically apply high-confidence fixes |
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

Max 200 suppress rules.

### schedule

Controls automated full scans (server mode).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `full_scan` | `'daily' \| 'weekly' \| 'monthly' \| 'never'` | `'weekly'` | Full scan frequency |
| `full_scan_day` | `string` | `'sunday'` | Day of week for weekly scans |

### agent

Controls the agent execution environment (server mode).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `concurrency` | `number` (1-20) | `5` | Max concurrent verification tasks |
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
| `verification_model` | `string` | `'claude-sonnet-4-20250514'` | Model for Tier 3 verification |
| `extraction_model` | `string` | `'claude-sonnet-4-20250514'` | Model for semantic extraction |
| `embedding_model` | `string` | `'text-embedding-3-small'` | Model for embeddings |
| `embedding_dimensions` | `number` (64-4096) | `1536` | Embedding vector dimensions |

### check

Controls check command behavior.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `min_severity_to_block` | `'low' \| 'medium' \| 'high'` | (none) | Minimum severity for non-zero exit code |

When set, `docalign check` exits with code 1 only if findings meet this severity threshold. Without it, any drifted claim causes exit code 1.

### mapping

Controls claim-to-code mapping parameters.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `semantic_threshold` | `number` (0-1) | `0.7` | Minimum similarity for semantic matching |
| `path1_max_evidence_tokens` | `number` (100-100000) | `8000` | Max tokens for evidence collection |
| `max_agent_files_per_claim` | `number` (1-50) | `10` | Max code files to examine per claim |

### url_check

Controls URL dead link checking.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable URL checking |
| `timeout_ms` | `number` (1000-30000) | `5000` | HTTP request timeout in milliseconds |
| `max_per_domain` | `number` (1-50) | `5` | Max requests per domain per scan |
| `exclude_domains` | `string[]` | `[]` | Domains to skip checking |

### coverage

Controls undocumented entity detection.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
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
