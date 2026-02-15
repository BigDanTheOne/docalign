# Deterministic Doc-Code Checks: Gap Analysis

**Date:** 2026-02-15 (v2 — expanded after stress-test audit)
**Purpose:** Complete inventory of deterministic checks competitors ship that DocAlign lacks, plus L1 extraction blind spots.

---

## THE COMPARISON

DocAlign currently has **27 core deterministic checks** across L0-L3 + L7. The competitor landscape has **~400+ distinct deterministic checks** across all tools combined. Most are irrelevant (inline docstring linting, Markdown formatting, OpenAPI self-validation). After two rounds of analysis, we identified **30 gaps** — the first 12 from competitor comparison, then 18 more from stress-testing the L1 spec and searching for additional competitor checks.

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

## COMPLETE GAP INVENTORY (30 GAPS)

### CATEGORY A: EXTRACTION GAPS — L1 Doesn't Capture These

These are claim types that appear in real-world documentation but L1's regex extractors completely miss.

---

#### GAP 14: Markdown Table Claim Extraction ⭐ HIGHEST-VALUE STRUCTURAL GAP
**Who has it:** Nobody does this well (no tool extracts claims from table cells)
**What it is:** Docs overwhelmingly use tables for parameters, config options, defaults, types:
```markdown
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| timeout   | number | 30    | Request timeout in seconds |
| retries   | number | 3     | Max retry attempts |
```
DocAlign's L1 extractors process text line-by-line with regex. There is no table parser. Tables are the single most common structure for API/config documentation and are completely invisible.
**Difficulty:** Medium — Markdown table parsing is well-solved (remark/mdast gives table AST nodes). Detect columns that map to known patterns (param name + default value, param + type). Generate one claim per row.
**False positive risk:** Low-medium — need to distinguish doc tables from decorative tables.

**Recommendation: ADD.** This is arguably the single most impactful extraction gap.

---

#### GAP 8: Environment Variable Claims ⭐ GHOST TYPE
**Who has it:** Nobody does this well. L3 Tier 2 has a placeholder.
**What it is:** The `'environment'` ClaimType is **defined in API contracts** and referenced in L3 Tier 2 verification strategies, but has **ZERO extraction code** in L1. It's a dangling type. Prose like "Set the `DATABASE_URL` environment variable" is never captured. The Tier 2 strategies (tool version check, env var check) all **fall through to Tier 4 (LLM)** because L0 lacks a `readFile` API.
**Difficulty:** Medium — extraction regex is straightforward (`\bDATABASE_URL\b`, `process\.env\.(\w+)`, `os\.environ\['(\w+)'\]`). Verification needs L0 to index env var reads as a special entity type.
**False positive risk:** Low — env var names are exact strings.

**Recommendation: PRIORITIZE.** Both extraction AND verification need work. Treat env var reads as a special entity type in L0.

---

#### GAP 15: Default Value Claims
**Who has it:** Nobody does this deterministically.
**What it is:** "The default timeout is 30 seconds" — no regex pattern targets this. The P-EXTRACT LLM prompt lists "config" claims, but deterministic (regex) extraction is absent.
**Difficulty:** Medium-hard — extraction is easy (regex for "defaults to X", "default is X", "default: X"). Verification is harder: need to find the constant in code (`DEFAULT_TIMEOUT`, Zod `.default()`, etc.) and compare literal values.
**False positive risk:** Medium — "default" appears in many non-claim contexts.

**Recommendation: ADD (v1.5).** Pairs naturally with Gap 14 (table extraction often includes default values).

---

#### GAP 24: Port/Hostname/URL Configuration Claims
**Who has it:** Nobody does this.
**What it is:** "The server runs on port 3000" or "Access the API at http://localhost:4000". URLs are actively filtered OUT of path extraction (reject if contains `://`). Port numbers in prose are not targeted.
**Difficulty:** Medium — extraction via regex for "port NNNN", "localhost:NNNN". Verification needs to find port constants in code.
**False positive risk:** Medium.

**Recommendation: ADD (v1.5).** Same infrastructure as Gap 15 (default/config values).

---

#### GAP 30: Documented Limits/Thresholds/Quotas
**Who has it:** Nobody.
**What it is:** "Maximum file upload size is 10MB" or "Rate limit: 100 requests per minute." Docs state numeric limits that correspond to constants in code.
**Difficulty:** Medium — same infrastructure as Gap 15.
**False positive risk:** Medium.

**Recommendation: ADD (v1.5).** Bundle with Gap 15 as a "numeric config claims" extraction category.

---

#### GAP 27: Function Signature Claims in Prose
**Who has it:** Nobody for prose docs (eslint-plugin-jsdoc does it for inline JSDoc)
**What it is:** "The `createUser` function returns a `Promise<User>`" — described in Markdown, not in JSDoc. Not extracted from prose, only captured if it appears in a code block.
**Difficulty:** Medium — regex for "function X returns Y", "X takes parameters A, B". Verification via L0 entity signatures.
**False positive risk:** Medium — natural language is ambiguous.

**Recommendation: CONSIDER (v2).** Hard to extract reliably with regex. Better suited for LLM extraction.

---

### CATEGORY B: VALIDATION GAPS — L1 Extracts Something But L3 Misses Checks

These are cases where we capture relevant data but don't validate it fully.

---

#### GAP 1: Dead Link Detection (External URLs)
**Who has it:** markdown-link-check, remark-lint `no-dead-urls`, Mintlify
**What it does:** HTTP HEAD/GET to every URL in docs. Flags 404s, timeouts, redirects.
**Why it matters:** Dead links are the #1 most visible form of doc rot.
**Difficulty:** Low.
**False positive risk:** Medium-high (rate limiting, geo-blocking, temporary outages).
**DocAlign gap:** L1 extracts file paths but **ignores URLs entirely**. No `http://` or `https://` extraction. No HTTP validation.

**Recommendation: ADD.** Table-stakes. Competitors would rightfully call us out for missing it.

---

#### GAP 2: Internal Anchor/Heading Validation
**Who has it:** markdownlint MD051, remark-validate-links, rustdoc
**What it does:** Validates `[text](#heading-slug)` and `[text](other.md#section)` point to actual headings.
**Difficulty:** Low.
**False positive risk:** Very low — deterministic.
**DocAlign gap:** L1 extracts file paths but **strips anchor fragments**. `docs/api.md#authentication` checks the file but NOT the heading.

**Recommendation: ADD.** Low effort, high value, near-zero false positives.

---

#### GAP 13: Image/Asset Reference Validation ⭐ DELIBERATE BLIND SPOT
**Who has it:** remark-validate-links, Docusaurus (build-time), markdown-link-check
**What it does:** Validates that `![alt](./images/arch.png)` points to an existing file.
**DocAlign gap:** Image extensions (.png, .jpg, .gif, .svg, .ico) are **explicitly excluded** from path extraction in L1's POST-MATCH filters. This is a deliberate design choice that creates a blind spot for architecture diagrams, screenshots, logos, and badges.
**Difficulty:** Easy — add a separate `image_reference` claim type. Same Tier 1 file-existence verification.
**False positive risk:** Low.

**Recommendation: ADD.** Easy win. Lift the exclusion filter, add new claim type.

---

#### GAP 3: Missing Documentation Detection (Undocumented Code)
**Who has it:** DocSync, interrogate, rustdoc `missing_docs`, eslint-plugin-jsdoc `require-jsdoc`, TypeDoc
**What it does:** Identifies exported/public code entities with NO documentation anywhere.
**Difficulty:** Low — we already have the data.
**DocAlign gap:** L0 indexes all entities. L2 maps claims TO entities. But nothing queries the reverse: entities with ZERO claims. One SQL query away.

**Recommendation: ADD.** Trivial on existing infrastructure: `SELECT entities NOT IN (SELECT DISTINCT code_entity_id FROM claim_mappings)`.

---

#### GAP 7: Deprecation Awareness
**Who has it:** Go staticcheck SA1019, oasdiff deprecation checks, rustdoc
**What it does:** Flags when docs reference `@deprecated` code entities.
**Difficulty:** Low — extend L0 entity extraction to capture deprecation markers.
**False positive risk:** Low.
**DocAlign gap:** L0 doesn't track deprecation status. L3 doesn't check it.

**Recommendation: ADD.** Post-verification enrichment: "this verified claim references deprecated code."

---

#### GAP 20: Engine/Runtime Version vs Manifest
**Who has it:** Nobody does this specific cross-check.
**What it is:** Docs say "Requires Node.js 18+" but `package.json` `engines.node` says `">=20"`. L0 already parses `package.json` for dependencies but **does not extract the `engines` field**. L3 Tier 2 `toolVersionStrategy` only checks for version file existence (`.nvmrc`) and falls through to Tier 4.
**Difficulty:** Easy — L0 already reads package.json.

**Recommendation: ADD.** Extend L0 manifest parsing to extract `engines.*`. Make Tier 2 actually deterministic instead of falling through.

---

#### GAP 21: Install Command Package Name Validation
**Who has it:** Nobody.
**What it is:** README says `npm install my-cool-package` but `package.json` `name` is `@org/my-cool-package`. L1 extracts commands including `npm install X`. But the package name argument is **never cross-referenced** against the `name` field in `package.json`.
**Difficulty:** Easy — L0 already indexes manifest data.

**Recommendation: ADD.** Extend command verification to check install target against manifest `name`.

---

#### GAP 12: Fuzzy Suggestions for ALL Claim Types
**Who has it:** Swimm Smart Tokens (40%/90% Levenshtein thresholds)
**DocAlign gap:** L3 uses Levenshtein only for `path_reference` and `command`. Not for:
- `dependency_version` package names
- `code_example` symbols
- Entity names generally
**Difficulty:** Low.

**Recommendation: EXTEND.** Turns bare "drifted" into actionable "did you mean X?"

---

#### GAP 22: Code Block Language Tag Validation
**Who has it:** markdownlint MD040, mkdocs-code-validator
**What it is:** Code blocks missing language tags, or tagged with wrong language. L1 already captures the language identifier but doesn't validate it.
**Difficulty:** Easy for missing tags. Medium for mismatched (needs heuristic language detection).
**False positive risk:** Low for missing, medium for mismatch.

**Recommendation: ADD (low priority).** Easy check on data we already have.

---

#### GAP 26: CSS/Style File Path References
**Who has it:** Nobody specifically.
**What it is:** Like Gap 13 (images), CSS extensions (.css, .scss, .less) are explicitly excluded from path extraction. `import './styles/main.css'` in a code example would not be validated.
**Difficulty:** Easy.

**Recommendation: ADD (low priority).** Lift exclusion filter for paths inside code examples.

---

### CATEGORY C: STRUCTURAL / CROSS-CUTTING GAPS

---

#### GAP 11: PR-Scoped Change Impact ⭐ CRITICAL FOR NOISE
**Who has it:** Swimm (only flags docs affected by specific PR changes)
**DocAlign gap:** L2 reverse index exists but unclear if the default PR flow uses it to SCOPE the scan.
**Difficulty:** Low.

**Recommendation: VERIFY & ENSURE.** This is the #1 noise reduction technique.

---

#### GAP 6: Snippet Staleness Tracking (Simplified)
**Who has it:** Swimm (patented full algorithm)
**What it does:** Compares embedded code blocks against current source code.
**DocAlign gap:** L3 checks imports/symbols/syntax but does not compare code block CONTENT against source.
**Difficulty:** Medium.
**Recommendation:** Simplified version — match code_example to entity, fuzzy-compare content. No stored state needed.

**Recommendation: ADD (v1.5).**

---

#### GAP 9: Cross-Document Consistency
**Who has it:** Nobody.
**What it does:** Same entity, contradictory claims across files.
**Difficulty:** Medium-high.

**Recommendation: ADD (v1.5).**

---

#### GAP 17: Navigation/Sidebar Config Validation
**Who has it:** Docusaurus (build-time), MkDocs (`--strict`), Mintlify (`@mintlify/validation`)
**What it does:** Validates that nav config files (docs.json, mkdocs.yml, sidebars.js) reference actual doc pages.
**Difficulty:** Medium — need to understand each framework's config format.

**Recommendation: ADD (v1.5).** Pragmatic: detect known config files by name, parse, verify page references.

---

#### GAP 18: Changelog-to-Version Consistency
**Who has it:** version-changelog (npm)
**What it does:** Latest `## X.Y.Z` heading in CHANGELOG.md matches `version` in package.json.
**Difficulty:** Easy.

**Recommendation: ADD.** Low-hanging fruit for package/library projects.

---

#### GAP 16: Frontmatter-to-Content Consistency
**Who has it:** remark-lint-frontmatter-schema, @github-docs/frontmatter
**What it does:** YAML frontmatter (title, description) matches actual content. Currently, L1 strips frontmatter entirely.
**Difficulty:** Easy-medium.

**Recommendation: ADD (low priority).** Mainly for doc-framework projects.

---

#### GAP 19: License Field Consistency
**Who has it:** Nobody as a doc check.
**What it does:** LICENSE file content matches package.json `license` field.
**Difficulty:** Easy.

**Recommendation: ADD (low priority).**

---

### CATEGORY D: DEFERRED / OUT OF SCOPE

| # | Gap | Reason for Deferral |
|---|-----|-------------------|
| 4 | Code example execution (doctest) | Needs per-language runtimes. v2. |
| 5 | Inline docstring alignment (JSDoc/darglint) | Different problem domain. Consider aggregation in v2. |
| 10 | OpenAPI spec-to-code drift | Different input format. Mature tools exist. v2. |
| 23 | Feature flag documentation drift | Too varied across codebases. Hard. |
| 29 | Ordering/sequence claims | Needs call-graph analysis. Hard. |
| 25 | Prose terminology consistency | Vale's job, not ours. |
| 28 | Accessibility checks (alt text, headings) | markdownlint's job, not ours. |

---

## PRIORITY MATRIX (ALL 30 GAPS)

### P0 — Add Now (table-stakes, low effort)
| Gap | Effort | Impact |
|-----|--------|--------|
| 1: Dead link detection | Low | High (table-stakes) |
| 2: Anchor/heading validation | Low | High |
| 3: Missing doc detection (coverage) | Low (data exists) | High |
| 13: Image/asset reference validation | Easy | High |
| 21: Install command package name | Easy | High |
| 20: Engine/runtime version vs manifest | Easy | High |

### P1 — Add Now (medium effort, high differentiation)
| Gap | Effort | Impact |
|-----|--------|--------|
| 8: Env var extraction + verification | Medium | High (unique, currently ghost type) |
| 11: PR-scoped scanning (verify/ensure) | Low | Critical (noise reduction) |
| 7: Deprecation awareness | Low | Medium |
| 12: Fuzzy suggestions for all types | Low | Medium |
| 18: Changelog-to-version consistency | Easy | Medium |

### P2 — v1.5
| Gap | Effort | Impact |
|-----|--------|--------|
| 14: Markdown table claim extraction | Medium | Extremely high |
| 15: Default value claims | Medium-hard | High |
| 6: Snippet staleness (simplified) | Medium | Medium |
| 9: Cross-document consistency | Medium-high | Medium |
| 17: Navigation/sidebar config | Medium | Medium (framework users) |
| 24: Port/hostname/URL config claims | Medium | Medium |
| 30: Limits/thresholds/quotas | Medium | Medium |

### P3 — v2 or Low Priority
| Gap | Effort | Impact |
|-----|--------|--------|
| 5: Inline docstring alignment | Medium-high | High (perception) |
| 4: Code example execution | High | Medium |
| 10: OpenAPI spec-to-code | High | Medium |
| 22: Code block language tag validation | Easy | Low |
| 26: CSS/style file references | Easy | Low |
| 16: Frontmatter consistency | Easy-medium | Low |
| 19: License field consistency | Easy | Low |
| 27: Function signature claims in prose | Medium | Medium |
| 23: Feature flag documentation drift | Hard | Moderate |
| 29: Ordering/sequence claims | Hard | Moderate |
| 25: Prose consistency (OUT OF SCOPE) | N/A | N/A |
| 28: Accessibility (OUT OF SCOPE) | N/A | N/A |

---

## TECHNIQUES TO INHERIT

### From Swimm
1. **Iterative commit processing** — Process intermediate commits sequentially instead of comparing directly to HEAD. Each step is smaller, increasing match accuracy.
2. **Conservative three-tier output** — "current / auto-fixable / needs review." Already doing this.
3. **Context similarity scoring** — 40%/90% Levenshtein thresholds on surrounding context, not just the changed token.

### From eslint-plugin-jsdoc
4. **`informative-docs` check** — Flag claims that are tautological with their mapped entity name.

### From oasdiff
5. **ERR/WARN/INFO severity classification** — Ensure every DocAlign verdict has clear severity mapping.
6. **Deprecation-first governance** — Warn when docs reference recently-deprecated code.

### From danger-js
7. **Configurable file co-change rules** — User-defined path mappings that trigger warnings.

### From DocSync
8. **Pre-commit hook mode** — `docalign check --staged` for fast local feedback.

### From API Extractor (Microsoft)
9. **Committed report file** — `.docalign-report.md` that makes drift visible in code review diffs.

---

## WHAT WE SHOULD NOT INHERIT

1. **Markdown formatting rules** (markdownlint) — We detect drift, not style.
2. **Inline docstring syntax** (JSDoc/TSDoc syntax validation) — Linter territory.
3. **OpenAPI self-consistency** (Spectral) — Spec validation, not drift detection.
4. **Docstring style enforcement** (pydocstyle, numpydoc) — Style, not accuracy.
5. **Swimm's proprietary format requirement** — Our biggest advantage is working with existing Markdown.
6. **Full patch-based algorithm with stored state** — Over-engineered for our use case.

---

## BOTTOM LINE

DocAlign's deterministic layer is strong on **claim verification** (paths, commands, versions, routes, code examples) — areas where most competitors are weak because they focus on inline docstrings, not standalone documentation.

But we have three categories of gaps:

1. **Table-stakes hygiene** (P0): Dead links, broken anchors, missing docs, image references. Absence makes us look incomplete vs. even simple tools. Easy to add.

2. **Ghost infrastructure** (P1): The `environment` ClaimType exists in API contracts but has no extractor. Engine versions fall through to LLM. Package name install commands aren't cross-referenced. These are partially-built features that need finishing.

3. **Structural extraction** (P2): Markdown tables are the biggest single gap. They contain the richest structured claims (params, defaults, types) and we're completely blind to them. This is the highest-value v1.5 feature.

The competitor field is weak on deterministic prose-doc checking — our core advantage. But we can't ship with dead-link blindness and ghost types. P0 gaps first, then P2 (tables) to create real distance.

---

## SOURCES

### Patents
- US11132193B1 — Swimm Auto-sync Patent
- US11847444B2 — Swimm Token Tracking Patent

### Tools Referenced
- Swimm: swimm.io
- DeepDocs: deepdocs.dev
- DocSync: github.com/suhteevah/docsync
- Semcheck: semcheck.ai
- Doc Detective: doc-detective.com
- eslint-plugin-jsdoc: github.com/gajus/eslint-plugin-jsdoc (43M+ weekly npm downloads)
- darglint: github.com/terrencepreilly/darglint
- numpydoc: numpydoc.readthedocs.io
- markdownlint: github.com/DavidAnson/markdownlint
- markdown-link-check: github.com/tcort/markdown-link-check
- remark-validate-links: github.com/remarkjs/remark-validate-links
- remark-lint-code: github.com/Qard/remark-lint-code
- Spectral: github.com/stoplightio/spectral
- oasdiff: github.com/oasdiff/oasdiff
- Optic: github.com/opticdev/optic
- Schemathesis: github.com/schemathesis/schemathesis
- Specmatic: specmatic.io
- danger-js: danger.systems/js
- Code Maat: github.com/adamtornhill/code-maat
- interrogate: interrogate.readthedocs.io
- Vale: github.com/errata-ai/vale
- Mintlify: mintlify.com
- TypeDoc: typedoc.org
- API Extractor: api-extractor.com
- Piranha (Uber): github.com/uber/piranha

### Academic
- CARL-CCI (2025): arxiv.org/abs/2512.19883 — 90.89% F1 on comment-code inconsistency
- CCISolver (2025): arxiv.org/abs/2506.20558 — End-to-end detect+fix
- LLM Traceability (2025): arxiv.org/abs/2506.16440 — Claude 79-80% F1
- LLM Verification Failures (2025): arxiv.org/html/2508.12358v1 — Simple prompts beat complex
- Voyage-code-3: blog.voyageai.com/2024/12/04/voyage-code-3
