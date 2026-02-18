---
title: "Custom Configuration"
summary: "Customize which files DocAlign scans, which checks run, and how results are reported"
description: "Use when you need to customize which files DocAlign scans, what it checks, and how it reports."
category: "guide"
read_when:
  - Excluding specific files or directories from scanning
  - Enabling or disabling specific claim types
  - Setting up project-specific scan configuration
related:
  - docs/reference/configuration.md
  - docs/guides/suppressing-findings.md
---

# Custom Configuration

DocAlign works with zero configuration. All settings have sensible defaults. To customize, create `.docalign.yml` at your repo root.

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

## Common configurations

### Scan only specific directories

<!-- docalign:skip reason="illustrative_example" description="YAML snippet showing example doc_patterns include/exclude configuration for user's repo" -->
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

### Focus on important issues only

<!-- docalign:skip reason="illustrative_example" description="YAML snippet showing example verification.min_severity and check.min_severity_to_block configuration" -->
```yaml
verification:
  min_severity: medium

check:
  min_severity_to_block: high    # CI fails only on high severity
```
<!-- /docalign:skip -->

### Disable specific check types

<!-- docalign:skip reason="illustrative_example" description="YAML snippet showing example claim_types boolean disable configuration" -->
```yaml
claim_types:
  url_reference: false     # Skip dead link checks
  environment: false       # Skip env var checks
  convention: false        # Skip convention claims
```
<!-- /docalign:skip -->

### Suppress specific findings

<!-- docalign:skip reason="illustrative_example" description="YAML snippet showing example suppress rules configuration" -->
```yaml
suppress:
  - file: 'docs/legacy.md'
  - package: '@internal/private-pkg'
  - claim_type: url_reference
  - pattern: 'localhost:\d+'
```

<!-- /docalign:skip -->
See [Suppressing Findings](suppressing-findings.md) for the full suppress reference.

### Configure URL checking

<!-- docalign:skip reason="illustrative_example" description="YAML snippet showing example url_check configuration with timeout and domain exclusions" -->
```yaml
url_check:
  timeout_ms: 10000              # Longer timeout
  max_per_domain: 3              # Fewer requests per domain
  exclude_domains:
    - 'internal.company.com'
    - 'flaky-ci.example.com'
```
<!-- /docalign:skip -->

### Change LLM models

<!-- docalign:skip reason="illustrative_example" description="YAML snippet showing example llm model configuration" -->
```yaml
llm:
  verification_model: claude-sonnet-4-20250514
  extraction_model: claude-sonnet-4-20250514
```
<!-- /docalign:skip -->

### Set up CI blocking

```yaml
check:
  min_severity_to_block: medium
```

When set, `docalign check` exits 0 for low-severity drift and exits 1 only for medium or high.

## View current config

```bash
docalign status
```

Shows the active config file path, enabled claim types, and any warnings.

## Full reference

See [Configuration Reference](../reference/configuration.md) for all 14 sections with every field, type, default, and example.
