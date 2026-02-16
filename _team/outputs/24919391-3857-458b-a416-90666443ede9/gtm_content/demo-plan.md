---
Schema-Version: 1
Run-ID: 24919391-3857-458b-a416-90666443ede9
Stage: gtm_content
Artifact: demo_plan
Owner: gtm
Generated-At: 2026-02-16T23:55:00+04:00
---
# Demo Plan — “From Fragile Agent Flow to Deterministic Delivery”

## Goal
Show, in under 12 minutes, that DocAlign now prevents common agent-workflow failures by enforcing harness invariants and relocation-safe path contracts.

## Audience
- CEO/content reviewers
- technical operators
- AI workflow builders deciding adoption readiness

## Narrative arc
1. **Before:** hidden path drift + inconsistent artifacts create delayed failures.
2. **After:** checks fail fast, roles are explicit, and migration remains reversible.
3. **Outcome:** higher confidence per merge, fewer latent breaks, faster review convergence.

## Live demo script (12 min)

### Segment 1 (2 min) — Context + release statement
- State release scope: harness hardening + repo relocation to `/Users/kotkot/docalign`.
- Emphasize correction-first policy and human-gated exceptions.

### Segment 2 (3 min) — Path hygiene invariant
- Introduce a known-old absolute path in a test file.
- Run `npm run check:path-hygiene`.
- Show fail output (file:line + remediation).
- Remove violation and rerun to pass.

### Segment 3 (3 min) — Stage artifact invariant
- Simulate missing/malformed stage artifact.
- Run `npm run check:stage-artifacts -- --run-id 24919391-3857-458b-a416-90666443ede9 --stage build --schema-version 1`.
- Show hard fail semantics and recovery by restoring proper frontmatter/content.

### Segment 4 (2 min) — Relocation safety + rollback posture
- Show current active root at `/Users/kotkot/docalign`.
- Briefly walk through preflight/relocate/rollback commands.
- Point to runbook rollback thresholds and on-call owner requirements.

### Segment 5 (2 min) — Review system + close
- Summarize role matrix (PM/Tech/Critic/GTM), rejection precedence, and human approval gates.
- Close with measurable impact: fewer silent failures, better stage input quality, faster confidence.

## Required assets
- Terminal with prepared pass/fail fixtures.
- Runbook excerpt (`docs/runbooks/repo-relocation.md`).
- Build evidence checklist.
- One slide with “problem → invariants → outcome”.

## Success criteria
- Audience can see at least one fail-fast check and one successful remediation.
- Relocation constraints and rollback controls are clearly understood.
- Human exception model is explained without ambiguity.

## Risks + mitigations
- **Risk:** Demo environment too clean (no visible failure).  
  **Mitigation:** Keep prepared fixture for guaranteed path-hygiene failure.
- **Risk:** Over-indexing on internals.  
  **Mitigation:** Tie each check to operator/business outcome.
- **Risk:** Confusion around old path references.  
  **Mitigation:** Repeat active path contract and note compatibility-symlink sunset policy.
