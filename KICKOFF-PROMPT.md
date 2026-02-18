# DocAlign Implementation — Kickoff

## What exists

Planning is 100% complete. You have everything needed to implement:

- **84 tasks** across 9 epics, fully specified with files, types, tests, and done-when criteria
- **9 TDDs** (one per layer + infrastructure) with algorithms, pseudocode, data structures
- **Canonical TypeScript interfaces** in `phases/phase4-api-contracts.md` (Section 12 = all DB row types)
- **Golden integration examples** (IE-01 through IE-04) with exact input→output
- **Execution plan** with session groupings and dependency order

## Where everything is

```
phases/           ← 27 spec files (TDDs, contracts, prompts, UX, config, architecture)
prd/              ← 10 per-layer product requirements (higher-level "why")
tasks/            ← 11 files: INDEX.md, EXECUTION-PLAN.md, e1 through e9
src/              ← empty, ready for code
test/             ← empty, ready for tests
migrations/       ← empty, ready for DB migrations
```
## How to navigate

1. **Start with** `tasks/INDEX.md` — master index with epic summary, dependency graph, and v2-deferred items
2. **Execution order** is in `tasks/EXECUTION-PLAN.md` — 32 sessions across 6 waves with parallelization
3. **Each epic file** (e.g., `tasks/e1-infrastructure.md`) lists every task with: files to create, TDD sections to implement, types to use, tests to write, and done-when criteria
4. **Before implementing any task**, read the referenced TDD sections and `phases/phase4-api-contracts.md` for the exact type signatures

## What to do first

**Wave 1, Session 1.1** — Foundation (E1-01, E1-02, E1-03):

| Task | What | Key Spec |
|------|------|----------|
| E1-01 | Project scaffold: package.json, tsconfig, vitest, Pino logger, shared types | `phases/tdd-infra.md` §6.6, §3 |
| E1-02 | StorageAdapter interface + PostgreSQL connection pool | `phases/tdd-infra.md` §3, GATE42-014 |
| E1-03 | Database migrations: repos, scan_runs, agent_tasks tables | `phases/tdd-infra.md` Appendix A (§A.1, A.2, A.7), Appendix F |

Read `tasks/e1-infrastructure.md` for full details on all 14 E1 tasks and their internal dependency order.

**Parallel early start** (independent, zero cross-dependencies):
- **E7-1**: Configuration system — `tasks/e7-fix-config.md`, spec: `phases/phase4d-config-spec.md`

## Key rules

- TDD is the authority on HOW. Task file is the authority on WHAT to build and test.
- `phases/phase4-api-contracts.md` Section 12 defines all database row types — use these exactly.
- Every task must end with `npx vitest run` and `npx tsc --noEmit` passing.
- No scope creep. Implement exactly what the task specifies.

Please start by reading `tasks/e1-infrastructure.md` and `phases/tdd-infra.md`, then implement Session 1.1 (E1-01 → E1-02 → E1-03).
