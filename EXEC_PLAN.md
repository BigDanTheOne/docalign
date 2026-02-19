# EXEC_PLAN — T2: PR Comment Integration

Run ID: `90f449b1-ea19-4cc1-b070-e528bbec40f8`
Pipeline type: task
Branch: `feature/90f449b1`
Generated: 2026-02-19T01:25:06.994Z

## Purpose / Big Picture

Task: T2: PR Comment Integration

## Progress

- [ ] Complete all build tasks
- [ ] Push branch and open PR
- [ ] All tests pass (`npm run typecheck && npm run test`)

## Context and Orientation

### Working Directory
`/Users/kotkot/docalign-worktrees/90f449b1`

### Key Conventions
- Run `npm run typecheck && npm run test` after every change
- Run `npm run lint:fix` after every file edit
- Run `npm run lint:agent` for errors with remediation hints
- Follow existing patterns in `src/` — strict TypeScript, Zod validation, Pino logging
- See `CLAUDE.md` in repo root for full conventions
- See `CONVENTIONS.md` for coding style reference

### Stage History
(no prior stages recorded)

## QA Test Requirements (MUST PASS)

Pre-written QA tests have been placed in this worktree under `test/qa/`.
These tests validate design contracts — they will FAIL until implementation is correct.

**Your implementation MUST make all QA tests pass. Do NOT modify QA test files.**
If a QA test is impossible to satisfy, add `.skip()` with a `// QA-DISPUTE: <reason>` comment
and document it in the Surprises & Discoveries section.

Run QA tests: `npm run test:qa`

### QA Test Manifest

# QA Tests — T2: PR Comment Integration

## Test Files

| File | Description |
|------|-------------|
| `test/qa/pr-comment-integration/pr-comment.qa.test.ts` | Acceptance contracts for formatter output, upsert marker, status indicators, truncation, CLI flag, and action.yml configuration |

## Coverage Map

- **AC1** (summary comment): formatter produces markdown from drift results
- **AC2** (content): total claims, stale count, file+line listing
- **AC3** (upsert): `<!-- docalign-report -->` marker present
- **AC4** (status): ✅/❌ indicator logic
- **AC5** (collapsible): `<details>` wrapping
- **AC6** (permissions): default GITHUB_TOKEN compatibility
- **Truncation**: 65536 char limit with overflow message
- **CLI**: `--format github-pr` flag acceptance
- **Action**: action.yml step and permissions declaration

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
2. `bash ~/.openclaw/skills/pipeline/scripts/agent-dev.sh --run-id 90f449b1-ea19-4cc1-b070-e528bbec40f8`
3. Read `.agent-dev.json` for the assigned port
4. `curl http://localhost:<port>/health`
5. `bash ~/.openclaw/skills/pipeline/scripts/agent-dev-cleanup.sh --run-id 90f449b1-ea19-4cc1-b070-e528bbec40f8`

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