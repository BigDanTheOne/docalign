---
title: "Fixing Drift"
description: "Use when you want to generate and apply fix suggestions for drifted documentation claims."
category: "guide"
related:
  - docs/guides/checking-files.md
  - docs/reference/cli.md
---

# Fixing Drift

After finding drifted claims, DocAlign can suggest fixes.

## Generate fix suggestions

### Fix all files with drift

```bash
docalign fix
```

### Fix a specific file

```bash
docalign fix README.md
```

### Fix via MCP

```
Use fix_doc with file="README.md"
```

## What fixes look like

Fix suggestions come in two forms:

### Deterministic fixes

For claims with clear correct values, DocAlign suggests exact replacements:

- **Version mismatch**: "Change `express@4.17` to `express@4.18.2`" (from package.json)
- **Missing script**: "Change `npm run deploy` to `npm run build`" (closest match)
- **Wrong path**: "Change `src/auth.ts` to `src/auth/index.ts`" (fuzzy match)

### LLM-generated fixes

For complex claims, an LLM reads the relevant code and suggests line-level replacements. These include the original text, suggested replacement, and reasoning.

LLM fixes require `ANTHROPIC_API_KEY` to be set. Without it, only deterministic suggestions are available.

## Workflow

1. **Find drift**: `docalign scan` or `list_drift` via MCP
2. **Review suggestions**: `docalign fix <file>` or `fix_doc` via MCP
3. **Apply manually**: Review each suggestion and apply the ones you agree with
4. **Re-check**: `docalign check <file>` to verify the fixes

## Auto-fix (experimental)

For high-confidence deterministic fixes, you can enable auto-fix:

```yaml
# .docalign.yml
verification:
  auto_fix: true
  auto_fix_threshold: 0.9    # Only auto-fix when confidence >= 90%
```

Auto-fix applies changes directly to your documentation files. Only deterministic fixes (version numbers, paths) with confidence above the threshold are applied. LLM suggestions are never auto-applied.

## Report drift manually

If you notice a doc error during work that DocAlign didn't catch:

```
Use report_drift via MCP:
  doc_file: "README.md"
  claim_text: "Uses Redis for caching"
  actual_behavior: "Switched to in-memory LRU cache in v2.0"
  evidence_files: ["src/cache/index.ts"]
```

Reports are stored in `.docalign/reports/` for tracking.
