# EXEC_PLAN — T4: CHANGELOG + Version Hygiene

Run ID: `2dffc059-e2c2-4b19-86b2-e9bd13cc5926`
Pipeline type: task
Branch: `feature/2dffc059`
Generated: 2026-02-19T01:34:51.787Z

## Purpose / Big Picture

Task: T4: CHANGELOG + Version Hygiene

## Progress

- [ ] Complete all build tasks
- [ ] Push branch and open PR
- [ ] All tests pass (`npm run typecheck && npm run test`)

## Prior Code Review Feedback (MUST ADDRESS)

The previous build was rejected. Address ALL of the following feedback:

### critic
VERDICT: request_changes

FINDINGS:
- **CRITICAL — `semantic` in SKIP_BLOCK_TAGS blanks entire documents**: Adding `semantic` to the block-tag skip set in `preprocessing.ts` causes `activeBlockTag` to be set on inline `docalign:semantic` tags (which have no closing `<!-- /docalign:semantic -->` pair). Once set, every subsequent line is suppressed from claim extraction until EOF. 30+ docs files affected. Silent data loss — no errors, just missing claims.
- **CRITICAL — Parser tag format changed without migration**: `parser.ts` TAG_PATTERN changed from `docalign:semantic` to `docalign:claim` and now requires `type` field. 30+ existing `<!-- docalign:semantic ... -->` tags in docs/ are orphaned — `parseTags()` returns empty arrays. No migration script or tag rewrite included.
- **Version downgrade**: `package.json` changes from 0.3.6 → 0.3.5 while CHANGELOG lists 0.3.6 as the latest release. Contradictory.
- **Undocumented feature removal**: `writeTagStatusBack` and `blankSemanticClaimLines` removed (features listed as Added in CHANGELOG 0.3.6), but CHANGELOG doesn't mention their removal. Misleading history.
- **Stale line numbers**: Reverting from tag-first to store-only semantic claim loading means line numbers come from JSON store snapshots, not live tag positions. Doc edits will produce wrong line numbers.

CONFIDENCE: high

## Context and Orientation

### Working Directory
`/Users/kotkot/docalign-worktrees/2dffc059`

### Key Conventions
- Run `npm run typecheck && npm run test` after every change
- Run `npm run lint:fix` after every file edit
- Run `npm run lint:agent` for errors with remediation hints
- Follow existing patterns in `src/` — strict TypeScript, Zod validation, Pino logging
- See `CLAUDE.md` in repo root for full conventions
- See `CONVENTIONS.md` for coding style reference

### Stage History
- **code_review** (critic): rejected — Critical: semantic in SKIP_BLOCK_TAGS blanks documents, parser tag format changed without migration, version downgrade 0.3.6→0.3.5, undocumented feature removal, stale line numbers

## Validation and Acceptance

For each task:
1. Run `npm run typecheck` — must pass with 0 errors
2. Run `npm run test` — must pass with 0 failures
3. Run `npm run lint:agent` — must produce 0 errors (includes remediation hints)
4. Run `npm run test:qa` — QA acceptance tests must pass (0 failures)

Final validation:
1. Run `npm run typecheck && npm run test && npm run lint`
2. Verify all acceptance criteria above are met
3. Verify no regressions in existing tests
4. Run `npm run test:qa` separately to confirm design contracts

### Integration Testing (optional, for complex features)
1. `npm run build`
2. `bash ~/.openclaw/skills/pipeline/scripts/agent-dev.sh --run-id 2dffc059-e2c2-4b19-86b2-e9bd13cc5926`
3. Read `.agent-dev.json` for the assigned port
4. `curl http://localhost:<port>/health`
5. `bash ~/.openclaw/skills/pipeline/scripts/agent-dev-cleanup.sh --run-id 2dffc059-e2c2-4b19-86b2-e9bd13cc5926`

## Idempotence and Recovery

- All tasks are idempotent — re-running produces the same result
- If a task fails, fix the issue and re-run from the failing task
- If typecheck/test fails, debug and fix before moving to next task
- Maximum 3 retry attempts per task before recording the failure

## Surprises & Discoveries

_(Agent fills this in during execution — record unexpected findings here)_

## Decision Log

_(Agent fills this in during execution — record design decisions with rationale)_

## Outcomes & Retrospective

_(Agent fills this in after completion — summarize what was built, gaps, lessons)_