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

<!-- docalign:skip reason="user_instruction" description="Interactive setup section showing CLI commands for users to run — instructions, not factual claims about current codebase behavior" -->
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

<!-- docalign:skip reason="illustrative_example" description="YAML config example showing how to configure doc_patterns — illustrative template, not a factual claim about current project state" -->
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
<!-- docalign:skip reason="illustrative_example" description="YAML config example for min_severity and min_severity_to_block — illustrative template" -->
### Focus on important issues only

```yaml
verification:
  min_severity: medium

check:
  min_severity_to_block: high    # CI fails only on high severity
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="YAML config example for disabling claim_types — illustrative template" -->
### Disable specific check types

```yaml
claim_types:
  url_reference: false     # Skip dead link checks
  environment: false       # Skip env var checks
  convention: false        # Skip convention claims
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="YAML config example for suppress rules — illustrative template" -->
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
<!-- docalign:skip reason="illustrative_example" description="YAML config example for url_check settings — illustrative template" -->
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
<!-- docalign:skip reason="illustrative_example" description="YAML config example for LLM model names — illustrative template" -->
### Change LLM models

```yaml
llm:
  verification_model: claude-sonnet-4-20250514
  extraction_model: claude-sonnet-4-20250514
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="YAML config example for check.min_severity_to_block — illustrative template" -->
### Set up CI blocking

```yaml
check:
<!-- /docalign:skip -->
  min_severity_to_block: medium
```

When set, `docalign check` exits 0 for low-severity drift and exits 1 only for medium or high.

<!-- docalign:skip reason="user_instruction" description="View current config section showing docalign status command — user instruction" -->
## View current config

```bash
docalign status
```

Shows the active config file path, enabled claim types, and any warnings.

<!-- /docalign:skip -->
## Full reference

See [Configuration Reference](../reference/configuration.md) for all 14 sections with every field, type, default, and example.
