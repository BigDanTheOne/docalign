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

The `--verbose` flag includes verified claims in the output, useful for understanding what DocAlign checked.

## Check a section via MCP

Using the `check_section` MCP tool, you can verify a specific section:

```
check_section file="README.md" heading="Installation"
```

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

## Get a health overview

```bash
# Via MCP
get_doc_health
```

Returns a 0-100 score, total claims, verified/drifted counts, and the top 10 worst files.

## Find docs that reference a code file

After changing code, find which docs might be stale:

```bash
# Via MCP
get_docs_for_file file_path="src/auth/middleware.ts"
```

Returns every documentation claim that references that file, with verdict and line number.


