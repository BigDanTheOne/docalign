# DocAlign Task Breakdown Index

**Generated:** 2026-02-12
**Status:** Verified (all issues resolved)
**Total:** 84 tasks, ~252.5 estimated hours

## Epic Summary

| Epic | File | Tasks | Hours | Status |
|------|------|:-----:|:-----:|--------|
| E1 | [e1-infrastructure.md](e1-infrastructure.md) | 14 | 37 | Verified PASS |
| E2 | [e2-data-pipeline.md](e2-data-pipeline.md) | 19 | 55.5 | Verified PASS |
| E3 | [e3-mapping-verification.md](e3-mapping-verification.md) | 11 | 36 | Verified PASS |
| E4 | [e4-orchestration-output.md](e4-orchestration-output.md) | 12* | 39 | Verified (E4-05 deleted) |
| E5 | [e5-action-llm.md](e5-action-llm.md) | 11 | 32 | Verified PASS |
| E6 | [e6-learning-feedback.md](e6-learning-feedback.md) | 5 | 11 | Verified (E6-5 added) |
| E7 | [e7-fix-config.md](e7-fix-config.md) | 4 | 14 | Verified (test gaps fixed) |
| E8 | [e8-mcp-server.md](e8-mcp-server.md) | 4 | 13 | Verified (get_docs_for_file clarified) |
| E9 | [e9-cli-sqlite.md](e9-cli-sqlite.md) | 5 | 17 | Verified (v2-deferred noted) |

*E4-05 was deleted (duplicate of E3-01 L7 stub). Original count was 13.

## Cross-Epic Dependency Graph

```
E1 (Infrastructure)
 ├── E2 (Data Pipeline: L0 Index + L1 Extraction)
 │    └── E3 (L2 Mapping + L3 Verification)
 │         ├── E8 (MCP Server) ← depends on E2+E3 tables, starts after E3
 │         └── E4 (L4 Orchestration + L5 PR Output) ← VERTICAL SLICE
 │              ├── E5 (GitHub Action + LLM Pipeline) ← IE-02 works
 │              ├── E6-4 (Learning Integration) ← replaces L7 stubs
 │              └── E7-2..E7-4 (Fix Endpoint) ← IE-04 works
 │                   └── E9 Part B (CLI) ← depends on all layers
 ├── E9 Part A (SQLite Adapter) ← depends on E1-02 interface only
 ├── E7-1 (Config System) ← independent, no cross-epic deps
 └── E6-1..E6-3, E6-5 (Learning Core) ← depends on E3-01 stubs only
```

## Execution Plan

See **[EXECUTION-PLAN.md](EXECUTION-PLAN.md)** for full session groupings, parallelization, and critical path analysis.

**Summary:** 32 sessions across 6 waves, ~143h critical path (vs 199h sequential = 28% reduction).

| Wave | Epics | Critical Path | Parallel Tracks |
|:----:|-------|:------------:|-----------------|
| 1 | E1 + early starts (E7-1, E9 Part A) | 29h | 1.3 `\|\|` 1.4 + early starts |
| 2 | E2 (L0 + L1) | 27h | L0 track `\|\|` L1 track |
| 3 | E3 + E6 core (early start) | 26h | L2 `\|\|` L3 `\|\|` E6 |
| 4 | E4 + E8 (parallel) | 26h | Pipeline `\|\|` Reporter `\|\|` MCP |
| 5 | E5 + E6-4 + E7 fix (3 tracks) | 25h | All three fully parallel |
| 6 | E9 Part B (CLI) | 10h | — |
| **Total** | | **143h** | 2-3 agents recommended |

## Verification Issues Resolved

1. **E4-05 deleted** -- was duplicate of E3-01 L7 stub
2. **E6-5 added** -- skeleton implementations for `recordCoChanges`, `getCoChangeBoost`, `getEffectiveConfidence` (safe defaults)
3. **E4 dependency added** -- E4-10 -> E4-11 (onboarding depends on enqueueFullScan)
4. **E2-16 dependency explicit** -- depends on E2-12 (pre-processing)
5. **E7 test gaps fixed** -- GATE42-036, symlink traversal, empty commit prevention added to E7-3/E7-4
6. **E8-2 clarified** -- `get_docs_for_file` isolated with distinct test cases; v2 section limitation noted
7. **E9 v2-deferred** -- `docalign configure/status/serve` explicitly marked as v2

## V2-Deferred Items (tracked, not forgotten)

- `docalign configure`, `docalign status`, `docalign serve` CLI commands (E9)
- Push scan trigger (`enqueuePushScan`, `processPushScan`) (E4)
- Review comments (`markResolved`) (E4/L5)
- Co-change tracking (real implementation) (E6)
- Confidence decay (real implementation) (E6)
- Section extraction by markdown heading (E8 MCP)
- `report_drift` v3 write mode (E8 MCP)
- P-MAP-LLM, P-DECOMPOSE, P-POSTCHECK, P-LEARN prompts (E5)
