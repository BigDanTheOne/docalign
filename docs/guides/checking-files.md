# Checking Files

<!-- docalign:skip reason="sample_output" description="docalign scan command example — command itself is regex-caught; prose describes what the scan does at a high level" -->
## Scan the entire repository

```bash
docalign scan
```

This scans all documentation files matching the configured patterns (default: `README.md`, `docs/**/*.md`, `CONTRIBUTING.md`, and more). Each file's claims are extracted and verified.
<!-- /docalign:skip -->

<!-- docalign:skip reason="sample_output" description="docalign scan --json command block — command flag is regex-caught; description of CI integration is capability prose" -->
### JSON output

```bash
docalign scan --json
```

Returns structured JSON for CI integration or piping to other tools.

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="docalign scan --exclude command block with hypothetical doc file paths — command and example paths are regex-caught" -->
### Exclude files from a scan

```bash
docalign scan --exclude=docs/archive/old.md,docs/legacy.md
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="docalign check README.md and --verbose command examples — commands and file paths are regex-caught" -->
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
<!-- docalign:skip reason="sample_output" description="check_section MCP tool usage example with hypothetical file and heading — illustrative usage, not a factual claim about return shape" -->
## Check a section via MCP

Using the `check_section` MCP tool, you can verify a specific section:

```
check_section file="README.md" heading="Installation"
```

This scopes extraction and verification to just that heading's content.

<!-- /docalign:skip -->
<!-- docalign:skip reason="example_table" description="Results field table (Line, Type, Verdict, Severity, Evidence) — describes output schema; claim_type names like path_reference/dependency_version/command are regex-caught; severity/verdict names are covered below" -->
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

## Use in CI

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

This exits 0 for low-severity drift and exits 1 only for medium or high.

<!-- docalign:skip reason="sample_output" description="docalign health command and get_doc_health MCP invocation examples — commands are regex-caught; return shape claim is extracted below" -->
## Get a health overview

```bash
# Via MCP
get_doc_health
```

Returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files.

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="get_docs_for_file MCP usage example with hypothetical file path — command/path regex-caught; return shape claim is extracted below" -->
## Find docs that reference a code file

After changing code, find which docs might be stale:

```bash
# Via MCP
get_docs_for_file file_path="src/auth/middleware.ts"
```

Returns every documentation claim that references that file, with verdict and line number.


<!-- /docalign:skip -->