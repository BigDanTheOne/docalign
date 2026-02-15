# Deterministic Doc-Code Checks: Gap Analysis

**Date:** 2026-02-15
**Purpose:** What deterministic checks do competitors ship that DocAlign lacks? What should we inherit?

---

## THE COMPARISON

DocAlign currently has **27 core deterministic checks** across L0-L3 + L7. The competitor landscape has **~400+ distinct deterministic checks** across all tools combined. But most of those 400 are irrelevant to DocAlign (inline docstring linting, Markdown formatting, OpenAPI self-validation). The question is: **which competitor checks address the same problem DocAlign solves** (prose documentation drifting from code reality) that we're missing?

---

## WHAT DOCALIGN ALREADY DOES WELL

These are areas where DocAlign matches or exceeds competitors:

| Check | DocAlign | Best Competitor | Assessment |
|-------|---------|----------------|-----------|
| File path references | L1 extraction + L3 verify with Levenshtein fallback | Swimm Smart Paths (exact match only) | **DocAlign is better** — Levenshtein fuzzy match suggests corrections |
| CLI command/script verification | L1 extraction + L3 verify with close-match | Nobody does this well | **DocAlign leads** — unique check |
| Dependency version verification | L1 extraction + L3 semver-aware compare (lockfile vs manifest) | Nobody does this systematically | **DocAlign leads** — unique check |
| API route verification | L1 extraction + L3 exact + fuzzy match with param normalization | Nobody outside API spec tools | **DocAlign leads** for routes documented in prose |
| Code example imports/symbols | L1 extraction + L3 symbol existence + syntax validation | eslint-plugin-jsdoc `check-examples` (JS only) | **DocAlign is comparable** — broader language support |
| Claim-to-code mapping | L2 three-step progressive (direct → symbol → semantic) | Swimm (manual embedding), DocSync (AST diff) | **DocAlign is better** — automatic, no manual linking |
| Re-extraction diff | L1 diff computation (added/updated/removed claims) | Swimm patch-based diff | **Comparable** — different approaches, similar outcome |
| Co-change boosting | L7 temporal coupling signal | Code Maat / CodeScene (research tools) | **DocAlign is better** — integrated into mapping confidence |

---

## GAPS: WHAT COMPETITORS HAVE THAT WE DON'T

### GAP 1: Dead Link Detection (External URLs)
**Who has it:** markdown-link-check, remark-lint `no-dead-urls`, Mintlify broken link checker
**What it does:** HTTP HEAD/GET to every URL in docs. Flags 404s, timeouts, redirects.
**Why it matters:** Dead links are the #1 most visible form of doc rot. Users notice immediately.
**Difficulty:** Low — straightforward HTTP requests with retry/timeout logic.
**False positive risk:** Medium-high (rate limiting, geo-blocking, auth-gated URLs, temporary outages).
**DocAlign gap:** L1 extracts file paths but **ignores URLs entirely**. No `http://` or `https://` extraction. No HTTP validation.

**Recommendation: ADD.** This is table-stakes for any doc quality tool. Competitors would rightfully call us out for missing it.

---

### GAP 2: Internal Anchor/Heading Validation
**Who has it:** markdownlint MD051, remark-validate-links, rustdoc `broken_intra_doc_links`
**What it does:** Validates that `[text](#heading-slug)` links point to actual headings in the target file. Also validates cross-file heading references like `[text](other.md#section)`.
**Why it matters:** Heading renames silently break all anchor links. Very common after refactors.
**Difficulty:** Low — parse Markdown AST, extract headings, generate slugs, compare.
**False positive risk:** Low — heading slug generation is deterministic.
**DocAlign gap:** L1 extracts file path references but **does not extract or validate anchor fragments**. A link to `docs/api.md#authentication` would check that `docs/api.md` exists but NOT that it has an `#authentication` heading.

**Recommendation: ADD.** Low effort, high value, zero false positive risk.

---

### GAP 3: Missing Documentation Detection (Undocumented Code)
**Who has it:** DocSync (tree-sitter symbol extraction → doc search), interrogate/docstr-coverage (coverage %), rustdoc `missing_docs`, eslint-plugin-jsdoc `require-jsdoc`, TypeDoc `notDocumented`
**What it does:** Identifies exported/public code entities that have NO documentation anywhere.
**Why it matters:** The inverse of stale docs — code exists but docs don't mention it. Critical for API completeness.
**Difficulty:** Medium — requires mapping from code entities to doc mentions (reverse of what L2 does).
**False positive risk:** Medium — not everything needs docs. Needs configurability (which entity types, which visibility levels).
**DocAlign gap:** L0 indexes all code entities. L2 maps claims TO code. But **nothing checks the reverse**: are there code entities with ZERO claims pointing to them? We have the data but not the check.

**Recommendation: ADD.** We already have 90% of the infrastructure (L0 entity index + L2 reverse index). The missing piece is a "coverage report" that queries: `SELECT entities NOT IN (SELECT DISTINCT code_entity_id FROM claim_mappings)`. This is a trivial query on existing data.

---

### GAP 4: Code Example Execution (Doctest-Style)
**Who has it:** Rust doctests (compile + run), Python doctest (execute + compare output), Go example tests (stdout comparison), eslint-plugin-jsdoc `check-examples` (lint code blocks)
**What it does:** Actually runs code examples from documentation and verifies they work.
**Why it matters:** Code examples are the most copy-pasted part of documentation. Broken examples = broken developer experience.
**Difficulty:** High — requires language-specific runtimes, sandboxing, dependency resolution.
**False positive risk:** Medium — partial examples, setup code, environment dependencies.
**DocAlign gap:** L3 validates code examples by checking import resolution and symbol existence, plus tree-sitter syntax validation. But **does not execute** them. We check structure, not behavior.

**Recommendation: DEFER (v2).** The structural checks we have are a good 80/20. Execution requires runtime infrastructure per language. Flag as a differentiation opportunity for later.

---

### GAP 5: Inline Doc-Code Signature Alignment
**Who has it:** eslint-plugin-jsdoc (~40 structural rules), darglint (~15 rules), numpydoc (~30 rules), Java DocLint, TypeDoc validation
**What it does:** Compares JSDoc/docstring @param names against actual function parameters, @returns against return statements, @throws against throw statements, @template against generic params.
**Why it matters:** This is the most mature category of doc-code alignment. ~35 distinct checks across tools.
**Difficulty:** Medium — requires JSDoc/docstring parsing + AST comparison.
**False positive risk:** Low-medium depending on rule.
**DocAlign gap:** DocAlign operates on **standalone Markdown documentation**, not inline code comments/docstrings. We extract claims from `.md` files and verify against code. We do NOT parse JSDoc/TSDoc/docstrings inside `.ts`/`.py` files.

**Recommendation: CONSIDER FOR LATER.** This is a different problem domain (inline comments vs external docs). But it's what MOST developers think of when they hear "doc-code alignment." Two options:
- (a) Integrate with eslint-plugin-jsdoc/darglint as a complementary check (run them, aggregate results)
- (b) Build our own inline doc parser that extracts claims from docstrings the same way L1 extracts from Markdown

Option (a) is lower effort and positions us as an aggregator. Option (b) is higher value but significant scope.

---

### GAP 6: Snippet Staleness Tracking (Swimm-Style)
**Who has it:** Swimm (patented patch-based detection with iterative commit processing)
**What it does:** Stores a verbatim copy of each code snippet embedded in documentation. On every PR, applies the stored snippet as a reverse patch. If patch fails = code changed = doc may be stale.
**Why it matters:** Code blocks in Markdown files (e.g., "here's how to configure the database:") become stale when the referenced code changes.
**Difficulty:** Medium — need to store snippet state, compute diffs per PR.
**False positive risk:** Low for structural changes. Misses semantic changes.
**DocAlign gap:** L1 extracts code examples and L3 validates imports/symbols/syntax. But we **do not track whether the code in a fenced block matches the current version of the code it was copied from**. If a README shows:
```
function createUser(name: string) { ... }
```
And the actual code changes to `createUser(name: string, role: Role)`, we'd only catch this if the symbol signature check detects the param change. We DON'T do a line-by-line comparison of the snippet against the source.

**Recommendation: ADD (simplified version).** Don't implement Swimm's full patented algorithm. Instead:
1. When L1 extracts a code_example, try to **match it to a specific code entity** via symbol names + file context
2. If matched, **compare the snippet against the current entity source** (substring/fuzzy match)
3. If significantly different → flag as drifted

This is lighter than Swimm's approach (no stored state, no iterative commit processing) but catches the most common case: code blocks that are stale copies.

---

### GAP 7: Deprecation Awareness
**Who has it:** Go staticcheck SA1019, oasdiff deprecation checks, rustdoc deprecated items
**What it does:** Detects when documentation references code that is marked as deprecated.
**Why it matters:** Docs that teach users to use deprecated APIs cause confusion and support burden.
**Difficulty:** Low — check `@deprecated` JSDoc tag, `#[deprecated]` Rust attribute, etc. on mapped entities.
**False positive risk:** Low.
**DocAlign gap:** L0 indexes code entities but **does not track deprecation status**. L3 verification doesn't check if a verified entity is deprecated.

**Recommendation: ADD.** Low effort — extend L0 entity extraction to capture deprecation markers. Add a post-verification check: "this claim references a deprecated entity." Simple flag, high value.

---

### GAP 8: Environment Variable / Config Documentation Verification
**Who has it:** Nobody does this well. L3 Tier 2 has a placeholder for it.
**What it does:** Verifies that documented env vars (e.g., "Set `DATABASE_URL` to...") actually exist in the code that reads them (e.g., `process.env.DATABASE_URL`).
**Why it matters:** Config documentation is one of the most commonly stale sections in any README.
**Difficulty:** Medium — need to search codebase for env var reads (`process.env.X`, `os.environ['X']`, etc.).
**False positive risk:** Low — env var names are exact strings.
**DocAlign gap:** L3 Tier 2 has environment variable checks listed but they're **deferred** because L0 lacks a `readFile` API. The check just falls through to Tier 4 (LLM).

**Recommendation: PRIORITIZE.** This is a uniquely valuable deterministic check that no competitor offers. Need to either:
- (a) Add a `grepCodebase(pattern)` capability to L0
- (b) Pre-index env var reads during L0 entity extraction (extract `process.env.*` / `os.environ[*]` patterns)

Option (b) is cleaner — treat env var reads as a special entity type in L0.

---

### GAP 9: Cross-Document Consistency
**Who has it:** Nobody. This is a gap across the entire market.
**What it does:** Detects when Doc A and Doc B make contradictory claims about the same code entity. E.g., README says "default port is 3000" but DEPLOYMENT.md says "default port is 8080."
**Why it matters:** Large projects have docs scattered across many files. Contradictions confuse users and AI agents.
**Difficulty:** Medium-high — requires claim deduplication across files + conflict detection.
**False positive risk:** Medium — docs may intentionally describe different contexts.
**DocAlign gap:** Each doc file is processed independently. No cross-file claim comparison.

**Recommendation: ADD (v1.5).** After initial launch, add a scan mode that groups claims by code entity across all doc files and flags conflicts (same entity, contradictory claims). We already have the data structure — claims map to code entities. The missing step is cross-claim comparison.

---

### GAP 10: OpenAPI Spec-to-Code Drift
**Who has it:** Dredd, Schemathesis, Prism (spec vs live API). But nobody checks spec vs source code.
**What it does:** Validates that an OpenAPI spec file matches the actual route handlers in the code.
**Why it matters:** OpenAPI specs are often maintained separately from code and drift silently.
**Difficulty:** High — need to parse OpenAPI YAML/JSON + match against L0 route entities + compare schemas.
**False positive risk:** Medium.
**DocAlign gap:** L1 extracts routes from Markdown prose. But if a repo has an `openapi.yaml`, we don't parse it as a special doc type with structured claims.

**Recommendation: DEFER (v2).** This is a different input format (structured YAML vs prose Markdown). The API spec validation tools (Spectral, oasdiff) already handle spec self-consistency. The spec-to-code gap is real but is a separate product feature.

---

### GAP 11: PR-Scoped Change Impact (Swimm-Style)
**Who has it:** Swimm (only flags docs affected by the specific PR's changes)
**What it does:** On a PR that modifies `src/auth.ts`, only checks docs that reference auth-related code. Doesn't re-scan the entire repo.
**Why it matters:** Noise reduction. Developers hate getting 50 stale-doc warnings on a PR that touched one file.
**Difficulty:** Low-medium — use L2 reverse index to find claims affected by changed files.
**DocAlign gap:** L4 triggers orchestrate full scans. The reverse index query exists in L2 (`reverseIndex: SELECT claims WHERE code_file IN changed_files`). But it's not clear from the TDD whether the default PR flow uses this to SCOPE the scan.

**Recommendation: VERIFY & ENSURE.** The infrastructure exists. Make sure the default PR scan flow uses the reverse index to only verify claims mapped to changed files, not the full repo. This is the #1 noise reduction technique.

---

### GAP 12: Levenshtein / Fuzzy Suggestions for ALL Claim Types
**Who has it:** Swimm Smart Tokens (40%/90% Levenshtein thresholds on context)
**What it does:** When a referenced entity changes, suggests the likely replacement based on edit distance.
**DocAlign gap:** L3 uses Levenshtein for path_reference (basename ≤2, full path ≤3) and command (≤2). But NOT for:
- **dependency_version**: No fuzzy match on package names (typo in package name → just "not found")
- **api_route**: Uses L0.searchRoutes() fuzzy, but the similarity metric isn't Levenshtein
- **code_example symbols**: No fuzzy match — symbol either exists or doesn't

**Recommendation: EXTEND.** Add Levenshtein-based suggestions for all claim types. When a dependency isn't found, suggest the closest-named package. When a symbol doesn't exist, suggest the closest match. This turns a bare "drifted" verdict into an actionable "drifted — did you mean `createUser` instead of `createUsers`?"

---

## PRIORITY MATRIX

| Gap | Effort | Impact | Recommendation | Priority |
|-----|--------|--------|---------------|----------|
| Gap 1: Dead link detection | Low | High (table-stakes) | **ADD NOW** | P0 |
| Gap 2: Anchor/heading validation | Low | Medium-high | **ADD NOW** | P0 |
| Gap 3: Missing doc detection (coverage) | Low (data exists) | High | **ADD NOW** | P0 |
| Gap 7: Deprecation awareness | Low | Medium | **ADD NOW** | P1 |
| Gap 8: Env var/config verification | Medium | High (unique) | **ADD NOW** | P1 |
| Gap 11: PR-scoped scan (verify) | Low | High (noise) | **VERIFY** | P1 |
| Gap 12: Fuzzy suggestions for all types | Low | Medium | **EXTEND** | P1 |
| Gap 6: Snippet staleness (simplified) | Medium | Medium | **ADD v1.5** | P2 |
| Gap 9: Cross-doc consistency | Medium-high | Medium | **ADD v1.5** | P2 |
| Gap 5: Inline docstring alignment | Medium-high | High (perception) | **CONSIDER v2** | P3 |
| Gap 4: Code example execution | High | Medium | **DEFER v2** | P3 |
| Gap 10: OpenAPI spec-to-code | High | Medium | **DEFER v2** | P3 |

---

## TECHNIQUES TO INHERIT

Beyond specific gaps, here are competitor techniques worth adopting:

### From Swimm
1. **Iterative commit processing** — Process intermediate commits sequentially instead of comparing directly to HEAD. Each step is smaller, increasing match accuracy. Relevant for our re-extraction diff in L1.
2. **Conservative three-tier output** — "current / auto-fixable / needs review" maps naturally to our verified/drifted/uncertain. Already doing this.
3. **Context similarity scoring** — Swimm uses surrounding tokens (not just the changed token) with 40%/90% Levenshtein thresholds. We could apply similar context-aware matching in L3 when verifying code examples.

### From eslint-plugin-jsdoc
4. **`informative-docs` check** — Detects when a doc comment just restates the code name ("Gets the foo" for `getFoo()`). We could apply this to Markdown: flag claims that are tautological with their mapped entity name.

### From oasdiff
5. **Severity classification (ERR/WARN/INFO)** — 250 checks classified by impact. We should ensure every DocAlign verdict has a clear severity mapping (high = definitely wrong, medium = likely stale, low = cosmetic).
6. **Deprecation-first governance** — Flag deprecation before removal. If a doc references something that was deprecated in a recent PR, warn before the entity is actually removed.

### From danger-js
7. **File co-change rules** — "if src/api/** changed and docs/api/** didn't, warn." We already have co-change tracking in L7, but we could add a lightweight rule engine: user-configurable file path mappings that trigger warnings.

### From DocSync
8. **Pre-commit hook mode** — Run checks on staged files only (not full repo). Faster feedback loop than CI. We should offer a `docalign check --staged` CLI mode.

### From API Extractor (Microsoft)
9. **API surface report diff** — Generate a `.docalign-report.md` that summarizes the current state. On each PR, compare against the committed report. Any diff = explicit review required. This makes drift visible in code review without any external service.

---

## WHAT WE SHOULD NOT INHERIT

1. **Markdown formatting rules** (markdownlint) — Not our job. We detect drift, not style.
2. **Inline docstring syntax** (JSDoc/TSDoc syntax validation) — Linter territory.
3. **OpenAPI self-consistency** (Spectral) — Spec validation, not drift detection.
4. **Docstring style enforcement** (pydocstyle, numpydoc formatting) — Style, not accuracy.
5. **Swimm's proprietary format requirement** — Our biggest advantage is working with existing Markdown.
6. **Full patch-based algorithm with stored state** — Over-engineered for our use case. Simplified snippet comparison is sufficient.

---

## BOTTOM LINE

DocAlign's deterministic layer is strong on **claim verification** (paths, commands, versions, routes, code examples) — an area where most competitors are weak because they focus on inline docstrings, not standalone documentation.

But we're missing **basic hygiene checks** that users expect (dead links, broken anchors, missing docs). These are P0 because their absence makes us look incomplete compared to even simple tools like markdownlint + markdown-link-check.

The highest-value unique additions are **env var verification** (Gap 8) and **missing documentation detection** (Gap 3) — things nobody does well and where we already have the infrastructure.
