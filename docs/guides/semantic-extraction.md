---
title: "Semantic Extraction"
summary: "Guide to extracting behavior, architecture, and config claims using Claude that regex patterns can't catch."
description: "Explains what semantic extraction catches (behavior, architecture, config, implicit contracts, design decisions), how to run extraction (docalign extract, single file, --force, --dry-run), how it works (section splitting, Claude analysis, grep-verifiable assertions, self-check, storage in .docalign/semantic/), verification integration, MCP tools (deep_check, register_claims), requirements (claude CLI, claude-sonnet-4-20250514 model), and tips."
category: guide
read_when:
  - You want to find claims that regex extraction misses
  - You want to extract behavior or architecture claims
  - You need to understand .docalign/semantic/ files
related:
  - docs/guides/checking-files.md
  - docs/reference/mcp-tools.md
  - docs/reference/checks.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Semantic Extraction

DocAlign's regex extraction catches structural claims (file paths, versions, commands), but documentation often contains natural language claims that regex can't extract. Semantic extraction uses Claude to find these.

<!-- docalign:skip reason="capability_description" description="What it catches examples listing illustrative claim types with hypothetical example claims" -->
## What it catches

Claims that regex misses:

- **Behavior**: "Authentication uses JWT tokens stored in HTTP-only cookies"
- **Architecture**: "Services communicate via REST APIs, not message queues"
- **Config assumptions**: "Rate limited to 100 requests per minute per API key"
- **Implicit contracts**: "All API endpoints return JSON with an `error` field on failure"
- **Design decisions**: "Database migrations are run automatically on startup"

## Extract all doc files

<!-- /docalign:skip -->
```bash
docalign extract
```

Processes every doc file matched by `doc_patterns` config. Skips files and sections whose content hasn't changed since last extraction.

## Extract a single file

```bash
docalign extract README.md
```

## Force re-extraction

```bash
docalign extract --force
```

Re-extracts all sections even if content hasn't changed. Useful after updating the extraction model or wanting fresh analysis.

## Preview without saving

```bash
docalign extract --dry-run
```

Shows what would be extracted without writing to `.docalign/semantic/`.

## How it works

<!-- docalign:semantic id="sem-7f996936be94674d" claim="DocAlign splits each doc file into sections (by headings)" -->
1. DocAlign splits each doc file into sections (by headings)
2. For each section, Claude receives the content plus relevant code context
3. Claude identifies verifiable claims and generates grep-verifiable assertions:
   - **Pattern**: a regex or string to search for in code
   - **Scope**: which files to search
   - **Expectation**: whether the pattern should exist or be absent
<!-- docalign:semantic id="sem-2b008dc357a2af5b" claim="Claude self-checks each assertion against the actual code before returning" -->
4. Claude self-checks each assertion against the actual code before returning
5. Results are stored in `.docalign/semantic/` as JSON files

## Storage

<!-- docalign:skip reason="illustrative_example" description="File listing showing hypothetical .docalign/semantic/ contents with invented filenames" -->
Extracted claims are saved to `.docalign/semantic/`:

```
.docalign/
  semantic/
    README.md.json
    docs--setup.md.json
    docs--api-reference.md.json
```
Each file contains the source file, extraction timestamp, and an array of claims with their assertion patterns and verification results.

## Verification

Semantic claims are verified automatically on every check and scan:

<!-- /docalign:skip -->
```bash
docalign check README.md    # Includes semantic claims
docalign scan               # Includes semantic claims for all files
```

## MCP integration

Two MCP tools work with semantic claims:

- **`deep_check`**: Returns syntactic + semantic findings, shows unchecked sections, reports coverage
- **`register_claims`**: Persist new semantic claims discovered during agent analysis

## Requirements

- `claude` CLI installed and authenticated (part of Claude Code)
- Uses the `claude` CLI's built-in model directly (the `llm.extraction_model` config is not read by the CLI extraction path — it applies to the GitHub App server path only)
<!-- docalign:semantic id="sem-175db9b33078f1ba" claim="No ANTHROPIC_API_KEY needed -- uses Claude Code's built-in authentication" -->
- No `ANTHROPIC_API_KEY` needed -- uses Claude Code's built-in authentication

## Tips

- Run `docalign extract` after significant doc changes to keep claims current
- Use `deep_check` via MCP to find sections with no claims (candidates for extraction)
- Extraction is incremental: unchanged sections are skipped automatically
- Add `.docalign/semantic/` to `.gitignore` or commit it to share across the team
