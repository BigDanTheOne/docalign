# Harness Engineering — Report

Inspired by OpenAI's "Harness engineering: leveraging Codex in an agent-first world" (Ryan Lopopolo, 2025), which describes building a product with zero manually-written code using Codex agents. We analyzed their harness patterns and mapped them to our Autonomous OS.

Reference: [Harness Engineering article](https://openai.com/index/harness-engineering/)
Reference: [ExecPlans format](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md)

## Pre-Existing Analogs

Before reading the article, our system already implemented several of their core patterns:

### 1. Git Worktree Isolation (their: "isolated environments")

The article describes giving each Codex agent an isolated environment. We already had per-run git worktrees:
- Auto-created by `pipeline.js advance --stage build`
- Path: `~/docalign-worktrees/<run-id-short>/`
- Branch: `feature/<run-id-short>`
- Dependencies installed automatically
- Cleaned up on `pipeline.js complete-run`

### 2. Humans Steer, Agents Execute (their: "humans as product managers")

The article describes humans setting direction while agents do the work. Our pipeline already enforced this via CEO gates:
- CEO approves only: decision docs, specs, decomposition plans, ship notifications
- Everything between spec approval and ship is fully autonomous
- Task pipelines have zero CEO involvement
- Agents handle debate, build, code review, verification, and merge

### 3. Agent-to-Agent Review (their: "agents review each other's work")

The article describes agents reviewing other agents' code. Our pipeline already had persona-based review loops:
- Code review: PM + Tech Lead + Critic review PRs in parallel
- Spec review: PM + Critic review Tech Lead's spec
- Max 3 rejection loops per review stage before escalation
- Fan-in coordination for parallel reviews (all must approve, any rejection blocks)

### 4. External Coding Tools (their: "Codex as external tool")

The article describes using Codex as an external tool rather than having agents write code inline. We already separated orchestration from coding:
- Orchestrator manages pipeline state, never writes code
- Build stage delegates to Claude Code CLI or Codex CLI
- Coding happens in isolated worktree, results returned via git

### 5. Agent Hierarchy (their: "hierarchy of agents")

The article describes a hierarchy where higher-level agents coordinate lower-level ones. We already had:
- Chief (CEO-facing) → Orchestrator (pipeline executor) → Persona workers (PM, Tech Lead, Critic, GTM, Researcher)
- Each level has different responsibilities and tool access
- Workers are real sub-agent sessions, not simulations

## New Features Implemented

Three features adopted from the article and built into our system:

### Feature 1: EXEC_PLAN.md — Execution Plans as Build Artifacts

**Source**: The article's ExecPlan format — self-contained documents that coding agents read directly from the repo, replacing prompt-heavy context passing.

**What we built**: `assembleExecPlan()` function in `pipeline.js` (~120 lines) that auto-generates `EXEC_PLAN.md` in the worktree root when advancing to build stage.

**How it works**:
1. `pipeline.js advance --stage build` triggers assembly
2. Gathers artifacts from `_team/outputs/<run_id>/`:
   - `decision.md` (strategic direction from debate)
   - `spec/tech-lead.md` (technical specification)
   - `plan/tech-lead.md` (task breakdown)
   - `define/pm.md` (acceptance criteria)
   - `spec_review/pm.md` and `spec_review/critic.md` (reviewer feedback)
3. Gathers prior code review feedback (if re-building after rejection)
4. Builds stage history from steps table
5. Extracts progress items from plan
6. Assembles structured markdown with sections:
   - Purpose / Big Picture
   - Progress (checkbox list — agent checks off during work)
   - Prior Code Review Feedback (if re-building)
   - Context and Orientation (worktree path, conventions, stage history)
   - Plan of Work
   - Specification
   - Acceptance Criteria
   - Review Conditions
   - Validation and Acceptance (typecheck + test + lint commands)
   - Integration Testing (dev environment boot instructions)
   - Idempotence and Recovery
   - Surprises & Discoveries (agent fills in)
   - Decision Log (agent fills in)
   - Outcomes & Retrospective (agent fills in)

**Adapts by pipeline type**: Task pipelines get a simpler plan (no debate/spec sections). Feature/epic pipelines get the full document.

**Coding agent prompt**:
```
Read EXEC_PLAN.md in the current directory. Follow it exactly:
work through tasks, check off progress, run validation,
record surprises and decisions. Commit EXEC_PLAN.md updates alongside code.
```

**Key benefit**: The coding agent reads the plan from the repo, not from prompt context. This means the plan is version-controlled, visible in PRs, and survives session boundaries.

**Integration point**: Activates during `pipeline.js advance --stage build` in all three pipeline types.

### Feature 2: Agent-Legible Dev Environment Per Worktree

**Source**: The article's emphasis on agents being able to boot and test the application themselves, not just run unit tests.

**What we built**: Two bash scripts that create and destroy isolated dev environments per pipeline run.

**`agent-dev.sh`** (157 lines) — Boot:
1. Ensures shared Docker services running (Postgres + Redis)
2. Creates per-worktree Postgres database: `docalign_<short_id>`
3. Generates `.env.agent` with:
   - `DATABASE_URL` pointing to per-run database
   - `REDIS_URL` with per-run prefix (`docalign:<short_id>:`)
   - Dummy values for GitHub secrets (app boots but doesn't call GitHub)
   - `PORT=0` (OS assigns random available port)
4. Runs database migrations against per-run DB
5. Builds TypeScript
6. Starts app in background, captures PID
7. Detects assigned port via `lsof -n -P -p $PID`
8. Verifies health endpoint responds (`/health`)
9. Writes `.agent-dev.json` to worktree root:
   ```json
   {
     "pid": 62961,
     "port": 62961,
     "database": "docalign_a655aa6d",
     "health_url": "http://localhost:62961/health",
     "run_id": "a655aa6d-...",
     "healthy": true
   }
   ```

**`agent-dev-cleanup.sh`** (57 lines) — Teardown:
1. Reads PID from `.agent-dev.json`
2. Kills app process (SIGTERM then SIGKILL)
3. Drops per-worktree database
4. Removes `.agent-dev.json` and `.env.agent`
5. Fully idempotent

**Error handling**:
- Process crash detection: checks `kill -0 $PID` during startup, writes error to `.agent-dev.json` on crash
- App logs: stdout/stderr redirected to `.agent-dev.log` in worktree
- Health verification: 5 retries with 1s delay, records `healthy: true/false`

**Lifecycle integration**:
- Cleanup is called automatically by `pipeline.js removeWorktree()` (best-effort, 30s timeout)
- So `pipeline.js complete-run` → kills app → drops DB → removes worktree

**Referenced in EXEC_PLAN.md** integration testing section:
```
1. bash ~/.openclaw/skills/pipeline/scripts/agent-dev.sh --run-id <id>
2. Read .agent-dev.json for the assigned port
3. curl http://localhost:<port>/health
4. bash ~/.openclaw/skills/pipeline/scripts/agent-dev-cleanup.sh --run-id <id>
```

**Integration point**: Available to coding agents during build stage. Referenced in EXEC_PLAN.md validation section.

### Feature 3: Remediation-Aware Lint Errors

**Source**: The article's "custom lints with remediation" pattern — lint output enriched with "how to fix" instructions so agents don't guess.

**What we built**: Three components.

**`scripts/lint-remediation.json`** (98 lines) — Maps all 24 active ESLint rules to remediation instructions:
```json
{
  "@typescript-eslint/no-unused-vars": {
    "remediation": "Remove the unused variable/import, OR prefix with _ if structural",
    "examples": ["const { used, _unused } = obj;"]
  },
  "@typescript-eslint/no-explicit-any": {
    "remediation": "Replace 'any' with 'unknown' and narrow with type guards",
    "examples": ["function parse(input: unknown): Result { ... }"]
  }
}
```

**`scripts/agent-lint.js`** (81 lines) — Zero-dependency Node.js wrapper:
1. Runs `npx eslint src/ test/ --format json`
2. Loads remediation map
3. For each error, outputs:
   ```
   src/shared/db.ts:42:7 error Unexpected any value (@typescript-eslint/no-explicit-any)
     FIX: Replace 'any' with 'unknown' and narrow with type guards
     EXAMPLE: function parse(input: unknown): Result { ... }
   ```
4. Exits with ESLint's exit code

**`CONVENTIONS.md`** (40 lines) — Codified project conventions:
- TypeScript strict mode rules
- Naming conventions (kebab-case files, PascalCase types, camelCase functions)
- Error handling patterns (typed codes, Pino, Zod)
- Testing patterns (Vitest, AAA)
- Lint workflow (`lint:agent` for diagnostics, `lint:fix` for auto-fix)

**package.json scripts added**:
```json
"lint:agent": "node scripts/agent-lint.js"
```

**Integration point**: Referenced in EXEC_PLAN.md validation section and CONVENTIONS.md. Coding agents run `npm run lint:agent` after each task.

## Operational Hardening (Post-Deployment)

After the first real pipeline runs, we discovered three reliability gaps in the harness. Each was solved using patterns consistent with the article's philosophy: enforce structure through tooling, not instructions.

### Fix 1: Role-Based Tool Scoping (Skill Split)

**Problem**: The Chief agent had access to all 13 pipeline commands (including `advance`, `add-step`, `complete-step`). On a task pipeline, it decided to drive the stages itself instead of spawning an Orchestrator — acting as both dispatcher and executor. Soft instructions in AGENTS.md ("always spawn an orchestrator") were insufficient.

**Solution**: Split the pipeline skill into two views of the same script:
- `pipeline-ceo` (Chief) — 6 commands: create, status, list, complete-run, pause, resume
- `pipeline` (Orchestrator) — all 13 commands including stage execution

The Chief physically cannot call `advance` or `add-step` because those commands don't exist in its SKILL.md. This enforces the hierarchy through tool access, not through behavioral instructions that agents can ignore.

**Harness principle**: The article's agent hierarchy works only when enforced structurally. Instructions are suggestions; tool boundaries are constraints.

### Fix 2: Background Exec for Long-Running Builds

**Problem**: OpenClaw agent turns timeout after 600 seconds (10 minutes). Claude Code CLI builds can take 5–30+ minutes. A synchronous build call would hit the turn timeout and abort.

**Solution**: Use OpenClaw's native background exec pattern:
1. Orchestrator calls the CLI via `exec`
2. After 10 seconds, OpenClaw auto-backgrounds the command
3. Orchestrator's turn ends naturally
4. When the CLI finishes, `notifyOnExit` wakes the Orchestrator for a new turn
5. Orchestrator reads the result and continues the pipeline

No new infrastructure needed — purely leveraging the platform's existing async execution model.

**Harness principle**: The article's "external coding tools" pattern requires the orchestration layer to handle async execution gracefully. The harness must accommodate tools that outlive a single agent turn.

### Fix 3: Self-Healing Heartbeat (Auto-Recovery)

**Problem**: When a pipeline gets stuck (orchestrator crash, missed notification, silent stall), the original heartbeat only notified the CEO — treating an operational failure as a decision request.

**Solution**: The Chief's heartbeat now auto-recovers stuck pipelines silently:
1. Detect stuck state (no advancement in 60+ min, no running steps)
2. Spawn a new orchestrator for the stuck run — pipeline state is in SQLite, so the new orchestrator picks up exactly where the previous one left off
3. Only notify CEO after 3 consecutive recovery failures on the same run

CEO is interrupted only when something is fundamentally broken, not when an agent session died and needs a restart.

**Harness principle**: Autonomous systems must self-heal. Human escalation should be the last resort, not the default response to operational failures. The article describes humans as product managers, not as ops engineers babysitting agent processes.

## What We Didn't Adopt

### Repository Knowledge Architecture
The article mentions structuring repository knowledge for agent consumption. We found this too ambiguous to apply concretely to our setup. Our existing `CLAUDE.md`, `CONVENTIONS.md`, and phase docs already serve this purpose organically.

### Garbage Collection / Golden Principles Cron
The article describes periodic cleanup of accumulated agent artifacts. We chose not to implement this because DocAlign's core product purpose is proactive documentation-reality alignment — the system should inherently prevent documentation drift rather than reactively cleaning it up.

## File Inventory

| Path | Lines | Purpose |
|---|---|---|
| `~/.openclaw/skills/pipeline/scripts/pipeline.js` | 878 | `assembleExecPlan()` function + `removeWorktree()` cleanup hook |
| `~/.openclaw/skills/pipeline/scripts/agent-dev.sh` | 157 | Boot isolated dev environment per worktree |
| `~/.openclaw/skills/pipeline/scripts/agent-dev-cleanup.sh` | 57 | Teardown dev environment |
| `~/.openclaw/agents/orchestrator/AGENTS.md` | 294 | Updated build workflow referencing EXEC_PLAN.md |
| `~/docalign/scripts/agent-lint.js` | 81 | ESLint wrapper with remediation hints |
| `~/docalign/scripts/lint-remediation.json` | 98 | Rule-to-remediation mapping (24 rules) |
| `~/docalign/CONVENTIONS.md` | 40 | Coding conventions for agent reference |
| `~/docalign/package.json` | — | Added `lint:agent`, `dev:agent`, `dev:agent:cleanup` scripts |
| `~/docalign/.gitignore` | — | Added `.agent-dev.json`, `.env.agent` |
