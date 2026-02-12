# DocAlign: Development Workflow

> This document defines the step-by-step workflow for producing all artifacts needed to build DocAlign. Each phase has defined inputs, outputs, roles, review gates, and escalation rules.
> **This product will be built entirely by AI agents.** Every artifact must be precise enough that an agent can implement from it without human interpretation. Vague specs = wrong code.

---

## Principles

1. **No silent assumptions.** Every agent must escalate decisions that require founder judgment. If unsure, ask — don't guess.
2. **Review after every phase.** No phase's output feeds into the next until reviewed and approved.
3. **Solve unknowns before specifying.** Unsolved design problems get research spikes, not handwaved TRD sections.
4. **Clarifying questions are expected.** Agents should surface ambiguity early, not bury it in footnotes.
5. **Show, don't describe.** Every spec must include concrete input→output examples. "Extract claims from markdown" is not a spec. "Given THIS markdown, produce THESE claims" is a spec.
6. **Specify failure, not just success.** Every component must define what happens when things go wrong: bad LLM output, missing files, rate limits, timeouts, empty results.
7. **Negative examples matter.** Define what the system should NOT do. Agents need boundaries, not just goals.
8. **PRD is a standing input.** The PRD is the ultimate authority on WHAT to build. Every agent in every phase should read the relevant PRD sections before beginning work. Downstream documents define HOW.
9. **Technology knowledge is not assumed.** When a spec references a specific technology (tree-sitter, BullMQ, pgvector), include a "Required Framework Knowledge" section or reference official documentation. Do not assume the implementing agent knows the API.

---

## Artifact Templates

### Review Finding Format

Every review output (Phase 1, review gates, amendment escalations) must use this structure:

```
### Finding [N]: [One-line title]
- **Quote:** [exact text from reviewed document]
- **Category:** MISSING | AMBIGUOUS | UNTESTABLE | INCONSISTENT | EDGE_CASE
- **Severity:** BLOCKING | IMPORTANT | MINOR
- **Recommendation:** [concrete proposed fix or question for user]
```

### Spike Document Structure

Every spike document in Phase 2 must follow this structure:

```
# Spike [A/B/C]: [Title]
## 1. Problem Statement
## 2. Prior Art Survey
### 2.1 [Approach name] — summary, relevance, limitations
## 3. Options Analysis
### 3.1 Option: [Name] — Pros, Cons, Complexity (days), Cost ($/invocation)
## 4. Recommendation (with rationale)
## 5. Detailed Specification
### 5.1 Algorithm / Pseudocode
### 5.2 Data Structures (TypeScript interfaces)
### 5.3 Flow Diagram (text-based)
## 6. Worked Example
### 6.1 Input (real data, not placeholder)
### 6.2 Processing Steps
### 6.3 Expected Output
## 7. Adversarial Examples (3 scenarios where this approach fails)
## 8. Risks and Mitigations
## 9. Questions for User
```

### TDD Structure

Every Technical Design Document in Phase 4A must follow this structure:

```
# TDD-[N]: [Component Name]
## 1. Overview (2-3 sentences: purpose, boundaries)
## 2. Dependencies
### 2.1 Consumes from (which layers/functions this calls)
### 2.2 Exposes to (which layers/functions call this)
## 3. TypeScript Interfaces (complete, conforming to api-contracts.md)
## 4. Public API
### 4.N [Function Name]
#### Signature
#### Algorithm (pseudocode for non-trivial logic)
#### Input→Output Example 1
#### Input→Output Example 2
#### Negative Example (what NOT to produce)
#### Edge Cases
#### Error Handling
## 5. Performance Targets
## 6. Required Framework Knowledge (libraries the implementing agent must know)
## 7. Open Questions (⚠️ markers for review)
```

### Epic Structure

Every epic in Phase 6 must follow this structure:

```
## Epic [N]: [Title]
- **Scope:** [2-3 sentences]
- **Components:** [TDD references]
- **Prompts:** [prompt spec references]
- **Depends On:** [epic IDs]
- **Blocks:** [epic IDs]
- **Sizing:** [agent sessions count, critical path duration]
- **MVP Status:** MVP | POST-MVP-v2 | POST-MVP-v3
- **Vertical Slice:** Yes/No (does this produce user-testable value alone?)
```

### Task Structure

Every task in Phase 7 must follow this structure:

```
### Task [EPIC]-[NUM]: [Title]
- **Files:** [exact file paths to create/modify]
- **Implements:** [TDD section reference]
- **Types used:** [TypeScript interfaces from api-contracts.md]
- **Tests:** [integration example IDs this must pass]
- **Done when:** [agent-verifiable criteria]
- **Estimated effort:** [hours]
```

---

## Artifact Chain

```
PRODUCT-VISION.md (done)
    │
    ▼
PRD.md (done, needs hardening)
    │
    ├──► Phase 1: PRD Hardening
    │         ▼ ← User review gate
    │
    ├──► Phase 2: Research Spikes (solve unsolved problems)
    │    ├── Spike A runs first
    │    └── Spikes B + C in parallel after A completes
    │         ▼ ← User review gate (choose solution directions)
    │
    ├──► Phase 2.5: PRD Reconciliation
    │         ▼ ← User review gate (approve PRD changes)
    │
    ├──► Phase 3: Architecture Design Document (ADD)
    │    ├── 3A: System Architecture (sequential — completes first)
    │    │    ▼ ← 3A review
    │    ├── 3B: Integration Specs ─────────┐
    │    ├── 3C: Error Handling & Recovery ──┤ (parallel after 3A)
    │    ├── 3D: Infrastructure & DevOps ───┤
    │    └── 3E: Security Threat Model ─────┘
    │         ▼ ← User review gate
    │
    ├──► Phase 4: Detailed Specifications
    │    ├── API Contracts file (prerequisite, completes first)
    │    ├── Track A: TDDs (wave-based, see below)
    │    │    ▼ ← Gate 4.1
    │    ├── Track B: Prompt Specs ──────┐
    │    ├── Track C: UX Specs ──────────┤ (parallel after Gate 4.1)
    │    └── Track D: Config Spec ───────┘
    │         ▼ ← Gate 4.2
    │
    ├──► Phase 5: Integration Examples & Test Strategy
    │    ├── 5A: Integration Golden Examples (completes first)
    │    │    ▼
    │    └── 5B: Test Strategy (uses 5A examples as input)
    │         ▼ ← User review gate
    │
    ├──► Phase 6: Epic Definition
    │         ▼ ← User review gate
    │
    └──► Phase 7: Story & Task Breakdown
              ▼ ← User review gate
              │
         Implementation begins
```

---

## Complete Artifact List

### Existing (from Discovery)

| File | Purpose | Status |
|------|---------|--------|
| `PRODUCT-VISION.md` | Product vision, strategy, differentiation | Done |
| `PRD.md` | Product requirements with technical detail | Done, needs hardening |
| `context/signals.md` | 22 validated market pain signals | Done |
| `context/wtp.md` | Willingness-to-pay and pricing research | Done |
| `context/founder.md` | Founder constraints | Done |
| `context/harness.md` | Agent autonomy harness architecture | Done |
| `context/landscape.md` | Competitive landscape | Done |
| `context/research/feature-landscape.md` | 12-capability map across 9 competitors | Done |
| `context/research/living-docs-landscape.md` | Living documentation tools landscape | Done |
| `phases/technical-reference.md` | Technical implementation details extracted from PRD (interfaces, schemas, prompts) | Done |

### To Be Created (by phase)

| File | Purpose | Created In |
|------|---------|-----------|
| `phases/phase1-prd-review.md` | PRD review findings, questions, proposed changes | Phase 1 |
| `phases/spike-a-vague-claim-mapping.md` | Solved: how to map architecture-level claims to code | Phase 2 |
| `phases/spike-b-evidence-assembly.md` | Solved: how much code evidence per claim, truncation | Phase 2 |
| `phases/spike-c-learning-generalization.md` | Solved: how developer feedback generalizes to suppression | Phase 2 |
| `phases/phase3-architecture.md` | Architecture Design Document (system-level) | Phase 3A |
| `phases/phase3-integration-specs.md` | GitHub API, LLM APIs, MCP protocol integration details | Phase 3B |
| `phases/phase3-error-handling.md` | Error taxonomy, recovery strategies, user-facing messages | Phase 3C |
| `phases/phase3-infrastructure.md` | Deployment, CI/CD, monitoring, observability, local dev environment | Phase 3D |
| `phases/phase3-security.md` | Security threat model: webhook verification, prompt injection, sandboxing, secrets, rate limiting, OWASP pass, GitHub App permissions | Phase 3E |
| `phases/phase4-api-contracts.md` | Canonical cross-layer TypeScript interfaces and function signatures. Single source of truth for how layers communicate. | Phase 4 (prerequisite) |
| `phases/phase4-decisions.md` | Phase 4 cross-TDD design decisions log | Phase 4 |
| `phases/tdd-0-codebase-index.md` | TDD: Layer 0 Codebase Index | Phase 4A (Wave 1) |
| `phases/tdd-1-claim-extractor.md` | TDD: Layer 1 Claim Extractor | Phase 4A (Wave 2) |
| `phases/tdd-2-mapper.md` | TDD: Layer 2 Code-to-Claim Mapper | Phase 4A (Wave 3) |
| `phases/tdd-3-verifier/` | TDD: Layer 3 Verification Engine (multi-document) | Phase 4A (Wave 4) |
| `phases/tdd-4-triggers.md` | TDD: Layer 4 Change Triggers | Phase 4A (Wave 2) |
| `phases/tdd-5-reporter.md` | TDD: Layer 5 Report & Fix Generation | Phase 4A (Wave 5) |
| `phases/tdd-6-mcp.md` | TDD: Layer 6 MCP Server | Phase 4A (Wave 5) |
| `phases/tdd-7-learning.md` | TDD: Layer 7 Learning System | Phase 4A (Wave 5) |
| `phases/tdd-infra.md` | TDD: GitHub App, API server, database, deployment | Phase 4A (Wave 5) |
| `phases/phase4b-prompt-specs.md` | All LLM prompts: exact text, model, params, examples, failure handling | Phase 4B |
| `phases/phase4c-ux-specs.md` | All user-facing output: PR comments, CLI, error messages, onboarding | Phase 4C |
| `phases/phase4d-config-spec.md` | .docalign.yml full schema, defaults, validation, error messages | Phase 4D |
| `phases/phase5-integration-examples.md` | End-to-end integration golden examples spanning the full pipeline | Phase 5A |
| `phases/phase5-test-strategy.md` | Test strategy, benchmarks, acceptance criteria | Phase 5B |
| `phases/phase6-epics.md` | Epic definitions with dependency graph | Phase 6 |
| `phases/phase7-stories.md` | Story breakdown with acceptance criteria | Phase 7 |
| `phases/phase7-tasks.md` | Task breakdown with done criteria | Phase 7 |
| `phases/amendments-log.md` | Tracked post-approval changes to earlier artifacts | Ongoing |

---

## Phase 1: PRD Hardening

**Goal:** Produce a structured review identifying: (a) every acceptance criterion that is missing or untestable, (b) every component described in prose that lacks input→output definition, (c) every term used inconsistently. Resolve all BLOCKING findings before moving on.

**Input:** `PRD.md`

**Agents:**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Product Manager | Reviewer | Produce a numbered finding list using the Review Finding Format. Each finding: exact PRD quote, category (MISSING\|AMBIGUOUS\|UNTESTABLE\|INCONSISTENT\|EDGE_CASE\|UX_GAP), severity (BLOCKING\|IMPORTANT\|MINOR), proposed fix or question for user. Trace the complete user journey from installation through first PR comment. For each step, verify: input is defined, output is defined, transition to next step is specified, failure is handled. List every place where an agent might interpret the spec two different ways. |
| Technical Feasibility Reviewer | Reviewer | For each technical claim in the PRD: state FEASIBLE / COMPLEX (explain hidden difficulty) / INFEASIBLE (explain why, propose alternative). For each cost estimate: state the estimate, identify key assumptions, compute independent estimate using current API pricing, flag if off by >2x. Identify any component described in prose that lacks concrete input→output definition. Produce findings using Review Finding Format. |

**Output:** `phases/phase1-prd-review.md` — consolidated findings using Review Finding Format, questions, and proposed changes.

**Review gate:** User reviews findings, answers questions, approves changes. Updated PRD.md committed.

**Done when:**
- All BLOCKING findings are resolved or explicitly deferred by user.
- Updated PRD has no ⚠️ markers remaining in MVP sections.
- User has approved the updated PRD.

**Escalation triggers (ask user):**
- Product scope decisions (what's in/out of MVP)
- Accuracy threshold decisions (what false positive rate is acceptable)
- Pricing model decisions
- Any assumption that could change the product direction

---

## Phase 2: Research & Design Spikes

**Goal:** Solve the 3 unsolved technical problems before architecture work begins. Each spike produces a single recommended solution with a worked example using real data — not another "options" document.

**Input:** PRD.md placeholder sections (marked with ⚠️)

**Execution order: Spike A runs first. Spikes B and C run in parallel after Spike A completes.** Spike A's output (how vague claims decompose into sub-claims) directly affects Spike B's problem statement (evidence assembly becomes per-sub-claim).

**Spikes:**

| Spike | Problem | Depends On | Output File |
|-------|---------|-----------|-------------|
| A | Layer 2 Step 4: How to map vague architecture claims ("event-driven", "microservices") to code evidence | — | `phases/spike-a-vague-claim-mapping.md` |
| B | Layer 3: Evidence assembly — how much code per claim, truncation strategy, multi-file claims | Spike A | `phases/spike-b-evidence-assembly.md` |
| C | Layer 7: Learning generalization — how to translate developer feedback into suppression rules without over-suppressing | — | `phases/spike-c-learning-generalization.md` |

**Agents per spike:**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Research Engineer | Researcher | Explore prior art, find analogous solutions in other domains, identify viable approaches. Search for academic papers, open-source implementations, blog posts describing similar solutions. Produce the "Prior Art Survey" section of the spike document. |
| Technical Architect | Designer | Evaluate options, design the recommended solution, specify it concretely (algorithm, data structures, pseudocode). Produce the full spike document following the Spike Document Structure template. Include at least 3 adversarial examples where the approach fails and how to mitigate. Identify remaining risks. |

**Output per spike:** A complete spike document following the Spike Document Structure template (see Artifact Templates section).

**Review gate:** User reviews recommended solutions for all 3 spikes. Makes directional decisions. Solutions accepted or sent back for iteration.

**Done when:**
- Each spike has a single recommended solution (not an options list).
- Each spike includes a worked example with real data (not placeholder data).
- Each spike includes at least 3 adversarial examples.
- User has chosen a direction for each spike.

**Escalation triggers (ask user):**
- Tradeoff between accuracy and cost (e.g., "we can get 90% accuracy but it costs 5x more")
- Tradeoff between coverage and complexity (e.g., "we can handle architecture claims but it adds 2 weeks")
- Whether to skip a capability in MVP entirely

---

## Phase 2.5: PRD Reconciliation

**Goal:** Update the PRD if spike solutions changed product scope, cost estimates, or capability boundaries. This is a lightweight diff, not a rewrite.

**Input:** Approved spike solutions + current PRD.md

**Agent:**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Product Manager | Lead author | Compare each spike's recommended solution against the corresponding PRD section. For each discrepancy: identify the PRD section, state what the PRD says, state what the spike concluded, propose PRD update text. Produce a PRD change list. Apply approved changes to PRD.md with a changelog entry at the top of the file. |

**Output:** Updated `PRD.md` (changes tracked in changelog at top of PRD).

**Review gate:** User approves PRD changes before Phase 3 begins.

**Done when:**
- Every spike recommendation that changes scope, cost, or capability is reflected in the PRD.
- Changelog at top of PRD lists every change with date and rationale.
- User has approved the updated PRD.

---

## Phase 3: Architecture Design Document (ADD)

**Goal:** Define the system architecture at component level. All major technical decisions documented with rationale. Integration points fully specified. Error handling designed system-wide. Security threat model established.

**Input:** Hardened PRD (post-reconciliation) + Solved spikes

**Execution order: Phase 3A completes first and is reviewed. Then 3B, 3C, 3D, and 3E run in parallel.** 3B/3C/3D/3E all depend on architecture decisions made in 3A.

### Phase 3A: System Architecture

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Technical Architect | Lead author | System component diagram with boundaries and interactions. Key ADRs (Architectural Decision Records) — each decision includes: decision, alternatives considered, rationale, consequences. Technology choices with rationale. Data architecture (schema decisions, storage strategy, migration approach). Concurrency model. Security model (auth, data privacy, secret handling). Scalability path. **State machine diagrams for core entity lifecycles:** claim lifecycle (pending→verified/drifted/uncertain, transitions and triggers), scan lifecycle (queued→running→completed/failed), repo installation lifecycle (installed→active→suspended→uninstalled). |
| Product Manager | Reviewer | Cross-reference architecture against every MVP user story. Produce a coverage matrix: user story → component(s). Flag orphaned stories (user stories not served by any component). For each component: is this required for MVP? If not, mark POST-MVP. If yes, does the design include abstractions beyond MVP needs? Propose simpler alternative. |

**Output:** `phases/phase3-architecture.md`

**3A Review gate:** Technical Architect and Product Manager reviews complete. User approves architecture decisions before 3B/3C/3D/3E begin.

### Phase 3B-E Coordination Protocol

Phases 3B, 3C, 3D, and 3E run in parallel after 3A is approved. To prevent conflicts:

1. **Shared decisions log:** All four agents share `phases/phase3-decisions.md`. Before making a design choice that could affect another sub-phase (e.g., error handling strategy in 3C that affects integration retry logic in 3B), write the decision to the log first.
2. **Cross-reference on completion:** Each agent must read the other three outputs before declaring done. Flag any cross-sub-phase inconsistency in a "## Cross-References" section at the end of their document.
3. **Conflict resolution:** If two sub-phases make contradictory decisions, the Technical Architect resolves the conflict. Both documents are updated before the review gate.
4. **Shared types:** If any sub-phase defines a type or interface that another sub-phase also needs, it must be proposed to the decisions log and all other sub-phase agents notified.

### Phase 3B: Integration Specifications

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Technical Architect | Lead author | **GitHub API integration:** OAuth App vs GitHub App decision. Webhook events and exact payload handling. REST/GraphQL endpoints used with request/response examples. Rate limit strategy (5,000 req/hr). Auth token management. Webhook signature verification. Installation lifecycle (install, uninstall, suspend). **LLM API integration:** Per-provider spec (OpenAI, Anthropic). Model IDs, parameters (temperature, max_tokens, top_p). Structured output format. Retry/backoff strategy. Rate limit handling. Fallback models if primary unavailable. Cost tracking per call. **MCP Protocol:** Transport (stdio vs HTTP). Tool registration. Request/response schemas. Error responses. |

**Output:** `phases/phase3-integration-specs.md`

### Phase 3C: Error Handling & Recovery

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Technical Architect | Lead author | **Error taxonomy:** Every error that can occur, categorized by source (GitHub API, LLM API, database, internal logic, user config). **Per error:** cause, detection, recovery action, user-facing message (if any), retry policy, logging. **Specific scenarios:** LLM returns unparseable output. LLM returns plausible but wrong structured output. GitHub webhook delivered but processing fails (idempotency). Claim extraction finds zero claims in a doc file. Mapping finds no evidence for a claim. Verification hits token limit mid-analysis. PR comment too long for GitHub (65535 char limit). Rate limit hit mid-batch. Database connection lost during scan. Concurrent webhooks for same PR. |

**Output:** `phases/phase3-error-handling.md`

### Phase 3D: Infrastructure & DevOps

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| DevOps Architect | Lead author | Infrastructure topology diagram. Deployment strategy (staging/production). CI/CD pipeline design (GitHub Actions or equivalent). Local development environment setup (step-by-step commands an agent can execute). Secret management (env vars, vault). Database migration strategy. Backup strategy. Domain/DNS setup. SSL/TLS. **Observability specification:** structured log format (JSON), required fields per log event (timestamp, level, component, requestId, duration, error), log levels per component, cost tracking event schema (for per-repo token usage), metrics to expose (scan duration, claims per PR, LLM cost per tier, verification accuracy), alerting rules (scan timeout >30s, cost spike >3x baseline, error rate >5% over 5min window). |
| Technical Architect | Reviewer | Verify infrastructure supports architecture. No missing pieces. |

**Output:** `phases/phase3-infrastructure.md`

### Phase 3E: Security Threat Model

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Technical Architect | Lead author | **Webhook signature verification:** HMAC-SHA256 verification of GitHub webhook payloads — algorithm, header names, timing-safe comparison. **Prompt injection mitigation:** Documentation files may contain adversarial text designed to manipulate LLM outputs — detection strategies, input sanitization, output validation. **Shell command sandboxing:** Tier 5 post-check commands run shell commands to verify findings — sandboxing approach (allowlisted commands, timeout, no network access, read-only filesystem). **Token/secret management:** How API keys, GitHub tokens, and LLM API keys are stored, rotated, and accessed at runtime. **Rate limiting per MCP client:** Per-client request limits for the MCP server to prevent abuse. **Brief OWASP Top 10 pass:** For each applicable OWASP category, state whether it applies to DocAlign and if so, the mitigation. **GitHub App permission minimization:** List every permission requested and justify its necessity. Flag any permission that could be reduced. |

**Output:** `phases/phase3-security.md`

**Review gate (all 5 docs):** User reviews architecture. Key decisions (tech stack, hosting, data storage, LLM provider strategy, security model) confirmed.

**Done when:**
- All ADRs are written with decision, alternatives, rationale, and consequences.
- Integration specs include request/response examples for every external API call.
- Error taxonomy covers every external API and every internal failure mode.
- Infrastructure spec includes local dev setup commands an agent can execute.
- Security threat model covers all items listed in 3E responsibilities.
- State machine diagrams exist for claim, scan, and repo installation lifecycles.
- User has approved all architecture decisions.

**Escalation triggers (ask user):**
- Technology choices with significant cost/vendor implications
- Security decisions (what data we store, how auth works)
- Deployment model decisions (serverless vs always-on, managed vs self-hosted)
- Any decision that affects pricing or cost structure

---

## Phase 4: Detailed Specifications

**Goal:** Produce specs detailed enough that an AI agent can implement each component without architectural questions, interpretation, or guessing.

**Input:** Approved ADD (all 5 documents) + Hardened PRD

### Phase 4 Prerequisite: API Contracts

Before any TDDs begin, a Technical Architect produces `phases/phase4-api-contracts.md` — a single file defining every cross-layer TypeScript interface and function signature. This is the canonical type registry and the single source of truth for how layers communicate. Every TDD must conform to the types defined here.

**Output:** `phases/phase4-api-contracts.md`

### Phase 4 Coordination Protocol

- Before parallel work begins, the API contracts file is frozen.
- Parallel agents within a phase share a decisions log: `phases/phase4-decisions.md`. Before making a design choice that affects other documents, write it to the log.
- If a reviewer finds cross-TDD inconsistency, both TDD authors are notified and must align before either TDD is approved.
- The Technical Architect has final decision authority on cross-TDD conflicts.

### Track A: Technical Design Documents (Wave-Based Execution)

TDDs are written in waves. Each wave's output becomes input for the next wave. This replaces parallel execution of all 9 TDDs.

| Wave | TDDs | Rationale |
|------|------|-----------|
| Wave 1 | TDD-0 (Codebase Index) | Foundational — no dependencies |
| Wave 2 | TDD-1 (Claim Extractor) + TDD-4 (Triggers) | Depend on TDD-0's index structure |
| Wave 3 | TDD-2 (Mapper) | Depends on TDD-0 + TDD-1 (needs index + claim types) |
| Wave 4 | TDD-3 (Verifier) | Depends on TDD-2 (needs mapping output) |
| Wave 5 | TDD-5 (Reporter) + TDD-6 (MCP) + TDD-7 (Learning) + TDD-Infra | Depend on TDD-3 (need verification results type) |

**TDD List:**

| TDD | Scope | Wave | Output File |
|-----|-------|------|-------------|
| TDD-0 | **Codebase Index (Layer 0):** AST parsing via tree-sitter, file tree indexing, package metadata parsing, embedding generation, symbol/route/dependency lookup APIs, incremental update from git diff | 1 | `phases/tdd-0-codebase-index.md` |
| TDD-1 | **Claim Extractor (Layer 1):** Doc file discovery, syntactic extraction (regex patterns for paths, commands, versions, routes, code blocks), LLM-based semantic extraction, claim deduplication, refresh policy, claim types taxonomy | 2 | `phases/tdd-1-claim-extractor.md` |
| TDD-2 | **Code-to-Claim Mapper (Layer 2):** 4-step progressive mapping (direct reference → symbol search → semantic search → LLM-assisted), mapping maintenance on code changes, reverse index (code file → claims) | 3 | `phases/tdd-2-mapper.md` |
| TDD-3 | **Verification Engine (Layer 3):** 5-tier pipeline (syntactic → pattern → triage → semantic → post-check), evidence assembly strategy, LLM-based verification, confidence scoring, severity classification. Multi-document TDD. | 4 | `phases/tdd-3-verifier/` (multi-document) |
| TDD-4 | **Change Triggers (Layer 4):** PR webhook handler, push handler, scheduled scan trigger, CLI trigger, MCP drift report trigger, scope resolution (which claims to verify), debouncing, rate limiting, scope controls | 2 | `phases/tdd-4-triggers.md` |
| TDD-5 | **Report & Fix Generation (Layer 5):** PR comment formatting, GitHub suggestion syntax, fix generation (syntactic + LLM), auto-commit option, health score calculation, feedback collection via reactions | 5 | `phases/tdd-5-reporter.md` |
| TDD-6 | **MCP Server (Layer 6):** 4 MCP tools (get_docs, get_doc_health, report_drift, list_stale_docs), local SQLite mode, remote API proxy mode, tool schemas, request/response handling | 5 | `phases/tdd-6-mcp.md` |
| TDD-7 | **Learning System (Layer 7):** Developer feedback processing, co-change pattern tracking, agent drift report accuracy, confidence decay, learning generalization (rule-based MVP), suppression rules | 5 | `phases/tdd-7-learning.md` |
| TDD-Infra | **Infrastructure:** GitHub App setup (permissions, webhook events), API server, job queue (BullMQ/Redis), database schema + migrations, file access strategy (API vs shallow clone), deployment (Railway/Fly), CI/CD, observability, local dev environment | 5 | `phases/tdd-infra.md` |

**Each TDD must include:**
- Exact TypeScript interfaces (all types, conforming to `phase4-api-contracts.md`)
- Function signatures with parameter types and return types
- Algorithm description with pseudocode for non-trivial logic
- Error handling for every function (what can fail, what to do — using error codes from Phase 3C taxonomy)
- Dependencies on other layers (exact function calls across boundaries)
- Performance targets (latency, throughput, resource limits)
- **At least 2 concrete input→output examples per major function**
- **Negative examples: what this component should NOT do**
- **Edge cases with expected behavior**
- **Required Framework Knowledge section** listing libraries, their documentation URLs, and the specific APIs the implementing agent will need

**Each TDD must follow the TDD Structure template** (see Artifact Templates section).

**Document size constraint:** Each TDD document must stay under 1500 lines. For complex layers (Layer 3 Verifier is the most likely candidate), break the TDD into sub-documents:
- `tdd-3-verifier/types.md` — all TypeScript interfaces (written FIRST)
- `tdd-3-verifier/tier1-syntactic.md` — syntactic verification
- `tdd-3-verifier/tier2-pattern.md` — pattern verification
- `tdd-3-verifier/tier3-triage.md` — triage gate
- `tdd-3-verifier/tier4-semantic.md` — semantic verification
- `tdd-3-verifier/tier5-postcheck.md` — post-check
- `tdd-3-verifier/error-handling.md` — error catalog

The types file is written first and becomes shared input for all sub-documents.

**Agents:**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Component Engineers (per TDD, per wave) | Authors | Write each TDD following the TDD Structure template. Every function must have ≥2 input→output examples. Flag any remaining ambiguity from the ADD with ⚠️ markers. |
| Technical Architect | Reviewer | Verify: (a) every cross-layer function call is defined in both TDDs with matching signatures, (b) shared types match the `phase4-api-contracts.md` file exactly, (c) error codes from Phase 3C taxonomy are used consistently. Produce a cross-reference report documenting all cross-TDD calls and type conformance. |
| QA Lead | Reviewer | For each component: "how do we verify this works?" Flag untestable designs. Verify examples can become unit tests. Verify negative examples exist. |

**Output:** 9 TDD documents/directories

**Gate 4.1 (after Track A completes):** Technical Architect produces cross-reference report verifying cross-TDD consistency using the api-contracts file as reference. Founder reviews at least 1 TDD in full (recommend TDD-3, highest-risk) and the cross-reference report. All BLOCKING issues resolved before Tracks B/C/D begin.

---

### Track B: Prompt Specifications

**Starts after Gate 4.1.** Consumes TDD outputs.

**Every LLM interaction in the system, fully specified.**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Prompt Engineer | Lead author | For each prompt in the system: exact system prompt text, exact user prompt template with placeholders, output format specification (JSON schema matching TDD types), model and parameters (temperature, max_tokens, top_p), 3+ input→output examples (including at least 1 edge case), known failure modes and fallback behavior, token budget estimate, cost per invocation. |
| Technical Architect | Reviewer | Verify prompts align with TDD requirements. Verify output schemas are parseable by downstream code and match types in api-contracts.md. |

**Prompts to specify:**

| Prompt ID | Purpose | Used In |
|-----------|---------|---------|
| P-EXTRACT | Semantic claim extraction from doc sections | Layer 1 |
| P-TRIAGE | Cheap triage: is this claim obviously accurate/drifted/uncertain? | Layer 3 |
| P-VERIFY | Deep semantic verification of claim vs code evidence | Layer 3 |
| P-FIX | Generate corrected text for a drifted claim | Layer 5 |
| P-POSTCHECK | Generate verification shell command to confirm a finding | Layer 3 |
| P-MAP-LLM | LLM-assisted claim-to-code mapping (if spike A recommends this) | Layer 2 |
| P-DECOMPOSE | Decompose vague claim into localizable sub-claims (if spike A recommends this) | Layer 2 |
| P-LEARN | Generalize a feedback signal into a suppression rule (if spike C recommends this) | Layer 7 |

**Output:** `phases/phase4b-prompt-specs.md`

### Track C: UX Specifications

**Starts after Gate 4.1.** Consumes TDD outputs.

**Every piece of text or output the user ever sees.**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| UX Specifier | Lead author | **PR comment:** Exact markdown template for every scenario (findings found, no findings, error occurred, scan still running). Maximum comment length handling. Reaction-based feedback UX. GitHub suggestion syntax for auto-fixable claims. **CLI output:** Exact output format for `docalign check`, `docalign scan`, `docalign fix`. Progress indicators. Color/formatting. Exit codes. **Error messages:** Every user-facing error with exact message text. Helpful, actionable, not cryptic. **Onboarding:** First-install experience. What happens when the GitHub App is installed on a repo for the first time (initial scan, first PR comment). **Configuration errors:** What the user sees when `.docalign.yml` has invalid syntax or unknown keys. Every user-facing string is fully specified. |
| Product Manager | Reviewer | Verify tone, clarity, helpfulness. Verify messages match product positioning. Verify every user journey step from Phase 1 review has a corresponding UX spec. |

**Output:** `phases/phase4c-ux-specs.md`

### Track D: Configuration Specification

**Starts after Gate 4.1.** Consumes TDD outputs.

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Technical Architect | Author | `.docalign.yml` full JSON Schema (for validation). Every key: type, default value, valid values, description. Validation rules and error messages for invalid config. Environment variables list with descriptions and defaults. GitHub App required permissions with rationale for each (cross-reference Phase 3E). Precedence rules (env var > config file > defaults). |

**Output:** `phases/phase4d-config-spec.md`

**Gate 4.2 (after Tracks B, C, D complete):** Founder reviews ALL UX specs (these are product decisions). Founder spot-checks prompt specs and config spec. All BLOCKING issues resolved.

**Done when:**
- API contracts file has 100% coverage of cross-layer calls.
- Every TDD function has ≥2 input→output examples.
- Every prompt has ≥3 examples including 1 edge case.
- Every user-facing string is specified in the UX spec.
- Cross-reference report shows zero type mismatches.
- All ⚠️ markers are resolved or escalated.
- User has approved UX specs and spot-checked TDDs and prompts.

**Escalation triggers (ask user):**
- Any design choice that impacts UX (PR comment format, CLI output, error messages)
- Performance vs cost tradeoffs
- Scope questions ("should this edge case be handled in MVP?")
- Prompt design choices that affect accuracy vs cost

---

## Phase 5: Integration Examples & Test Strategy

**Goal:** Create end-to-end integration examples that span multiple layers and make the full pipeline unambiguous. Define how every component gets tested and what "passing" means.

**Input:** TDDs + Prompt Specs + UX Specs + API Contracts

**This phase produces 2 documents:**

### Phase 5A: Integration Golden Examples

Per-layer input→output examples already exist in TDDs (Phase 4A). This phase creates END-TO-END examples that span the full pipeline: from a real repo with real files and a real PR, through every layer, to the final PR comment output.

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| QA Lead | Lead author | Create at least 3 end-to-end integration examples spanning the full pipeline. Each example traces a complete flow: given a repo (file tree, file contents, README/docs), a PR (diff), process through every layer (codebase indexing → claim extraction → mapping → verification → report generation), and produce a final PR comment. **Required examples:** (1) PR with only syntactic drift (version number changed, file renamed). (2) PR with semantic drift (API behavior changed but docs not updated). (3) PR with no drift (clean — docs still accurate after code change). **Each example specifies:** exact input files (real content, not placeholder), expected intermediate outputs at each layer boundary (using types from api-contracts.md), expected final PR comment (exact markdown). |
| Component Engineers | Co-authors | Provide realistic intermediate outputs from their TDD domains. Verify layer boundary outputs are technically correct. |

**Example format (required for each):**
```
## Integration Example IE-[NN]: [Title]

### Scenario
[1-2 sentences describing what this tests]

### Input: Repository State
[Exact file tree and file contents]

### Input: PR Diff
[Exact diff]

### Layer 0 Output: Codebase Index
[Exact JSON matching TDD-0 types]

### Layer 1 Output: Extracted Claims
[Exact JSON matching TDD-1 types]

### Layer 2 Output: Claim Mappings
[Exact JSON matching TDD-2 types]

### Layer 3 Output: Verification Results
[Exact JSON matching TDD-3 types]

### Layer 5 Output: PR Comment
[Exact markdown]

### Anti-example
[What this scenario should NOT produce and why]
```

**Output:** `phases/phase5-integration-examples.md`

### Phase 5B: Test Strategy

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| QA Lead | Lead author | **Per-layer test approach:** Unit test scope and examples. Integration test scope (which layers tested together). **LLM-dependent testing:** Mocking strategy (when to mock vs real calls — specify the exact boundary). Golden test sets (derived from TDD examples + Phase 5A integration examples). Snapshot testing for prompt outputs. How to detect prompt regression (model update breaks output format). **Accuracy benchmarks:** Per-layer accuracy targets. How to measure (precision, recall, F1). Minimum thresholds for MVP launch. How to run benchmarks (which repos, how many claims). **Regression testing:** What triggers regression tests (code change, prompt change, model change). How to detect accuracy regression. **CI integration:** Which tests block merge. Which tests run nightly. Test execution time budget. **Test data:** Which public repos to use as test fixtures. Whether to create synthetic test repos. How to version test data. |
| Technical Architect | Reviewer | Verify test coverage of critical paths. Flag gaps. |

**Output:** `phases/phase5-test-strategy.md`

**Review gate:** User reviews accuracy thresholds and launch criteria (these are product decisions). User reviews integration examples for product correctness.

**Done when:**
- At least 3 end-to-end integration examples covering: PR with only syntactic drift, PR with semantic drift, PR with no drift (clean).
- Each integration example has exact intermediate outputs at every layer boundary.
- Test strategy specifies the mock vs real LLM boundary explicitly.
- Accuracy thresholds are defined for every layer.
- User has approved accuracy thresholds and launch criteria.

**Escalation triggers (ask user):**
- Accuracy thresholds ("is 70% semantic verification accuracy acceptable for launch?")
- Test data decisions ("can we use these public repos for testing?")
- What constitutes "launch-ready" quality
- How much LLM-calling test budget is acceptable

---

## Phase 6: Epic Definition

**Goal:** Break the full build into major work streams with dependencies and build order.

**Input:** All approved docs (PRD, ADD, TDDs, Prompt Specs, UX Specs, Config Spec, Integration Examples, Test Strategy, API Contracts)

**Agents:**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Tech Lead | Lead author | Define 6-10 epics following the Epic Structure template (see Artifact Templates section). Dependency graph between epics (which must complete before which can start). Build order optimized for: earliest possible working vertical slice. Rough sizing (agent sessions per epic, critical path duration). MVP cut line (which epics are MVP, v2, v3). For each epic: list which TDDs, prompt specs, and integration examples apply. Every epic maps to specific TDD sections. |
| Product Manager | Reviewer | Verify prioritization matches product strategy. Confirm MVP scope is minimal but viable. Verify that the first deliverable epic produces user-testable value. |

**Output:** `phases/phase6-epics.md`

**Review gate:** User approves epic structure, build order, and MVP boundary.

**Done when:**
- Every epic maps to specific TDD sections.
- Dependency graph has no cycles.
- MVP boundary is clearly marked (every epic labeled MVP / POST-MVP-v2 / POST-MVP-v3).
- At least one epic is marked as a vertical slice producing user-testable value.
- User has approved epic structure and MVP boundary.

**Escalation triggers (ask user):**
- MVP scope decisions ("can we ship without MCP?", "can we skip learning in v1?")
- Prioritization conflicts between epics
- Whether to build a vertical slice first (one claim type end-to-end) vs horizontal layers

---

## Phase 7: Story & Task Breakdown

**Goal:** Produce an implementable task list. Every task is sized so an AI agent can complete it in a single session and verify its own work.

**Input:** Approved epics + TDDs + Prompt Specs + Integration Examples + Test Strategy + API Contracts

**Agents:**

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| Tech Lead | Lead author (stories) | Break each epic into stories (1-3 day deliverables). Each story has: description, acceptance criteria (testable), definition of done, which TDD section it implements, which integration examples it must pass, dependencies on other stories. |
| Component Engineers (parallel, one per epic) | Authors (tasks) | Break stories into tasks following the Task Structure template (see Artifact Templates section). Each task specifies: exact files to create/modify, function signatures to implement, which TypeScript interfaces from api-contracts.md to use, tests to write (referencing TDD examples and integration examples), done criteria that the implementing agent can self-verify. No task should span more than 2 TDDs. |
| QA Lead | Reviewer | Every story has verifiable acceptance criteria. Test tasks are included (not afterthought). Integration example coverage — every integration example is referenced by at least one task. |

**Output:** `phases/phase7-stories.md` + `phases/phase7-tasks.md`

**Review gate:** Tech Lead confirms completeness and sequencing. User spot-checks for clarity.

**Done when:**
- Every task references a specific TDD section.
- Every task has self-verification criteria an agent can check.
- No task spans more than 2 TDDs.
- Every integration example from Phase 5A is referenced by at least one task.
- Every epic is fully decomposed (no story or task is missing).
- User has spot-checked and approved.

---

## Roles Summary

| Role | Description | Active In |
|------|-------------|-----------|
| **Product Manager** | Product completeness, user perspective, prioritization, scope, UX review | Phases 1, 2.5, 3A, 4C, 6 |
| **Technical Feasibility Reviewer** | Challenge assumptions, flag hidden complexity, find ambiguity | Phase 1 |
| **Research Engineer** | Explore approaches for unsolved problems, find prior art | Phase 2 |
| **Technical Architect** | System design, ADRs, cross-component consistency, integration design, error design, security threat model, API contracts | Phases 2, 3A-E, 4 (contracts + Track A review + B-D), 5B |
| **DevOps Architect** | Infrastructure, CI/CD, deployment, monitoring, observability, local dev | Phase 3D |
| **QA Lead** | Test strategy, testability review, acceptance criteria, integration examples | Phases 4A, 5A-B, 7 |
| **Prompt Engineer** | LLM prompt design, testing, failure handling | Phase 4B |
| **UX Specifier** | User-facing output design, error messages, onboarding | Phase 4C |
| **Tech Lead** | Epic/story/task breakdown, sequencing, sizing, dependency management | Phases 6, 7 |
| **Component Engineers** | Per-layer TDDs, per-epic task breakdown, integration example co-authoring | Phases 4A, 5A, 7 |

---

## Phase Dependencies (What Can Run in Parallel)

```
Phase 1: PRD Hardening                          (sequential — must complete first)
    │
    ▼
Phase 2: Research Spikes                         (Spike A first, then B + C in parallel)
    │
    ▼
Phase 2.5: PRD Reconciliation                   (sequential — lightweight PRD update)
    │
    ▼
Phase 3: Architecture
    ├── 3A: System Architecture                  (sequential — must complete first)
    │    ▼ (review gate)
    ├── 3B: Integration Specs ─────────┐
    ├── 3C: Error Handling ────────────┤         (parallel — after 3A approved)
    ├── 3D: Infrastructure & DevOps ───┤
    └── 3E: Security Threat Model ─────┘
    │
    ▼
Phase 4: Detailed Specs
    ├── API Contracts file                       (sequential — must complete first)
    │    ▼
    ├── Track A: TDDs (wave-based)
    │    ├── Wave 1: TDD-0
    │    ├── Wave 2: TDD-1 + TDD-4              (parallel within wave)
    │    ├── Wave 3: TDD-2
    │    ├── Wave 4: TDD-3
    │    └── Wave 5: TDD-5 + TDD-6 + TDD-7 + TDD-Infra  (parallel within wave)
    │    ▼ (Gate 4.1)
    ├── Track B: Prompt Specs ──────────┐
    ├── Track C: UX Specs ──────────────┤        (parallel — after Gate 4.1)
    └── Track D: Config Spec ───────────┘
    │    ▼ (Gate 4.2)
    │
    ▼
Phase 5: Integration Examples + Test Strategy   (sequential — 5A first, then 5B)
    │
    ▼
Phase 6: Epics                                   (sequential — needs all specs)
    │
    ▼
Phase 7: Stories & Tasks                         (parallel — per epic, after epic is defined)
```

---

## Glossary

| Term | Definition |
|------|-----------|
| **TDD** | Technical Design Document. A per-component specification produced in Phase 4A. NOT "Test-Driven Development." |
| **ADD** | Architecture Design Document. The system-level architecture produced in Phase 3. |
| **ADR** | Architectural Decision Record. A single design decision with rationale, alternatives, and consequences. Part of the ADD. |
| **Wave** | A group of TDDs that can be written in parallel because they share the same dependency tier. There are 5 waves. |
| **Gate** | A review checkpoint between phases or tracks where the founder reviews and approves before work continues. |
| **Spike** | A time-boxed research effort to solve a specific unsolved problem. Produces a recommendation, not an options list. |
| **API Contracts** | The canonical cross-layer TypeScript interface file (`phase4-api-contracts.md`). Single source of truth for how layers communicate. |
| **Layer** | One of DocAlign's 8 processing layers (L0-L7). Each layer has a corresponding TDD. |
| **Component Engineer** | An agent role that writes TDDs (Phase 4A) and task breakdowns (Phase 7). One per TDD or epic. |
| **Finding** | A review output item using the Review Finding Format: quote, category, severity, recommendation. |
| **Major function** | A public function in a TDD's API section (Section 4 of the TDD template). Each must have ≥2 input→output examples. |
| **Founder** | The sole human decision-maker. All review gates require founder approval. Referred to as "user" in review gate descriptions. |

---

## Quality Checklist (Apply After Every Phase)

Before marking any phase complete, verify:

- [ ] Every spec section has at least one concrete input→output example
- [ ] Every component defines error/failure behavior, not just happy path
- [ ] Every decision includes rationale (why THIS choice, not alternatives)
- [ ] No "TBD", "TODO", or vague language remains (replace with ⚠️ + specific question)
- [ ] Cross-references to other documents are correct (file paths, section names)
- [ ] An AI agent reading ONLY this document could implement the described component
- [ ] Negative examples exist (what the system should NOT do)
- [ ] All clarifying questions for the user are collected and presented at review gate
- [ ] Required Framework Knowledge sections reference official documentation URLs
- [ ] Types conform to `phases/phase4-api-contracts.md` (Phase 4+)
- [ ] Amendments log checked for post-approval changes to upstream artifacts

---

## Artifact Amendment Protocol

When any phase discovers that an approved earlier-phase artifact is incorrect or incomplete:

1. The discovering agent documents the issue with specific evidence in their output under a "## Amendments Required" section.
2. Each amendment includes: which artifact, which section, what is wrong, proposed correction.
3. The issue is raised at the current phase's review gate as an escalation item.
4. The founder decides: (a) update the earlier artifact and re-validate dependent artifacts, or (b) accept the discrepancy as known tech debt.
5. All amendments are tracked in `phases/amendments-log.md` with: date, source phase, target artifact, change description, decision.
6. Agents reading an artifact must check `phases/amendments-log.md` for any post-approval changes.
