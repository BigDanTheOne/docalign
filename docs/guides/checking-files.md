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

<!-- docalign:skip reason="sample_output" description="docalign scan command example with illustrative output description" -->
## Scan the entire repository

```bash
docalign scan
```

This scans all documentation files matching the configured patterns (default: `README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more). Each file's claims are extracted and verified.
<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="docalign scan --json command example" -->
### JSON output

```bash
docalign scan --json
```

Returns structured JSON for CI integration or piping to other tools.

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="docalign scan --exclude command example with hypothetical file paths" -->
### Exclude files from a scan

```bash
docalign scan --exclude=docs/archive/old.md,docs/legacy.md
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="docalign check command examples showing CLI syntax" -->
## Check a single file

```bash
docalign check README.md
```

By default, shows only drifted claims. To see everything:

```bash
docalign check README.md --verbose
```

The `--verbose` flag is accepted but not yet implemented — output always shows drifted claims only.

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="check_section MCP tool invocation example" -->
## Check a section via MCP

Using the `check_section` MCP tool, you can verify a specific section:

```
check_section file="README.md" heading="Installation"
```
<!-- /docalign:skip -->

<!-- docalign:semantic id="sem-4ffe43dfb569cac9" claim="check_section scopes extraction and verification to just that heading's content" -->
This scopes extraction and verification to just that heading's content.

<!-- docalign:skip reason="example_table" description="Table showing example finding fields and their descriptions" -->
## Read the results

Each finding includes:

| Field | Description |
|-------|-------------|
| **Line** | Where in the doc the claim appears |
| **Type** | What kind of claim (`path_reference`, `dependency_version`, `command`, etc.) |
| **Verdict** | `verified`, `drifted`, or `uncertain` |
| **Severity** | `low`, `medium`, or `high` (drifted claims only) |
| **Evidence** | What DocAlign found in the code (e.g., "package.json has version 4.18.2") |

<!-- /docalign:skip -->
### Severity levels

- **high**: The claim is wrong in a way that would cause errors (missing files, wrong versions, broken imports)
- **medium**: The claim is outdated or misleading (version drift, renamed APIs, changed defaults)
- **low**: Minor inconsistency (cosmetic, documentation-only, partial matches)

<!-- docalign:skip reason="sample_output" description="CI usage example with exit code behavior and config snippet" -->
## Use in CI

<!-- docalign:semantic id="sem-dc5649e2dfd1b60c" claim="docalign check exits with code 1 when drift is found" -->
`docalign check` exits with code 1 when drift is found, making it suitable for CI gates:

```bash
docalign check README.md || echo "Documentation drift detected"
```

To only fail on serious issues:

```yaml
# .docalign.yml
check:
  min_severity_to_block: medium
```

> **Note:** `min_severity_to_block` does not currently affect the `docalign check` CLI exit code — the CLI always exits 1 for any drift regardless of severity. This setting controls which findings the GitHub App surfaces in PR comments.

## Get a health overview

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="get_doc_health MCP tool invocation example" -->
```bash
# Via MCP
get_doc_health
```

<!-- docalign:semantic id="sem-389327194ba2c36f" claim="get_doc_health returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files" -->
Returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files.

## Find docs that reference a code file

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="get_docs_for_file MCP tool invocation example with placeholder path" -->
After changing code, find which docs might be stale:

```bash
# Via MCP
get_docs_for_file file_path="src/auth/middleware.ts"
```

<!-- docalign:semantic id="sem-f20f108bc2a6c038" claim="get_docs_for_file returns every documentation claim that references that file, with verdict and line number" -->
Returns every documentation claim that references that file, with verdict and line number.

<!-- /docalign:skip -->