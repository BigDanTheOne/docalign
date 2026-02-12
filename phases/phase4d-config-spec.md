# Phase 4D: Configuration Specification

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4, Track D: Configuration Specification
>
> **Inputs:** phase4-api-contracts.md (Section 14 `DocAlignConfig`), all TDD config references (TDD-0 through TDD-7, TDD-Infra), phase3-security.md (Section 6), phase3-infrastructure.md (Section 6), phase3-error-handling.md (Scenario 17), technical-reference.md (Section 9).
>
> **Output:** Complete `.docalign.yml` JSON Schema, environment variable catalog, GitHub App permissions, validation rules, error messages, precedence rules, and example configurations.
>
> **Working title:** "DocAlign" is a placeholder name. See phase4c-ux-specs.md header for the full list of strings to replace when the final name is decided.

---

## Table of Contents

1. [Overview](#1-overview)
2. [`.docalign.yml` Full JSON Schema](#2-docalignyml-full-json-schema)
3. [Every Config Key Documented](#3-every-config-key-documented)
4. [Validation Rules](#4-validation-rules)
5. [Error Messages for Invalid Config](#5-error-messages-for-invalid-config)
6. [Environment Variables](#6-environment-variables)
7. [GitHub App Required Permissions](#7-github-app-required-permissions)
8. [Precedence Rules](#8-precedence-rules)
9. [Example `.docalign.yml` Files](#9-example-docalignyml-files)
10. [Migration / Deprecation Strategy](#10-migration--deprecation-strategy)

---

## 1. Overview

DocAlign configuration operates at three levels:

1. **`.docalign.yml`** -- Per-repository config file at the repo root. Controls scan behavior, file patterns, verification thresholds, and claim type filtering. Parsed by the server on every scan. Validated against the JSON Schema in Section 2.
2. **Environment variables** -- Server-side (Railway deployment) and client-side (GitHub Action secrets). Control infrastructure connections, authentication, and operational parameters. Not user-facing in `.docalign.yml`.
3. **Built-in defaults** -- Hardcoded values used when no config file exists or when individual keys are omitted.

The canonical TypeScript type is `DocAlignConfig` in `phase4-api-contracts.md` Section 14. This specification is the YAML-facing projection of that type, plus server-side environment variables that are not part of the YAML config.

**Design principle:** DocAlign works with zero configuration. Every `.docalign.yml` key is optional. An empty file (or absent file) produces a fully functional scan using sensible defaults.

---

## 2. `.docalign.yml` Full JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://docalign.dev/schemas/docalign-config-v1.json",
  "title": "DocAlign Configuration",
  "description": "Configuration for DocAlign documentation-reality alignment engine. All fields are optional.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "doc_patterns": {
      "type": "object",
      "description": "Glob patterns for documentation files to scan.",
      "additionalProperties": false,
      "properties": {
        "include": {
          "type": "array",
          "description": "Glob patterns for documentation files to include in scanning.",
          "items": { "type": "string", "minLength": 1 },
          "default": [
            "README.md", "README.mdx", "README.rst",
            "CONTRIBUTING.md", "ARCHITECTURE.md",
            "CLAUDE.md", "AGENTS.md", "COPILOT-INSTRUCTIONS.md",
            ".cursorrules",
            "docs/**/*.md", "docs/**/*.mdx",
            "doc/**/*.md",
            "wiki/**/*.md",
            "adr/**/*.md", "ADR-*.md",
            "**/CLAUDE.md", "**/AGENTS.md",
            "api/**/*.md"
          ],
          "maxItems": 100
        },
        "exclude": {
          "type": "array",
          "description": "Glob patterns for documentation files to exclude from scanning.",
          "items": { "type": "string", "minLength": 1 },
          "default": [
            "node_modules/**",
            "vendor/**",
            ".git/**",
            "**/CHANGELOG.md",
            "**/LICENSE.md"
          ],
          "maxItems": 100
        }
      }
    },
    "code_patterns": {
      "type": "object",
      "description": "Glob patterns for code files to index.",
      "additionalProperties": false,
      "properties": {
        "include": {
          "type": "array",
          "description": "Glob patterns for code files to include in indexing.",
          "items": { "type": "string", "minLength": 1 },
          "default": ["**"],
          "maxItems": 100
        },
        "exclude": {
          "type": "array",
          "description": "Glob patterns for code files to exclude from indexing.",
          "items": { "type": "string", "minLength": 1 },
          "default": [
            "node_modules/**",
            ".git/**",
            "dist/**",
            "build/**",
            "vendor/**",
            "__pycache__/**"
          ],
          "maxItems": 100
        }
      }
    },
    "verification": {
      "type": "object",
      "description": "Settings for claim verification behavior.",
      "additionalProperties": false,
      "properties": {
        "min_severity": {
          "type": "string",
          "description": "Minimum severity level to include in PR comments.",
          "enum": ["high", "medium", "low"],
          "default": "low"
        },
        "max_claims_per_pr": {
          "type": "integer",
          "description": "Maximum number of claims to verify per PR scan.",
          "default": 50,
          "minimum": 1,
          "maximum": 200
        },
        "auto_fix": {
          "type": "boolean",
          "description": "Whether to generate auto-fix suggestions on the PR branch.",
          "default": false
        },
        "auto_fix_threshold": {
          "type": "number",
          "description": "Minimum confidence to apply an auto-fix suggestion.",
          "default": 0.9,
          "minimum": 0.5,
          "maximum": 1.0
        }
      }
    },
    "claim_types": {
      "type": "object",
      "description": "Enable or disable specific claim types for extraction and verification.",
      "additionalProperties": false,
      "properties": {
        "path_reference": { "type": "boolean", "default": true, "description": "Check file/directory path references." },
        "dependency_version": { "type": "boolean", "default": true, "description": "Check dependency version claims." },
        "command": { "type": "boolean", "default": true, "description": "Check CLI command claims." },
        "api_route": { "type": "boolean", "default": true, "description": "Check API route/endpoint claims." },
        "code_example": { "type": "boolean", "default": true, "description": "Check inline code example claims." },
        "behavior": { "type": "boolean", "default": true, "description": "Check behavioral description claims." },
        "architecture": { "type": "boolean", "default": true, "description": "Check architecture description claims." },
        "config": { "type": "boolean", "default": true, "description": "Check configuration-related claims." },
        "convention": { "type": "boolean", "default": true, "description": "Check coding convention claims." },
        "environment": { "type": "boolean", "default": true, "description": "Check environment setup claims." }
      }
    },
    "suppress": {
      "type": "array",
      "description": "Rules to suppress specific claims from verification and reporting.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "file": {
            "type": "string",
            "description": "Glob pattern for doc file(s) to suppress.",
            "minLength": 1
          },
          "pattern": {
            "type": "string",
            "description": "Regex pattern to match against claim text for suppression.",
            "minLength": 1
          },
          "claim_type": {
            "type": "string",
            "description": "Claim type to suppress.",
            "enum": [
              "path_reference", "dependency_version", "command",
              "api_route", "code_example", "behavior",
              "architecture", "config", "convention", "environment"
            ]
          },
          "package": {
            "type": "string",
            "description": "Package name to suppress (for dependency_version claims).",
            "minLength": 1
          }
        },
        "minProperties": 1
      },
      "default": [],
      "maxItems": 200
    },
    "schedule": {
      "type": "object",
      "description": "Settings for scheduled full-repo scans.",
      "additionalProperties": false,
      "properties": {
        "full_scan": {
          "type": "string",
          "description": "Frequency of full repository scans.",
          "enum": ["daily", "weekly", "monthly", "never"],
          "default": "weekly"
        },
        "full_scan_day": {
          "type": "string",
          "description": "Day of week for weekly scans, or day of month for monthly scans.",
          "pattern": "^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|[1-9]|[12][0-9]|3[01])$",
          "default": "sunday"
        }
      }
    },
    "agent": {
      "type": "object",
      "description": "Settings for the GitHub Action agent execution.",
      "additionalProperties": false,
      "properties": {
        "concurrency": {
          "type": "integer",
          "description": "Maximum number of concurrent agent tasks per scan.",
          "default": 5,
          "minimum": 1,
          "maximum": 20
        },
        "timeout_seconds": {
          "type": "integer",
          "description": "Timeout in seconds for each individual agent task.",
          "default": 120,
          "minimum": 30,
          "maximum": 600
        },
        "command": {
          "type": "string",
          "description": "Custom agent command override (advanced; for custom agent implementations).",
          "minLength": 1,
          "maxLength": 500
        }
      }
    },
    "trigger": {
      "type": "object",
      "description": "Controls when DocAlign scans PRs. Default: manual only via @docalign review comment.",
      "additionalProperties": false,
      "properties": {
        "on_pr_open": {
          "type": "boolean",
          "description": "Automatically scan when a PR is opened or reopened.",
          "default": false
        },
        "on_push": {
          "type": "boolean",
          "description": "Automatically scan on every push to a PR branch.",
          "default": false
        },
        "on_ready_for_review": {
          "type": "boolean",
          "description": "Automatically scan when a PR transitions from draft to ready for review.",
          "default": false
        },
        "on_command": {
          "type": "boolean",
          "description": "Allow manual scans via @docalign review comment. Always recommended to keep enabled.",
          "default": true
        }
      }
    },
    "llm": {
      "type": "object",
      "description": "LLM model selection and configuration.",
      "additionalProperties": false,
      "properties": {
        "verification_model": {
          "type": "string",
          "description": "Model ID for claim verification (Path 1 LLM calls).",
          "default": "claude-sonnet-4-20250514",
          "minLength": 1,
          "maxLength": 100
        },
        "extraction_model": {
          "type": "string",
          "description": "Model ID for semantic claim extraction.",
          "default": "claude-sonnet-4-20250514",
          "minLength": 1,
          "maxLength": 100
        },
        "embedding_model": {
          "type": "string",
          "description": "Model ID for generating text embeddings.",
          "default": "text-embedding-3-small",
          "minLength": 1,
          "maxLength": 100
        },
        "embedding_dimensions": {
          "type": "integer",
          "description": "Dimensionality of embedding vectors.",
          "default": 1536,
          "enum": [256, 512, 1024, 1536, 3072]
        }
      }
    },
    "check": {
      "type": "object",
      "description": "GitHub Check Run behavior settings.",
      "additionalProperties": false,
      "properties": {
        "block_on_findings": {
          "type": "boolean",
          "description": "Whether findings cause the Check Run to block merge (action_required). When false, findings are reported as neutral (non-blocking).",
          "default": false
        },
        "min_severity_to_block": {
          "type": "string",
          "description": "Minimum severity that causes the Check Run to report action_required. Only applies when block_on_findings is true.",
          "enum": ["high", "medium", "low"],
          "default": "high"
        }
      }
    },
    "mapping": {
      "type": "object",
      "description": "Code-to-claim mapping pipeline configuration.",
      "additionalProperties": false,
      "properties": {
        "semantic_threshold": {
          "type": "number",
          "description": "Minimum cosine similarity for semantic search matches.",
          "default": 0.7,
          "minimum": 0.1,
          "maximum": 1.0
        },
        "path1_max_evidence_tokens": {
          "type": "integer",
          "description": "Maximum token budget for Path 1 evidence assembly.",
          "default": 4000,
          "minimum": 500,
          "maximum": 16000
        },
        "max_agent_files_per_claim": {
          "type": "integer",
          "description": "Maximum number of code files the agent may explore per claim (Path 2).",
          "default": 15,
          "minimum": 1,
          "maximum": 50
        }
      }
    },
    "learning": {
      "type": "object",
      "description": "Learning system behavior and threshold configuration.",
      "additionalProperties": false,
      "properties": {
        "count_based_threshold": {
          "type": "integer",
          "description": "Number of silent dismissals before a claim is permanently suppressed.",
          "default": 2,
          "minimum": 1,
          "maximum": 10
        },
        "co_change_boost_cap": {
          "type": "number",
          "description": "Maximum mapping confidence boost from co-change signals.",
          "default": 0.1,
          "minimum": 0.0,
          "maximum": 0.5
        },
        "co_change_boost_per_commit": {
          "type": "number",
          "description": "Confidence boost added per co-change commit observation.",
          "default": 0.02,
          "minimum": 0.0,
          "maximum": 0.1
        },
        "co_change_retention_days": {
          "type": "integer",
          "description": "Number of days co-change records are retained before purging.",
          "default": 180,
          "minimum": 30,
          "maximum": 730
        },
        "confidence_decay_half_life_days": {
          "type": "integer",
          "description": "Half-life in days for verification confidence exponential decay.",
          "default": 180,
          "minimum": 30,
          "maximum": 730
        },
        "stale_threshold_days": {
          "type": "integer",
          "description": "Days since last verification before a claim is flagged as stale.",
          "default": 30,
          "minimum": 7,
          "maximum": 365
        }
      }
    }
  }
}
```

### Schema Notes

- **`additionalProperties: false`** at every level ensures unknown keys trigger a validation error (DOCALIGN_E502) with a "did you mean?" suggestion.
- All top-level keys are optional. An empty `.docalign.yml` file is valid and uses all defaults.
- The `suppress` array items require at least one property (`minProperties: 1`) to prevent empty suppression rules.
- The `full_scan_day` pattern accepts lowercase day names (for weekly) or numeric day-of-month (for monthly).
- The `embedding_dimensions` enum matches the dimension options supported by `text-embedding-3-small` and `text-embedding-3-large`.

---

## 3. Every Config Key Documented

### 3.1 `doc_patterns` -- Documentation File Patterns

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `doc_patterns.include` | `string[]` | See Section 2 (16 patterns) | Glob patterns, max 100 items | Glob patterns for doc files to include in scanning. | L1 (Claim Extractor), L4 (file classification) |
| `doc_patterns.exclude` | `string[]` | `["node_modules/**", "vendor/**", ".git/**", "**/CHANGELOG.md", "**/LICENSE.md"]` | Glob patterns, max 100 items | Glob patterns for doc files to exclude from scanning. | L1 (Claim Extractor), L4 (file classification) |

### 3.2 `code_patterns` -- Code File Patterns

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `code_patterns.include` | `string[]` | `["**"]` | Glob patterns, max 100 items | Glob patterns for code files to include in indexing. | L0 (Codebase Index), L4 (file classification) |
| `code_patterns.exclude` | `string[]` | `["node_modules/**", ".git/**", "dist/**", "build/**", "vendor/**", "__pycache__/**"]` | Glob patterns, max 100 items | Glob patterns for code files to exclude from entity indexing. | L0 (Codebase Index), L4 (file classification) |

**Note:** Files excluded by `code_patterns.exclude` still appear in the L0 file tree (exclusion affects entity indexing, not file existence). A claim referencing an excluded file will still verify as existing via `fileExists()` (per TDD-0 Section 3.2).

### 3.3 `verification` -- Verification Settings

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `verification.min_severity` | `string` | `"low"` | `"high"`, `"medium"`, `"low"` | Minimum severity level to include in PR comment output. | L5 (Reporter) |
| `verification.max_claims_per_pr` | `integer` | `50` | 1 -- 200 | Maximum claims verified per PR scan (cost control). Hard cap at 200. | L4 (Worker, claim prioritization) |
| `verification.auto_fix` | `boolean` | `false` | `true`, `false` | Enable auto-fix suggestion generation on PR branches. | L5 (Reporter) |
| `verification.auto_fix_threshold` | `number` | `0.9` | 0.5 -- 1.0 | Minimum verification confidence to propose an auto-fix. | L5 (Reporter) |

### 3.4 `claim_types` -- Claim Type Toggle

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `claim_types.path_reference` | `boolean` | `true` | `true`, `false` | Enable/disable file path reference claims. | L1 (Extractor) |
| `claim_types.dependency_version` | `boolean` | `true` | `true`, `false` | Enable/disable dependency version claims. | L1 (Extractor) |
| `claim_types.command` | `boolean` | `true` | `true`, `false` | Enable/disable CLI command claims. | L1 (Extractor) |
| `claim_types.api_route` | `boolean` | `true` | `true`, `false` | Enable/disable API route/endpoint claims. | L1 (Extractor) |
| `claim_types.code_example` | `boolean` | `true` | `true`, `false` | Enable/disable inline code example claims. | L1 (Extractor) |
| `claim_types.behavior` | `boolean` | `true` | `true`, `false` | Enable/disable behavioral description claims. | L1 (Extractor) |
| `claim_types.architecture` | `boolean` | `true` | `true`, `false` | Enable/disable architecture description claims. | L1 (Extractor) |
| `claim_types.config` | `boolean` | `true` | `true`, `false` | Enable/disable configuration-related claims. | L1 (Extractor) |
| `claim_types.convention` | `boolean` | `true` | `true`, `false` | Enable/disable coding convention claims. | L1 (Extractor) |
| `claim_types.environment` | `boolean` | `true` | `true`, `false` | Enable/disable environment setup claims. | L1 (Extractor) |

### 3.5 `suppress` -- Claim Suppression Rules

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `suppress` | `array` | `[]` | Array of suppression objects, max 200 | Static suppression rules evaluated by L4 before database-backed suppression. | L4 (Worker, pre-filter) |
| `suppress[].file` | `string` | -- | Glob pattern | Doc file pattern to match for suppression. | L4 |
| `suppress[].pattern` | `string` | -- | Regex pattern | Regex matched against claim text. | L4 |
| `suppress[].claim_type` | `string` | -- | Any `ClaimType` enum value | Suppress all claims of this type. | L4 |
| `suppress[].package` | `string` | -- | Package name string | Suppress `dependency_version` claims for this package. | L4 |

Config-based suppression (from `.docalign.yml`) is evaluated by L4 BEFORE calling `isClaimSuppressed()`. These rules are NOT stored in the `suppression_rules` database table (per TDD-7 Appendix E.5).

### 3.6 `schedule` -- Scheduled Scan Settings

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `schedule.full_scan` | `string` | `"weekly"` | `"daily"`, `"weekly"`, `"monthly"`, `"never"` | Frequency of full repository scans. | L4 (Trigger, scheduled jobs) |
| `schedule.full_scan_day` | `string` | `"sunday"` | Day name (lowercase) or day-of-month (1-31) | Day for scheduled full scan execution. | L4 (Trigger, scheduled jobs) |

### 3.7 `agent` -- GitHub Action Agent Settings

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `agent.concurrency` | `integer` | `5` | 1 -- 20 | Max concurrent agent tasks per scan run. | GitHub Action (task executor) |
| `agent.timeout_seconds` | `integer` | `120` | 30 -- 600 | Per-task timeout for agent execution. | GitHub Action (task executor) |
| `agent.command` | `string` | -- | Non-empty string, max 500 chars | Custom agent command override (advanced). | GitHub Action |

### 3.8 `trigger` -- Scan Trigger Configuration

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `trigger.on_pr_open` | `boolean` | `false` | `true`, `false` | Auto-scan when a PR is opened or reopened. | L4 (Change Triggers, webhook handler) |
| `trigger.on_push` | `boolean` | `false` | `true`, `false` | Auto-scan on every push to a PR branch. | L4 (Change Triggers, webhook handler) |
| `trigger.on_ready_for_review` | `boolean` | `false` | `true`, `false` | Auto-scan when a PR transitions from draft to ready for review. | L4 (Change Triggers, webhook handler) |
| `trigger.on_command` | `boolean` | `true` | `true`, `false` | Allow manual scans via `@docalign review` PR comment. | L4 (Change Triggers, comment handler) |

**Default behavior:** Only `on_command` is enabled. Developers trigger scans explicitly by commenting `@docalign review` on a PR. Teams that prefer automatic scanning can enable `on_pr_open` and/or `on_ready_for_review`.

### 3.9 `llm` -- LLM Model Configuration

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `llm.verification_model` | `string` | `"claude-sonnet-4-20250514"` | Any valid model ID | Model for Path 1 verification LLM calls. | GitHub Action (Path 1 verifier) |
| `llm.extraction_model` | `string` | `"claude-sonnet-4-20250514"` | Any valid model ID | Model for semantic claim extraction. | GitHub Action (claim extraction task) |
| `llm.embedding_model` | `string` | `"text-embedding-3-small"` | Any valid model ID | Model for generating text embeddings. | GitHub Action (embedding generation) |
| `llm.embedding_dimensions` | `integer` | `1536` | `256`, `512`, `1024`, `1536`, `3072` | Dimensionality of embedding vectors. | L0 (Codebase Index), GitHub Action |

### 3.10 `check` -- GitHub Check Run Settings

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `check.block_on_findings` | `boolean` | `false` | `true`, `false` | Whether findings cause the Check Run to use `action_required` conclusion (blocks merge with branch protection). When `false`, findings are reported with `neutral` conclusion (non-blocking). | L5 (Reporter, Check Run conclusion) |
| `check.min_severity_to_block` | `string` | `"high"` | `"high"`, `"medium"`, `"low"` | Minimum finding severity that triggers `action_required`. Only effective when `block_on_findings` is `true`. | L5 (Reporter, Check Run conclusion) |

### 3.11 `mapping` -- Code-to-Claim Mapping Settings

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `mapping.semantic_threshold` | `number` | `0.7` | 0.1 -- 1.0 | Minimum cosine similarity for semantic search matches in L2 mapping. | L2 (Mapper), L0 (semantic search) |
| `mapping.path1_max_evidence_tokens` | `integer` | `4000` | 500 -- 16000 | Max token budget for Path 1 evidence assembly (routing cap). | L3 (Verifier, routing + evidence) |
| `mapping.max_agent_files_per_claim` | `integer` | `15` | 1 -- 50 | Max code files the Path 2 agent may explore per claim. | GitHub Action (Path 2 agent) |

### 3.12 `learning` -- Learning System Settings

| Key | Type | Default | Valid Values | Description | Used By |
|-----|------|---------|-------------|-------------|---------|
| `learning.count_based_threshold` | `integer` | `2` | 1 -- 10 | Silent dismissals needed to permanently suppress a claim. | L7 (Learning, count-based exclusion) |
| `learning.co_change_boost_cap` | `number` | `0.1` | 0.0 -- 0.5 | Max confidence boost from co-change signals. | L7 (Learning, boost calc) |
| `learning.co_change_boost_per_commit` | `number` | `0.02` | 0.0 -- 0.1 | Confidence boost per co-change commit. | L7 (Learning, boost calc) |
| `learning.co_change_retention_days` | `integer` | `180` | 30 -- 730 | Retention window for co-change records before purge. | L7 (Learning, co-change purge) |
| `learning.confidence_decay_half_life_days` | `integer` | `180` | 30 -- 730 | Half-life for exponential confidence decay. | L7 (Learning, decay calc) |
| `learning.stale_threshold_days` | `integer` | `30` | 7 -- 365 | Days before a claim is flagged stale for re-verification. | L7 (Learning), L4 (scope resolver), L6 (MCP `list_stale_docs`) |

---

## 4. Validation Rules

### 4.1 Type Validation

Every key is validated against its JSON Schema type. Mismatches produce DOCALIGN_E502.

| Key | Expected Type | Validation |
|-----|--------------|------------|
| `doc_patterns.include` | `string[]` | Each item must be a non-empty string. |
| `doc_patterns.exclude` | `string[]` | Each item must be a non-empty string. |
| `code_patterns.include` | `string[]` | Each item must be a non-empty string. |
| `code_patterns.exclude` | `string[]` | Each item must be a non-empty string. |
| `verification.min_severity` | `string` | Must be one of `"high"`, `"medium"`, `"low"`. |
| `verification.max_claims_per_pr` | `integer` | Must be a whole number. |
| `verification.auto_fix` | `boolean` | Must be `true` or `false`. |
| `verification.auto_fix_threshold` | `number` | Must be a numeric value. |
| `claim_types.*` | `boolean` | Each key must be `true` or `false`. |
| `suppress` | `array` | Must be an array of objects. |
| `schedule.full_scan` | `string` | Must be one of `"daily"`, `"weekly"`, `"monthly"`, `"never"`. |
| `schedule.full_scan_day` | `string` | Must match pattern: day name or 1-31. |
| `agent.concurrency` | `integer` | Must be a whole number. |
| `agent.timeout_seconds` | `integer` | Must be a whole number. |
| `agent.command` | `string` | Non-empty, max 500 characters. |
| `trigger.*` | `boolean` | Each key must be `true` or `false`. |
| `llm.*_model` | `string` | Non-empty, max 100 characters. |
| `llm.embedding_dimensions` | `integer` | Must be one of `256`, `512`, `1024`, `1536`, `3072`. |
| `check.block_on_findings` | `boolean` | Must be `true` or `false`. |
| `check.min_severity_to_block` | `string` | Must be one of `"high"`, `"medium"`, `"low"`. |
| `mapping.semantic_threshold` | `number` | Must be a numeric value. |
| `mapping.path1_max_evidence_tokens` | `integer` | Must be a whole number. |
| `mapping.max_agent_files_per_claim` | `integer` | Must be a whole number. |
| `learning.*` | `integer` or `number` | Must match documented type per key. |

### 4.2 Range Validation

| Key | Min | Max |
|-----|-----|-----|
| `verification.max_claims_per_pr` | 1 | 200 |
| `verification.auto_fix_threshold` | 0.5 | 1.0 |
| `agent.concurrency` | 1 | 20 |
| `agent.timeout_seconds` | 30 | 600 |
| `mapping.semantic_threshold` | 0.1 | 1.0 |
| `mapping.path1_max_evidence_tokens` | 500 | 16000 |
| `mapping.max_agent_files_per_claim` | 1 | 50 |
| `learning.count_based_threshold` | 1 | 10 |
| `learning.co_change_boost_cap` | 0.0 | 0.5 |
| `learning.co_change_boost_per_commit` | 0.0 | 0.1 |
| `learning.co_change_retention_days` | 30 | 730 |
| `learning.confidence_decay_half_life_days` | 30 | 730 |
| `learning.stale_threshold_days` | 7 | 365 |
| `doc_patterns.include` (length) | -- | 100 items |
| `doc_patterns.exclude` (length) | -- | 100 items |
| `code_patterns.include` (length) | -- | 100 items |
| `code_patterns.exclude` (length) | -- | 100 items |
| `suppress` (length) | -- | 200 items |

### 4.3 Pattern Validation

| Key | Pattern / Format | Description |
|-----|-----------------|-------------|
| `schedule.full_scan_day` | `^(monday\|tuesday\|wednesday\|thursday\|friday\|saturday\|sunday\|[1-9]\|[12][0-9]\|3[01])$` | Lowercase day name or numeric day-of-month. |
| `suppress[].pattern` | Valid regex | Must be a parseable regular expression. Invalid regex produces E502. |
| `suppress[].claim_type` | ClaimType enum | Must be one of the 10 defined claim types. |
| `doc_patterns.include[*]`, `doc_patterns.exclude[*]` | Glob pattern | Must be non-empty. Validated as syntactically valid glob by minimatch. |
| `code_patterns.include[*]`, `code_patterns.exclude[*]` | Glob pattern | Must be non-empty. Validated as syntactically valid glob by minimatch. |

### 4.4 Cross-Field Validation

| Rule | Fields | Description | Error |
|------|--------|-------------|-------|
| Block threshold consistency | `check.min_severity_to_block`, `verification.min_severity` | If both are set, `verification.min_severity` must be `<=` `check.min_severity_to_block` in severity order (`low < medium < high`). Otherwise, findings that would block the Check Run would be filtered from comments, creating a confusing UX. | DOCALIGN_E502: "Cross-field conflict: `verification.min_severity` ({value}) is stricter than `check.min_severity_to_block` ({value}). Findings that block the Check Run would not appear in PR comments. Set `verification.min_severity` to `{suggestion}` or lower." |
| Auto-fix requires min_severity | `verification.auto_fix`, `verification.min_severity` | No explicit constraint. Auto-fix applies to all findings above `auto_fix_threshold` regardless of `min_severity`. | -- |
| Boost cap >= per-commit | `learning.co_change_boost_cap`, `learning.co_change_boost_per_commit` | `co_change_boost_cap` must be `>=` `co_change_boost_per_commit`. Otherwise, a single co-change would exceed the cap. | DOCALIGN_E502: "Cross-field conflict: `learning.co_change_boost_cap` ({value}) is less than `learning.co_change_boost_per_commit` ({value}). The cap must be >= the per-commit boost." |
| Schedule day validity | `schedule.full_scan`, `schedule.full_scan_day` | If `full_scan` is `"weekly"`, `full_scan_day` must be a day name. If `full_scan` is `"monthly"`, `full_scan_day` must be a number 1-31. If `full_scan` is `"daily"` or `"never"`, `full_scan_day` is ignored. | DOCALIGN_E502: "Cross-field conflict: `schedule.full_scan` is `{value}` but `schedule.full_scan_day` is `{value}`, which is not a valid {day name\|day number}." |
| Suppress package requires claim_type | `suppress[].package`, `suppress[].claim_type` | If `package` is set, `claim_type` should be `"dependency_version"` or omitted (implied). If `claim_type` is set to a non-dependency type along with `package`, warn. | DOCALIGN_E502: "Suppress rule has `package` set but `claim_type` is `{value}` (not `dependency_version`). The `package` field only applies to `dependency_version` claims." |

### 4.5 Required vs Optional

**All `.docalign.yml` keys are optional.** The entire file is optional. If absent, all defaults apply. If present but empty, all defaults apply.

No key within `.docalign.yml` is required. Each omitted key falls back to its documented default value.

---

## 5. Error Messages for Invalid Config

Config errors are handled per Phase 3C Scenario 17. The scan NEVER fails due to config errors.

### 5.1 Invalid YAML Syntax (DOCALIGN_E501)

**Trigger:** YAML parser cannot parse the file (syntax error, invalid encoding, etc.).

**Behavior:** Fall back to ALL defaults for the entire configuration. No partial parsing.

**PR comment banner:**
```
Configuration warning: `.docalign.yml` has invalid YAML syntax. Using all default settings.
```

**Log entry:**
```json
{
  "level": "WARN",
  "code": "DOCALIGN_E501",
  "repoId": "{repoId}",
  "parseError": "{yaml parser error message}",
  "resolvedConfig": { "...all defaults..." }
}
```

### 5.2 Unknown Key (DOCALIGN_E502)

**Trigger:** A key in `.docalign.yml` is not in the schema (`additionalProperties: false` violation).

**Behavior:** Ignore the unknown key, use defaults for any missing valid keys, keep valid keys.

**PR comment banner:**
```
Configuration warning: unknown key `{key}` in `.docalign.yml`. Did you mean `{suggestion}`? This key was ignored.
```

**"Did you mean?" logic:** Compute Levenshtein distance between the unknown key and all valid keys at that nesting level. If the closest match has distance <= 3, suggest it. Otherwise, omit the suggestion.

**Examples:**
- `verificationn` -> "Did you mean `verification`?"
- `checks` -> "Did you mean `check`?"
- `zzzzz` -> (no suggestion, distance > 3 from all valid keys)

**Log entry:**
```json
{
  "level": "WARN",
  "code": "DOCALIGN_E502",
  "repoId": "{repoId}",
  "validationErrors": [
    { "path": "verificationn", "message": "Unknown key. Did you mean 'verification'?" }
  ],
  "resolvedConfig": { "..." }
}
```

### 5.3 Invalid Value (DOCALIGN_E502)

**Trigger:** A key has a value that fails schema validation (wrong type, out of range, invalid enum).

**Behavior:** Use default for the invalid field only. Keep all valid fields.

**PR comment banner (enum violation):**
```
Configuration warning: field `verification.min_severity` is invalid ("critical" is not one of: high, medium, low), using default value `low`.
```

**PR comment banner (range violation):**
```
Configuration warning: field `verification.max_claims_per_pr` is invalid (500 exceeds maximum of 200), using default value `50`.
```

**PR comment banner (type mismatch):**
```
Configuration warning: field `agent.concurrency` is invalid (expected integer, got string "five"), using default value `5`.
```

### 5.4 Type Mismatch (DOCALIGN_E502)

**Trigger:** A key has a value of the wrong type (e.g., string where number expected).

**Behavior:** Same as 5.3 -- use default for the invalid field.

**PR comment banner:**
```
Configuration warning: field `{field}` is invalid (expected {expected_type}, got {actual_type} `{value}`), using default value `{default}`.
```

### 5.5 Cross-Field Conflict (DOCALIGN_E502)

**Trigger:** Two fields have individually valid values that conflict with each other.

**Behavior:** Use defaults for the conflicting pair. Keep all non-conflicting fields.

**PR comment banner (severity conflict):**
```
Configuration warning: `verification.min_severity` ("high") is stricter than `check.min_severity_to_block` ("medium"). Using defaults: `verification.min_severity` = "low", `check.min_severity_to_block` = "high".
```

**PR comment banner (boost conflict):**
```
Configuration warning: `learning.co_change_boost_cap` (0.01) is less than `learning.co_change_boost_per_commit` (0.02). Using defaults: cap = 0.1, per_commit = 0.02.
```

### 5.6 Invalid Regex in Suppress Pattern (DOCALIGN_E502)

**Trigger:** `suppress[].pattern` contains an unparseable regular expression.

**Behavior:** Skip the individual suppression rule. Keep all other rules.

**PR comment banner:**
```
Configuration warning: suppress rule #2 has invalid regex pattern `[invalid(`: Unterminated character class. This rule was skipped.
```

### 5.7 Multiple Errors

When multiple validation errors are found, all are reported. Each invalid field independently falls back to its default. The PR comment includes all warnings, each on its own line.

---

## 6. Environment Variables

Environment variables are split into three categories: **server-side** (headless mode / hosted deployment), **client-side** (GitHub Action secrets), and **CLI/MCP** (local usage).

### 6.1 Server-Side Environment Variables (Headless Mode / Hosted Deployment)

These apply when running `docalign serve` or deploying the hosted server. Not needed for embedded CLI mode.

| Variable | Type | Default | Required | Description | Used By |
|----------|------|---------|----------|-------------|---------|
| `PORT` | integer | `8080` | No | HTTP server listen port. | TDD-Infra (Express server) |
| `NODE_ENV` | string | `"production"` | No | Node.js environment name. | TDD-Infra (server config) |
| `LOG_LEVEL` | string | `"info"` | No | Pino log level (`debug`, `info`, `warn`, `error`). | TDD-Infra (logging) |
| `DATABASE_URL` | string | -- | Yes | PostgreSQL connection string (SSL required in production). | TDD-Infra, all layers via DB |
| `REDIS_URL` | string | -- | Yes | Redis connection string. | TDD-Infra (BullMQ), L4 (rate limits, debounce) |
| `GITHUB_APP_ID` | string | -- | Yes | GitHub App numeric ID. | TDD-Infra (JWT generation) |
| `GITHUB_PRIVATE_KEY` | string | -- | Yes | GitHub App private key (PEM format, newlines as `\n`). | TDD-Infra (JWT signing) |
| `GITHUB_WEBHOOK_SECRET` | string | -- | Yes | Webhook signature verification secret (32+ chars). | TDD-Infra (webhook handler) |
| `GITHUB_WEBHOOK_SECRET_OLD` | string | -- | No | Previous webhook secret for zero-downtime rotation. | TDD-Infra (dual-secret verification) |
| `DOCALIGN_API_SECRET` | string | -- | Yes | Random 64-char hex string for HMAC dismiss tokens. | TDD-Infra (dismiss URL generation) |
| `DOCALIGN_TOKEN_TTL_DAYS` | integer | `365` | No | Token expiry in days for generated `DOCALIGN_TOKEN` values. | TDD-Infra (token generation) |
| `SCAN_TIMEOUT_MINUTES` | integer | `10` | No | Server-side scan job timeout in minutes. | L4 (Worker, job timeout) |
| `AGENT_TASK_TIMEOUT_MINUTES` | integer | `30` | No | Agent task expiry from creation time, in minutes. | TDD-Infra (task creation) |
| `RETRY_PER_CALL_MAX` | integer | `2` | No | Maximum retries per individual external API call. | Phase 3C (retry profiles) |
| `RETRY_PER_JOB_MAX` | integer | `3` | No | Maximum retries per BullMQ job. | L4 (BullMQ job config) |
| `COCHANGE_RETENTION_DAYS` | integer | `180` | No | Override for co-change record retention (days). Overrides `learning.co_change_retention_days` from `.docalign.yml`. | L7 (weekly purge job) |

**Startup validation:** All required variables are validated at startup using Zod. If any required variable is missing, the server logs the missing variable names and exits with code 1 (per TDD-Infra Appendix C).

### 6.2 Client-Side Environment Variables (GitHub Action Secrets)

| Variable | Type | Default | Required | Description | Used By |
|----------|------|---------|----------|-------------|---------|
| `DOCALIGN_TOKEN` | string | -- | Yes | Per-repo token (`docalign_` prefix, 256-bit) for Action-to-API authentication. Generated during GitHub App installation. | GitHub Action (API auth) |
| `ANTHROPIC_API_KEY` | string | -- | Yes (if using Anthropic models) | Anthropic API key for LLM calls (verification, extraction). | GitHub Action (LLM calls) |
| `OPENAI_API_KEY` | string | -- | Yes (if using OpenAI embeddings) | OpenAI API key for embedding generation. | GitHub Action (embedding calls) |

**Note:** LLM API keys never leave the client (GitHub Action runner). They are never sent to the DocAlign server. The server has no access to these keys (per Phase 3E Section 2).

### 6.3 CLI / MCP Environment Variables (Local Usage)

| Variable | Type | Default | Required | Description | Used By |
|----------|------|---------|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | string | -- | Yes (if using Anthropic) | Anthropic API key for local LLM calls. | CLI (embedded mode), MCP server |
| `OPENAI_API_KEY` | string | -- | Yes (if using OpenAI embeddings) | OpenAI API key for local embedding generation. | CLI (embedded mode), MCP server |
| `DOCALIGN_DATABASE_URL` | string | -- | No | PostgreSQL connection string. If set, CLI uses PostgreSQL instead of local SQLite. Used by MCP server when connecting to a headless server's database. | CLI, MCP server |
| `DOCALIGN_SERVER_URL` | string | -- | No | URL of a running headless server. If set, CLI sends requests to the server instead of running the embedded pipeline. Set by `docalign connect`. | CLI |
| `DOCALIGN_DATA_DIR` | string | `~/.docalign` | No | Directory for local data (SQLite database, config, cache). | CLI (embedded mode), MCP server |

**Resolution chain for storage:** `DOCALIGN_SERVER_URL` (server mode) > `DOCALIGN_DATABASE_URL` (PostgreSQL) > local SQLite at `{DOCALIGN_DATA_DIR}/{repo-hash}/db.sqlite`.

**MCP server** reads from the same storage as the CLI — if the CLI uses local SQLite, the MCP server reads from the same SQLite file. If connected to a server, the MCP server can connect to the same PostgreSQL database.

---

## 7. GitHub App Required Permissions

Per Phase 3E Section 6.1.

### 7.1 Required Permissions

| Permission | Level | Rationale |
|-----------|-------|-----------|
| `contents: read` | Read | Read repo files via GitHub API for PR scans. Send repository dispatch events to trigger the GitHub Action. Required for `GET /repos/{owner}/{repo}/contents/{path}` and `POST /repos/{owner}/{repo}/dispatches`. |
| `pull_requests: write` | Write | Post PR summary comments (Issues API), create review comments with fix suggestions (Pull Request Review API), read PR diff (list changed files). Required for `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` and `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`. |
| `metadata: read` | Read | Access basic repository information (name, default branch, visibility). Automatically granted to all GitHub Apps. |
| `checks: write` | Write | Create and update Check Runs for scan status visibility. Required for `POST /repos/{owner}/{repo}/check-runs` and `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`. |

### 7.2 Permissions NOT Requested

| Permission | Why Not Needed |
|-----------|---------------|
| `contents: write` | DocAlign does not push commits. Auto-fix is client-side via the Action. |
| `issues: write` | PR comments use the Issues API endpoint but only need `pull_requests: write`. |
| `actions: read/write` | Repository dispatch uses `contents: read`. No need to read or modify Actions workflows. |
| `administration` | No repo settings changes needed. |
| `members` | No org member information needed. |
| `emails` | No user email access needed. |
| `secrets` | Secrets are managed by the user, not by DocAlign. |

### 7.3 Webhook Event Subscriptions

| Event | Why Subscribed |
|-------|---------------|
| `pull_request` (opened, synchronize, closed) | Trigger PR scans, detect fix acceptance, clean up on close. |
| `push` | Update codebase index on default branch pushes. |
| `installation` (created, deleted) | Onboarding flow and data cleanup on uninstall. |
| `installation_repositories` (added, removed) | Repo addition and removal from an existing installation. |
| `pull_request_review` (submitted) | Fix acceptance detection (per Phase 3B Section 1.1.5). |

---

## 8. Precedence Rules

Configuration values are resolved in the following precedence order (highest priority first):

### 8.1 General Precedence

```
1. Environment variable override (highest priority)
2. .docalign.yml config file value
3. Built-in default (lowest priority)
```

### 8.2 Environment Variable Override Capability

Most `.docalign.yml` keys are NOT overridable by environment variables. Only specific operational keys support env var override:

| `.docalign.yml` Key | Env Var Override | Behavior |
|---------------------|-----------------|----------|
| `learning.co_change_retention_days` | `COCHANGE_RETENTION_DAYS` | Env var overrides the YAML value. Used by the server-side purge job. |
| (none) | `SCAN_TIMEOUT_MINUTES` | Server-only. No YAML equivalent. |
| (none) | `AGENT_TASK_TIMEOUT_MINUTES` | Server-only. No YAML equivalent. |
| (none) | `RETRY_PER_CALL_MAX` | Server-only. No YAML equivalent. |
| (none) | `RETRY_PER_JOB_MAX` | Server-only. No YAML equivalent. |
| (none) | `DOCALIGN_TOKEN_TTL_DAYS` | Server-only. No YAML equivalent. |

**Design rationale:** Server operators (the DocAlign team) control infrastructure-level knobs via env vars. Repository owners control scan behavior via `.docalign.yml`. These are separate concerns with minimal overlap.

### 8.3 Config Resolution Process

```
1. Read .docalign.yml from repo root (via GitHub API, cached per scan).
2. Parse YAML.
   - If parse fails (E501): use ALL defaults. Continue.
3. Validate parsed object against JSON Schema (Zod).
   - For each invalid field (E502): replace with default for that field.
   - For cross-field conflicts (E502): replace conflicting pair with defaults.
4. Merge valid overrides with built-in defaults.
5. Apply env var overrides for eligible keys.
6. Return resolved DocAlignConfig.
```

### 8.4 Config Caching

The resolved config is computed once per scan run and passed to all layers. It is NOT cached across scan runs -- each scan reads the latest `.docalign.yml` from the commit being scanned.

---

## 9. Example `.docalign.yml` Files

### 9.1 Minimal Config (Zero Config)

An empty file or absent file. All defaults apply.

```yaml
# .docalign.yml
# No configuration needed. DocAlign works out of the box with sensible defaults.
```

Effective behavior:
- Scans standard doc locations (README, docs/, CLAUDE.md, etc.)
- Indexes all code files (excluding node_modules, .git, dist, build, vendor, __pycache__)
- All 10 claim types enabled
- Weekly full scan on Sundays
- Up to 50 claims per PR, severity threshold `low`
- Check Run blocks on `high` severity findings
- No auto-fix

### 9.2 Standard Config (Medium Project)

Typical customization for a project with custom doc locations and some noisy claim types disabled.

```yaml
# .docalign.yml

doc_patterns:
  include:
    - "README.md"
    - "docs/**/*.md"
    - "CLAUDE.md"
    - "**/AGENTS.md"
  exclude:
    - "docs/changelog.md"
    - "docs/archive/**"

code_patterns:
  exclude:
    - "node_modules/**"
    - ".git/**"
    - "dist/**"
    - "src/**/*.test.ts"
    - "src/**/*.spec.ts"

verification:
  min_severity: "medium"
  max_claims_per_pr: 30

claim_types:
  architecture: false
  convention: false

check:
  min_severity_to_block: "high"

schedule:
  full_scan: "weekly"
  full_scan_day: "sunday"
```

### 9.3 Advanced Config (Monorepo, All Keys)

All keys specified for a monorepo with custom patterns, multiple packages, and fine-tuned thresholds.

```yaml
# .docalign.yml -- advanced monorepo configuration

doc_patterns:
  include:
    - "README.md"
    - "docs/**/*.md"
    - "docs/**/*.mdx"
    - "packages/*/README.md"
    - "packages/*/docs/**/*.md"
    - "CLAUDE.md"
    - "CONTRIBUTING.md"
    - "ARCHITECTURE.md"
    - "**/AGENTS.md"
    - "api/**/*.md"
  exclude:
    - "docs/archive/**"
    - "docs/legacy/**"
    - "**/CHANGELOG.md"
    - "**/LICENSE.md"
    - "node_modules/**"

code_patterns:
  include:
    - "packages/*/src/**"
    - "packages/*/lib/**"
    - "apps/*/src/**"
    - "shared/**"
  exclude:
    - "node_modules/**"
    - ".git/**"
    - "dist/**"
    - "build/**"
    - "**/*.test.ts"
    - "**/*.spec.ts"
    - "**/*.stories.tsx"
    - "**/__mocks__/**"
    - "**/__fixtures__/**"

verification:
  min_severity: "low"
  max_claims_per_pr: 100
  auto_fix: true
  auto_fix_threshold: 0.95

claim_types:
  path_reference: true
  dependency_version: true
  command: true
  api_route: true
  code_example: true
  behavior: true
  architecture: true
  config: true
  convention: false
  environment: true

suppress:
  - file: "README.md"
    pattern: "badge"
  - claim_type: "dependency_version"
    package: "typescript"
  - file: "docs/roadmap.md"
    claim_type: "behavior"
  - pattern: "coming soon|planned|TODO"

schedule:
  full_scan: "daily"
  full_scan_day: "1"

agent:
  concurrency: 10
  timeout_seconds: 180

llm:
  verification_model: "claude-sonnet-4-20250514"
  extraction_model: "claude-sonnet-4-20250514"
  embedding_model: "text-embedding-3-small"
  embedding_dimensions: 1536

check:
  min_severity_to_block: "medium"

mapping:
  semantic_threshold: 0.65
  path1_max_evidence_tokens: 6000
  max_agent_files_per_claim: 20

learning:
  count_based_threshold: 3
  co_change_boost_cap: 0.15
  co_change_boost_per_commit: 0.03
  co_change_retention_days: 365
  confidence_decay_half_life_days: 120
  stale_threshold_days: 14
```

---

## 10. Migration / Deprecation Strategy

### 10.1 Versioning

The config schema version is implicit in the DocAlign release. There is no explicit `version` key in `.docalign.yml` for v1. If a future breaking change requires a version key, it will be introduced as a `config_version` field.

### 10.2 Deprecation Process

When a config key is deprecated in a future version:

1. **Announcement:** The key is documented as deprecated in the release notes and changelog.
2. **Warning period (2 major versions or 6 months, whichever is longer):**
   - The deprecated key is still accepted and functional.
   - A warning is included in every PR comment where the deprecated key is active:
     ```
     Configuration notice: `{old_key}` is deprecated and will be removed in v{version}. Use `{new_key}` instead.
     ```
   - Log at WARN with the deprecation notice.
3. **Removal:** After the warning period, the key becomes an "unknown key" and triggers DOCALIGN_E502 with a "did you mean?" suggestion pointing to the replacement.

### 10.3 Renamed Keys

When a key is renamed (e.g., `verification.min_severity` -> `reporting.min_severity`):

1. During the deprecation window, BOTH keys are accepted.
2. If both old and new keys are present, the NEW key takes precedence. A warning is emitted:
   ```
   Configuration notice: both `{old_key}` and `{new_key}` are set. Using `{new_key}`. Remove `{old_key}` to suppress this warning.
   ```
3. After the deprecation window, only the new key is accepted.

### 10.4 New Keys in Minor Versions

New config keys may be added in any minor version. They always have defaults that preserve existing behavior (no breaking changes from adding keys). Users do not need to update `.docalign.yml` when upgrading DocAlign.

### 10.5 Structural Changes

If a future version restructures the config (e.g., flattening nested objects or moving keys between sections):

1. The old structure is accepted during the deprecation window with warnings.
2. A migration guide is published with exact before/after examples.
3. The server logs include the old key path and the new key path for every deprecated reference, enabling automated migration tooling.

---

## Appendix A: Internal-Only Config (Not in `.docalign.yml`)

The following configuration values are used internally by specific layers but are NOT exposed in `.docalign.yml`. They are either hardcoded or controlled via server-side environment variables.

| Key | Default | Layer | Description |
|-----|---------|-------|-------------|
| `path1_max_import_lines` | `30` | L3 (Verifier) | Max import lines included in Path 1 evidence. |
| `path1_max_type_signatures` | `3` | L3 (Verifier) | Max type signatures included in Path 1 evidence. |
| `path1_max_type_lines` | `100` | L3 (Verifier) | Max lines per type signature in evidence. |
| `chars_per_token` | `4` | L3 (Verifier) | Character-to-token ratio for token estimation. |
| `semantic_top_k` | `5` | L2 (Mapper) | Number of top results from semantic search. |
| `poll_interval_ms` | `5000` | L4 (Worker) | Agent task completion polling interval. |
| `cancellation_check_interval` | `10` | L4 (Worker) | Polls between cancellation checks. |
| `rate_limit_per_repo_per_day` | `100` | L4 (Rate limiter) | Max scans per repo per day. |
| `rate_limit_per_org_per_day` | `1000` | L4 (Rate limiter) | Max scans per org per day. |
| `mcp_cache_ttl_seconds` | `60` | L6 (MCP Server) | MCP query result cache TTL. |
| `mcp_max_search_results` | `20` | L6 (MCP Server) | Max results from `get_docs`. |
| `mcp_stale_threshold_days` | `30` | L6 (MCP Server) | Stale threshold for `list_stale_docs`. |
| `quick_pick_migration_expiry_days` | `90` | L7 (Learning) | Expiry for "not relevant" suppression rules. |
| `quick_pick_stale_expiry_days` | `90` | L7 (Learning) | Expiry for "docs are aspirational" suppression rules. |
| `quick_pick_dont_care_expiry_days` | `180` | L7 (Learning) | Expiry for "don't care" suppression rules. |
| `quick_pick_false_positive_expiry_days` | `180` | L7 (Learning) | Expiry for "false positive" suppression rules. |

These values are candidates for future promotion to `.docalign.yml` if user demand warrants it. For MVP, they are hardcoded to reduce config surface area.

---

## Appendix B: Zod Schema Implementation Notes

The JSON Schema in Section 2 is the specification. At implementation time, the config is validated using Zod (TypeScript-first schema validation). Key implementation notes:

1. **Parse, don't validate:** Use `z.object({...}).parse(yamlContent)` which returns a typed object or throws `ZodError`.
2. **Default injection:** Use `.default()` on every Zod field. After parse, the result is a fully-populated `DocAlignConfig` with no `undefined` values.
3. **Partial recovery on E502:** Wrap the top-level parse in a try-catch. On `ZodError`, iterate `error.issues`, replace each invalid field with its default, and continue.
4. **Unknown key detection:** `z.object({...}).strict()` rejects unknown keys. Use `error.issues.filter(i => i.code === 'unrecognized_keys')` to extract unknown key names for "did you mean?" suggestions.
5. **Cross-field validation:** Use `.refine()` or `.superRefine()` on the top-level object for cross-field checks after individual field validation succeeds.

---

## Appendix C: Config Loading Sequence Diagram

```
GitHub Webhook (PR opened)
  |
  v
API Server -> enqueue PR scan job
  |
  v
L4 Worker starts processing
  |
  v
Read .docalign.yml from repo (GitHub API, commit SHA)
  |
  v
YAML parse (js-yaml)
  |-- parse error? -> E501, use ALL defaults
  v
Zod schema validation
  |-- field errors? -> E502, replace each invalid field with default
  |-- cross-field errors? -> E502, replace conflicting pair with defaults
  v
Apply env var overrides (COCHANGE_RETENTION_DAYS)
  |
  v
Resolved DocAlignConfig passed to all layers
  |
  v
Config warnings collected for PR comment banner
```
