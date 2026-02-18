---
title: "Troubleshooting"
summary: "Common errors, unexpected results, and debugging steps"
description: "Use when DocAlign produces unexpected results, errors, or you need to debug issues."
category: "guide"
read_when:
  - DocAlign is producing unexpected results or errors
  - A scan result looks wrong and you need to debug it
  - You want to understand why a specific claim was flagged
related:
  - docs/reference/cli.md
  - docs/reference/configuration.md
---

# Troubleshooting

## No documentation files found

**Symptom:** `docalign scan` reports 0 files scanned.

**Cause:** DocAlign looks for files matching its default patterns (`README.md`, `docs/**/*.md`, etc.) from the directory where you run the command.

**Fix:** Run from your repository root. If your docs are in a non-standard location, configure `doc_patterns` in `.docalign.yml`:
<!-- docalign:skip reason="user_instruction" description="YAML config example for doc_patterns showing hypothetical include patterns" -->

```yaml
doc_patterns:
  include:
    - 'documentation/**/*.md'
    - 'wiki/**/*.md'
<!-- /docalign:skip -->
```

## False positives on file paths

**Symptom:** DocAlign reports a file path as drifted, but it exists.

**Cause:** The path in the doc may be relative to a different base directory, or use a format DocAlign doesn't recognize as a path.

<!-- docalign:skip reason="user_instruction" description="YAML suppress example for false-positive path findings" -->
**Fix:** Either update the doc to use a repo-root-relative path, or suppress the finding:

```yaml
suppress:
  - file: 'docs/examples.md'
    claim_type: path_reference
<!-- /docalign:skip -->
```

## URL checks timing out

**Symptom:** Many URL claims show as `uncertain` with timeout errors.

**Cause:** Default timeout is 5 seconds. Some sites are slow or block automated requests.

**Fix:** Increase the timeout or exclude slow domains:

```yaml
url_check:
  timeout_ms: 10000
  exclude_domains:
    - 'slow-site.example.com'
```

To disable URL checking entirely:

```yaml
url_check:
  enabled: false
```

## Too many findings

**Symptom:** DocAlign reports dozens of drifted claims and the output is overwhelming.

**Fix options:**

<!-- docalign:skip reason="user_instruction" description="YAML config examples for min_severity and suppress options" -->
1. Raise the severity floor to focus on important issues:
   ```yaml
   verification:
     min_severity: medium
   ```

2. Suppress entire files or claim types:
   ```yaml
   suppress:
     - file: 'docs/legacy/**'
     - claim_type: url_reference
   ```
<!-- /docalign:skip -->

3. Use `docalign check <file>` to fix one file at a time instead of scanning everything.

## Semantic extraction fails

**Symptom:** `docalign extract` shows an error.

**Cause:** Semantic extraction requires the `claude` CLI to be installed and authenticated (part of Claude Code).

**Fix:** Install Claude Code and authenticate:

```bash
claude   # Follow the authentication prompts
docalign extract
```

## Config file not being picked up

**Symptom:** Changes to `.docalign.yml` don't take effect.

**Fix:**
1. Check that the file is named exactly `.docalign.yml` (not `.docalign.yaml`)
2. Run `docalign status` to see which config file is active and any warnings
3. Check for YAML syntax errors -- invalid YAML causes DocAlign to fall back to defaults with a warning

## MCP server not connecting

**Symptom:** AI agent can't find DocAlign tools.

**Fix:**
1. Run `docalign status` to check MCP integration status
2. Verify `.claude/mcp.json` (or equivalent) has the correct entry:
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
3. Restart your MCP client (Claude Code, Cursor, etc.)
4. Try `docalign init` to reconfigure automatically

## Exit code 1 but no visible drift

**Symptom:** `docalign check` exits with code 1, but `--verbose` shows all claims verified.

**Cause:** Semantic claims (from `.docalign/semantic/`) may have drifted findings not shown without `--verbose`.

**Fix:** Run with `--verbose` to see all claims, or run `docalign check <file>` with `deep_check` via MCP for the full picture.

## Dependency version mismatches for monorepos

**Symptom:** DocAlign reports version drift when different packages have different versions of the same dependency.

**Cause:** DocAlign checks against the `package.json` nearest to the repo root.
<!-- docalign:skip reason="user_instruction" description="YAML suppress example for monorepo package version differences" -->

**Fix:** Suppress findings for packages with known version differences:

```yaml
suppress:
  - package: 'react'
<!-- /docalign:skip -->
    file: 'docs/packages/legacy-app.md'
```

## Getting Help

- Run `docalign help` for command usage
- Run `docalign status` for diagnostic information
- File issues at the project repository
