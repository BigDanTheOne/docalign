# Epic E9: CLI + SQLite Adapter

> **Scope note:** UX specs (phase4c-ux-specs.md Sections 6.5-6.7) define three additional CLI commands: `docalign status`, `docalign serve`, and `docalign configure`. These are **deferred to v2** per the MVP scope (phase6-epics.md E9 lists only `check`, `scan`, `fix` as MVP deliverables). Error messages should not reference `docalign configure` until it exists.

## Task E9-1: SQLite StorageAdapter Implementation
- **Files:** `src/storage/sqlite-adapter.ts`, `src/storage/storage-adapter.ts` (if not already defined in E1, otherwise modify)
- **Implements:** GATE42-014 (StorageAdapter interface, SQLite backend), phase6-epics.md E9 Part A deliverable 1
- **Types used:** `RepoRow`, `ClaimRow`, `ClaimMappingRow`, `VerificationResultRow`, `ScanRunRow`, `AgentTaskRow`, `FeedbackRow`, `SuppressionRuleRow`, `CodeEntityRow`, `CoChangeRow`, `AgentDriftReportRow` (all from Section 12)
- **Tests:** `tests/storage/sqlite-adapter.test.ts` -- CRUD operations for all tables (repos, claims, claim_mappings, verification_results, scan_runs, code_entities, agent_tasks, feedback, suppression_rules); UUID generation uses `crypto.randomUUID()` (not DB-level); JSONB fields (`extracted_value`, `config`, `payload`) serialize/deserialize correctly; TEXT[] columns (keywords, evidence_files) round-trip correctly; all column types match PostgreSQL adapter behavior; transactions commit and rollback correctly; in-memory SQLite (`:memory:`) works for test isolation
- **Done when:** (1) `SqliteAdapter` implements full `StorageAdapter` interface using `better-sqlite3`; (2) All table schemas match PostgreSQL (same column names, compatible types); (3) Migrations create all tables in SQLite; (4) JSON and array field handling works identically to PostgreSQL adapter; (5) All CRUD unit tests pass against in-memory SQLite
- **Estimated effort:** 4 hours

## Task E9-2: Parameterized Storage Parity Tests
- **Files:** `tests/storage/parity.test.ts`
- **Implements:** phase5-test-strategy.md Section 2.1 (two storage backends, one test suite), Section 4.3 (Storage Backend Tests), GATE42-014
- **Types used:** `StorageAdapter` interface, all Row types from Section 12
- **Tests:** `tests/storage/parity.test.ts` -- parameterized with `describe.each(["sqlite", "postgresql"])`: identical seed data produces identical query results on both backends; all CRUD operations (insert, read, update, delete) for every table; schema migrations produce identical table structures; `extracted_value` JSONB round-trip; `keywords` TEXT[] round-trip; `embedding` column handling (null on SQLite, real vector on PostgreSQL); semantic search (`searchSemantic`) uses stub on SQLite, real pgvector on PostgreSQL; full-text search (`to_tsvector`/`plainto_tsquery`) PostgreSQL-only, ILIKE fallback on SQLite; UUID generation consistent across backends
- **Done when:** (1) Every storage-touching test runs against both SQLite (in-memory) and PostgreSQL (Docker); (2) Same seed data + same operations = same results (excluding pgvector and full-text search which are PostgreSQL-only); (3) Parity test suite passes in CI (< 2 minutes); (4) At least one test per table validates insert + query parity
- **Estimated effort:** 3 hours

## Task E9-3: CLI `check` Command
- **Files:** `src/cli/index.ts`, `src/cli/commands/check.ts`, `src/cli/output.ts`
- **Implements:** phase4c-ux-specs.md Section 6.2 (`docalign check`), GATE42-012 (CLI is MVP), GATE42-014 (embedded server architecture), GATE42-015 (zero-config first run), GATE42-021 (uncertain claims hidden)
- **Types used:** `Claim` (Section 3.1), `VerificationResult` (Section 5.1), `DocFix` (Section 7.1), `Verdict`, `Severity`, `ClaimType` (Section 1)
- **Tests:** `tests/cli/check.test.ts` -- `docalign check README.md` extracts claims, runs Tiers 1-2 deterministic verification, displays results; exit code 0 when all verified; exit code 1 when drifted findings; exit code 2 on error (no LLM key, invalid path); output format matches Section 6.2 (severity labels, claim text, actual behavior, evidence files, suggested fix); uncertain claims hidden from output (GATE42-021); color output respects `NO_COLOR` env var; output includes "Run `docalign fix <file>` to apply suggested fixes" when fixes available; CLI argument parsing handles file path argument and `--verbose` flag
- **Done when:** (1) `docalign check README.md` starts embedded pipeline (L0 index, L1 extract, L2 map, L3 verify Tiers 1-2), stores results in local SQLite, prints formatted output; (2) Output matches Section 6.2 format with severity-sorted findings; (3) Exit codes match spec (0/1/2); (4) Works with zero config beyond `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; (5) All unit tests pass
- **Estimated effort:** 4 hours

## Task E9-4: CLI `scan` Command
- **Files:** `src/cli/commands/scan.ts`
- **Implements:** phase4c-ux-specs.md Section 6.3 (`docalign scan`), GATE42-012, GATE42-014 (embedded mode), GATE42-015 (zero-config), GATE42-021 (uncertain hidden)
- **Types used:** `ScanRun` (Section 6.1), `HealthScore`, `FileHealth` (Section 7.1), `Claim` (Section 3.1), `VerificationResult` (Section 5.1), `Verdict`, `Severity` (Section 1)
- **Tests:** `tests/cli/scan.test.ts` -- `docalign scan` runs full pipeline across all doc files; progress bar shown during verification phase; spinner for other phases; output matches Section 6.3 format (health score, summary counts, hotspots); exit code 0 when no drift; exit code 1 when drift found; exit code 2 on error; hotspots listed in descending drifted-count order; uncertain claims excluded from output and counts (GATE42-021); scan results persisted to local SQLite (retrievable by `docalign fix`); `NO_COLOR` disables progress bar and colors; handles repo with zero doc files gracefully
- **Done when:** (1) `docalign scan` indexes codebase, extracts claims from all doc files, maps, verifies, and prints repo health dashboard; (2) Progress bar renders during verification step; (3) Repository health score and hotspots displayed; (4) Results persisted to SQLite for `docalign fix`; (5) Output matches Section 6.3; (6) All unit tests pass
- **Estimated effort:** 3 hours

## Task E9-5: CLI `fix` Command
- **Files:** `src/cli/commands/fix.ts`
- **Implements:** phase4c-ux-specs.md Section 6.4 (`docalign fix`), GATE42-030 (`docalign fix` in MVP), phase5-test-strategy.md Section 3.8 test case 12-13 (CLI fix + path traversal)
- **Types used:** `DocFix` (Section 7.1)
- **Tests:** `tests/cli/fix.test.ts` -- `docalign fix README.md` reads fixes from SQLite, applies to local file, prints summary; `docalign fix` (no arg) applies all fixes across all files; no prior scan returns "No scan results found" with exit code 1; no fixes available returns "No fixes available" with exit code 1; partial success (2 applied, 1 target changed) prints both successes and failures with exit code 0; all fixes fail returns exit code 2; path traversal rejected (`../../../etc/passwd`, absolute paths, symlinks outside repo root); output matches Section 6.4 format (line-by-line fix descriptions, files modified list); `DocFix.file` validated as relative path within repo root before write
- **Done when:** (1) `docalign fix README.md` reads `DocFix` records from local SQLite and applies as local file writes; (2) `docalign fix` (no argument) applies all available fixes; (3) Partial success handled correctly (some applied, some skipped); (4) Path traversal attacks rejected before any file I/O; (5) Exit codes match spec (0=applied, 1=none available, 2=all failed); (6) Output matches Section 6.4; (7) All unit tests pass including path traversal security tests
- **Estimated effort:** 3 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E9-1 | SQLite StorageAdapter Implementation | 4 |
| E9-2 | Parameterized Storage Parity Tests | 3 |
| E9-3 | CLI `check` Command | 4 |
| E9-4 | CLI `scan` Command | 3 |
| E9-5 | CLI `fix` Command | 3 |
| **Total** | | **17 hours** |
