# Audit Report — Suppressed Findings and Documentation Drift

**Run ID:** `c5cfe067-c307-4051-8fd9-573ea075c65b`
**Date:** 2026-02-22
**Branch:** `feature/c5cfe067`

## Executive Summary

Audited 8 documentation files (6 suppressed + README.md + llms.txt) against the current codebase. The DocAlign scan reports an overall health score of **82/100** with **12 drifted claims** across 22 scanned doc files. Of the 8 files in scope, **4 contain active drift findings** and all 8 have unchecked sections (sections suppressed via `docalign:skip` or lacking semantic claims).

## TypeScript Compilation Verification

```
$ tsc --noEmit
```

**Result:** Pass — 0 errors. The codebase compiles cleanly under strict TypeScript.

## File-by-File Findings

### 1. `docs/reference/configuration.md`

**Syntactic claims:** 4 total — 1 verified, 1 drifted
**Semantic claims:** 0 stored (extraction not run)
**Coverage:** 25% (5/20 sections checked)

| Line | Severity | Type | Finding |
|------|----------|------|---------|
| 26 | high | path_reference | `LICENSE.md` referenced in default exclude list but file not found in repo |

**Suppressed content:** 1 skip block (lines 37–115) covering the full YAML example, marked as `illustrative_example`. This is appropriate — the example shows all config options with illustrative values, not factual claims about defaults.

**Semantic annotations:** 19 annotations declaring default values for configuration fields (e.g., `max_claims_per_pr defaults to 50` at line 29, `min_severity defaults to 'low'` at line 151). These are not yet stored in `.docalign/semantic/` and thus not verified against code. Duplicate IDs `sem-c4b30f44787c9cb0` and `sem-9cc4fce5b07901d5` appear at lines 31–32 and again at lines 289–291 — same claims repeated in the zero-config section and the url_check section.

**Unchecked sections (15):** Full Example, doc_patterns, code_patterns, verification, claim_types, suppress, schedule, agent, trigger, llm, check, mapping, url_check, coverage, Error Handling. Most are reference tables inside skip blocks or contain only semantic annotations without stored claims.

---

### 2. `docs/reference/cli.md`

**Syntactic claims:** 0 (all content is inside skip blocks)
**Semantic claims:** 0 stored
**Coverage:** 0% (0/15 sections checked)

**No active drift findings.**

**Suppressed content:** 13 skip blocks covering virtually all command documentation — installation, all 8 commands (scan, check, search, extract, status, configure, init, viz, mcp, help), environment variables table, and exit codes table. Skip reasons are `user_instruction` and `example_table`.

**Semantic annotations (5):**
- Line 114: `sem-e23ce2967fee2194` — "Extracted claims saved to .docalign/semantic/"
- Line 127: `sem-81de6b5b50c968d5` — "docalign status outputs active config file path, MCP server status, ANTHROPIC_API_KEY presence, and any config warnings"
- Line 160: `sem-e04ddc09ca6c89f1` — "docalign init writes MCP server config and post-commit hooks to .claude/settings.local.json"
- Line 162: `sem-ab882ee276c75146` — "docalign init installs docalign and docalign-setup skills to .claude/skills/ and ~/.claude/skills/"
- Line 185: `sem-a5a01f8f7dba6eae` — "docalign viz outputs self-contained HTML with a Cytoscape.js graph"

**Note:** The entire CLI reference is effectively invisible to syntactic checks due to pervasive skip annotations. Semantic extraction would be needed to verify behavioral claims in these sections.

---

### 3. `docs/contributing/testing.md`

**Syntactic claims:** 7 total — 3 verified, 4 drifted
**Semantic claims:** 0 stored
**Coverage:** 64% (7/11 sections checked)

| Line | Severity | Type | Finding |
|------|----------|------|---------|
| 215 | high | command | `npm run test -- --coverage` — script `test -- --coverage` not found in package.json |
| 37 | medium | code_example | Symbol `makeClaim` not found in codebase |
| 78 | high | code_example | Import `'../fixtures'` does not resolve; symbols `MockIndex`, `Result`, `makeMockIndex` not found |
| 147 | high | code_example | Symbols `MockIndex`, `PathReference`, `makeClaim`, `makeMockIndex`, `toBe` not found |

**Suppressed content:** 6 skip blocks covering directory tree diagram (reason: `sample_output`) and code examples for `makeClaim()`, `makeMockIndex()`, extraction tests, verification tests, and config tests (reason: `tutorial_example`).

**Semantic annotations (6):**
- Line 20: `sem-0610668466f65261` — "DocAlign uses Vitest for all testing"
- Line 33: `sem-f53ea585cdee12dc` — "Tests mirror the src/ directory"
- Line 58: `sem-52f7249e08945356` — "makeClaim() creates a test Claim object with sensible defaults"
- Line 75: `sem-87b235d4c73676c3` — "makeMockIndex() creates a mock CodebaseIndex"
- Line 91: `sem-c186b1e2ccdb63ff` — "makeMockIndex() available fields: files, packages, scripts, engines, license, headings, envVars, exports"
- Line 104: `sem-9bdb63b026b4567e` — "makeResult() is the production helper used to build VerificationResult objects"

**Analysis:** The code examples reference test fixtures (`makeClaim`, `makeMockIndex`) that either don't exist yet or are not importable from `'../fixtures'`. The `npm run test -- --coverage` command is not a registered script. These are either aspirational (describing future test infrastructure) or the fixtures exist under a different import path. The skip blocks correctly mark them as `tutorial_example`, but the code outside skip blocks still triggers drift detection.

---

### 4. `docs/guides/mcp-integration.md`

**Syntactic claims:** 10 total — 1 verified, 2 drifted
**Semantic claims:** 0 stored
**Coverage:** 73% (8/11 sections checked)

| Line | Severity | Type | Finding |
|------|----------|------|---------|
| 39 | high | path_reference | `.claude/mcp.json` referenced but file not found in repo |
| 58 | medium | path_reference | `src/auth/middleware.ts` referenced as example but file not found (similar: test fixture `middleware.md`) |

**Suppressed content:** None — this file has no skip blocks.

**Semantic annotations (4):**
- Line 29: `sem-af8351d975968695` — (no claim text) — describes MCP server registration steps
- Line 35: `sem-9db76114419e7312` — (no claim text) — "After setup, your AI agent has 10 documentation tools available"
- Line 81: `sem-2d5a71308583e52c` — marked `status="drifted"` — "Returns doc sections about authentication ranked by relevance, with verification status"
- Line 94: `sem-63f2b4167bcf748c` — marked `status="verified"` — "Returns a 0-100 health score, verified vs drifted counts, and the worst files"

**Note:** Two semantic annotations at lines 29 and 35 lack `claim` attributes. The `status` attributes on lines 81 and 94 are non-standard — other files do not use inline status markers. The file references `.claude/mcp.json` and `src/auth/middleware.ts` which don't exist in the repo; the former is a user-side config path (expected not to exist in the source tree), the latter is an illustrative example path used in the "What agents can do" section.

---

### 5. `docs/guides/suppressing-findings.md`

**Syntactic claims:** 3 total — 1 verified, 0 drifted
**Semantic claims:** 0 stored
**Coverage:** 40% (4/10 sections checked)

**No active drift findings.**

**Suppressed content:** 9 skip blocks covering YAML configuration examples (all reason: `user_instruction`).

**Semantic annotations (4):**
- Line 59: `sem-c9f63433443bd8c2` — "Valid claim types are path_reference, dependency_version, command, api_route, code_example, behavior, architecture, config, convention, environment, url_reference"
- Line 87: `sem-035b93f7d0cb5fe3` — "Multiple fields in one rule are AND-combined"
- Line 113: `sem-d2d3bfa550793051` — "Disabling a claim type is more efficient than suppressing"
- Line 129: `sem-7aa983200d9271e3` — "Maximum 200 suppress rules per config file"

**Annotation issue:** Lines 121–134 show overlapping/redundant skip tags. There is a `<!-- /docalign:skip -->` at line 131 and another at line 133, plus a new `<!-- docalign:skip ... -->` at line 134 that is never closed. This appears to be accidental duplication from editing and may confuse parsers.

---

### 6. `docs/troubleshooting.md`

**Syntactic claims:** 1 total — 1 verified, 0 drifted
**Semantic claims:** 0 stored
**Coverage:** 18% (2/11 sections checked)

**No active drift findings.**

**Suppressed content:** 9 skip blocks covering YAML/JSON/bash configuration examples in troubleshooting steps (all reason: `user_instruction`).

**Semantic annotations (6):**
- Line 26: `sem-7f7f904a292774c0` — "DocAlign looks for files matching its default patterns from the directory where you run the command"
- Line 58: `sem-1b2c3dc31499d6d0` — "Default timeout is 5 seconds"
- Line 108: `sem-b612dbffa31051b8` — "Semantic extraction requires the claude CLI to be installed and authenticated"
- Line 125: `sem-4ed97e052569c9b4` — "invalid YAML causes DocAlign to fall back to defaults with a warning"
- Line 154: `sem-bdc3011d81bc4698` — "docalign check exits with code 1 when semantic claims have drifted findings"
- Line 163: `sem-7011649292f64661` — "DocAlign checks against the package.json nearest to the repo root"

**Note:** Very low syntactic coverage (18%) due to heavy use of skip blocks. Most troubleshooting content is config examples marked as `user_instruction`. The semantic annotations describe behavioral claims that would need extraction and code verification to validate.

---

### 7. `README.md`

**Syntactic claims:** 28 total — 20 verified, 2 drifted
**Semantic claims:** 0 stored
**Coverage:** 73% (8/11 sections checked)

| Line | Severity | Type | Finding |
|------|----------|------|---------|
| 24 | high | path_reference | `middleware/auth.ts` referenced as example claim but file not found in repo |
| 32 | medium | path_reference | `src/auth.ts` referenced as example but file not found (similar: `src/app.ts`) |

**Suppressed content:** None — README has no skip blocks or semantic annotations.

**Analysis:** Both drifted paths are in the "How It Works" section where they serve as illustrative examples of the kind of claims DocAlign detects. They are not meant to reference actual files in this repo. These are false positives — the surrounding prose makes clear these are hypothetical examples (e.g., *"Requests are authenticated using JWT tokens validated in `middleware/auth.ts`"* is presented as a sample extracted claim, not a reference to a real file). Consider adding `docalign:skip` around these illustrative examples.

---

### 8. `llms.txt`

**Syntactic claims:** 17 total — 14 verified, 0 drifted
**Semantic claims:** 0 stored
**Coverage:** 86% (6/7 sections checked)

**No active drift findings.**

**Suppressed content:** None.

**Unchecked sections (1):** "Source" section (lines 41–45) containing repository URL and license — not syntactically verifiable.

**Note:** llms.txt has the highest coverage of all audited files at 86% with zero drift. The document accurately reflects the current state of CLI commands, guides, and reference structure.

---

## Drift Summary

| File | Total Claims | Verified | Drifted | Coverage |
|------|-------------|----------|---------|----------|
| `docs/reference/configuration.md` | 4 | 1 | 1 | 25% |
| `docs/reference/cli.md` | 0 | 0 | 0 | 0% |
| `docs/contributing/testing.md` | 7 | 3 | 4 | 64% |
| `docs/guides/mcp-integration.md` | 10 | 1 | 2 | 73% |
| `docs/guides/suppressing-findings.md` | 3 | 1 | 0 | 40% |
| `docs/troubleshooting.md` | 1 | 1 | 0 | 18% |
| `README.md` | 28 | 20 | 2 | 73% |
| `llms.txt` | 17 | 14 | 0 | 86% |
| **Total** | **70** | **41** | **9** | — |

## Cross-Cutting Observations

1. **Semantic claims not yet verified.** All 8 files contain semantic annotations (44 total across the 6 suppressed files) but none are stored in `.docalign/semantic/`. Running `docalign extract` would enable verification of behavioral, architectural, and config claims.

2. **Heavy skip coverage in reference docs.** `docs/reference/cli.md` is 100% suppressed — every section is inside a skip block. This means zero syntactic verification coverage. While the skip reasons are valid (`user_instruction`, `example_table`), this creates a blind spot.

3. **Illustrative examples triggering false positives.** Both `README.md` and `docs/guides/mcp-integration.md` reference example file paths (`middleware/auth.ts`, `src/auth/middleware.ts`, `src/auth.ts`) that are hypothetical. These trigger high-severity path_reference drift but are not actual documentation errors. Adding `docalign:skip reason="illustrative_example"` would resolve these.

4. **Test fixture documentation is aspirational.** `docs/contributing/testing.md` describes test helpers (`makeClaim`, `makeMockIndex`) that either don't exist yet or use different import paths. The code examples outside skip blocks trigger drift.

5. **Overlapping skip tags.** `docs/guides/suppressing-findings.md` lines 121–134 have redundant/overlapping close tags and an unclosed open tag, likely from editing.

6. **Non-standard semantic status attributes.** `docs/guides/mcp-integration.md` lines 81 and 94 use `status="drifted"` and `status="verified"` inline, which is not used in any other file. This may be leftover from a manual audit.
