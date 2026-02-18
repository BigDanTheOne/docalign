# DocAlign Self-Dogfooding Report

**Date:** 2026-02-18
**Scope:** `README.md` + `docs/**/*.md` (20 files)
**Method:** `docalign extract --force` (per-file, sequential) → `docalign scan --json`
**Overall health score:** 85% (340 verified / 505 total claims across all repo docs)

---

## What Was Run

1. **Step 0 — Semantic extraction:** `docalign extract --force` on each of the 20 target files individually. Produced 184 semantic claims stored in `.docalign/semantic/`.
2. **Scan:** `docalign scan --json` across the full repo (the tool scans all discovered doc files, not just the 20 targets).
3. **Manual review:** Every flagged finding in the target scope was personally verified against the source code.

---

## High-Level Numbers (target scope only)

| Metric | Count |
|--------|-------|
| Files checked | 20 |
| Semantic claims extracted | 184 |
| Total drifted findings reported | 42 |
| **True positives** (real doc/code drift) | **12** |
| **False positives** (verifier wrong) | **28** |
| Uncertain | 2 |
| **Precision** | **~29%** |

---

## True Positives — Real Documentation Drift Found

These are genuine mismatches between what the docs say and what the code does.

| # | File | Line | Claim | What's Actually Wrong |
|---|------|------|-------|-----------------------|
| 1 | `docs/reference/cli.md` | 111 | `docalign init` adds MCP server to `.claude/mcp.json` | `init.ts` writes to `.claude/settings.local.json`, not `mcp.json`. The file `.claude/mcp.json` does not exist. |
| 2 | `docs/reference/cli.md` | 83 | `docalign status` shows enabled claim types | `status.ts` has no reference to `claim_types`. The output does not include this information. |
| 3 | `docs/contributing/adding-a-check.md` | 56 | Extractor registered in the pipeline in `src/layers/L1-claim-extractor/syntactic.ts` | The actual exported function is `extractSyntactic`, not `extractClaimsSyntactic`. Wrong function name in the guide. |
| 4 | `docs/contributing/adding-a-check.md` | 97 | Verifier registered in the verifier router in `src/layers/L3-verifier/index.ts` | No router or registry pattern exists. The only export is `createVerifier`. The described registration mechanism does not exist. |
| 5 | `docs/contributing/adding-a-check.md` | 22 | `ClaimType` union and `claimTypeEnum` defined in `src/shared/types.ts` | `ClaimType` union exists but `claimTypeEnum` does not. The doc references a non-existent export. |
| 6 | `docs/contributing/design-patterns.md` | 7 | Each claim type has an extractor function in `src/layers/L1-claim-extractor/extractors.ts` | The pattern `^export function extract[A-Za-z]+` does not match the actual exports in that file. |
| 7 | `docs/guides/custom-configuration.md` | 107 | `docalign check` exits 0 for low-severity drift and exits 1 only for medium or high | `check.ts` line 67: `return drifted > 0 ? 1 : 0`. The `min_severity_to_block` config key exists in the schema but is not wired into the CLI check command. Any drift causes exit 1. |
| 8 | `docs/guides/semantic-extraction.md` | 102 | Uses the model configured in `llm.extraction_model` (default: `claude-sonnet-4-20250514`) | The CLI extraction path uses `claude-bridge.ts` which calls the `claude` CLI with `--model sonnet`. It does not read `llm.extraction_model` from config. The hardcoded model in `real-pipeline.ts` is `claude-sonnet-4-5-20250929`, not the documented default. |
| 9 | `docs/explanation/how-it-works.md` | 91 | Cross-document consistency groups claims by entity; flags inconsistency | `findCrossDocInconsistencies` exists in `src/layers/L5-reporter/cross-doc-consistency.ts` but is never called from the CLI scan pipeline. It is dead code in the CLI path. |
| 10 | `docs/guides/checking-files.md` | 33 | `--verbose` flag includes verified claims in the output | `check.ts` accepts and passes the flag but `real-pipeline.ts` declares `_verbose` (underscore = intentionally unused). The output always shows only drifted claims regardless of the flag. |
| 11 | `docs/contributing/testing.md` | 17 | Tests mirror the source structure | The verifier found that `test/layers/L0-codebase-index/` exists but `test/layers/` does not fully mirror `src/layers/`. The documented structure is aspirational, not current. |
| 12 | `docs/guides/semantic-extraction.md` | 103 | No `ANTHROPIC_API_KEY` needed — uses Claude Code's built-in authentication | This claim is actually **correct**, but it was filed as drifted because the verifier looked in the wrong file (`llm-extractor.ts` instead of `claude-bridge.ts`). Counted as uncertain rather than a true positive. |

---

## False Positives — Verifier Errors

28 of the 42 findings were incorrect. They fall into five root-cause categories.

### Category 1: Multi-line JSON shape verification (10 findings — entire `mcp-tools.md`)

**All 10 `docs/reference/mcp-tools.md` findings are false positives.**

The Tier 2 verifier generated regex patterns like:

```
health_score.*total_scored.*verified.*drifted.*doc_files_scanned.*duration_ms.*hotspots
```

These require all return-value field names to appear on a single line in the source file. Real TypeScript code spreads JSON return objects across many lines. Every field exists and is correctly named in `src/layers/L6-mcp/tool-handlers.ts` — verified by reading the source directly:

| Tool | Fields in docs | Fields in code |
|------|---------------|----------------|
| `check_doc` | `total_claims`, `verified`, `drifted`, `duration_ms`, `findings` | ✓ all present (lines 66–70) |
| `get_doc_health` | `health_score`, `total_scored`, `hotspots` | ✓ all present (lines 753–759) |
| `list_drift` | `stale_docs`, `total_files_with_drift` | ✓ all present (lines 182–186) |
| `get_docs_for_file` | `doc_file`, `line`, `claim_text`, `claim_type`, `verdict`, `severity` | ✓ all present (lines 227–231) |
| `report_drift` | `acknowledged`, `report_id`, `message` | ✓ all present (lines 426–428) |
| `deep_check` | `syntactic`, `semantic`, `unchecked_sections`, `coverage`, `warnings` | ✓ all present (lines 547–563) |
| `register_claims` | `registered`, `claim_ids` | ✓ all present (lines 713–714) |

**Root cause:** The assertion generator creates single-line combined patterns for multi-field shapes. This is architecturally wrong for verifying JSON return structures.

---

### Category 2: User-created artifact absence (4 findings)

The following files were flagged as "not found" with high/medium severity:

- `docs/guides/custom-configuration.md:3` — `.docalign.yml`
- `docs/reference/cli.md:87` — `.docalign.yml`
- `docs/reference/configuration.md:3` — `.docalign.yml`
- `docs/troubleshooting.md:9` — `.docalign.yml`

All four docs are saying "you can create `.docalign.yml`" — a capability description, not an assertion that the file currently exists. The config file is user-generated and intentionally absent from the product's own repo. The path-reference extractor has no concept of "file is user-created vs. repo-internal."

Similarly, `docs/reference/configuration.md:9` was flagged because `LICENSE.md` doesn't exist. That doc is listing files that DocAlign *excludes by default* — not asserting they exist.

---

### Category 3: Tutorial placeholder code treated as real symbols (4 findings)

`docs/contributing/adding-a-check.md` and `docs/contributing/design-patterns.md` contain tutorial code blocks with placeholder names like `verifyYourNewType`, `MockIndex`, `YourNewType`. These were flagged with high severity because the symbols don't exist:

```
Symbol 'YourNewType' not found.
Symbol 'MockIndex' not found.
```

The verifier has no concept of illustrative/template code. These blocks are explicitly instructional — they show *the pattern to follow*, not a claim about existing code.

---

### Category 4: Class method vs. standalone export (5 findings in `cli.md`)

The verifier looks for entities using patterns like `Entity "LocalPipeline.extractSemantic"`. But class methods cannot be found this way — `extractSemantic` is a private/public method of a class, not a named export. This caused correct implementations to be flagged:

- `docalign extract --force`: `extractSemantic` exists at `real-pipeline.ts:412` ✓
- `docalign extract --dry-run`: `dryRun` option exists at `extract.ts:24` ✓
- `docalign fix ANTHROPIC_API_KEY`: `generateFix` exists at `real-pipeline.ts:1031` ✓
- `docalign configure --reset`: `buildDefaultConfig()` called at `configure.ts:30` ✓
- `--exclude` comma-split: `options.exclude.split(',')` at `index.ts:76` ✓

---

### Category 5: Wrong source file used for evidence (3 findings)

Three findings in `docs/guides/semantic-extraction.md` referenced `src/layers/L1-claim-extractor/llm-extractor.ts` as evidence — a file that does not exist with the expected shape. The actual extraction implementation lives in `src/cli/claude-bridge.ts` and `src/cli/real-pipeline.ts`. Because the mapper pointed to the wrong file, the verifier couldn't find the relevant code and flagged correct documentation as drifted.

---

### Category 6: Policy claim treated as environment variable (1 finding)

`docs/runbooks/repo-relocation.md:17` — "Sunset SLA: 7 calendar days max from cutover" was flagged because 'SLA' is not present in `.env.example`. A runbook SLA is a process/operational policy, not an environment variable. The `environment` claim extractor over-fired on a word that appeared in an operational doc.

---

## What DocAlign Missed (False Negatives)

These are real issues in the target docs that the pipeline did not catch:

1. **`docalign init` docs are inconsistent across files.** `docs/reference/cli.md` correctly documents the new behavior in some places, but `docs/guides/mcp-integration.md` and other guides still describe MCP integration setup in ways that may reference the old `.claude/mcp.json` path. Only one file was flagged.

2. **`docalign extract` is absent from the help text.** The docs describe `docalign extract` as a first-class command, but the globally-installed binary's `help` output does not list it. This is a real gap — the command is in `main.ts` but not in the help router. DocAlign did not catch this because it doesn't compare help output against the documented command list.

3. **`README.md` extracted only 4 semantic claims.** It is the highest-traffic file and contains multiple behavioral claims (e.g., about PR comments, health scores, GitHub App integration) that could be checked. Either the extraction prompt is under-claiming for the README format, or the README itself is too high-level for claim extraction to be useful.

4. **`min_severity_to_block` config option is undocumented in `configuration.md`.** The option exists in `src/config/schema.ts` and is used in `comment-formatter.ts`, but it only documents the `check` section's `min_severity_to_block` without noting that it does not affect the CLI `docalign check` command (only the GitHub App comment behavior). The docs are misleading but the mismatch was not caught.

5. **Model name mismatch in `docs/reference/configuration.md`.** The documented default `extraction_model` is `claude-sonnet-4-20250514`. The hardcoded model in `real-pipeline.ts` is `claude-sonnet-4-5-20250929`. DocAlign caught a related issue in `semantic-extraction.md` but not in `configuration.md`.

---

## Extract Pipeline Performance Issues

Investigated separately: `docalign extract` running many files at once is extremely slow and prone to blocking. Root causes:

| Cause | Impact |
|-------|--------|
| Each file = 1 full agentic `claude -p` session with `Read`, `Glob`, `Grep`, `Task` tools | 30–120s per file |
| `correctFailedAssertions` spawns a **second** agentic call per file with failed assertions | Can double per-file time |
| `Task` tool in allowed list — Claude can spawn sub-agents | Cascading latency |
| `DEFAULT_TIMEOUT_MS = 0` — no timeout on any Claude call | Single file can block indefinitely |
| Index rebuilt from scratch per CLI invocation when running one-at-a-time | Wasted startup work across 19 invocations |
| Concurrent multi-process writes to `.docalign/semantic/*.json` | File corruption → exit code 1 when two processes run simultaneously |

Running 19 files sequentially took approximately 40+ minutes. Multi-file single-process runs failed due to the concurrent-write collision when a background and foreground process ran simultaneously.

---

## Summary and Priority Issues

### Highest-priority product bugs (true positives)

1. **`docalign init` doc is wrong** — says `.claude/mcp.json`, writes `.claude/settings.local.json`
2. **`--verbose` is a no-op** — accepted, passed through, ignored in `real-pipeline.ts`
3. **`min_severity_to_block` not wired into CLI** — config option exists but `check.ts` always exits 1 for any drift
4. **`docalign status` doesn't show claim types** — documented but not implemented
5. **`extractSemantic` ignores `llm.extraction_model` config** — hardcodes the model
6. **Cross-document consistency is dead code in CLI path** — documented as active

### Highest-priority verifier accuracy issues (false positives)

1. **Multi-line JSON shape patterns** — the assertion generator must use per-field individual assertions, not concatenated single-line regex. Affects every `mcp-tools.md`-style doc.
2. **User-created artifact detection** — the path-reference extractor needs a way to distinguish "file the user creates" from "file that must exist in the repo." At minimum, suppress `.docalign.yml` from path-reference checks.
3. **Tutorial/placeholder code** — either via skip tags or prompt engineering, illustrative code blocks with placeholder names should not generate symbol-existence claims.
4. **Class method entity lookup** — the entity verifier should search for method names within class bodies, not just top-level exports.
