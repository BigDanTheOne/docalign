# HARNESS_PLAYBOOK.md
**Purpose:** a practical playbook for building and operating *high-autonomy* coding agents (and for designing products in the agentic/vibe-coding field).  
**Audience:** us (founders) + future teammates/agents.  
**Scope note:** This is about *how autonomy is achieved mechanically* (orchestration + context + tools + verification + memory + controls). It’s not “model magic.”

---

## 0) The core thesis
High autonomy is not a single feature and not a single model. It is a **harnessed system** that makes agent behavior:
- **repeatable** (same conditions → similar outcomes)
- **verifiable** (claims tied to checks)
- **bounded** (blast radius controlled)
- **recoverable** (easy to rollback)
- **economical** (cost predictable enough to operationalize)

Autonomy increases when you improve the harness. Models help, but harness dominates outcomes in real workflows.

---

## 1) The harness stack (mental model)
Think in layers. Weakness at any layer caps autonomy.

### L1 — Intent & constraints
- what outcome we want (behavior, acceptance criteria)
- constraints (security, cost, latency, deadlines, “don’t touch X”)
- definition of done (machine-checkable when possible)

### L2 — Orchestration & roles
- who does what (planner vs implementer vs reviewer/tester vs judge)
- decomposition method (task graph, ownership boundaries)
- coordination (shared task board, merge/conflict control, stop conditions)

### L3 — Context system
- how the agent “knows the repo”
- dynamic context discovery (search, open, summarize, index)
- memory artifacts (progress logs, decisions, feature checklist)

### L4 — Tooling & execution environment
- filesystem access, shell, build/test, package managers
- isolation boundaries (workspace, container, VM)
- network egress policy (on/off, allowlist)
- secret/credential model (scoped tokens, vault integration)

### L5 — Verification & evaluation
- unit/integration/e2e tests
- static checks (lint/type)
- behavioral checks (golden flows)
- eval harnesses & metrics (task success, regression rates, false positives)

### L6 — Governance & safety
- permission model (ask/allow/deny)
- auditing (artifacts retained, provenance)
- budget/cost controls (caps, alerts, entitlements)
- incident response (classification, rollback, learning loop)

---

## 2) The default agent loop (the “operational heartbeat”)
A reliable agent system repeatedly cycles through:

1) **Plan**
   - restate goal + constraints + definition of done
   - produce a step plan + validation plan
   - identify risks + assumptions

2) **Retrieve context (on-demand)**
   - search → open minimal relevant snippets → stop when sufficient
   - never “load everything”
   - record any discovered invariants

3) **Execute (incrementally)**
   - small scoped changes, frequent checkpoints
   - keep diffs reviewable

4) **Verify**
   - run checks; if fail, diagnose and iterate
   - treat verification failures as first-class signals (not annoyances)

5) **Summarize artifacts**
   - what changed, why, evidence, remaining risks
   - update progress/decision/checklist artifacts

6) **Judge**
   - decide: done / iterate / rollback / escalate to human

Autonomy is mostly: “the agent can iterate through steps 2–5 without human babysitting,” because the system gives it clarity, tools, and gates.

---

## 3) Role decomposition (how “swarms” actually work)
A “swarm” is useful only if it has **separation of concerns**. Flat swarms drift, duplicate work, and deadlock.

### Recommended roles
- **Planner:** turns goals into tasks, picks boundaries, assigns owners.
- **Implementer(s):** executes one task each, scoped by files/modules.
- **Reviewer/Tester:** tries to break changes, strengthens tests, spots risks.
- **Judge:** decides pass/fail against definition of done, triggers rollback/escalation.

### Coordination contract
- single shared task board (even if it’s just a markdown checklist)
- explicit file/module ownership per task
- concurrency policy (how many parallel workers, conflict protocol)
- checkpoint cadence (what triggers a “checkpoint” / commit / artifact update)

**Anti-pattern:** “Everyone works on everything.”

---

## 4) The three critical artifacts (non-negotiable for long-running autonomy)

### 4.1 Feature Checklist (Definition of Done)
A structured list of outcomes. The agent can only mark items complete when verified.

**Format suggestion:**
- Each item has: id, description, verification method, status, evidence link/output.

**Rules:**
- you may add tests/checks to satisfy the list
- you may not delete tests to make it green
- “works on my machine” is not evidence unless codified

### 4.2 Progress Log
Append-only daily/iteration notes:
- what was tried
- what changed
- what failed and why
- current best hypothesis
- next tasks
- open risks

This prevents drift and makes “resume later” reliable.

### 4.3 Decision Log
When we make a call (architecture, tool, scope, market):
- decision
- why
- alternatives considered
- revisit trigger (“we’ll reconsider if X happens”)

This stops “strategic hallucination” where the system keeps re-litigating settled choices.

---

## 5) Context engineering rules (dynamic context discovery)
Context bloat kills autonomy. The harness must make context retrieval *cheap and targeted*.

### Retrieval ladder
1) repo index / file tree
2) keyword search / ripgrep
3) open specific file regions
4) summarize to a short note
5) only then: broader reads if required

### Practical heuristics
- store long outputs to files and reference them, don’t paste everything into prompts
- summarize discoveries into the progress log (“invariants we learned”)
- prefer “source of truth artifacts” over chat memory

### Anti-patterns
- preloading entire repos
- pasting huge logs into the context window
- letting the agent “guess” the architecture instead of discovering it

---

## 6) Verification harness (how you turn capability into reliability)
Verification is the difference between “wow demo” and “production workflow.”

### Gate hierarchy
- **Static gates:** lint, typecheck, formatting
- **Build gates:** compile, bundle, dependency integrity
- **Test gates:** unit/integration/e2e
- **Behavior gates:** golden flows, screenshots, contract tests
- **Safety gates (for agents):** permission checks, sandbox checks, secret leak checks

### “No pass, no done”
Agents don’t declare success because they feel good. They declare success because gates passed and evidence exists.

### Metric mindset
Track at least:
- task success rate (per class of task)
- regression rate
- time-to-pass-gates
- cost per completed task
- false positive/false negative rates (especially for review bots)

---

## 7) Tool policy, safety, and *defaults* (why enterprises lag)
Most orgs don’t fail to adopt because autonomy is impossible. They fail because **defaults are unsafe** or **controls are missing**.

### Default autonomy level
Define default mode explicitly:
- **Safe default:** ask-before-execute + scoped permissions + strong isolation
- **Frontier default:** aggressive execution with guardrails + stronger rollback + higher budget

### Tool execution policy
For each tool category (file edits, shell, network, git, package install):
- default: ask / allow / deny
- scope: path allowlists, command allowlists
- escalation: what triggers human review

### Isolation boundary
Pick the default environment:
- workspace-only (fast, riskier)
- container (good baseline)
- VM (strongest isolation, heavier)

### Secrets handling
Defaults must answer:
- how secrets are injected (never in prompts)
- how tokens are scoped (least privilege)
- what gets redacted
- how the agent is prevented from reading sensitive files

### Audit & artifacts
Decide what’s stored by default:
- prompts? tool calls? diffs? logs? test outputs?
- where are they stored?
- who can see them?

### Budget controls
Without cost boundaries, autonomy collapses:
- per-task budget cap
- per-user/workspace entitlements
- alerts on abnormal burn
- backoff / degrade modes when near limit

### Stop conditions (escalation triggers)
Examples:
- touching sensitive paths
- installing deps / running scripts with network egress
- modifying auth, payments, infra code
- large diffs / cross-module changes
- repeated verification failures
- tool-call patterns that resemble injection/exfiltration

---

## 8) Incident system (don’t let anecdotes drive the roadmap)
Maintain an incident log with structure:

- **source type:** official / reputable media / anecdote
- **repro status:** confirmed / unconfirmed / unknown
- **root-cause class:** sandbox failure / policy default / command ambiguity / prompt injection / bad retrieval / model error / flaky tests / infra outage
- **blast radius:** local / repo / org / customer impact
- **mitigation:** what harness change would have prevented it?

Incidents are not “gotchas.” They are free product requirements.

---

## 9) Market segmentation through a harness lens
Adoption is not uniform. Different segments buy different harness strengths.

### Frontier teams (AI-native)
- tolerate risk for speed
- want autonomy and orchestration
- accept rough edges if throughput is high
- budget is important but flexible

### Mainstream teams
- want predictable improvement
- need guardrails + good UX
- prefer incremental adoption (assist → agent → workflows)

### Enterprises
- buy governance: auditability, policies, isolation, identity, compliance, procurement
- prefer conservative defaults
- require integration with existing systems
- cost predictability + accountability are mandatory

**Implication:** your product can win by:
- starting with frontier workflows, then hardening defaults; or
- starting with governance-first and proving ROI through controlled autonomy.

---

## 10) Product design implications (what we should build in this space)
If we’re building “vibe coding / agentic dev,” your moat rarely comes from “our agent is smarter.”
It comes from harness advantages:
- better defaults for safe autonomy
- superior verification UX (“evidence-first”)
- better context system (fast retrieval + minimal bloat)
- stronger governance (policies, audit, identity)
- cost/latency predictability
- distribution/control plane (where users already live)

---

## 11) Checklists (copy/paste)

### Harness readiness (minimum)
- [ ] Clear definition-of-done checklist exists
- [ ] Progress log exists and is updated each iteration
- [ ] Tool permissions configured with allow/ask/deny
- [ ] Isolation boundary selected and documented
- [ ] Secrets handling defined (and tested)
- [ ] Verification gates defined and runnable
- [ ] Budget caps and alerts defined
- [ ] Stop conditions documented

### “Resume session” routine
- [ ] Read progress log (last 1–3 entries)
- [ ] Read decision log (recent)
- [ ] Identify top failing checklist items
- [ ] Run baseline sanity checks
- [ ] Pick one scoped task and proceed
