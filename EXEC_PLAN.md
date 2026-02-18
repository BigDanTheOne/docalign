# EXEC_PLAN — Add QA agent and test-writing stage to all pipelines

Run ID: `f08aaaa5-be24-4037-be73-e59e783f5ce6`
Pipeline type: feature
Branch: `feature/f08aaaa5`
Generated: 2026-02-17T12:39:52.349Z

## Purpose / Big Picture

# Decision Document — Add QA Agent and Test-Writing Stage to All Pipelines

**Run ID**: f08aaaa5-be24-4037-be73-e59e783f5ce6
**Date**: 2026-02-17
**Decision**: BUILD
**Convergence**: Round 1 (unanimous)

---

## Summary

All four personas (PM, Tech Lead, Critic, GTM) converge on BUILD. The feature introduces a dedicated QA agent that writes acceptance/contract tests BEFORE the build stage, creating an independent verification layer between design intent and implementation. This addresses the fundamental "grading your own homework" problem where the build agent currently writes both code and tests.

## Verdicts

| Persona | Verdict | Confidence |
|---------|---------|------------|
| PM | Build | High |
| Tech Lead | Build | High |
| Critic | Build with modifications | Medium |
| GTM | Build | High |

## Adopted Patterns

1. **Independent test authorship**: QA agent writes tests based on specs and acceptance criteria, not implementation. Build agent must make these tests pass without modifying them.
2. **Stage insertion, not replacement**: New `qa_tests` stages slot into existing pipeline flows (after plan/define, before build) without changing existing stage types.
3. **Existing worktree pattern**: QA tests are staged in outputs, then copied to worktree on `advance --stage build` — follows the same pattern as EXEC_PLAN.md assembly.
4. **Convention-based separation**: `test/qa/` directory with `*.qa.test.ts` naming, `npm run test:qa` and `npm run test:builder` scripts for clean separation.
5. **QA-DISPUTE mechanism**: Build agent can skip impossible QA tests with `.skip()` + `// QA-DISPUTE: <reason>`, adjudicated by code review.

## Critic Conditions (incorporated)

1. **QA-DISPUTE threshold**: If >30% of QA tests are skipped via `.skip()`, code review should auto-reject. Document this in orchestrator instructions.
2. **Task pipeline `task_define` tradeoff**: The orchestrator writes acceptance criteria for tasks (mild self-grading), accepted as a pragmatic tradeoff for task pipeline speed. PM writes criteria for features/epics where the stakes are higher.
3. **QA test coupling risk**: QA agent instructions must emphasize testing PUBLIC INTERFACES and BEHAVIORS, not internal structure. The plan already specifies this ("Tests import only from public module interfaces") — enforce in QA agent AGENTS.md.

## Rejected/Deferred Patterns

- None rejected. All proposed patterns adopted.

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| QA test quality depends on spec quality | Existing spec review stage gates quality before QA |
| QA tests coupled to implementation details | QA agent instructions enforce public interface testing only |
| Stale QA tests on code review loops | Acceptable: QA tests represent original design contract; code review loops go to build, not qa_tests |
| Task pipeline latency increase | task_define is lightweight (3-5 bullets); QA tests for tasks are brief |
| Epic integration tests pre-children | Tests staged in outputs, fail until children built — expected behavior |

## Implementation Scope

- 1 new agent workspace (QA: 7 files)
- 3 pipeline YAML updates (task, feature, epic)
- 1 pipeline.js update (copyQaTestsToWorktree, cmdAdvance, assembleExecPlan)
- 1 package.json update (test:qa, test:builder scripts)
- 1 orchestrator AGENTS.md update
- 1 new directory (test/qa/.gitkeep)

Complexity: LOW (per Tech Lead). All infrastructure changes follow existing patterns.

## CEO Approval Gate

This decision document requires CEO approval before proceeding to the define stage.

## Progress

- [ ] Implementation Order
- [ ] Task 1: Create QA Agent Workspace
- [ ] `~/.openclaw/agents/qa/AGENTS.md`
- [ ] `~/.openclaw/agents/qa/IDENTITY.md`
- [ ] `~/.openclaw/agents/qa/SOUL.md`
- [ ] `~/.openclaw/agents/qa/TOOLS.md`
- [ ] `~/.openclaw/agents/qa/USER.md`
- [ ] `~/.openclaw/agents/qa/HEARTBEAT.md`
- [ ] `~/.openclaw/agents/qa/BOOTSTRAP.md`
- [ ] Follow the exact same pattern as `~/.openclaw/agents/pm/`, `~/.openclaw/agents/critic/`, `~/.openclaw/agents/tech-lead/`
- [ ] AGENTS.md is the core file — evaluation lens: TESTABILITY and DESIGN CONTRACTS
- [ ] Key behaviors to specify:
- [ ] Translate specs + acceptance criteria into executable Vitest test suites
- [ ] Test PUBLIC INTERFACES only, never import from `src/` internals
- [ ] Tests designed to FAIL until implementation exists
- [ ] All describe blocks tagged with `[QA]` for identification
- [ ] File naming: `*.qa.test.ts` under `test/qa/<feature-slug>/`
- [ ] Flag untestable criteria explicitly in UNMOCKABLE section
- [ ] Output format: QA_TEST_PLAN (acceptance_criteria_ref, test_file, test_cases, coverage_notes), FILES_WRITTEN, UNMOCKABLE, CONFIDENCE
- [ ] Soft guidelines from PM review: 1-2 test files for tasks, 2-5 for features, 3-8 for epic integration
- [ ] describe block format: `describe('[QA] AC-1: ...')` to map to acceptance criteria
- [ ] IDENTITY.md: QA Engineer — methodical, design-contract focused, adversarial toward implementation
- [ ] SOUL.md: Core principle about tests as contracts between design and implementation
- [ ] TOOLS.md: File system for writing test files, Vitest reference, pipeline output access
- [ ] USER.md: Standard template (same as other agents)
- [ ] HEARTBEAT.md: Empty/comments only (same as PM)
- [ ] BOOTSTRAP.md: Standard bootstrap (same as PM)
- [ ] Task 2: Create Test Directory
- [ ] `~/docalign/test/qa/.gitkeep`
- [ ] Create the `test/qa/` directory with a `.gitkeep` placeholder
- [ ] This is where QA-authored tests live in the repo
- [ ] Task 3: Update Task Pipeline YAML
- [ ] `~/docalign/_team/pipelines/task.yml`
- [ ] Add `task_define` stage after `research` / `research_check`, before `build`:
- [ ] id: task_define
- [ ] Add `qa_tests` stage after `task_define`, before `build`:
- [ ] id: qa_tests
- [ ] Change `research_check.next_if_no` from `build` to `task_define`
- [ ] Change `research.next` from `build` to `task_define`
- [ ] Task 4: Update Feature Pipeline YAML
- [ ] `~/docalign/_team/pipelines/feature.yml`
- [ ] Add `qa_tests` stage after `plan`, before `build`:
- [ ] id: qa_tests
- [ ] Change `plan.next` from `build` to `qa_tests`
- [ ] Task 5: Update Epic Pipeline YAML
- [ ] `~/docalign/_team/pipelines/epic.yml`
- [ ] Add `qa_integration_tests` stage after `ceo_decompose_approval`, before `execute_children`:
- [ ] id: qa_integration_tests
- [ ] Change `ceo_decompose_approval.on_approve` from `execute_children` to `qa_integration_tests`
- [ ] Task 6: Add copyQaTestsToWorktree to pipeline.js
- [ ] `~/.openclaw/skills/pipeline/scripts/pipeline.js`
- [ ] Check two source directories:
- [ ] `_team/outputs/<runId>/qa_tests/files/`
- [ ] `_team/outputs/<runId>/qa_integration_tests/files/`
- [ ] Recursively walk each, copy files preserving relative paths to `wtPath`
- [ ] Return array of copied relative paths (empty array if nothing to copy)
- [ ] Use `fs.existsSync`, `fs.readdirSync`, `fs.mkdirSync(recursive)`, `fs.copyFileSync`
- [ ] In the `if (stage === 'build')` block:
- [ ] After `createWorktree(runId)`, before `assembleExecPlan()`:
- [ ] Call `const qaFiles = copyQaTestsToWorktree(runId, wt.worktree_path)`
- [ ] After `result.exec_plan = execPlanPath`:
- [ ] Add `if (qaFiles.length > 0) result.qa_test_files = qaFiles`
- [ ] After the "Plan of Work" section and before the "Specification" section:
- [ ] Read `qa_tests/qa.md` and `qa_integration_tests/qa.md` via `readArtifact`
- [ ] If either exists, add "QA Test Requirements (MUST PASS)" section with:
- [ ] Explanation that QA tests are pre-written and must pass
- [ ] Instructions: do NOT modify QA test files; use `.skip()` + `// QA-DISPUTE: <reason>` for impossible tests
- [ ] `npm run test:qa` command
- [ ] QA manifest content
- [ ] QA integration test manifest content (if exists)
- [ ] Update the Validation section to add `npm run test:qa` step
- [ ] Update the Final validation section to add `npm run test:qa` step
- [ ] Function exists and handles empty directories gracefully
- [ ] `advance --stage build` copies QA test files to worktree
- [ ] EXEC_PLAN.md contains QA section when manifest exists
- [ ] Existing pipeline tests still pass
- [ ] Task 7: Add npm Scripts to package.json
- [ ] `~/docalign/package.json`
- [ ] Add after the existing `"test": "vitest run"` line:
- [ ] `npm run test:qa` runs (finds test/qa/ directory, passes with 0 tests)
- [ ] `npm run test:builder` runs (excludes test/qa/ files)
- [ ] Existing `npm test` unchanged
- [ ] Task 8: Update Orchestrator AGENTS.md
- [ ] `~/.openclaw/agents/orchestrator/AGENTS.md`
- [ ] `qa` — QA Engineer (testability and design contracts)
- [ ] Document QA stage execution pattern for all three pipeline types
- [ ] Feature: spawn QA with define/pm.md, spec/tech-lead.md, plan/tech-lead.md, decision.md
- [ ] Task: spawn QA with task_define/orchestrator.md, optional research output
- [ ] Epic: spawn QA with decompose/pm.md, decompose/tech-lead.md, decision.md
- [ ] Output storage: `_team/outputs/<run_id>/qa_tests/qa.md` (manifest) and `qa_tests/files/test/qa/<slug>/*.qa.test.ts` (test files)
- [ ] Epic integration tests: `_team/outputs/<run_id>/qa_integration_tests/` (same pattern)
- [ ] All acceptance criteria from define stage are met
- [ ] All tasks from plan stage are completed
- [ ] QA tests pass: `npm run test:qa` — 0 failures (design contract validation)
- [ ] Builder tests pass: `npm run test:builder` — 0 failures (implementation tests)
- [ ] Full suite passes: `npm run test` — 0 failures
- [ ] CI `build-and-test` passes on the PR
- [ ] No regressions in existing tests
- [ ] All PR conversations resolved
- [ ] Rebase + merge to main
- [ ] Each skipped test MUST have a `followups.json` entry with status `not_applicable`
- [ ] Rationale must explain why the test is infeasible
- [ ] If rationale is insufficient, loop back to build
- [ ] If >30% of QA tests are skipped, code review auto-rejects (threshold violation)
- [ ] Task 9: Sync pipeline.js
- [ ] `~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js`
- [ ] Copy `~/.openclaw/skills/pipeline/scripts/pipeline.js` to `~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js`
- [ ] Verify both files are identical
- [ ] Session Grouping
- [ ] Validation (after all tasks)
- [ ] `cd ~/docalign && node -e "const yaml = require('js-yaml'); const fs = require('fs'); ['task', 'feature', 'epic'].forEach(t => { yaml.load(fs.readFileSync('_team/pipelines/' + t + '.yml', 'utf8')); console.log(t + '.yml: valid'); });"` — all 3 YAML files parse
- [ ] `cd ~/docalign && npx jest .openclaw/skills/pipeline/scripts/pipeline-gate-format.test.js` — existing tests pass
- [ ] `npm run test:qa` — runs successfully (0 tests, 0 failures)
- [ ] `npm run test:builder` — runs successfully, excludes test/qa/
- [ ] `diff ~/.openclaw/skills/pipeline/scripts/pipeline.js ~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js` — no differences
- [ ] Verify QA agent workspace: all 7 files present in `~/.openclaw/agents/qa/`
- [ ] Verify EXEC_PLAN.md assembly: manually check that `assembleExecPlan` code references QA manifest
- [ ] Risk Hotspots
- [ ] Acceptance Criteria Mapping
- [ ] Push branch and open PR
- [ ] All tests pass (`npm run typecheck && npm run test`)

## Context and Orientation

### Working Directory
`/Users/kotkot/docalign-worktrees/f08aaaa5`

### Key Conventions
- Run `npm run typecheck && npm run test` after every change
- Run `npm run lint:fix` after every file edit
- Run `npm run lint:agent` for errors with remediation hints
- Follow existing patterns in `src/` — strict TypeScript, Zod validation, Pino logging
- See `CLAUDE.md` in repo root for full conventions
- See `CONVENTIONS.md` for coding style reference

### Stage History
- **debate_round1** (pm): completed — BUILD. High-leverage internal infra. Well-scoped. Acceptance criteria testable. Risk: QA test quality depends on spec quality, mitigated by existing spec review.
- **debate_round1** (tech-lead): completed — BUILD. Low complexity. All infrastructure changes follow existing patterns. copyQaTestsToWorktree is simple recursive copy. Vitest handles pre-build test failures gracefully.
- **debate_round1** (critic): completed — BUILD WITH MODIFICATIONS. Core concept sound. Conditions: QA-DISPUTE threshold (30% skip auto-reject), task_define self-grading tradeoff acceptable. Risks: QA test coupling to implementation, stale tests on review loops — manageable.
- **debate_round1** (gtm): completed — BUILD. Strong internal content angle: AI agents holding each other accountable. Fits build-in-public narrative. Engineering blog + tweet thread potential. No direct user-facing feature to announce.
- **define** (pm): completed — Defined 11 acceptance criteria covering QA agent workspace, 3 pipeline YAML updates, pipeline.js changes, package.json scripts, orchestrator docs, and test directory. Scope boundaries and definition of done established.
- **spec** (tech-lead): completed — Technical spec written. 7 new files (QA agent workspace), 6 modified files (3 pipeline YAMLs, pipeline.js, package.json, orchestrator AGENTS.md). ~300 lines added. No core src/ changes. No breaking changes. Full test strategy included.
- **spec_review** (pm): completed — APPROVE. Spec maps to all 11 ACs. Well-scoped. Suggestions: add test file count guidelines and describe block naming convention to QA AGENTS.md.
- **spec_review** (critic): completed — APPROVE. LOW risk. All edge cases handled: empty QA files, slug collision mitigated by separate worktrees, Vitest exclude pattern verified. No critical missing items.
- **plan** (tech-lead): completed — Execution plan produced: 9 tasks, single session, ~2h. All 11 ACs mapped to tasks. Sequential order: QA agent workspace, test directory, 3 YAML updates, pipeline.js changes, package.json, orchestrator docs, sync.

## Plan of Work

# Execution Plan — QA Agent and Test-Writing Stage

**Run ID**: f08aaaa5-be24-4037-be73-e59e783f5ce6
**Author**: Tech Lead
**Date**: 2026-02-17

---

## Implementation Order

9 tasks, single session, ~2-3 hours estimated. All tasks are sequential (each builds on the prior). No parallelism needed — this is a small infrastructure-only change.

---

### Task 1: Create QA Agent Workspace

**Files created**:
- `~/.openclaw/agents/qa/AGENTS.md`
- `~/.openclaw/agents/qa/IDENTITY.md`
- `~/.openclaw/agents/qa/SOUL.md`
- `~/.openclaw/agents/qa/TOOLS.md`
- `~/.openclaw/agents/qa/USER.md`
- `~/.openclaw/agents/qa/HEARTBEAT.md`
- `~/.openclaw/agents/qa/BOOTSTRAP.md`

**Details**:
- Follow the exact same pattern as `~/.openclaw/agents/pm/`, `~/.openclaw/agents/critic/`, `~/.openclaw/agents/tech-lead/`
- AGENTS.md is the core file — evaluation lens: TESTABILITY and DESIGN CONTRACTS
- Key behaviors to specify:
  - Translate specs + acceptance criteria into executable Vitest test suites
  - Test PUBLIC INTERFACES only, never import from `src/` internals
  - Tests designed to FAIL until implementation exists
  - All describe blocks tagged with `[QA]` for identification
  - File naming: `*.qa.test.ts` under `test/qa/<feature-slug>/`
  - Flag untestable criteria explicitly in UNMOCKABLE section
- Output format: QA_TEST_PLAN (acceptance_criteria_ref, test_file, test_cases, coverage_notes), FILES_WRITTEN, UNMOCKABLE, CONFIDENCE
- Soft guidelines from PM review: 1-2 test files for tasks, 2-5 for features, 3-8 for epic integration
- describe block format: `describe('[QA] AC-1: ...')` to map to acceptance criteria
- IDENTITY.md: QA Engineer — methodical, design-contract focused, adversarial toward implementation
- SOUL.md: Core principle about tests as contracts between design and implementation
- TOOLS.md: File system for writing test files, Vitest reference, pipeline output access
- USER.md: Standard template (same as other agents)
- HEARTBEAT.md: Empty/comments only (same as PM)
- BOOTSTRAP.md: Standard bootstrap (same as PM)

**Test criteria**: All 7 files exist, AGENTS.md contains evaluation lens, output format, and naming conventions.

**Depends on**: Nothing

---

### Task 2: Create Test Directory

**Files created**:
- `~/docalign/test/qa/.gitkeep`

**Details**:
- Create the `test/qa/` directory with a `.gitkeep` placeholder
- This is where QA-authored tests live in the repo

**Test criteria**: `test/qa/.gitkeep` exists.

**Depends on**: Nothing

---

### Task 3: Update Task Pipeline YAML

**Files modified**:
- `~/docalign/_team/pipelines/task.yml`

**Details**:
- Add `task_define` stage after `research` / `research_check`, before `build`:
  ```yaml
  - id: task_define
    description: "Orchestrator writes brief acceptance criteria from task request"
    type: work
    agent: orchestrator
    autonomous: true
    next: qa_tests
  ```
- Add `qa_tests` stage after `task_define`, before `build`:
  ```yaml
  - id: qa_tests
    description: "QA writes lightweight acceptance tests for the task"
    type: work
    agent: qa
    autonomous: true
    next: build
  ```
- Change `research_check.next_if_no` from `build` to `task_define`
- Change `research.next` from `build` to `task_define`

**Test criteria**: YAML parses without errors. Stage flow: request -> research_check -> [research?] -> task_define -> qa_tests -> build. All 4 pointer changes verified.

**Depends on**: Nothing

---

### Task 4: Update Feature Pipeline YAML

**Files modified**:
- `~/docalign/_team/pipelines/feature.yml`

**Details**:
- Add `qa_tests` stage after `plan`, before `build`:
  ```yaml
  - id: qa_tests
    description: "QA writes acceptance/contract tests based on spec, plan, and acceptance criteria"
    type: work
    agent: qa
    autonomous: true
    next: build
  ```
- Change `plan.next` from `build` to `qa_tests`

**Test criteria**: YAML parses without errors. Stage flow: ... -> plan -> qa_tests -> build -> ... Pointer change verified.

**Depends on**: Nothing

---

### Task 5: Update Epic Pipeline YAML

**Files modified**:
- `~/docalign/_team/pipelines/epic.yml`

**Details**:
- Add `qa_integration_tests` stage after `ceo_decompose_approval`, before `execute_children`:
  ```yaml
  - id: qa_integration_tests
    description: "QA writes integration tests verifying child features work together"
    type: work
    agent: qa
    autonomous: true
    next: execute_children
  ```
- Change `ceo_decompose_approval.on_approve` from `execute_children` to `qa_integration_tests`

**Test criteria**: YAML parses without errors. Stage flow: ... -> ceo_decompose_approval -> qa_integration_tests -> execute_children -> ... Pointer change verified.

**Depends on**: Nothing

---

### Task 6: Add copyQaTestsToWorktree to pipeline.js

**Files modified**:
- `~/.openclaw/skills/pipeline/scripts/pipeline.js`

**Details**:

**6a. New function `copyQaTestsToWorktree(runId, wtPath)`** — insert after `assembleExecPlan` function (~line 413):
- Check two source directories:
  - `_team/outputs/<runId>/qa_tests/files/`
  - `_team/outputs/<runId>/qa_integration_tests/files/`
- Recursively walk each, copy files preserving relative paths to `wtPath`
- Return array of copied relative paths (empty array if nothing to copy)
- Use `fs.existsSync`, `fs.readdirSync`, `fs.mkdirSync(recursive)`, `fs.copyFileSync`

**6b. Modify `cmdAdvance()`** (~line 578):
- In the `if (stage === 'build')` block:
  - After `createWorktree(runId)`, before `assembleExecPlan()`:
    - Call `const qaFiles = copyQaTestsToWorktree(runId, wt.worktree_path)`
  - After `result.exec_plan = execPlanPath`:
    - Add `if (qaFiles.length > 0) result.qa_test_files = qaFiles`

**6c. Modify `assembleExecPlan()`** (~line 254):
- After the "Plan of Work" section and before the "Specification" section:
  - Read `qa_tests/qa.md` and `qa_integration_tests/qa.md` via `readArtifact`
  - If either exists, add "QA Test Requirements (MUST PASS)" section with:
    - Explanation that QA tests are pre-written and must pass
    - Instructions: do NOT modify QA test files; use `.skip()` + `// QA-DISPUTE: <reason>` for impossible tests
    - `npm run test:qa` command
    - QA manifest content
    - QA integration test manifest content (if exists)
- Update the Validation section to add `npm run test:qa` step
- Update the Final validation section to add `npm run test:qa` step

**Test criteria**:
- Function exists and handles empty directories gracefully
- `advance --stage build` copies QA test files to worktree
- EXEC_PLAN.md contains QA section when manifest exists
- Existing pipeline tests still pass

**Depends on**: Nothing (but must be done before Task 9 sync)

---

### Task 7: Add npm Scripts to package.json

**Files modified**:
- `~/docalign/package.json`

**Details**:
- Add after the existing `"test": "vitest run"` line:
  ```json
  "test:qa": "vitest run test/qa/",
  "test:builder": "vitest run --exclude 'test/qa/**'"
  ```

**Test criteria**:
- `npm run test:qa` runs (finds test/qa/ directory, passes with 0 tests)
- `npm run test:builder` runs (excludes test/qa/ files)
- Existing `npm test` unchanged

**Depends on**: Task 2 (test/qa/ directory must exist)

---

### Task 8: Update Orchestrator AGENTS.md

**Files modified**:
- `~/.openclaw/agents/orchestrator/AGENTS.md`

**Details**:

**8a. Add QA to "Available personas to spawn"** (after line ~70):
```
- `qa` — QA Engineer (testability and design contracts)
```

**8b. Add "QA Test Stage" section** (after "Plan Stage", before "Git Worktree Isolation"):
- Document QA stage execution pattern for all three pipeline types
- Feature: spawn QA with define/pm.md, spec/tech-lead.md, plan/tech-lead.md, decision.md
- Task: spawn QA with task_define/orchestrator.md, optional research output
- Epic: spawn QA with decompose/pm.md, decompose/tech-lead.md, decision.md
- Output storage: `_team/outputs/<run_id>/qa_tests/qa.md` (manifest) and `qa_tests/files/test/qa/<slug>/*.qa.test.ts` (test files)
- Epic integration tests: `_team/outputs/<run_id>/qa_integration_tests/` (same pattern)

**8c. Update "Verification Stage" checklist** to include:
1. All acceptance criteria from define stage are met
2. All tasks from plan stage are completed
3. QA tests pass: `npm run test:qa` — 0 failures (design contract validation)
4. Builder tests pass: `npm run test:builder` — 0 failures (implementation tests)
5. Full suite passes: `npm run test` — 0 failures
6. CI `build-and-test` passes on the PR
7. No regressions in existing tests
8. All PR conversations resolved
9. Rebase + merge to main

**8d. Add QA-DISPUTE handling subsection**:
- Each skipped test MUST have a `followups.json` entry with status `not_applicable`
- Rationale must explain why the test is infeasible
- If rationale is insufficient, loop back to build
- If >30% of QA tests are skipped, code review auto-rejects (threshold violation)

**Test criteria**: All 4 sections present in AGENTS.md. QA listed as spawnable persona.

**Depends on**: Nothing

---

### Task 9: Sync pipeline.js

**Files modified**:
- `~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js`

**Details**:
- Copy `~/.openclaw/skills/pipeline/scripts/pipeline.js` to `~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js`
- Verify both files are identical

**Test criteria**: `diff` between source and destination shows no differences.

**Depends on**: Task 6 (pipeline.js modifications must be complete first)

---

## Session Grouping

All 9 tasks fit in a single build session (~2-3 hours):

| Order | Task | Effort Est. | Description |
|-------|------|:-----------:|-------------|
| 1 | Task 1 | 30min | QA agent workspace (7 files) |
| 2 | Task 2 | 1min | test/qa/.gitkeep |
| 3 | Task 3 | 10min | task.yml update |
| 4 | Task 4 | 5min | feature.yml update |
| 5 | Task 5 | 5min | epic.yml update |
| 6 | Task 6 | 45min | pipeline.js (function + 2 modifications) |
| 7 | Task 7 | 5min | package.json scripts |
| 8 | Task 8 | 20min | orchestrator AGENTS.md |
| 9 | Task 9 | 2min | pipeline.js sync |

**Total estimated**: ~2 hours

---

## Validation (after all tasks)

1. `cd ~/docalign && node -e "const yaml = require('js-yaml'); const fs = require('fs'); ['task', 'feature', 'epic'].forEach(t => { yaml.load(fs.readFileSync('_team/pipelines/' + t + '.yml', 'utf8')); console.log(t + '.yml: valid'); });"` — all 3 YAML files parse
2. `cd ~/docalign && npx jest .openclaw/skills/pipeline/scripts/pipeline-gate-format.test.js` — existing tests pass
3. `npm run test:qa` — runs successfully (0 tests, 0 failures)
4. `npm run test:builder` — runs successfully, excludes test/qa/
5. `diff ~/.openclaw/skills/pipeline/scripts/pipeline.js ~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js` — no differences
6. Verify QA agent workspace: all 7 files present in `~/.openclaw/agents/qa/`
7. Verify EXEC_PLAN.md assembly: manually check that `assembleExecPlan` code references QA manifest

---

## Risk Hotspots

| Risk | Task | Mitigation |
|------|------|------------|
| Vitest `--exclude` glob syntax | Task 7 | Verify with `npm run test:builder` — if Vitest rejects the glob, try `'!test/qa/**'` syntax |
| pipeline.js line numbers shifted | Task 6 | The spec references approximate line numbers. Build agent must find the actual insertion points by searching for `assembleExecPlan`, `cmdAdvance`, and `if (stage === 'build')` patterns |
| YAML indentation errors | Tasks 3-5 | Validate with js-yaml parser immediately after each edit |
| QA agent AGENTS.md completeness | Task 1 | Cross-reference all 4 AC-1 sub-criteria during writing |

---

## Acceptance Criteria Mapping

| AC | Task(s) | Validation |
|----|---------|-----------|
| AC-1: QA Agent Workspace | Task 1 | 7 files, evaluation lens, naming convention, output format |
| AC-2: Task Pipeline | Task 3 | task_define + qa_tests stages, 2 pointer changes |
| AC-3: Feature Pipeline | Task 4 | qa_tests stage, 1 pointer change |
| AC-4: Epic Pipeline | Task 5 | qa_integration_tests stage, 1 pointer change |
| AC-5: copyQaTestsToWorktree | Task 6a | Function exists, recursive copy, graceful empty handling |
| AC-6: cmdAdvance Updated | Task 6b | Calls copy before assemble, qa_test_files in response |
| AC-7: assembleExecPlan Updated | Task 6c | QA section in EXEC_PLAN, validation steps updated |
| AC-8: package.json Scripts | Task 7 | test:qa and test:builder scripts |
| AC-9: Test Directory | Task 2 | test/qa/.gitkeep exists |
| AC-10: Orchestrator AGENTS.md | Task 8 | QA persona, QA stage docs, verify checklist, dispute flow |
| AC-11: pipeline.js Synced | Task 9 | diff shows no differences |

## Specification

# Technical Specification — QA Agent and Test-Writing Stage

**Run ID**: f08aaaa5-be24-4037-be73-e59e783f5ce6
**Author**: Tech Lead
**Date**: 2026-02-17

---

## 1. Overview

This feature adds a QA agent persona and pre-build test-writing stages to all three pipeline types. The QA agent writes acceptance/contract tests based on specs and acceptance criteria BEFORE the build stage executes. The build agent must make these tests pass. The verify stage validates both QA-authored and builder-authored tests.

No core DocAlign source code (src/) is modified. All changes are to infrastructure: agent workspace, pipeline configs, pipeline.js, orchestrator docs, and package.json scripts.

---

## 2. Architecture

### Data Flow

```
[Spec/Plan/Define artifacts]
        |
        v
  QA Agent (writes tests)
        |
        v
  _team/outputs/<runId>/qa_tests/files/test/qa/<slug>/*.qa.test.ts
  _team/outputs/<runId>/qa_tests/qa.md (manifest)
        |
        v
  pipeline.js advance --stage build
        |
        v
  copyQaTestsToWorktree() → worktree/test/qa/<slug>/*.qa.test.ts
  assembleExecPlan() → EXEC_PLAN.md includes QA section
        |
        v
  Build agent implements code, runs `npm run test:qa`
        |
        v
  Verify stage confirms both QA + builder tests pass
```

### File Layout

```
~/.openclaw/agents/qa/          # NEW: QA agent workspace
  AGENTS.md
  IDENTITY.md
  SOUL.md
  TOOLS.md
  USER.md
  HEARTBEAT.md
  BOOTSTRAP.md

~/docalign/test/qa/             # NEW: QA test directory
  .gitkeep

~/docalign/_team/outputs/<runId>/qa_tests/
  qa.md                         # QA manifest (test plan)
  files/test/qa/<slug>/         # Staged test files
    acceptance.qa.test.ts
    contracts.qa.test.ts

~/docalign/_team/outputs/<runId>/qa_integration_tests/   # Epic only
  qa.md
  files/test/qa/integration/
    cross-feature.qa.test.ts
```

---

## 3. Changes by File

### 3.1 QA Agent Workspace — `~/.openclaw/agents/qa/`

Create 7 files following the existing agent pattern (pm, critic, tech-lead as templates).

**AGENTS.md** — Core identity file:
- Evaluation lens: TESTABILITY and DESIGN CONTRACTS
- Key behaviors: translate specs into executable Vitest test suites, test public interfaces only, tests designed to FAIL until implementation exists, describe blocks tagged with `[QA]`, file naming `*.qa.test.ts` under `test/qa/<feature-slug>/`, flag untestable criteria explicitly
- Output format: QA_TEST_PLAN (with acceptance_criteria_ref, test_file, test_cases, coverage_notes), FILES_WRITTEN, UNMOCKABLE, CONFIDENCE
- Explicit prohibition: do NOT test internal module structure, do NOT import from `src/` internals
- Context: DocAlign tech stack (Vitest, TypeScript, Zod), layered architecture reference

**IDENTITY.md**: QA Engineer identity — methodical, design-contract focused, adversarial toward implementation (not toward people)

**SOUL.md**: Core principle: "Tests are a contract between design and implementation. They should fail loudly when the contract is broken."

**TOOLS.md**: Available tools — file system for writing test files, Vitest for test framework reference, access to pipeline outputs for reading specs/plans

**USER.md**: Interaction style — structured, precise, references acceptance criteria by number

**HEARTBEAT.md**: Standard heartbeat template (match existing agents)

**BOOTSTRAP.md**: Standard bootstrap template (match existing agents)

### 3.2 Task Pipeline — `~/docalign/_team/pipelines/task.yml`

**Add two new stages** (insert after `research`, before `build`):

```yaml
  - id: task_define
    description: "Orchestrator writes brief acceptance criteria from task request"
    type: work
    agent: orchestrator
    autonomous: true
    next: qa_tests

  - id: qa_tests
    description: "QA writes lightweight acceptance tests for the task"
    type: work
    agent: qa
    autonomous: true
    next: build
```

**Modify existing pointers**:
- `research_check.next_if_no`: change from `build` to `task_define`
- `research.next`: change from `build` to `task_define`

### 3.3 Feature Pipeline — `~/docalign/_team/pipelines/feature.yml`

**Add one new stage** (insert after `plan`, before `build`):

```yaml
  - id: qa_tests
    description: "QA writes acceptance/contract tests based on spec, plan, and acceptance criteria"
    type: work
    agent: qa
    autonomous: true
    next: build
```

**Modify existing pointer**:
- `plan.next`: change from `build` to `qa_tests`

### 3.4 Epic Pipeline — `~/docalign/_team/pipelines/epic.yml`

**Add one new stage** (insert after `ceo_decompose_approval`, before `execute_children`):

```yaml
  - id: qa_integration_tests
    description: "QA writes integration tests verifying child features work together"
    type: work
    agent: qa
    autonomous: true
    next: execute_children
```

**Modify existing pointer**:
- `ceo_decompose_approval.on_approve`: change from `execute_children` to `qa_integration_tests`

### 3.5 pipeline.js — `~/.openclaw/skills/pipeline/scripts/pipeline.js`

Three modifications to the file (currently 956 lines):

#### 3.5a New function: `copyQaTestsToWorktree()` (insert at line ~413, after `assembleExecPlan`)

```javascript
/**
 * Copy QA-authored test files from staging area into the worktree.
 * Called during advance --stage build, before assembleExecPlan.
 *
 * Checks two source directories:
 *   - _team/outputs/<runId>/qa_tests/files/       (feature/task QA tests)
 *   - _team/outputs/<runId>/qa_integration_tests/files/  (epic integration QA tests)
 *
 * Files are copied preserving relative paths (e.g., test/qa/slug/foo.qa.test.ts).
 *
 * @param {string} runId
 * @param {string} wtPath - Worktree root path
 * @returns {string[]} List of copied file paths (relative to worktree)
 */
function copyQaTestsToWorktree(runId, wtPath) {
  const outputsDir = path.join(TEAM_DIR, 'outputs', runId);
  const sources = [
    path.join(outputsDir, 'qa_tests', 'files'),
    path.join(outputsDir, 'qa_integration_tests', 'files'),
  ];

  const copied = [];

  for (const srcRoot of sources) {
    if (!fs.existsSync(srcRoot)) continue;

    // Recursive walk
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          const relPath = path.relative(srcRoot, fullPath);
          const destPath = path.join(wtPath, relPath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(fullPath, destPath);
          copied.push(relPath);
        }
      }
    };

    walk(srcRoot);
  }

  return copied;
}
```

#### 3.5b Modify `cmdAdvance()` (line ~578)

Current code:
```javascript
if (stage === 'build') {
  const wt = createWorktree(runId);
  const execPlanPath = assembleExecPlan(runId, wt.worktree_path);
  result.worktree = wt;
  result.exec_plan = execPlanPath;
}
```

New code:
```javascript
if (stage === 'build') {
  const wt = createWorktree(runId);
  const qaFiles = copyQaTestsToWorktree(runId, wt.worktree_path);
  const execPlanPath = assembleExecPlan(runId, wt.worktree_path);
  result.worktree = wt;
  result.exec_plan = execPlanPath;
  if (qaFiles.length > 0) result.qa_test_files = qaFiles;
}
```

Note: `copyQaTestsToWorktree` runs BEFORE `assembleExecPlan` so that the exec plan can reference the QA test files that were just copied.

#### 3.5c Modify `assembleExecPlan()` (line ~254)

**Add QA Test Requirements section** — insert after the "Plan of Work" section (after line ~352) and before "Specification":

```javascript
  // QA Test Requirements
  const qaManifest = readArtifact(path.join(outputsDir, 'qa_tests', 'qa.md'));
  const qaIntManifest = readArtifact(path.join(outputsDir, 'qa_integration_tests', 'qa.md'));
  if (qaManifest || qaIntManifest) {
    sections.push(`\n## QA Test Requirements (MUST PASS)\n`);
    sections.push(`Pre-written QA tests have been placed in this worktree under \`test/qa/\`.`);
    sections.push(`These tests validate design contracts — they will FAIL until implementation is correct.\n`);
    sections.push(`**Your implementation MUST make all QA tests pass. Do NOT modify QA test files.**`);
    sections.push(`If a QA test is impossible to satisfy, add \`.skip()\` with a \`// QA-DISPUTE: <reason>\` comment`);
    sections.push(`and document it in the Surprises & Discoveries section.\n`);
    sections.push(`Run QA tests: \`npm run test:qa\`\n`);
    if (qaManifest) sections.push(`### QA Test Manifest\n\n${qaManifest}`);
    if (qaIntManifest) sections.push(`### QA Integration Test Manifest\n\n${qaIntManifest}`);
  }
```

**Update Validation section** (line ~374):

Add after line 377 (step 3, before the blank line):
```javascript
  sections.push(`4. Run \`npm run test:qa\` — QA acceptance tests must pass (0 failures)`);
```

Update the "Final validation" section to add:
```javascript
  sections.push(`4. Run \`npm run test:qa\` separately to confirm design contracts`);
```

### 3.6 package.json — `~/docalign/package.json`

Add two new scripts in the `scripts` section:
```json
"test:qa": "vitest run test/qa/",
"test:builder": "vitest run --exclude 'test/qa/**'"
```

Insert after the existing `"test": "vitest run"` line (line 25).

### 3.7 Orchestrator AGENTS.md — `~/.openclaw/agents/orchestrator/AGENTS.md`

#### Add to "Available personas to spawn" (after line 70):
```
- `qa` — QA Engineer (testability and design contracts)
```

#### Add new section "QA Test Stage" (after "Plan Stage", before "Git Worktree Isolation"):

```markdown
## QA Test Stage (Feature/Task/Epic pipelines)

After plan (feature) or task_define (task) or CEO decompose approval (epic), the QA agent writes tests:

1. Advance pipeline to `qa_tests` (or `qa_integration_tests` for epics)
2. Spawn QA agent with all prior artifacts:
   - Feature: define/pm.md, spec/tech-lead.md, plan/tech-lead.md, decision.md
   - Task: task_define/orchestrator.md, optional research output
   - Epic: decompose/pm.md, decompose/tech-lead.md, decision.md
3. QA writes test files to `_team/outputs/<run_id>/qa_tests/files/test/qa/<slug>/`
4. QA writes manifest to `_team/outputs/<run_id>/qa_tests/qa.md`
5. On completion, advance to build — pipeline.js auto-copies QA tests to worktree

### QA output storage:
- Manifest: `~/docalign/_team/outputs/<run_id>/qa_tests/qa.md`
- Test files: `~/docalign/_team/outputs/<run_id>/qa_tests/files/test/qa/<slug>/*.qa.test.ts`
- Epic integration: `~/docalign/_team/outputs/<run_id>/qa_integration_tests/` (same pattern)
```

#### Update "Verification Stage" checklist:

Replace existing checklist with:
1. All acceptance criteria from define stage are met
2. All tasks from plan stage are completed
3. QA tests pass: `npm run test:qa` — 0 failures (design contract validation)
4. Builder tests pass: `npm run test:builder` — 0 failures (implementation tests)
5. Full suite passes: `npm run test` — 0 failures
6. CI `build-and-test` passes on the PR
7. No regressions in existing tests
8. All PR conversations resolved
9. Rebase + merge to main

#### Add QA-DISPUTE handling subsection:

```markdown
### QA-DISPUTE Handling

If build agent skipped QA tests with `.skip()` + `// QA-DISPUTE: <reason>`:
- Each skipped test MUST have a `followups.json` entry with status `not_applicable`
- Rationale must explain why the test is infeasible
- If rationale is insufficient, loop back to build
- If >30% of QA tests are skipped, code review auto-rejects (threshold violation)
```

### 3.8 Test Directory — `~/docalign/test/qa/.gitkeep`

Create an empty `.gitkeep` file at `~/docalign/test/qa/.gitkeep`.

### 3.9 pipeline.js Sync

After all changes to `~/.openclaw/skills/pipeline/scripts/pipeline.js`, copy the file to `~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js` to keep both copies in sync.

---

## 4. Test Strategy

### 4.1 Existing Pipeline Tests
Run: `cd ~/docalign && npx jest .openclaw/skills/pipeline/scripts/pipeline-gate-format.test.js`
Expected: All existing tests pass (no regressions).

### 4.2 YAML Validation
Verify all three pipeline YAML files parse correctly:
```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); ['task', 'feature', 'epic'].forEach(t => { yaml.load(fs.readFileSync('_team/pipelines/' + t + '.yml', 'utf8')); console.log(t + '.yml: valid'); });"
```

### 4.3 copyQaTestsToWorktree Functional Test
1. Create mock staging: `_team/outputs/test-run/qa_tests/files/test/qa/test-slug/acceptance.qa.test.ts`
2. Run `pipeline.js advance --stage build` for a test run
3. Verify the file appears at `<worktree>/test/qa/test-slug/acceptance.qa.test.ts`
4. Verify EXEC_PLAN.md contains "QA Test Requirements" section

### 4.4 npm Scripts
```bash
npm run test:qa    # Should find test/qa/ directory (passes with 0 tests if empty)
npm run test:builder  # Should exclude test/qa/ files
```

---

## 5. Migration / Breaking Changes

**No breaking changes.** All modifications are additive:
- New stages are inserted between existing stages — existing stage IDs unchanged
- New pipeline.js function is called only from cmdAdvance when stage === 'build'
- New npm scripts do not affect existing `test` script
- QA agent workspace is completely new

**Rollback**: Remove the new stages from YAMLs, revert pipeline.js changes, remove QA agent directory. No data migration needed.

---

## 6. Files Modified (Summary)

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `~/.openclaw/agents/qa/AGENTS.md` | CREATE | ~80 |
| `~/.openclaw/agents/qa/IDENTITY.md` | CREATE | ~15 |
| `~/.openclaw/agents/qa/SOUL.md` | CREATE | ~10 |
| `~/.openclaw/agents/qa/TOOLS.md` | CREATE | ~15 |
| `~/.openclaw/agents/qa/USER.md` | CREATE | ~10 |
| `~/.openclaw/agents/qa/HEARTBEAT.md` | CREATE | ~10 |
| `~/.openclaw/agents/qa/BOOTSTRAP.md` | CREATE | ~10 |
| `~/docalign/_team/pipelines/task.yml` | MODIFY | +18 lines, 2 pointer changes |
| `~/docalign/_team/pipelines/feature.yml` | MODIFY | +8 lines, 1 pointer change |
| `~/docalign/_team/pipelines/epic.yml` | MODIFY | +8 lines, 1 pointer change |
| `~/.openclaw/skills/pipeline/scripts/pipeline.js` | MODIFY | +60 lines (function + modifications) |
| `~/docalign/package.json` | MODIFY | +2 lines |
| `~/.openclaw/agents/orchestrator/AGENTS.md` | MODIFY | +40 lines |
| `~/docalign/test/qa/.gitkeep` | CREATE | 0 |

**Total**: 7 new files, 6 modified files, ~300 lines added

## Acceptance Criteria

# Feature Definition — Add QA Agent and Test-Writing Stage to All Pipelines

## Feature
QA Agent and independent test-writing stages for all pipeline types

## User Problem
The build agent currently writes both production code and tests. Tests end up validating "what was built" rather than "what was designed," allowing implementation to drift from specifications without detection. There is no independent verification that the build agent followed the spec.

## Solution
Introduce a dedicated QA agent persona that writes acceptance/contract tests BEFORE the build stage, based on specs, acceptance criteria, and plans. The build agent then implements code that must pass these independently-authored tests. The verify stage validates implementation against both QA tests and builder tests.

## Acceptance Criteria

1. **AC-1: QA Agent Workspace Exists**
   - Directory `~/.openclaw/agents/qa/` exists with 7 files: AGENTS.md, IDENTITY.md, SOUL.md, TOOLS.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md
   - QA agent evaluation lens is TESTABILITY and DESIGN CONTRACTS
   - QA agent instructions specify `*.qa.test.ts` naming convention and `test/qa/` directory structure
   - QA agent output format includes QA_TEST_PLAN, FILES_WRITTEN, UNMOCKABLE, and CONFIDENCE fields

2. **AC-2: Task Pipeline Updated**
   - `task.yml` contains `task_define` stage (type: work, agent: orchestrator) after research stages, before qa_tests
   - `task.yml` contains `qa_tests` stage (type: work, agent: qa) after task_define, before build
   - `research_check.next_if_no` points to `task_define` (not `build`)
   - `research.next` points to `task_define` (not `build`)

3. **AC-3: Feature Pipeline Updated**
   - `feature.yml` contains `qa_tests` stage (type: work, agent: qa) after plan, before build
   - `plan.next` points to `qa_tests` (not `build`)

4. **AC-4: Epic Pipeline Updated**
   - `epic.yml` contains `qa_integration_tests` stage (type: work, agent: qa) after ceo_decompose_approval, before execute_children
   - `ceo_decompose_approval.on_approve` points to `qa_integration_tests` (not `execute_children`)

5. **AC-5: pipeline.js — copyQaTestsToWorktree()**
   - New function `copyQaTestsToWorktree(runId, worktreePath)` exists
   - Recursively copies files from `_team/outputs/<runId>/qa_tests/files/` into the worktree
   - Also checks `_team/outputs/<runId>/qa_integration_tests/files/` for epics
   - Preserves relative paths (e.g., `test/qa/feature-slug/foo.qa.test.ts`)
   - Returns list of copied file paths
   - Handles gracefully when no QA test files exist (returns empty array)

6. **AC-6: pipeline.js — cmdAdvance() Updated**
   - When advancing to `build`, calls `copyQaTestsToWorktree()` after `createWorktree()` and before `assembleExecPlan()`
   - Response includes `qa_test_files` array when QA tests were copied

7. **AC-7: pipeline.js — assembleExecPlan() Updated**
   - EXEC_PLAN.md includes "QA Test Requirements (MUST PASS)" section
   - Section references `test/qa/` directory and `npx vitest run test/qa/` command
   - Section includes QA manifest content when available
   - Validation section updated to include QA test run step

8. **AC-8: package.json Scripts**
   - `test:qa` script exists: `vitest run test/qa/`
   - `test:builder` script exists: `vitest run --exclude 'test/qa/**'`
   - Existing `test` script unchanged (runs everything)

9. **AC-9: Test Directory**
   - `test/qa/.gitkeep` exists in the repository

10. **AC-10: Orchestrator AGENTS.md Updated**
    - `qa` listed in "Available personas to spawn" section
    - New "QA Test Stage" section documents execution pattern
    - Verify stage checklist updated to distinguish QA vs builder tests
    - QA-DISPUTE handling subsection documents the skip/dispute flow
    - QA-DISPUTE threshold documented: >30% skipped tests triggers auto-reject in code review

11. **AC-11: pipeline.js Synced**
    - The pipeline.js at `~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js` matches the source at `~/.openclaw/skills/pipeline/scripts/pipeline.js`

## Scope Boundaries

### In Scope
- QA agent workspace creation (7 files)
- Pipeline YAML modifications (3 files)
- pipeline.js modifications (copyQaTestsToWorktree, cmdAdvance, assembleExecPlan)
- package.json script additions
- Orchestrator AGENTS.md updates
- test/qa/.gitkeep directory

### NOT In Scope
- QA agent actually running tests (that happens in future pipeline runs that use the new stages)
- Changes to core DocAlign source code (src/)
- Changes to existing test files
- CI/CD pipeline modifications
- New pipeline.js commands (no new CLI commands needed)
- Content copilot or GTM changes
- Changes to the Chief agent

## Dependencies
- Existing pipeline.js functions: `createWorktree()`, `assembleExecPlan()`, `cmdAdvance()`
- Existing agent workspace pattern (pm, critic, tech-lead directories as templates)
- Vitest test runner (already in use)
- Existing `_team/outputs/` directory structure

## Definition of Done
- All 11 acceptance criteria pass
- All three pipeline YAMLs are valid YAML syntax
- Existing pipeline tests pass: `npx jest .openclaw/skills/pipeline/scripts/pipeline-gate-format.test.js`
- QA agent AGENTS.md follows the established persona pattern
- No regressions in existing functionality

## Review Conditions

### PM Review
# PM Spec Review — QA Agent and Test-Writing Stage

VERDICT: APPROVE

REASONING: The spec is thorough, well-scoped, and directly maps to all 11 acceptance criteria from the define stage. Each AC has a corresponding section in the spec with concrete implementation details. The file-level change summary is clear and the estimated scope (~300 lines across 13 files) is appropriate for the value delivered.

CONCERNS:
- The spec references `~/Discovery/docalign/` in the Tech Lead's AGENTS.md (section 3.1 context), but the actual repo path used everywhere else is `~/docalign/`. The build agent should use `~/docalign/` consistently. This is a minor inconsistency inherited from the existing Tech Lead AGENTS.md, not introduced by this spec.

SUGGESTIONS:
- The QA agent AGENTS.md should explicitly state the maximum number of test files per feature to prevent over-testing of simple tasks. Suggest a soft guideline: 1-2 files for tasks, 2-5 files for features, 3-8 files for epic integration tests.
- Consider adding a brief section in the QA agent AGENTS.md about test naming conventions beyond file naming — e.g., describe block format `describe('[QA] AC-1: ...')` to map tests directly to acceptance criteria numbers.
### Critic Review
# Critic Spec Review — QA Agent and Test-Writing Stage

VERDICT: APPROVE

FAILURE_MODES:
- **copyQaTestsToWorktree with symlinks**: If QA test files contain symlinks (unlikely but possible), `fs.copyFileSync` will copy the symlink target, not the link. Not a real risk for generated test files, but the function should handle it gracefully. Current implementation is fine — `copyFileSync` copies content, which is correct behavior.
- **Empty qa_tests/files directory**: If QA writes a manifest but no test files (e.g., all criteria flagged as UNMOCKABLE), `copyQaTestsToWorktree` returns empty array. The EXEC_PLAN still gets the QA section with the manifest. This is handled correctly — the spec says "Handles gracefully when no QA test files exist (returns empty array)."
- **EXEC_PLAN section ordering**: The spec says "insert after Plan of Work and before Specification." If the QA manifest is very long, it could push the specification section far down the EXEC_PLAN. Not a blocking concern since the build agent reads the whole file.

EDGE_CASES:
- **Feature slug collision**: Two concurrent features with similar names could theoretically produce the same slug for `test/qa/<slug>/`. Each has its own worktree, so no collision in practice. Acceptable.
- **Vitest `--exclude` pattern**: The `test:builder` script uses `vitest run --exclude 'test/qa/**'`. Need to verify Vitest supports this exact glob pattern for `--exclude`. Vitest docs confirm `--exclude` accepts glob patterns — this should work.
- **QA tests importing from packages not yet installed**: If QA tests import from packages that only exist after `npm install` in the worktree, and the worktree npm install runs before QA test copy, the imports will resolve correctly. The spec's ordering (createWorktree with npm install -> copyQaTests -> assembleExecPlan) is correct.

MISSING:
- Nothing critical missing. The spec covers all acceptance criteria comprehensively.

RISK_LEVEL: LOW — all infrastructure changes, well-defined boundaries, no production code touched

## Validation and Acceptance

For each task:
1. Run `npm run typecheck` — must pass with 0 errors
2. Run `npm run test` — must pass with 0 failures
3. Run `npm run lint:agent` — must produce 0 errors (includes remediation hints)

Final validation:
1. Run `npm run typecheck && npm run test && npm run lint`
2. Verify all acceptance criteria above are met
3. Verify no regressions in existing tests

### Integration Testing (optional, for complex features)
1. `npm run build`
2. `bash ~/.openclaw/skills/pipeline/scripts/agent-dev.sh --run-id f08aaaa5-be24-4037-be73-e59e783f5ce6`
3. Read `.agent-dev.json` for the assigned port
4. `curl http://localhost:<port>/health`
5. `bash ~/.openclaw/skills/pipeline/scripts/agent-dev-cleanup.sh --run-id f08aaaa5-be24-4037-be73-e59e783f5ce6`

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