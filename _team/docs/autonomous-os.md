# Autonomous OS — System Report

The Autonomous Operating System is a pipeline-driven agent infrastructure for DocAlign built on OpenClaw. It enables AI agents to autonomously execute software development workflows — from feature ideation through debate, specification, implementation, code review, and shipping — with minimal CEO involvement. The CEO steers strategic direction; agents handle everything else.

## Platform

- **OpenClaw** v2026.2.15 (`/opt/homebrew/bin/openclaw`)
- **Gateway**: `127.0.0.1:18789` (local loopback)
- **Model**: `openai-codex/gpt-5.3-codex` (all agents)
- **Config**: `~/.openclaw/openclaw.json`

## Agent Hierarchy

Seven agents organized in a spawning hierarchy:

```
CEO (Telegram)
  └─ Chief (default agent, CEO-facing)
       ├─ Orchestrator (pipeline executor)
       │    ├─ Product Manager (value, scope, acceptance criteria)
       │    ├─ Tech Lead (architecture, specs, plans, build, verify)
       │    ├─ Critic (edge cases, quality, design critique)
       │    ├─ GTM Strategist (market positioning, launch content)
       │    └─ Researcher (optional context gathering)
       └─ Researcher (direct research for Chief)
```

| Agent | ID | Skills | Spawns |
|---|---|---|---|
| Chief | `chief` | content-copilot, pipeline-ceo, mem0, notify, handoff | orchestrator, researcher |
| Orchestrator | `orchestrator` | pipeline, mem0, handoff | pm, tech-lead, critic, gtm, researcher |
| Product Manager | `pm` | mem0 | — |
| Tech Lead | `tech-lead` | mem0 | — |
| Critic | `critic` | mem0 | — |
| GTM Strategist | `gtm` | mem0 | — |
| Researcher | `researcher` | mem0 | — |

Each agent has its own workspace directory (`~/.openclaw/agents/<id>/`) with identity, personality, and behavioral instructions. Persona agents are spawned as real sub-agent sessions via `sessions_spawn` — never simulated.

## Pipeline Engine

Central state machine implemented in `pipeline.js` (878 lines, Node.js + better-sqlite3).

**Database**: `~/Discovery/docalign/_team/data/pipeline.db` (SQLite, WAL mode)

**Tables**:
- `runs` — Pipeline run state (id, type, title, status, current_stage, parent_epic_id, review_loop_count, worktree_path)
- `steps` — Individual stage executions (run_id, stage, agent, parallel_group, status, result_summary, feedback)
- `fan_in_tracker` — Parallel group coordination (expected/completed counts, rejection tracking, results JSON)

**13 Commands** (all JSON input/output):

| Command | Purpose |
|---|---|
| `create` | Create new pipeline run (task/feature/epic) |
| `status` | Show one run or all active/queued |
| `advance` | Move to next stage (auto-creates worktree + EXEC_PLAN.md on build) |
| `add-step` | Spawn a worker for a stage |
| `complete-step` | Finish a step (approved/rejected/completed) |
| `complete-run` | Mark done, auto-cleanup worktree, auto-dequeue next |
| `fan-in` | Check parallel group completion status |
| `escalate` | Move to escalation, notify CEO, auto-dequeue |
| `pause` | Pause active run (frees concurrency slot) |
| `resume` | Resume paused run (re-activate or queue) |
| `list` | List runs by status |
| `worktree` | Query worktree path for a run |

**Concurrency**: Max 8 concurrent active runs. New runs queue automatically. Dequeuing is FIFO on completion/escalation/pause.

## Pipeline Types

Three pipeline definitions stored as YAML in `~/docalign/_team/pipelines/`.

### Task Pipeline (`task.yml`)

CEO involvement: **NONE** (fully autonomous).

```
Request → [Research?] → Build → Code Review → Verify → Done
```

- Build uses external coding tools (Claude CLI / Codex CLI)
- Code review by Critic only (max 2 loops → escalate)
- Verify: CI green, rebase, merge PR to main
- CEO notified only at completion or escalation

### Feature Pipeline (`feature.yml`)

CEO involvement: **Decision doc + Spec approval + Ship notification**.

```
Signal → Debate (R1/R2) → Define → Spec → Spec Review
→ CEO Spec Approval → Plan → Build → Code Review → Verify
→ GTM Content → Ship
```

- Debate: 4 personas in parallel, max 2 rounds, escalate on divergence
- Spec review: PM + Critic in parallel, max 3 loops
- CEO approves spec (last human gate)
- Build through ship is fully autonomous
- Code review: PM + Tech Lead + Critic in parallel, max 3 loops

### Epic Pipeline (`epic.yml`)

CEO involvement: **Decision doc + Decomposition approval + Ship notification**.

```
Signal → Strategic Debate (R1/R2) → CEO Decision Approval
→ Decompose → CEO Decompose Approval → Execute Children
→ Integration Review → Verify → GTM → Ship
```

- Children are spawned as independent feature/task pipelines
- Each child gets its own worktree and follows its own pipeline rules
- Integration review after all children complete (Tech Lead + Critic)

## Git Worktree Isolation

Every build runs in an isolated git worktree. Never in the main repo.

- **Created**: Automatically on `pipeline.js advance --stage build`
- **Path**: `~/docalign-worktrees/<run-id-short>/`
- **Branch**: `feature/<run-id-short>`
- **Dependencies**: `npm install` runs automatically after creation
- **Cleaned up**: Automatically on `pipeline.js complete-run`
- **Cleanup includes**: Kill dev env process, drop per-run DB, remove worktree directory, git prune

## Skills System

Modular tools assigned to agents via `openclaw.json`.

### Pipeline Skill (split into two scoped views)

The pipeline skill is backed by a single script (`pipeline.js`) but exposed to agents through two different SKILL.md documents that control which commands each agent can see.

**Pipeline CEO** (`pipeline-ceo`)
- **Path**: `~/.openclaw/skills/pipeline-ceo/`
- **Used by**: Chief
- **Purpose**: Lifecycle management only — create runs, check status, list, complete-run, pause, resume (6 commands)
- **Cannot see**: `advance`, `add-step`, `complete-step`, `fan-in`, `escalate`, `worktree`
- **Why**: Prevents the Chief from executing pipeline stages itself. Chief creates runs and spawns orchestrators — it does not drive stages.

**Pipeline** (`pipeline`)
- **Path**: `~/.openclaw/skills/pipeline/`
- **Script**: `scripts/pipeline.js` (878 lines)
- **Used by**: Orchestrator
- **Purpose**: All 13 pipeline state management commands including stage execution

### Notify Skill
- **Path**: `~/.openclaw/skills/notify/`
- **Script**: `scripts/notify.sh`
- **Used by**: Chief
- **Purpose**: Send Telegram messages to CEO (pipeline updates, escalations, approvals)

### Mem0 Skill
- **Path**: `~/.openclaw/skills/mem0/`
- **Scripts**: `scripts/recall.sh`, `scripts/store.sh`
- **Used by**: All agents
- **Purpose**: Two-tier scoped memory (feature-level + global)

### Handoff Skill
- **Path**: `~/.openclaw/skills/handoff/`
- **Script**: `scripts/handoff.js`
- **Used by**: Orchestrator
- **Purpose**: Generate handoff.md for coding sessions (now largely superseded by EXEC_PLAN.md)

### Content Copilot Skill
- **Path**: `~/.openclaw/skills/content-copilot/`
- **Used by**: Chief
- **Purpose**: Build-in-public content generation (not part of pipeline orchestration)

## Memory Management (Mem0)

Two-tier scoping system for persistent agent memory.

| Scope | Tagged With | Contains |
|---|---|---|
| Feature | `feature_id` + `scope: feature` | Spec decisions, review feedback, debate positions |
| Global | `scope: global` | Cross-cutting architectural preferences |

**Recall** (before spawning workers):
```bash
bash ~/.openclaw/skills/mem0/scripts/recall.sh --feature <id> --scope all
```

**Store** (after decisions):
```bash
bash ~/.openclaw/skills/mem0/scripts/store.sh --feature <id> --scope feature --content "..."
```

## CEO Interface (Telegram)

The Chief agent is bound to Telegram for CEO communication.

- **CEO DM**: Chat ID `806522150`
- **Group Chat**: Chat ID `3848057216`
- **Bot Token**: Configured in `openclaw.json`
- **Policy**: Allowlist-based (only CEO can interact)

**CEO interactions**:
- Receives pipeline notifications (stage advances, completions, escalations)
- Approves decision docs, specs, decomposition plans
- Can force-approve escalated reviews
- Can kill pipelines at approval gates

## Long-Running Builds (Background Exec Pattern)

OpenClaw agent turns timeout after 600 seconds (10 minutes). Claude Code / Codex CLI builds can take 5–30+ minutes. The system handles this using OpenClaw's native background exec pattern:

1. Orchestrator calls the CLI via `exec`. After 10 seconds, OpenClaw auto-backgrounds the command and returns a session ID.
2. The Orchestrator's turn ends naturally (well under 600s).
3. The background process keeps running independently (up to 1800s / 30 min exec timeout).
4. When the CLI exits, OpenClaw's `notifyOnExit` fires a system event that wakes the Orchestrator for a new turn.
5. The Orchestrator polls the result, checks exit code, and continues the pipeline.

**Key timeouts**:

| Layer | Default | Config Key |
|---|---|---|
| Agent turn | 600s (10 min) | `agents.defaults.timeoutSeconds` |
| Exec command | 1800s (30 min) | `tools.exec.timeoutSec` |
| Auto-background threshold | 10s | `tools.exec.backgroundMs` |

Sessions persist across turns — only the turn has a timeout, not the session itself. The `archiveAfterMinutes: 120` setting is post-completion cleanup, not a runtime limit.

## Heartbeat Auto-Recovery

The Chief agent runs a heartbeat every 30 minutes that detects and **silently recovers** stuck pipelines. CEO is NOT notified for operational failures — only for decisions.

**Stuck detection criteria**:
- Pipeline has not advanced in 60+ minutes with no running steps
- A worker step has been running for 30+ minutes
- An orchestrator has no running workers and no advancement

**Recovery action**: Spawn a new orchestrator for the stuck run. The new orchestrator reads pipeline state from SQLite and continues from the current stage. Pipeline state is deterministic — nothing is lost when an orchestrator dies.

**Escalation ladder** (per run):
1. 1st stuck detection → auto-recover silently
2. 2nd stuck detection (same run, still stuck) → auto-recover silently
3. 3rd stuck detection (still stuck) → notify CEO via Telegram. Something is fundamentally broken.

**Queue management**: The heartbeat also checks for queued runs and spawns orchestrators when concurrency slots open (active < 8 and queued > 0).

## Output Storage

All stage outputs stored at: `~/docalign/_team/outputs/<run_id>/<stage>/<agent>.md`

Decision documents (consolidated from debate): `~/docalign/_team/outputs/<run_id>/decision.md`

## File Inventory

| Path | Lines | Purpose |
|---|---|---|
| `~/.openclaw/openclaw.json` | 234 | Global agent registry, skills, channels, bindings |
| `~/.openclaw/skills/pipeline/scripts/pipeline.js` | 878 | Pipeline state machine + worktree + EXEC_PLAN assembly |
| `~/.openclaw/skills/pipeline/SKILL.md` | 31 | Full pipeline skill docs (Orchestrator) — all 13 commands |
| `~/.openclaw/skills/pipeline-ceo/SKILL.md` | 26 | CEO-scoped pipeline skill docs (Chief) — 6 lifecycle commands only |
| `~/.openclaw/skills/notify/scripts/notify.sh` | ~30 | Telegram notification sender |
| `~/.openclaw/skills/notify/SKILL.md` | 24 | Notify skill documentation |
| `~/.openclaw/skills/handoff/scripts/handoff.js` | ~200 | Handoff.md generator (legacy) |
| `~/.openclaw/skills/handoff/SKILL.md` | 27 | Handoff skill documentation |
| `~/.openclaw/skills/mem0/scripts/recall.sh` | ~50 | Memory recall with metadata filtering |
| `~/.openclaw/skills/mem0/scripts/store.sh` | ~50 | Memory storage with metadata tagging |
| `~/.openclaw/skills/mem0/SKILL.md` | 40 | Mem0 skill documentation |
| `~/.openclaw/agents/chief/HEARTBEAT.md` | 45 | Chief heartbeat: stuck detection + auto-recovery logic |
| `~/.openclaw/agents/chief/AGENTS.md` | ~128 | Chief operating instructions (skills, spawning, CEO rules) |
| `~/.openclaw/agents/orchestrator/AGENTS.md` | ~310 | Orchestrator execution playbook (incl. background exec pattern) |
| `~/.openclaw/workspace/AGENTS.md` | 213 | Global agent framework |
| `~/.openclaw/cron/jobs.json` | 190 | Scheduled cron jobs (morning brief, afternoon check, competitive scan) |
| `~/docalign/_team/pipelines/task.yml` | 98 | Task pipeline definition |
| `~/docalign/_team/pipelines/feature.yml` | 211 | Feature pipeline definition |
| `~/docalign/_team/pipelines/epic.yml` | 175 | Epic pipeline definition |
| `~/docalign/_team/data/pipeline.db` | — | SQLite database (WAL mode) |
