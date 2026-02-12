# Phase 2.5: PRD Reconciliation — Change List

> Compares spike conclusions + ADR decisions against the current PRD.
> Each discrepancy: PRD section, what PRD says, what spike concluded, proposed update.
> **Status:** ✅ Complete. All 28 changes applied to PRD files on 2026-02-11.

---

## Founder Decisions (from review)

- **Q1 (Count-based in MVP):** Yes, include in MVP. But instead of 180-day suppression, **permanently exclude** the claim from checking. Claim re-enters checking only if claim text changes (doc updated → fresh extraction).
- **Q2 (Onboarding):** Option (a) — require GitHub Action setup before the App does anything useful. No partial onboarding.
- **Q3 (Tiers):** Two tiers: **Free** and **Pro**. ALL compute is client-side (both tiers). DocAlign never sees client code. Pro is differentiated by features (dashboard, scheduling, analytics, notifications, SSO, support), not compute. Free tier may be open-sourced.

## Summary

The three spikes + ADR + founder decisions introduce 5 structural changes that ripple across most PRD sections:

1. **All-client-side compute (ADR + founder decision)** — ALL LLM calls run on the client. DocAlign is pure orchestration. Zero variable costs. Never sees client code.
2. **Two-path evidence assembly (Spike B)** — Replaces token-budget evidence assembly with Path 1 (direct LLM in Action) + Path 2 (agent-delegated).
3. **Vague claim mapping solved (Spike A)** — Step 4 is no longer unsolved. Dual mechanism: static rules + decomposition.
4. **Learning generalization solved (Spike C)** — No longer unsolved. Explanation-driven + count-based fallback (MVP: count-based permanent exclusion + quick-pick fast-path).
5. **Two-tier model (Free/Pro)** — Same execution model, Pro adds features.

These changes produce **28 PRD discrepancies** organized below by document.

---

## Change 1: Remove Tier 3 Triage Gate

**Source:** ADR Decision 3
**Affects:** PRD.md, L3-verification-engine.md, cost-model.md, L4-change-scanning.md

### 1a. PRD.md — LLM Model Configurability table (line ~50)

**PRD says:** Table includes row: `Triage gate | GPT-4o-mini | Binary classification (accurate/drifted/uncertain)`
**Spike concluded:** Tier 3 removed entirely. No triage gate.
**Proposed update:** Delete the triage gate row from the table.

### 1b. PRD.md — Section 7 summary (line ~260)

**PRD says:** "5-tier pipeline (syntactic → pattern → triage → semantic → post-check)"
**Spike concluded:** Tier 3 removed. Pipeline is now: syntactic → pattern → semantic (split into Path 1 entity extraction + Path 2 agent) → post-check.
**Proposed update:** Change to: "4-tier pipeline (syntactic → pattern → semantic verification → post-check). Semantic verification uses two paths: Path 1 (entity extraction + focused LLM) for simple claims, Path 2 (agent-delegated) for complex claims."

### 1c. PRD.md — MVP Scope Section 15.1 "Not in scope" (line ~397)

**PRD says:** "Layer 3 Tier 3 (triage gate -- cost optimization, deferred)"
**Spike concluded:** Tier 3 removed entirely (not deferred).
**Proposed update:** Remove this line. Add note: "Tier 3 triage gate removed by ADR (agent-first architecture makes it unnecessary)."

### 1d. PRD.md — v2 Scope Section 15.2 (line ~409)

**PRD says:** "Triage gate (Tier 3) -- critical for cost reduction"
**Spike concluded:** Tier 3 removed. Cost reduction comes from agent-first model (client pays LLM costs).
**Proposed update:** Remove this line.

### 1e. PRD.md — Appendix A config table (line ~573)

**PRD says:** Row: `models.triage | Model for Tier 3 triage gate | "gpt-4o-mini"`
**Spike concluded:** Tier 3 removed.
**Proposed update:** Delete this row.

### 1f. L3-verification-engine.md — Tier 3 section (lines 70-77)

**PRD says:** Full Tier 3 triage gate specification: cheap LLM binary classification, GPT-4o-mini, three outcomes, expected distribution, code snippet preparation.
**Spike concluded:** Tier 3 removed entirely.
**Proposed update:** Replace with: "**Tier 3: Removed.** The triage gate was removed per ADR (agent-first architecture). All semantic claims that pass Tiers 1-2 go directly to Tier 4 semantic verification. Cost optimization is achieved by the agent-first model (client pays LLM costs on free tier, DocAlign handles Path 1 verification server-side on paid tiers)."

### 1g. L3-verification-engine.md — Performance requirements (line ~114)

**PRD says:** "Tier 3 (triage): ~200-500 tokens input, ~20 tokens output, ~$0.0001 per claim"
**Proposed update:** Remove this line.

### 1h. cost-model.md — Section 14.1 table

**PRD says:** Row: `Triage gate (1 claim) | GPT-4o-mini | ~500 in, ~30 out | $0.0001`
**Proposed update:** Remove this row. Add note about agent-first cost model (see Change 6).

### 1i. cost-model.md — Section 14.2 Per PR estimate

**PRD says:** Row: `Triage (all 20 claims) | 20 claims | $0.0001 | $0.002`
**Proposed update:** Remove this row. Update total calculation.

---

## Change 2: Update Step 4 Mapper (No Longer Unsolved)

**Source:** Spike A
**Affects:** L2-code-claim-mapper.md, PRD.md

### 2a. L2-code-claim-mapper.md — Step 4 (lines 32-36)

**PRD says:** "⚠️ STATUS: Solution not yet developed. Placeholder approaches exist. MVP decision: Skip unmappable claims in MVP (Option C)."
**Spike concluded:** Solved. Dual mechanism: (a) LLM-generated static analysis rules for universal/quantified claims, (b) claim decomposition into sub-claims for architecture flow claims. MVP still skips Step 4 but tracks fallthrough with `mapping_method: 'skipped_flow' | 'skipped_universal'`.
**Proposed update:** Replace ⚠️ block with: "**STATUS: Solved (see Spike A).** Dual mechanism: (a) universal/quantified claims → LLM-generated static analysis rules (deterministic evaluation, $0 per check after generation), (b) architecture flow claims → decomposition into 2-5 localizable sub-claims, each mapped via Steps 1-3. **MVP decision:** Skip Step 4 in MVP. Track which claims fall through with `mapping_method: 'skipped_flow'` or `'skipped_universal'` to inform v2 priorities. Implement dual mechanism in v2."

### 2b. L2-code-claim-mapper.md — Open Questions 6.7 (lines 69-72)

**PRD says:** "⚠️ How to handle architecture-level claims that span multiple files? Current recommendation is to skip in MVP."
**Spike concluded:** Solved by Spike A.
**Proposed update:** Replace with: "Architecture-level claims: solved by Spike A (static rules + decomposition). Skipped in MVP; implement in v2. See `phases/spike-a-vague-claim-mapping.md`."

### 2c. L2-code-claim-mapper.md — Mapping method values (line ~49)

**PRD says:** Mapping methods: `direct_reference, symbol_search, semantic_search, llm_assisted, manual`
**Spike concluded:** Add `static_rule` (for Spike A universal claims, v2), `skipped_flow`, `skipped_universal` (for MVP tracking).
**Proposed update:** Update method list to: `direct_reference, symbol_search, semantic_search, llm_assisted, static_rule, skipped_flow, skipped_universal, manual`

### 2d. PRD.md — Data Models Section 12.2

**PRD says:** No `static_analysis_rules` entity.
**Spike concluded:** Spike A introduces a `StaticAnalysisRule` stored per claim. Contains scope glob, checks array, source (llm_generated / user_defined).
**Proposed update:** Add entity description: "**static_analysis_rules (v2):** LLM-generated or user-defined rules for verifying universal/quantified claims deterministically. Stores claim_id, scope glob, scope exclusions, checks array (import checks, pattern checks, AST checks), source, and generation cost. See Spike A."

### 2e. PRD.md — v2 Scope Section 15.2

**PRD says:** No mention of Spike A mechanisms.
**Proposed update:** Add: "Step 4 mapping: static analysis rules (universal claims) + claim decomposition (flow claims) — see Spike A"

---

## Change 3: Rewrite Evidence Assembly (Two-Path Model)

**Source:** Spike B
**Affects:** L3-verification-engine.md

### 3a. L3-verification-engine.md — Section 7.5 Evidence Assembly Rules (lines 119-157)

**PRD says:** Fixed token budgets (Tier 3: 2000 tokens, Tier 4: 4000 tokens), keyword search for file-mapped claims, truncation from end, multi-file capping, tiktoken for token counting. Detailed rules for entity-mapped, file-mapped, multi-file evidence preparation.

**Spike concluded:** Two-path model replaces all of this:
- **Path 1 (~60-70% of claims):** Single entity mapped, entity_line_count ≤ 500. Extract entity via tree-sitter + imports + type signatures. Deterministic, <5ms, $0 for evidence assembly. ~100-800 tokens.
- **Path 2 (~30-40% of claims):** File-mapped, large entity, multi-file, or no mappings. Delegate ENTIRE verification to client's agent. Agent assembles its own context. No evidence assembly step.
- Token budgets, keyword search, truncation strategy, tiktoken — all eliminated.

**Proposed update:** Replace Section 7.5 entirely with:

```
### 7.5 Evidence Assembly (Two-Path Model)

Evidence assembly determines what code context supports verification.
Solved by Spike B — see `phases/spike-b-evidence-assembly.md` for full specification.

**Path 1: Direct Entity Extraction (~60-70% of claims)**
- Applies when: single entity mapped, entity ≤ 500 lines
- Extracts: entity code (tree-sitter node span) + file imports (up to 30 lines) + same-file type signatures
- Deterministic, <5ms, $0 cost. Typical evidence size: 100-800 tokens
- Evidence package sent to verification LLM (server-side on paid tiers, agent on free tier)

**Path 2: Agent-Delegated Verification (~30-40% of claims)**
- Applies when: file-mapped without entity, large entity (>500 lines), multi-file, or no mappings
- Delegates ENTIRE verification to client's configured AI agent
- Agent receives claim + file hints, explores codebase autonomously, returns verdict directly
- No evidence assembly step — the agent IS the verifier
- See Spike B Section 5.2 and ADR Section 4 for agent interface

**Routing is deterministic** based on mapping metadata (no LLM call). See Spike B Section 5.3 for routing pseudocode.

**Token budgets, keyword search, truncation strategy eliminated.** Path 1 uses exact entity extraction. Path 2 lets agent manage its own context.
```

### 3b. L3-verification-engine.md — Open Question 7.6 (lines 151-155)

**PRD says:** "⚠️ Evidence assembly 4000-token cap may be insufficient for architecture-level claims requiring cross-file reasoning." Plus questions about Tier 5 safety and post-check effectiveness.

**Spike concluded:** No token cap needed. Path 2 agent handles cross-file reasoning natively. The ⚠️ about evidence cap is resolved.

**Proposed update:** Remove the evidence cap question. Keep the Tier 5 questions (still open):
```
### 7.6 Open Questions
- **⚠️ Is agent-generated shell command execution (Tier 5) safe enough?** Risk of injection. Alternative: use a restricted DSL instead of shell commands.
- **⚠️ How often does post-check actually catch false positives?** Need data.
```

### 3c. L3-verification-engine.md — Tier 4 description (lines 79-84)

**PRD says:** "Deep analysis of claim vs code for uncertain cases. Model: Claude Sonnet (best accuracy per benchmarks). Produces: verdict, severity, reasoning, mismatch description, suggested fix text."

**Spike concluded:** Tier 4 now has two sub-paths. Both run client-side in the GitHub Action.

**Proposed update:** Expand Tier 4:
```
**Tier 4: Semantic Verification (all client-side)**
- **Path 1 (entity-mapped claims, ~60-70%):** Entity evidence + claim sent to LLM via direct API call in the GitHub Action. Fast (1-3s). Model configurable (default Claude Sonnet). Produces: verdict, severity, reasoning, mismatch, suggested fix.
- **Path 2 (file-mapped, large entity, multi-file, no mappings, ~30-40%):** Entire verification delegated to client's AI agent within the Action. Agent explores codebase, assembles own context, returns verdict directly. Agent may also propose fixes to Spike A rules and mapper issues.

Both paths run in the client's GitHub Action using the client's API key. DocAlign server never sees code content.
```

### 3d. PRD.md — Experiment 16.3 (lines 493-514)

**PRD says:** Experiment to determine how much code evidence is needed per claim by varying evidence window sizes.

**Spike concluded:** Path 1 uses exact entity extraction (no window to tune). Path 2 lets agent handle it. The experiment design needs updating.

**Proposed update:** Rewrite experiment:
```
### 16.3 Experiment: Path 1 vs Path 2 Routing Effectiveness

**Goal:** Validate that the Path 1/Path 2 routing produces accurate verdicts and that Path 1 entity extraction provides sufficient context.

**Method:**
1. Select 50 claims with known ground truth (manually labeled verified/drifted)
2. Route each through the two-path system
3. For Path 1 claims: measure verdict accuracy with entity-only evidence
4. For Path 2 claims: measure agent verdict accuracy
5. Check routing correctness: did claims that needed Path 2 get routed there?

**Success criteria:**
- Path 1 accuracy >= 75% (entity extraction is sufficient for simple claims)
- Path 2 accuracy >= 70% (agent handles complex claims effectively)
- Routing correctness >= 90% (wrong-path claims are rare)
```

---

## Change 4: Resolve Learning System (No Longer Unsolved)

**Source:** Spike C
**Affects:** L7-learning-system.md, L5-report-fix.md, PRD.md

### 4a. L7-learning-system.md — Section 11.3 Learning Generalization (lines 33-41)

**PRD says:** "⚠️ STATUS: Solution not yet developed. This is the hardest unsolved piece. MVP decision: Start with simple rule-based suppression."

**Spike concluded:** Solved. Explanation-driven + agent auto-fix + count-based fallback.
**Founder decision (Q1):** Count-based fallback uses **permanent exclusion** (not 180-day suppression). Quick-pick fast-path + count-based permanent exclusion are **MVP** features.

**Proposed update:** Replace ⚠️ block with:
```
### 11.3 Learning Generalization

**STATUS: Solved (see Spike C).** Explanation-driven learning with count-based fallback.

**MVP features:**

**Path A: Quick-Pick Fast-Path (developer selects a reason)**
- On thumbs-down, prompt developer "Why isn't this useful?" with 4 quick-picks + free-text
- Quick-picks: "Migration in progress" | "Doc file is known-stale" | "Don't care about this check" | "Finding is wrong"
- Quick-picks → deterministic corrective actions (no LLM cost, no agent call)

**Path B: Count-Based Permanent Exclusion (developer gives bare thumbs-down, no explanation)**
- After 2 silent dismissals on the same claim → permanently exclude claim from checking
- Claim re-enters checking only if claim text changes (doc file updated → fresh extraction)
- No broader scopes from counts alone — per-file/per-type requires an explanation
- Dismiss-all = 0x weight (UI convenience, not a learning signal)

**v2 features:**

**Path C: Free-Text Agent Interpretation**
- Free-text explanation → AI agent interprets and applies corrective actions autonomously
- Actions: suppress claim, suppress claim type, mark file stale, update static rule, suggest doc update
- Safety valves: rules expire (90-180 days), periodic spot-checks (14-day for agent rules, configurable), positive feedback override (2 signals revokes rule), developer undo button

See `phases/spike-c-learning-generalization.md` for full specification.
```

### 4b. L7-learning-system.md — Signal 1 (lines 11-14)

**PRD says:** Simple "dismissed 2+ times → suppress. If claim_type + file pattern >50% dismiss rate → lower confidence threshold."

**Spike concluded:** Count-based is FALLBACK only. Primary path is explanation-driven.
**Founder decision:** Count-based = permanent exclusion (not time-limited). Quick-pick + count-based are MVP.

**Proposed update:** Replace Signal 1 with:
```
**Signal 1: Developer Feedback on Findings**
- Collection points: Review comment reactions (thumbs up/down per finding), explanation prompt (quick-pick or free-text after thumbs-down), suggestion accepted/dismissed
- **MVP — Quick-pick path:** Developer selects a reason → deterministic corrective action (no LLM cost)
- **MVP — Count-based fallback:** 2 bare thumbs-down on same claim → permanently exclude claim from checking. Claim re-enters only if claim text changes. Broader scopes require an explanation.
- **v2 — Free-text path:** Developer writes explanation → agent interprets and applies corrective actions
- Dismiss-all = 0x weight (not a learning signal)
- v2 suppression rules have expiration dates, periodic spot-checks, and positive-feedback revocation
```

### 4c. L7-learning-system.md — Open Questions 11.5 (lines 57-60)

**PRD says:** "⚠️ Learning generalization is unsolved. This experiment cannot run until the product has real users."

**Spike concluded:** Solved by Spike C.

**Proposed update:** Remove both ⚠️ markers. Replace with: "Learning generalization approach is defined (Spike C). Experiment 16.4 validates the approach with real usage data once available."

### 4d. L5-report-fix.md — Feedback collection (lines 37-42)

**PRD says:** Feedback via reactions only (thumbs up/down, suggestion accepted/dismissed).

**Spike concluded:** After thumbs-down, DocAlign shows an explanation prompt (reply to its own comment thread). 4 quick-picks + free-text. Developer can ignore (48h timeout → silent dismissal).

**Proposed update:** Add after existing feedback section:
```
**Explanation prompt (on thumbs-down):**
- After a thumbs-down reaction, DocAlign replies to its own comment thread with an explanation prompt: "Why isn't this useful?" with 4 quick-picks + optional free-text
- Quick-picks: "Migration in progress" | "Doc is known-stale" | "Don't care about this check" | "Finding is wrong"
- Developer can ignore the prompt (48h timeout = silent dismissal)
- Quick-pick responses trigger deterministic corrective actions (no LLM cost)
- Free-text responses are interpreted by the AI agent (same agent as Spike B)
- See Spike C for full specification
```

### 4e. L5-report-fix.md — Dismiss all (line ~28)

**PRD says:** Dismiss all link records dismissal for all findings on this PR. "Dismissal applies only to this PR's current findings, not future scans."

**Spike concluded:** Dismiss-all = 0x weight. Does not count toward suppression thresholds. UI convenience only.

**Proposed update:** Add to dismiss-all paragraph: "Dismiss-all carries 0x learning weight — it does not count toward per-claim suppression thresholds (see Spike C). Only individual per-finding thumbs-down dismissals are learning signals."

### 4f. PRD.md — Experiment 16.4 (lines 517-530)

**PRD says:** "Determine how to generalize developer feedback to suppress future false positives." Experiment cannot run until real users.

**Spike concluded:** Approach is defined (explanation-driven + count-based). Experiment validates the approach, not discovers it.

**Proposed update:** Rewrite:
```
### 16.4 Experiment: Learning System Effectiveness

**Goal:** Validate that explanation-driven learning + count-based fallback (Spike C) effectively reduces false positives without over-suppressing.

**Method (requires real usage data):**
1. Collect 100+ feedback signals from beta users
2. Measure: explanation rate (% of thumbs-down that include an explanation)
3. For explained dismissals: were agent actions appropriate? Over-correction rate?
4. For count-based fallback: how many PRs before suppression kicks in? Any over-suppression?
5. Measure spot-check effectiveness: do spot-checks catch stale rules?

**Success criteria:**
- Explanation rate >= 30% (quick-picks make it low-friction)
- Agent action appropriateness >= 80%
- Over-suppression rate < 5% (true positives incorrectly suppressed)
- False positive reduction >= 40% within 30 days of install
```

---

## Change 5: Agent-First Architecture (Cross-Cutting)

**Source:** ADR
**Affects:** PRD.md, L1-claim-extractor.md, L4-change-scanning.md, infrastructure-deployment.md, cost-model.md

### 5a. PRD.md — System Architecture Section 2.1

**PRD says:** Architecture diagram shows layers 1-7 with no distinction between server-side and client-side work.

**Spike concluded:** All-client-side compute model. DocAlign server = orchestration only.

**Proposed update:** Add below the existing diagram:
```
**Execution model (ADR: Agent-First Architecture):**
DocAlign uses a split execution model. ALL LLM calls run on the client. DocAlign never sees client code.

- **DocAlign server (orchestration):** Webhook handling, job queue, database, mapper Steps 1-3 (lookups against index), static rule evaluation, Tiers 1-2 deterministic verification, count-based exclusion, PR comment formatting.
- **Client's GitHub Action:** ALL LLM tasks — claim extraction, Path 1 verification (direct LLM call), Path 2 verification (agent-delegated), embedding generation, fix generation, feedback interpretation. Uses client's own API key.

DocAlign orchestrates WHAT to verify and WHEN. The client's Action/agent decides HOW.
See `phases/adr-agent-first-architecture.md` for full specification.
```

### 5b. PRD.md — Data Flow Section 2.2 (lines 162-169)

**PRD says:** Linear flow from webhook to PR comment with no mention of agent tasks.

**Spike concluded:** Steps now split between server (orchestration) and client (LLM work).

**Proposed update:** Rewrite data flow:
```
### 2.2 Data Flow (PR Trigger)

1. GitHub webhook fires: PR opened/updated
2. Layer 4 extracts changed files from PR diff
3. Layer 0 updates the codebase index for changed code files (server-side, deterministic)
4. Server creates agent tasks for LLM work: claim extraction (if docs changed), verification (Path 1 + Path 2), fix generation
5. Server triggers client's GitHub Action via repository dispatch
6. Action runs: direct LLM calls for Path 1, agent for Path 2, submits results to DocAlign API
7. Layer 2 queries reverse index for affected claims (server-side)
8. Layer 3 applies deterministic checks (Tiers 1-2, server-side), merges with agent verification results
9. Layer 5 formats findings into PR comment (server-side)
10. Layer 7 records the interaction for future learning (server-side)
```

### 5c. PRD.md — LLM Model Configurability section (lines 36-55)

**PRD says:** Lists 6 server-side LLM call sites with specific models. "Every LLM call site is model-configurable."

**Spike concluded:** All LLM calls are now client-side. DocAlign server makes zero LLM calls.

**Proposed update:** Rewrite the section:
```
## LLM Model Configurability

**All-client-side model (ADR):** ALL LLM tasks run on the client's GitHub Action using the client's own API key. DocAlign's server makes zero LLM calls and never sees client code.

The GitHub Action handles:
- Claim extraction (semantic)
- Path 1 verification (direct LLM call with entity evidence)
- Path 2 verification (agent-delegated exploration)
- Embedding generation
- Fix generation
- Feedback interpretation (free-text, v2)
- Project structure auto-detection

**Model choices are the client's decision.** The Action defaults to Claude Sonnet for verification and text-embedding-3-small for embeddings, but clients can override via `.docalign.yml` or Action configuration.

DocAlign's server handles ONLY deterministic, zero-LLM tasks: tree-sitter parsing, mapper lookups, static rule evaluation, Tier 1-2 syntactic/pattern checks, PR comment formatting, count-based exclusion.
```

### 5d. PRD.md — Appendix A config table (lines 551-578)

**PRD says:** LLM model config options: `models.claim_extraction`, `models.triage`, `models.verification`, `models.fix_generation`, `models.auto_detect`, `models.embedding`, `models.embedding_dimensions`.

**Spike concluded:** All LLM is client-side. Server-side model configs are irrelevant. Replace with client-side Action/agent config.

**Proposed update:** Remove ALL `models.*` rows. Replace with:
```
| Agent | `agent.adapter` | Agent adapter type for Path 2 tasks | "claude-code" |
| Agent | `agent.max_claims_per_pr` | Max claims to delegate to agent per PR | 20 |
| Agent | `agent.fallback` | What to do when agent unavailable | "skip" |
| Agent | `agent.concurrency` | Max parallel agent tasks | 5 |
| Client LLM | `llm.verification_model` | Model for Path 1 verification (client-side) | "claude-sonnet" |
| Client LLM | `llm.extraction_model` | Model for semantic claim extraction (client-side) | "claude-sonnet" |
| Client LLM | `llm.embedding_model` | Embedding model (client-side) | "openai/text-embedding-3-small" |
| Client LLM | `llm.embedding_dimensions` | Embedding vector dimensions | 1536 |
```

These are read by the GitHub Action, not by DocAlign's server.

### 5e. PRD.md — Onboarding Flow Section 3.3 (lines 193-205)

**PRD says:** Full scan includes "Make a lightweight LLM call (GPT-4o-mini)" for auto-detect, plus L1 claim extraction and L3 verification as server-side operations.

**Spike concluded:** All LLM work is client-side. Onboarding requires the GitHub Action to be set up first.
**Founder decision (Q2):** Require Action setup before App does anything useful. No partial onboarding.

**Proposed update:** Rewrite onboarding prerequisites:
```
### 3.2 Prerequisites

The GitHub Action (`docalign/agent-action`) MUST be configured in the repository before the full scan can run. The Action handles all LLM tasks (claim extraction, verification, embeddings, auto-detect). Without it, DocAlign can only receive webhooks — no scanning, no claims, no AHA moment.

**Setup flow:**
1. User installs the DocAlign GitHub App
2. DocAlign detects no Action is configured → posts a GitHub Check with instructions: "Set up the DocAlign Action to enable scanning. See docs.docalign.dev/setup"
3. User adds the Action workflow file + API key to repo secrets
4. Action's first run triggers the full onboarding scan
```

Update Step 2 (auto-detect): change from "Make a lightweight LLM call (GPT-4o-mini)" to "The Action uses the client's LLM to auto-detect project structure from the file tree."

### 5f. infrastructure-deployment.md — API Endpoints (line ~47)

**PRD says:** Three endpoints: `POST /webhook`, `GET /health`, `GET /api/dismiss`.

**Spike concluded:** ADR adds Agent Task API endpoints: `GET /api/tasks/pending`, `POST /api/tasks/{id}/result`, `GET /api/tasks/{id}`.

**Proposed update:** Add:
```
**Agent Task API:**
- `GET /api/tasks/pending?repo_id={id}` — list tasks awaiting agent execution
- `GET /api/tasks/{id}` — get full task details (claim, context, mapped files)
- `POST /api/tasks/{id}/result` — submit agent's result for a completed task

These endpoints are called by the `docalign/agent-action` GitHub Action running in the client's CI.
Authentication: DocAlign API token (provided during setup, stored as GitHub Secret).
```

### 5g. infrastructure-deployment.md — Secret management (lines 36-43)

**PRD says:** Lists `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as DocAlign server secrets.

**Spike concluded:** All LLM is client-side. DocAlign server needs NO LLM API keys.

**Proposed update:** Remove `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from server secrets entirely. Server secrets become:
```
- `GITHUB_APP_ID` — GitHub App ID
- `GITHUB_PRIVATE_KEY` — GitHub App private key (PEM format)
- `GITHUB_WEBHOOK_SECRET` — Webhook signature verification secret
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string (for BullMQ)
- `DOCALIGN_API_SECRET` — Secret for signing API tokens issued to clients
```

Client-side secrets (in GitHub repo Secrets, used by the Action):
```
- `DOCALIGN_TOKEN` — API token for communicating with DocAlign server
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — Client's LLM API key (never sent to DocAlign)
```

### 5h. infrastructure-deployment.md — Processing Architecture (lines 66-80)

**PRD says:** Job types: Index update, Claim extraction, Claim mapping, Verification, PR comment, Full scan, Drift report. Concurrency: 5 jobs. Timeout: 10 minutes per job.

**Spike concluded:** Processing splits into server-side orchestration and client-side Action execution.

**Proposed update:** Rewrite job types:
```
**Server-side jobs** (deterministic, with timeout):
- Index update (tree-sitter), Claim mapping (Steps 1-3 lookups), Deterministic verification (Tiers 1-2), Static rule evaluation, PR comment formatting, Count-based exclusion tracking

**Client-side jobs** (run in GitHub Action, triggered via repository dispatch):
- ALL LLM tasks: Claim extraction, Path 1 verification (direct LLM), Path 2 verification (agent), Embedding generation, Fix generation, Feedback interpretation (v2)

**Timeout policy:** Server-side jobs: 10 minutes. Client-side tasks: no hard timeout imposed by DocAlign (user aborts agent if stuck). DocAlign marks tasks as expired after `expires_at` deadline (configurable, default 30 minutes).

**Concurrency:** Server-side: 5 jobs. Client-side: configurable via `.docalign.yml` `agent.concurrency` (default 5, max 20).
```

### 5i. PRD.md — Data Models Section 12.1-12.2 (lines 300-336)

**PRD says:** No `agent_tasks` table, no `static_analysis_rules` table, no `suppression_rules` table.

**Spike concluded:** Need new tables for agent task queue, static analysis rules, and suppression rules.

**Proposed update:** Add to schema overview:
```
repos
  +-- code_entities (Layer 0)
  +-- claims (Layer 1)
  |     +-- claim_mappings (Layer 2)
  |     +-- verification_results (Layer 3)
  |     +-- feedback (Layer 7)
  |     +-- suppression_rules (Layer 7, Spike C)
  +-- static_analysis_rules (Spike A, v2)
  +-- co_changes (Layer 7)
  +-- agent_drift_reports (Layer 6)
  +-- agent_tasks (ADR)
  +-- scan_runs (Layer 4)
```

Add entity descriptions:
- **agent_tasks:** Pending, in-progress, completed, or expired tasks for the client's agent. Stores task type, payload, result, metadata (duration, cost, model used), status, and timestamps. See ADR Section 4.
- **suppression_rules:** Learning-system-generated rules that suppress specific findings. Stores scope (claim, claim_type, file, extraction), origin (quick_pick, agent, count_based, developer_explicit), expiration, spot-check tracking, revocation signals. See Spike C.
- **static_analysis_rules (v2):** See Change 2d.

---

## Change 6: Cost Model Overhaul

**Source:** ADR
**Affects:** cost-model.md

### 6a. cost-model.md — Full rewrite needed

**PRD says:** Cost model assumes DocAlign pays all LLM costs server-side. Per-PR estimate: ~$0.08. Monthly estimate: $1-120/repo.

**Spike concluded:** All compute is client-side. DocAlign has ZERO variable LLM costs.

**Proposed update:** Rewrite entire cost model:
```
### 14.1 DocAlign Server Costs (Fixed — All Tiers)

DocAlign's server makes zero LLM calls. Costs are fixed infrastructure regardless of user count.

| Component | Monthly Cost |
|-----------|-------------|
| Railway hosting (API + worker) | $20-50 |
| Supabase PostgreSQL | $25 |
| Redis (BullMQ) | $10 |
| **Total fixed** | **$55-85/month** |

DocAlign's marginal cost per additional user/repo is effectively $0 (database storage only).

### 14.2 Client Costs (Client Pays via Their API Key)

All LLM costs are borne by the client. Costs vary by repo activity and model choice.

| Operation | Typical Cost | Volume per PR |
|-----------|-------------|---------------|
| Claim extraction (semantic) | ~$0.01-0.05 per doc file | 0-2 files |
| Embedding generation | ~$0.0001 per entity | 5-20 entities |
| Path 1 verification (direct LLM) | ~$0.003-0.012 per claim | 12-14 claims (60-70%) |
| Path 2 verification (agent) | ~$0.02-0.20 per claim | 6-8 claims (30-40%) |
| Fix generation | ~$0.01-0.05 per finding | 1-5 findings |
| **Total per PR** | **~$0.15-1.50** | depends on claims affected |

| Repo Activity Level | PRs/month | Client Cost/month |
|---------------------|-----------|------------------|
| Low (solo dev) | 20 | ~$3-10 |
| Medium (small team) | 100 | ~$15-50 |
| High (active team) | 300 | ~$45-150 |

### 14.3 Pricing Tiers

| Tier | DocAlign cost | Client cost | Price |
|------|-------------|-------------|-------|
| **Free** | $0 marginal | ~$5-30/month (their API key) | $0 |
| **Pro** | $0 marginal | Same | TBD (feature-based) |

Pro pricing is for features (dashboard, scheduling, analytics, notifications, SSO), not compute. Both tiers use identical execution model.
```

---

## Change 7: L1 Claim Extractor — Agent-Delegated Extraction

**Source:** ADR
**Affects:** L1-claim-extractor.md

### 7a. L1-claim-extractor.md — Semantic extraction (line ~52)

**PRD says:** "After syntactic extraction, send remaining prose sections to an LLM. Use structured output (JSON mode)."

**Spike concluded:** All LLM work is client-side. Semantic extraction runs in the GitHub Action.

**Proposed update:** Add note:
```
**Execution model (ADR):** Syntactic claim extraction runs server-side (deterministic, no LLM). Semantic claim extraction runs in the client's GitHub Action as a `claim_extraction` task. The Action uses the client's LLM API key to read doc files, explore the codebase for context, and return structured claims. DocAlign server never sees the doc file content during extraction — only the resulting claim records. See ADR Section 4 for the task interface.
```

### 7b. L1-claim-extractor.md — Performance requirements (lines 86-88)

**PRD says:** "LLM-based extraction of a single doc section: <3 seconds, ~$0.0006 per file"

**Spike concluded:** This cost is borne by the client, not DocAlign.

**Proposed update:** Update to: "LLM-based extraction: runs client-side in the GitHub Action. Cost borne by client (~$0.01-0.05 per doc file depending on model). DocAlign's cost for syntactic extraction: $0."

---

## Change 8: Layer 4 — Agent Triggering

**Source:** ADR
**Affects:** L4-change-scanning.md

### 8a. L4-change-scanning.md — Data flow (lines 11-24)

**PRD says:** Linear flow: webhook → extract changed files → update index → extract claims → map → verify → post comment.

**Spike concluded:** After server-side steps complete, agent tasks are created and triggered via repository dispatch. Agent results flow back through API.

**Proposed update:** Expand step 5 (re-extract claims) and step 8 (verify):
```
5. Create agent task for claim re-extraction (if docs changed). Trigger agent via repository dispatch.
...
8. Merge, deduplicate. Route claims: Path 1 (server-side on paid, agent on free) or Path 2 (always agent). Create agent tasks for Path 2 claims. Trigger agent.
```

### 8b. L4-change-scanning.md — Scope Controls (lines 51-55)

**PRD says:** "Max LLM calls per PR: 50 (to control cost)"

**Spike concluded:** All LLM costs are client-side. Max claims per PR still useful for Action runtime.

**Proposed update:** Replace "Max LLM calls per PR: 50" with: "Max claims per PR: 50 (default, configurable via `.docalign.yml`). Max agent tasks (Path 2) per PR: 20 (default, configurable via `agent.max_claims_per_pr`). All LLM costs are borne by client."

---

## Change 9: MVP Scope Updates

**Source:** ADR, all spikes
**Affects:** PRD.md Section 15

### 9a. PRD.md — MVP Section 15.1 "In scope" (lines 370-393)

**PRD says:** Lists specific components with no mention of agent-first model.

**Proposed update:** Add to "In scope":
```
- All-client-side execution model: Agent Task API, repository dispatch triggering, `docalign/agent-action` GitHub Action
- Two-path evidence assembly: Path 1 (direct LLM in Action) + Path 2 (agent-delegated)
- Agent adapter: Claude Code + custom-command
- Two tiers: Free and Pro (same execution model, Pro adds features)
- Onboarding requires Action setup before full scan
- Learning system MVP: quick-pick fast-path + count-based permanent exclusion (after 2 silent dismissals)
```

Update existing items:
- Change "Layer 1: LLM-based semantic claim extraction (GPT-4o-mini, one prompt)" to "Layer 1: Semantic claim extraction runs in client's GitHub Action"
- Change "Layer 3: For MVP, all semantic claims bypass triage (Tier 3) and go directly to Tier 4 (Claude Sonnet semantic verification)" to "Layer 3: Tier 3 removed. Semantic verification via two paths: Path 1 (entity extraction + direct LLM call in Action) and Path 2 (agent-delegated for complex claims). All runs client-side."
- Change "Layer 5: Hybrid PR output" — add: "Feedback collection includes explanation prompt (quick-picks) after thumbs-down"
- Change "Layer 7: learning system (feedback UI is shipped in MVP via review comment reactions; recording is MVP, learning/suppression is v2)" to "Layer 7: feedback recording + quick-pick fast-path + count-based permanent exclusion in MVP. Agent-interpreted free-text and safety valves in v2."

### 9b. PRD.md — v2 Scope Section 15.2 (lines 406-416)

**Proposed update:** Remove "Triage gate (Tier 3)" line. Add:
- "Step 4 mapping: static analysis rules + claim decomposition (Spike A)"
- "Learning system v2: agent-interpreted free-text, safety valves (spot-checks, expiration, revocation), rule management UI"

### 9c. PRD.md — v3 Scope Section 15.3 (lines 418-430)

**Proposed update:** Remove "Learning system (feedback-based suppression rules)" (moved to v2). Keep "Co-change pattern tracking."

---

## Founder Decisions (Recorded)

**Q1:** Count-based + quick-pick fast-path are MVP. Count-based = **permanent exclusion** (not 180-day suppression). Claim re-enters checking only if claim text changes.

**Q2:** Option (a) — require Action setup before App does anything useful. No partial onboarding.

**Q3:** Two tiers (Free / Pro). ALL compute client-side for both tiers. Pro = features only (dashboard, scheduling, analytics, notifications, SSO, support). Prices TBD in GTM.

---

## Appendix: Files to Modify

| File | Changes |
|------|---------|
| `PRD.md` | Changes 1a-e, 2d-e, 3d, 4f, 5a-e, 5i, 9a-c |
| `prd/L1-claim-extractor.md` | Changes 7a-b |
| `prd/L2-code-claim-mapper.md` | Changes 2a-c |
| `prd/L3-verification-engine.md` | Changes 1f-g, 3a-c |
| `prd/L4-change-scanning.md` | Changes 8a-b |
| `prd/L5-report-fix.md` | Changes 4d-e |
| `prd/L7-learning-system.md` | Changes 4a-c |
| `prd/infrastructure-deployment.md` | Changes 5f-h |
| `prd/cost-model.md` | Changes 1h-i, 6a |
| `phases/adr-agent-first-architecture.md` | Already updated: Sections 3, 5, 7, 10 |
| `phases/spike-c-learning-generalization.md` | Already updated: Section 5.3 (permanent exclusion) |
