---
name: pipeline
description: Pipeline state management for the Autonomous OS. Create, advance, and track Task/Feature/Epic pipelines through their stages. Uses SQLite for persistent state.
---

# Pipeline Management

Manage development pipelines (Task, Feature, Epic) through their lifecycle stages.

## Commands

- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js create --type <task|feature|epic> --title "..."` -- Create a new pipeline run
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js status [--run-id <id>]` -- Show pipeline status (one or all)
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js advance --run-id <id> --stage <stage>` -- Advance to next stage
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js add-step --run-id <id> --stage <stage> --agent <agent> [--parallel-group <group>]` -- Add a step
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js complete-step --step-id <id> --result <approved|rejected|completed> [--summary "..."] [--feedback "..."]` -- Complete a step
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js complete-run --run-id <id> [--status <completed|failed>]` -- Mark a run as done (auto-dequeues next queued run)
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js fan-in --run-id <id> --group <group>` -- Check fan-in status for parallel group
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js escalate --run-id <id> --reason "..."` -- Escalate to CEO (auto-dequeues next queued run)
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js pause --run-id <id>` -- Pause an active run (frees concurrency slot)
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js resume --run-id <id>` -- Resume a paused run (re-activates or queues if limit hit)
- `node ~/.openclaw/skills/pipeline/scripts/pipeline.js list [--status <active|queued|paused|completed|failed|escalated>]` -- List runs by status

## Concurrency

Max 8 concurrent active runs. New runs are automatically queued when the limit is reached. Queued runs are promoted to active (oldest first) when a slot opens via `complete-run`, `escalate`, or `pause`.

## Review Escalation

`complete-step` returns `stage_rejection_count` (per-stage) and `escalation_recommended: true` when a stage hits 3 rejections. The orchestrator should check this flag and escalate accordingly.
