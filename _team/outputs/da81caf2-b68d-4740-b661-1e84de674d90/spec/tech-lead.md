# Spec — Tech Lead

## Overview
Implement a strict pre-verify gate in `pipeline.js`: block `cmdAdvance --stage verify` when current stage is `code_review` and follow-up triage is incomplete.

## Data Contract
Path: `~/Discovery/docalign/_team/outputs/<run_id>/code_review/followups.json`

JSON schema (logical):
```json
[
  {
    "id": "string",
    "source": "codex|pm|tech-lead|critic|other",
    "summary": "string",
    "status": "accepted_fixed|not_real|not_applicable",
    "rationale": "string (required for not_real/not_applicable)"
  }
]
```

## Enforcement Rules
- File must exist.
- Must parse as non-empty JSON array.
- Every item must have allowed terminal status.
- `not_real` and `not_applicable` require non-empty `rationale`.
- Any violation => fail command with explicit unresolved list.

## Implementation
- Add helper `validateFollowupTriageForVerify(runId)`.
- Call helper in `cmdAdvance` before DB update when transition is `code_review -> verify`.
- Reuse existing fatal path for fail-closed behavior.

## Test Plan
1. Missing file -> command fails.
2. Invalid JSON -> fails.
3. Empty array -> fails.
4. Unknown status -> fails.
5. Missing rationale for `not_real` -> fails.
6. Valid fully triaged list -> succeeds.
