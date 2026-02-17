# Epic: False Positive Elimination — Inline Tags + Smart Extraction

## Context

A full scan of DocAlign's own repository produces **95 drifted claims with 0 true positives**. Manual verification of 37 findings confirmed every single one is a false positive. The tool currently has 0% precision on its own codebase.

### Root Causes (5 bugs, 3 categories)

**Extractor bugs (L1):**
1. **Example/illustration confusion** (~20 FPs) — Regex extractors treat illustrative examples in tables, capability descriptions, and sample output as factual claims about the current repo. E.g., `docs/reference/checks.md` shows "src/auth.ts" as an example of what the tool detects — extractor treats it as a real file reference.
2. **Instruction vs assertion confusion** (~5 FPs) — "create `.docalign.yml`" is an instruction to the user, not a claim that the file exists. Extractor can't distinguish imperative from declarative.
3. **Prerequisite vs dependency confusion** (~1 FP) — "Node.js 18+" is a runtime prerequisite, not an npm package. Extractor checks package.json dependencies.

**Verifier bugs (L3):**
4. **Relative path resolution** (~10 FPs) — Links like `[CLI Reference](reference/cli.md)` inside `docs/getting-started.md` should resolve to `docs/reference/cli.md`. Verifier checks from repo root instead of the document's directory.
5. **Partial path matching** (~5 FPs) — Docs reference `L3-verifier/index.ts` but the file lives at `src/layers/L3-verifier/index.ts`. Verifier requires exact path from root.

### Competitive Research Summary

| Tool | Approach | Relevance |
|------|----------|-----------|
| **Swimm** | Explicit coupling via `<SwmToken>`, `<SwmPath>` tags. Author marks what to track. Auto-sync uses multi-signal histogram. Fails to human review when confidence is low. | Closest prior art. Tag-based approach inspired our design. |
| **Doc Detective** | Execute docs as browser tests. Regex patterns with procedural verb detection for auto-detecting testable steps. | Verb detection pattern relevant to instruction vs assertion. |
| **Mintlify** | AI agent watches code changes, proposes doc updates. No deterministic analysis. | Pure LLM approach — no precision guarantees. |
| **Semcheck** | LLM compares spec docs against code. Self-described as "somewhat primitive." | Validates that LLM-only verification is insufficient. |
| **Vale** | Markup-aware scoping (heading, table.cell, summary, code). Rules target specific scopes. | Scope system relevant to context-aware extraction. |
| **markdown-link-check** | Resolves relative paths from document directory. Configurable replacement patterns. | Direct fix for Problem 4. |
| **Sphinx** | Had same relative path bug, fixed in PR #8245. | Confirms our fix approach is industry standard. |
| **All link checkers** | None do partial/suffix path matching. None distinguish examples from real references in prose. None detect imperative vs declarative. | Confirms DocAlign is solving genuinely novel problems. |

**Key insight:** No existing tool automatically distinguishes illustrative mentions from factual claims in prose documentation. Swimm sidesteps the problem via explicit author coupling. DocAlign's approach of having Claude classify document structure during extraction is novel.

---

## Architecture Decision

### Inline Tags + Sidecar

**Inline HTML comment tags** embedded in the document for navigation and classification:
- Invisible when rendered (GitHub, GitLab, Docusaurus, MkDocs all strip HTML comments)
- Visible in raw source for both Claude Code and human editors
- Travel with the content when docs are edited (no line-number fragility)
- Self-contained — document carries its own verification metadata

**Sidecar files** in `.docalign/semantic/` for heavy verification metadata:
- Evidence assertions (grep patterns, scope files, expect exists/absent)
- Evidence entities (symbols, files, content hashes)
- Verification history (last verdict, confidence, timestamp)
- Section content hashes (for staleness detection)

### Tag Types

```markdown
<!-- docalign:skip reason="example_table" -->
| Category | Example |
|----------|---------|
| File paths | `src/auth.ts` referenced but doesn't exist |
<!-- /docalign:skip -->
```

```markdown
<!-- docalign:check type="dependency_version" -->
This project uses express 4.21.
```

```markdown
<!-- docalign:semantic claim="Uses JWT for authentication" id="a3f8c2" -->
The AuthService validates JWT tokens on every request.
```

**Three tag types:**

| Tag | Purpose | Sidecar entry? |
|-----|---------|---------------|
| `docalign:skip` | Region is illustrative, instructional, or sample output. Regex extractors skip it entirely. | No |
| `docalign:check` | Region contains a deterministic claim. Regex extractors extract and verifiers check live. | No (verification is stateless) |
| `docalign:semantic` | Region contains a semantic claim. Links to sidecar for assertions and evidence. | Yes — assertions, entities, verification history |

### Extraction Flow (Enhanced `docalign extract`)

Single Claude call per file, two-phase prompt:

**Phase 1 — Document Classification (no tools needed):**
Claude reads the document and identifies skip regions (examples, instructions, sample output, capability descriptions). This is a reading comprehension task — no code exploration.

**Phase 2 — Semantic Claim Extraction (with Read, Glob, Grep tools):**
From the remaining real content, Claude extracts semantic claims with evidence. Same workflow as today — find implementation, read code, write assertions, verify with Grep.

**Output schema (expanded):**
```json
{
  "skip_regions": [
    {
      "start_line": 29,
      "end_line": 38,
      "reason": "example_table",
      "description": "What It Finds example table"
    }
  ],
  "deterministic_claims": [
    {
      "line_number": 82,
      "claim_text": "10 tools available",
      "check_type": "count_reference"
    }
  ],
  "semantic_claims": [
    {
      "claim_text": "Uses JWT for authentication",
      "claim_type": "behavior",
      "line_number": 45,
      "keywords": ["JWT", "authentication"],
      "evidence_entities": [{"symbol": "jwt.sign", "file": "src/auth.ts"}],
      "evidence_assertions": [
        {"pattern": "jwt\\.sign", "scope": "src/auth.ts", "expect": "exists", "description": "JWT signing used for auth"}
      ]
    }
  ]
}
```

**Post-extraction:** Claude's output is converted into inline tags written to the document + sidecar entries for semantic claims. Tags are idempotent — re-running extract updates existing tags rather than duplicating them.

### Three-Tier Priority During Scan

When `docalign check` or `docalign scan` runs:

1. **Inline directives** (highest priority) — User-authored or Claude-authored tags. If a region is tagged `skip`, extractors don't touch it. If tagged `check` or `semantic`, extractors process it.
2. **Sidecar skip_regions** (fallback) — If tags aren't present but sidecar data exists from a prior extract, use that. (Migration/backwards-compat path.)
3. **Unfiltered regex** (cold start) — No tags, no sidecar. Regex extractors run on everything. Current behavior. Produces false positives until `extract` is run.

### Verifier Fixes (Independent of Tags)

These bugs exist in the deterministic verifiers and must be fixed regardless of the tag system:

**Fix 1: Relative path resolution (L3 verifier)**
Resolve claimed paths relative to the document's directory before checking existence. `path.join(path.dirname(docFile), claimedPath)`. Industry standard — every link checker does this. Sphinx had this exact bug.

**Fix 2: Partial path suffix matching (L3 verifier)**
When exact path lookup fails, check if any repo file ends with the claimed path. `L3-verifier/index.ts` matches `src/layers/L3-verifier/index.ts`. If multiple files match the suffix, flag as ambiguous rather than picking one.

**Fix 3: Known-runtime allowlist (L3 verifier)**
Maintain a list of runtime/platform names (Node.js, Python, Ruby, Java, Go, Rust, etc.) that should not be checked against package.json dependencies. Optionally check `engines` field instead.

---

## Task Breakdown

### Wave 1: Verifier Bug Fixes (no architectural change)

**T1: Fix relative path resolution in L3 path verifier**
- Modify `verifyPathReference` to resolve paths relative to `claim.source_file` directory
- Add test cases: relative links from docs subdirectories, `../` traversal, same-directory links
- Expected impact: ~10 false positives eliminated
- Reference: Sphinx PR #8245 for approach

**T2: Add suffix matching fallback to L3 path verifier**
- When exact path not found, search file index for suffix matches
- If exactly one match → treat as found. If multiple → flag as ambiguous.
- Add test cases: partial paths (`L3-verifier/index.ts`), ambiguous suffixes, no-match fallback
- Expected impact: ~5 false positives eliminated

**T3: Add known-runtime allowlist to L3 dependency verifier**
- Allowlist: Node.js, Python, Ruby, Java, Go, Rust, .NET, PHP, Deno, Bun, Docker
- When a version claim matches an allowlist entry, skip package.json check; optionally check `engines` field
- Add test cases: "Node.js 18+", "Python 3.10+", "Docker 24+"
- Expected impact: ~1 false positive eliminated

### Wave 2: Tag System Foundation

**T4: Define tag syntax and parser**
- Define HTML comment tag format: `<!-- docalign:skip -->`, `<!-- /docalign:skip -->`, `<!-- docalign:check type="..." -->`, `<!-- docalign:semantic claim="..." id="..." -->`
- Implement tag parser: given markdown content, extract all docalign tags with line ranges
- Handle nesting, malformed tags, missing close tags gracefully
- Unit tests for all tag types and edge cases

**T5: Tag-aware extraction in L1 regex extractors**
- Before running regex extraction, parse inline tags
- Skip regions marked with `docalign:skip`
- Extract normally from `docalign:check` regions and untagged regions
- Skip semantic-tagged regions (handled by semantic pipeline)
- Integration tests: tagged doc with mixed regions produces correct claim set

**T6: Tag writer — convert Claude output to inline tags**
- Given extraction output (skip_regions, deterministic_claims, semantic_claims), insert/update HTML comment tags in the markdown source
- Idempotent: re-running updates existing tags, doesn't duplicate
- Preserve document formatting — tags go on their own lines before/after the target region
- Handle edge cases: overlapping regions, adjacent tags, tags at document start/end
- Unit tests for insertion, update, removal, and formatting preservation

### Wave 3: Enhanced Extraction Prompt

**T7: Expand P-EXTRACT prompt for two-phase classification + extraction**
- Phase 1 instructions: identify skip regions (examples, instructions, sample output)
- Phase 2 instructions: extract semantic claims from remaining content (unchanged)
- Expand output schema to include `skip_regions` and `deterministic_claims` alongside `claims`
- Add preprocessing/normalization for new schema fields
- Update Zod schema and validation

**T8: Wire enhanced extraction into `docalign extract` command**
- After Claude returns, write inline tags to the document via tag writer (T6)
- Save semantic claims + assertions to sidecar (unchanged)
- Handle partial failures: if tag writing fails, semantic claims still persist
- Progress reporting: show tag insertion count alongside claim count
- Integration test: run extract on a doc, verify tags appear and sidecar is populated

### Wave 4: Validation

**T9: End-to-end validation on DocAlign's own repo**
- Run `docalign extract` on README.md and docs/ files
- Verify tags are inserted correctly (skip regions on example tables, instructions)
- Run `docalign scan` and compare results to baseline (current: 95 FPs)
- Target: <5 false positives on the full repo
- Document any remaining false positives and their root causes

**T10: Validation on 2-3 external repos**
- Select 2-3 well-known open source repos with documentation (e.g., Express, Fastify, or similar)
- Run full extract + scan cycle
- Manually judge precision of findings
- Document results and identify any new false positive patterns

---

## Success Criteria

1. **Precision on DocAlign's own repo**: from 0% to >90% (fewer than 5 false positives out of all reported drift)
2. **No regression**: all 1,441 existing tests continue to pass
3. **Cold start acceptable**: `docalign scan` without prior `extract` works but may have false positives (current behavior, documented as expected)
4. **Tag rendering**: all tags invisible in rendered markdown (GitHub, GitLab, VS Code preview)
5. **Idempotent extract**: running `docalign extract` twice produces the same tags (no duplication)
6. **External validation**: at least 2 external repos scanned with >70% precision

## Non-Goals

- Eliminating ALL false positives (diminishing returns — 90%+ precision is the target)
- Changing the P-VERIFY or P-TRIAGE prompts (verification pipeline is unaffected)
- Modifying the GitHub App / PR comment flow (server-side pipeline unchanged)
- Supporting non-Markdown formats (rst, asciidoc) — out of scope for this epic

## Dependencies

- Existing `docalign extract` command and Claude bridge (implemented)
- Existing `.docalign/semantic/` store (implemented)
- Existing L3 tier1/tier2 verifiers (implemented, to be fixed)

## Risk

- **Tag insertion quality**: Claude may misclassify some regions. Mitigation: conservative defaults (when uncertain, don't tag — let regex run), manual override via user-authored tags.
- **Document modification acceptance**: Some teams may object to any automated changes to their docs. Mitigation: tags are invisible when rendered, `extract` is opt-in (not part of `check`/`scan`), tags can be gitignored via `.gitattributes` if desired.
- **Prompt reliability**: Two-phase prompt may be harder for Claude to follow consistently. Mitigation: structured output schema with Zod validation, preprocessing normalization, retry on parse failure (existing mechanism).
