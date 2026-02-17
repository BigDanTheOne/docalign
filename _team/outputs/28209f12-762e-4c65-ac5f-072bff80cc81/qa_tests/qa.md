# QA Tests — Auto-pull main repo after worktree PR merge

## Scope
This task modifies `pipeline.js`, a standalone Node.js CLI script outside the main application test framework. The changes are to a single function (`cmdCompleteRun`) and add a new helper function (`pullMainRepo`).

## Test Strategy
Manual verification via pipeline execution rather than automated QA test files, since pipeline.js is a CLI tool that requires SQLite state and git repos to test meaningfully.

## Verification Checklist
1. After `complete-run` on a run that had a worktree, the output JSON includes `main_repo_pull` with `success: true`
2. If git pull fails (e.g., simulated network issue), the run still completes with `main_repo_pull.error` present
3. Runs without worktrees (e.g., dismissed before build) do not attempt git pull
4. Both copies of pipeline.js are byte-identical after changes
