# Session Context

**Session ID:** 8698195b-1f0f-4bac-9329-b78bf5c7749c

**Commit Message:** Move to problem 3, the watchdog

## Prompt

Let's move to problem 3, the watchdog

## Summary

Let me think through what "stuck" actually means and what approaches make sense.

## Problem #3: No watchdog for stuck pipelines

### What does "stuck" look like?

A pipeline can get stuck in several ways:

1. **No orchestrator spawned** — Chief creates a run but fails to spawn orchestrator (the bug we just fixed with the skill split, but could still happen if the spawn itself fails)
2. **Orchestrator session dies mid-run** — Gateway restart, crash, OOM, or unhandled error kills the orchestrator before it completes
3. **Background exec finishes but no one polls** — The `notifyOnExit` event fires but the orchestrator session is already gone
4. **Infinite loop** — Build/review cycle loops indefinitely (we have max_loops=2 in YAML, but enforcement depends on the orchestrator following instructions)
5. **Silent stall** — An agent turn completes without advancing the pipeline, and no new event triggers the next turn

### Detection signals

The cleanest signal is **time-based staleness**: if a pipeline has been in the same stage for longer than a reasonable threshold, it's stuck. Thresholds could vary by stage:

- `research_check` / `research`: 15 min
- `build`: 45 min (Claude Code can take a while)
- `code_review` / `verify`: 20 min
- `debate` / `spec_review`: 30 min

### Options

**A. Chief session-start check** — Add a step to the Chief's session start routine (already has 3 steps). Every time Chief wakes up (new message, heartbeat), it runs `pipeline.js list --status active` and checks for staleness. Cheapest to implement — just instructions + a `stale` command in pipeline.js.

**B. System cron job** — A standalone script that runs every 10-15 minutes, queries SQLite for active runs with stale `updated_at`, and sends a Telegram notification. Independent of agent sessions — runs even if all agents are dead.

**C. Pipeline.js built-in timeout** — Add `max_duration_minutes` per stage in the YAML. When `pipeline.js status` is called, it flags stale runs automatically. Still needs something to call `status` periodically.

**D. OpenClaw scheduled task** — If OpenClaw supports cron-like scheduled agent triggers (I'd need to check), we could schedule Chief to wake up every 15 minutes and check pipeline health.

### Tradeoffs

| Option | Reliability | Depends on agents being alive | New infra |
|--------|------------|-------------------------------|-----------|
| A (Chief session-start) | Medium — only fires when Chief wakes | Yes | None |
| B (System cron) | High — runs independently | No | crontab entry + script |
| C (pipeline.js timeout) | Low alone — needs caller | Yes | pipeline.js changes |
| D (OpenClaw scheduled) | High if supported | Partially | Config only |

My instinct: **B + C combined**. Add staleness metadata to pipeline.js (so any caller can detect it), and a lightweight cron script that checks every 15 minutes and notifies via Telegram if anything is stuck. This catches problems even when all agent sessions are dead.

But A is worth considering if you want zero external infrastructure. What's your thinking?

## Key Actions

