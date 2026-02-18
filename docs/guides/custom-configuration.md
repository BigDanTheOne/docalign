---
title: "Custom Configuration"
summary: "How to create and customize .docalign.yml to control which files are scanned, severity thresholds, claim type toggles, suppress rules, URL checking, and LLM models."
description: "Covers interactive setup via docalign configure (with --exclude, --min-severity, --reset flags), plus YAML config patterns: scoped doc_patterns, severity floor (min_severity + min_severity_to_block), disabling specific claim_types, suppress rules, URL check tuning, LLM model selection, CI blocking. References docalign status for viewing active config and links to full configuration reference."
category: guide
read_when:
  - You want to limit DocAlign to specific directories or file patterns
  - You want to suppress noisy findings or raise the severity floor
  - You need to disable URL checks or configure LLM models
related:
  - docs/reference/configuration.md
  - docs/guides/suppressing-findings.md
  - docs/troubleshooting.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Custom Configuration

<!-- docalign:semantic id="sem-e3f7a2b1c8d94e05" claim="DocAlign works with zero configuration. All settings have sensible defaults." -->
DocAlign works with zero configuration. All settings have sensible defaults. To customize, create `.docalign.yml` at your repo root.

<!-- docalign:skip reason="user_instruction" description="Interactive setup section showing CLI commands as user instructions, not factual claims — the command names themselves are extracted as claims separately" -->
## Interactive setup

```bash
docalign configure
```

Or use flags:

```bash
docalign configure --exclude=docs/archive/**
docalign configure --min-severity=medium
docalign configure --reset    # Reset to defaults
```

<!-- /docalign:skip -->
## Common configurations

<!-- docalign:skip reason="user_instruction" description="YAML snippet instructing users how to configure doc_patterns — illustrative config template" -->
### Scan only specific directories

```yaml
doc_patterns:
  include:
    - 'README.md'
    - 'docs/**/*.md'
  exclude:
    - 'docs/archive/**'
    - 'docs/internal/**'
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML snippet instructing users how to set min_severity and min_severity_to_block — illustrative config template" -->
### Focus on important issues only

```yaml
verification:
  min_severity: medium

check:
  min_severity_to_block: high    # CI fails only on high severity
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML snippet instructing users how to disable claim_types — illustrative config template" -->
### Disable specific check types

```yaml
claim_types:
  url_reference: false     # Skip dead link checks
  environment: false       # Skip env var checks
  convention: false        # Skip convention claims
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML snippet with suppress examples — illustrative config template" -->
### Suppress specific findings

```yaml
suppress:
  - file: 'docs/legacy.md'
  - package: '@internal/private-pkg'
  - claim_type: url_reference
  - pattern: 'localhost:\d+'
```

See [Suppressing Findings](suppressing-findings.md) for the full suppress reference.

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML snippet for url_check configuration — illustrative config template" -->
### Configure URL checking

```yaml
url_check:
  timeout_ms: 10000              # Longer timeout
  max_per_domain: 3              # Fewer requests per domain
  exclude_domains:
    - 'internal.company.com'
    - 'flaky-ci.example.com'
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML snippet for LLM model configuration with external model strings — illustrative config template" -->
### Change LLM models

```yaml
llm:
  verification_model: claude-sonnet-4-20250514
  extraction_model: claude-sonnet-4-20250514
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML snippet for check.min_severity_to_block — illustrative config template" -->
### Set up CI blocking

```yaml
check:
  min_severity_to_block: medium
```
<!-- /docalign:skip -->

When set, `docalign check` exits 0 for low-severity drift and exits 1 only for medium or high.

## View current config

```bash
docalign status
```

<!-- docalign:semantic id="sem-0767b3c003c6613d" claim="docalign status shows the active config file path, enabled claim types, and any warnings" -->
Shows the active config file path, enabled claim types, and any warnings.

## Full reference

See [Configuration Reference](../reference/configuration.md) for all 14 sections with every field, type, default, and example.
