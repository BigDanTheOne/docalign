# Suppressing Findings

Not every finding is actionable. Suppress rules let you ignore specific files, patterns, claim types, or packages.

<!-- docalign:skip reason="illustrative_example" description="Sample .docalign.yml suppress block showing multiple rule types — already marked by docalign:skip" -->
## Add suppress rules

In `.docalign.yml`:

```yaml
suppress:
  - file: 'docs/legacy.md'
  - claim_type: url_reference
  - package: '@internal/private-pkg'
  - pattern: 'internal-.*-service'
```

## Suppress by file
<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Suppress-by-file YAML examples with hypothetical file paths — already marked by docalign:skip" -->

Ignore all findings in a file or file pattern:

```yaml
suppress:
  - file: 'docs/legacy.md'           # Exact file
  - file: 'docs/archive/**'           # Glob pattern
  - file: 'docs/examples/*.md'        # All examples
```

## Suppress by claim type

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Suppress-by-claim-type YAML examples — already marked by docalign:skip" -->
Ignore all findings of a specific type:

```yaml
suppress:
  - claim_type: url_reference         # Skip dead link checks
  - claim_type: environment           # Skip env var checks
```

Valid claim types: `path_reference`, `dependency_version`, `command`, `api_route`, `code_example`, `behavior`, `architecture`, `config`, `convention`, `environment`, `url_reference`.

## Suppress by package

Ignore findings about a specific package:
<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Suppress-by-package YAML examples — already marked by docalign:skip" -->

```yaml
suppress:
  - package: '@internal/private-pkg'
  - package: 'legacy-lib'
```

## Suppress by pattern

Ignore findings matching a regex pattern:

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Suppress-by-pattern YAML examples — already marked by docalign:skip" -->
```yaml
suppress:
  - pattern: 'internal-.*-service'    # Regex against claim text
  - pattern: 'localhost:\d+'          # Local URLs
```

## Combine rules

Multiple fields in one rule are AND-combined:

```yaml
<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Combine-rules YAML examples — already marked by docalign:skip" -->
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
<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Disable claim types YAML examples — already marked by docalign:skip" -->
  url_reference: false    # Never extract or verify URLs
  environment: false      # Never check env vars
```

This is more efficient than suppressing -- the claims aren't extracted at all.

## Raise the severity floor

To see only important issues without suppressing:

```yaml
verification:
  min_severity: medium    # Only report medium and high severity
<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Raise severity floor YAML example — already marked by docalign:skip" -->
```

## Limits

Maximum 200 suppress rules per config file.

<!-- /docalign:skip -->