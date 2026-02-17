# Bootstrap Verify Policy (Temporary, Auditable Exception Path)

## Purpose
Allow a **narrow, one-time verify exception** only for bootstrap runs where current health is below the strict threshold **because the run itself is eliminating false positives**.

Default policy remains unchanged: verify requires `health_pct >= 80`.

## Scope Guardrails
A run may use this path only when all are true:
1. `docalign-health.json` exists and `health_pct < 80`.
2. `bootstrap-verify-policy.json` is present at:
   - `_team/outputs/<run_id>/verify/bootstrap-verify-policy.json`
3. Policy scope matches the exact run (`scope.run_id`), optional run type, and optional parent epic.
4. Policy is unexpired (`expires_at` in future).
5. Baseline-delta and floor checks pass:
   - `health_pct >= min_health_floor_pct` (default 50)
   - `(health_pct - baseline.health_pct) >= min_delta_pct` (default 0)
6. Rollback is explicit and strict:
   - `rollback_plan.restore_min_health_pct` must be `80`.
7. One-time use only:
   - On consumption, orchestrator writes `bootstrap-verify-policy.consumed.json`.
   - Reuse is rejected.

## Required Policy JSON

```json
{
  "exception_id": "bootstrap-verify-<id>",
  "approved_by": "tech-lead|chief|operator",
  "reason": "verify health paradox: this run reduces known false positives",
  "created_at": "2026-02-17T18:00:00Z",
  "expires_at": "2026-02-24T18:00:00Z",
  "scope": {
    "run_id": "<run-id>",
    "run_type": "task",
    "parent_epic_id": "03e6b8c9-4481-4a5c-87dd-2c0ab3cf50a4"
  },
  "baseline": {
    "health_pct": 60,
    "captured_at": "2026-02-17T17:40:00Z"
  },
  "min_health_floor_pct": 50,
  "min_delta_pct": 0,
  "rollback_plan": {
    "restore_min_health_pct": 80,
    "restore_by": "after false-positive-elimination verify closes",
    "owner": "tech-lead"
  }
}
```

## Rollback Plan
- Exception policy is temporary and expires at `expires_at`.
- One-time consumption prevents repeated bypass.
- Strict gate (`>=80`) remains default and is restored automatically by requiring rollback target = 80.
- After fix-window closes, remove any leftover bootstrap policy files in run outputs.
