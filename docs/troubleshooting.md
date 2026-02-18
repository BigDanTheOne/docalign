---
title: "Troubleshooting"
summary: "Solutions to common DocAlign problems including no docs found, false positives, URL timeouts, too many findings, semantic extraction failures, and MCP connectivity issues."
description: "Symptom/cause/fix format covering: no documentation files found (doc_patterns config), false positives on file paths (path format or suppress), URL checks timing out (timeout_ms, exclude_domains), too many findings (min_severity, suppress, per-file checks), semantic extraction failures (claude CLI auth), config not picked up (.docalign.yml naming, YAML syntax, docalign status), MCP server not connecting (mcp.json config, docalign init), exit code 1 with no visible drift (semantic claims), and monorepo version mismatches."
category: guide
read_when:
  - docalign scan reports 0 files found
  - You are seeing false positives or unexpected drift reports
  - The MCP server is not connecting or tools are unavailable
  - docalign extract is failing
related:
  - docs/guides/suppressing-findings.md
  - docs/guides/custom-configuration.md
  - docs/guides/mcp-integration.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Troubleshooting

## No documentation files found

**Symptom:** `docalign scan` reports 0 files scanned.

<!-- docalign:semantic id="semantic-a3f2c1d4e5b6a7f8" claim="DocAlign looks for files matching its default patterns (README.md, docs/**/*.md, etc.) from the directory where you run the command" -->
**Cause:** DocAlign looks for files matching its default patterns (`README.md`, `docs/**/*.md`, etc.) from the directory where you run the command.

**Fix:** Run from your repository root. If your docs are in a non-standard location, configure `doc_patterns` in `.docalign.yml`:
<!-- docalign:skip reason="user_instruction" description="YAML config example showing how to set doc_patterns" -->

```yaml
doc_patterns:
  include:
    - 'documentation/**/*.md'
<!-- /docalign:skip -->
    - 'wiki/**/*.md'
```

## False positives on file paths

**Symptom:** DocAlign reports a file path as drifted, but it exists.

**Cause:** The path in the doc may be relative to a different base directory, or use a format DocAlign doesn't recognize as a path.

**Fix:** Either update the doc to use a repo-root-relative path, or suppress the finding:
<!-- docalign:skip reason="user_instruction" description="YAML suppress config example for false positives" -->

```yaml
suppress:
  - file: 'docs/examples.md'
    claim_type: path_reference
<!-- /docalign:skip -->
```

## URL checks timing out

**Symptom:** Many URL claims show as `uncertain` with timeout errors.

<!-- docalign:semantic id="semantic-6568b6b199e573c8" claim="Default timeout is 5 seconds for URL checks" -->
**Cause:** Default timeout is 5 seconds. Some sites are slow or block automated requests.

**Fix:** Increase the timeout or exclude slow domains:
<!-- docalign:skip reason="user_instruction" description="YAML url_check timeout config example" -->

```yaml
url_check:
  timeout_ms: 10000
  exclude_domains:
<!-- /docalign:skip -->
    - 'slow-site.example.com'
<!-- docalign:skip reason="user_instruction" description="YAML url_check disable config example" -->
```

To disable URL checking entirely:

<!-- /docalign:skip -->
```yaml
url_check:
  enabled: false
```

## Too many findings

**Symptom:** DocAlign reports dozens of drifted claims and the output is overwhelming.

**Fix options:**
<!-- docalign:skip reason="user_instruction" description="YAML verification min_severity config example" -->

1. Raise the severity floor to focus on important issues:
   ```yaml
   verification:
<!-- /docalign:skip -->
     min_severity: medium
<!-- docalign:skip reason="user_instruction" description="YAML suppress config example for too many findings" -->
   ```

2. Suppress entire files or claim types:
   ```yaml
   suppress:
<!-- /docalign:skip -->
     - file: 'docs/legacy/**'
     - claim_type: url_reference
   ```

3. Use `docalign check <file>` to fix one file at a time instead of scanning everything.

## Semantic extraction fails

**Symptom:** `docalign extract` shows an error.

<!-- docalign:semantic id="semantic-50f05febc53841ff" claim="Semantic extraction requires the claude CLI to be installed and authenticated" -->
**Cause:** Semantic extraction requires the `claude` CLI to be installed and authenticated (part of Claude Code).

**Fix:** Install Claude Code and authenticate:
<!-- docalign:skip reason="user_instruction" description="Shell commands showing how to install/authenticate claude CLI" -->

```bash
claude   # Follow the authentication prompts
docalign extract
```
<!-- /docalign:skip -->

## Config file not being picked up

**Symptom:** Changes to `.docalign.yml` don't take effect.

**Fix:**
<!-- docalign:semantic id="semantic-7f1bfd441de5362b" claim="Config file must be named exactly .docalign.yml (not .docalign.yaml)" -->
1. Check that the file is named exactly `.docalign.yml` (not `.docalign.yaml`)
2. Run `docalign status` to see which config file is active and any warnings
3. Check for YAML syntax errors -- invalid YAML causes DocAlign to fall back to defaults with a warning

## MCP server not connecting

**Symptom:** AI agent can't find DocAlign tools.

**Fix:**
1. Run `docalign status` to check MCP integration status
2. Verify `.claude/mcp.json` (or equivalent) has the correct entry:
<!-- docalign:skip reason="user_instruction" description="JSON mcp.json config example for MCP server entry" -->
   ```json
   {
     "mcpServers": {
       "docalign": {
         "command": "npx",
         "args": ["docalign", "mcp", "--repo", "."]
       }
     }
   }
<!-- /docalign:skip -->
   ```
3. Restart your MCP client (Claude Code, Cursor, etc.)
4. Try `docalign init` to reconfigure automatically

## Exit code 1 but no visible drift

**Symptom:** `docalign check` exits with code 1, but `--verbose` shows all claims verified.

<!-- docalign:semantic id="semantic-fc9358b6e3d3ed09" claim="Semantic claims stored in .docalign/semantic/ can cause exit code 1 with drifted findings not shown without --verbose" -->
**Cause:** Semantic claims (from `.docalign/semantic/`) may have drifted findings not shown without `--verbose`.

**Fix:** Run with `--verbose` to see all claims, or run `docalign check <file>` with `deep_check` via MCP for the full picture.

## Dependency version mismatches for monorepos

**Symptom:** DocAlign reports version drift when different packages have different versions of the same dependency.

<!-- docalign:semantic id="semantic-d4b7990a55d9d52a" claim="DocAlign checks version against the package.json nearest to the repo root" -->
**Cause:** DocAlign checks against the `package.json` nearest to the repo root.

**Fix:** Suppress findings for packages with known version differences:

<!-- docalign:skip reason="user_instruction" description="YAML suppress config example for monorepo version mismatches" -->
```yaml
suppress:
  - package: 'react'
    file: 'docs/packages/legacy-app.md'
```
<!-- /docalign:skip -->

## Getting Help

- Run `docalign help` for command usage
- Run `docalign status` for diagnostic information
- File issues at the project repository
