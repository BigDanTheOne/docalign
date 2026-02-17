---
Schema-Version: 1
Run-ID: 24919391-3857-458b-a416-90666443ede9
Stage: decision
Agent: orchestrator
Generated-At: 2026-02-16T22:57:00+04:00
---
# Decision Document (Revised for CEO Review)
## Feature: Apply Harness-Engineering Patterns to DocAlign + Relocate Repo Path

**Run ID:** `24919391-3857-458b-a416-90666443ede9`  
**Pipeline Type:** `feature`  
**Current Stage:** `define`  
**Date:** 2026-02-16

---

## 1) Decision summary (updated per CEO feedback)

| # | Decision | Status | Timing |
|---|---|---|---|
| D1 | Repository as source of truth + AGENTS as navigation layer | **Adopt** | Phase 1 |
| D2 | Progressive context disclosure by stage | **Adopt** | Phase 1 |
| D3 | Mechanical invariants (blocking checks) | **Adopt** | Phase 1–2 |
| D4 | Path abstraction (ban new absolute paths) | **Adopt** | Phase 1 |
| D5 | Repo relocation to `/Users/kotkot/docalign` + rollback harness | **Adopt** | Phase 1 |
| D6 | Agent observability legibility (run evidence standards) | **Adopt** | Phase 2 |
| D7 | Continuous quality gardening | **Adopt** | Phase 3 |
| D8 | Failure→capability loop | **Adopt** | Phase 2–3 |
| D9 | Aggressive correction-first merge policy | **Adopt as default first-merge policy** | Phase 1 |
| D10 | AI-agent review process (roles, review flow, gates, human approvals) | **Adopt** | Phase 1 |

**Critical update:** D9 is no longer deferred. Correction-first is now the default first-merge policy; exceptions require explicit hard-blocker justification and human approval.

---

## 2) Concrete policy updates

### D9 — Aggressive correction-first merge policy (updated)

**Policy:** Any unresolved harness violation blocks merge by default on first pass.

**Allowed exception:** Only when a **hard blocker** exists (e.g., production incident mitigation requiring emergency patch path). Exception requires:
1. Explicit blocker rationale recorded in artifact,
2. Named approver (human),
3. Time-boxed follow-up fix ticket,
4. Re-review gate before closure.

**Implementation gates:**
- CI checks set to fail-closed for path hygiene, required stage artifacts, and rule metadata.
- No “warn-only” mode for these core checks in normal flow.
- Emergency bypass path is auditable and expires automatically.

---

### D10 — AI-agent review process (from referenced harness pattern)

We adopt an explicit multi-agent review pipeline with clear role boundaries and mandatory human gates.

#### Roles
- **Author agent**: produces or revises artifact/spec/code.
- **Reviewer agents**:
  - **PM lens** (scope/value/acceptance fit)
  - **Tech Lead lens** (architecture/feasibility)
  - **Critic lens** (failure modes/edge cases)
  - **GTM lens** (operator clarity/adoption risk when relevant)
- **Orchestrator**: enforces stage order, fan-in, rejection precedence, max-loop discipline.
- **Human approver (CEO/Chief/delegate)**: required at defined gates.

#### Review flow
1. **Author draft** created (decision/spec/change set).
2. **Parallel review round** by designated agents (structured verdicts).
3. **Fan-in rule**: any rejection blocks; author must address all feedback.
4. **Re-review** by all reviewers after revision (not just rejector).
5. **Loop cap** per stage policy; escalate when cap reached.
6. **Human approval gate** before advancing high-impact decisions (like merge policy defaults, path migration cutover, and CEO-marked decisions).

#### Required gates
- **Gate A: Technical readiness** — invariants and artifact completeness pass.
- **Gate B: Review convergence** — no unresolved reviewer rejection.
- **Gate C: Human sign-off** — required for policy-level defaults and migration cutover.
- **Gate D: Post-merge verification** — smoke/validation evidence attached.

#### Where human approval is mandatory now
1. Final approval of this decision artifact,
2. Migration cutover execution window,
3. Any hard-blocker exception to correction-first merge policy,
4. Escalations after max review loops.

---

## 3) Concise alignment: blog-practice → DocAlign adoption now

| Blog-post practice (key) | What we adopt now in DocAlign |
|---|---|
| Treat process as executable harness, not tribal memory | Mechanical invariants + fail-closed CI for core rules (D3, D9) |
| Multi-agent structured review with explicit roles | PM/Tech/Critic/GTM role matrix + orchestrated fan-in and rejection precedence (D10) |
| Clear stage contracts to control context | Stage-specific context contracts + pre-spawn validation (D2) |
| Human gates at high-risk decisions | Mandatory CEO/Chief approval at policy/migration/exception points (D10) |
| Evidence-first operations | Standard run artifacts and remediation-oriented failures (D6) |
| Continuous hardening from real failures | Failure→capability loop + recurring issue conversion to tooling/checks (D8) |

---

## 4) Migration + implementation plan (unchanged direction, stricter enforcement)

### Phase 1 (immediate)
- Implement path abstraction utility and remove active old-path refs (D4).
- Execute relocation runbook to `/Users/kotkot/docalign` with rollback plan (D5).
- Activate correction-first default policy on first merge for core checks (D9).
- Enable AI-agent review flow and human gate definitions in stage operations (D10).

### Phase 2
- Expand/tune invariant coverage and run evidence templates (D3, D6).
- Activate recurrence-based systemic fix tracking (D8).

### Phase 3
- Run scheduled quality gardening cadence (D7).

---

## 5) CEO decision points (Approve / Modify / Reject)

1. Approve relocation target path: `/Users/kotkot/docalign`.
2. Approve correction-first merge policy as **default first-merge behavior**.
3. Approve hard-blocker exception model requiring named human approval + time-boxed remediation.
4. Approve explicit AI-agent review process (roles, flow, gates, mandatory human approvals).
5. Approve strict CI fail-closed baseline checks (path hygiene, stage artifacts, rule metadata).

---

## 6) Approval gate status

**Status: PENDING CEO REVIEW/APPROVAL**  
This revision incorporates all three CEO feedback directives.

---

## 7) Provenance

This revision updates the consolidated decision artifact for run `24919391-3857-458b-a416-90666443ede9` and preserves feature-pipeline stage discipline (`define` stage, no unauthorized stage transition in this edit action).