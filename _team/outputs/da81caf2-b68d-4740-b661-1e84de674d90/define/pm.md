# Define — PM

## Acceptance Criteria
1. Pipeline blocks transition to `verify` when any follow-up is unresolved.
2. Pipeline blocks transition when follow-up triage is missing.
3. Pipeline blocks transition when status is not in allowed enum.
4. Pipeline blocks transition when `not_real`/`not_applicable` lacks rationale.
5. Pipeline allows transition when all follow-ups are explicitly triaged and resolved.

## Scope
- In scope: merge-gate enforcement point in pipeline stage transition.
- In scope: deterministic data contract for follow-up triage.
- Out of scope: automatic extraction of follow-up items from external PR tools.

## Definition of Done
- Decision + spec documented.
- Enforcement implemented in pipeline runtime.
- Evidence created showing gate failure and pass behavior.
