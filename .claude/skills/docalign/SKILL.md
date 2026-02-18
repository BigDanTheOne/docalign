---
name: docalign
description: >
  Detects documentation drift — finds docs that are out of sync with code.
  Use when user modifies code files and documentation may need updating,
  asks to "check docs", "find stale docs", "verify README", mentions
  "doc drift", or after refactors and API changes. Requires docalign MCP server.
metadata:
  author: DocAlign
  version: 0.3.0
  mcp-server: docalign
---

# DocAlign — Documentation Drift Detection

## Overview

DocAlign verifies that documentation matches code reality. It extracts
factual claims from docs (function signatures, CLI commands, file paths,
config keys, code examples) and checks each claim against the actual codebase.

## When to Use

### Proactive (after code changes)

After modifying code files, use DocAlign to find documentation that
references the changed files and may now be stale.

### On demand

When the user asks to check docs, scan for drift, or verify documentation.

## Available Tools

| Tool                | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `check_doc`         | Check a documentation file for drift           |
| `check_section`     | Check a specific section of a doc file         |
| `get_doc_health`    | Get repo-wide documentation health score       |
| `list_drift`        | List all docs with drift, ordered by severity  |
| `get_docs_for_file` | Find docs that reference a code file           |
| `get_docs`          | Search docs by topic with multi-signal ranking |
| `fix_doc`           | Generate fix suggestions for drifted claims    |
| `report_drift`      | Report a doc inaccuracy for tracking           |

## Workflows

### Workflow 1: Post-Change Doc Check (most important)

When the user has just modified code files:

1. Identify which files were changed (from the conversation context or git diff)
2. For each changed file, call `get_docs_for_file` with the file path
3. If any documentation references the changed file, report what was found
4. For any claims marked "drifted", call `check_doc` on those doc files for full details
5. Suggest specific documentation fixes based on the findings

Example:

- User modifies `src/auth/login.ts`
- Call `get_docs_for_file` with file_path="src/auth/login.ts"
- Discover that `docs/authentication.md` references it with 2 drifted claims
- Call `check_doc` with file="docs/authentication.md" for details
- Report the specific drift and suggest fixes

### Workflow 2: Check a Specific Doc

When user says "check this doc" or "verify README":

1. Call `check_doc` with the file path
2. Report results: total claims, verified count, drifted count
3. For each drifted finding, show: the claim text, severity, reasoning, suggested fix

### Workflow 3: Repository Health Overview

When user asks "how are my docs?" or "documentation health":

1. Call `get_doc_health` (no parameters)
2. Report the health score, total claims checked, and top drift hotspots
3. If score is below 80%, suggest running `list_drift` for details

### Workflow 4: Check a Specific Section

When user says "check the Installation section" or "verify the API section":

1. Call `check_section` with the file path and section heading
2. Report results scoped to that section: claims, verified/drifted counts
3. For each drifted finding, show: the claim text, line number, severity, reasoning, suggested fix
4. If the section is not found, the error will list available section headings

### Workflow 5: Find All Stale Docs

When user asks "what's stale?" or "list drift":

1. Call `list_drift` (optionally with max_results)
2. Report each file with drift and its drifted claim count
3. Suggest checking the worst offenders first

### Workflow 6: Post-Implementation Check

After committing code changes (triggered by the post-commit hook):

1. Call `get_doc_health` to see if overall score dropped
2. If it dropped, call `list_drift` to find newly drifted docs
3. For each drifted doc, call `fix_doc` to get fix suggestions
4. Propose the fixes to the user

### Workflow 7: Search and Verify

When user asks about a topic ("how does auth work?", "what are the API endpoints?"):

1. Call `get_docs` with the topic as query
2. Check `verification_status` of returned sections
3. If verified — share the content confidently
4. If drifted — warn the user and suggest running `fix_doc`
5. If unchecked — note that the docs haven't been verified yet

### Workflow 8: Report and Track Drift

When the agent discovers documentation that doesn't match code but can't fix it now:

1. Call `report_drift` with the doc file, inaccurate text, and actual behavior
2. Include evidence files if known
3. The report is stored locally in `.docalign/reports.json` for later review

## Interpreting Results

### Verdicts

- **verified**: The claim in documentation matches the code. No action needed.
- **drifted**: The documentation says something that contradicts the code. Needs fixing.

### Severity Levels

- **high**: Wrong function signatures, incorrect API endpoints, broken commands — will cause errors if followed
- **medium**: Outdated descriptions, missing parameters, stale config examples
- **low**: Minor inaccuracies, cosmetic differences

### When to Act

- **high severity**: Fix immediately — developers following this doc will hit errors
- **medium severity**: Fix soon — creates confusion
- **low severity**: Fix when convenient

## Troubleshooting

### "No documentation files found"

DocAlign looks for .md, .mdx, .rst files. Make sure docs exist in the repo.

### Many false positives

Some claims about external libraries or tutorial code may be flagged.
The tool filters most of these, but suggest the user run:
`docalign scan --exclude=examples,tutorials`

### MCP server not responding

The MCP server runs via `npx docalign mcp --repo .` — make sure the
project directory is a git repository (has a .git folder).
