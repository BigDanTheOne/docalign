# Phase 5B: Test Strategy

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 5B
> **"DocAlign" is a working title.** Final product name TBD. When renaming, replace: "DocAlign", "docalign", `.docalign.yml`, `@docalign`, `DOCALIGN_*` env vars, `docalign/*` URLs.
>
> **Inputs:** Phase 5A Integration Examples, TDDs, Prompt Specs, API Contracts
> **Date:** 2026-02-11

---

## 1. Test Philosophy

DocAlign's architecture splits cleanly into two execution domains: **deterministic server-side code** (L0, L2 mapping steps 1-3, L3 Tiers 1-2, L4, L5 formatting, L7 rule evaluation) and **LLM-dependent agent tasks** (L1 semantic extraction, L3 Tier 4, L5 fix generation, L7 feedback interpretation). This split dictates the entire test strategy.

**Core principles:**

1. **Deterministic layers are tested deterministically.** No mocks needed for LLM calls because these layers never make LLM calls. Tests use real data structures, real database queries, and real business logic. Flaky tests in deterministic layers indicate bugs, not test fragility.

2. **LLM layers are tested via golden outputs and snapshot regression.** Agent task results are the mock boundary -- not the LLM API itself. Server-side code that processes agent results is tested by providing realistic `AgentTaskResult` fixtures. Agent-side code (the Action) that calls LLMs is tested with mocked API responses and golden input/output pairs.

3. **Two storage backends, one test suite.** The `StorageAdapter` interface (GATE42-014) means every database-touching test must pass against both SQLite and PostgreSQL. Tests are parameterized over the backend, not duplicated.

4. **CI budget is a constraint, not an afterthought.** Unit tests must complete in < 60 seconds. Integration tests must complete in < 5 minutes. LLM benchmark suites run nightly, not on every PR. Test design respects these budgets.

5. **Zero false positives on syntactic claims is a hard invariant.** The deterministic pipeline (regex extraction + deterministic verification) must never report a false positive. Any false positive in a syntactic claim is a bug, not a tuning issue.

---

## 2. Test Architecture Overview

### 2.1 Test Levels

| Level | What | LLM Required | Storage Backend | CI Gate |
|-------|------|:------------:|:---------------:|:-------:|
| **Unit** | Single function or service method, mocked dependencies | No | In-memory / SQLite | Blocks merge |
| **Integration (cross-layer)** | Two or more layers collaborating on real data | No | SQLite + PostgreSQL | Blocks merge |
| **Integration (full pipeline)** | End-to-end from trigger through reporter + fix-commit (IE-01, IE-02, IE-03, IE-04 derived) | No (agent results mocked) | SQLite + PostgreSQL | Blocks merge |
| **Storage parity** | Same operations on SQLite vs PostgreSQL, assert identical results | No | Both | Blocks merge |
| **LLM golden** | Agent tasks with recorded prompt/response pairs | Mocked (recorded) | SQLite | Nightly |
| **LLM live benchmark** | Agent tasks against real LLM API | Yes (real calls) | SQLite | Weekly (manual trigger) |
| **Snapshot regression** | Prompt templates rendered with test data, compared to stored snapshots | No | N/A | Blocks merge |
| **Performance** | Latency and throughput targets from TDD Section 5s | No | SQLite + PostgreSQL | Nightly |

### 2.2 Mock Boundary Diagram

```
Server-side code (deterministic)          Agent-side code (LLM-dependent)
==========================================|=========================================
                                          |
  L4 Worker                               |  GitHub Action
  +------------------+                    |  +------------------------+
  | createAgentTasks |--- task payload -->|| | claimLLM(payload)      |
  |                  |                    |  |   calls LLM API        |
  | processResult    |<-- AgentTaskResult-|| |   returns structured   |
  +------------------+                    |  |   result               |
                                          |  +------------------------+
                                          |
  Mock boundary = AgentTaskResult         |  Mock boundary = LLM API response
  (for server-side unit/integration)      |  (for agent-side unit tests)
```

**Key insight:** Server-side code never calls LLMs. The mock boundary for server-side tests is the `AgentTaskResult` interface. For agent-side tests (the GitHub Action code), the mock boundary is the LLM API response (HTTP mock or recorded response fixture).

---

## 3. Per-Layer Unit Tests

### 3.0 L0: Codebase Index

**What to test:** File existence checks, entity extraction via tree-sitter, dependency version lookup, route matching, semantic search, incremental diff updates.

**What to mock:** GitHub API (for file fetching). Use SQLite for unit tests; pgvector tests require PostgreSQL.

**Example test cases:**

1. **`fileExists` with normalized paths:** Input `"./src/index.ts"` normalizes to `src/index.ts`. Path with `../` is rejected.

2. **`findRoute` exact vs fuzzy:** `findRoute("repo-1", "POST", "/api/users")` returns exact match. `findRoute("repo-1", "GET", "/api/v2/users")` returns `null`; `searchRoutes` returns fuzzy matches.

3. **`updateFromDiff` with renamed file:** renamed AND modified files process rename first, then re-parse. No entity duplication.

4. **`getDependencyVersion` semver handling:** Returns `{ version: "^4.19.0", source: "manifest" }`. Scoped packages (`@types/react`) match with full scoped name.

5. **tree-sitter parse error:** `has_errors: true`, entities extracted up to the error point.

**Performance targets:** `fileExists` < 5ms, `findSymbol` < 10ms, `findRoute` < 10ms, `getDependencyVersion` < 5ms, `updateFromDiff` (100 files) < 5s.

---

### 3.1 L1: Claim Extractor

**What to test:** Syntactic regex extraction across all 10 claim types, pre-processing (strip HTML/frontmatter/SVG), re-extraction diffing, claim deduplication.

**What to mock:** Nothing for syntactic extraction (pure functions). Database for persistence tests (use SQLite adapter).

**Example test cases:**

1. **Regex extraction -- dependency_version:** Input `"Uses [express](...) \`v4.18.2\`..."` produces `claim_type: "dependency_version"`, `extracted_value: { package: "express", version: "4.18.2" }`, `extraction_confidence: 0.99`.

2. **Regex extraction -- api_route:** Input `"### GET /api/users/:id"` produces `claim_type: "api_route"` with correct method and path.

3. **Pre-processing:** Strips YAML frontmatter and HTML `<details>` blocks. `original_line_map` correctly maps back to original lines.

4. **reExtract diffing:** Old file with 3 claims, new file with 2 overlapping + 1 new produces correct `added`/`updated`/`removed`. Empty content puts all claims in `removed`.

5. **Large file rejection:** Doc file > 100KB returns `[]` with WARN log.

**Performance targets:** `extractSyntactic` (50KB) < 100ms, `getClaimsByFile` < 10ms, `reExtract` (20+25) < 200ms.

---

### 3.2 L2: Mapper

**What to test:** 4-step progressive pipeline (direct reference, symbol search, semantic search, LLM-assisted), deduplication across steps (TDD2-001), reverse index lookups, confidence scaling.

**What to mock:** L0 service (controlled return values). Database for mapping persistence.

**Example test cases:**

1. **Direct reference -- dependency_version:** `getDependencyVersion("express")` returns a result. Mapping to `package.json` with `confidence: 1.0`, `mapping_method: "direct_reference"`.

2. **Symbol search fallback:** `findRoute` returns null, `findSymbol("createUser")` returns entity. Mapping via `symbol_search`. Semantic search skipped when step 1 produces high-confidence result.

3. **Deduplication (TDD2-001):** Same file matched via direct reference (1.0) and symbol search (0.85). Only highest-confidence mapping retained.

4. **Reverse index lookup:** `findClaimsByCodeFiles(["src/routes/users.ts"])` returns mapped claims. Returns `[]` for files with no claim mappings (IE-03 scenario).

5. **Fuzzy route scaling (TDD2-002):** `searchRoutes` match with `similarity: 0.85` produces mapping confidence `0.85 * 0.9 = 0.765`.

---

### 3.3 L3: Verification Engine

**What to test:** Tier 1 deterministic checks (all 5 claim types), Tier 2 pattern strategies, `routeClaim` Path 1/Path 2 routing, `buildPath1Evidence` formatting, result storage and merging.

**What to mock:** L0 service (for Tier 1/2 lookups), `AgentTaskResult` (for Tier 4 result processing). No LLM mocks needed.

**Example test cases:**

1. **Tier 1 dependency_version drift (IE-01 derived):** Claim says `express@4.18.2`, L0 returns `^4.19.0`. Result: `verdict: "drifted"`, `severity: "medium"`, `tier: 1`, `token_cost: null`, `confidence: 1.0`.

2. **Tier 1 path_reference verified:** Claim says `src/index.ts`, `fileExists` returns `true`. Result: `verdict: "verified"`. Edge case: path not found but similar path exists -- drift with suggested correction.

3. **Tier 1 api_route verified (IE-02 derived):** Claim `POST /api/users`, `findRoute` returns entity. Result: `verdict: "verified"`, `token_cost: null`.

4. **routeClaim routing:** Single entity (10 lines) routes to Path 1 (`single_entity_mapped`). Entity spanning 500 lines (exceeds 4000-token cap) routes to Path 2 (`evidence_too_large`).

5. **buildPath1Evidence:** Formatted evidence includes file header, imports, entity code with line numbers. Token estimate within 20% of actual.

6. **storeResult idempotency:** Duplicate insert (same `id`) succeeds silently.

**Performance targets:** Tier 1 checks < 15ms, `routeClaim` < 20ms, `buildPath1Evidence` < 50ms, `storeResult` < 10ms.

---

### 3.4 L4: Change Triggers

**What to test:** Webhook parsing, trigger regex matching, file classification, scope resolution, scan orchestration, agent task creation.

**What to mock:** GitHub API (webhook payloads, PR file lists), L0/L1/L2/L3 services, BullMQ.

**Example test cases:**

1. **Trigger regex:** `"@docalign review"` matches. `"@docalign help"` does not (GATE42-010). `"user@docalign.com"` does not (word boundary).

2. **Scope resolution -- no claims in scope (IE-03):** PR changes `src/utils/helpers.ts` only. `findClaimsByCodeFiles` returns `[]`. Pipeline short-circuits.

3. **File classification:** `README.md` -> doc, `src/index.ts` -> code, `docs/api.md` -> doc, `src/docs/parser.ts` -> code.

4. **Agent task creation:** 3 semantic claims produce 3 `AgentTask` objects with `type: "verification"` via `createAgentTasks(repoId, scanRunId, tasks)` (GATE41-002).

5. **Force push:** `forced: true` webhook logs WARN, scan continues with new HEAD SHA.

---

### 3.5 L5: Reporter

**What to test:** Summary comment formatting, health score calculation, Check Run updates, `sanitizeForMarkdown`, non-diff-line notes, "Apply all fixes" HMAC link generation (GATE42-022).

**What to mock:** GitHub API (Octokit), claim/result data.

**Example test cases:**

1. **Drifted summary (IE-01):** 1 drifted finding, 11 verified, 92% health. Exact markdown matches IE-01 L5 output including severity table, `<details>` fix block, non-diff note.

2. **Clean summary (IE-03):** Zero findings, 20 verified. Message: "No documentation claims are affected by the changes in this PR." Health: 100%.

3. **Non-diff file note (TDD5-003):** Finding targets `README.md` line 7 but README.md not in diff. Summary includes "This finding references `README.md` which is not modified in this PR."

4. **Health score edge cases:** 0 verified + 0 drifted + 5 uncertain = score null, displayed as 'Scanning...' (not 0%, not NaN). The zero-denominator case produces no numeric score per phase4c-ux-specs.md Section 11.3. All drifted = 0%. Uncertain excluded from denominator.

5. **Check Run (GATE42-003):** Findings + `block_on_findings: false` -> `"neutral"`. No claims in scope -> `"success"`.

6. **sanitizeForMarkdown:** HTML comment injection (`<!--`) escaped. Null input returns empty string.

7. **"Apply all fixes" HMAC link present (GATE42-022):** When findings exist with generated fixes, the summary comment includes an "Apply all fixes" link with a valid HMAC-signed URL containing `repo_id` and `scan_run_id`.

8. **"Apply all fixes" link absent when no findings:** When zero drifted findings exist, the summary comment does NOT include an "Apply all fixes" link.

**Performance targets:** `formatFinding` < 5ms, `sanitizeForMarkdown` < 1ms, health score (500 claims) < 1s.

---

### 3.6 L6: MCP Server

**What to test:** `get_docs` full-text search, `get_doc_health` health score computation, `get_docs_for_file` reverse lookup, read-only connection enforcement.

**What to mock:** Database with seeded test data.

**Example test cases:**

1. **`get_docs` full-text search:**
   - Input: query `"authentication"` against repo with claims containing "Bearer token", "auth middleware".
   - Expected: returns matching claims ranked by relevance. `ILIKE` fallback when full-text search returns zero results.

2. **`get_docs_for_file` reverse lookup (GATE42-011):**
   - Input: `get_docs_for_file("src/routes/users.ts")`.
   - Expected: returns all claims mapped to that file, including claim text, doc file/line, verification status.

3. **Read-only connection enforcement:**
   - Input: attempt an INSERT via the read-only connection.
   - Expected: query rejected with an error (PostgreSQL `default_transaction_read_only` is ON).

---

### 3.7 L7: Learning System

**What to test:** Suppression rule evaluation, count-based exclusion logic, co-change recording and boost calculation, `isClaimSuppressed` boolean return.

**What to mock:** Database with seeded suppression rules and feedback records.

**Example test cases:**

1. **Count-based exclusion -- 2 dismissals trigger permanent suppression (TDD7-001):**
   - Input: claim dismissed twice with `"not_relevant_to_this_file"`.
   - Expected: `isClaimSuppressed` returns `true`. Rule has `expires_at: null`.

2. **Config-based suppression checked before database rules (TDD7-004):**
   - Input: `.docalign.yml` suppresses `claim_type: "convention"`. Claim is type `"convention"`.
   - Expected: claim is suppressed by config before L7 database check is reached.

3. **Co-change boost calculation:**
   - Input: `src/routes/users.ts` and `docs/api.md` changed together in 3 of last 20 commits.
   - Expected: boost value reflects the co-change frequency. Idempotent insert (TDD7-005).

---

### 3.8 Infrastructure

**What to test:** Webhook signature verification, API authentication middleware, BullMQ job lifecycle, database migrations, health check endpoint.

**What to mock:** GitHub webhook payloads (with valid/invalid signatures), Redis (for BullMQ unit tests).

**Example test cases:**

1. **Webhook signature verification:**
   - Input: valid `X-Hub-Signature-256` header with matching payload.
   - Expected: request accepted.
   - Input: tampered payload with original signature.
   - Expected: 401 Unauthorized. Request rejected immediately (not retryable).

2. **Agent Task API authentication (INFRA-003):**
   - Input: `GET /api/tasks/pending?repo_id=repo-1` with valid `DOCALIGN_TOKEN`.
   - Expected: returns pending tasks for repo-1.
   - Input: `POST /api/tasks/:id/result` -- middleware looks up task's `repo_id` and validates token.

3. **Database migration order (INFRA-002):**
   - Input: run all migrations against a fresh PostgreSQL instance.
   - Expected: all tables created successfully. `gen_random_uuid()` available (pgcrypto enabled in migration 0001).

4. **BullMQ job deduplication:**
   - Input: two `pr-scan-repo-1-47` jobs enqueued within 30 seconds.
   - Expected: second job replaces (debounces) the first. Only one scan runs.

5. **Fix-commit endpoint -- HMAC validation (GATE42-024, GATE42-025):**
   - Input: `GET /api/fix/apply?repo=repo-1&scan_run_id=scan-42&token={valid_hmac}`.
   - Expected: HMAC validates, returns HTML confirmation page with `<form method="POST">` (GATE42-029). No per-user auth check (GATE42-025).
   - Input: same URL with tampered `scan_run_id` (original `token` unchanged).
   - Expected: 403 Forbidden. HMAC mismatch detected.

6. **Fix-commit endpoint -- confirmation page flow (GATE42-029):**
   - Input: `GET /api/fix/apply` with valid HMAC.
   - Expected: returns HTML page with repo name, scan details, fix count, and `<form method="POST" action="/api/fix/apply">` with hidden fields (`repo`, `scan_run_id`, `token`). Response includes security headers: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: no-referrer`. Page loads no third-party resources.
   - Input: `POST /api/fix/apply` with valid form data (repo, scan_run_id, token).
   - Expected: HMAC re-validated from POST body, proceeds to PR state check and fix application.

7. **Fix-commit endpoint -- PR state check (GATE42-028):**
   - Input: `POST /api/fix/apply` with valid HMAC, PR is open.
   - Expected: request proceeds to fix application.
   - Input: `POST /api/fix/apply` with valid HMAC, PR is merged.
   - Expected: 400 Bad Request. "This PR is no longer open. Fixes cannot be applied."
   - Input: `POST /api/fix/apply` with valid HMAC, PR is closed.
   - Expected: 400 Bad Request. "This PR is no longer open. Fixes cannot be applied."

8. **Fix-commit endpoint -- fix application (GATE42-019):**
   - Input: scan with 2 fixes. Both target text found in current file contents.
   - Expected: both fixes applied, new file contents correct. Replacement uses replacer function `() => fix.new_text` (not literal string) to prevent `$`-pattern interpretation in `new_text`.
   - Input: scan with 2 fixes. One target text found, one target text has changed since scan.
   - Expected: partial failure. Applicable fix applied. Failed fix reported in response with reason.
   - Input: `new_text` contains `$1` or `$$` (e.g., documenting regex capture groups).
   - Expected: replacement is literal. The output file contains `$1` verbatim, not an interpreted back-reference.

9. **Fix-commit endpoint -- commit creation (GATE42-023):**
   - Input: fixes applied successfully.
   - Expected: commit created on PR head branch with author `docalign[bot]`, message `docs: fix documentation drift detected by DocAlign`.
   - Input: PR branch HEAD has moved since scan (new commits), but doc text unchanged.
   - Expected: server fetches latest branch state, applies fixes to current content, commit succeeds.

10. **Fix-commit endpoint -- confirmation comment (GATE42-023):**
   - Input: commit created successfully with 2 fixes.
   - Expected: confirmation comment posted: "Applied 2 documentation fixes in commit {sha}."
   - Input: partial failure (1 of 2 fixes applied).
   - Expected: comment explains which fixes succeeded and which failed, with reasons.

11. **Fix-commit endpoint -- HMAC has no expiry (GATE42-027):**
   - Input: HMAC token generated from a scan run completed days ago.
   - Expected: token still validates. No time component checked.

12. **`docalign fix` CLI command (GATE42-030):**
   - Input: `docalign fix README.md` with local SQLite containing 2 fixes for README.md.
   - Expected: both fixes applied as local file writes, exit code 0, output shows fix count and details.
   - Input: `docalign fix README.md` with no fixes available for that file.
   - Expected: exit code 1, output: "DocAlign: No fixes available for README.md. All claims are verified."
   - Input: `docalign fix` (no file argument, applies all fixes).
   - Expected: all available fixes applied across all files, exit code 0.
   - Input: `docalign fix` with 3 fixes: 2 apply, 1 target text has changed.
   - Expected: 2 fixes applied, 1 skipped with explanation, exit code 0 (partial success).
   - Input: `docalign fix README.md` but all target text has changed since scan.
   - Expected: all fixes skipped, exit code 2, output explains the mismatch.

13. **`docalign fix` CLI -- path traversal validation (GATE42-030):**
   - Input: `DocFix.file` contains `../../../etc/passwd`.
   - Expected: fix rejected before file write. Error: path is outside the repository root.
   - Input: `DocFix.file` contains an absolute path `/etc/hosts`.
   - Expected: fix rejected. Error: absolute paths are not allowed.
   - Input: `DocFix.file` is a symlink pointing outside the repo root.
   - Expected: fix rejected after symlink resolution. Error: resolved path is outside the repository root.

---

## 4. Integration Tests

### 4.1 Cross-Layer Integration Pairs

These tests exercise the contract between adjacent layers using real service instances (not mocks) against an in-process database.

| Test Pair | Layers | What It Validates |
|-----------|--------|-------------------|
| **L0 + L1** | Index + Extractor | Claims extracted from a doc reference files that L0 has indexed. Keywords in claims match entity names in L0. |
| **L1 + L2** | Extractor + Mapper | Claims produced by L1 are correctly mapped to code by L2. Direct references resolve to the expected files. |
| **L2 + L3** | Mapper + Verifier | Mappings produced by L2 feed into L3 routing and deterministic verification. High-confidence mappings route to Path 1. |
| **L3 + L5** | Verifier + Reporter | Verification results are formatted correctly into PR comments. Drifted findings appear in summary. Verified claims do not. |
| **L4 + L0/L1/L2/L3** | Triggers + Pipeline | L4 scope resolution correctly identifies claims affected by a PR diff. Changed code files trigger reverse index lookups. Changed doc files trigger re-extraction. |
| **L4 + L5** | Triggers + Reporter | L4 passes the correct payload to L5. Zero-finding scans produce the right template. |
| **L5 + L7** | Reporter + Learning | Suppressed claims do not appear in PR output. Config suppression takes precedence. |
| **L6 + Storage** | MCP + Database | MCP queries return consistent results regardless of SQLite vs PostgreSQL backend. |

### 4.2 Full Pipeline Integration Tests (derived from IE-01, IE-02, IE-03, IE-04)

These are the golden integration tests. Each reconstructs an end-to-end scenario from Phase 5A, asserting exact intermediate outputs at every layer boundary.

#### IT-01: Syntactic Drift -- Dependency Version Mismatch (from IE-01)

**Setup:**
- Seed database with the Taskflow repo (12 claims, 11 verified, 0 drifted).
- Seed L0 index with entities from the repo file tree.
- Seed L2 mappings for all 12 claims.

**Input:**
- Webhook: `issue_comment.created` with `@docalign review` on PR #47.
- PR diff: `package.json` modified (express `^4.18.2` -> `^4.19.0`).

**Assertions (layer by layer):**
1. **Trigger:** regex matches, `:eyes:` reaction sent, scan enqueued.
2. **L0:** `getDependencyVersion("repo-tf-001", "express")` returns `{ version: "^4.19.0", source: "manifest" }`.
3. **Scope:** exactly 1 claim in scope (the express version claim). Other 5 README claims NOT in scope.
4. **L3 Tier 1:** `verdict: "drifted"`, `confidence: 1.0`, `tier: 1`, `token_cost: null`, `duration_ms < 50`.
5. **L5 Summary:** contains `"1 drifted"`, `"92% health"`, severity `MEDIUM`, suggested fix line.
6. **L5 "Apply all fixes" link:** summary comment includes HMAC-signed "Apply all fixes" URL with correct `repo_id` and `scan_run_id` (GATE42-022).
7. **Check Run:** `conclusion: "neutral"` (non-blocking default).
8. **Scan Run:** `claims_checked: 1`, `claims_drifted: 1`, `total_token_cost: 0`.

**LLM calls:** Zero. Entire test is deterministic.

#### IT-02: Semantic Drift -- API Behavior Changed (from IE-02)

**Setup:**
- Seed database with the user-service repo (15 claims: 3 syntactic route claims, 3 semantic behavior claims, etc.).
- Seed L0 index with route entities from `src/routes/users.ts`.
- Seed L2 mappings for all claims.

**Input:**
- Webhook: `issue_comment.created` with `@docalign review` on PR #87.
- PR diff: `src/routes/users.ts` modified (status 201->200, response body changed).

**Assertions (layer by layer):**
1. **Trigger:** regex matches, scan enqueued.
2. **L0:** Route entity `POST /api/users` updated with new `raw_code`.
3. **Scope:** behavior claim about `POST /api/users` returning `201 Created` is in scope.
4. **L3 Tier 1:** syntactic `api_route` claim for `POST /api/users` verified (route still exists).
5. **L3 routing:** behavior claim routes to Path 1 (`single_entity_mapped`, token estimate < 4000).
6. **L3 Tier 4 (mocked):** `AgentTaskResult` fixture provides `verdict: "drifted"`, `severity: "high"`, `confidence: 0.97`.
7. **L5 Summary:** contains `"1 drifted"`, `"93% health"`, severity `HIGH`. Non-diff note for `docs/api.md`.
8. **L5 Fix (mocked):** `AgentTaskResult` fixture provides corrected doc text. Summary includes diff block.
9. **L5 "Apply all fixes" link:** summary comment includes HMAC-signed "Apply all fixes" URL (GATE42-022).
10. **Check Run:** `conclusion: "neutral"`.

**LLM calls:** Zero (agent results are mocked with fixtures derived from IE-02).

#### IT-03: Clean PR -- No Drift Detected (from IE-03)

**Setup:**
- Seed database with the rest-api repo (20 verified claims).
- Seed L0 index. No claims map to `src/utils/helpers.ts`.

**Input:**
- Webhook: `issue_comment.created` with `@docalign review please` on PR #18.
- PR diff: `src/utils/helpers.ts` modified (new `formatDate` function added).

**Assertions (layer by layer):**
1. **Trigger:** regex matches (`review` preceded by `@docalign`, followed by `please` which is ignored).
2. **L0:** new `formatDate` entity indexed. `entities_added: 1`.
3. **Scope:** `L2.findClaimsByCodeFiles(["src/utils/helpers.ts"])` returns `[]`. Zero claims in scope.
4. **Pipeline short-circuit:** L3 verification not called. No agent tasks created.
5. **L5 Summary:** "No documentation claims are affected by the changes in this PR." Health: `**20 verified** | **0 drifted** -- **100% health**`.
6. **Check Run:** `conclusion: "success"` (not `neutral` -- no findings means success per GATE42-003).
7. **Scan Run:** `claims_checked: 0`, `claims_drifted: 0`, `total_token_cost: 0`.

**LLM calls:** Zero.

#### IT-04: Fix-Commit Flow -- Apply All Fixes (from IE-04, GATE42-019, GATE42-025, GATE42-028, GATE42-029)

**Setup:**
- Seed database with a completed scan run containing 2 drifted findings with generated fixes.
- Mock GitHub API: PR state check, branch state fetch, commit creation, comment posting.

**Input:**
- Phase 1 (GET): `GET /api/fix/apply?repo=repo-tf-001&scan_run_id=scan-47&token={valid_hmac}`.
- Phase 2 (POST): `POST /api/fix/apply` with form body `repo=repo-tf-001&scan_run_id=scan-47&token={valid_hmac}`.

**Assertions (step by step):**
1. **HMAC validation (GET):** token validates against `repo_id + ":" + scan_run_id`. No per-user auth check (GATE42-025).
2. **Confirmation page:** GET returns HTML page with repo name, fix count, and `<form method="POST">` (GATE42-029).
3. **HMAC re-validation (POST):** token re-validated from POST body.
4. **PR state check:** GitHub API confirms PR is open (GATE42-028).
5. **Branch state fetch:** latest file contents fetched from PR head branch.
6. **Fix application:** both fixes applied to current file contents. Target text found and replaced.
7. **Commit creation:** commit created on PR head branch. Author: `docalign[bot]`. Message: `docs: fix documentation drift detected by DocAlign`.
8. **Confirmation comment:** "Applied 2 documentation fixes in commit {sha}." posted on PR.

**Variant -- partial failure:**
- Same setup but one fix target text has changed since scan.
- Assertions: 1 fix applied, 1 fix skipped. Commit created with partial changes. Comment explains which fix failed and why.

**Variant -- HMAC tampered:**
- Input: valid URL but `scan_run_id` changed.
- Assertion: 403 Forbidden. No GitHub API calls made. No confirmation page served.

**Variant -- PR merged/closed (GATE42-028):**
- Input: valid HMAC, POST submitted, but PR is merged (or closed).
- Assertion: 400 Bad Request. Response: "This PR is no longer open. Fixes cannot be applied." No fix application attempted.

**Variant -- no expiry (GATE42-027):**
- Input: HMAC from a scan run completed 7 days ago. PR still open.
- Assertion: HMAC validates, fixes applied normally. Token has no time-based expiry.

**LLM calls:** Zero. Entire test uses mocked GitHub API.

#### IT-05: `docalign fix` CLI -- Local Fix Application (from GATE42-030)

**Setup:**
- Local SQLite database with a completed scan containing 2 fixes for `README.md` and 1 fix for `docs/api.md`.
- Local repo checkout with matching file contents.

**Input:**
- `docalign fix README.md`.

**Assertions:**
1. **Reads fixes from local SQLite** for the specified file.
2. **Applies fixes as local file writes** (no GitHub API calls).
3. **Output:** "2 fixes applied" with line-by-line details.
4. **Exit code:** 0.
5. **File contents:** `README.md` modified in place, `docs/api.md` unchanged.

**Variant -- all files:**
- Input: `docalign fix` (no file argument).
- Assertion: all 3 fixes applied across both files. Exit code 0.

**Variant -- partial success (text changed):**
- Setup: 3 fixes available. 2 target files unchanged. 1 target text modified since scan.
- Input: `docalign fix` (all files).
- Assertion: 2 fixes applied, 1 skipped with "target text has changed" message. Exit code 0. Output lists both successes and failures.

**Variant -- all fixes fail (text changed):**
- Setup: all fix target texts modified since scan.
- Input: `docalign fix README.md`.
- Assertion: exit code 2. Output: all fixes skipped with explanations.

**Variant -- no fixes available:**
- Input: `docalign fix src/index.ts` (no fixes for this file).
- Assertion: exit code 1, output: "DocAlign: No fixes available for src/index.ts. All claims are verified."

**LLM calls:** Zero. Entirely local operation.

#### IT-06: All Claims Verified -- Zero Findings (Section 2.2 template)

**Setup:**
- Seed database with the synthetic-node repo (10 claims, all verified).
- Seed L0 index and L2 mappings. 3 claims map to `src/routes/users.ts`.

**Input:**
- Webhook: `issue_comment.created` with `@docalign review` on PR #25.
- PR diff: `src/routes/users.ts` modified (minor refactor, behavior unchanged).

**Assertions:**
1. **Scope:** 3 claims in scope (mapped to `src/routes/users.ts`).
2. **L3:** All 3 claims pass verification (Tier 1 deterministic checks pass).
3. **L5 Summary:** Uses Section 2.2 template (NOT Section 2.3). Message: `All **3 claims** verified. Documentation is in sync. :white_check_mark:` Health line present.
4. **No "Apply all fixes" link:** Zero drifted findings means no fix link.
5. **Check Run:** `conclusion: "success"`.

**LLM calls:** Zero.

#### IT-07: CLI `docalign scan` in Embedded Mode (from F10)

**Setup:**
- Local repo checkout of synthetic-node with `README.md` (5 claims) and `package.json`.
- No prior scan data in SQLite.

**Input:**
- `docalign scan` (no arguments, scans current directory).

**Assertions:**
1. **L0:** Codebase indexed into local SQLite. Entities extracted via tree-sitter.
2. **L1:** Claims extracted from `README.md`.
3. **L2:** Claims mapped to code entities.
4. **L3:** Deterministic verification runs (syntactic claims only if no LLM key configured).
5. **Output:** CLI displays scan results matching Section 6.3 output format.
6. **SQLite:** Scan run record persisted. Claim records persisted. Verification results persisted.

**LLM calls:** Zero if no API key configured (syntactic-only mode).

### 4.3 Storage Backend Tests (SQLite + PostgreSQL)

Every test in Sections 4.1 and 4.2 runs against both storage backends via test parameterization, with one exception: IT-05 and IT-07 run against SQLite only, since the CLI exclusively uses the local SQLite backend.

**Strategy:** Use `describe.each(["sqlite", "postgresql"])` to parameterize all integration tests over both backends. Each backend creates a fresh `StorageAdapter` instance (SQLite in-memory, PostgreSQL test database), runs migrations, and tears down after tests.

**SQLite-specific concerns:**
- No pgvector extension: semantic search tests (`searchSemantic`) use a mock/stub that returns pre-computed results. Assertion: the query interface is called correctly. Actual vector similarity is tested only against PostgreSQL.
- No `gen_random_uuid()`: UUID generation uses `crypto.randomUUID()` at the application layer, not the database layer.
- JSON operations: SQLite's JSON support differs from PostgreSQL JSONB. Tests validate that `extracted_value` JSONB fields serialize/deserialize correctly on both backends.

**PostgreSQL-specific concerns:**
- pgvector queries tested with real embeddings (1536-dimension vectors).
- Full-text search (`to_tsvector`/`plainto_tsquery`) tested with real GIN indexes.
- `gen_random_uuid()` tested via migration 0001 (pgcrypto).

**Parity assertions:**
- Same seed data, same queries, same results (excluding pgvector and full-text search which are PostgreSQL-only features).
- Schema migrations produce identical table structures (column names, types, constraints).

---

## 5. LLM-Dependent Testing Strategy

### 5.1 Mock Boundary Definition

The mock boundary is precisely defined by the `AgentTaskResult` interface from `phase4-api-contracts.md` Section 10.3.

**Server-side tests:** Provide pre-built `AgentTaskResult` fixtures with realistic data (verdict, confidence, severity, reasoning, mismatch, evidence_files, token metadata). Server-side code processes these identically whether from a real LLM or a test fixture.

**Agent-side tests:** HTTP-level mock of the LLM API (e.g., `nock("https://api.anthropic.com")`) returning golden JSON responses.

**What is NOT mocked:** Database queries (use real SQLite/PostgreSQL), business logic (routing, tier selection, formatting), JSON validation of agent results (tested with both valid and malformed payloads).

### 5.2 Golden Test Sets

Golden test sets are derived from two sources: TDD examples (per-function test cases) and Phase 5A integration examples (end-to-end flows).

#### Golden Set Structure

Golden files are organized under `test/golden/` by category: `extraction/`, `verification/`, `fix-generation/`, `integration/`. Each file contains the prompt template ID, input variables, claim/evidence objects, expected output constraints (verdict, severity, confidence minimum, must-contain/must-not-contain strings), and optionally a recorded LLM response for snapshot comparison.

#### Golden Set Derivation

| Source | Golden Tests Derived |
|--------|---------------------|
| IE-01 (syntactic drift) | 1 extraction, 1 Tier 1 verification, 1 summary format (with "Apply all fixes" link), 1 Check Run |
| IE-02 (semantic drift) | 2 extractions (syntactic + semantic), 1 Tier 1 verification, 1 Tier 4 verification, 1 fix generation, 1 summary format (with "Apply all fixes" link) |
| IE-03 (clean PR) | 1 scope resolution, 1 clean summary format (no "Apply all fixes" link), 1 Check Run |
| IE-04 (fix-commit flow) | 1 HMAC validation, 1 confirmation page (GET), 1 PR state check, 1 fix application (success), 1 fix application (partial failure), 1 commit creation, 1 confirmation comment, 1 merged/closed PR rejection |
| IT-05 (`docalign fix` CLI) | 1 single-file fix, 1 all-files fix, 1 no-fixes-available |
| IT-06 (all verified) | 1 scope resolution, 1 Section 2.2 template format, 1 Check Run |
| IT-07 (CLI scan) | 1 CLI scan output format, 1 SQLite persistence check |
| TDD-0 examples | 5 L0 function tests (fileExists, findRoute, getDependencyVersion, etc.) |
| TDD-1 examples | 10 regex patterns x 2 positive + 2 negative examples each = 40 extraction tests |
| TDD-3 examples | 5 Tier 1 strategies x 3 test cases each = 15 deterministic verification tests |
| TDD-5 examples | 3 summary templates x 2 test cases each = 6 formatting tests |

**Total golden tests: approximately 95-110 test cases.**

### 5.3 Snapshot Testing

Snapshot tests capture the exact rendered output of prompt templates and PR comment templates. When the template changes, the snapshot diff shows exactly what changed.

**What is snapshotted:**

1. **Prompt templates (P-EXTRACT, P-VERIFY, P-FIX):** rendered with golden test variables. Asserts that prompt wording, structure, and variable interpolation are correct.

2. **PR comment templates (summary, Check Run):** rendered with golden finding data. Asserts exact markdown output including "Apply all fixes" link when findings exist.

3. **Evidence formatting:** `buildPath1Evidence` output for known entity data.

**Snapshot update workflow:**
- Snapshots are stored in `test/__snapshots__/`.
- When a prompt or template changes intentionally, run `npm test -- --update-snapshots`.
- Snapshot diffs are reviewed in PR code review (changes to prompt wording are visible).

### 5.4 Prompt Regression Detection

Prompt regressions occur when a change to prompt text, model version, or system prompt causes verification quality to degrade.

**Detection mechanisms:**

1. **Snapshot diff on prompt templates:** Any change to a prompt file triggers a snapshot update. Reviewers see the exact text change.

2. **Golden test pass rate:** The nightly LLM benchmark runs all golden test cases against real LLM calls. If the pass rate drops below the threshold (see Section 6.3), the benchmark fails with a regression alert.

3. **Structured output validation:** Every `AgentTaskResult` is validated against a Zod schema before processing. Schema violations are logged and tracked. A spike in validation failures signals a prompt or model regression.

4. **Confidence distribution monitoring:** Track the distribution of `confidence` values across verification results. A shift toward lower confidence (e.g., median drops from 0.92 to 0.78) triggers investigation.

### 5.5 Model Migration Testing

When switching LLM providers or model versions (e.g., Claude Sonnet 4 to Claude Sonnet 5):

1. **Run the full golden test suite against the new model.** Compare pass rates and confidence distributions.

2. **Side-by-side comparison:** For each golden test case, compare old model output vs new model output. Flag cases where the verdict changed.

3. **Acceptance criteria:** New model must achieve >= old model pass rate on the golden test suite. If < 5% of test cases change verdict, the migration is acceptable. If > 5% change, manual review of each changed case is required.

4. **Prompt tuning budget:** Allow up to 2 prompt revision iterations per model migration. If the golden test pass rate cannot be restored in 2 iterations, escalate.

---

## 6. Accuracy Benchmarks

### 6.1 Per-Layer Accuracy Targets

> **Per GATE42-017:** These accuracy targets are **aspirational guidelines** for monitoring and improvement, not hard launch blockers. The only hard launch invariant is **0% syntactic false positive rate** (any syntactic false positive is a correctness bug). All other metrics inform tuning priorities but will not block launch if the product demonstrates genuine value.

> **Note for founder review:** These are proposed targets based on the deterministic/semantic split and the zero-false-positive invariant. Adjust before implementation begins.

| Layer | Operation | Metric | Target | Rationale |
|-------|-----------|--------|--------|-----------|
| **L1** | Syntactic extraction (regex) | Precision | >= 98% | Regex patterns are hand-crafted; false positives are bugs. |
| **L1** | Syntactic extraction (regex) | Recall | >= 95% | Missing a syntactic claim is a coverage gap, not a crisis. |
| **L1** | Semantic extraction (LLM) | Precision | >= 80% | LLM may over-extract vague statements as claims. |
| **L1** | Semantic extraction (LLM) | Recall | >= 85% | Missing a behavior claim means we fail to catch real drift. |
| **L2** | Mapping (direct reference) | Recall | >= 90% | Direct references (file paths, package names) should resolve. |
| **L2** | Mapping (symbol search) | Recall | >= 75% | Symbol names may not match exactly. |
| **L2** | Mapping (semantic search) | Recall | >= 60% | Embedding quality varies. Acceptable for fallback step. |
| **L3** | Tier 1-2 (deterministic) | Accuracy | >= 99% | Deterministic comparisons. Errors are bugs, not tuning issues. |
| **L3** | Tier 4 (semantic verification) | Precision | >= 80% | False positive drift reports erode developer trust. |
| **L3** | Tier 4 (semantic verification) | Recall | >= 75% | Missing real drift is bad but less damaging than false positives. |
| **L5** | Fix generation acceptance | Rate | >= 70% | "Accepted" = developer clicks "Apply suggestion". |
| **E2E** | Syntactic claims | False positive rate | 0% | Hard invariant. Any false positive is a bug. |
| **E2E** | All claims | False positive rate | < 5% | Across all claim types including semantic. |

### 6.2 Measurement Methodology

**Definitions:**
- **Precision** = true positives / (true positives + false positives). "Of the drift we reported, how much was real?"
- **Recall** = true positives / (true positives + false negatives). "Of the real drift that existed, how much did we catch?"
- **F1** = 2 * (precision * recall) / (precision + recall). Harmonic mean.
- **Accuracy** (for deterministic tiers) = correct verdicts / total verdicts.

**Ground truth construction:**

For each benchmark repo (see Section 9), construct a ground truth dataset:

1. **Manually label all claims** in the repo's documentation. For each claim: correct claim type, correct testability, correct extracted value.

2. **Manually label all mappings** for each claim. For each claim: expected code file(s), expected entity (if any).

3. **Manually label all verdicts** for each claim against the current code state. For each claim: verified, drifted, or uncertain -- with reasoning.

4. **Construct synthetic PRs** that introduce known drift. For each PR: expected claims in scope, expected verdicts, expected severity.

**Measurement process:**
- Run DocAlign pipeline against the benchmark repo.
- Compare pipeline output (claims, mappings, verdicts) against ground truth.
- Compute precision, recall, F1 per layer.

### 6.3 MVP Launch Guidelines (Aspirational)

> **Per GATE42-017:** These thresholds are aspirational guidelines, not hard launch gates. The only hard invariant is **0% syntactic false positive rate**. All other metrics inform tuning priorities. If the product demonstrates genuine value during testing, a missed threshold will not block launch -- the decision is a judgment call based on overall product quality.

| Metric | Target | Action if Below |
|--------|--------|-----------------|
| L1 syntactic precision | >= 95% | Investigate and tune regex patterns. Prioritize fixing false extractions. |
| L1 semantic recall | >= 80% | Investigate and tune P-EXTRACT prompt. Acceptable if close (>= 75%). |
| L3 Tier 1-2 accuracy | >= 99% | Fix deterministic logic. This is a bug, not a tuning issue. |
| L3 Tier 4 precision | >= 75% | Investigate and tune P-VERIFY prompt. Consider limiting semantic verification scope. |
| L3 Tier 4 recall | >= 70% | Investigate. Acceptable if precision is high. Users prefer fewer but correct findings. |
| E2E syntactic false positive rate | 0% | **Hard invariant.** No launch with any syntactic false positives. |
| E2E false positive rate (all) | < 10% | Investigate and tune prompts. Target < 5%. |
| Fix generation acceptance | >= 60% | Investigate and tune P-FIX prompt. |

### 6.4 Benchmark Execution

**How to run benchmarks:**

- `npm run benchmark:accuracy` -- full benchmark against all test repos.
- `npm run benchmark:accuracy -- --repo=synthetic-node` -- single repo.
- `npm run benchmark:accuracy -- --syntactic-only` -- deterministic claims only (no LLM).
- `ANTHROPIC_API_KEY=sk-... npm run benchmark:accuracy -- --live` -- live LLM calls.

**Output:** JSON report in `test/benchmarks/` with per-layer precision/recall/F1 and pass/fail badges per threshold.

---

## 7. Regression Testing

### 7.1 Triggers for Regression Tests

| Change Type | Regression Tests Triggered | Run When |
|-------------|--------------------------|----------|
| Code change in L0-L7 | Full unit + integration suite | Every PR (blocks merge) |
| Prompt template change (P-EXTRACT, P-VERIFY, P-FIX) | Snapshot tests + golden test subset | Every PR (snapshots block merge, golden subset nightly) |
| Model version change | Full golden test suite with live LLM | Before merging model migration PR |
| Database migration | Storage parity tests + full integration suite | Every PR that includes a migration |
| Configuration schema change | Config parsing tests + integration tests with custom configs | Every PR |
| Dependency update | Full unit + integration suite | Every PR |

### 7.2 Accuracy Regression Detection

**Nightly benchmark run:** The nightly CI job runs the full accuracy benchmark against synthetic test repos (per GATE42-020, public repos deferred to post-launch). Results are stored as JSON artifacts.

**Regression detection logic:**
1. Compare current run's per-layer metrics against the previous run.
2. Flag regression if any metric drops by more than 2 percentage points.
3. Flag critical regression if any launch guideline (Section 6.3) is violated -- noting that only 0% syntactic FP rate is a hard invariant per GATE42-017.

**Alert mechanism:**
- Nightly run produces a summary in CI artifacts.
- If regression detected: CI job fails, notification sent (GitHub issue auto-created).
- Weekly trend chart showing metric values over time (generated from stored JSON artifacts).

### 7.3 Performance Regression Detection

**Nightly performance test:** Runs the full pipeline against synthetic repos and measures wall-clock time per operation.

**Tracked metrics (from TDD Section 5s):**
- L0: `updateFromDiff` (100 files) < 5 seconds
- L1: `extractSyntactic` (50KB file) < 100ms
- L3: Tier 1 batch (50 claims) < 500ms
- L5: `postPRComment` < 30 seconds from verification completion
- Full pipeline (IE-01 equivalent): < 5 seconds end-to-end (excluding LLM)
- Full pipeline (IE-02 equivalent, mocked LLM): < 10 seconds end-to-end

**Regression threshold:** Any operation exceeding 2x its target is flagged. Any operation exceeding 5x its target is a blocker.

---

## 8. CI/CD Integration

### 8.1 Tests That Block Merge

These tests run on every PR and must pass before merge is allowed.

| Test Suite | Time Budget | Contents |
|-----------|-------------|----------|
| **Unit tests** | < 60 seconds | All per-layer unit tests (Sections 3.0-3.8) against SQLite |
| **Integration tests** | < 3 minutes | Cross-layer pairs (Section 4.1) + full pipeline (Section 4.2) against SQLite |
| **PostgreSQL parity** | < 2 minutes | Storage parity assertions (Section 4.3) against PostgreSQL (Docker) |
| **Snapshot tests** | < 10 seconds | Prompt template + PR comment template snapshots |
| **Type checking** | < 30 seconds | `tsc --noEmit` |
| **Lint** | < 20 seconds | ESLint + Prettier check |
| **Total** | < 7 minutes | Must not exceed this budget |

**CI environment:**
- GitHub Actions runner: `ubuntu-latest`
- Node.js: LTS (22.x)
- PostgreSQL: Docker service (`pgvector/pgvector:pg16`) started in CI
- Redis: Docker service for BullMQ tests
- SQLite: in-memory (`:memory:`)
- No LLM API keys required (all LLM calls are mocked)

### 8.2 Nightly Test Suite

Runs at 02:00 UTC daily.

| Test Suite | Time Budget | Contents |
|-----------|-------------|----------|
| **Full accuracy benchmark** | < 30 minutes | All golden test cases with live LLM calls against all test repos |
| **Performance regression** | < 10 minutes | Latency measurements for all tracked operations |
| **Extended integration** | < 10 minutes | Full pipeline against all synthetic test repos (public repos added post-launch per GATE42-020) |
| **Total** | < 50 minutes | |

**Requires:** `ANTHROPIC_API_KEY` secret for live LLM calls. Estimated nightly LLM cost: $0.50-$2.00 (75-90 golden tests x $0.01-$0.02 average per test).

### 8.3 Weekly Benchmark Suite

Runs Sunday at 06:00 UTC (manual trigger also available).

| Test Suite | Time Budget | Contents |
|-----------|-------------|----------|
| **Extended accuracy benchmark** | < 2 hours | Full benchmark against all test repos with expanded test cases (public repos added post-launch per GATE42-020) |
| **Model comparison** | < 1 hour | Run golden tests against multiple model versions to track drift |
| **Stress test** | < 30 minutes | Repos with 1000+ claims, 500+ doc files |
| **Total** | < 4 hours | |

**Estimated weekly LLM cost:** $5-$15.

### 8.4 Time Budgets

| Test Level | Per-PR | Nightly | Weekly |
|-----------|--------|---------|--------|
| Unit + integration (deterministic) | 5 min | 5 min | 5 min |
| Storage parity | 2 min | 2 min | 2 min |
| Snapshots + type check + lint | 1 min | 1 min | 1 min |
| Golden tests (mocked LLM) | -- | 10 min | 10 min |
| Golden tests (live LLM) | -- | 30 min | 30 min |
| Performance regression | -- | 10 min | 10 min |
| Extended benchmark | -- | -- | 2 hr |
| **Total** | **< 7 min** | **< 58 min** | **< 4 hr** |

---

## 9. Test Data Strategy

### 9.1 Synthetic Test Repos

Two purpose-built repositories with controlled claim counts and known ground truth.

#### synthetic-node (Node.js/TypeScript)

A typical Express/TypeScript API project with `README.md` (15 claims), `docs/api.md` (20 claims), `docs/setup.md` (10 claims), route handlers, middleware, models, `package.json`, `tsconfig.json`, and `.env.example`. **Ground truth:** 45 claims, all manually labeled. 5 intentionally drifted (2 version, 1 route behavior, 1 config, 1 environment).

#### synthetic-python (Python/FastAPI)

A FastAPI project with `README.md` (12 claims), `docs/api.md` (15 claims), route handlers, Pydantic models, `pyproject.toml`. **Ground truth:** 27 claims, all manually labeled. 3 intentionally drifted (1 version, 1 route behavior, 1 config).

**Maintenance:** Synthetic repos are versioned in `test/fixtures/repos/`. Each version is a git tag. Ground truth labels are stored alongside in `test/fixtures/ground-truth/`.

### 9.2 Public Repo Test Fixtures

Public repos deferred to post-launch (GATE42-020). Will be added based on user feedback and real-world usage patterns. MVP testing relies exclusively on the two synthetic repos (Section 9.1) with fully controlled ground truth.

### 9.3 Test Data Versioning

**Synthetic repos:**
- Stored in `test/fixtures/repos/` as actual git repositories (with `.git` history).
- Tagged with version numbers: `v1.0`, `v1.1`, etc.
- Each version has a corresponding ground truth file in `test/fixtures/ground-truth/{repo-name}/{version}.json`.
- Breaking changes to test data require a major version bump and corresponding test updates.

**Public repo snapshots (post-launch, per GATE42-020):**
- Will be stored as tarballs in `test/fixtures/public-repos/{repo-name}-{commit-sha}.tar.gz`.
- Ground truth labels in `test/fixtures/ground-truth/{repo-name}/{commit-sha}.json`.
- Added post-launch based on user feedback and real-world usage patterns.

**Golden test cases:**
- Stored in `test/golden/` as JSON files (see Section 5.2).
- Versioned alongside the codebase. Changes to golden files require explicit review.
- Golden files include the LLM model version used when recording responses.

**LLM response recordings:**
- Stored in `test/recordings/` with filenames like `P-VERIFY-PATH1-{test-id}-{model}-{date}.json`.
- Used for snapshot regression. Updated when prompts change intentionally.
- Old recordings retained for 90 days for historical comparison.

---

## 10. Acceptance Criteria for MVP Launch

All functional, performance, and reliability criteria must pass before shipping. Accuracy criteria are aspirational guidelines per GATE42-017 (only 0% syntactic FP rate is a hard invariant).

### 10.1 Functional Criteria

| # | Criterion | How Verified |
|---|-----------|--------------|
| F1 | `@docalign review` triggers a scan on any installed repo | IT-01, IT-02, IT-03 passing |
| F2 | Syntactic extraction identifies all 5 syntactic claim types (path_reference, dependency_version, command, api_route, code_example) | L1 unit tests passing, accuracy benchmark >= 95% recall |
| F3 | Tier 1 deterministic verification produces correct verdicts for all syntactic claim types | L3 unit tests passing, accuracy >= 99% |
| F4 | PR summary comment is posted for every triggered scan (including clean PRs) | IT-01, IT-02, IT-03 summary assertions |
| F5 | Summary comment includes "Apply all fixes" HMAC-signed link when drifted findings with fixes exist | IT-01, IT-02 "Apply all fixes" link assertions (GATE42-022) |
| F6 | "Apply all fixes" endpoint creates correct commit with all doc fixes applied | IT-04 passing (GATE42-019) |
| F7 | Check Run conclusion is `neutral` for findings (default) and `success` for clean PRs | IT-01 (neutral), IT-03 (success) |
| F8 | Health score is computed correctly: `verified / (verified + drifted)` | L5 unit tests, edge case: all drifted = 0%, all verified = 100% |
| F9 | SQLite and PostgreSQL backends produce identical results for all operations | Storage parity tests passing |
| F10 | CLI `docalign scan` works in embedded mode with SQLite | IT-07 passing |
| F11 | "Apply all fixes" endpoint validates HMAC (no per-user auth per GATE42-025), serves confirmation page (GATE42-029), checks PR is open (GATE42-028), applies fixes, creates commit, and posts confirmation comment | IT-04 all assertions and variants passing (GATE42-019, GATE42-023, GATE42-024, GATE42-025, GATE42-028, GATE42-029) |
| F12 | `docalign fix` CLI reads fixes from local SQLite and applies as local file writes | IT-05 passing (GATE42-030) |

### 10.2 Accuracy Criteria

> **Per GATE42-017:** All accuracy criteria below are aspirational guidelines except A4 (syntactic false positive rate), which is a hard invariant. Missing other thresholds will not block launch if the product demonstrates genuine value.

| # | Criterion | Threshold | Type | How Verified |
|---|-----------|-----------|------|--------------|
| A1 | L1 syntactic extraction precision | >= 95% | Aspirational | Accuracy benchmark on synthetic repos |
| A2 | L3 Tier 1-2 accuracy | >= 99% | Aspirational (but bugs here are correctness issues) | Accuracy benchmark (deterministic) |
| A3 | L3 Tier 4 precision | >= 75% | Aspirational | Accuracy benchmark with live LLM |
| A4 | E2E syntactic false positive rate | 0% | **Hard invariant** | Accuracy benchmark on all test repos |
| A5 | E2E overall false positive rate | < 10% | Aspirational | Accuracy benchmark with live LLM |

### 10.3 Performance Criteria

| # | Criterion | Threshold | How Verified |
|---|-----------|-----------|--------------|
| P1 | Full deterministic pipeline (IE-01 equivalent) | < 5 seconds | Performance regression suite |
| P2 | PR comment posted after verification completes | < 30 seconds | L5 performance test |
| P3 | Tree-sitter parse of 100 files | < 2 seconds | L0 performance test |
| P4 | Scope resolution for a 1000-claim repo | < 1 second | L4 performance test |

### 10.4 Reliability Criteria

| # | Criterion | How Verified |
|---|-----------|--------------|
| R1 | All unit tests pass (100%) | CI green |
| R2 | All integration tests pass (100%) | CI green |
| R3 | Storage parity tests pass (100%) | CI green |
| R4 | No snapshot regressions (all snapshots match) | CI green |
| R5 | Nightly accuracy benchmark passes all launch guidelines (aspirational per GATE42-017; hard invariant: 0% syntactic FP rate) | Last 3 consecutive nightly runs |
| R6 | Zero test flakiness in deterministic suites over 10 consecutive runs | CI history |
| R7 | Fix-commit endpoint handles HMAC validation, confirmation page flow, PR state check, fix application, commit creation, and partial failure gracefully | IT-04 all variants passing (GATE42-019, GATE42-025, GATE42-028, GATE42-029) |
