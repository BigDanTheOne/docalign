# Decision Document — No-Merge Until Follow-ups Triaged

Run ID: `da81caf2-b68d-4740-b661-1e84de674d90`

## Decision
Adopt a **hard merge gate**: PR flow cannot advance from `code_review` to `verify` (and therefore cannot merge) unless every recorded follow-up is explicitly triaged and resolved.

## Policy
1. Every follow-up item must be present in `outputs/<run_id>/code_review/followups.json`.
2. Allowed terminal triage statuses:
   - `accepted_fixed` (real issue fixed in code)
   - `not_real` (false positive; rationale required)
   - `not_applicable` (not relevant in context; rationale required)
3. Any missing/unknown status blocks progression.
4. Any `not_real`/`not_applicable` without rationale blocks progression.
5. Gate is fail-closed.

## Technical Enforcement
- Add validation in pipeline skill (`pipeline.js`) on transition `code_review -> verify`.
- Validator reads `followups.json`, ensures non-empty array, allowed statuses only, and required rationale.
- On violation, `advance` command exits with error; stage remains `code_review`.

## Risks & Mitigations
- Risk: teams forget to produce followups file.
  - Mitigation: explicit failure message includes required path.
- Risk: ambiguous triage wording.
  - Mitigation: strict status enum + rationale requirement.

## Rollout
- Immediate for all new transitions.
- Existing runs can comply by adding `followups.json` before advancing to verify.
