# DocAlign — Target State

_Established through strategic review, February 2026._

---

## 1. Product Strategy

DocAlign operates as three layered tiers:

**Tier A — Individual developer (top-of-funnel, free)**
Claude Code skill + local MCP server + CLI. Runs entirely on the developer's machine using their own Anthropic API key. No server infrastructure required. This is the primary product and the primary growth channel.

**Tier B — GitHub App (notification channel only)**
A lightweight webhook handler. When a PR introduces doc drift, it posts a comment directing the developer back to Claude Code to investigate and fix. It is NOT a full scan pipeline — it is a thin notification layer that drives users to the Tier A experience.

**Tier C — Team product (the revenue model)**
Same 4 MCP tools, same verification logic, backed by a shared hosted store. Teams push their `.docalign/semantic/` index to a shared server; all developers and AI agents on the team query one verified, pre-checked doc index. The upgrade from Tier A to Tier C is a sync layer — not a product rebuild.

---

## 2. Data Model

Two artifact types, two responsibilities. Both are version-controlled with the repository.

### 2.1 Inline Tags (live in the doc file)

**Skip regions** — tell the pipeline to ignore illustrative content entirely:

```markdown
<!-- docalign:skip reason="example_table" description="Hypothetical output table" -->
| Path         | Status  |
|-------------|---------|
| src/foo.ts  | ✓       |
<!-- /docalign:skip -->
```

**Semantic claim markers** — tell the pipeline this line is a non-deterministic claim; do not regex-extract it; look up the ID in the JSON store for how to verify it:

```markdown
<!-- docalign:semantic id="sem-a3f291bc7e041d82" -->
The authentication middleware validates JWT tokens on every request.
```

**Rules:**
- Tags carry no redundant data. No `claim=""` attribute — the claim text is the next line, readable by humans and already stored in the JSON. No `status=""` attribute in the initial format; status is written back in-place after verification.
- The ID is a deterministic hash: `sha256("{source_file}:{normalized_claim_text}") → first 16 hex chars`, computed with `openssl dgst -sha256` (cross-platform).

### 2.2 JSON Store (verification metadata)

Location: `.docalign/semantic/<file-path-with--->.json`

Examples:
- `README.md` → `.docalign/semantic/README.md.json`
- `docs/api.md` → `.docalign/semantic/docs--api.md.json`

```json
{
  "version": 1,
  "source_file": "docs/api.md",
  "last_extracted_at": "2026-02-19T10:00:00Z",
  "claims": [
    {
      "id": "sem-a3f291bc7e041d82",
      "claim_text": "The authentication middleware validates JWT tokens on every request.",
      "claim_type": "behavior",
      "line_number": 42,
      "section_heading": "Authentication",
      "section_content_hash": "b7c2d1e4f5a8901c",
      "keywords": ["jwt", "middleware", "authentication"],
      "evidence_entities": [
        {"symbol": "jwtMiddleware", "file": "src/auth/middleware.ts", "content_hash": ""}
      ],
      "evidence_assertions": [
        {"pattern": "import.*jsonwebtoken", "scope": "src/auth/middleware.ts", "expect": "exists", "description": "JWT library imported"},
        {"pattern": "jwt\\.verify", "scope": "src/auth/middleware.ts", "expect": "exists", "description": "JWT verification called"}
      ],
      "last_verification": null
    }
  ]
}
```

**Responsibility split:**
- Inline tag: answers _where_ in the document this claim lives and signals the pipeline to skip regex extraction on that line.
- JSON store: answers _how_ to verify this claim — evidence entities, assertion grep patterns, cached verification results.

---

## 3. The Three Operations

### 3.1 Extract

**Purpose:** Index a document — identify skip regions, identify semantic claims, gather evidence for each.

**When it runs:**
- First time: setup wizard (`docalign-setup` skill) spawns one document-processor sub-agent per document in parallel (batched by user-chosen concurrency limit).
- Subsequently: `docalign extract` for incremental re-indexing of changed sections.

**Two invocation modes, one spec (document-processor.md):**

| Mode | Invocation | Tools available | Use when |
|---|---|---|---|
| Interactive (default) | Claude Code spawns Task sub-agents | Full (Read, Grep, Glob, Edit, Write, Task, Bash) | Developer machine with Claude Code running |
| Headless | `claude -p` subprocess | Restricted (Read, Grep, Glob, Task) | CI, pre-commit hooks, no Claude Code session |

Both modes use the same `document-processor.md` spec and produce identical output. The setup wizard and `docalign extract` are the same operation at different points in the product lifecycle.

**Incremental logic (section-level):**
1. Hash each section by content.
2. Compare against stored hashes from the previous extraction.
3. For sections whose content changed: re-extract fully (new skip tags, new semantic tags, new JSON entries).
4. For sections whose content is unchanged but line numbers shifted: reposition existing inline tags — do not re-extract claims.
5. For new sections: extract fresh.
6. For deleted sections: retire their inline tags and JSON entries.
7. Pass only changed section content to the sub-agent — not the whole file.

**Output per document:**
1. `<!-- docalign:skip -->` block tags wrapping illustrative regions.
2. `<!-- docalign:semantic id="sem-xxx" -->` inline tags before each semantic claim line.
3. `.docalign/semantic/<encoded-path>.json` with claim text, evidence entities, and assertion patterns.

### 3.2 Check (Verify)

**Purpose:** Determine which claims in a document are accurate and which have drifted from code reality.

**Discovery is tag-first:**

```
Read doc file
  │
  ├── Parse all docalign:semantic tags → collect {id, line_number} pairs
  ├── Blank all docalign:skip regions (preserve line count)
  ├── Blank all lines immediately following a docalign:semantic tag
  │
  ├── Run L1 regex extractors on remaining content
  │     → path_reference, api_route, command, dependency_version,
  │       code_example, environment, convention claims
  │
  ├── Verify deterministic claims:
  │     Tier 1 → deterministic by type (fileExists, findRoute, scriptExists, semver compare, findSymbol)
  │     Tier 2 → pattern-based (tsconfig strict, framework import, env var in .env.*, tool versions in dotfiles)
  │     Tier 3 → LLM (Anthropic API, only if ANTHROPIC_API_KEY set, only for unresolved claims)
  │
  ├── For each semantic claim ID:
  │     → look up JSON store → run assertion verification (grep patterns + entity content hashes)
  │     → update last_verification in JSON store
  │
  └── Write verification status back to each docalign:semantic tag (status attribute, in-place)
```

**Fix generation:**
`check_doc` returns drifted findings with `reasoning`, `suggested_fix` direction, and `evidence` file paths. Claude Code generates the actual fix itself — it reads the evidence files directly and applies the correction interactively. There is no hidden LLM call for fix generation inside the pipeline.

### 3.3 Sync (Tier C — future)

Push `.docalign/semantic/*.json` to a shared hosted PostgreSQL-backed store. All team members and AI agents connect to a hosted MCP server backed by that store. Same 4 MCP tools, same verification logic, shared verified index. The GitHub App ingests new `.docalign/` commits on push to main and triggers team-wide staleness checks.

---

## 4. MCP Tools (4)

Reduced from 10 tools to 4. Each tool has a distinct purpose with no overlap.

### `check_doc(file, section?, deep?)`

Verify one document or one section of a document.

- `file` — path relative to repo root
- `section` — optional heading name; scopes verification to that section only (was a separate `check_section` tool)
- `deep` — optional; adds coverage analysis: which headings have no claims at all (was a separate `deep_check` tool)

Returns drifted findings with: claim text, type, line number, severity, reasoning, suggested fix direction, evidence file paths. Claude Code generates the actual corrective text by reading the evidence files.

### `scan_docs(max_results?)`

Verify all monitored documents. Returns overall health score, verified/drifted totals, and a prioritized hotspot list ordered by drifted claim count.

_(Replaces `get_doc_health` + `list_drift`, which called the same underlying `scanRepo()` with different output shapes.)_

### `get_docs(query?, code_file?, verified_only?, max_results?)`

Two input modes, one return shape.

- `query` mode: topic search. Uses 4 signals combined via Reciprocal Rank Fusion: BM25 full-text (MiniSearch), entity graph (claim keywords + evidence file basenames), intent classification (query terms → claim types), verification boost (verified sections ranked higher, drifted ranked lower).
- `code_file` mode: reverse lookup. Given a source code file path, returns all doc sections that reference it via `evidence_files`. Use this after modifying a code file to know which docs need checking.

Returns sections with: file, heading, content preview, verification status, health score, claim counts.

_(Replaces `get_docs` + `get_docs_for_file`.)_

### `register_claims(claims[])`

Persist semantic claims to the JSON store. The write side of the semantic pipeline — used when Claude discovers new behaviors during a conversation and wants to register them without running full `docalign extract`.

Each claim requires: `source_file`, `line_number`, `claim_text`, `claim_type`, `keywords`. Optional: `evidence_entities`, `evidence_assertions`, `verification`.

---

## 5. CLI Commands

```
docalign init
  Setup: write MCP config + hooks into .claude/settings.local.json,
  copy skill files to .claude/skills/ and ~/.claude/skills/,
  prepend setup trigger to CLAUDE.md.

docalign mcp [--repo path]
  Start MCP server (stdio transport). Loaded automatically by Claude Code
  on session start via settings.local.json. Warms up with scanRepo() on launch.

docalign extract [files...] [--headless] [--force]
  Index or re-index documents. Interactive by default (Claude Code sub-agents).
  --headless: subprocess fallback for CI environments.
  --force: re-extract all sections regardless of content hash.
  Incremental by default: only processes changed sections.

docalign check <file> [--section <heading>] [--deep] [--json]
  Verify one document. Mirrors check_doc MCP tool.
  --section: scope to one heading.
  --deep: include coverage analysis.
  --json: machine-readable output for scripting.
  Exit 1 if drift found.

docalign scan [--max <n>] [--json]
  Full repo health check. Mirrors scan_docs MCP tool.
  Exit 1 if drift found.

docalign search <query> [--code-file <path>] [--verified-only] [--json]
  Query verified documentation. Mirrors get_docs MCP tool.
  --code-file: reverse lookup mode (find docs referencing this code file).

docalign status
  Show: config file presence, MCP wiring in settings.local.json,
  ANTHROPIC_API_KEY presence, monitored doc count.

docalign configure [--exclude pattern] [--min-severity level] [--reset]
  Create or update .docalign.yml.

docalign viz [--output path] [--no-open]
  Generate interactive HTML knowledge graph of docs, claims, and
  verification status. Opens in browser by default.
```

CLI and MCP surfaces are parallel — same concepts, same parameters, human-readable terminal output vs. structured JSON.

---

## 6. What Gets Removed

| Removed | Reason |
|---|---|
| `fix_doc` MCP tool | Redundant. `check_doc` returns drifted findings with evidence. Claude Code generates fixes with its own tool access — no hidden LLM call needed. |
| `docalign fix` CLI command | Same reason. Automated blind fix application without Claude in the loop is unsafe. |
| `check_section` MCP tool | Folded into `check_doc(file, section?)`. |
| `deep_check` MCP tool | Folded into `check_doc(file, deep?)`. |
| `get_doc_health` MCP tool | Folded into `scan_docs`. |
| `list_drift` MCP tool | Folded into `scan_docs`. |
| `get_docs_for_file` MCP tool | Folded into `get_docs(code_file?)`. |
| `report_drift` MCP tool | Write-only to a file nothing reads. Value deferred to Tier C team product. |
| `claim=""` attribute on `docalign:semantic` tags | Redundant — claim text is on the next line and in the JSON store. Creates sync hazard when docs are edited. |
| Hidden LLM fix generation in `LocalPipeline.generateFix()` | Removed. Claude Code handles fix reasoning with full codebase context. |

---

## 7. The Four Gaps to Close

| # | Gap | Current | Target |
|---|---|---|---|
| 1 | Discovery direction | JSON-first: `loadSemanticClaimsAsClaims()` iterates `.docalign/semantic/*.json` | Tag-first: parse `docalign:semantic` inline tags, look up JSON by ID |
| 2 | Semantic lines in regex extraction | Lines following `docalign:semantic` tags run through L1 regex extractors, potentially double-extracted | Lines immediately following a `docalign:semantic` tag are blanked before extraction runs |
| 3 | Tag format mismatch | `src/tags/parser.ts` reads `docalign:claim`; setup skill writes `docalign:semantic`; they never intersect | Unified: `docalign:semantic` everywhere, one parser, one format |
| 4 | Status write-back | Verification results never written back to inline tags; tags always show initial status | After verification, `check` writes `status` attribute to each `docalign:semantic` tag in-place |

---

## 8. Extraction Architecture Reconciliation

The setup wizard (`document-processor.md` sub-agents) and `docalign extract` (CLI subprocess) were two separate implementations of the same operation with different prompts, different mechanics, and different outputs.

**Target:** one spec (`document-processor.md`), two invocation modes.

The setup wizard IS `docalign extract` run in interactive mode on all documents for the first time. `docalign extract` IS the setup wizard run incrementally on changed sections. They share the same prompt, the same output format, the same tag schema, and the same JSON schema.

---

## 9. Tag Format Reference

```
Skip region (block):
  <!-- docalign:skip reason="<code>" description="<human description>" -->
  ...content...
  <!-- /docalign:skip -->

  reason codes: example_table | sample_output | illustrative_example |
                user_instruction | capability_description | tutorial_example

Semantic claim (inline, before the claim line):
  <!-- docalign:semantic id="sem-<16-char-hex>" -->
  <the claim line in the document>

  After verification (status written back in-place):
  <!-- docalign:semantic id="sem-<16-char-hex>" status="verified|drifted|uncertain" -->
  <the claim line in the document>

ID computation:
  echo -n "<source_file>:<normalized_claim>" | openssl dgst -sha256 | awk '{print $NF}' | cut -c1-16
  (normalize: trim, lowercase, collapse whitespace)
```

---

## 10. Workflows

### Workflow: Developer modifies a code file

```
1. Developer edits src/auth.ts in Claude Code session
2. Commits via Bash (git commit)
3. PostToolUse hook fires → prints DocAlign reminder
4. docalign skill activates:
   a. get_docs(code_file="src/auth.ts")
      → returns doc sections referencing src/auth.ts
   b. check_doc("docs/authentication.md")
      → returns drifted findings with evidence
   c. Claude reads evidence files, proposes fix text
   d. Claude applies fix with Edit tool
   e. Developer confirms
```

### Workflow: Developer asks about a topic before implementing

```
1. Developer: "How does authentication work in this codebase?"
2. docalign skill activates:
   a. get_docs(query="authentication", verified_only=true)
      → returns verified doc sections about authentication
   b. Claude synthesizes answer from verified content
   c. Claude warns if any relevant sections are drifted
```

### Workflow: Initial project setup

```
1. curl -fsSL .../install.sh | bash
2. install.sh:
   a. npm install -g docalign
   b. docalign init → writes MCP config, hooks, skills, CLAUDE.md trigger
   c. claude "/docalign-setup" (new interactive PTY session)
3. Setup wizard (docalign-setup skill):
   Phase 1: discover docs → multi-select UI → user confirms selection
   Phase 2: write .docalign/config.yml + YAML frontmatter to each doc
   Phase 3: ask user for concurrency limit (default 5)
           → spawn parallel document-processor sub-agents (batched)
           → each sub-agent: write skip tags, semantic tags, JSON store
   Phase 4: optional check_doc scan → remove setup trigger from CLAUDE.md
```

### Workflow: Re-index after documentation changes

```
1. Developer edits docs/api.md (adds new section, rewrites existing one)
2. docalign extract docs/api.md
   → detects changed sections via content hash comparison
   → repositions tags for line-shifted unchanged sections
   → re-extracts only changed sections (spawns sub-agents)
   → updates .docalign/semantic/docs--api.md.json
   → writes new/updated inline tags
```

### Workflow: PR drift notification (Tier B)

```
1. Developer opens PR on GitHub
2. GitHub App webhook fires
3. Thin handler:
   a. Checks .docalign/semantic/ for any claims referencing changed files
   b. Runs assertion verification (no LLM calls)
   c. Posts PR comment: "N doc claims may have drifted. Open in Claude Code to verify."
4. Developer opens Claude Code, docalign skill activates, runs check_doc
```

### Workflow: Team shared index (Tier C)

```
1. Developer runs docalign extract (or setup wizard runs it)
2. .docalign/semantic/*.json updated locally
3. Developer commits and pushes
4. GitHub App detects commit to .docalign/semantic/
5. Ingests JSON files into shared PostgreSQL store
6. All team members' MCP servers now serve updated verified index
7. AI agents across the team query get_docs() → consistent, shared verified docs
```
