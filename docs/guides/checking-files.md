---
title: "Checking Files"
summary: "Guide to scanning the entire repository or checking specific files for documentation drift."
description: "Covers docalign scan (full repo scan, JSON output, exclude flags), docalign check <file> (single file with --verbose), check_section via MCP (section-scoped checking), reading results (line, type, verdict, severity, evidence), severity levels (high/medium/low), CI integration with exit codes, get_doc_health for health overview, and get_docs_for_file reverse lookup."
category: guide
read_when:
  - You want to scan your repo for documentation drift
  - You want to check a specific file
  - You are integrating docalign into CI
  - You want to find which docs reference a changed code file
related:
  - docs/getting-started.md
  - docs/guides/fixing-drift.md
  - docs/reference/cli.md
  - docs/reference/mcp-tools.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Checking Files

## Scan the entire repository

```bash
docalign scan
```

This scans all documentation files matching the configured patterns (default: `README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more). Each file's claims are extracted and verified.
### JSON output

```bash
docalign scan --json
```

Returns structured JSON for CI integration or piping to other tools.

### Exclude files from a scan

```bash
docalign scan --exclude=docs/archive/old.md,docs/legacy.md
```

## Check a single file

```bash
docalign check README.md
```

By default, shows only drifted claims. To see everything:

```bash
docalign check README.md --verbose
```

<!-- docalign:semantic id="sem-97bbed93d0e4d372" claim="the --verbose flag includes verified claims in the output" -->
The `--verbose` flag includes verified claims in the output, useful for understanding what DocAlign checked.

## Check a section via MCP

Using the `check_section` MCP tool, you can verify a specific section:

```
check_section file="README.md" heading="Installation"
```

<!-- docalign:semantic id="sem-4ffe43dfb569cac9" claim="check_section scopes extraction and verification to just that heading's content" -->
This scopes extraction and verification to just that heading's content.

## Read the results

Each finding includes:

| Field | Description |
|-------|-------------|
| **Line** | Where in the doc the claim appears |
| **Type** | What kind of claim (`path_reference`, `dependency_version`, `command`, etc.) |
| **Verdict** | `verified`, `drifted`, or `uncertain` |
| **Severity** | `low`, `medium`, or `high` (drifted claims only) |
| **Evidence** | What DocAlign found in the code (e.g., "package.json has version 4.18.2") |

### Severity levels

- **high**: The claim is wrong in a way that would cause errors (missing files, wrong versions, broken imports)
- **medium**: The claim is outdated or misleading (version drift, renamed APIs, changed defaults)
- **low**: Minor inconsistency (cosmetic, documentation-only, partial matches)

## Use in CI

<!-- docalign:semantic id="sem-dc5649e2dfd1b60c" claim="docalign check exits with code 1 when drift is found" -->
`docalign check` exits with code 1 when drift is found, making it suitable for CI gates:

```bash
docalign check README.md || echo "Documentation drift detected"
```

To only fail on serious issues:

<!-- docalign:skip reason="illustrative_example" description="Example .docalign.yml config block showing user configuration syntax" -->
```yaml
# .docalign.yml
check:
  min_severity_to_block: medium
```
<!-- /docalign:skip -->

<!-- docalign:semantic id="sem-9fb30046e03a2830" claim="with min_severity_to_block: medium, exits 0 for low-severity drift and exits 1 only for medium or high" -->
This exits 0 for low-severity drift and exits 1 only for medium or high.

## Get a health overview

```bash
# Via MCP
get_doc_health
```

<!-- docalign:semantic id="sem-389327194ba2c36f" claim="get_doc_health returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files" -->
Returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files.

## Find docs that reference a code file

After changing code, find which docs might be stale:

<!-- docalign:skip reason="illustrative_example" description="Example get_docs_for_file invocation with placeholder file path" -->
```bash
# Via MCP
get_docs_for_file file_path="src/auth/middleware.ts"
```
<!-- /docalign:skip -->

<!-- docalign:semantic id="sem-f20f108bc2a6c038" claim="get_docs_for_file returns every documentation claim that references that file, with verdict and line number" -->
Returns every documentation claim that references that file, with verdict and line number.
