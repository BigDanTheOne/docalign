---
title: "Suppressing Findings"
summary: "Ignore specific files, patterns, claim types, or packages in DocAlign scan results"
read_when:
  - Suppressing a known false positive in scan results
  - Excluding specific files, packages, or claim types from findings
  - Understanding the limits of suppression rules
description: "Use when you need to ignore specific files, patterns, claim types, or packages in DocAlign results."
category: "guide"
related:
  - docs/reference/configuration.md
  - docs/guides/checking-files.md
---

# Suppressing Findings

Not every finding is actionable. Suppress rules let you ignore specific files, patterns, claim types, or packages.

<!-- docalign:skip reason="illustrative_example" description="YAML block showing all four suppress rule fields together as a combined syntax example, not the project's own config" -->
## Add suppress rules

In `.docalign.yml`:

```yaml
suppress:
  - file: 'docs/legacy.md'
  - claim_type: url_reference
  - package: '@internal/private-pkg'
  - pattern: 'internal-.*-service'
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="YAML block showing suppress-by-file syntax with example paths (docs/legacy.md, docs/archive/**, docs/examples/*.md)" -->
## Suppress by file

Ignore all findings in a file or file pattern:

```yaml
suppress:
  - file: 'docs/legacy.md'           # Exact file
  - file: 'docs/archive/**'           # Glob pattern
  - file: 'docs/examples/*.md'        # All examples
```

<!-- /docalign:skip -->
## Suppress by claim type

Ignore all findings of a specific type:

```yaml
suppress:
  - claim_type: url_reference         # Skip dead link checks
  - claim_type: environment           # Skip env var checks
```

Valid claim types: `path_reference`, `dependency_version`, `command`, `api_route`, `code_example`, `behavior`, `architecture`, `config`, `convention`, `environment`, `url_reference`.

<!-- docalign:skip reason="illustrative_example" description="YAML block showing suppress-by-package syntax with example package names (@internal/private-pkg, legacy-lib)" -->
## Suppress by package

Ignore findings about a specific package:

```yaml
suppress:
  - package: '@internal/private-pkg'
  - package: 'legacy-lib'
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="YAML block showing suppress-by-pattern syntax with example regex patterns" -->
## Suppress by pattern

Ignore findings matching a regex pattern:

```yaml
suppress:
  - pattern: 'internal-.*-service'    # Regex against claim text
  - pattern: 'localhost:\d+'          # Local URLs
```

<!-- /docalign:skip -->
## Combine rules

Multiple fields in one rule are AND-combined:

```yaml
suppress:
  # Ignore path claims only in examples docs
  - file: 'docs/examples.md'
    claim_type: path_reference

  # Ignore express version drift in legacy docs
  - file: 'docs/legacy/**'
    package: 'express'
```

## Alternatively: disable claim types

If you never want a claim type checked across the entire repo, disable it instead of suppressing:

```yaml
claim_types:
  url_reference: false    # Never extract or verify URLs
  environment: false      # Never check env vars
```

This is more efficient than suppressing -- the claims aren't extracted at all.

## Raise the severity floor

To see only important issues without suppressing:

```yaml
verification:
  min_severity: medium    # Only report medium and high severity
```

## Limits

Maximum 200 suppress rules per config file.
