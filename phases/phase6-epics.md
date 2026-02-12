# Phase 6: Epic Definition

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 6: Epic Definition
>
> **Inputs:** All approved docs -- PRD, ADD (Phase 3A-3E), TDDs (Phase 4A), Prompt Specs (Phase 4B), UX Specs (Phase 4C), Config Spec (Phase 4D), Integration Examples (Phase 5A), Test Strategy (Phase 5B), API Contracts, Decisions Log
>
> **Working title:** "DocAlign" is a placeholder name. See phase4c-ux-specs.md header for the full list of strings to replace when the final name is decided.
>
> **Date:** 2026-02-11

---

## Overview

9 epics total: 8 MVP, 1 POST-MVP-v2. The build is organized around a **critical path to first vertical slice** -- after Epics 1-4, a PR with syntactic-only claims produces a real PR comment with drift findings, fully deterministic, zero LLM calls. Epics 5-7 add the LLM pipeline, learning loop, and fix application. Epic 9 adds the CLI + SQLite adapter (GATE42-012).

| Epic | Title | MVP Status | Vertical Slice | Depends On | Agent Sessions | Critical Path |
|------|-------|:----------:|:--------------:|------------|:--------------:|:-------------:|
| E1 | Infrastructure Foundation | MVP | No | -- | 9-14 | 5 days |
| E2 | Data Pipeline: Index + Extraction | MVP | No | E1 | 6-10 | 4 days |
| E3 | Mapping + Deterministic Verification | MVP | No | E2 | 6-10 | 4 days |
| E4 | Orchestration + PR Output | MVP | **Yes** | E3 | 8-12 | 5 days |
| E5 | GitHub Action + LLM Pipeline | MVP | No | E1, E4 | 8-12 | 4 days |
| E6 | Learning + Feedback | MVP | No | E1, E5 | 2-4 | 2 days |
| E7 | Fix Application + Configuration | MVP | No | E1 (config), E4 (fix) | 4-6 | 3 days |
| E8 | MCP Server | POST-MVP-v2 | No | E1 | 3-5 | 2 days |
| E9 | CLI + SQLite Adapter | MVP | No | E1-E6 | 4-6 | 3 days |

**MVP total:** 48-74 agent sessions, ~25-day critical path (E1→E2→E3→E4→E5→E6, with E7 and E9 parallel). Plan for 5-6 weeks with review buffer.

> **Timeline reality check:** The critical path is strictly sequential (each epic depends on the previous). A solo founder reviewing agent output creates a serial bottleneck. The 25-day estimate assumes zero debugging, zero rework, and immediate reviews. Budget 20% buffer.

---

## Dependency Graph

```
E1: Infrastructure Foundation
 │
 ├──────────────────────────────────────────────┐
 │                                              │
 ▼                                              │
E2: Data Pipeline (L0 + L1)                     │
 │                                              │
 ▼                                              │
E3: Mapping + Verification (L2 + L3)            │
 │                                              │
 ▼                                              │
E4: Orchestration + PR Output (L4 + L5)         │
 │         │                                    │
 │         ├─────────────────┐                  │
 │         │                 │                  │
 ▼         ▼                 ▼                  │
E5: Action + LLM       E7: Fix + Config    (parallel)
 │
 ▼
E6: Learning + Feedback
 │                          E9: CLI + SQLite (Part A parallel, Part B after E6)
 │
 │  MVP complete ─────────────────────────────────
 │
 └─── E8: MCP Server (v2)
```

**Critical path (MVP):** E1 → E2 → E3 → E4 → E5 → E6

**Parallelizable:**
- E7 config parsing can start after E1 (no dependency on E4); fix-commit portion starts after E4
- E5 skeleton (Action repo, task polling) can start after E1; full integration needs E4
- E6 data layer (DB tables, CRUD) can start after E1; full integration needs E5
- E9 SQLite adapter (Part A) can start after E1; CLI commands (Part B) need E1-E6
- E8 (MCP Server) starts after MVP is stable

**L7 stub requirement:** Layers L2, L4, and L5 call L7 (Learning) functions, but L7 is built in E6. Until E6 is complete, all L7 calls use stubs injected via constructor dependency injection:
- `getCoChangeBoost()` → returns `0.0` (no co-change data; co-change tracking deferred to v2)
- `isClaimSuppressed()` → returns `false` (no suppression rules exist yet)

---

## Epic E1: Infrastructure Foundation

- **Scope:** Express API server, PostgreSQL schema + migrations, Redis + BullMQ queue, GitHub App registration and webhook handling, GitHub auth (JWT + installation tokens + caching), Agent Task API endpoints, DOCALIGN_TOKEN generation/validation, dismiss endpoint, health endpoint, graceful shutdown, structured logging (pino), deployment to Railway. **StorageAdapter interface** (GATE42-014): abstract data access behind an interface so all subsequent epics write portable queries from the start. PostgreSQL adapter is the primary implementation. This is the backbone upon which all domain layers operate.
- **Components:** TDD-Infra (Sections 3-7, Appendices A-H), phase4-decisions.md (GATE42-014: StorageAdapter)
- **Prompts:** None
- **Depends On:** --
- **Blocks:** E2, E3, E4, E5, E6, E7, E8, E9
- **Sizing:** 9-14 agent sessions, 5 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** No (foundation only, no domain logic)

### Key Deliverables

1. Express server with middleware stack (pino-http, error handler, JSON body parser)
2. **StorageAdapter interface** (GATE42-014): TypeScript interface abstracting all data access. PostgreSQL adapter as primary implementation. All subsequent epics write against this interface.
3. PostgreSQL connection pool, **infrastructure tables** (repos, agent_tasks, scan_runs) + migration framework (node-pg-migrate). Domain tables are added by subsequent epics via new migrations.
4. Redis connection + BullMQ queue (`docalign:scan`) with named processors
5. GitHub App webhook receiver: signature verification (HMAC-SHA256), event routing (`installation.created`, `installation.deleted`, `installation_repositories`, `issue_comment.created`, `pull_request.opened/synchronize/reopened`). Note: `issue_comment.created` handler routes `@docalign review` to TriggerService (E4); until E4 is built, the handler logs and acknowledges only.
6. GitHub auth: JWT generation, installation token creation + TTL cache (55 min)
7. Agent Task API: `GET /api/tasks/pending`, `GET /api/tasks/:id`, `POST /api/tasks/:id/result` with DOCALIGN_TOKEN auth
8. Dismiss endpoint: `GET /api/dismiss` with query params
9. Health endpoint: `GET /health`
10. SIGTERM graceful shutdown (drain BullMQ, close connections)
11. Railway deployment config (Procfile, env vars)
12. Test infrastructure: Vitest setup, test database configuration, GitHub App registration checklist
13. Unit tests + integration tests for all endpoints

### Recommended Agent Session Split

- **Sessions 1-4:** Express server, middleware, health endpoint, PostgreSQL + migrations, Redis + BullMQ, StorageAdapter interface + PostgreSQL adapter. Done signal: health endpoint responds, BullMQ processes a test job, StorageAdapter CRUD works.
- **Sessions 5-7:** GitHub App webhooks, auth (JWT, installation tokens, cache), DOCALIGN_TOKEN. Done signal: webhook signature verifies, JWT generates valid token.
- **Sessions 8-10:** Agent Task API endpoints, dismiss endpoint, deployment, integration tests. Done signal: all endpoint tests pass, Railway deploys.

### Integration Example Coverage

None directly. E1 provides infrastructure tested by E4's integration examples.

---

## Epic E2: Data Pipeline -- Index + Extraction

- **Scope:** Layer 0 (Codebase Index) and Layer 1 (Claim Extractor, syntactic extraction only). Build the foundational data layers: AST parsing via tree-sitter WASM for TS/JS/Python, file tree indexing, entity extraction (functions, classes, routes, types, configs), package metadata parsing (package.json, requirements.txt, Cargo.toml, go.mod), semantic search via pgvector, incremental updates from git diff. Layer 1: doc file discovery, syntactic regex extraction for all 10 claim types (path_reference, dependency_version, command, api_route, code_example, behavior, architecture, config, convention, environment), claim CRUD, deduplication, re-extraction on doc change.
- **Components:** TDD-0 (full), TDD-1 (Sections 3-4 server-side, excluding semantic extraction task creation)
- **Prompts:** None (all deterministic)
- **Depends On:** E1
- **Blocks:** E3, E5
- **Sizing:** 6-10 agent sessions, 4 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** No (data layer, no user-facing output yet)
- **Migrations:** Adds `code_entities` and `claims` tables.

### Key Deliverables

1. **L0:** tree-sitter WASM integration (TS/JS/Python grammars), entity extraction queries per language
2. **L0:** `fileExists()`, `findSymbol()`, `searchSemantic()`, `findRoute()`, `searchRoutes()`, `getDependencyVersion()`, `scriptExists()`, `getAvailableScripts()`, `getEntityByFile()`, `getFileTree()`, `updateFromDiff()`
3. **L0:** pgvector index for `code_entities.embedding` column, cosine similarity search
4. **L1:** Regex/heuristic extractors for each claim type: path patterns, version patterns, command patterns, route patterns, code_example sub-claim decomposition (import paths, function/class names, syntax)
5. **L1:** `extractSyntactic()`, `reExtract()`, `deleteClaimsForFile()`, `getClaimsByFile()`, `getClaimsByRepo()`, `getClaimById()`, `updateVerificationStatus()`
6. **L1:** Deduplication logic (same claim text + source location = skip)
7. Unit tests for all L0 lookup functions with realistic fixtures
8. Unit tests for all regex extractors with positive, negative, and edge-case inputs

### Integration Example Coverage

- IE-01 L0 and L1 outputs (intermediate layer data)
- IE-02 L0 and L1 outputs (semantic claims stored from prior full scan fixtures)

---

## Epic E3: Mapping + Deterministic Verification

- **Scope:** Layer 2 (Code-to-Claim Mapper, Steps 1-3) and Layer 3 (Verification Engine, server-side deterministic components). L2: progressive 3-step mapping pipeline (Step 1 direct reference, Step 2 symbol search, Step 3 semantic search; Step 4 skipped in MVP per TDD2-005), reverse index for change-triggered scanning, mapping maintenance (rename, delete, refresh). L3: Tier 1 syntactic verification (file existence, dependency version comparison, command/script existence, route matching, code_example sub-claim checks), routing logic (`routeClaim`), Path 1 evidence assembly (`buildPath1Evidence`), result storage and merge. Tier 2 framework shell with conservative fallthrough (most strategies return `null` per TDD3-001; full Tier 2 implementation deferred to v2).
- **Components:** TDD-2 (Sections 3-6), TDD-3 (Sections 3-6, Appendices A-D)
- **Prompts:** None (all deterministic)
- **Depends On:** E2
- **Blocks:** E4
- **Sizing:** 6-10 agent sessions, 4 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** No (data processing, no user-facing output yet)
- **Migrations:** Adds `claim_mappings` and `verification_results` tables.
- **L7 Stubs:** `LearningService` is stubbed via constructor injection: `getCoChangeBoost() → 0.0`, `isClaimSuppressed() → false`. Stubs are replaced when E6 provides the real implementation.

### Key Deliverables

1. **L2:** `mapClaim()` -- full 3-step pipeline with per-claim-type strategy dispatch (Appendix A)
2. **L2:** `findClaimsByCodeFiles()` -- reverse index query, the key primitive for change-triggered scanning
3. **L2:** `updateCodeFilePaths()`, `removeMappingsForFiles()`, `refreshMapping()` -- maintenance operations
4. **L2:** Deduplication (TDD2-001): highest-confidence per (code_file, code_entity_id) pair
5. **L2:** Fuzzy route search confidence scaling (TDD2-002): `similarity * 0.9`, threshold 0.7
6. **L2:** Step 4 skip classification: `skipped_universal` vs `skipped_flow` keyword heuristic (TDD2-005)
7. **L3:** `verifyDeterministic()` -- Tier 1 syntactic checks + Tier 2 framework shell (conservative fallthrough)
8. **L3:** Tier 1 verifiers: `verifyPathReference`, `verifyDependencyVersion`, `verifyCommand`, `verifyApiRoute`, `verifyCodeExample`
9. **L3:** `routeClaim()` -- Path 1 vs Path 2 routing decision (token estimation, TDD3-003)
10. **L3:** `buildPath1Evidence()` -- entity extraction, formatting for LLM prompt (TDD3-002)
11. **L3:** `storeResult()`, `mergeResults()`, `getLatestResult()`
12. Unit tests for each mapping step and Tier 1 verifier with realistic claim+code fixtures
13. Cross-layer integration tests: L0→L2→L3 with fixture repos

### Integration Example Coverage

- IE-01 L2 and L3 outputs (mapping + Tier 1 syntactic verification)
- IE-02 L2 and L3 outputs (mapping + routing to Path 1/Path 2)

---

## Epic E4: Orchestration + PR Output (Vertical Slice)

- **Scope:** Layer 4 (Change Triggers -- PR scan pipeline) and Layer 5 (Report & Fix Generation). L4: PR webhook processing (on `@docalign review` comment, per GATE42-009), BullMQ worker processors, full orchestration pipeline (scope resolution → L0 update → L1 extraction → L2 mapping → L2 reverse index → L3 verification → L5 reporting), debounce (30s), per-repo serialization (BullMQ concurrency 1), idempotency (webhook delivery ID), cancellation, scan lifecycle management (scan_runs CRUD), onboarding flow (installation webhook handler + full scan stub). L5: `postPRComment()` for summary comment formatting (UX Specs Section 2.1/2.2/2.3), Check Run creation and updates (Section 3.3), health score calculation (GATE42-032: verified / (verified + drifted), zero-denominator → "Scanning..."), markdown sanitization (3E-004). Review comments deferred to post-MVP (GATE42-016).
- **Components:** TDD-4 (Sections 3-6), TDD-5 (Sections 3-5)
- **Prompts:** None (orchestration + formatting only)
- **Depends On:** E3
- **Blocks:** E5, E6, E7
- **Sizing:** 8-12 agent sessions, 5 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** **Yes** -- After this epic, a PR that triggers `@docalign review` on a repo with syntactic claims produces a real PR comment with drift findings, Check Run results, and health score. IE-01 (syntactic drift) and IE-03 (clean PR) work end-to-end with zero LLM calls.
- **L7 Stubs:** `LearningService` is stubbed via constructor injection: `isClaimSuppressed() → false`. Stubs are replaced when E6 provides the real implementation.

### Key Deliverables

1. **L4:** `enqueuePRScan()`, `enqueueFullScan()` -- public API for webhook handlers (TDD-4 Sections 4.1, 4.3)
2. **L4:** `processPRScan()` BullMQ processor -- full 12-step orchestration pipeline (TDD-4 Section 4.7)
3. **L4:** `processFullScan()` BullMQ processor -- initial scan pipeline (TDD-4 Section 4.9). Note: full implementation can be deferred to post-vertical-slice; keep webhook handler and enqueue stub.
4. **L4:** Debounce logic (30s window via BullMQ `delay`), per-repo lock (BullMQ group concurrency), idempotency (webhook_delivery_id dedup)
5. **L4:** Scan lifecycle: create scan_run → running → completed/partial/failed/cancelled; timeout handling (10 min uniform per TDD-4)
6. **L4:** `@docalign review` comment detection (GATE42-009): parse issue_comment.created events, `:eyes:` reaction acknowledgment
7. **L4:** Repository dispatch: trigger client's GitHub Action via `POST /repos/{owner}/{repo}/dispatches` for LLM tasks
8. **L5:** `postPRComment()` -- summary comment via GitHub Issues API, implementing UX Spec Section 2.1 (drifted findings) and Section 2.2 (zero findings) templates (TDD-5 Section 4.1)
9. **L5:** `calculateHealthScore()` -- GATE42-032 formula, GATE42-035 scope semantics (TDD-5 Section 4.3)
10. **L5:** `sanitizeForMarkdown()` -- XSS prevention per 3E-004 (TDD-5 Section 4.5)
11. **L5:** Check Run creation and updates within `postPRComment()` and L4 pipeline steps -- UX Spec Section 3.3 templates
12. Full pipeline integration tests: IE-01 (syntactic drift end-to-end), IE-03 (clean PR end-to-end)
13. Onboarding integration test: install webhook → full scan queued → Check Run posted

### Recommended Agent Session Split

- **Sessions 1-4:** L4 orchestration: webhook handler, BullMQ processor skeleton, `processPRScan` pipeline steps, debounce, serialization. Done signal: given a test webhook event, pipeline produces a structured `ScanResult`.
- **Sessions 5-7:** L5 output: `postPRComment()`, summary comment formatting, Check Run creation, health score. Done signal: IE-01 and IE-03 produce correct PR comments.
- **Sessions 8-10:** Full scan stub, onboarding flow, cancellation, edge cases, integration tests. Done signal: all E4 tests pass.

### Integration Example Coverage

- **IE-01:** Full end-to-end (deterministic pipeline): trigger → L0 → L1 → L2 → L3 Tier 1 → L5 summary comment
- **IE-03:** Full end-to-end (clean PR): trigger → scope resolution → zero findings → Section 2.2 comment

---

## Epic E5: GitHub Action + LLM Pipeline

- **Scope:** The `docalign/agent-action` GitHub Action -- all client-side LLM work. Task polling from Agent Task API, semantic claim extraction (P-EXTRACT), quick triage (P-TRIAGE), Path 1 verification (P-VERIFY), Path 2 agent-delegated verification (P-VERIFY agent mode), fix generation (P-FIX), embedding generation (text-embedding-3-small), project structure auto-detection, result submission back to DocAlign API. Agent adapter for Claude Code + custom-command (ADR-1). Retry/fallback protocol (Section 10 of prompt specs). Repository dispatch handler.
- **Components:** TDD-Infra (Section 4.3-4.6: Agent Task API endpoints), phase4b-prompt-specs.md (Sections 2-6: P-EXTRACT, P-TRIAGE, P-VERIFY, P-FIX), TDD-3 (Section 4.2: routeClaim Path 2 logic), TDD-4 (Section 4.7: agent task dispatch steps)
- **Prompts:** P-EXTRACT, P-TRIAGE, P-VERIFY (Path 1 + Path 2), P-FIX (all from phase4b-prompt-specs.md)
- **Depends On:** E1 (Agent Task API), E4 (repository dispatch trigger, task creation in orchestrator)
- **Blocks:** E6
- **Sizing:** 8-12 agent sessions, 4 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** No (completes LLM pipeline; IE-02 works after this)

### Key Deliverables

1. **Action scaffold:** GitHub Action `action.yml`, workflow template (`docalign-scan.yml`), repository dispatch event handler
2. **Task polling loop:** `GET /api/tasks/pending` → process → `POST /api/tasks/:id/result`, with DOCALIGN_TOKEN auth
3. **P-EXTRACT implementation:** Semantic claim extraction from doc sections; JSON schema output parsing; fallback on parse failure
4. **P-TRIAGE implementation:** Quick triage classification (verified/drifted/uncertain/needs_deep); Haiku model
5. **P-VERIFY Path 1 implementation:** Evidence-provided verification; entity code + claim → verdict + reasoning + fix
6. **P-VERIFY Path 2 implementation:** Agent-delegated verification via Claude Code custom-command; agent explores repo, returns verdict
7. **P-FIX implementation:** Fix generation from mismatch details; temperature 0.3; output: corrected documentation text
8. **Embedding generation:** text-embedding-3-small, batch processing, submit to DocAlign API
9. **Auto-detect project structure:** Send file tree to LLM, receive code_patterns.include, submit to API
10. **Retry/fallback:** Per-prompt retry policy (prompt specs Section 10), exponential backoff, model fallback chain
11. **Agent adapter:** Claude Code integration for Path 2 (`claude -p` with custom-command)
12. Unit tests with mocked LLM responses for each prompt
13. Integration test: IE-02 end-to-end with recorded agent task results

### Recommended Agent Session Split

- **Sessions 1-3:** Action scaffold, task polling loop, repository dispatch handler, DOCALIGN_TOKEN auth. Done signal: Action receives a task, returns a mock result.
- **Sessions 4-8:** Prompt implementations (P-EXTRACT, P-TRIAGE, P-VERIFY Path 1, P-VERIFY Path 2, P-FIX). Each prompt is a separate session with clear contract. Done signal: each prompt produces correct output from mocked input.
- **Sessions 9-12:** Embeddings, auto-detect, retry/fallback, agent adapter, IE-02 integration test. Done signal: IE-02 passes end-to-end.

### Integration Example Coverage

- **IE-02:** Full end-to-end (semantic drift): trigger → L0 → L1 → L2 → L3 routing → Action receives tasks → P-VERIFY → result submission → L5 summary comment with semantic findings

---

## Epic E6: Learning + Feedback

- **Scope:** Layer 7 (Learning System) -- developer feedback recording, quick-pick fast-path processing, count-based permanent exclusion, suppression rule creation and evaluation. API endpoints for feedback (reaction webhooks, quick-pick submission). Suppression evaluation integrated into L4 scan pipeline (replaces stubs from E3/E4).
- **Components:** TDD-7 (Sections 3-5), TDD-Infra (Section 4.10: dismiss endpoint integration)
- **Prompts:** None for MVP (P-LEARN is v2-deferred)
- **Depends On:** E1 (DB tables), E5 (feedback reactions require Action-posted comments to react to)
- **Blocks:** E8, E9
- **Sizing:** 2-4 agent sessions, 2 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** No (enhances accuracy over time)
- **Migrations:** Adds `feedback` and `suppression_rules` tables.

### Key Deliverables

1. **L7:** `recordFeedback()` -- persist feedback records (thumbs_up, thumbs_down, fix_accepted, fix_dismissed, all_dismissed)
2. **L7:** `processQuickPick()` -- deterministic fast-path: map quick-pick reason to action, create suppression rule
3. **L7:** Count-based exclusion: 2 silent thumbs-down on same claim → permanent exclusion (TDD-7 Section 4.3)
4. **L7:** `isClaimSuppressed()` -- check suppression rules with scope precedence (claim > file > claim_type > pattern)
5. **API:** Feedback endpoint (GitHub reaction webhook → `recordFeedback`), quick-pick endpoint
6. **L4 integration:** Replace L7 stubs with real `isClaimSuppressed()` in scan pipeline
7. Unit tests for each quick-pick reason→action mapping
8. Unit tests for count-based exclusion threshold behavior
9. Integration test: given a claim with 2 prior thumbs-down, `isClaimSuppressed` returns true and the claim is filtered from scan results

### Deferred to v2

The following L7 features are removed from MVP scope:
- **Co-change pattern tracking** (`getCoChangeBoost`, `recordCoChanges`): Requires push scans (not in MVP). Zero data at launch. Boost value is 0 everywhere until hundreds of commits accumulate.
- **Confidence decay** on stale verification results: All results are fresh at launch. Matters after months of accumulated data, not day 1.
- **Suppression rule expiration** (90-180 day TTL): No rules exist at launch. Expiration can be added when rules accumulate.

### Integration Example Coverage

- Indirectly affects all integration examples (suppression filtering modifies which claims appear in output). No dedicated IE for learning, but test strategy Section 4 (L7 tests) provides per-function test cases.

---

## Epic E7: Fix Application + Configuration

- **Scope:** Two sub-tasks: **(A) Configuration** -- `.docalign.yml` parsing with `loadConfig()`, sensible defaults, minimal validation. **(B) Fix Application** -- "Apply all fixes" link in PR summary comment (GATE42-019) → GET confirmation page (GATE42-029) → POST applies fixes via GitHub Git Trees API (GATE42-022). HMAC-only auth (GATE42-025), path traversal validation, `String.replace` $-pattern safety (replacer function). "Apply all fixes" link conditional on >= 1 generated fix (GATE42-036).
- **Components:** **(A)** phase4d-config-spec.md (full). **(B)** GATE42-019/022/023/024/025/027/028/029 decisions + IE-04 (no dedicated TDD section exists for the fix-commit flow; it is specified across these decisions and the integration example).
- **Prompts:** None (P-FIX is in E5; this epic applies already-generated fixes)
- **Depends On:** **(A)** E1 only. **(B)** E4 (fix links in PR comments)
- **Blocks:** --
- **Sizing:** 4-6 agent sessions, 3 days critical path
- **MVP Status:** MVP
- **Vertical Slice:** No (completes the fix experience)

### Key Deliverables

**Part A: Configuration (can start after E1, parallel with E2/E3)**

1. **Config parsing:** `loadConfig()` reads `.docalign.yml`, shallow merge over hardcoded defaults. Wrong type → warn and use default.
2. **Config availability:** Config object accessible to all layers via dependency injection. Keys: `code_patterns`, `doc_patterns`, `claim_types`, `mapping_threshold`, `debounce`, `max_claims_per_pr`, `min_severity`, `check_conclusion`.
3. Unit tests for config loading (valid file, missing file, invalid values)

**Part B: Fix Application (starts after E4)**

4. **Fix endpoint:** `GET /api/fix/confirm?repo={repo}&scan_run_id={id}&token={hmac}` → HTML confirmation page
5. **Confirmation page:** Repo name, scan details, fix count, `<form method="POST">` with hidden fields; security headers (`X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`, `Referrer-Policy: no-referrer`); no third-party resources
6. **Fix apply:** `POST /api/fix/apply` → validate HMAC → check PR still open (GATE42-028) → load DocFix records → path traversal validation (relative, within repo root, symlink resolution) → create Git Tree + commit via GitHub API → post success/partial/failure PR comment (UX Specs Section 2.11/2.12/2.13)
7. **HMAC generation:** Server-side `crypto.createHmac('sha256', secret)` on `{repo}:{scan_run_id}`, included in "Apply all fixes" URL
8. **$-pattern safety:** All `String.replace` calls in fix application use `() => fix.new_text` replacer function
9. Integration test: IE-04 (fix-commit flow end-to-end: full success, partial success, full failure)
10. Unit tests for HMAC generation/validation, path traversal rejection, PR-closed rejection

### Integration Example Coverage

- **IE-04:** Full fix-commit flow: GET confirmation page → POST apply → Git Tree creation → success/partial/failure PR comment

---

## Epic E8: MCP Server

- **Scope:** Layer 6 (MCP Server) -- standalone local process that serves verified documentation knowledge to AI coding agents via MCP protocol. Five tools: `get_docs`, `get_docs_for_file`, `get_doc_health`, `list_stale_docs` (v2, read-only), `report_drift` (v3, write). Stdio transport, single PostgreSQL connection (3B-D4), read-only default, repo identity resolution from filesystem `.git` remote URL.
- **Components:** TDD-6 (full)
- **Prompts:** None (zero LLM calls)
- **Depends On:** E1 (database schema populated by MVP pipeline)
- **Blocks:** --
- **Sizing:** 3-5 agent sessions, 2 days critical path
- **MVP Status:** POST-MVP-v2
- **Vertical Slice:** No

### Key Deliverables

1. MCP server process: `npx @docalign/mcp-server --repo <path>`
2. Stdio transport via `@modelcontextprotocol/node` NodeStdioServerTransport
3. Repo resolution: `.git/config` → extract remote URL → match to `repos` table
4. `get_docs` tool: keyword + semantic search over claims, return sections with verification metadata
5. `get_docs_for_file` tool: return all claims and verification status for a specific file path (GATE42-011)
6. `get_doc_health` tool: file/directory/repo health score query
7. `list_stale_docs` tool: claims with `drifted` or `uncertain` verdict, sorted by severity
8. `report_drift` tool (v3 stub): insert into `agent_drift_reports`, link to claim if possible
9. Read-only connection default: `SET default_transaction_read_only = ON`
10. Unit tests for each tool with fixture data
11. Integration test with Claude Code MCP client

### Integration Example Coverage

None (v2 feature). Test strategy covers L6 in Section 3.6.

---

## Epic E9: CLI + SQLite Adapter

- **Scope:** Two sub-tasks: **(A) SQLite Adapter** -- implement `StorageAdapter` interface (from E1) with better-sqlite3. Parameterized test suite ensuring both backends produce identical results. **(B) CLI Commands** -- `docalign check` (deterministic-only, local), `docalign scan` (full pipeline with local LLM calls), `docalign fix` (apply stored fixes to local files). CLI reads from local SQLite database populated by local scans. Output formatting per UX Specs Section 5/6.
- **Components:** phase4c-ux-specs.md (Section 5/6: CLI output formats), phase4-decisions.md (GATE42-012: CLI is MVP, GATE42-014: StorageAdapter, GATE42-030: `docalign fix`)
- **Prompts:** Same prompts as E5 (P-EXTRACT, P-VERIFY, P-FIX) but invoked locally
- **Depends On:** **(A)** E1 (StorageAdapter interface). **(B)** E1-E6 (needs all domain layers; CLI composes them locally)
- **Blocks:** --
- **Sizing:** 4-6 agent sessions, 3 days critical path
- **MVP Status:** MVP (per GATE42-012)
- **Vertical Slice:** No

### Key Deliverables

**Part A: SQLite Adapter (can start after E1, parallel with E2-E6)**

1. SQLite adapter: implement `StorageAdapter` interface using better-sqlite3
2. Parameterized test suite: every storage-touching test runs against both SQLite and PostgreSQL (test strategy Section 2.1)

**Part B: CLI Commands (starts after E6)**

3. `docalign check` CLI command: local deterministic-only scan (Tiers 1-2), exit codes (0=clean, 1=drift found, 2=error)
4. `docalign scan` CLI command: full scan with local LLM calls, progress indicators, output format (UX Specs Section 5)
5. `docalign fix` CLI command: apply fixes to local files (GATE42-030)
6. CLI output formatting: color/formatting per UX Specs Section 5
7. Unit tests for CLI argument parsing and output formatting
8. Integration tests for CLI end-to-end with SQLite backend

### Integration Example Coverage

Test strategy covers CLI in Section 3.8.

---

## Build Order Summary

### Phase 1: Foundation (Week 1)

| Day | Work | Epics |
|-----|------|-------|
| 1-3 | DB schema (infra tables), migrations framework, Express server skeleton, middleware | E1 |
| 3-5 | GitHub App webhook handling, auth, Agent Task API, BullMQ, deployment | E1 |
| 3-5 | Config parsing + loadConfig() (parallel with E1 latter half) | E7 Part A |

### Phase 2: Data Layers (Week 2)

| Day | Work | Epics |
|-----|------|-------|
| 6-7 | tree-sitter integration, L0 entity extraction, file tree | E2 |
| 7-9 | L0 lookup APIs, L1 regex extractors, claim CRUD | E2 |

### Phase 3: Processing + First Vertical Slice (Week 2-3)

| Day | Work | Epics |
|-----|------|-------|
| 10-11 | L2 mapper pipeline (Steps 1-3), reverse index | E3 |
| 11-13 | L3 Tier 1 verifiers, routing, evidence assembly | E3 |
| 14-16 | L4 PR scan orchestrator, debounce, serialization | E4 |
| 16-18 | L5 PR comment formatting, Check Runs, integration tests | E4 |

**Milestone: Vertical Slice (Day 18)** -- IE-01 and IE-03 pass end-to-end.

### Phase 4: LLM Pipeline + Polish (Week 3-4+)

| Day | Work | Epics |
|-----|------|-------|
| 19-20 | Action scaffold, task polling, P-EXTRACT, P-TRIAGE | E5 |
| 20-22 | P-VERIFY (Path 1 + Path 2), P-FIX, embeddings | E5 |
| 19-21 | Fix endpoint, confirmation page, HMAC, Git Trees API | E7 Part B |
| 19-20 | SQLite adapter (parallel, needs only E1 interface) | E9 Part A |
| 23-24 | L7 feedback, quick-pick, count-based exclusion, suppression | E6 |
| 23-25 | CLI commands: `docalign check`, `docalign scan`, `docalign fix` | E9 Part B |

**Milestone: MVP Complete (Day 25)** -- All 4 integration examples pass. Full pipeline works. CLI operational.

### Not Covered by MVP Epics (correctly deferred)

- **Push scan orchestration** (TDD-4 Sections 4.2/4.8): `enqueuePushScan`, `processPushScan`. Push trigger excluded from MVP per PRD 15.1.
- **Review comments** (TDD-5 Section 4.2: `markResolved`): Deferred per GATE42-016.
- **Scheduled cleanup jobs** (TDD-Infra Appendix G): expire-agent-tasks, cleanup tasks. Add post-launch.
- **Co-change tracking, confidence decay** (TDD-7): Deferred to v2 (see E6 notes).
- **v2 prompts** (P-MAP-LLM, P-DECOMPOSE, P-POSTCHECK, P-LEARN): Explicitly v2-deferred in prompt specs.

---

## Escalation Points for Founder

### Resolved

- **CLI in MVP:** Confirmed per GATE42-012. E9 is MVP. StorageAdapter interface in E1, SQLite adapter + CLI commands in E9.
- **Fix-commit in MVP:** Confirmed. E7 Part B stays in MVP.
- **PRD reconciliation:** Will be updated before implementation to reflect GATE42 decisions.

### Open before implementation

1. **Fix-commit as first-to-cut:** If timeline slips, fix-commit (E7 Part B) + P-FIX (E5 deliverable 7) can be deferred to a fast-follow. This saves ~3-4 agent sessions and ~2 days. The "Apply all fixes" link would not appear in MVP comments; users fix docs manually.

2. **Onboarding without Action:** If the GitHub Action is not configured, the user gets a Check Run with setup instructions. No scanning occurs. Confirm this onboarding friction is acceptable.

3. **MCP Server (E8) priority:** E8 is the only remaining post-MVP epic. It ships after MVP is stable. MCP directly serves AI agents (core value prop for the target audience).
