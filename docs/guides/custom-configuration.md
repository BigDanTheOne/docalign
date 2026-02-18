---
title: "Custom Configuration"
summary: "Guide to customizing DocAlign behavior via .docalign.yml or the docalign configure command."
description: "Covers interactive setup (docalign configure with flags --exclude, --min-severity, --reset), common configuration scenarios (scan specific directories, focus on important issues, disable claim types, suppress findings, URL check settings, LLM model selection, CI blocking thresholds), viewing current config with docalign status, and a reference to the full configuration docs."
category: guide
read_when:
  - You want to customize which docs and code files are scanned
  - You want to change severity thresholds or CI exit behavior
  - You want to disable certain claim types
  - You want to configure URL checking
related:
  - docs/guides/suppressing-findings.md
  - docs/reference/configuration.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Custom Configuration

<!-- docalign:semantic id="sem-ddc2e336e074da30" claim="DocAlign works with zero configuration" -->
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

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for doc_patterns include/exclude" -->
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

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for verification and check severity settings" -->
```yaml
verification:
  min_severity: medium

check:
  min_severity_to_block: high    # CI fails only on high severity
```
<!-- /docalign:skip -->

### Disable specific check types

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for disabling claim types" -->
```yaml
claim_types:
  url_reference: false     # Skip dead link checks
  environment: false       # Skip env var checks
  convention: false        # Skip convention claims
```
<!-- /docalign:skip -->

### Suppress specific findings

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for suppressing findings" -->
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

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for url_check settings" -->
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

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for LLM model selection" -->
```yaml
llm:
  verification_model: claude-sonnet-4-20250514
  extraction_model: claude-sonnet-4-20250514
```
<!-- /docalign:skip -->

### Set up CI blocking

<!-- docalign:skip reason="illustrative_example" description="Illustrative user config YAML for CI blocking threshold" -->
```yaml
check:
  min_severity_to_block: medium
```
<!-- /docalign:skip -->
<!-- docalign:semantic id="sem-9f4a1f63384cd4d0" claim="docalign check exits 0 for low-severity drift and exits 1 only for medium or high" -->
When set, `docalign check` exits 0 for low-severity drift and exits 1 only for medium or high.

## View current config

```bash
docalign status
```

<!-- docalign:semantic id="sem-0767b3c003c6613d" claim="docalign status shows the active config file path, enabled claim types, and any warnings" -->
Shows the active config file path, enabled claim types, and any warnings.

## Full reference

<!-- docalign:semantic id="sem-bfdac13cc0e16515" claim="the full configuration reference has 14 sections" -->
See [Configuration Reference](../reference/configuration.md) for all 14 sections with every field, type, default, and example.
