---
title: "Checking Files"
summary: "Scan a repo for drift, check a single file, and interpret the results"
description: "Use when you need to scan a repo for drift, check a single file, or interpret verification results."
category: "guide"
read_when:
  - Running a full repo scan or checking a specific file
  - Interpreting verified, drifted, or uncertain verdicts
  - Understanding severity levels and what they mean
related:
  - docs/reference/cli.md
  - docs/reference/checks.md
  - docs/guides/fixing-drift.md
---

# Checking Files

<!-- docalign:skip reason="user_instruction" description="Scan command usage with bash block — commands handled by regex extractor" -->
## Scan the entire repository

```bash
docalign scan
```

This scans all documentation files matching the configured patterns (default: `README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more). Each file's claims are extracted and verified.

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="JSON output command block — command handled by regex extractor" -->
### JSON output

```bash
docalign scan --json
```

Returns structured JSON for CI integration or piping to other tools.

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Exclude files command block with hypothetical file paths — handled by regex" -->
### Exclude files from a scan

```bash
docalign scan --exclude=docs/archive/old.md,docs/legacy.md
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Check single file command usage with bash blocks — commands handled by regex" -->
## Check a single file

```bash
docalign check README.md
```

By default, shows only drifted claims. To see everything:

```bash
docalign check README.md --verbose
```

The `--verbose` flag includes verified claims in the output, useful for understanding what DocAlign checked.

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="MCP check_section invocation example with hypothetical file/heading — handled by regex" -->
## Check a section via MCP

Using the `check_section` MCP tool, you can verify a specific section:

```
check_section file="README.md" heading="Installation"
```

This scopes extraction and verification to just that heading's content.

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="Read the results table describing output field names and types — capability description of tool output format" -->
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

<!-- docalign:skip reason="user_instruction" description="CI usage bash block — commands and exit code example handled by regex" -->
## Use in CI

`docalign check` exits with code 1 when drift is found, making it suitable for CI gates:

```bash
docalign check README.md || echo "Documentation drift detected"
```

To only fail on serious issues:

```yaml
<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Example .docalign.yml config block — file path and config example handled by regex" -->
# .docalign.yml
check:
  min_severity_to_block: medium
```

This exits 0 for low-severity drift and exits 1 only for medium or high.

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Health overview command blocks (bash and MCP) — commands handled by regex" -->
## Get a health overview

```bash
# Via MCP
get_doc_health
```

Returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files.

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Find docs for file command blocks (bash and MCP) — commands and file paths handled by regex" -->
## Find docs that reference a code file

After changing code, find which docs might be stale:

```bash
# Via MCP
get_docs_for_file file_path="src/auth/middleware.ts"
```

Returns every documentation claim that references that file, with verdict and line number.

<!-- /docalign:skip -->