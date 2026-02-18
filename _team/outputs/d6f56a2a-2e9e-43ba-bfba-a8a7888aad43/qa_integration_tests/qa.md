# QA Integration Tests — FN Detection Fix

## Test Strategy

The existing Track 2 mutation test suite (`test/corpus/track2-fn.test.ts`) already provides comprehensive integration tests for this epic. Each mutation test:
1. Starts from a clean synthetic-node corpus with inline tags
2. Applies a specific code mutation (version bump, file rename, route removal, etc.)
3. Runs the FULL pipeline (L0→L1→L2→L3)
4. Asserts the correct drift findings appear

These 15 tests ARE the integration tests. No additional QA tests needed.

## Existing Test Coverage (our acceptance criteria)

| Test | Mutation | Verifier | Status (pre-fix) |
|------|----------|----------|-------------------|
| det-001 | Bump express version | dependency_version | FAIL |
| det-002 | Bump zod version | dependency_version | FAIL |
| det-003 | Rename dev script | command | FAIL |
| det-004 | Rename config file | path_reference | FAIL |
| det-005 | Rename createUser fn | code_example | FAIL |
| det-006 | Remove GET /users | api_route | FAIL |
| det-007 | POST→PUT users | api_route | FAIL |
| det-008 | Remove DELETE /users/:id | api_route | FAIL |
| det-009 | Remove GET /tasks | api_route | FAIL |
| det-010 | Rename migrate script | command | FAIL |
| det-011 | Delete .env.example | path_reference | FAIL |
| det-012 | Bump pino version | dependency_version | FAIL |
| det-013 | Rename MCP tool | code_example | FAIL |
| det-014 | Delete mcp.json | path_reference | FAIL |
| det-015 | Delete agents file | path_reference | FAIL |

## Additional Guard: Track 1 FP Gate
`test/corpus/track1-fp.test.ts` — must remain passing (no new false positives).

## Validation Commands
```bash
# Run Track 2 (FN detection)
npx vitest run test/corpus/track2-fn.test.ts

# Run Track 1 (FP gate)
npx vitest run test/corpus/track1-fp.test.ts

# Full suite
npm test
```
