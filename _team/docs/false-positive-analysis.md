# DocAlign False Positive Analysis & Solution Synthesis

## Current State

Full scan of DocAlign's own repository: **95 drifted claims, 0 true positives** (based on 37 manually verified findings — all false positives). Three root-cause bugs account for ~95% of false positives.

---

## Problem 1: Relative Path Resolution

**Impact:** ~10 false positives (all from `docs/getting-started.md`, `docs/reference/cli.md`, and similar files inside `docs/`)

**Root cause:** When a doc at `docs/getting-started.md` contains a markdown link `[CLI Reference](reference/cli.md)`, DocAlign checks whether `reference/cli.md` exists from the **repo root**. It doesn't. The file exists at `docs/reference/cli.md` — the link is relative to the document's directory.

### Solutions Considered

**S1.1: Resolve from document directory (industry standard)**
Every tool does this — markdown-link-check, remark-validate-links, Sphinx, Docusaurus. Simple `path.join(path.dirname(docFile), claimedPath)` before checking existence. Sphinx had this exact bug and fixed it in PR #8245.
- Effort: Small (verifier change)
- Risk: None — this is universally agreed-upon behavior
- Precedent: All tools

**S1.2: Configurable base path (markdown-link-check approach)**
Add a `projectBaseUrl` or `doc_root` config option in `.docalign.yml` for repos where docs are rendered by a static site generator (Hugo, Jekyll, Docusaurus) that changes the resolution context.
- Effort: Small (config schema + verifier change)
- Risk: Over-engineering for now
- Precedent: markdown-link-check `projectBaseUrl`, `replacementPatterns`

**S1.3: Replacement patterns (markdown-link-check approach)**
Regex-based link transformations applied before checking.
- Effort: Medium
- Risk: Over-engineering for now
- Precedent: markdown-link-check `replacementPatterns` with named capture groups

### Decision

**S1.1** — bug fix in the deterministic verifier. Resolve relative paths from the document's directory. Add S1.2 later if users with static site generators report issues.

---

## Problem 2: Partial Path Resolution

**Impact:** ~5 false positives (from `docs/contributing/design-patterns.md` referencing paths like `L3-verifier/index.ts` instead of `src/layers/L3-verifier/index.ts`)

**Root cause:** Documentation references partial paths (omitting `src/layers/` prefix) that are unambiguous to humans but don't match any file from repo root.

### Solutions Considered

**S2.1: Suffix matching against file index**
Index all files in the repo. When an exact path lookup fails, check if any file's path **ends with** the claimed path. `L3-verifier/index.ts` matches `src/layers/L3-verifier/index.ts`.
- Effort: Small-Medium
- Risk: Ambiguity if multiple files match the suffix.
- Precedent: No documentation tool does this. Conceptually similar to module resolution in Node.js/webpack.

**S2.2: Alias/prefix configuration (webpack/TypeScript approach)**
User-defined path mappings in `.docalign.yml`.
- Effort: Medium
- Risk: Configuration burden. Violates zero-config philosophy.
- Precedent: TypeScript `paths`, webpack `resolve.alias`

**S2.3: Walk-up directory search (Node.js approach)**
From the document's directory, walk upward checking at each level.
- Effort: Medium
- Risk: Slow on large repos without caching.
- Precedent: Node.js `require()` directory walking

**S2.4: Fuzzy/closest match with confidence threshold**
Levenshtein distance to find the closest matching path.
- Effort: Medium
- Risk: False matches.
- Precedent: DocAlign already has `close-match.ts` and `similar-path.ts` in L3

### Decision

**S2.1** — suffix matching against the file index. If multiple files match, flag as "ambiguous" rather than picking one. Add S2.2 as a power-user escape hatch later.

---

## Problem 3: Example / Illustration Confusion

**Impact:** ~20+ false positives (the largest category). All 17 findings in `docs/reference/checks.md` are examples. README's express version finding is from an example table.

**Root cause:** The L1 claim extractor treats every backtick-wrapped path, version, or route reference as a factual claim about the current repo — even when the reference appears inside a table of examples, a description of capability, or sample output.

## Problem 4: Instruction vs Assertion Detection

**Impact:** ~5 false positives ("create `.docalign.yml`", "Adds DocAlign MCP server to `.claude/mcp.json`")

**Root cause:** Imperative sentences ("create X", "add Y to Z") instruct the user to perform an action. They don't claim that X currently exists. The extractor treats the referenced path as a factual claim about current state.

## Problem 5: Prerequisite vs Dependency Confusion

**Impact:** ~1 false positive ("Node.js 18+" flagged as "Package is not a dependency")

**Root cause:** "Node.js 18+" is a runtime prerequisite documented for users. The version extractor matched "Node.js 18+" and looked for "node.js" in `package.json` dependencies.

### Solutions Considered for Problems 3, 4, 5

These three problems share a root cause: the regex-based extractor lacks contextual understanding. It cannot distinguish examples from real claims, instructions from assertions, or prerequisites from dependencies. Multiple approaches were evaluated:

| Solution | Approach | Precedent | Limitation |
|----------|----------|-----------|------------|
| S3.1: AST scope filtering | Parse markdown AST, skip code blocks/tables/blockquotes | Vale's scope system | Heuristics never perfect; some tables mix examples with real refs |
| S3.2: Inline comment directives | Authors annotate `<!-- docalign:ignore -->` | markdownlint, remark-lint | Requires author discipline; defeats "zero config" |
| S3.3: Explicit coupling | Only check explicitly tagged claims | Swimm `<SwmToken>`, `<SwmPath>` | Changes product from "zero config" to "annotation required" |
| S3.4: Contextual confidence scoring | Assign confidence multipliers by context | Swimm's multi-signal histogram | Requires empirical tuning |
| S3.5: Table header analysis | Detect "Example" column headers → skip cells | Novel heuristic | Only covers tables |
| S3.6: Verb-pattern classification | Detect capability/imperative verbs | Doc Detective | English is ambiguous |
| S4.1: Imperative verb detection | Keyword list of ~30 imperative verbs | NLP research (~84% accuracy) | Some imperatives contain verifiable claims |
| S4.2: Section heading context | "Getting Started" → instructional | Vale, Doc Detective | Mixed sections |
| S5.1: Known-runtime allowlist | Skip Node.js, Python, etc. from dependency check | Common sense | List maintenance |
| S5.2: Check engines field | Verify against `engines.node` instead of `dependencies` | npm/yarn | Many projects don't set `engines` |

### Decision: LLM-Powered Annotation with Inline Tags

**Problems 3, 4, and 5 are all solved by a single architectural change**: delegate document classification to Claude during the `docalign extract` step, and persist the results as inline HTML comment tags in the document itself.

#### How It Works

**During `docalign extract` (one Claude call per file):**

1. Claude reads the document section
2. Claude classifies each region — what's an example, what's an instruction, what's a real verifiable claim
3. Claude extracts semantic claims from real content (same as today) and explores the codebase to write evidence assertions
4. Results are written as **inline HTML comment tags** in the document and **sidecar evidence files** in `.docalign/semantic/`

**The output has two parts:**

**Inline tags (in the document)** — lightweight markers visible in source, invisible when rendered:
```markdown
<!-- docalign:skip reason="example_table" -->
| Category | Example |
|----------|---------|
| File paths | `src/auth.ts` referenced but doesn't exist |
<!-- /docalign:skip -->

<!-- docalign:check type="path_reference" -->
10 tools available: `check_doc`, `check_section`, ...
<!-- /docalign:check -->

<!-- docalign:semantic claim="Uses JWT for authentication" id="abc123" -->
The AuthService handles authentication using JWT tokens.
<!-- /docalign:semantic -->
```

Three tag types:
- **`docalign:skip`** — examples, instructions, illustrations. Regex extractors skip these regions entirely.
- **`docalign:check`** — real deterministic claims (paths, versions, commands). Regex extractors extract and verify these. No sidecar entry needed — verification is stateless.
- **`docalign:semantic`** — semantic claims (behavior, architecture, config). Links to sidecar entry with evidence assertions and verification history.

**Sidecar files (in `.docalign/semantic/`)** — heavy metadata for semantic claims only:
```json
{
  "claims": [{
    "id": "abc123",
    "claim_text": "Uses JWT for authentication",
    "evidence_entities": [{"symbol": "jwt.sign", "file": "src/auth.ts"}],
    "evidence_assertions": [
      {"pattern": "import jwt from .jsonwebtoken.", "scope": "src/auth.ts", "expect": "exists"}
    ],
    "last_verification": {"verdict": "verified", "confidence": 0.95}
  }]
}
```

**During `docalign check / scan`:**

1. Load inline tags from the document
2. Regex extractors run but **skip regions tagged `docalign:skip`**
3. Regex extractors extract from regions tagged `docalign:check` (or untagged regions as fallback)
4. Semantic claims are loaded from sidecar, verified via assertion staleness checks
5. Deterministic verifiers run on extracted claims (with Problems 1 & 2 fixes applied)
6. Results reported

#### Why Inline Tags Over Sidecar-Only

| Concern | Sidecar-only | Inline tags |
|---------|-------------|-------------|
| Visibility for Claude Code during edits | Poor — needs separate file read | Immediate — sees tags in context |
| Visibility for humans editing docs | None — invisible metadata | Clear — right in the source |
| Survives doc edits (line shifts) | Fragile (line numbers drift) | Robust (tags move with content) |
| Self-contained | No — depends on `.docalign/` dir | Yes — document carries its own metadata |
| Rendered output | N/A | Invisible (HTML comments are stripped) |

Key insight: inline tags serve as **navigation aids** for both Claude Code and human developers. When Claude is editing a file, it immediately sees which regions are tracked, which are skipped, and which are semantic claims. This is especially valuable for the MCP integration story — Claude Code can make informed decisions about documentation while editing code.

#### Three-Tier Priority System

1. **Inline tags** (highest priority) — Claude-generated or manually added, persisted in the document
2. **Cold-start heuristics** (fallback) — when no tags exist yet, regex extractors run unfiltered with the deterministic fixes (S1.1, S2.1, S5.1) to reduce false positives
3. **Manual override** — users can always add/edit/remove tags by hand

#### Why This Solves Problems 3, 4, and 5

- **Problem 3 (examples):** Claude understands that a table showing "what the tool detects" is illustrative → tags it `docalign:skip`
- **Problem 4 (instructions):** Claude understands "create `.docalign.yml`" is imperative → tags it `docalign:skip`
- **Problem 5 (prerequisites):** Claude understands "Node.js 18+" is a runtime requirement → tags it `docalign:skip` or doesn't tag it as `docalign:check`

No heuristics, no verb lists, no table header analysis. The LLM understands context natively. The deterministic extractors just need to respect the tags.

#### Integration with Existing Architecture

The change is minimal:
- **P-EXTRACT prompt**: expanded to also output `skip_regions` alongside semantic claims. One Claude call per file, same as today.
- **Semantic extractor**: writes inline tags to the document after extraction (new behavior).
- **Regex extractors (L1)**: check for `<!-- docalign:skip -->` before extracting. Small change.
- **Sidecar store**: unchanged — still stores evidence assertions and verification history for semantic claims.
- **P-TRIAGE, P-VERIFY, P-FIX**: completely unchanged.

---

## Implementation Priority (Final)

| Priority | Fix | Impact | Effort | Type |
|----------|-----|--------|--------|------|
| 1 | S1.1: Resolve relative paths from doc directory | ~10 FPs eliminated | Small | Bug fix in L3 verifier |
| 2 | S2.1: Suffix matching for partial paths | ~5 FPs eliminated | Small-Medium | Enhancement in L3 verifier |
| 3 | S5.1: Known-runtime allowlist | ~1 FP eliminated | Trivial | Enhancement in L1 extractor |
| 4 | Inline tag system + expanded P-EXTRACT | ~20+ FPs eliminated (Problems 3, 4, 5) | Medium | New feature in L1 + extract |
| 5 | Tag-aware regex extractors | Enables tag system | Small | Enhancement in L1 |

Fixes 1-3 are independent deterministic improvements that work with or without the tag system. Fix 4 is the architectural change that solves the remaining ~80% of false positives. Fix 5 makes the regex extractors respect the tags.

**Cold start path**: Fixes 1-3 improve precision immediately for users who never run `extract`. Fix 4-5 brings precision to near-100% for users who run `extract` once.

---

## Competitive Positioning (Updated)

| Approach | Used By | DocAlign |
|----------|---------|----------|
| Resolve links from doc directory | All link checkers | S1.1 (deterministic fix) |
| Suffix matching for partial paths | No documentation tool | S2.1 (novel, deterministic) |
| Explicit coupling via tags | Swimm (manual) | Inline tags (LLM-generated, automatic) |
| LLM-based document classification | Mintlify Agent, DeepDocs | P-EXTRACT expansion (classification + extraction in one call) |
| Structured spec validation | Optic, DriftLinter, Dredd | N/A (DocAlign handles prose) |
| Inline comment directives | markdownlint, remark-lint | `docalign:skip/check/semantic` tags |
| Evidence-based staleness detection | Swimm Auto-sync (histogram) | Assertion tripwires (grep patterns) |
| Execute docs as tests | Doc Detective | N/A (different paradigm) |

**DocAlign's unique position**: automatic claim extraction from unstructured prose + inline tag annotation (LLM-generated, not manual) + deterministic verification with evidence-based staleness. No competitor combines automatic classification with deterministic verification. Swimm requires manual tagging. Mintlify/DeepDocs use LLMs for everything. DocAlign uses LLM for classification and extraction, then deterministic code for verification — best of both worlds.

---

## Competitor Research Summary

### Direct Competitors

| Tool | Core Mechanism | Strengths | Weaknesses |
|------|---------------|-----------|------------|
| **Swimm** ($16-28/seat/mo) | Code-coupled `.sw.md` files with smart tokens. Patented auto-sync algorithm using multi-signal histogram. | Zero false positives on tracked content. Conservative fail-to-human. | Requires proprietary editor. Manual coupling. Only GitHub. Steep learning curve. |
| **Doc Detective** (free, AGPL-3.0) | Execute documentation as browser tests. Regex patterns detect procedural verbs. | Tests actual product behavior. Annotation + auto-detect modes. | Slow (browser-based). Only tests user-facing behavior. No code structure tracking. |
| **Mintlify Agent** ($300+/mo) | AI agent monitors code changes, proposes doc updates via PR. | Low config burden. Style-preserving edits. | No deterministic analysis. Expensive. Known false negatives on internal links. |
| **Semcheck** (free + LLM costs) | LLM compares spec documents against code. Inline comment annotations. | Lightweight. Multi-model support. | Entirely LLM-dependent. No deterministic verification. Self-described "primitive evaluation." |
| **DeepDocs** (GitHub App) | AI scans commits, creates PR branches with doc updates. | Fix-forward approach. Low config. | AI-dependent. File-level, not token-level. No example/reference distinction. |

### Structural Validation Tools (not direct competitors)

| Tool | Core Mechanism | Relevance to DocAlign |
|------|---------------|----------------------|
| **Writerside** (free, JetBrains) | IDE plugin with 100+ structural inspections. `include-symbol` references. | `include-lines` is brittle. Acknowledges semantic drift as unsolved. |
| **ReadMe** ($99-2000/mo) | OpenAPI spec sync + API metrics dashboard. | API-only. Observability, not validation. |
| **Optic** (free core) | Proxy API traffic vs OpenAPI spec. | API-only but precise. Treats traffic as source of truth. |
| **DriftLinter** (free) | Static analysis: code vs OpenAPI 3.0+ specs. | API-only. Missing/zombie route detection. |
| **Dredd** (free) | HTTP requests per API spec, compare responses. | API-only. Response format validation. |

### Key Industry Gaps DocAlign Addresses

1. **No tool automatically classifies prose document regions** (example vs real claim). Swimm requires manual tagging. Others ignore the problem or skip all code blocks.
2. **No tool does suffix/partial path matching** for documentation references. All require exact paths.
3. **No tool combines LLM classification with deterministic verification**. Tools are either fully deterministic (high precision, low recall on semantic claims) or fully LLM (inconsistent precision).
4. **The general prose documentation space is underserved**. API documentation is well-covered (Optic, DriftLinter, Dredd, ReadMe). Prose docs have no equivalent.
