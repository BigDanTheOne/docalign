# Epic E8: MCP Server

## Task E8-1: MCP Server Scaffold + Stdio Transport + Repo Resolution
- **Files:** `src/layers/L6-mcp/server.ts`, `src/layers/L6-mcp/config.ts`, `src/layers/L6-mcp/db-connection.ts`, `src/layers/L6-mcp/repo-resolver.ts`, `src/layers/L6-mcp/cache.ts`
- **Implements:** TDD-6 Section 4.0 (Server Lifecycle), Appendix B (Connection Config), Appendix C (Caching Strategy), Appendix E (File Structure)
- **Types used:** `McpServerConfig`, `ResolvedRepo`, `CliArgs`, `McpDbConnection`, `CacheEntry<T>`, `RepoRow` (Section 12)
- **Tests:** `tests/layers/L6-mcp/server.test.ts`, `tests/layers/L6-mcp/repo-resolver.test.ts`, `tests/layers/L6-mcp/cache.test.ts` -- CLI arg parsing, database URL resolution chain (CLI arg > env > config file > error), git remote URL parsing (HTTPS, SSH, `git@` formats), repo lookup against `repos` table, `SimpleCache` get/set/eviction/TTL expiry, read-only connection enforcement (`SET default_transaction_read_only = ON` rejects INSERT), startup error paths (no `.git`, no remote, no DB URL, repo not in DB)
- **Done when:** (1) `npx @docalign/mcp-server --repo <path>` starts, resolves repo identity from `.git/config`, opens a read-only PostgreSQL connection, logs startup info to stderr; (2) Invalid `--repo` paths exit with code 1 and descriptive stderr message; (3) `SimpleCache` unit tests pass for TTL expiry, size-based eviction, and concurrent get/set; (4) Read-only connection rejects write queries; (5) `NodeStdioServerTransport` connects and the server responds to MCP `initialize` handshake
- **Estimated effort:** 3 hours

## Task E8-2: Tools -- `get_docs` + `get_docs_for_file`
- **Files:** `src/layers/L6-mcp/tools.ts`, `src/layers/L6-mcp/handlers.ts`, `src/layers/L6-mcp/queries.ts`
- **Implements:** TDD-6 Section 4.1 (`get_docs`), phase4c-ux-specs.md Section 5.1 and 5.5 (`get_docs_for_file`), GATE42-011 (reverse lookup tool), TDD-6 Appendix A.1 (JSON schema), Appendix F.1 (SQL queries)
- **Types used:** `GetDocsRequest`, `GetDocsResponse` (Section 8.1), `ClaimRow` (Section 12), `Verdict`, `ClaimType` (Section 1)
- **Tests:** `tests/layers/L6-mcp/handlers-get-docs.test.ts`:
  - **get_docs:** full-text search returns ranked results; ILIKE fallback when zero results; `verified_only` filter; empty query returns MCP error `-32602`; empty results return `{ sections: [] }` (not error); result limit respected; cache hit returns cached data; **v2 limitation: `section` field is filename only (not markdown heading -- heading extraction deferred to v3 per TDD6-002)**
  - **get_docs_for_file (GATE42-011):** accepts `file_path` + optional `include_verified` (default true); returns all claims mapped to code file path via JOIN on `claim_mappings`; response includes `doc_file`, `line_number`, `claim_text`, `claim_type`, `verification_status`, `last_verified`, `mapping_confidence`; `include_verified: false` filters out verified claims; nonexistent file returns `{ claims: [] }`; Zod schema validates parameters
- **Done when:** (1) `get_docs` tool registered with file-grouped sections (section = filename in v2); (2) Full-text search with ILIKE fallback; (3) `get_docs_for_file` tool registered as distinct tool with its own Zod schema, returns reverse-lookup results with mapping_confidence; (4) Both tools cached with 60s TTL; (5) All unit tests pass with seeded PostgreSQL test data
- **Estimated effort:** 4 hours (increased from 3 -- `get_docs_for_file` is a distinct reverse-lookup query)

## Task E8-3: Tools -- `get_doc_health` + `list_stale_docs`
- **Files:** `src/layers/L6-mcp/handlers.ts` (add handlers), `src/layers/L6-mcp/queries.ts` (add queries), `src/layers/L6-mcp/tools.ts` (register tools)
- **Implements:** TDD-6 Section 4.2 (`get_doc_health`), Section 4.4 (`list_stale_docs`), TDD-6 Appendix A.2 and A.4 (JSON schemas), Appendix F.2 and F.3 (SQL queries), GATE41-001 (health score formula reconciliation)
- **Types used:** `GetDocHealthRequest`, `GetDocHealthResponse`, `HealthScore`, `FileHealth` (Section 7.1), `ListStaleDocsRequest`, `ListStaleDocsResponse` (Section 8.1)
- **Tests:** `tests/layers/L6-mcp/handlers-health.test.ts` -- repo-wide health (no path); specific file health; directory prefix health (with and without trailing slash); nonexistent path returns MCP error `-32000`; health score formula `verified / (verified + drifted)` matches GATE41-001; all-pending claims return `score: null`; path traversal (`../`) sanitized; `list_stale_docs` default returns top 10; `max_results` clamped to 1-100; `max_results: -5` returns MCP error `-32602`; no stale docs returns `{ stale_docs: [] }`; stale-by-age (older than `stale_threshold_days`) included even with zero drifted; results ordered by drifted DESC, uncertain DESC, last_verified ASC NULLS FIRST
- **Done when:** (1) `get_doc_health` returns correct `HealthScore` for file, directory, and repo-wide scopes; (2) `list_stale_docs` returns files with drifted/uncertain claims or stale-by-age, correctly ordered and limited; (3) Both tools cache results with 60s TTL; (4) All edge cases tested (zero claims, all pending, single claim); (5) All unit tests pass
- **Estimated effort:** 3 hours

## Task E8-4: `report_drift` Stub (v3) + Database Migration + Integration Test
- **Files:** `src/layers/L6-mcp/handlers.ts` (add `report_drift` stub), `src/layers/L6-mcp/tools.ts` (register tool), `migrations/XXXX-add-fulltext-index.sql`
- **Implements:** TDD-6 Section 4.3 (`report_drift` v3 stub), TDD-6 Appendix F.6 (required GIN index migration), TDD-6 Appendix D (error code mapping), phase5-test-strategy.md Section 3.6 (L6 tests)
- **Types used:** `ReportDriftRequest`, `ReportDriftResponse` (Section 8.1), `AgentDriftReportRow` (Section 12)
- **Tests:** `tests/layers/L6-mcp/handlers-drift.test.ts` -- `report_drift` returns MCP error `-32603` with "not available in this version" message (v2 mode); validates required fields `doc_file`, `claim_text`, `actual_behavior`; missing `actual_behavior` returns MCP error `-32602`. `tests/layers/L6-mcp/integration.test.ts` -- full integration test: start MCP server against test PostgreSQL with seeded claims, invoke each of the 5 tools via MCP client, verify correct JSON responses; test startup failure paths (invalid repo, no DB); verify all tools registered correctly; verify all tools return `{ content: [{ type: 'text', text: ... }] }` format
- **Done when:** (1) `report_drift` tool registered with Zod schema but returns "not available" error in v2 mode; (2) Migration adds `idx_claims_fulltext` GIN index on `to_tsvector('english', claim_text)`; (3) Integration test starts a real MCP server process, connects via stdio, calls all 5 tools, and asserts correct responses; (4) Error code mapping matches Appendix D for all error conditions; (5) All tests pass including migration on fresh PostgreSQL
- **Estimated effort:** 3 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E8-1 | MCP Server Scaffold + Stdio Transport + Repo Resolution | 3 |
| E8-2 | Tools -- `get_docs` + `get_docs_for_file` | 4 |
| E8-3 | Tools -- `get_doc_health` + `list_stale_docs` | 3 |
| E8-4 | `report_drift` Stub (v3) + Database Migration + Integration Test | 3 |
| **Total** | | **13 hours** |
