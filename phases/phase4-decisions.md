# Phase 4: Cross-TDD Design Decisions Log

> Coordination file for Phase 4. Before making a design choice that affects other TDDs or contradicts `phase4-api-contracts.md`, write the decision here first.

---

## Decisions

### TDD2-001: Deduplication Strategy Across Pipeline Steps

**Source:** TDD-2 (tdd-2-mapper.md), Section 4.1, Appendix D
**Affects:** L3 (verifier receives deduplicated mappings), L7 (co-change data applies to deduplicated results)

**Decision:** When the same (code_file, code_entity_id) pair appears from multiple pipeline steps, keep only the candidate with the highest confidence. Whole-file mappings (entity=null) and entity-level mappings for the same file are treated as distinct keys and both retained.

**Rationale:** A claim can legitimately map to the same file via multiple steps (e.g., direct reference finds the file, symbol search finds a function within it). Rather than discarding duplicates entirely or keeping all, we keep the strongest signal per target. Entity-level and whole-file mappings coexist because they serve different purposes -- the entity gives L3 specific evidence, the whole-file gives broader context.

**Alternatives considered:** (a) Stop pipeline on first high-confidence hit -- rejected because a behavior claim may map to multiple files. (b) Keep all candidates and let L3 decide -- rejected because it inflates mapping count and complicates L3 routing.

---

### TDD2-002: Fuzzy Route Search Confidence Scaling Factor

**Source:** TDD-2 (tdd-2-mapper.md), Section 4.1 (Step 1, api_route), Appendix A.4
**Affects:** L3 (routing decisions based on confidence), calibration experiments

**Decision:** When `findRoute` returns null and `searchRoutes` returns fuzzy matches, scale confidence as `similarity * 0.9`. Fuzzy matches below similarity 0.7 are discarded.

**Rationale:** Fuzzy route matches are less precise than exact matches (which get 1.0) but more precise than pure semantic search (which gets `similarity * 0.8`). The 0.9 factor reflects that structural path similarity is a strong signal. The 0.7 threshold prevents noise from weakly-similar routes.

**Open question:** The 0.9 factor is an initial estimate. Should be validated during Experiment 16.2 (semantic threshold calibration). May need per-framework tuning.

---

### TDD2-003: Manifest File Resolution for Dependency Claims

**Source:** TDD-2 (tdd-2-mapper.md), Appendix A.3
**Affects:** L0 (may benefit from a `getManifestFileForPackage` function in v2)

**Decision:** For MVP, L2 infers the manifest file from the `DependencyVersion.source` field and ecosystem conventions. Map to the primary manifest file (e.g., `package.json`), not the lockfile (e.g., `package-lock.json`), since documentation typically references the manifest.

**Rationale:** L0's `getDependencyVersion` returns version and source but not the file path. Rather than adding a new L0 function (scope creep), L2 uses a static mapping table from ecosystem to manifest file. This is sufficient for MVP since the mapping is deterministic.

**Lockfile note:** When `source='lockfile'`, the dependency exists but was found in the lockfile. We still map to the primary manifest file because that is what documentation authors reference. If the dependency is only in the lockfile (transitive dependency), the manifest mapping is the closest approximation.

---

### TDD2-004: code_example Claim Mapping Strategy

**Source:** TDD-2 (tdd-2-mapper.md), Appendix A.5
**Affects:** L1 (must extract `imports[]` and `symbols[]` from code blocks), performance targets

**Decision:** For code_example claims, Step 1 is N/A. Step 2 calls `findSymbol` individually for each import path (last segment) and each symbol from `extracted_value`. Step 3 uses the full code block text for semantic search.

**Rationale:** Code examples contain multiple references (imports, function calls, class names). Each reference is an independent evidence link. Searching each individually via `findSymbol` ensures we capture all entity-level mappings.

**Performance concern:** A code block with 5 imports and 8 symbols triggers 13 `findSymbol` calls. This is acceptable for MVP (each call < 10ms per TDD-0). If it becomes a bottleneck, batch via `SELECT * FROM code_entities WHERE repo_id = $1 AND name = ANY($names)`. Logged as Open Question #2 in TDD-2.

---

### TDD2-005: Step 4 Skip Classification Uses Keyword Heuristic Only

**Source:** TDD-2 (tdd-2-mapper.md), Appendix E, derived from spike-a-vague-claim-mapping.md
**Affects:** v2 planning (analytics data quality), L3 (receives zero mappings, routes to Path 2)

**Decision:** When a claim falls through Steps 1-3 with zero mappings (Step 4 would apply but is skipped in MVP), classify as `'skipped_universal'` if the claim text contains whole-word matches for "all", "every", "no ", "never", "always", "each", "any". Otherwise classify as `'skipped_flow'`. Classification is logged (not stored in claim_mappings).

**Rationale:** Spike A identified two categories of vague claims: universal quantifier claims (affect all code) and flow claims (affect a specific data/control flow path). The keyword heuristic is a rough approximation. Since this classification is for analytics only (measuring distribution to inform v2 implementation priorities), mis-classification has low impact.

**No LLM involved:** This is a static regex heuristic. No LLM calls. Consistent with the L2 principle of zero LLM calls on the server side.

---

### TDD3-001: Tier 2 Pattern Strategies Conservative Fallthrough in MVP

**Source:** TDD-3 (tdd-3-verifier.md), Appendix D
**Affects:** L4 (more claims route to Tier 4 / Path 2 than theoretically necessary), v2 planning

**Decision:** Most Tier 2 pattern strategies in MVP conservatively return `null` (fall through to Tier 4) because L0's API provides entity lookups and file existence checks but does NOT provide raw file content reading for arbitrary files (e.g., tsconfig.json values, .env contents). When a strategy needs file content, it falls through.

**Rationale:** Adding a `readFile` API to L0 would expand its scope and introduce new security considerations (arbitrary file reads, size limits). Since Tier 4 verification is all-client-side (client pays LLM cost), the fallthrough cost is borne by the client, not DocAlign. Tier 2 becomes more valuable when L0 gains a `readFile` API in v2.

**Alternatives considered:** (a) Add `readFile` to L0 API now -- rejected as scope creep for MVP. (b) Remove Tier 2 entirely from MVP -- rejected because the framework import check (D.2) via `findSymbol` does produce results and the infrastructure is worth establishing.

---

### TDD3-002: buildPath1Evidence Uses Single Entity (Not Multi-Entity Concatenation)

**Source:** TDD-3 (tdd-3-verifier.md), Section 4.3, Open Question #3
**Affects:** L4 (task payload size), agent verification accuracy

**Decision:** When `routeClaim` returns `multi_entity_small` (multiple entities in the same file, total tokens within cap), `buildPath1Evidence` uses only the highest-confidence entity mapping for evidence assembly. It does NOT concatenate all entity code blocks.

**Rationale:** Concatenating multiple entities increases evidence size and may introduce noise (irrelevant entity code). The highest-confidence entity is the strongest signal. If the LLM needs more context, it returns `uncertain`, and the claim can be retried via Path 2 in a future scan.

**Alternatives considered:** (a) Concatenate all entity code blocks -- rejected because it complicates the evidence format and may exceed the token cap that routing estimated. (b) Include entity signatures only (not full code) for secondary entities -- viable for v2 but adds formatting complexity.

---

### TDD3-003: Token Estimation Uses Fixed Average Characters Per Line

**Source:** TDD-3 (tdd-3-verifier.md), Section 4.2 (routeClaim algorithm)
**Affects:** Routing accuracy (Path 1 vs Path 2 split)

**Decision:** Token estimation for routing uses `line_count * 60 chars/line / 4 chars/token` as a conservative average. The 60 chars/line and 4 chars/token constants are hardcoded.

**Rationale:** Exact token counting requires reading entity code and running a tokenizer, which adds latency and complexity. The estimate only needs to be accurate enough to distinguish "fits in Path 1" from "too large." A conservative estimate (overestimate) safely routes borderline claims to Path 2, which is correct behavior (Path 2 handles all cases). Under-estimation would be worse (Path 1 evidence truncated).

**Calibration plan:** After 100 PR scans, compare estimated tokens vs actual `FormattedEvidence.metadata.total_token_estimate` to tune the constants.

---

### TDD6-001: MCP get_docs Uses Full-Text Search, Not Embedding API

**Source:** TDD-6 (tdd-6-mcp.md), Section 4.1, Open Question #1
**Affects:** Search quality for `get_docs` tool, migration requirements (new GIN index)

**Decision:** The MCP server's `get_docs` tool uses PostgreSQL full-text search (`to_tsvector` / `plainto_tsquery`) on `claims.claim_text` instead of calling an embedding API for semantic search. Fallback: `ILIKE` keyword search when full-text search returns zero results.

**Rationale:** The MCP server has a zero-LLM-calls constraint (consistent with the server-side principle across DocAlign). Calling an embedding API would require the user to configure an API key for the MCP server, add latency per query, and add cost. Full-text search on PostgreSQL is free, fast, and sufficient for targeted documentation queries at MVP scale (<500 claims). The tradeoff is lower recall for vague/semantic queries ("how does error handling work"), which is acceptable for v2.

**Migration impact:** Requires a new GIN index `idx_claims_fulltext` on `to_tsvector('english', claim_text)`. This is additive and backwards-compatible. Optionally, a `pg_trgm` GIN index for `report_drift` claim matching.

---

### TDD6-002: MCP get_docs Groups by File Only (Not Section) in v2

**Source:** TDD-6 (tdd-6-mcp.md), Section 4.1, Open Question #2
**Affects:** L1 (may need to store `section_heading` in claims table in v3), UX quality

**Decision:** In v2, `get_docs` groups results by `source_file` only. The `section` field in the response is set to the filename without path (e.g., `"auth.md"`). True section grouping (by nearest markdown heading) is deferred to v3 when L1 stores `section_heading` alongside each claim.

**Rationale:** The `claims` table does not currently store section/heading information. Extracting section context would require either reading the original doc file from the filesystem (the MCP server does not have guaranteed filesystem access to the repo) or adding a column to the claims table (schema change). Both are out of scope for the v2 MCP server design.

**v3 plan:** Add `section_heading TEXT` column to `claims` table. L1 populates it during extraction by tracking the nearest markdown heading above each claim's line number.

---

### TDD6-003: MCP report_drift Uses Separate Writable Connection

**Source:** TDD-6 (tdd-6-mcp.md), Section 4.3, Appendix B.3
**Affects:** Database connection management, v3 feature planning

**Decision:** The MCP server's `report_drift` tool (v3) uses a separate writable `pg.Client` connection, distinct from the read-only connection used by all other tools. The read-only connection has `SET default_transaction_read_only = ON` for safety. The writable connection is only created when the v3 feature flag is enabled.

**Rationale:** Per 3B-D4, the MCP server is read-only by default. Having a separate writable connection limits the blast radius of bugs -- a code error in `get_docs` or `get_doc_health` cannot accidentally write to the database. The writable connection is lazy-initialized only when `report_drift` is first called, avoiding the overhead when the feature is disabled.

---

### TDD7-001: Count-Based Exclusion Is Permanent (No Expiry)

**Source:** TDD-7 (tdd-7-learning.md), Section 4.3, Appendix B
**Affects:** L4 (scan scope resolution must respect permanent suppression), L1 (re-extraction creates new claim IDs, bypassing old rules)

**Decision:** Count-based exclusion rules (`source = 'count_based'`) have `expires_at = null` (permanent). The claim re-enters checking only when its text changes (L1 re-extraction creates a new claim ID) or the rule is explicitly revoked (developer undo or 2 positive feedback signals).

**Rationale:** Adding an expiry would cause the finding to resurface, triggering a third dismissal and a new permanent rule -- an unnecessary cycle. The "re-entry on text change" mechanism is the natural safety valve: if the documentation is updated, the old claim ID is replaced and the rule becomes inert without any additional logic.

**Alternatives considered:** (a) 180-day expiry matching quick-pick rules -- rejected due to the resurfacing cycle problem. (b) No permanence, requiring 3+ dismissals after each expiry -- rejected as developer-hostile (alert fatigue).

---

### TDD7-002: Quick-Pick Reasons Aligned with API Contracts (Not Spike C)

**Source:** TDD-7 (tdd-7-learning.md), Section 4.2, Appendix A
**Affects:** L5 (PR comment must render matching quick-pick labels), phase4c-ux-specs.md

**Decision:** The quick-pick reasons in `phase4-api-contracts.md` Section 1 (`QuickPickReason` type) differ from the Spike C 5.1 labels. The API contract reasons are canonical: `not_relevant_to_this_file`, `intentionally_different`, `will_fix_later`, `docs_are_aspirational`, `this_is_correct`. These supersede the Spike C working names (`migration_in_progress`, `doc_known_stale`, `dont_care_about_check`, `finding_is_wrong`).

**Rationale:** The API contracts file is the frozen source of truth. Spike C was exploratory design. The API contract reasons are more descriptive and user-friendly.

**Mapping from Spike C to API contracts:**
- `migration_in_progress` -> `intentionally_different`
- `doc_known_stale` -> `docs_are_aspirational`
- `dont_care_about_check` -> `not_relevant_to_this_file`
- `finding_is_wrong` -> `this_is_correct`

---

### TDD7-003: isClaimSuppressed Returns Boolean (Not SuppressionEvaluation)

**Source:** TDD-7 (tdd-7-learning.md), Section 4.4
**Affects:** L4 (scan pipeline filtering), L5 (PR comment suppressed section)

**Decision:** The public API `isClaimSuppressed(claim)` returns a simple `boolean`. The richer `SuppressionEvaluation` type (with matched rule, reason, and expiry) is an internal type used for debugging and the suppressed-findings section of PR comments. L5 calls `getActiveRules` separately to populate the suppressed section.

**Rationale:** L4 only needs a boolean to filter claims before verification (it does not need to know why a claim is suppressed). L5 needs the full rule details but only for the collapsible suppressed section, which it constructs by cross-referencing `getActiveRules` results with the claim list. Adding a richer return type to the public API would complicate the common case (L4 filtering) for the uncommon case (L5 display).

**Alternatives considered:** (a) Return `SuppressionEvaluation` always -- rejected for API simplicity. (b) Two functions (`isClaimSuppressed` and `getSuppressionDetails`) -- viable but unnecessary for MVP; `getActiveRules` + client-side matching is sufficient for L5.

---

### TDD7-004: Config-Based Suppression Checked Before Database Rules

**Source:** TDD-7 (tdd-7-learning.md), Appendix E.5
**Affects:** L4 (scan pipeline order), phase4d-config-spec.md

**Decision:** Suppressions defined in `.docalign.yml` (`claim_types` and `suppress[]` entries) are evaluated by L4 BEFORE calling L7's `isClaimSuppressed`. Config-based suppression is NOT stored in the `suppression_rules` table -- it is evaluated directly from the parsed config. L7's `isClaimSuppressed` handles only database-backed rules (feedback-driven and count-based).

**Rationale:** Config-based suppressions are repo-wide policy set by the team in source control. They should take precedence over feedback-driven rules (which are individual developer signals). Keeping them separate also simplifies the `suppression_rules` table (no need for a `source = 'config'` type) and avoids synchronization issues between `.docalign.yml` changes and database state.

---

### TDD7-005: co_changes Deduplication via Unique Index

**Source:** TDD-7 (tdd-7-learning.md), Section 4.6, Section 6.1
**Affects:** Database schema (migration), performance

**Decision:** Add a unique index on `co_changes(repo_id, code_file, doc_file, commit_sha)` to prevent duplicate records from webhook redeliveries or retries. The `INSERT ... ON CONFLICT DO NOTHING` pattern makes `recordCoChanges` idempotent.

**Rationale:** Without deduplication, a redelivered push webhook would double-count co-changes, inflating the boost. The unique index is the simplest and most robust deduplication mechanism. The index also accelerates the `getCoChangeBoost` COUNT query.

**Migration note:** This is a new index on an existing table. The migration is additive and backwards-compatible.

---

### INFRA-001: Webhook Replay Protection Deferred to Post-MVP

**Source:** TDD-Infra (tdd-infra.md), Section 4.1 (handleWebhook), Open Question #1
**Affects:** Security posture (S1), Redis memory usage

**Decision:** For MVP, webhook replay protection (storing X-GitHub-Delivery in Redis with 5-minute TTL) is deferred. BullMQ's job ID dedup (`pr-scan-{repo_id}-{pr_number}`) provides partial protection against duplicate deliveries. Full Redis-based delivery ID dedup is added post-MVP per XREF-002.

**Rationale:** GitHub webhook redeliveries are rare (only on explicit user request or GitHub infrastructure issues). BullMQ's existing job ID dedup handles the primary case (same PR number). The Redis dedup adds complexity (memory, TTL management) for a low-probability scenario. XREF-002 explicitly marks this as post-MVP.

**Alternatives considered:** (a) Implement immediately -- rejected per XREF-002 hygienic security posture. (b) Use in-memory Set with TTL -- rejected because it does not survive restarts.

---

### INFRA-002: Single Migration for pgcrypto Before All Tables

**Source:** TDD-Infra (tdd-infra.md), Appendix F (Migration Dependency Order)
**Affects:** All tables using `gen_random_uuid()`

**Decision:** Migration 0001 enables `pgcrypto` extension (or relies on PostgreSQL 13+ built-in `gen_random_uuid()`) to provide UUID generation for primary keys. All subsequent table migrations use `DEFAULT gen_random_uuid()` for primary keys. This is the first migration applied.

**Rationale:** Supabase includes `pgcrypto` by default, but the migration ensures it works in CI (where we use a plain `pgvector/pgvector:pg16` Docker image). Making it explicit avoids "function gen_random_uuid() does not exist" failures in CI.

---

### INFRA-003: Auth Middleware Extracts repo_id from Query Param or Task Lookup

**Source:** TDD-Infra (tdd-infra.md), Appendix B.3 (Auth Middleware)
**Affects:** Agent Task API request flow, TDD-4 (task claiming)

**Decision:** For `GET /api/tasks/pending`, the `repo_id` comes from the query parameter. For `GET /api/tasks/:id` and `POST /api/tasks/:id/result`, the middleware looks up the task's `repo_id` from the database using the task ID in the path, then validates the token against that repo_id.

**Rationale:** The Action knows its `repo_id` when listing tasks (from the dispatch payload) but may not include it as a query param on individual task endpoints. Looking up the task's repo_id from the database ensures correct scoping without requiring the Action to pass repo_id on every call. The lookup adds one extra query but is cached in the request context.

**Alternative considered:** Require `repo_id` as a query parameter on all endpoints. Rejected because it is redundant (the task already knows its repo_id) and adds friction to the Action implementation.

---

### TDD5-001: Review Comments Only for Drifted Findings

**Source:** TDD-5 (tdd-5-reporter.md), Section 4.1 (postPRComment algorithm), Appendix B
**Affects:** L4 (must separate drifted from uncertain findings before calling postPRComment), L7 (feedback reactions are only collected from review comments, so uncertain findings do not generate feedback signals)

**Decision:** Review comments (line-level, with suggestion blocks) are posted only for findings with `verdict: 'drifted'`. Uncertain findings appear only in the summary comment's collapsible `<details>` section. They do NOT get inline review comments.

**Rationale:** Uncertain findings lack sufficient confidence for a line-level suggestion. Posting review comments for uncertain findings would generate noise, waste GitHub API calls, and erode developer trust. The collapsible summary section keeps them visible without being intrusive. This aligns with PRD L5 Section 9.2: "Uncertain claims do NOT get inline review comments -- summary only."

**Alternatives considered:** (a) Post review comments for uncertain findings with a different visual style -- rejected because uncertain findings have no fix to suggest, making the review comment low-value. (b) Post uncertain findings as informational review comments without suggestion blocks -- rejected because it inflates the "N conversations" counter on the PR, which developers find annoying.

---

### TDD5-002: Dismiss-All Includes scan_run_id in HMAC

**Source:** TDD-5 (tdd-5-reporter.md), Section 7.2, Appendix G.5
**Affects:** API server dismiss endpoint (must validate `scan_run_id` and only dismiss findings from that specific scan run)

**Decision:** The dismiss-all URL includes `scan_run_id` in both the URL parameters and the HMAC payload. Format: `GET /api/dismiss?repo={repo_id}&pr={pr_number}&scan_run_id={scan_run_id}&token={hmac}` where HMAC = `HMAC-SHA256(DOCALIGN_API_SECRET, repo_id + ":" + pr_number + ":" + scan_run_id)`. Dismissal is scoped to the current scan's findings only.

**Rationale:** Without `scan_run_id` scoping, clicking dismiss-all on an old summary comment could dismiss findings from a newer scan. Including it ensures temporal correctness. The HMAC prevents parameter tampering.

**Alternatives considered:** (a) Scope dismissal to PR only (all findings, any scan) -- rejected because it could dismiss findings the developer hasn't seen yet. (b) No HMAC, use DOCALIGN_TOKEN auth instead -- rejected because the dismiss link is clickable from the PR comment, and the DOCALIGN_TOKEN is a repo secret that should not appear in URLs.

---

### TDD5-003: Non-Diff Lines Fall Back to Summary-Only

**Source:** TDD-5 (tdd-5-reporter.md), Section 7.3, Appendix H (TDD5-003)
**Affects:** L4 (should provide the list of changed files to L5 so it can determine which findings can have review comments)

**Decision:** When a finding targets a documentation file that was NOT part of the PR diff, L5 does not post a review comment for that finding. The finding appears in the summary comment only with a note: "This finding references `{file}` which is not modified in this PR."

**Rationale:** GitHub rejects review comments on lines outside the diff with a 422 Unprocessable Entity error. Rather than attempting the API call and handling the error, L5 proactively avoids it. This is expected for findings triggered by code changes where the affected documentation was not modified in the PR (a common scenario: code changed, doc claims about that code are now stale, but the doc file was not touched in the PR).

**Alternatives considered:** (a) Attempt the review comment and catch the 422 error -- rejected because it wastes an API call and adds error handling complexity. (b) Skip the finding entirely -- rejected because the finding is still valuable information for the developer.

---

### GATE41-001: Health Score Formula Reconciliation (L5 vs L6)

**Source:** Gate 4.1 cross-reference report (gate41-xref-calls-L4Infra.md)
**Affects:** TDD-5 (tdd-5-reporter.md), TDD-6 (tdd-6-mcp.md)

**Decision:** The canonical health score formula is `verified / (verified + drifted)`. Uncertain and pending claims are excluded from both numerator and denominator. L6's `get_doc_health` tool was using `verified / (total_claims - pending)` which incorrectly included uncertain claims in the denominator. L6 updated to match L5's formula. L6 computes health inline via SQL (no L5 service call), but uses the same formula.

**Rationale:** The health score represents the "known truth rate" — of claims we can definitively assess, what fraction are correct? Including uncertain claims in the denominator penalizes repos for having claims that are inherently hard to verify (e.g., behavior claims needing semantic analysis). Since uncertain claims haven't been found to be wrong, excluding them gives a fairer metric.

**Alternatives considered:** (a) L6 calls L5.calculateHealthScore — rejected because L6's architecture is DB-direct with no service dependencies. (b) Use L6's formula everywhere — rejected because it conflates "haven't checked yet" with "might be wrong."

---

### GATE41-002: L4 → Infra.createAgentTasks API Shape Alignment

**Source:** Gate 4.1 cross-reference report (gate41-xref-calls-L4Infra.md)
**Affects:** TDD-4 (tdd-4-triggers.md), TDD-Infra (tdd-infra.md)

**Decision:** L4's pseudocode was using two nonexistent helpers (`createAgentTask` singular + `batchInsertAgentTasks`) that do not match Infra's actual API. Updated L4 to build an array of `{ type, payload }` objects and call `Infra.createAgentTasks(repoId, scanRunId, tasks)` which matches Infra's Section 4.3 signature exactly. `repo_id` and `scan_run_id` are passed as top-level positional args, not embedded in each task object.

**Rationale:** Infra owns the database layer and defines the canonical API shape. L4 must call what Infra exposes.

---

### GATE41-003: L4 → L2.removeMappingsForFiles Type Fix

**Source:** Gate 4.1 cross-reference report (gate41-xref-calls-L4Infra.md)
**Affects:** TDD-4 (tdd-4-triggers.md)

**Decision:** L4's pseudocode passed `classified.deletions` (a `FileChange[]`) directly to `L2.removeMappingsForFiles`, which expects `string[]` (plain file paths). Updated to `classified.deletions.map(f => f.filename)`.

---

### GATE41-004: Cross-Layer Index Reconciliation (L0, L2, L3)

**Source:** Gate 4.1 cross-reference report (gate41-xref-calls-L0L3.md)
**Affects:** TDD-0, TDD-2, TDD-3

**Decision:** Fixed stale and incomplete cross-layer indexes:
- **TDD-2:** Removed `scriptExists` and `getEntityByFile` from L0 consumption list (neither is called by any L2 algorithm). Added `searchRoutes` to cross-layer index (was called but omitted from index).
- **TDD-3:** Added `getFileTree` to cross-layer index (was called in Appendix C but omitted).
- **TDD-0:** Updated Section 2.2 to accurately reflect L2's consumption (`searchRoutes` added, `scriptExists` removed) and L3's consumption (added `searchRoutes`, `getAvailableScripts`, `getFileTree`). Updated cross-layer index to match.

---

### GATE41-005: L5 Phantom L7.isClaimSuppressed Dependency Removed

**Source:** Gate 4.1 cross-reference report (gate41-xref-calls-L4Infra.md)
**Affects:** TDD-5 (tdd-5-reporter.md)

**Decision:** Removed `L7.isClaimSuppressed(claim)` from L5's Section 2.1 dependency table. L5 never calls this function in any Section 4 algorithm — suppression filtering is L4's responsibility. L5 receives already-filtered findings. Also corrected L5 Section 2.2 to note that L6 does not call `calculateHealthScore` (L6 computes health inline via DB query).

---

### GATE41-006: DOCALIGN_E106/E108 Disambiguation

**Source:** Gate 4.1 cross-reference report (gate41-xref-types-errors.md)
**Affects:** TDD-Infra (tdd-infra.md), TDD-4 (tdd-4-triggers.md)

**Decision:** `DOCALIGN_E106` retains its meaning as "clone failure" (used by TDD-4). Webhook JSON parse failure in TDD-Infra reassigned to `DOCALIGN_E108`. Both are in the E1xx (GitHub API Errors) category.

---

### GATE42-001: Clean PRs Post Full-Format Summary Comment

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 2.2, 2.3)

**Decision:** Zero-finding and no-claims-in-scope PRs still receive a full-format summary comment (header, health line, footer). Rationale: developers need confirmation that DocAlign ran and completed, not just a silent Check Run.

---

### GATE42-002: Uncertain Claims Hidden from PR Output

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 2.1.3, health line, Appendix A)

**Decision:** Uncertain claims are NOT shown in PR comments. No collapsible section, no uncertain count in health line. Health line simplified to `{verified} verified | {drifted} drifted -- {score_pct}% health`. Uncertain claims remain available via MCP server and CLI. Rationale: uncertainty is our limitation, not the developer's problem. Show only actionable findings.

---

### GATE42-003: Check Run Non-Blocking by Default

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 3.2), phase4d-config-spec.md (check section)

**Decision:** Default Check Run conclusion for findings is `neutral` (non-blocking). New config key `check.block_on_findings` (boolean, default: `false`) added. When `true`, `min_severity_to_block` determines which severity triggers `action_required`. Rationale: false positive rate not yet validated — blocking by default would damage trust.

---

### GATE42-004: Summary + Inline Review Comments with Suggestions from MVP

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 2.11)

**Decision:** Both summary comment and ~~inline review comments with GitHub `suggestion` syntax are~~ included in MVP. One-click fix suggestions are the core differentiator — too valuable to defer. Summary comment provides overview; review comments provide actionable per-line fixes.

**Note:** Review comments deferred to post-MVP per GATE42-016.

---

### GATE42-005: No Reaction Feedback or Dismiss-All for MVP

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 4), tdd-5-reporter.md, tdd-7-learning.md

**Decision:** Reaction-based feedback (thumbs-up/down) and "Dismiss all" link are deferred to post-MVP. Primary feedback signals for MVP are implicit: "Apply suggestion" click = positive, suppress rule added = negative. Rationale: reaction usage is speculative; observe actual behavior first before building feedback infrastructure.

---

### GATE42-006: Health Score Shown in PR Comments

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 11, summary templates)

**Decision:** Repo-wide health score percentage remains in every PR summary comment. Rationale: awareness/viral value outweighs noise concern. Developers see repo health in every PR, encouraging documentation hygiene.

---

### GATE42-007: One-Time Welcome Line on First PR

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 8.4)

**Decision:** The first PR comment after installation includes a one-time welcome line introducing DocAlign. Exact text TBD during implementation, but should briefly explain what DocAlign does and how to interpret findings.

---

### GATE42-008: Resolved Findings — No Comment Editing

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 2.12)

**Decision:** When a previously drifted finding is resolved, old review comments are NOT edited with strikethrough. GitHub's native "outdated" handling collapses review comments on changed lines automatically. The new scan simply won't re-report the resolved finding. Simplifies implementation (no review comment ID tracking, no edit API calls).

---

### GATE42-009: Manual Trigger Model — `@docalign review`

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 2.0, 1.3), phase4d-config-spec.md (trigger section), tdd-4-triggers.md (webhook handler), tdd-infra.md (webhook routing)

**Decision:** Default scan trigger is **manual only** — developers comment `@docalign review` on a PR to trigger a scan. Auto-triggers (on_pr_open, on_push, on_ready_for_review) are available but disabled by default. New `trigger` config group added with 4 boolean keys. The `issue_comment.created` webhook is the primary trigger path. An `:eyes:` reaction acknowledges receipt. Initial full scan on installation still runs automatically. This positions DocAlign as a developer-controlled tool with zero noise by default, with opt-in automation for teams that want it.

---

### GATE42-010: Only `@docalign review` Command for MVP

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 2.0), tdd-4-triggers.md

**Decision:** Only one command is supported for MVP: `@docalign review`. No `@docalign ignore`, `@docalign status`, or `@docalign help`. Config file handles all other configuration. Ship one command perfectly, add more based on user demand.

---

### GATE42-011: New MCP Tool `get_docs_for_file` (Reverse Lookup)

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 5.5), tdd-6-mcp.md

**Decision:** Added a fifth MCP tool: `get_docs_for_file(file_path, include_verified?)`. Given a code file path, returns all documentation claims that reference it. This is the primary AI agent integration point — "before I change this file, what docs mention it?" Returns claim text, doc file/line, claim type, verification status, and mapping confidence. Uses L2 mapping data (reverse index lookup).

---

### GATE42-012: CLI is MVP, Not v2 — Potential Primary Distribution Channel

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 6), distribution strategy, architecture

**Decision:** CLI is promoted to MVP scope. Furthermore, the CLI may be the **primary distribution channel** — installable via agent skills (Claude Code skill, Cursor extension) — with the GitHub App as an optional integration rather than the sole entry point. This is TBD but the architecture must not assume GitHub-only distribution. CLI section relabeled from "v2 — Design Now" to "MVP".

---

### GATE42-013: "DocAlign" is a Working Title / Placeholder

**Source:** Gate 4.2 founder review
**Affects:** All spec files

**Decision:** "DocAlign" is not the final product name. All specs continue to use "DocAlign" as a readable working title. A canonical note has been added to the headers of phase4b, phase4c, and phase4d specs listing all strings to replace when the final name is decided: "DocAlign", "docalign", `.docalign.yml`, `@docalign`, `DOCALIGN_*` env vars, and `docalign/*` URLs.

---

### GATE42-014: Embedded Server Architecture Model

**Source:** Gate 4.2 founder review (inspired by OpenCode architecture analysis)
**Affects:** phase3-architecture.md, phase3-infrastructure.md, tdd-infra.md, phase4c-ux-specs.md (Section 6), phase4d-config-spec.md, distribution strategy

**Decision:** DocAlign adopts an **embedded server architecture** modeled after OpenCode:

1. **Embedded mode (default):** When a user runs `docalign scan` or `docalign check`, an embedded server starts automatically within the CLI process, runs the pipeline, and stops when the command completes. The user never sees or manages a server. Zero friction.

2. **Headless mode (opt-in):** `docalign serve` starts a persistent server that accepts HTTP requests, webhooks, and client connections. Used by teams that want GitHub App integration or shared state.

3. **Storage abstraction:** `StorageAdapter` interface supporting two backends:
   - **SQLite** (local/embedded mode) — zero infrastructure, file-based, works immediately.
   - **PostgreSQL** (headless/hosted mode) — for teams, shared state, GitHub App integration.

4. **Distribution:** Single binary (npm global install, curl installer, Homebrew). No Docker required for basic usage. Agent skills (Claude Code, Cursor) can install the CLI directly.

5. **GitHub App is optional:** The GitHub App + webhooks require headless server mode. It is an add-on for teams, not the primary entry point. The CLI is the primary product surface.

6. **Architecture layers unchanged:** The 8-layer pipeline (L0-L7) and infrastructure layer work identically in both modes. Only the storage backend and HTTP layer differ.

**Implications for existing TDDs:**
- TDD-Infra needs a new section for embedded mode and StorageAdapter interface
- TDD-4 (Change Triggers) webhook handling only applies in headless mode
- TDD-6 (MCP Server) connects to the same StorageAdapter (SQLite or PostgreSQL)
- Phase 3 architecture docs need updating for dual deployment model
- These updates are deferred to Phase 5 or an amendments pass — the TDDs remain valid for the headless/server path

---

### GATE42-015: Zero-Config First Run

**Source:** Gate 4.2 founder review
**Affects:** phase4c-ux-specs.md (Section 6), phase4d-config-spec.md (defaults)

**Decision:** First run requires only an LLM API key. Everything else auto-detected:
- Doc files: standard glob patterns (README.md, docs/**, etc.)
- Code files: everything except node_modules, .git, dist, etc.
- LLM: Anthropic if `ANTHROPIC_API_KEY` set, OpenAI if `OPENAI_API_KEY` set
- Storage: local SQLite at `~/.docalign/{repo-hash}/db.sqlite`, auto-created
- Config file: optional. Absent or empty `.docalign.yml` = all defaults.

No setup wizard, no `docalign init`, no registration. `npm install -g docalign && docalign scan` works immediately.

---

### GATE42-016: Defer Review Comments to Post-MVP

**Source:** Gate 5 founder review
**Affects:** phase4c-ux-specs.md (Section 2.11), tdd-5-reporter.md, phase5-integration-examples.md

**Decision:** Inline review comments with GitHub `suggestion` syntax are **deferred to post-MVP**. This reverses GATE42-004's scope (which included review comments in MVP). Rationale: the most common DocAlign scenario (code changed, docs not updated) means the doc file is NOT in the PR diff. GitHub's API rejects review comments on lines outside the diff, so the one-click suggestion only works in the minority case where the doc file is also modified. Instead of a feature that works sometimes, invest in "Apply all fixes" commit (GATE42-019) which works always.

**MVP PR output:** Summary comment only (with diff blocks showing fixes). No inline review comments.

---

### GATE42-017: Accuracy Targets Are Aspirational, Not Hard Launch Gates

**Source:** Gate 5 founder review
**Affects:** phase5-test-strategy.md (Sections 6, 10)

**Decision:** Accuracy thresholds in the test strategy are guidelines for monitoring and improvement, not hard launch blockers. The only hard invariant is **0% syntactic false positive rate** (which is a correctness bug, not a tuning issue). For all other metrics: if the product demonstrates genuine value during testing, a missed threshold won't block launch. Judgment call made during testing based on overall product quality.

---

### GATE42-018: Test Budget Approved (~$30-75/month)

**Source:** Gate 5 founder review
**Affects:** phase5-test-strategy.md (Section 8)

**Decision:** LLM testing costs approved: $0/PR (all mocked), $0.50-2.00/nightly, $5-15/weekly. ~$30-75/month total.

---

### GATE42-019: "Create Fix Commit" Button in MVP

**Source:** Gate 5 founder review
**Affects:** phase4c-ux-specs.md (new section), tdd-5-reporter.md, tdd-infra.md, phase5-integration-examples.md

**Decision:** The summary comment includes an **"Apply all fixes"** link. When clicked:
1. Server validates HMAC-signed URL
2. ~~Server checks that the clicking user has write access to the repo (GitHub API)~~ Per-user auth dropped in GATE42-025.
3. Server returns a confirmation page (GET); user clicks "Confirm" to POST (GATE42-029)
4. Server checks PR is still open (GATE42-028)
5. Server fetches the latest state of the PR branch
6. Server applies all fixes from the scan to the latest file contents
7. Server creates a commit on the PR branch authored by `docalign[bot]`
8. Server posts a confirmation comment on the PR

This replaces review comments as the primary fix UX. It's MORE powerful: works on any file (not just files in the diff), handles multi-line fixes, and applies all fixes atomically in one commit.

**Commit details:** Author `docalign[bot] <noreply@docalign.dev>`, message `docs: fix documentation drift detected by DocAlign`.

**Error handling:** If the doc text has changed since the scan (new commits modified the doc file), the fix fails gracefully with a comment explaining why.

---

### GATE42-020: Synthetic Repos Only for MVP Testing

**Source:** Gate 5 founder review
**Affects:** phase5-test-strategy.md (Section 9)

**Decision:** Drop all 5 public repos (express, fastify, fastapi, flask, next.js) from MVP test fixtures. Ship with 2 synthetic repos only (Node.js + Python) with fully controlled ground truth. Add real-world repos post-launch based on user feedback. Rationale: ground-truth labeling of 250-500 claims across 5 public repos is too much work for a solo founder shipping in 2-4 weeks.

---

### GATE42-021: Uncertain Claims Hidden Everywhere (Including CLI)

**Source:** Gate 5 founder review
**Affects:** phase4c-ux-specs.md (Section 6), phase5-integration-examples.md

**Decision:** Uncertain claims are hidden from ALL user-facing surfaces: PR comments, CLI output, Check Run summary. Consistent across all surfaces. The MCP server is the only place uncertain claims are accessible (for AI agents that want full context). Rationale: uncertainty is our limitation, not the developer's problem.

---

### GATE42-022: "Apply All Fixes" Single Link for MVP

**Source:** Gate 5 founder review
**Affects:** phase4c-ux-specs.md (fix-commit section), tdd-5-reporter.md

**Decision:** MVP includes a single "Apply all fixes" link at the bottom of the summary comment. One click → one commit → all drifted docs fixed. Per-finding granular "Apply this fix" links are deferred to v2. Rationale: simpler to build (one endpoint, one commit), and the batch UX is actually better (less noise, atomic fix).

---

### GATE42-023: Fix Commit Mechanics

**Source:** Gate 5 founder review
**Affects:** tdd-5-reporter.md, tdd-infra.md

**Decision:**
- **Author:** `docalign[bot] <noreply@docalign.dev>` (GitHub App bot identity)
- **Message:** `docs: fix documentation drift detected by DocAlign`
- **Branch:** PR head branch. Server fetches latest branch state before applying.
- **Re-application:** If branch has new commits since scan, server reads latest file contents and applies fixes to the current state. If the specific text to fix has changed (doc was edited), the fix fails gracefully.
- **Confirmation:** After successful commit, DocAlign posts a comment: "Applied {N} documentation fixes in commit {sha}."
- **Failure:** If any fix cannot apply, DocAlign posts a comment explaining which fixes failed and why.

---

### GATE42-024: HMAC-Signed URL + Write-Access Check for Fix Endpoint

**Source:** Gate 5 founder review
**Affects:** tdd-infra.md, phase3-security.md

**Decision:** The "Apply all fixes" URL is HMAC-signed: `GET /api/fix/apply?repo={repo_id}&scan_run_id={scan_run_id}&token={hmac}` where HMAC = `HMAC-SHA256(DOCALIGN_API_SECRET, repo_id + ":" + scan_run_id)`. ~~Server-side, the endpoint checks that the requesting user (via GitHub OAuth or installation token) has write access to the repository.~~ Per-user auth check dropped in GATE42-025; HMAC is the sole security layer for MVP.

---

### GATE42-025: Drop Per-User Auth Check for Fix Endpoint (MVP)

**Source:** Gate 5 review round 2
**Affects:** phase5-integration-examples.md (IE-04), phase4c-ux-specs.md (Section 2.13), tdd-infra.md

**Decision:** No OAuth or per-user authorization check for the "Apply all fixes" endpoint in MVP. The HMAC token is the sole security layer — it proves the link was generated by DocAlign for a specific scan. Anyone who can see the PR comment can click the link.

**Rationale:** Adding OAuth (GitHub login flow, session management, cookie handling) would add 3-5 days of infrastructure work for minimal security benefit. For private repos, only collaborators can see the PR comment. For public repos, the risk is low: the commit is clearly from `docalign[bot]`, the content matches the summary comment diff blocks, and branch protections still apply. Per-user auth can be added post-MVP.

**Reverses:** The "write-access check" portion of GATE42-024. HMAC validation remains.

---

### GATE42-026: Canonical Fix Endpoint Domain

**Source:** Gate 5 review round 2
**Affects:** phase5-integration-examples.md (all IE examples), phase4c-ux-specs.md

**Decision:** The fix endpoint is hosted at `https://app.docalign.dev/api/fix/apply?...`. All examples and specs use `app.docalign.dev` consistently.

---

### GATE42-027: HMAC Tokens Have No Expiry

**Source:** Gate 5 review round 2
**Affects:** phase5-integration-examples.md (IE-04), tdd-infra.md

**Decision:** HMAC tokens are deterministic and do not expire. The `old_text` matching in the fix application step is the safety net — if the documentation has changed since the scan, the fix fails gracefully with an explanatory comment. No time-based or scan-based expiry for MVP.

**Operational note:** `DOCALIGN_API_SECRET` is a high-value secret. Store in environment variables only (never in config files or logs). Rotation invalidates all outstanding fix links across all repos — this is expected and acceptable. Log every fix-apply attempt (success/failure) with timestamp and scan_run_id for audit purposes.

---

### GATE42-028: Reject Fix Applications on Merged/Closed PRs

**Source:** Gate 5 review round 2
**Affects:** phase5-integration-examples.md (IE-04), phase4c-ux-specs.md (Section 2.13), tdd-infra.md

**Decision:** The fix endpoint checks whether the PR is still open before applying fixes. If the PR is merged or closed, the server returns HTTP 400 with message: "This PR is no longer open. Fixes cannot be applied."

---

### GATE42-029: Fix Endpoint Uses GET→Confirmation Page→POST Flow

**Source:** Gate 5 review round 2
**Affects:** phase5-integration-examples.md (IE-04), phase4c-ux-specs.md (Section 2.13), tdd-infra.md

**Decision:** The "Apply all fixes" link (GET) does NOT directly mutate state. Instead:
1. GET validates the HMAC and returns a confirmation HTML page showing "Apply {N} fixes to PR #{number} on {owner}/{repo}?"
2. The user clicks "Confirm" which sends a POST with the same parameters.
3. The POST re-validates HMAC, checks PR state, applies fixes, creates commit, posts comment.
4. The POST response shows a success/error result page.

**Rationale:** A GET that mutates state violates REST conventions and is vulnerable to link prefetchers (Slack, browser, crawlers) accidentally triggering fix commits. The confirmation page adds minimal implementation cost (one HTML template) and prevents this class of bugs.

---

### GATE42-030: `docalign fix` CLI Command in MVP

**Source:** Gate 5 review round 2
**Affects:** phase4c-ux-specs.md (Section 6), tdd-infra.md

**Decision:** `docalign fix <file>` is an MVP CLI command. It reads stored fixes from the local SQLite database (from a prior `docalign check` or `docalign scan` run) and applies them as local file writes. No GitHub API calls needed — it's purely local. This is the CLI equivalent of the "Apply all fixes" web flow.

---

### GATE42-031: No Double-Click/Idempotency Protection for Fix Endpoint (MVP)

**Source:** Gate 5 review round 2
**Affects:** phase5-integration-examples.md (IE-04)

**Decision:** If a user clicks "Confirm" twice on the fix confirmation page, the second POST will find that `old_text` has already been replaced. All fixes "fail" and the server posts "Could not apply any fixes. The documentation has changed since the scan." This is slightly confusing but harmless — the developer can see the fix commit already exists in the PR timeline. Proper idempotency detection (checking if `new_text` already exists) is deferred to post-MVP.

---

### GATE42-032: Health Score Zero-Denominator Displays "Scanning..."

**Source:** Gate 5 review round 4 (10-reviewer audit)
**Affects:** phase5-test-strategy.md (Section 3.5), phase4c-ux-specs.md (Section 11.3)

**Decision:** When `verified + drifted = 0` (all claims are pending or uncertain), the health score is `null` (not `0`). The display shows "Scanning..." instead of a percentage. This applies to all surfaces: PR comments, CLI, MCP. The formula `verified / (verified + drifted)` is undefined when the denominator is zero; the system must handle this as a special case.

---

### GATE42-033: Health Line Included in "No Claims in Scope" Template

**Source:** Gate 5 review round 4 (10-reviewer audit)
**Affects:** phase4c-ux-specs.md (Section 2.3), phase5-integration-examples.md (IE-03)

**Decision:** The "No claims in scope" summary comment (Section 2.3) includes the health line (`**{verified_count} verified** | **{drifted_count} drifted** -- **{score_pct}% health**`) for consistency with all other summary comment templates. IE-03's golden example is correct; the Section 2.3 template was incomplete.

---

### GATE42-034: Finding Title Is a Generated Summary, Not Raw Truncation

**Source:** Gate 5 review round 4 (10-reviewer audit)
**Affects:** phase4c-ux-specs.md (Section 2.1.1, 2.1.2), phase5-integration-examples.md (IE-02)

**Decision:** The `{brief_mismatch}` field in finding block headers and summary table rows is a short (under 80 chars) human-readable summary generated by the reporter from the finding data. It is NOT a raw truncation of the `specific_mismatch` field. Example: `"POST /api/users response status and body changed"` (generated summary) rather than `"Documentation says '201 Created with { id, email, created_at }' but code returns..."` (raw truncation). This produces better UX in PR comments.

---

### GATE42-035: `{total_checked}` Is Scan-Scope Count

**Source:** Gate 5 review round 4 (10-reviewer audit)
**Affects:** phase4c-ux-specs.md (Section 2.2 placeholder table)

**Decision:** The `{total_checked}` placeholder in the "Zero Findings" template (Section 2.2) equals `scan_run.claims_checked` — the number of claims evaluated in this specific scan, not the repo-wide total. "All **5 claims** verified" means 5 claims were in scope and all passed, not that the repo has only 5 claims.

---

### GATE42-036: "Apply All Fixes" Link Requires At Least One Generated Fix

**Source:** Gate 5 review round 4 (10-reviewer audit)
**Affects:** phase4c-ux-specs.md (Section 2.1.1, Section 2.13), phase5-test-strategy.md (L5 tests)

**Decision:** The "Apply all fixes" link appears in the summary comment only when at least one drifted finding has a generated fix (`suggested_fix` is not null). If all drifted findings lack fixes (e.g., fix generation failed or was skipped), the link is omitted. The link text reflects the actual fix count: "Apply {N} fixes" where N is the number of findings with generated fixes, not the total drifted count.
