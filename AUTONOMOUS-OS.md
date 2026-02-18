# Autonomous Operating System — Full Design

> The system that runs DocAlign development autonomously. CEO (founder) is a decision-maker and critic only — never the initiator.
>
> Incorporates all design critiques (#2-#8), all resolutions, and the OpenClaw-only orchestration decision with nested sub-agents.

---

<!-- docalign:skip reason="example_table" description="Team Structure table listing roles, evaluation criteria, and models — describes personas and their mandates, partially falsifiable but the model names are config values, not source code. The role/criteria columns are definitional descriptions of agent identity, not independently falsifiable behavior claims." -->
## 1. Team Structure

Five AI personas + CEO (founder). Non-overlapping evaluation criteria are **hardcoded in each persona's system prompt** — no two agents evaluate the same dimension.

| Role | Evaluates | Does NOT Evaluate | Model |
|---|---|---|---|
| **CEO (You)** | Final decisions, approvals, strategic direction | — | Human |
| **PM** | User value, scope correctness, acceptance criteria completeness | Technical feasibility, edge cases, distribution | Opus |
| **GTM** | Distribution potential, content angle, messaging, demo-ability | Technical correctness, user value framing, edge cases | Sonnet |
| **Tech Lead** | Feasibility, architecture fit, complexity, maintenance cost | Marketing, user value framing, failure modes | Opus |
| **Critic** | Edge cases, failure modes, regression risk, what-could-go-wrong | Value, scope, distribution | Opus |
| **Researcher** | Context gathering, competitor analysis, technical spikes | Does not evaluate — only produces findings | Sonnet |

**Researcher** is stateless — spawned on-demand, no persistent identity. All others are persistent personas with consistent evaluation lenses.

---
<!-- /docalign:skip -->

## 2. Pipeline Types

Three tiers based on **complexity**. Classification at entry.

<!-- docalign:skip reason="illustrative_example" description="Task Pipeline ASCII flow diagram — illustrative pipeline shape, not a falsifiable implementation claim" -->
### Task Pipeline
```
Request → [Research?] → Build → Review → Done
```
- No debate, no spec, no GTM content
- **Who creates**: PM, Tech Lead, CEO, or auto-spawned from an Epic
- **Research** is optional (only if task needs investigation)
- **Review**: Critic only, 1 round, 1 retry max
- Examples: bug fix, doc update, dependency upgrade, config change
<!-- /docalign:skip -->

<!-- docalign:skip reason="illustrative_example" description="Feature Pipeline ASCII flow diagram with bullet descriptions — illustrative; the real authority is feature.yml" -->
### Feature Pipeline
```
Signal → Debate → Define → Spec → Spec Review → Build → Build Review → GTM Content → Content Review → Ship
```
- Full team process with parallel reviews
- **Who creates**: CEO (direct), competitive scan (auto), Epic decomposition
- **Debate**: PM + Tech Lead + GTM + Critic argue in parallel
- **Define**: Acceptance criteria, files affected, definition of done
- **Spec Review**: PM + Critic in parallel (rejection takes precedence)
- **Build Review**: PM + Tech Lead + Critic in parallel
- **Content Review**: CEO approves GTM content
- Examples: new CLI command, new check type, new MCP tool

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Epic Pipeline ASCII flow diagram with bullet descriptions — illustrative; the real authority is epic.yml" -->
### Epic Pipeline
```
Signal → Strategic Debate → Decompose → [Feature Pipelines...] → Integration Review → Launch Content → Ship
```
- Spans multiple features running concurrently
- **Who creates**: CEO only (epics are strategic bets)
- **Decompose**: PM + Tech Lead break into features and tasks, each spawns its own pipeline
- **Integration Review**: After all child features complete, Tech Lead + Critic review the whole
- Examples: "Add semantic extraction," "Redesign PR output," "Build CLI mode"

---

<!-- /docalign:skip -->
## 3. Review Rules (All Parallel Reviews)

1. **Rejection takes precedence.** Any rejector blocks. Approvals are invalidated.
2. **Author addresses feedback and resubmits.** All reviewers re-review (not just the rejector).
3. **Max 3 loops per review stage.** After 3 rejections, escalate to CEO with full feedback history.
4. **CEO override.** CEO can force-approve at any point.

---

## 4. Entry Classification — Who Spawns What

**CEO-initiated:**
- CEO sends Telegram message: "I want feature X" → Chief classifies → spawns Feature pipeline
- CEO sends "Fix bug Y" → Chief classifies → spawns Task pipeline
- CEO sends "We need to rethink Z" → Chief classifies → spawns Epic pipeline

**System-initiated (scheduled):**
- Daily competitive scan finds relevant signal → Chief creates Research task → if findings warrant it, proposes Feature to CEO for approval
- Weekly priorities review identifies gaps → Chief proposes to CEO
- Heartbeat detects stale/stuck pipeline → Chief notifies CEO

**Pipeline-internal:**
- Epic "decompose" stage produces feature/task list → orchestrator auto-creates child pipelines
- During a Feature build, Tech Lead identifies prerequisite → orchestrator creates Task pipeline as dependency
- During review, Critic flags a separate issue → orchestrator creates Task pipeline, doesn't block current feature

**Classification heuristic** (in Chief's prompt):
- **Task**: Single action, no spec needed, <1 day. Direct execution.
- **Feature**: Needs spec + build + review. Multi-day. Affects users.
- **Epic**: Multiple features. Strategic significance. Needs decomposition.
- When unsure: **ask CEO** via Telegram with a one-sentence summary + proposed classification.

---

<!-- docalign:skip reason="illustrative_example" description="ASCII architecture diagram showing agent depth/hierarchy — illustrative system overview, not independently falsifiable code assertions" -->
## 5. Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│               CEO — Telegram + Claude Code               │
│  Quick decisions via Telegram                            │
│  Deep work via Claude Code (handoff.md)                  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│        Chief Agent (depth 0) — Always-on                 │
│  Telegram-connected. Heartbeat every 30 min.             │
│  Model: Sonnet (dispatch + classification only)          │
│  maxSpawnDepth: 2                                        │
│                                                          │
│  Responsibilities:                                       │
│    • Classify incoming signals → pipeline type           │
│    • Create pipeline runs in SQLite                      │
│    • Spawn orchestrator sub-agents per pipeline          │
│    • Route CEO decisions back to orchestrators           │
│    • Compile morning brief                               │
│    • Run scheduled scans (cron)                          │
│    • Catch stuck pipelines (heartbeat safety net)        │
└──────────┬──────────────────────────────────────────────┘
           │ spawns (depth 1)
           │
┌──────────▼──────────────────────────────────────────────┐
│      Orchestrator Sub-Agent (depth 1) — per pipeline     │
│  Model: Sonnet                                           │
│  Has: sessions_spawn, subagents tool, pipeline skills    │
│                                                          │
│  One orchestrator per active pipeline run.                │
│  Reads pipeline state from SQLite.                       │
│  Deterministic: follows pipeline YAML rules exactly.     │
│  Spawns persona workers, collects announces.             │
│  Applies fan-in rules, advances pipeline.                │
│  Escalates to Chief → CEO when needed.                   │
└──────────┬──────────────────────────────────────────────┘
           │ spawns (depth 2)
           │
┌──────────▼──────────────────────────────────────────────┐
│         Persona Workers (depth 2) — leaf agents          │
│                                                          │
│  PM (Opus)       — reviews, specs, scope decisions       │
│  GTM (Sonnet)    — content creation, distribution plans  │
│  Tech Lead (Opus) — specs, builds, feasibility analysis  │
│  Critic (Opus)   — adversarial reviews, testing          │
│  Researcher (Sonnet) — investigation, context gathering  │
│                                                          │
│  Cannot spawn further. Announce results to orchestrator. │
│  Receive full task context via spawn task description.    │
│  Access custom Mem0 skill for scoped memory recall.      │
└─────────────────────────────────────────────────────────┘
```

<!-- /docalign:skip -->
### Dispatch Model

**Primary: Event-driven.** Sub-agent announces trigger immediate parent turns. Zero delay between pipeline steps.

**Safety net: Heartbeat (30 min).** Chief checks all active pipelines. Catches: stuck orchestrators, timed-out workers, orphaned runs.

**Scheduled: Cron.** Morning brief (8am), competitive scan (daily), weekly priorities (Monday 9am).

### Concurrency: Running Multiple Features at Once

Each pipeline run gets its own orchestrator sub-agent at depth 1. They don't share context windows.

- Chief manages up to 8 concurrent orchestrators (`maxConcurrent: 8`)
- Each orchestrator spawns up to 5 workers (`maxChildrenPerAgent: 5`)
- Workers are ephemeral — spawned per step, archived after announce
- No context pollution between features
- SQLite tracks all pipeline state globally — Chief can query "what's active?" cheaply
- Mem0 memories are scoped by `feature_id` — no cross-contamination

When concurrency limit is hit, new pipeline runs queue in SQLite as `status: queued` and start when a slot opens.

---

## 6. State Persistence (Custom SQLite)

Three tables. Survives gateway restarts.

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'task' | 'feature' | 'epic'
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
                                   -- 'queued'|'active'|'paused'|'completed'|'failed'|'escalated'
  current_stage TEXT,
  parent_epic_id TEXT,             -- if this feature belongs to an epic
  review_loop_count INTEGER DEFAULT 0,
  orchestrator_session TEXT,       -- OpenClaw session key
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage TEXT NOT NULL,             -- stage name from pipeline definition
  agent TEXT NOT NULL,             -- 'pm'|'gtm'|'tech_lead'|'critic'|'researcher'
  parallel_group TEXT,             -- NULL for sequential, group name for parallel
  status TEXT NOT NULL DEFAULT 'pending',
                                   -- 'pending'|'running'|'completed'|'rejected'
  result_summary TEXT,
  feedback TEXT,                   -- rejection reason, conditions, etc.
  worker_session TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE fan_in_tracker (
  run_id TEXT NOT NULL,
  parallel_group TEXT NOT NULL,
  expected INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  any_rejected INTEGER DEFAULT 0,
  results JSON DEFAULT '[]',
  PRIMARY KEY (run_id, parallel_group)
);
```

---

<!-- docalign:skip reason="illustrative_example" description="Memory Layer section including sample mem0 CLI invocations and recalled-context injection format — these are illustrative usage examples, not falsifiable implementation claims about the actual skill scripts" -->
## 7. Memory Layer (Custom Mem0 Skill)

Mem0's core API supports full metadata filtering. The OpenClaw plugin doesn't expose it. Solution: custom skill calling the API directly.

**Config:**
- `autoRecall: false` — disable plugin's unscoped auto-recall
- `autoCapture: true` — keep automatic memory extraction

**Two-tier model:**

| Scope | Tagged With | Contains | Recalled When |
|---|---|---|---|
| Feature | `feature_id: feat-123`, `scope: feature` | Spec decisions, review feedback, debate positions, implementation details | Working on that specific feature |
| Global | `scope: global` | Cross-cutting preferences, architectural decisions, team patterns | Always (small set, injected into all agents) |

**Skill interface:**
```bash
mem0 recall --feature feat-123 --scope feature   # feature memories only
mem0 recall --scope global                         # global memories only
mem0 recall --feature feat-123 --scope all         # both
mem0 store --feature feat-123 --scope feature --content "PM approved spec with conditions: ..."
mem0 store --scope global --content "Team preference: event-driven over polling"
```

**Injection format** (prepended to worker task descriptions):
```
## RECALLED CONTEXT (may not apply to current task)
### Feature: feat-123 (URL health checks)
- PM approved spec with condition: debounce must be configurable
- Critic flagged generic error messages in round 1 — fixed in round 2
### Global
- Prefer event-driven architectures
- Docs must work for humans and AI agents
```

Agents evaluate relevance rather than blindly incorporating.

---

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Debate Mechanism prose with example structured output format blocks — the output format blocks are illustrative templates, not code" -->
## 8. Debate Mechanism

Used in Feature "debate" stage and Epic "strategic debate" stage.

**Round 1 — Parallel Assessment:**
- Orchestrator spawns PM, Tech Lead, Critic, GTM as depth-2 workers simultaneously
- Each gets: the signal/topic + their persona prompt + recalled Mem0 context
- Each produces structured output:
  ```
  VERDICT: build | don't build | build with modifications
  KEY_CLAIMS: [bulleted, specific]
  CONDITIONS: [if "build with modifications"]
  RISKS: [specific scenarios]
  CONFIDENCE: high | medium | low
  ```

**Convergence Check:**
- Orchestrator reads all positions
- **All agree** → produce decision document, advance pipeline
- **Disagreement** → Round 2

**Round 2 — Targeted Resolution:**
- Orchestrator spawns ONLY disagreeing agents
- Task includes: original topic + all Round 1 positions + specific conflict points
- Each responds to others' concerns

**Round 3 — Escalate:**
- If still disagreeing → escalate to CEO via Telegram
- Include: all positions, specific disagreement points, orchestrator's recommendation
- CEO decides. Decision stored in Mem0 as global precedent.

**Max 2 debate rounds before escalation.** Debates shouldn't drag.

---

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Claude Code Handoff section including hypothetical handoff.md template — the markdown template content is an example, not a real file claim" -->
## 9. Claude Code Handoff

When CEO wants to "dig deeper" or a build stage requires implementation:

1. Orchestrator generates `_team/handoffs/{feature_id}/handoff.md`:
   ```markdown
   # Feature: URL Health Checks

   ## Pipeline Status
   Stage: Build (spec approved, 2 review rounds)

   ## Decision Summary
   [from debate — structured claims, not transcript]

   ## Spec
   [Tech Lead's spec]

   ## Review Feedback
   Round 1: Critic flagged X, PM flagged Y
   Round 2: Both resolved

   ## Acceptance Criteria
   [from PM's Define stage]

   ## Files to Modify
   [from Tech Lead's spec]

   ## Recalled Context
   [Mem0 feature-scoped + global memories]
   ```

2. CEO gets Telegram notification: "Feature X ready for build. Handoff at `_team/handoffs/feat-123/handoff.md`"

3. CEO runs Claude Code with the handoff.

4. After build, CEO tells Chief "build done for feat-123" → pipeline advances to Build Review.

---

<!-- /docalign:skip -->
## 10. Persona System Prompts

Chief uses `SOUL.md` (loaded at depth 0). All sub-agents use `AGENTS.md` (the only persona file loaded by OpenClaw at depth 1+). The prompts below are the core content — implementations add Context, Memory, and Boundaries sections.

<!-- docalign:skip reason="illustrative_example" description="Persona system prompt code blocks (PM, Tech Lead, Critic, GTM, Researcher) — these are prompt templates embedded in the doc as illustration; they may or may not match AGENTS.md files on disk exactly" -->
### PM
```
You are the Product Manager for DocAlign.

EVALUATION LENS: VALUE and SCOPE. Nothing else.

For every artifact you review:
- Does this solve a real user problem?
- Is the scope right? Not too big, not too small?
- Are acceptance criteria specific and testable?
- Does this align with our product thesis (Intent Layer)?
- Is this the highest-leverage thing we could build?

You do NOT evaluate: technical feasibility (Tech Lead), edge
cases/failures (Critic), distribution/messaging (GTM).

REVIEW OUTPUT FORMAT:
VERDICT: APPROVE | REJECT
REASONING: [2-3 sentences]
CONCERNS: [bullet list, or "none"]
SUGGESTIONS: [bullet list, or "none"]

SPEC OUTPUT FORMAT:
## Feature: [name]
## User Problem: [who has what problem]
## Solution: [what we build]
## Acceptance Criteria: [numbered, testable]
## Scope Boundaries: [what is explicitly NOT included]
## Dependencies: [what must be true first]
```

### Tech Lead
```
You are the Tech Lead for DocAlign.

EVALUATION LENS: FEASIBILITY and ARCHITECTURE. Nothing else.

Tech stack: Node.js, TypeScript (strict), Express, SQLite/PostgreSQL,
Vitest, Pino, Zod, web-tree-sitter, Octokit. Layered architecture
(L0-L7). MCP server + CLI.

For every artifact you review:
- Is this technically feasible with our stack?
- What's the technical risk?
- Does it fit our layer architecture?
- What's the implementation complexity?
- Are there dependency or integration concerns?

You do NOT evaluate: user value/scope (PM), failure modes (Critic),
distribution (GTM).

REVIEW OUTPUT FORMAT:
VERDICT: APPROVE | REJECT
REASONING: [2-3 sentences]
TECHNICAL_RISKS: [bullet list, or "none"]
ARCHITECTURE_NOTES: [bullet list, or "none"]
COMPLEXITY: LOW | MEDIUM | HIGH
```

### Critic
```
You are the Critic for DocAlign.

EVALUATION LENS: EDGE CASES and FAILURE MODES. Nothing else.

Your job is adversarial. Assume the feature will fail. Work backward.

For every artifact you review:
- What could go wrong?
- What edge cases are missed?
- What assumptions might be false?
- What's the worst-case scenario?
- What has been overlooked?

Be SPECIFIC. Name the edge cases. Describe the failure modes.
Don't say "there might be issues." Say what the issues are.

You do NOT evaluate: user value (PM), architecture (Tech Lead),
distribution (GTM).

REVIEW OUTPUT FORMAT:
VERDICT: APPROVE | REJECT
FAILURE_MODES: [bullet list — specific scenarios]
EDGE_CASES: [bullet list — specific inputs/states]
MISSING: [what's overlooked]
RISK_LEVEL: LOW | MEDIUM | HIGH
```

### GTM
```
You are the GTM Strategist for DocAlign.

EVALUATION LENS: DISTRIBUTION and MESSAGING. Nothing else.

For every artifact you review:
- How do we tell this story?
- What's the content angle? (blog, tweet thread, demo, comparison)
- Who is the audience for this specific thing?
- What's the distribution channel?
- Does this create shareable moments?

Write for developers. Be specific, technical, honest. No marketing
fluff. Remember: the automation itself IS the content strategy.

You do NOT evaluate: user value/scope (PM), technical feasibility
(Tech Lead), failure modes (Critic).

CONTENT OUTPUT FORMAT:
CONTENT_TYPE: blog | tweet_thread | demo | comparison | changelog
HEADLINE: [compelling, specific]
HOOK: [first 2 sentences]
OUTLINE: [structured]
DISTRIBUTION: [where and how]
```

### Researcher
```
You are the Research Agent for DocAlign.

Your job: gather context, analyze the landscape, produce structured
briefs. You do not evaluate or decide — you investigate.

For feature research: understand problem space, check competitors,
identify prior art, assess approaches.

For market research: monitor competitors, track community, identify
patterns.

You have web search and web fetch. Use them aggressively. Cite sources.

OUTPUT FORMAT:
BRIEF_TYPE: feature | market | competitive | technical
SUMMARY: [2-3 sentences]
FINDINGS: [structured sections with evidence]
RECOMMENDATION: [based on findings]
OPEN_QUESTIONS: [what we still don't know]
SOURCES: [links]
```

---

<!-- /docalign:skip -->
## 11. OpenClaw Configuration

OpenClaw model assignment uses two distinct fields:
- `model` — the model this agent runs on for its own sessions (direct messages, cron jobs)
- `subagents.model` — the model used when sub-agents are spawned INTO this agent via `sessions_spawn`

For sub-agents (orchestrator, pm, tech-lead, etc.) that are only ever spawned by a parent, `subagents.model` is the operative field.
For the chief (root agent handling Telegram DMs and cron), `model` is what matters.

```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 5,
        "maxConcurrent": 8,
        "archiveAfterMinutes": 120
      }
    },
    "list": [
      {
        "id": "chief",
        "description": "Main agent — dispatch, classification, CEO surface",
        "model": "claude-sonnet-4-5",
        "skills": ["content-copilot", "pipeline", "mem0", "notify", "handoff"],
        "subagents": {
          "allowAgents": ["orchestrator", "researcher"]
        }
      },
      {
        "id": "orchestrator",
        "description": "Pipeline executor — deterministic, follows rules",
        "skills": ["pipeline", "mem0", "handoff"],
        "subagents": {
          "model": "claude-sonnet-4-5",
          "allowAgents": ["pm", "gtm", "tech-lead", "critic", "researcher"]
        }
      },
      {
        "id": "pm",
        "description": "Product Manager — value and scope",
        "skills": ["mem0"],
        "subagents": { "model": "claude-opus-4-6" }
      },
      {
        "id": "tech-lead",
        "description": "Tech Lead — feasibility and architecture",
        "skills": ["mem0"],
        "subagents": { "model": "claude-opus-4-6" }
      },
      {
        "id": "critic",
        "description": "Critic — edge cases and failures",
        "skills": ["mem0"],
        "subagents": { "model": "claude-opus-4-6" }
      },
      {
        "id": "gtm",
        "description": "GTM Strategist — distribution and messaging",
        "skills": ["mem0"],
        "subagents": { "model": "claude-sonnet-4-5" }
      },
      {
        "id": "researcher",
        "description": "Research agent — context gathering",
        "skills": ["mem0"],
        "subagents": { "model": "claude-sonnet-4-5" }
      }
    ]
  }
}
```

**Chief cron schedule:**
```
"0 7 * * *"   → Daily competitive scan: researcher checks competitor changelogs/releases
"0 8 * * *"   → Morning brief: pipeline status + overnight scan results
"0 9 * * 1"   → Weekly planning: review completed work, propose next priorities
"0 14 * * *"  → Afternoon check: competitive scan results, content queue
```

**Chief heartbeat:** 30 minutes. Safety net only. OpenClaw auto-detects `HEARTBEAT.md` in the agent workspace and triggers heartbeat polls at the platform's default interval. The checklist in `HEARTBEAT.md` defines what checks run on each poll.

---

<!-- docalign:skip reason="illustrative_example" description="File Structure section with directory tree — illustrative target layout, files shown may or may not exist" -->
## 12. File Structure

OpenClaw sub-agents only load `AGENTS.md` + `TOOLS.md` into their context (NOT `SOUL.md`).
Therefore: persona prompts for sub-agents go in `AGENTS.md`. The chief (depth 0) loads all workspace files including `SOUL.md`.

```
~/.openclaw/agents/
├── chief/
│   ├── SOUL.md           # Dispatch, classification, CEO interface
│   ├── AGENTS.md         # Operating instructions, skills, sub-agent rules
│   └── HEARTBEAT.md      # Safety net checklist (30 min)
├── orchestrator/
│   └── AGENTS.md         # Deterministic pipeline execution rules
├── pm/
│   └── AGENTS.md         # Value and scope evaluation lens
├── tech-lead/
│   └── AGENTS.md         # Feasibility and architecture lens
├── critic/
│   └── AGENTS.md         # Edge cases and failure modes lens
├── gtm/
│   └── AGENTS.md         # Distribution and messaging lens
└── researcher/
    └── AGENTS.md         # Context gathering (stateless)

~/.openclaw/skills/
├── pipeline/
│   ├── SKILL.md          # Skill manifest
│   └── scripts/
│       └── pipeline.js   # SQLite-backed pipeline CRUD + fan-in + queue
├── mem0/
│   ├── SKILL.md
│   └── scripts/
│       ├── recall.sh     # Filtered memory recall (Mem0 v2 search API)
│       └── store.sh      # Tagged memory storage (Mem0 v1 write API)
├── notify/
│   ├── SKILL.md
│   └── scripts/
│       └── notify.sh     # Telegram notifications
└── handoff/
    ├── SKILL.md
    └── scripts/
        └── handoff.js    # Generates handoff.md from pipeline state + Mem0

~/Discovery/docalign/_team/
├── pipelines/
│   ├── task.yml
│   ├── feature.yml
│   └── epic.yml
├── data/
│   └── pipeline.db       # SQLite state (WAL mode)
├── handoffs/
│   └── {feature_id}/
│       ├── handoff.md
│       └── status.json
└── outputs/
    └── {run_id}/
        └── {stage}/
            └── result.md
```

---

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="Implementation Sequence phase lists — aspirational plan, not falsifiable current-state claims" -->
## 13. Implementation Sequence

**Phase 1 — Foundation:**
1. OpenClaw agent configs (7 agents, SOUL.md files)
2. SQLite schema + pipeline management skill
3. Custom Mem0 recall/store skills
4. Task pipeline YAML + end-to-end test with one real task
5. Telegram notification skill

**Phase 2 — Full Pipeline:**
1. Feature pipeline YAML + debate mechanism
2. Fan-in logic for parallel reviews
3. Handoff generator
4. End-to-end test with one real feature
5. Tune persona prompts based on output quality

**Phase 3 — Scale:**
1. Epic pipeline YAML
2. Scheduled scans (competitive, weekly priorities)
3. Morning brief template
4. Start using it for real DocAlign development

**Phase 4 — Refinement:**
- Tune models per agent based on observed quality
- Add content creation workflows
- Add Claude Code handoff auto-resume (Heartbeat detects build completion)

---
<!-- /docalign:skip -->

<!-- docalign:skip reason="capability_description" description="What OpenClaw Gives Us list — describes platform capabilities, not this project's code" -->
## What OpenClaw Gives Us (No Code Needed)

- Sub-agents with nested orchestration (maxSpawnDepth: 2)
- Event-driven announces (primary dispatch)
- Steer/kill/cascade (redirect or terminate running agents)
- Heartbeat (scheduled safety net)
- Cron (competitive scans, weekly priorities)
- Lane queue (serialization, prevents race conditions)
- Depth-aware tool policies (workers can't spawn)
- Per-agent model assignment
- Telegram channel integration
- Mem0 auto-capture plugin
- Shared filesystem between agents

---

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="What We Build table — aspirational component list; some components exist, some may not; too coarse to assert individually" -->
## What We Build (Custom Code)

| Component | Description |
|---|---|
| SQLite state tracker | 3 tables, pipeline CRUD, step management, concurrency queue |
| Pipeline rules engine | Deterministic: read state → determine next action → spawn sub-agents |
| Pipeline management skills | `create`, `advance`, `add-step`, `complete-step`, `complete-run`, `fan-in`, `escalate`, `pause`, `resume`, `list` |
| Concurrency queue | Max 8 active runs; excess queued; auto-dequeue on complete/escalate |
| Fan-in logic | Track N announces, advance when all complete or apply rejection rule |
| Custom Mem0 skill | Shell scripts calling Mem0 v1 (writes) and v2 (search/filter) APIs |
| Escalation to human | Telegram notification + resume mechanism |
| Handoff generator | Produce handoff.md from pipeline state + Mem0 |
| 5 persona definitions | System prompts with non-overlapping evaluation criteria |
| 3 pipeline YAML definitions | Task, Feature, Epic workflow specs |

---

<!-- /docalign:skip -->
## Design Decisions Log

| Decision | Rationale |
|---|---|
| OpenClaw-only (no Antfarm) | Nested sub-agents (v2026.2.15) eliminate the constraint Antfarm was designed around. Antfarm has dead code (retry_step, escalate_to), no parallelism, 1K stars. |
| Custom Mem0 skill (not plugin) | Plugin doesn't expose metadata filtering. API does. Bypassing plugin for recall, keeping auto-capture. |
| Event-driven dispatch (not polling) | Sub-agent announces trigger immediate parent turns. Heartbeat demoted to 30-min safety net. |
| Sonnet for Chief + Orchestrator | Dispatch and classification don't need Opus-level reasoning. Reserve Opus for persona agents doing actual evaluation. |
| Opus for PM, Tech Lead, Critic | These agents make judgment calls that affect product quality. Strong reasoning matters. |
| Sonnet for GTM, Researcher | Content generation and research are less judgment-critical. Sonnet is capable enough. |
| 3 pipeline tiers (not 1) | Bug fixes shouldn't go through 10-stage debate. Epics need decomposition. Complexity-based tiers. |
| Max 2 debate rounds | Debates shouldn't drag. After 2 rounds of disagreement, CEO decides. |
| Max 3 review loops | Prevents infinite review cycles. After 3 rejections, CEO breaks the tie. |
| Rejection takes precedence | In parallel reviews, any rejection blocks. Prevents shipping with unresolved concerns. |
| SQLite (not filesystem) | Atomic operations, survives restarts, queryable state. Better than JSON/YAML files. |
| Non-overlapping agent criteria | Prevents duplicate feedback, wasted tokens, and ambiguous responsibility. |
| AGENTS.md for sub-agents (not SOUL.md) | OpenClaw sub-agents at depth 1+ only load AGENTS.md + TOOLS.md. SOUL.md is only loaded at depth 0 (chief). |
| Mem0 v1 for writes, v2 for search | v1 API handles memory creation with metadata. v2 API provides search with metadata filtering. Both work correctly. |
| Concurrency queue in pipeline.js | Max 8 active runs enforced at creation time. Auto-dequeue (oldest first) on complete-run, escalate, or pause. |
| Per-stage rejection tracking | `complete-step` computes `stage_rejection_count` from steps table. Returns `escalation_recommended: true` at >= 3. Global `review_loop_count` kept for reporting only. |
| Pause/resume commands | Design lists 'paused' as valid status. CEO can pause active runs (frees concurrency slot) and resume them (respects concurrency limit). |
| GTM in all feature debates | Section 2 and feature.yml both include GTM in feature debate Round 1. All 4 personas (PM, Tech Lead, Critic, GTM) participate. |
| Competitive scan cron | Daily at 7am ET. Spawns researcher to check competitor changelogs/releases. Proposes features to CEO if warranted. |
| Mem0 plugin: autoCapture=true, autoRecall=false | Plugin handles automatic memory extraction. Custom skill handles scoped recall with metadata filtering. |
| Heartbeat: platform-managed interval | OpenClaw auto-detects HEARTBEAT.md and triggers at platform default interval (~30 min). No explicit config needed. |
