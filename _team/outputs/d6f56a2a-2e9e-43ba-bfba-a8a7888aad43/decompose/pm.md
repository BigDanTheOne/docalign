# Task Decomposition — Fix L3 Verifier FN Detection

## Epic: Fix Track 2 False Negative Detection
**Goal**: All 15 Track 2 mutation detection tests pass
**Strategy**: Group mutations by verifier type, fix each verifier independently

## Tasks (ordered by dependency)

### Task 1: Fix Dependency Version Verifier
**Mutations**: det-001 (express), det-002 (zod), det-012 (pino)
**Scope**: `src/layers/L3-verifier/tier1-dependency-version.ts`
**Acceptance criteria**: Track 2 tests det-001, det-002, det-012 pass
**Dependencies**: None

### Task 2: Fix Path Reference Verifier — File Renames & Deletions
**Mutations**: det-004 (rename config file), det-011 (delete .env.example), det-014 (delete mcp.json), det-015 (delete agents file)
**Scope**: `src/layers/L3-verifier/tier1-path-reference.ts`
**Acceptance criteria**: Track 2 tests det-004, det-011, det-014, det-015 pass
**Dependencies**: None

### Task 3: Fix Command/Script Verifier
**Mutations**: det-003 (rename dev script), det-010 (rename migrate script)
**Scope**: `src/layers/L3-verifier/tier1-command.ts`
**Acceptance criteria**: Track 2 tests det-003, det-010 pass
**Dependencies**: None

### Task 4: Fix API Route Verifier
**Mutations**: det-006 (remove GET users), det-007 (POST→PUT), det-008 (remove DELETE users), det-009 (remove GET tasks)
**Scope**: `src/layers/L3-verifier/tier1-api-route.ts`
**Acceptance criteria**: Track 2 tests det-006, det-007, det-008, det-009 pass
**Dependencies**: None

### Task 5: Fix Code Example Verifier — Function/Export Renames
**Mutations**: det-005 (rename createUser), det-013 (rename MCP tool)
**Scope**: `src/layers/L3-verifier/tier1-code-example.ts` and potentially MCP-specific verifier
**Acceptance criteria**: Track 2 tests det-005, det-013 pass
**Dependencies**: None

### Task 6: Fix Track 1 FP Gate
**Mutations**: None (false positive on clean corpus)
**Scope**: Investigate which verifier produces false drift on clean tagged corpus
**Acceptance criteria**: Track 1 test passes, no regression in Track 2
**Dependencies**: Ideally after Tasks 1-5 to avoid conflicts

## Parallelization
Tasks 1-5 are fully independent and can run concurrently.
Task 6 should run after or in parallel but carefully.
