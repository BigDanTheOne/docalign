---
title: "Suppressing Findings"
summary: "How to suppress specific DocAlign findings using file, claim_type, package, or pattern rules in .docalign.yml."
description: "Covers the four suppress rule types (file, claim_type, package, pattern), how to combine multiple fields within a rule (AND semantics), disabling claim types entirely vs suppressing, raising the severity floor as an alternative, and the 200 suppress rule limit."
category: guide
read_when:
  - You have false positives or intentional drift you want to ignore
  - You want to suppress findings for legacy or archive docs
  - You want to disable a claim type entirely
related:
  - docs/guides/custom-configuration.md
  - docs/reference/configuration.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Suppressing Findings

Not every finding is actionable. Suppress rules let you ignore specific files, patterns, claim types, or packages.

## Add suppress rules

In `.docalign.yml`:
<!-- docalign:skip reason="user_instruction" description="Overview YAML example showing all four suppress rule types for user configuration" -->

```yaml
suppress:
  - file: 'docs/legacy.md'
  - claim_type: url_reference
  - package: '@internal/private-pkg'
  - pattern: 'internal-.*-service'
```

## Suppress by file
<!-- /docalign:skip -->
Ignore all findings in a file or file pattern:

```yaml
suppress:
  - file: 'docs/legacy.md'           # Exact file
<!-- docalign:skip reason="user_instruction" description="YAML examples showing file-based suppress rules with exact paths and glob patterns" -->
  - file: 'docs/archive/**'           # Glob pattern
  - file: 'docs/examples/*.md'        # All examples
```

## Suppress by claim type

Ignore all findings of a specific type:
<!-- /docalign:skip -->

```yaml
suppress:
  - claim_type: url_reference         # Skip dead link checks
  - claim_type: environment           # Skip env var checks
<!-- docalign:skip reason="user_instruction" description="YAML examples showing claim_type-based suppress rules for url_reference and environment" -->
```

<!-- docalign:semantic id="sem-c9f63433443bd8c2" claim="Valid claim types are path_reference, dependency_version, command, api_route, code_example, behavior, architecture, config, convention, environment, url_reference" -->
Valid claim types: `path_reference`, `dependency_version`, `command`, `api_route`, `code_example`, `behavior`, `architecture`, `config`, `convention`, `environment`, `url_reference`.

## Suppress by package

Ignore findings about a specific package:
```yaml
suppress:
<!-- /docalign:skip -->
  - package: '@internal/private-pkg'
  - package: 'legacy-lib'
```

<!-- docalign:skip reason="user_instruction" description="YAML examples showing package-based suppress rules" -->
## Suppress by pattern

Ignore findings matching a regex pattern:

```yaml
suppress:
  - pattern: 'internal-.*-service'    # Regex against claim text
<!-- /docalign:skip -->
  - pattern: 'localhost:\d+'          # Local URLs
```

## Combine rules

<!-- docalign:skip reason="user_instruction" description="YAML examples showing pattern-based suppress rules using regex against claim text" -->
<!-- docalign:semantic id="sem-035b93f7d0cb5fe3" claim="Multiple fields in one rule are AND-combined" -->
Multiple fields in one rule are AND-combined:

```yaml
suppress:
  # Ignore path claims only in examples docs
  - file: 'docs/examples.md'
<!-- /docalign:skip -->
    claim_type: path_reference

  # Ignore express version drift in legacy docs
  - file: 'docs/legacy/**'
    package: 'express'
```
<!-- docalign:skip reason="user_instruction" description="YAML examples showing multi-field suppress rules with AND semantics" -->

## Alternatively: disable claim types

If you never want a claim type checked across the entire repo, disable it instead of suppressing:

```yaml
claim_types:
url_reference: false    # Never extract or verify URLs
  environment: false      # Never check env vars
```

<!-- docalign:semantic id="sem-d2d3bfa550793051" claim="Disabling a claim type is more efficient than suppressing -- the claims aren't extracted at all" -->
<!-- /docalign:skip -->
This is more efficient than suppressing -- the claims aren't extracted at all.

## Raise the severity floor

To see only important issues without suppressing:

<!-- docalign:skip reason="user_instruction" description="YAML example showing how to set claim_types to false to disable extraction entirely" -->
```yaml
verification:
  min_severity: medium    # Only report medium and high severity
```

## Limits

<!-- docalign:semantic id="sem-7aa983200d9271e3" claim="Maximum 200 suppress rules per config file" -->
Maximum 200 suppress rules per config file.
<!-- /docalign:skip -->

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="YAML example showing min_severity configuration to filter by severity level" -->