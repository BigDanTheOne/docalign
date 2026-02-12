# DocAlign Execution Plan

**Generated:** 2026-02-12
**84 tasks, ~252.5h estimated, ~133h critical path**

---

## Cross-Epic Dependency Validation

The INDEX.md dependency graph was validated against all 9 epic files. Results:

### Confirmed Edges (correct as documented)
| Edge | Evidence |
|------|----------|
| E1 → E2 | E2 needs StorageAdapter (E1-02), migrations framework (E1-03), types (E1-01) |
| E2 → E3 | E3 needs CodebaseIndexService (E2-10), claims table (E2-11), L1 extractor (E2-16+) |
| E3 → E4 | E4-03/04 calls mapClaim (E3-05), verifyClaim (E3-10), uses L7 stubs (E3-01) |
| E4 → E5 | E5 needs repository_dispatch trigger (E4), Agent Task API (E1-11), createAgentTasks (E4-04) |
| E4 → E6 | E6-4 replaces L7 stubs in L4 pipeline; E6-1/2/3 need stub interfaces from E3-01 |
| E4 → E7 | E7-2/3/4 need "Apply fixes" link from E4-08; E7-1 is independent |
| E3 → E8 | E8 reads from claims, claim_mappings, verification_results tables (all from E2+E3) |
| E1 → E9A | E9-1 implements StorageAdapter interface (E1-02), no other epic dependencies |
| E5+E6 → E9B | CLI check/scan/fix run full pipeline (L0-L6), need all layers working |

### Refinements Found
1. **E8 ancestry**: INDEX.md tree shows E8 as child of E1, but it actually needs E3 to complete (claims, claim_mappings, verification_results tables). The annotation "can start after E3" is correct but the tree position is misleading. Functionally: E3 → E8.

2. **E7-1 early-start not captured**: E7-1 (Configuration System) has zero cross-epic dependencies. It can start in Wave 1 alongside E1. This saves ~4h from the post-E4 phase.

3. **E5 partial early-start**: E5-01 (Action Scaffold) is a separate repo (`agent-action/`) and only needs the repo structure defined. The scaffold can start after E1-11 (Agent Task API contract), but prompt implementations (E5-03+) need E4 to define task payloads.

4. **E6 partial independence**: E6-1/2/3/5 only need the LearningService *interface* from E3-01. They can start as soon as E3-01 is done, not after E4. Only E6-4 (L4 integration) requires E4.

### Corrected Dependency Graph

```
E1-01 (Scaffold)
 │
 ├─→ E1-02..E1-14 (Infrastructure: server, DB, webhooks, auth, API)
 │    │
 │    ├─→ E2-01..E2-10 (L0 Codebase Index)
 │    │    │
 │    │    ├─→ E2-11..E2-19 (L1 Claim Extractor, overlaps with L0)
 │    │    │    │
 │    │    │    └─→ E3-01 (L7 Stubs + Migrations)
 │    │    │         │
 │    │    │         ├─→ E3-02..E3-05 (L2 Mapper)  ──┐
 │    │    │         │                                │
 │    │    │         ├─→ E3-06..E3-08 (L3 Verifier) ─┤── parallel tracks
 │    │    │         │                                │
 │    │    │         └─→ E6-1..E6-3, E6-5 (Learning core) ← early start!
 │    │    │              │
 │    │    │              └─→ E3-09..E3-11 (Routing + Integration)
 │    │    │                   │
 │    │    │                   ├─→ E8-1..E8-4 (MCP Server) ← starts after E3
 │    │    │                   │
 │    │    │                   └─→ E4-01..E4-13 (Orchestration + PR Output)
 │    │    │                        │
 │    │    │                        ├─→ E5-01..E5-11 (GitHub Action + LLM)
 │    │    │                        ├─→ E6-4 (L4 Integration, replaces stubs)
 │    │    │                        └─→ E7-2..E7-4 (Fix Endpoint)
 │    │    │                             │
 │    │    │                             └─→ E9-3..E9-5 (CLI Commands)
 │    │    │
 │    │    └─→ E9-1, E9-2 (SQLite Adapter + Parity) ← early start!
 │    │
 │    └─→ E7-1 (Config System) ← independent, early start!
 │
 └─→ E5-01 (Action Scaffold) ← needs E1-11 contract only
```

---

## Wave Structure + Session Groupings

Each session is a coherent unit of work for one AI coding agent: 3-8 tasks, clear inputs/outputs, testable result. Sessions within a wave can run in parallel where marked `||`.

### Wave 1: Infrastructure Foundation
**Goal:** Working Express server with DB, Redis, webhooks, auth, and Agent Task API.

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **1.1** | E1-01, E1-02, E1-03 | 8h | — | Compilable project, StorageAdapter, migrations |
| **1.2** | E1-04, E1-05, E1-06 | 7h | 1.1 | Express server, Redis/BullMQ, graceful shutdown |
| **1.3** | E1-07, E1-08, E1-09 | 9h | 1.2 | Webhook verification, event routing, GitHub auth |
| **1.4** | E1-10, E1-11, E1-12 | 8h | 1.2 | DOCALIGN_TOKEN, Agent Task API, dismiss |
| **1.5** | E1-13, E1-14 | 5h | 1.3, 1.4 | Railway config, integration tests |

**Early starts (parallel with Wave 1):**

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **1.X** | E7-1 | 4h | — | Configuration system (loadConfig + defaults + validation) |
| **1.Y** | E9-1, E9-2 | 7h | 1.1 | SQLite adapter + parity tests |

**Parallelism:** 1.3 `||` 1.4; 1.X anytime; 1.Y after 1.1
**Wave 1 critical path:** 1.1(8) → 1.2(7) → 1.3(9) → 1.5(5) = **29h**
**Total work:** 48h across 7 sessions

---

### Wave 2: Data Pipeline (L0 + L1)
**Goal:** Full codebase indexing (tree-sitter, entity extraction, manifests) and claim extraction pipeline.

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **2.1** | E2-01, E2-02, E2-03 | 9h | Wave 1 | Tree-sitter WASM, entity extraction, DB tables |
| **2.2** | E2-07 | 4h | Wave 1 | Manifest parsing (package.json, pyproject.toml, etc.) |
| **2.3** | E2-04, E2-05, E2-06 | 9h | 2.1, 2.2 | File/entity/route/dependency lookup APIs |
| **2.4** | E2-08, E2-09, E2-10 | 9h | 2.3 | Semantic search, incremental update, L0 assembly |
| **2.5** | E2-11, E2-12 | 4.5h | Wave 1 | Claims table, pre-processing pipeline |
| **2.6** | E2-13, E2-14, E2-15 | 9h | 2.5 | All regex extractors (paths, commands, versions, code examples) |
| **2.7** | E2-16, E2-17, E2-18, E2-19 | 10h | 2.5, 2.6 | Orchestrator, CRUD, re-extraction, L1 assembly |

**Parallelism:** L0 track (2.1→2.2→2.3→2.4) `||` L1 track (2.5→2.6→2.7)
**Wave 2 critical path:** max(2.1(9)→2.3(9)→2.4(9), 2.5(4.5)→2.6(9)→2.7(10)) = max(27, 23.5) = **27h**
**Total work:** 54.5h across 7 sessions

---

### Wave 3: Mapping + Verification
**Goal:** L2 claim-to-code mapper and L3 deterministic verifiers, both tested end-to-end.

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **3.1** | E3-01 | 2h | Wave 2 | L7 stubs, claim_mappings + verification_results tables |
| **3.2** | E3-02, E3-03 | 6h | 3.1 | Step 1 direct reference (all 5 claim types) |
| **3.3** | E3-04, E3-05 | 7h | 3.2 | Steps 2-3, dedup, pipeline, reverse index |
| **3.4** | E3-06, E3-07, E3-08 | 10h | 3.1 | All Tier 1 verifiers + Tier 2 shell |
| **3.5** | E3-09, E3-10 | 7h | 3.3, 3.4 | Routing + evidence assembly, result storage |
| **3.6** | E3-11 | 4h | 3.5 | Cross-layer integration test (7 scenarios) |

**Early starts (parallel with Wave 3):**

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **3.E** | E6-1, E6-2, E6-3, E6-5 | 9h | 3.1 | Learning core (feedback, suppression, skeletons) |

**Parallelism:** L2 (3.2→3.3) `||` L3 (3.4); 3.E parallel with L2/L3 tracks
**Wave 3 critical path:** 3.1(2) → max(3.2(6)+3.3(7), 3.4(10)) → 3.5(7) → 3.6(4) = 2+13+7+4 = **26h**
**Total work:** 45h across 7 sessions

---

### Wave 4: Orchestration + PR Output (Vertical Slice)
**Goal:** Complete PR scan pipeline — from webhook to PR comment with findings, health score, and Check Run.

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **4.1** | E4-01, E4-02 | 7h | Wave 3 | @docalign review detection, scan queue + lifecycle |
| **4.2** | E4-03, E4-04 | 8h | 4.1 | Full PR scan pipeline (classify → scope → map → verify → report) |
| **4.3** | E4-06, E4-07 | 5h | Wave 3 | sanitizeForMarkdown, calculateHealthScore |
| **4.4** | E4-08, E4-09 | 7h | 4.2, 4.3 | PR comment formatting, Check Run |
| **4.5** | E4-10, E4-11, E4-12 | 8h | 4.1 | enqueueFullScan, installation handler, cancelScan |
| **4.6** | E4-13 | 4h | 4.4, 4.5 | Vertical slice IE-01 + IE-03 integration tests |

**Parallel with Wave 4:**

| Session | Tasks | Effort | Depends On | Output |
|---------|-------|:------:|------------|--------|
| **4.M1** | E8-1, E8-2 | 7h | Wave 3 | MCP server scaffold, get_docs + get_docs_for_file |
| **4.M2** | E8-3, E8-4 | 6h | 4.M1 | get_doc_health, list_stale_docs, report_drift stub |

**Parallelism:** 4.3 `||` 4.1/4.2; 4.5 partial `||` with 4.1-4.4; E8 fully `||` with E4
**Wave 4 critical path:** 4.1(7)→4.2(8)→4.4(7)→4.6(4) = **26h**
**Total work (E4+E8):** 52h across 8 sessions

---

### Wave 5: Three Parallel Tracks
**Goal:** GitHub Action with all LLM prompts, learning system integration, fix endpoint.

**Track A — E5: GitHub Action + LLM Pipeline (32h)**

| Session | Tasks | Effort | Depends On |
|---------|-------|:------:|------------|
| **5A.1** | E5-01, E5-02 | 7h | Wave 4 (E1-11 contract) |
| **5A.2** | E5-03, E5-04, E5-05 | 8h | 5A.1 |
| **5A.3** | E5-06, E5-07, E5-08 | 7h | 5A.1 (parallel with 5A.2) |
| **5A.4** | E5-09, E5-10 | 6h | 5A.2, 5A.3 |
| **5A.5** | E5-11 | 4h | 5A.4 |

**Track B — E6: Learning Integration (2h)**

| Session | Tasks | Effort | Depends On |
|---------|-------|:------:|------------|
| **5B.1** | E6-4 | 2h | Wave 4 + Session 3.E |

(E6-1/2/3/5 already completed in Wave 3 early start)

**Track C — E7: Fix Endpoint (10h)**

| Session | Tasks | Effort | Depends On |
|---------|-------|:------:|------------|
| **5C.1** | E7-2, E7-3 | 7h | Wave 4 (E4-08) |
| **5C.2** | E7-4 | 3h | 5C.1 |

(E7-1 already completed in Wave 1 early start)

**Parallelism:** All three tracks fully parallel
**Wave 5 critical path:** Track A = 5A.1(7)→5A.2(8)→5A.4(6)→5A.5(4) = **25h**
**Total work:** 44h across 8 sessions

---

### Wave 6: CLI (Final)
**Goal:** CLI commands for local usage (check, scan, fix).

| Session | Tasks | Effort | Depends On |
|---------|-------|:------:|------------|
| **6.1** | E9-3, E9-4 | 7h | Wave 5 (all layers available) |
| **6.2** | E9-5 | 3h | 6.1 |

(E9-1/E9-2 already completed in Wave 1 early start)

**Wave 6 critical path:** **10h**
**Note:** If E8 wasn't pulled into Wave 4, it would overlap here. With E8 in Wave 4, Wave 6 is just CLI.

---

## Critical Path Analysis

```
Wave 1    Wave 2    Wave 3    Wave 4     Wave 5      Wave 6
(29h) ──→ (27h) ──→ (26h) ──→ (26h) ──→ (25h) ──→  (10h)
                                │
                                ├── E8 (13h, parallel) ← done before Wave 5 ends
                                │
 ┌─ E7-1 (4h, Wave 1)          ├── E7-2/3/4 (10h, parallel)
 ┌─ E9-1/2 (7h, Wave 1)        ├── E6-4 (2h, parallel)
 ┌─ E6-1/2/3/5 (9h, Wave 3)    └── E5 (25h, parallel = longest)
```

### Critical Path Duration

| Segment | Sessions | Hours |
|---------|----------|:-----:|
| Wave 1 | 1.1→1.2→1.3→1.5 | 29 |
| Wave 2 | 2.1→2.3→2.4 | 27 |
| Wave 3 | 3.1→3.2→3.3→3.5→3.6 | 26 |
| Wave 4 | 4.1→4.2→4.4→4.6 | 26 |
| Wave 5 | 5A.1→5A.2→5A.4→5A.5 | 25 |
| Wave 6 | 6.1→6.2 | 10 |
| **Total critical path** | | **143h** |

### Early Starts Save ~20h
By pulling E7-1, E9 Part A, and E6 core into earlier waves:
- E7-1 in Wave 1: saves 4h from Wave 5
- E9-1/E9-2 in Wave 1: saves 7h from Wave 6
- E6 core in Wave 3: saves 9h from Wave 5
- E8 in Wave 4: saves 13h from Wave 6

**Effective critical path: ~143h** (vs 199h fully sequential = 28% reduction)

---

## Parallelization Summary

### Maximum Concurrent Agent Sessions

| Period | Active Sessions | Agents Needed |
|--------|----------------|:-------------:|
| Wave 1 start | 1.1 + 1.X | 2 |
| Wave 1 mid | 1.3 + 1.4 + 1.Y | 3 |
| Wave 2 | L0 track + L1 track | 2 |
| Wave 3 | L2 track + L3 track + E6 core | 3 |
| Wave 4 | E4 pipeline + E8 | 2 |
| Wave 5 | E5 + E6-4 + E7 | 3 |
| Wave 6 | E9 CLI | 1 |

**Recommended: 2 agents sustained, 3 at peaks.** This keeps review burden manageable for a solo founder.

### If Using 1 Agent (Sequential)
Follow the session order within each wave top-to-bottom. Skip early starts until their natural position. Total: ~199h.

### If Using 2 Agents
- Agent Alpha: critical path (1.1→1.2→1.3→1.5→2.1→2.3→2.4→3.1→3.2→3.3→3.5→3.6→4.1→4.2→4.4→4.6→5A.1→5A.2→5A.4→5A.5→6.1→6.2)
- Agent Beta: parallel work (1.X, 1.Y, 1.4, 2.2, 2.5→2.6→2.7, 3.4, 3.E, 4.3, 4.5, 4.M1→4.M2, 5B.1, 5C.1→5C.2)

### If Using 3 Agents
Add Agent Gamma for Waves 3 (E6 core) and Wave 5 (third track).

---

## Session Checklist (All 32 Sessions)

### Pre-Wave (early starts)
- [ ] **1.X** E7-1: Config System _(independent, 4h)_
- [ ] **1.Y** E9-1, E9-2: SQLite Adapter + Parity _(after 1.1, 7h)_

### Wave 1: Infrastructure (29h critical, 37h total)
- [ ] **1.1** E1-01..E1-03: Scaffold + Storage + Migrations _(8h)_
- [ ] **1.2** E1-04..E1-06: Server + Redis + Shutdown _(7h)_
- [ ] **1.3** E1-07..E1-09: Webhooks + GitHub Auth _(9h)_
- [ ] **1.4** E1-10..E1-12: Tokens + API + Dismiss _(8h)_ `||` 1.3
- [ ] **1.5** E1-13, E1-14: Deploy + Integration _(5h)_

### Wave 2: Data Pipeline (27h critical, 54.5h total)
- [ ] **2.1** E2-01..E2-03: Tree-sitter + Migrations _(9h)_
- [ ] **2.2** E2-07: Manifest Parsing _(4h)_ `||` 2.1
- [ ] **2.3** E2-04..E2-06: Lookup APIs _(9h)_
- [ ] **2.4** E2-08..E2-10: Search + Update + Assembly _(9h)_
- [ ] **2.5** E2-11, E2-12: Claims Table + Pre-processing _(4.5h)_ `||` L0
- [ ] **2.6** E2-13..E2-15: Regex Extractors _(9h)_
- [ ] **2.7** E2-16..E2-19: Orchestrator + CRUD + Assembly _(10h)_

### Wave 3: Mapping + Verification (26h critical, 45h total)
- [ ] **3.1** E3-01: L7 Stubs + Migrations _(2h)_
- [ ] **3.2** E3-02, E3-03: L2 Steps 1-2 _(6h)_
- [ ] **3.3** E3-04, E3-05: L2 Pipeline + Maintenance _(7h)_
- [ ] **3.4** E3-06..E3-08: L3 Verifiers _(10h)_ `||` L2 track
- [ ] **3.E** E6-1..E6-3, E6-5: Learning Core _(9h)_ `||` L2/L3
- [ ] **3.5** E3-09, E3-10: Routing + Storage _(7h)_
- [ ] **3.6** E3-11: Cross-Layer Integration _(4h)_

### Wave 4: Orchestration + PR Output (26h critical, 52h total)
- [ ] **4.1** E4-01, E4-02: Comment Detection + Scan Queue _(7h)_
- [ ] **4.2** E4-03, E4-04: PR Scan Pipeline _(8h)_
- [ ] **4.3** E4-06, E4-07: Sanitization + Health Score _(5h)_ `||` 4.1/4.2
- [ ] **4.4** E4-08, E4-09: PR Comment + Check Run _(7h)_
- [ ] **4.5** E4-10..E4-12: Full Scan + Install + Cancel _(8h)_ `||` 4.1-4.4
- [ ] **4.6** E4-13: Vertical Slice IE-01/IE-03 _(4h)_
- [ ] **4.M1** E8-1, E8-2: MCP Scaffold + Docs Tools _(7h)_ `||` E4
- [ ] **4.M2** E8-3, E8-4: MCP Health + Integration _(6h)_

### Wave 5: Parallel Tracks (25h critical, 44h total)
- [ ] **5A.1** E5-01, E5-02: Action Scaffold + Polling _(7h)_
- [ ] **5A.2** E5-03..E5-05: P-EXTRACT, P-TRIAGE, P-VERIFY P1 _(8h)_
- [ ] **5A.3** E5-06..E5-08: P-VERIFY P2, P-FIX, Embeddings _(7h)_ `||` 5A.2
- [ ] **5A.4** E5-09, E5-10: Agent Adapter + Retry _(6h)_
- [ ] **5A.5** E5-11: IE-02 Integration _(4h)_
- [ ] **5B.1** E6-4: L4 Integration _(2h)_ `||` Track A
- [ ] **5C.1** E7-2, E7-3: Fix Endpoint GET + POST _(7h)_ `||` Track A
- [ ] **5C.2** E7-4: IE-04 Integration _(3h)_

### Wave 6: CLI (10h)
- [ ] **6.1** E9-3, E9-4: CLI check + scan _(7h)_
- [ ] **6.2** E9-5: CLI fix _(3h)_

---

## Calendar Estimate

| Scenario | Critical Path | Calendar Days (8h/day) |
|----------|:------------:|:---------------------:|
| 1 agent, sequential | 199h | ~25 days |
| 2 agents, parallel | 143h | ~18 days |
| 3 agents at peaks | ~133h | ~17 days |

**Note:** These are human-hour estimates. AI coding agents may execute faster (boilerplate, test writing) or slower (complex debugging, integration issues). Actual velocity will calibrate after Wave 1.

### Recommended First Milestone
**Wave 1 completion** = working server that accepts webhooks, manages repos, and serves the Agent Task API. This validates the infrastructure foundation before committing to the full pipeline. **Budget 3-4 calendar days with 2 agents.**

---

## Risk Hotspots

| Risk | Sessions | Mitigation |
|------|----------|------------|
| tree-sitter WASM complexity | 2.1 | Spike: test WASM loading in Node.js first. If problematic, fall back to @ast-grep/napi |
| pgvector performance | 2.4 | Semantic search has MVP fallback to findSymbol. Can defer pgvector to v2 |
| LLM prompt reliability | 5A.2, 5A.3 | Retry/fallback protocol (E5-10) handles parse failures. Test with recorded fixtures |
| Git Trees API edge cases | 5C.1 | $-pattern safety, path traversal, symlinks. Heavy test coverage defined in E7-3 |
| Cross-layer integration | 3.6, 4.6 | These sessions exist specifically to catch interface mismatches early |

---

## Agent Session Template

When starting each session, provide the agent with:

```
Context:
- Task file: docalign/tasks/{epic-file}.md
- Relevant TDD: phases/{tdd-file}.md
- API contracts: phases/phase4-api-contracts.md (Section X)
- Prior session output: {what was built in the dependency session}

Goal: Implement tasks {E_-__ through E_-__}
- All tests must pass
- Follow existing code patterns from prior sessions
- Commit after each task completes

Done when:
- All tests pass (npx vitest run)
- Types compile (npx tsc --noEmit)
- No regressions in existing tests
```
