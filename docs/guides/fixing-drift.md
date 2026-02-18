---
title: "Fixing Drift"
summary: "How to generate and apply fix suggestions for drifted documentation claims using the CLI and MCP."
description: "Explains docalign fix (all files or single file) and fix_doc MCP tool. Covers two fix types: deterministic fixes (exact replacements for versions, paths, scripts) and LLM-generated fixes (line-level replacements with reasoning, requires ANTHROPIC_API_KEY). Describes the scan→review→apply→re-check workflow, experimental auto-fix config (auto_fix: true, auto_fix_threshold), and the report_drift MCP tool for manually tracking doc errors not caught by DocAlign."
category: guide
read_when:
  - You have found drifted claims and want fix suggestions
  - You want to enable auto-fix for high-confidence deterministic corrections
  - You noticed a doc error during work and want to track it
related:
  - docs/guides/checking-files.md
  - docs/reference/mcp-tools.md
  - docs/guides/suppressing-findings.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Fixing Drift

After finding drifted claims, DocAlign can suggest fixes.

## Generate fix suggestions

<!-- docalign:skip reason="sample_output" description="bash code block showing docalign fix command — handled by regex extractor" -->
### Fix all files with drift

```bash
docalign fix
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="bash code block showing docalign fix README.md command — handled by regex extractor" -->
### Fix a specific file

```bash
docalign fix README.md
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="MCP usage example showing fix_doc invocation — handled by regex extractor" -->
### Fix via MCP

```
Use fix_doc with file="README.md"
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="What fixes look like section — already marked with docalign:skip, contains hypothetical fix output examples" -->
## What fixes look like

Fix suggestions come in two forms:

### Deterministic fixes

For claims with clear correct values, DocAlign suggests exact replacements:

- **Version mismatch**: "Change `express@4.17` to `express@4.18.2`" (from package.json)
- **Missing script**: "Change `npm run deploy` to `npm run build`" (closest match)
- **Wrong path**: "Change `src/auth.ts` to `src/auth/index.ts`" (fuzzy match)

### LLM-generated fixes

<!-- /docalign:skip -->
For complex claims, an LLM reads the relevant code and suggests line-level replacements. These include the original text, suggested replacement, and reasoning.

<!-- docalign:semantic id="sem-cf1f4e85f0277e92" claim="LLM fixes require ANTHROPIC_API_KEY to be set. Without it, only deterministic suggestions are available." -->
LLM fixes require `ANTHROPIC_API_KEY` to be set. Without it, only deterministic suggestions are available.

## Workflow

<!-- docalign:skip reason="sample_output" description="Workflow steps referencing docalign commands and MCP tool names — command/path references handled by regex" -->
1. **Find drift**: `docalign scan` or `list_drift` via MCP
2. **Review suggestions**: `docalign fix <file>` or `fix_doc` via MCP
3. **Apply manually**: Review each suggestion and apply the ones you agree with
4. **Re-check**: `docalign check <file>` to verify the fixes

## Auto-fix (experimental)

<!-- /docalign:skip -->
<!-- docalign:skip reason="user_instruction" description="Auto-fix experimental section — already contains docalign:skip blocks for config YAML and MCP usage examples" -->
For high-confidence deterministic fixes, you can enable auto-fix:

```yaml
# .docalign.yml
verification:
  auto_fix: true
  auto_fix_threshold: 0.9    # Only auto-fix when confidence >= 90%
```

Auto-fix applies changes directly to your documentation files. <!-- docalign:semantic id="sem-95eb03dcca99c446" claim="Only deterministic fixes (version numbers, paths) with confidence above the threshold are applied. LLM suggestions are never auto-applied." -->Only deterministic fixes (version numbers, paths) with confidence above the threshold are applied. LLM suggestions are never auto-applied.

## Report drift manually

If you notice a doc error during work that DocAlign didn't catch:

```
Use report_drift via MCP:
  doc_file: "README.md"
  claim_text: "Uses Redis for caching"
  actual_behavior: "Switched to in-memory LRU cache in v2.0"
  evidence_files: ["src/cache/index.ts"]
```

<!-- docalign:semantic id="sem-83ab8696bf85fd27" claim="Reports are stored in .docalign/reports/ for tracking" -->
Reports are stored in `.docalign/reports/` for tracking.

<!-- /docalign:skip -->