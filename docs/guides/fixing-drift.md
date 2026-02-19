---
title: "Fixing Drift"
summary: "Guide to fixing drifted documentation — understanding the workflow and letting Claude Code apply fixes directly."
description: "Explains how drift is reported (check_doc, scan_docs), how Claude Code fixes documentation directly by reading the drift evidence and editing the doc, when auto-fix configuration applies, and how to suppress findings that are intentionally out of sync."
category: guide
read_when:
  - You have found drifted claims and want to fix them
  - You want to understand how Claude Code applies documentation fixes
  - You want to enable or configure auto-fix behavior
related:
  - docs/guides/checking-files.md
  - docs/reference/cli.md
  - docs/reference/mcp-tools.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Fixing Drift

When DocAlign finds drifted documentation claims, the fix workflow is straightforward: Claude Code reads the drift evidence, checks the actual code, and edits the documentation to match reality.

## How Claude Code fixes documentation

When the `docalign` skill detects drift after a code change, it reports specific mismatches — including the claim text, line number, evidence files, and what the code actually does. Claude Code then:

1. Reads the referenced evidence files to understand the current code behavior
2. Edits the documentation to accurately reflect what the code does
3. Re-checks with `check_doc` to confirm the drift is resolved

No separate `docalign fix` command is needed — Claude Code handles the edit directly as part of its coding workflow.

## Finding what needs fixing

<!-- docalign:skip reason="sample_output" description="CLI command examples showing hypothetical usage patterns" -->
### Via CLI

```bash
docalign scan                    # Repo-wide overview with hotspots
docalign check README.md         # Specific file details
docalign check README.md --deep  # Full audit including unchecked sections
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="sample_output" description="MCP tool usage examples showing hypothetical invocations" -->
### Via MCP

```
Use scan_docs to get a health score and hotspot list
Use check_doc with file="README.md" for specific findings
Use check_doc with file="README.md", deep=true for a full audit
```

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="Description of drift output format using illustrative field examples" -->
## What drift looks like

Each drifted finding includes:
- **Claim:** The text in the doc that is wrong
- **Actual:** What the code actually does (from the verifier)
- **Evidence:** The code files that prove the discrepancy
- **Severity:** High / Medium / Low

Claude Code uses this information to make the right edit without guessing.

<!-- /docalign:skip -->
## Auto-fix (experimental)

For high-confidence deterministic fixes (version numbers, file paths, script names), you can enable auto-fix:

```yaml
# .docalign.yml
verification:
  auto_fix: true
  auto_fix_threshold: 0.9    # Only auto-fix when confidence >= 90%
```

<!-- docalign:semantic id="sem-95eb03dcca99c446" -->
Only deterministic fixes (version numbers, paths) with confidence above the threshold are applied. LLM suggestions are never auto-applied.

## Suppressing intentional drift

<!-- docalign:skip reason="illustrative_example" description="Example markdown skip directive showing the pattern to follow" -->
If a doc section is intentionally out of sync with the code (examples, tutorials, aspirational descriptions), suppress it:

```markdown
...example content...
```

See [Suppressing Findings](suppressing-findings.md) for all reason codes.

<!-- /docalign:skip -->