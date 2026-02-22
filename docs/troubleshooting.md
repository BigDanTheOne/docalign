---
title: "Troubleshooting DocAlign"
summary: "Common problems and solutions for DocAlign, including no docs found, false positives, timeout issues, and MCP connectivity."
description: "Covers common issues: no documentation files found, false positive path findings, URL check timeouts, too many findings, semantic extraction failures, config file not picked up, MCP server not connecting, exit code 1 with no visible drift, and monorepo version mismatches."
category: reference
read_when:
  - docalign scan reports 0 files scanned
  - You are getting unexpected false positives
  - The MCP server is not connecting
  - docalign extract fails or shows errors
related:
  - docs/guides/custom-configuration.md
  - docs/guides/suppressing-findings.md
  - docs/guides/mcp-integration.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Troubleshooting

## No documentation files found

**Symptom:** `docalign scan` reports 0 files scanned.

<!-- docalign:semantic id="sem-7f7f904a292774c0" claim="DocAlign looks for files matching its default patterns from the directory where you run the command" -->
**Cause:** DocAlign looks for files matching its default patterns (`README.md`, `docs/**/*.md`, etc.) from the directory where you run the command.

**Fix:** Run from your repository root. If your docs are in a non-standard location, configure `doc_patterns` in `.docalign.yml`:
<!-- docalign:skip reason="user_instruction" description="YAML example showing how to configure doc_patterns.include for custom doc locations" -->
```yaml
doc_patterns:
  include:
    - 'documentation/**/*.md'
- 'wiki/**/*.md'
```
<!-- docalign:end-skip -->

## False positives on file paths

**Symptom:** DocAlign reports a file path as drifted, but it exists.

**Cause:** The path in the doc may be relative to a different base directory, or use a format DocAlign doesn't recognize as a path.

**Fix:** Either update the doc to use a repo-root-relative path, or suppress the finding:
<!-- docalign:skip reason="user_instruction" description="YAML example showing how to suppress a path_reference finding for a specific file" -->
```yaml
suppress:
  - file: 'docs/examples.md'
    claim_type: path_reference
```
<!-- docalign:end-skip -->

## URL checks timing out

**Symptom:** Many URL claims show as `uncertain` with timeout errors.

<!-- docalign:semantic id="sem-1b2c3dc31499d6d0" claim="Default timeout is 5 seconds" -->
**Cause:** Default timeout is 5 seconds. Some sites are slow or block automated requests.

**Fix:** Increase the timeout or exclude slow domains:
<!-- docalign:skip reason="user_instruction" description="YAML example showing how to increase url_check timeout_ms and exclude slow domains" -->
```yaml
url_check:
  timeout_ms: 10000
  exclude_domains:
- 'slow-site.example.com'
```
<!-- docalign:end-skip -->

To disable URL checking entirely:

<!-- docalign:skip reason="user_instruction" description="YAML example showing how to disable URL checking entirely" -->
```yaml
url_check:
  enabled: false
```
<!-- docalign:end-skip -->

## Too many findings

**Symptom:** DocAlign reports dozens of drifted claims and the output is overwhelming.

**Fix options:**
1. Raise the severity floor to focus on important issues:
<!-- docalign:skip reason="user_instruction" description="YAML example showing how to set verification.min_severity to filter findings" -->
   ```yaml
   verification:
min_severity: medium
```
<!-- docalign:end-skip -->

2. Suppress entire files or claim types:
<!-- docalign:skip reason="user_instruction" description="YAML example showing how to suppress findings for legacy docs and url_reference claim type" -->
   ```yaml
   suppress:
- file: 'docs/legacy/**'
     - claim_type: url_reference
   ```
<!-- docalign:end-skip -->

3. Use `docalign check <file>` to fix one file at a time instead of scanning everything.

## Semantic extraction fails

**Symptom:** `docalign extract` shows an error.

<!-- docalign:semantic id="sem-b612dbffa31051b8" claim="Semantic extraction requires the claude CLI to be installed and authenticated" -->
**Cause:** Semantic extraction requires the `claude` CLI to be installed and authenticated (part of Claude Code).

**Fix:** Install Claude Code and authenticate:
<!-- docalign:skip reason="user_instruction" description="Bash commands telling the user to run claude for authentication then docalign extract" -->
```bash
claude   # Follow the authentication prompts
docalign extract
```
<!-- docalign:end-skip -->
## Config file not being picked up

**Symptom:** Changes to `.docalign.yml` don't take effect.

**Fix:**
1. Check that the file is named exactly `.docalign.yml` (not `.docalign.yaml`)
2. Run `docalign status` to see which config file is active and any warnings
<!-- docalign:semantic id="sem-4ed97e052569c9b4" claim="invalid YAML causes DocAlign to fall back to defaults with a warning" -->
3. Check for YAML syntax errors -- invalid YAML causes DocAlign to fall back to defaults with a warning

## MCP server not connecting

**Symptom:** AI agent can't find DocAlign tools.

**Fix:**
1. Run `docalign status` to check MCP integration status
2. Verify your MCP client configuration has the correct entry (run `docalign init` to configure automatically):
<!-- docalign:skip reason="user_instruction" description="JSON example showing the correct MCP config entry for the docalign MCP server" -->
```json
   {
     "mcpServers": {
       "docalign": {
         "command": "npx",
         "args": ["docalign", "mcp", "--repo", "."]
       }
     }
   }
```
<!-- docalign:end-skip -->
3. Restart your MCP client (Claude Code, Cursor, etc.)
4. Try `docalign init` to reconfigure automatically

## Exit code 1 but no visible drift

**Symptom:** `docalign check` exits with code 1, but `--verbose` shows all claims verified.

<!-- docalign:semantic id="sem-bdc3011d81bc4698" claim="docalign check exits with code 1 when semantic claims have drifted findings" -->
**Cause:** Semantic claims (from `.docalign/semantic/`) may have drifted findings not shown without `--verbose`.

**Fix:** Run with `--verbose` to see all claims, or run `docalign check <file>` with `deep_check` via MCP for the full picture.

## Dependency version mismatches for monorepos

**Symptom:** DocAlign reports version drift when different packages have different versions of the same dependency.

<!-- docalign:semantic id="sem-7011649292f64661" claim="DocAlign checks against the package.json nearest to the repo root" -->
**Cause:** DocAlign checks against the `package.json` nearest to the repo root.

**Fix:** Suppress findings for packages with known version differences:

<!-- docalign:skip reason="user_instruction" description="YAML example showing how to suppress version drift findings for a specific package in a monorepo" -->
```yaml
suppress:
  - package: 'react'
    file: 'docs/packages/legacy-app.md'
```
<!-- docalign:end-skip -->
## Getting Help

- Run `docalign help` for command usage
- Run `docalign status` for diagnostic information
- File issues at the project repository
