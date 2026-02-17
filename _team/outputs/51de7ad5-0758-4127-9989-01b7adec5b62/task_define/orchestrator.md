# Task Define: Extract stage-exit gates into shared validator and enforce in complete-run

## Acceptance Criteria

1. **`validateStageExitGates(runId, currentStage)` function exists** -- A single function consolidates ALL stage-exit gate checks: followup triage (code_review -> verify), DocAlign health (verify -> any), and a NEW test-results gate (verify -> any). Called from one place per caller.

2. **Test-results gate enforced at verify stage** -- When exiting verify, `outputs/<runId>/verify/test-results.json` MUST exist with `{ passed: true, suite_count: N, failure_count: 0 }`. Blocks if file missing, `passed !== true`, or `failure_count > 0`.

3. **`cmdAdvance()` uses `validateStageExitGates()`** -- The inline gate checks (currently lines ~790-797) are replaced with a single call to `validateStageExitGates(runId, run.current_stage)`.

4. **`cmdCompleteRun()` enforces gates on completion** -- When `status === 'completed'`, calls `validateStageExitGates(runId, run.current_stage)` BEFORE updating the database. When `status === 'failed'`, gates are skipped.

5. **Existing tests still pass** -- The test in `pipeline-gate-format.test.js` is updated: the verify advance test fixture includes `test-results.json` so it continues to pass. A new test case verifies the test-results gate blocks when the artifact is missing or has failures > 0.

6. **Both copies of pipeline.js are identical** -- Runtime copy (`~/.openclaw/skills/pipeline/scripts/pipeline.js`) and git-tracked copy (`~/docalign/.openclaw/skills/pipeline/scripts/pipeline.js`) are byte-identical after changes.

7. **Orchestrator AGENTS.md updated** -- Documents the new `test-results.json` artifact requirement in the verify stage section.
