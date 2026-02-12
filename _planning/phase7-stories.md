# Phase 7: Story Breakdown

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 7: Story & Task Breakdown
>
> **Inputs:** Approved epics (Phase 6), TDDs (Phase 4A), Prompt Specs (Phase 4B), UX Specs (Phase 4C), Config Spec (Phase 4D), Integration Examples (Phase 5A), Test Strategy (Phase 5B), API Contracts, Decisions Log
>
> **Date:** 2026-02-11

---

## Overview

21 stories across 9 epics. Each story is a 1-3 day deliverable that an agent team can complete in 2-5 sessions. Stories are ordered by dependency within each epic. Cross-epic dependencies are noted.

**Companion file:** `phase7-tasks.md` contains the per-task breakdown with exact file paths, function signatures, and done criteria.

---

## Epic E1: Infrastructure Foundation

### Story S1.1: Server Foundation + Storage Layer

**Description:** Set up the Express server with middleware stack, PostgreSQL connection pool with infrastructure tables and migrations, Redis + BullMQ queue, and the StorageAdapter interface with PostgreSQL adapter. This is the absolute foundation — nothing else can start until this works.

**Implements:** TDD-Infra Sections 3.1-3.3, 3.6, Appendices A-C; GATE42-014

**Acceptance Criteria:**
- Express server starts and responds to `GET /health` with `{ status: "ok" }`
- PostgreSQL pool connects; `repos`, `agent_tasks`, `scan_runs` tables created via migration
- Redis connects; BullMQ queue `docalign:scan` accepts and processes test jobs
- StorageAdapter interface defined; PostgreSQL adapter implements all methods
- Structured logging via pino-http on all requests
- Vitest test suite runs with test database

**Definition of Done:** `npm test` passes with health endpoint, BullMQ, and StorageAdapter CRUD tests green.

**Dependencies:** None (first story)

---

### Story S1.2: GitHub App Integration

**Description:** GitHub App webhook receiver with HMAC-SHA256 signature verification, event routing for all MVP events, GitHub auth (JWT generation, installation token creation with TTL cache), and DOCALIGN_TOKEN generation/validation.

**Implements:** TDD-Infra Sections 3.4-3.5, 4.1-4.2, Appendices D-E

**Acceptance Criteria:**
- Webhook endpoint at `POST /api/webhooks/github` verifies HMAC-SHA256 signatures
- Events routed: `installation.created`, `installation.deleted`, `installation_repositories`, `issue_comment.created`, `pull_request.opened/synchronize/reopened`
- `issue_comment.created` handler logs and acknowledges (stub for E4's TriggerService)
- JWT generation produces valid GitHub App JWT
- Installation token creation with 55-min TTL cache
- DOCALIGN_TOKEN generation (crypto.randomBytes) and validation

**Definition of Done:** All webhook signature tests pass; JWT generates valid token; installation token cache works; DOCALIGN_TOKEN round-trips correctly.

**Dependencies:** S1.1

---

### Story S1.3: API Endpoints + Deployment

**Description:** Agent Task API endpoints, dismiss endpoint, graceful shutdown, Railway deployment, and integration tests for all endpoints.

**Implements:** TDD-Infra Sections 4.3-4.10, Appendices F-H

**Acceptance Criteria:**
- `GET /api/tasks/pending` returns pending tasks for a repo (DOCALIGN_TOKEN auth)
- `GET /api/tasks/:id` returns task details
- `POST /api/tasks/:id/result` accepts agent results
- `GET /api/dismiss` dismisses a finding (query params: repo, claim_id, scan_run_id)
- SIGTERM triggers graceful shutdown (drain BullMQ, close DB/Redis)
- Railway deployment config (Procfile, env vars) works
- Integration tests cover all endpoints with test database

**Definition of Done:** All API endpoint tests pass; deployment config validated; graceful shutdown tested.

**Dependencies:** S1.2

---

## Epic E2: Data Pipeline — Index + Extraction

### Story S2.1: L0 Codebase Index

**Description:** Tree-sitter WASM integration for TS/JS/Python, entity extraction, file tree indexing, all L0 lookup APIs, pgvector semantic search, and incremental updates from git diff.

**Implements:** TDD-0 (full)

**Acceptance Criteria:**
- Tree-sitter WASM loads and parses TS, JS, Python files
- Entity extraction queries produce functions, classes, routes, types, configs
- `fileExists()`, `findSymbol()`, `searchSemantic()`, `findRoute()`, `searchRoutes()`, `getDependencyVersion()`, `scriptExists()`, `getAvailableScripts()`, `getEntityByFile()`, `getFileTree()`, `updateFromDiff()` all implemented
- pgvector index on `code_entities.embedding` column works with cosine similarity
- `code_entities` table created via migration
- Unit tests for all lookup functions with realistic fixtures

**Definition of Done:** All L0 unit tests pass with fixture repos covering TS, JS, Python.

**Dependencies:** S1.1

**Integration Examples:** IE-01, IE-02 (L0 intermediate outputs)

---

### Story S2.2: L1 Claim Extractor (Server-Side)

**Description:** Regex/heuristic extractors for all 10 claim types (server-side syntactic only), claim CRUD operations, deduplication, re-extraction on doc change.

**Implements:** TDD-1 Sections 3-4 (server-side portions)

**Acceptance Criteria:**
- Regex extractors for: path_reference, dependency_version, command, api_route, code_example (sub-claim decomposition), behavior, architecture, config, convention, environment
- `extractSyntactic()`, `reExtract()`, `deleteClaimsForFile()`, `getClaimsByFile()`, `getClaimsByRepo()`, `getClaimById()`, `updateVerificationStatus()` all implemented
- Deduplication: same claim text + source location = skip
- `claims` table created via migration
- Unit tests for each regex extractor with positive, negative, and edge-case inputs

**Definition of Done:** All L1 unit tests pass. Each extractor has ≥3 test cases (match, no-match, edge-case).

**Dependencies:** S2.1 (needs L0 for entity references in code_example sub-claims)

**Integration Examples:** IE-01, IE-02 (L1 intermediate outputs)

---

## Epic E3: Mapping + Deterministic Verification

### Story S3.1: L2 Code-to-Claim Mapper

**Description:** The full 3-step progressive mapping pipeline (Step 1 direct reference, Step 2 symbol search, Step 3 semantic search), reverse index query, mapping maintenance operations, deduplication, and Step 4 skip classification.

**Implements:** TDD-2 Sections 3-6

**Acceptance Criteria:**
- `mapClaim()` executes 3-step pipeline with per-claim-type strategy dispatch (TDD-2 Appendix A)
- `findClaimsByCodeFiles()` reverse index query works
- `updateCodeFilePaths()`, `removeMappingsForFiles()`, `refreshMapping()` work
- Deduplication: highest-confidence per (code_file, code_entity_id) pair (TDD2-001)
- Fuzzy route search: `similarity * 0.9`, threshold 0.7 (TDD2-002)
- Step 4 skip classification: keyword heuristic for `skipped_universal` vs `skipped_flow` (TDD2-005)
- `claim_mappings` table created via migration
- L7 stub: `getCoChangeBoost() → 0.0` via constructor DI
- Unit tests for each mapping step with realistic claim+code fixtures

**Definition of Done:** All L2 unit tests pass. `mapClaim()` produces correct mappings for path_reference, dependency_version, api_route, code_example claims.

**Dependencies:** S2.1, S2.2

**Integration Examples:** IE-01, IE-02 (L2 intermediate outputs)

---

### Story S3.2: L3 Deterministic Verification

**Description:** Tier 1 syntactic verification (all 5 verifiers), Tier 2 framework shell with conservative fallthrough, routing logic (Path 1 vs Path 2), Path 1 evidence assembly, result storage and merge.

**Implements:** TDD-3 Sections 3-6, Appendices A-D

**Acceptance Criteria:**
- `verifyDeterministic()` runs Tier 1 + Tier 2 pipeline
- Tier 1 verifiers: `verifyPathReference`, `verifyDependencyVersion`, `verifyCommand`, `verifyApiRoute`, `verifyCodeExample`
- Tier 2 framework shell returns `null` for most strategies (TDD3-001)
- `routeClaim()` classifies claims as Path 1 or Path 2 (token estimation, TDD3-003)
- `buildPath1Evidence()` extracts entity code for LLM prompt (TDD3-002)
- `storeResult()`, `mergeResults()`, `getLatestResult()` work
- `verification_results` table created via migration
- L7 stub: `isClaimSuppressed() → false` via constructor DI
- Unit tests for each Tier 1 verifier with realistic claim+code fixtures

**Definition of Done:** All L3 unit tests pass. Cross-layer integration test: L0→L2→L3 with fixture repo produces correct Tier 1 verification results.

**Dependencies:** S3.1

**Integration Examples:** IE-01 (L3 Tier 1 verification), IE-02 (L3 routing to Path 1/Path 2)

---

## Epic E4: Orchestration + PR Output (Vertical Slice)

### Story S4.1: L4 PR Scan Orchestration

**Description:** The core orchestration pipeline: `@docalign review` comment detection, BullMQ processor for PR scans, full 12-step pipeline, debounce, per-repo serialization, idempotency, cancellation, scan lifecycle management.

**Implements:** TDD-4 Sections 3-6

**Acceptance Criteria:**
- `enqueuePRScan()` and `enqueueFullScan()` create BullMQ jobs
- `processPRScan()` BullMQ processor executes the 12-step orchestration pipeline (TDD-4 §4.7)
- `@docalign review` comment detection: parse `issue_comment.created`, `:eyes:` reaction acknowledgment (GATE42-009)
- Debounce: 30s window via BullMQ `delay`
- Per-repo lock: BullMQ group concurrency 1
- Idempotency: webhook_delivery_id dedup
- Scan lifecycle: `scan_runs` CRUD (queued→running→completed/partial/failed/cancelled)
- Timeout: 10 min uniform per scan (TDD-4)
- Repository dispatch: trigger client's GitHub Action via `POST /repos/{owner}/{repo}/dispatches`
- L7 stub: `isClaimSuppressed() → false` via constructor DI

**Definition of Done:** Given a test `issue_comment.created` webhook with `@docalign review`, the pipeline produces a structured `ScanResult` using L0→L1→L2→L3 with fixture data.

**Dependencies:** S3.2 (needs all data layers), S1.2 (needs webhook handler)

---

### Story S4.2: L5 PR Output

**Description:** Summary comment formatting, Check Run creation and updates, health score calculation, markdown sanitization. No review comments (GATE42-016).

**Implements:** TDD-5 Sections 3-5

**Acceptance Criteria:**
- `postPRComment()` formats summary comment per UX Spec Section 2.1 (findings) and Section 2.2 (zero findings)
- "Apply all fixes" link included when ≥1 fix generated (GATE42-036)
- `calculateHealthScore()` uses GATE42-032 formula (verified / (verified + drifted)), zero-denominator → "Scanning..."
- Health score scope is scan-run count (GATE42-035)
- Check Run creation and updates per UX Spec Section 3.3
- `sanitizeForMarkdown()` prevents XSS per 3E-004
- PR comment posted via GitHub Issues API

**Definition of Done:** IE-01 produces correct PR summary comment with findings. IE-03 produces correct zero-findings comment.

**Dependencies:** S4.1

**Integration Examples:** IE-01 (full end-to-end syntactic), IE-03 (clean PR)

---

### Story S4.3: Full Scan + Onboarding + Edge Cases

**Description:** Full scan processor stub (for onboarding), installation webhook handler, cancellation logic, and end-to-end integration tests.

**Implements:** TDD-4 Section 4.9 (full scan stub), TDD-Infra Section 4.1-4.2 (installation)

**Acceptance Criteria:**
- `processFullScan()` stub: enqueues job, processes when Action connects
- Installation webhook handler: creates `repos` record, sets status to `awaiting_setup`, posts Check Run with setup instructions
- Cancellation: in-flight scans can be cancelled; cancelled jobs don't produce comments
- Onboarding integration test: install webhook → repo created → Check Run posted
- IE-01 full end-to-end integration test passes
- IE-03 full end-to-end integration test passes

**Definition of Done:** All E4 integration tests pass. Vertical slice works: `@docalign review` → pipeline → PR comment.

**Dependencies:** S4.2

**Integration Examples:** IE-01, IE-03

---

## Epic E5: GitHub Action + LLM Pipeline

### Story S5.1: Action Scaffold + Task Polling

**Description:** GitHub Action `action.yml`, workflow template, repository dispatch handler, task polling loop, DOCALIGN_TOKEN auth.

**Implements:** TDD-Infra Sections 4.3-4.6 (client-side), TDD-4 Section 4.7 (dispatch steps)

**Acceptance Criteria:**
- `action.yml` defines the GitHub Action with required inputs (api_key, docalign_token)
- Workflow template `docalign-scan.yml` triggers on `repository_dispatch`
- Task polling loop: `GET /api/tasks/pending` → process → `POST /api/tasks/:id/result`
- DOCALIGN_TOKEN auth header sent on all API calls
- Action receives a task and returns a mock result

**Definition of Done:** Action installs, receives a dispatched event, polls a task, and submits a mock result.

**Dependencies:** S1.3 (Agent Task API)

---

### Story S5.2: Prompt Implementations

**Description:** Implement all 4 prompts: P-EXTRACT (semantic claim extraction), P-TRIAGE (quick triage), P-VERIFY (Path 1 + Path 2 verification), P-FIX (fix generation). Each prompt has a dedicated implementation with JSON schema parsing, retry/fallback, and unit tests.

**Implements:** phase4b-prompt-specs.md Sections 2-6

**Acceptance Criteria:**
- P-EXTRACT: takes doc section, returns extracted claims with types and structured values
- P-TRIAGE: takes claim + basic context, returns quick classification (verified/drifted/uncertain/needs_deep)
- P-VERIFY Path 1: takes entity code + claim, returns verdict + reasoning + fix
- P-VERIFY Path 2: agent-delegated via Claude Code custom-command, returns verdict
- P-FIX: takes mismatch details, returns corrected documentation text
- JSON schema output parsing for each prompt
- Retry/fallback per prompt (prompt specs Section 10)
- Unit tests with mocked LLM responses for each prompt

**Definition of Done:** Each prompt produces correct output from mocked input. All prompt unit tests pass.

**Dependencies:** S5.1

---

### Story S5.3: Supporting Features + IE-02 Integration

**Description:** Embedding generation, project structure auto-detection, agent adapter for Claude Code, and full IE-02 end-to-end integration test.

**Implements:** TDD-Infra Section 4.6 (embeddings), TDD-3 Section 4.2 (Path 2), phase4b-prompt-specs.md Section 10 (retry)

**Acceptance Criteria:**
- Embedding generation: text-embedding-3-small, batch processing, submit to DocAlign API
- Auto-detect project structure: send file tree to LLM, receive `code_patterns.include`, submit to API
- Agent adapter: Claude Code integration for Path 2 (`claude -p` with custom-command)
- Retry/fallback: exponential backoff, model fallback chain
- IE-02 end-to-end integration test passes (semantic drift pipeline)

**Definition of Done:** IE-02 passes end-to-end with recorded agent task results.

**Dependencies:** S5.2, S4.2 (needs L5 output formatting)

**Integration Examples:** IE-02 (semantic drift end-to-end)

---

## Epic E6: Learning + Feedback

### Story S6.1: Feedback + Suppression System

**Description:** L7 core: feedback recording, quick-pick processing, count-based permanent exclusion, suppression rule creation and evaluation.

**Implements:** TDD-7 Sections 3-5

**Acceptance Criteria:**
- `recordFeedback()` persists feedback records (all FeedbackType values)
- `processQuickPick()` maps quick-pick reason to action, creates suppression rule
- Count-based exclusion: 2 silent thumbs-down on same claim → permanent exclusion (TDD-7 §4.3)
- `isClaimSuppressed()` checks suppression rules with scope precedence (claim > file > claim_type > pattern)
- `feedback` and `suppression_rules` tables created via migration
- Feedback endpoint: GitHub reaction webhook → `recordFeedback`
- Quick-pick endpoint
- Unit tests for each quick-pick reason→action mapping
- Unit tests for count-based exclusion threshold behavior

**Definition of Done:** Given 2 prior thumbs-down on a claim, `isClaimSuppressed()` returns true and the claim is filtered from scan results.

**Dependencies:** S1.1 (DB tables), S5.2 (feedback reactions require posted comments)

---

### Story S6.2: L4 Pipeline Integration

**Description:** Replace L7 stubs in L2, L4, L5 with real `isClaimSuppressed()` and `getCoChangeBoost()` (still returns 0.0 but through real L7 module). Integration test.

**Implements:** TDD-7 Section 5 (integration)

**Acceptance Criteria:**
- L4 pipeline calls real `isClaimSuppressed()` instead of stub
- L2 mapper calls real `getCoChangeBoost()` (returns 0.0 — co-change deferred to v2)
- Suppressed claims are filtered from scan results
- Integration test: suppressed claim does not appear in PR comment

**Definition of Done:** Full pipeline with suppression filtering works. Suppressed claims excluded from output.

**Dependencies:** S6.1, S4.1 (L4 pipeline)

---

## Epic E7: Fix Application + Configuration

### Story S7.1: Configuration System

**Description:** `.docalign.yml` parsing with `loadConfig()`, sensible defaults, validation, dependency injection of config to all layers.

**Implements:** phase4d-config-spec.md (full)

**Acceptance Criteria:**
- `loadConfig()` reads `.docalign.yml`, shallow merge over hardcoded defaults
- Wrong type → warn and use default
- Config object accessible to all layers via dependency injection
- Keys: `code_patterns`, `doc_patterns`, `claim_types`, `mapping_threshold`, `debounce`, `max_claims_per_pr`, `min_severity`, `check_conclusion`
- Unit tests: valid file, missing file, invalid values, partial config

**Definition of Done:** Config loading tests pass with all edge cases.

**Dependencies:** S1.1

---

### Story S7.2: Fix-Commit Flow

**Description:** The "Apply all fixes" feature: GET confirmation page, POST apply via Git Trees API, HMAC auth, path traversal validation, $-pattern safety.

**Implements:** GATE42-019/022/023/024/025/027/028/029 decisions, IE-04

**Acceptance Criteria:**
- `GET /api/fix/confirm?repo={repo}&scan_run_id={id}&token={hmac}` returns HTML confirmation page
- Confirmation page: repo name, scan details, fix count, POST form, security headers (X-Frame-Options, CSP, Referrer-Policy)
- `POST /api/fix/apply` validates HMAC → checks PR still open (GATE42-028) → loads fixes → path traversal validation → creates Git Tree + commit via GitHub API
- HMAC generation: `crypto.createHmac('sha256', secret)` on `{repo}:{scan_run_id}`
- $-pattern safety: `() => fix.new_text` replacer function
- Success/partial/failure PR comment per UX Specs Section 2.11/2.12/2.13
- IE-04 integration test passes

**Definition of Done:** IE-04 passes end-to-end (full success, partial success, full failure scenarios).

**Dependencies:** S4.2 (fix links in PR comments), S1.2 (GitHub API auth)

**Integration Examples:** IE-04 (fix-commit flow)

---

## Epic E8: MCP Server (POST-MVP-v2)

### Story S8.1: MCP Server Core

**Description:** MCP server process with stdio transport, repo resolution from `.git` remote, all 5 tools implemented, read-only connection default.

**Implements:** TDD-6 (full)

**Acceptance Criteria:**
- MCP server process: `npx @docalign/mcp-server --repo <path>`
- Stdio transport via `@modelcontextprotocol/node` NodeStdioServerTransport
- Repo resolution: `.git/config` → extract remote URL → match to `repos` table
- `get_docs`: keyword + semantic search over claims
- `get_docs_for_file`: all claims and verification status for a file path
- `get_doc_health`: file/directory/repo health score
- `list_stale_docs`: drifted/uncertain claims sorted by severity
- `report_drift` (v3 stub): insert into `agent_drift_reports`
- Read-only connection: `SET default_transaction_read_only = ON`

**Definition of Done:** All 5 tools return correct results from fixture data. Integration test with Claude Code MCP client.

**Dependencies:** S1.1 (database schema populated by MVP pipeline)

---

## Epic E9: CLI + SQLite Adapter

### Story S9.1: SQLite Adapter

**Description:** Implement `StorageAdapter` interface with better-sqlite3. Parameterized test suite ensuring both backends produce identical results.

**Implements:** GATE42-014 (StorageAdapter), test strategy Section 2.1

**Acceptance Criteria:**
- SQLite adapter implements full `StorageAdapter` interface using better-sqlite3
- All migrations run against SQLite (adapted DDL where needed — e.g., no pgvector, use JSON for embeddings)
- Parameterized test suite: every storage-touching test runs against both PostgreSQL and SQLite
- Both backends produce identical results for all CRUD operations

**Definition of Done:** Parameterized test suite passes against both backends.

**Dependencies:** S1.1 (StorageAdapter interface)

---

### Story S9.2: CLI Commands

**Description:** Three CLI commands — `docalign check` (deterministic-only), `docalign scan` (full pipeline with local LLM), `docalign fix` (apply stored fixes). Output formatting per UX Specs.

**Implements:** GATE42-012, GATE42-030, UX Specs Sections 5-6

**Acceptance Criteria:**
- `docalign check`: local deterministic-only scan (Tiers 1-2), exit codes (0=clean, 1=drift, 2=error)
- `docalign scan`: full scan with local LLM calls, progress indicators
- `docalign fix`: apply fixes to local files
- Output formatting: color/formatting per UX Specs Section 5
- CLI argument parsing with help text
- Integration tests with SQLite backend

**Definition of Done:** All 3 CLI commands work end-to-end with SQLite. Exit codes correct.

**Dependencies:** S9.1 (SQLite adapter), S6.2 (needs all domain layers complete)

---

## Story Dependency Graph

```
S1.1 ──────┬──────────────────────────────────────────────────────────────────────
           │
           ├── S1.2 ── S1.3
           │
           ├── S2.1 ── S2.2 ── S3.1 ── S3.2 ── S4.1 ── S4.2 ── S4.3
           │                                              │
           ├── S7.1 (config, parallel)                    ├── S7.2 (fix)
           │                                              │
           ├── S9.1 (SQLite, parallel)                    ├── S5.1 ── S5.2 ── S5.3
           │                                              │
           └── S8.1 (MCP, post-MVP)                       └── S6.1 ── S6.2
                                                                    │
                                                               S9.2 (CLI)
```

**Critical path:** S1.1 → S1.2 → S1.3 → S2.1 → S2.2 → S3.1 → S3.2 → S4.1 → S4.2 → S4.3 → S5.1 → S5.2 → S5.3 → S6.1 → S6.2

**Parallelizable from S1.1:** S7.1 (config), S9.1 (SQLite adapter)
**Parallelizable from S4.1:** S5.1 (Action scaffold), S7.2 (fix-commit)

---

## Integration Example Coverage Matrix

| IE | Stories That Must Pass It |
|----|--------------------------|
| IE-01 (syntactic drift) | S4.2, S4.3 |
| IE-02 (semantic drift) | S5.3 |
| IE-03 (clean PR) | S4.2, S4.3 |
| IE-04 (fix-commit) | S7.2 |
