# Technical Decomposition — Fix L3 Verifier FN Detection

## Architecture Context

The L3 verifier layer has tier1 verifiers for specific claim types:
- `tier1-dependency-version.ts` — verifies `dependency_version` claims against package.json
- `tier1-path-reference.ts` — verifies `path_reference` claims against filesystem
- `tier1-command.ts` — verifies `command` claims against package.json scripts
- `tier1-api-route.ts` — verifies `api_route` claims against route registrations in source
- `tier1-code-example.ts` — verifies `code_example` claims against AST
- `tier1-url-reference.ts` — verifies URL claims

The test harness (`test/corpus/runner.ts`) runs the full pipeline on a synthetic-node corpus with inline tags, applies mutations, and checks that the correct findings appear.

## Root Cause Hypothesis

The verifiers likely have one or more of these issues:
1. **Not running at all** — claim types not routed to the right verifier
2. **Stale index** — L0 codebase index not reflecting mutations in test runner
3. **Too lenient matching** — verifiers accept fuzzy matches that should be drifted
4. **Missing claim extraction** — L1 not extracting certain claim types from the corpus docs

The test runner applies mutations in-memory, so verifiers must read from the mutated state, not cached/stale data.

## Task Technical Details

### Task 1: Dependency Version Verifier
- Read `package.json` dependencies at verification time (not cached)
- Compare extracted version string against actual version
- Handle semver ranges vs exact versions

### Task 2: Path Reference Verifier
- Check file existence at verification time
- Handle both relative and absolute paths
- Must detect deleted files and renamed files (file at old path no longer exists)

### Task 3: Command/Script Verifier
- Read `package.json` scripts at verification time
- Match extracted script names against actual script keys
- `npm run dev` → check `scripts.dev` exists

### Task 4: API Route Verifier
- Parse route registrations from source files (AST or regex)
- Match HTTP method + path against doc claims
- Detect removed routes and method changes

### Task 5: Code Example / Function Verifier
- Parse exports/function definitions from source (AST)
- Match against doc claims referencing function names
- Handle MCP tool name verification (may need dedicated pattern)

### Task 6: Track 1 FP Fix
- Run Track 1 test, inspect which finding(s) are false positives
- Trace back to the specific verifier producing the false verdict
- Fix the over-aggressive matching

## Testing Strategy
Each task: run specific Track 2 mutation tests after fix.
Final: run full `npm test` to check no regressions.
