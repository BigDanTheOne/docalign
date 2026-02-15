# Semantic Extraction

DocAlign's regex-based extraction catches structural claims (file paths, versions, commands), but many documentation claims are expressed in natural language. Semantic extraction uses Claude to find these claims and generate verifiable assertions for them.

## What It Catches

Claims that regex can't extract:

- **Behavior claims:** "Authentication uses JWT tokens stored in HTTP-only cookies"
- **Architecture claims:** "Services communicate via REST APIs, not message queues"
- **Config assumptions:** "Rate limited to 100 requests per minute per API key"
- **Implicit contracts:** "All API endpoints return JSON with an `error` field on failure"
- **Design decisions:** "Database migrations are run automatically on startup"

## How It Works

1. DocAlign splits each doc file into sections (by headings)
2. For each section, Claude receives the section content plus relevant code context
3. Claude identifies verifiable claims and generates grep-verifiable assertions:
   - **Pattern:** a regex or string to search for in code
   - **Scope:** which files to search
   - **Expectation:** whether the pattern should exist or be absent
4. Claude self-checks each assertion against the actual code before returning
5. Results are stored in `.docalign/semantic/` as JSON files

## Usage

### Extract all doc files

```bash
docalign extract
```

Processes every doc file matched by `doc_patterns` config. Skips files and sections whose content hasn't changed since last extraction.

### Extract a specific file

```bash
docalign extract README.md
```

### Force re-extraction

```bash
docalign extract --force
```

Re-extracts all sections even if content hasn't changed. Useful after updating the extraction model or wanting fresh analysis.

### Preview without saving

```bash
docalign extract --dry-run
```

Shows what would be extracted without writing to `.docalign/semantic/`.

## Storage

Extracted claims are stored in `.docalign/semantic/`:

```
.docalign/
  semantic/
    README.md.json
    docs--setup.md.json
    docs--api-reference.md.json
```

Each file contains:
- `version`: schema version
- `source_file`: the doc file path
- `last_extracted_at`: timestamp
- `claims[]`: array of semantic claims, each with:
  - `id`: deterministic ID based on file + claim text
  - `claim_text`: the natural language claim
  - `claim_type`: `behavior`, `architecture`, or `config`
  - `line_number`: where in the doc
  - `section_heading`: which section
  - `keywords`: for search indexing
  - `section_content_hash`: for change detection
  - `evidence_entities`: code symbols referenced
  - `evidence_assertions`: grep-verifiable patterns
  - `last_verification`: most recent verification result

## Verification

Semantic claims are automatically verified when you run:

```bash
docalign check README.md    # Includes semantic claims
docalign scan               # Includes semantic claims for all files
```

The `deep_check` MCP tool also shows semantic claims alongside syntactic ones.

## MCP Integration

Two MCP tools work with semantic claims:

- **`deep_check`** -- Returns both syntactic and semantic findings, shows unchecked sections, and reports coverage
- **`register_claims`** -- Allows AI agents to persist new semantic claims they discover during code analysis

## Requirements

- Requires `claude` CLI to be installed and authenticated (part of Claude Code)
- Uses the model configured in `llm.extraction_model` (default: `claude-sonnet-4-20250514`)
- No `ANTHROPIC_API_KEY` needed -- uses Claude Code's built-in authentication

## Tips

- Run `docalign extract` after significant doc changes to keep semantic claims up to date
- Use `deep_check` via MCP to see which sections have no claims (candidates for extraction)
- Semantic extraction is incremental: unchanged sections are skipped automatically
- Add `.docalign/semantic/` to your `.gitignore` if you don't want to commit extracted claims, or commit them to share across the team
