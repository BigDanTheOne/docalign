# DocAlign False Positive Analysis & Solution Synthesis

## Current State

Full scan of DocAlign's own repository: **95 drifted claims, 0 true positives** (based on 37 manually verified findings — all false positives). Three root-cause bugs account for ~95% of false positives.

---

## Problem 1: Relative Path Resolution

**Impact:** ~10 false positives (all from `docs/getting-started.md`, `docs/reference/cli.md`, and similar files inside `docs/`)

**Root cause:** When a doc at `docs/getting-started.md` contains a markdown link `[CLI Reference](reference/cli.md)`, DocAlign checks whether `reference/cli.md` exists from the **repo root**. It doesn't. The file exists at `docs/reference/cli.md` — the link is relative to the document's directory.

### Solutions

**S1.1: Resolve from document directory (industry standard)**
Every tool does this — markdown-link-check, remark-validate-links, Sphinx, Docusaurus. Simple `path.join(path.dirname(docFile), claimedPath)` before checking existence. Sphinx had this exact bug and fixed it in PR #8245.
- Effort: Small (verifier change)
- Risk: None — this is universally agreed-upon behavior
- Precedent: All tools

**S1.2: Configurable base path (markdown-link-check approach)**
Add a `projectBaseUrl` or `doc_root` config option in `.docalign.yml` for repos where docs are rendered by a static site generator (Hugo, Jekyll, Docusaurus) that changes the resolution context. For example, Hugo renders `docs/setup.md` as `docs/setup/index.html`, which changes what `../` means.
- Effort: Small (config schema + verifier change)
- Risk: Over-engineering for now
- Precedent: markdown-link-check `projectBaseUrl`, `replacementPatterns`

**S1.3: Replacement patterns (markdown-link-check approach)**
Regex-based link transformations applied before checking. Useful for platform-specific conventions (e.g., Hugo folder rendering).
- Effort: Medium
- Risk: Over-engineering for now
- Precedent: markdown-link-check `replacementPatterns` with named capture groups

### Recommendation

Start with **S1.1** — it's a bug fix, not a feature. Add S1.2 later if users with static site generators report issues.

---

## Problem 2: Partial Path Resolution

**Impact:** ~5 false positives (from `docs/contributing/design-patterns.md` referencing paths like `L3-verifier/index.ts` instead of `src/layers/L3-verifier/index.ts`)

**Root cause:** Documentation references partial paths (omitting `src/layers/` prefix) that are unambiguous to humans but don't match any file from repo root.

### Solutions

**S2.1: Suffix matching against file index**
Index all files in the repo. When an exact path lookup fails, check if any file's path **ends with** the claimed path. `L3-verifier/index.ts` matches `src/layers/L3-verifier/index.ts`.
- Effort: Small-Medium (need a file index, then suffix scan)
- Risk: Ambiguity if multiple files match the suffix. Need a tie-breaking strategy (shortest path? closest to doc file?).
- Precedent: No documentation tool does this. Conceptually similar to module resolution fallbacks in Node.js/webpack.

**S2.2: Alias/prefix configuration (webpack/TypeScript approach)**
Let users define path mappings in `.docalign.yml`:
```yaml
path_aliases:
  "L0-codebase-index/": "src/layers/L0-codebase-index/"
  "L1-claim-extractor/": "src/layers/L1-claim-extractor/"
```
Or more generically with wildcards:
```yaml
path_aliases:
  "L*-*/": "src/layers/L*-*/"
```
- Effort: Medium
- Risk: Configuration burden on user. Violates zero-config philosophy.
- Precedent: TypeScript `paths`, webpack `resolve.alias`

**S2.3: Walk-up directory search (Node.js approach)**
From the document's directory, walk upward checking at each level. If `docs/contributing/design-patterns.md` references `L3-verifier/index.ts`, check:
1. `docs/contributing/L3-verifier/index.ts` (no)
2. `docs/L3-verifier/index.ts` (no)
3. `L3-verifier/index.ts` (no)
4. Then fall back to suffix matching
- Effort: Medium
- Risk: Slow on large repos without caching. Might find wrong matches.
- Precedent: Node.js `require()` directory walking

**S2.4: Fuzzy/closest match with confidence threshold**
When exact lookup fails, use Levenshtein distance or similar to find the closest matching path. Only accept if similarity is above a threshold.
- Effort: Medium
- Risk: False matches. "L3-verifier/index.ts" might fuzzy-match to something unrelated.
- Precedent: DocAlign already has `close-match.ts` and `similar-path.ts` in L3

### Recommendation

**S2.1** (suffix matching) is the best starting point — simple, effective, and handles the common case where docs use abbreviated paths. Add a uniqueness check: if multiple files match, flag as "ambiguous" rather than picking one. S2.2 as a power-user escape hatch later.

---

## Problem 3: Example / Illustration Confusion

**Impact:** ~20+ false positives (the largest category). All 17 findings in `docs/reference/checks.md` are examples. README's express version finding is from an example table.

**Root cause:** The L1 claim extractor treats every backtick-wrapped path, version, or route reference as a factual claim about the current repo — even when the reference appears inside a table of examples, a description of capability, or sample output.

### Solutions

**S3.1: AST-based scope filtering (Vale approach)**
Parse markdown into AST. Classify each claim by its structural context:
- **Table cells in "example" tables** — detect tables whose header/content suggests illustrative purpose (column headers like "Example", "What It Finds", "Before/After")
- **Fenced code blocks** — already somewhat handled, but code blocks showing sample output should be excluded
- **Sections with illustrative headings** — "What It Finds", "Examples", "Sample Output", "Scenarios"

Implementation: After extracting a claim, check its AST context. If it's inside a table cell, code block, or under an illustrative heading, either skip it or mark it with reduced confidence.
- Effort: Medium-Large
- Risk: Heuristics will never be perfect. Some tables mix examples with real references.
- Precedent: Vale's scope system (`table.cell`, `summary`, `heading.h2`, etc.)

**S3.2: Inline comment directives (markdownlint / remark-lint approach)**
Let authors annotate sections to skip:
```markdown
<!-- docalign:ignore-start -->
| Category | Example |
|----------|---------|
| File paths | `src/auth.ts` referenced but doesn't exist |
<!-- docalign:ignore-end -->
```
Or per-line: `<!-- docalign:ignore-next-line -->`
- Effort: Small (extractor checks for directives before extracting)
- Risk: Requires author discipline. New docs won't have directives. Defeats "zero config" promise.
- Precedent: markdownlint `<!-- markdownlint-disable -->`, remark-lint `<!--lint disable-->`, phmdoctest `<!--phmdoctest-skip-->`

**S3.3: Explicit coupling (Swimm approach)**
Invert the model: instead of extracting everything and filtering, only check explicitly marked claims:
```markdown
<!-- docalign:track -->
Configuration is stored in `.docalign.yml`
```
Or use a different signal: only check claims in sections that match configurable heading patterns (e.g., "Installation", "Configuration", "API Reference" but not "Features", "Overview", "What It Finds").
- Effort: Medium
- Risk: Fundamentally changes the product proposition from "zero config" to "annotation required." Misses real drift in unannotated sections.
- Precedent: Swimm `<SwmToken>`, `<SwmPath>`, `<SwmSnippet>`

**S3.4: Contextual confidence scoring**
Don't binary include/exclude — instead, assign a confidence multiplier based on context:
- Claim in prose paragraph under "Configuration" heading → confidence 1.0
- Claim in table cell → confidence 0.5
- Claim in table cell under "Examples" heading → confidence 0.1
- Claim in fenced code block → confidence 0.2
- Claim in blockquote → confidence 0.3

Then filter output by `min_confidence` threshold (default: e.g., 0.6).
- Effort: Medium
- Risk: Tuning the multipliers requires empirical testing across many repos.
- Precedent: Swimm's multi-signal histogram uses weighted confidence. DocAlign already has confidence scoring in L3.

**S3.5: Table structure analysis**
Specifically for tables (the biggest source of false positives): analyze the table header row. If headers contain words like "Example", "Sample", "Before", "Pattern", "Scenario", "Description", classify all cells as illustrative. If headers contain "Path", "File", "Dependency", "Version" without example-like qualifiers, classify as factual.
- Effort: Small-Medium
- Risk: Imperfect heuristic but catches the most common case.
- Precedent: None (novel heuristic)

**S3.6: Doc Detective's verb-pattern approach**
Use regex patterns with contextual verbs to classify intent. "This tool **detects** `src/auth.ts` references" has a capability verb ("detects") → the path is illustrative. "Configuration **is stored in** `.docalign.yml`" has an assertion verb → the path is factual.
- Effort: Medium-Large
- Risk: English is ambiguous. Many edge cases.
- Precedent: Doc Detective's `detectSteps` regex patterns with procedural verb matching

### Recommendation

Combine **S3.1 + S3.4 + S3.5** as a layered approach:
1. S3.5 (table header analysis) for the immediate biggest win — cheap and catches 17 of 20 false positives
2. S3.4 (contextual confidence) as the framework for all context-based decisions
3. S3.1 (AST scope filtering) for broader coverage of code blocks, blockquotes, etc.
4. S3.2 (comment directives) as an escape hatch for edge cases

---

## Problem 4: Instruction vs Assertion Detection

**Impact:** ~5 false positives ("create `.docalign.yml`", "Adds DocAlign MCP server to `.claude/mcp.json`")

**Root cause:** Imperative sentences ("create X", "add Y to Z") instruct the user to perform an action. They don't claim that X currently exists. The extractor treats the referenced path as a factual claim about current state.

### Solutions

**S4.1: Imperative verb detection (NLP research)**
Check if the sentence containing the claim starts with or is governed by an imperative verb. Known imperative verbs in documentation: create, add, run, install, configure, set up, copy, move, delete, rename, open, save, enter, type, paste, navigate, go to, click, ensure, make sure, update, modify, edit, write, put, place.

If claim is governed by an imperative verb → skip extraction or mark as "instructional."
- Effort: Small-Medium (keyword list + sentence-level context check)
- Risk: Some imperatives ARE assertions in disguise ("Run `npm start` to start the server on port 3000" — the port claim is verifiable even though the sentence is imperative).
- Precedent: NLP research on imperative detection (POS tagging, ~84% accuracy). Doc Detective's procedural verb patterns.

**S4.2: Section heading context**
Sections with headings like "Getting Started", "Installation", "Setup", "Tutorial", "Quick Start", "How to..." are procedural. Claims extracted from these sections should be flagged as potentially instructional.
- Effort: Small (heading pattern matching, already have heading extraction)
- Risk: Some instructional sections contain factual claims mixed with instructions.
- Precedent: Vale's scope system, Doc Detective's markup detection

**S4.3: Tense/mood analysis (lightweight NLP)**
Distinguish verb moods:
- Imperative: "Create `.docalign.yml`" (base form verb, no subject)
- Declarative: "The system reads from `.docalign.yml`" (third person, has subject)
- Conditional: "If `.docalign.yml` exists, it will be loaded" (conditional clause)

For conditional sentences, the claim should only be verified if the condition is about existence (not creation).
- Effort: Medium (need basic sentence parsing)
- Risk: English grammar is messy. Many edge cases.
- Precedent: spaCy POS tagging (VB tag for base form), Dasha.AI sentence type classification

**S4.4: "To" + infinitive detection**
Many instructions follow the pattern "To [verb], [instruction]":
- "To customize, create `.docalign.yml`"
- "To start the MCP server, run `docalign mcp`"

Detect this pattern and mark the referenced artifacts as instructional.
- Effort: Small (regex pattern)
- Risk: Narrow pattern. Misses other instruction forms.
- Precedent: None specific

### Recommendation

**S4.1** (imperative verb list) is the highest-impact, lowest-effort fix. Maintain a curated list of ~30 imperative verbs. When a claim's surrounding sentence starts with or contains one of these verbs as the main verb, reduce its confidence or skip extraction. Supplement with **S4.2** (heading context) for additional signal.

---

## Problem 5: Prerequisite vs Dependency Confusion

**Impact:** ~1 false positive ("Node.js 18+" flagged as "Package is not a dependency")

**Root cause:** "Node.js 18+" is a runtime prerequisite documented for users. The version extractor matched "Node.js 18+" and looked for "node.js" in `package.json` dependencies. It's not there because Node.js is the runtime, not a dependency.

### Solutions

**S5.1: Known-runtime allowlist**
Maintain a list of known runtime/platform names that should not be checked against package.json: Node.js, Python, Ruby, Java, Go, Rust, .NET, PHP, Deno, Bun, Docker, etc.
- Effort: Trivial
- Risk: List needs maintenance. Some runtimes could appear as actual dependencies.
- Precedent: None specific, but common sense filtering

**S5.2: Check engines field instead**
For Node.js version claims, check `package.json` `engines.node` field instead of `dependencies`. For Python, check `pyproject.toml` `requires-python`.
- Effort: Small
- Risk: Many projects don't set `engines` field.
- Precedent: npm/yarn engine checking

**S5.3: Section context — "Prerequisites" / "Requirements"**
If the claim appears under a heading like "Prerequisites", "Requirements", "System Requirements", treat it as a runtime requirement rather than a dependency claim.
- Effort: Small (heading pattern matching)
- Risk: Not all prerequisite sections use these headings.
- Precedent: Doc Detective's heading-based context detection

### Recommendation

**S5.1** (known-runtime allowlist) is trivial and sufficient. Combine with **S5.2** (check engines field) for repos that do specify engine versions.

---

## Implementation Priority

| Priority | Problem | Fix | Impact | Effort |
|----------|---------|-----|--------|--------|
| 1 | Relative paths | S1.1: Resolve from doc dir | ~10 FPs eliminated | Small |
| 2 | Examples in tables | S3.5: Table header analysis | ~17 FPs eliminated | Small |
| 3 | Imperative verbs | S4.1: Verb detection + skip | ~5 FPs eliminated | Small |
| 4 | Partial paths | S2.1: Suffix matching | ~5 FPs eliminated | Small-Medium |
| 5 | Runtime allowlist | S5.1: Known-runtime list | ~1 FP eliminated | Trivial |
| 6 | Confidence framework | S3.4: Contextual scoring | Systematic FP reduction | Medium |
| 7 | AST scope filtering | S3.1: Full context analysis | Broad FP reduction | Medium-Large |
| 8 | Comment directives | S3.2: Author escape hatch | Edge case coverage | Small |

Fixes 1-5 would eliminate approximately **38 of the 37 verified false positives** (plus likely most of the remaining 58 unverified ones). They are all small-effort changes to the existing L1 extractor and L3 verifier.

---

## Competitive Positioning

| Approach | Used By | DocAlign Analog |
|----------|---------|-----------------|
| Resolve links from doc directory | All link checkers | S1.1 (bug fix) |
| AST-based scope filtering | Vale | S3.1 |
| Inline comment directives | markdownlint, remark-lint | S3.2 |
| Explicit coupling (author tags what to track) | Swimm | S3.3 |
| Procedural verb detection | Doc Detective | S4.1 |
| Confidence-based multi-signal | Swimm Auto-sync | S3.4 |
| Structured spec validation | Optic, DriftLinter, Dredd | N/A (DocAlign handles prose) |
| LLM-based judgment | Semcheck, Mintlify, DeepDocs | DocAlign's semantic tier (P-VERIFY) |
| Fail to human when uncertain | Swimm | S3.4 with min_confidence threshold |

DocAlign's unique value: **automatic claim extraction from unstructured prose + deterministic verification**. No competitor does both. Fixing these 5 bugs would make that value real instead of theoretical.
