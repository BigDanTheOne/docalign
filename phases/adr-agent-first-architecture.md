# ADR: Agent-First Architecture

> Part of [DocAlign Workflow](../WORKFLOW.md) — Cross-cutting architectural decision from Phase 2 spikes

**Status:** Accepted (all founder decisions recorded)
**Date:** 2026-02-10
**Context:** Emerged during Phase 2 spike reviews (Spikes A, B, C). The founder identified that delegating LLM-heavy tasks to the client's own AI agent simplifies DocAlign's codebase AND shifts LLM costs to the client.

---

## 1. Decision

**DocAlign adopts a two-tier execution model:**

- **Tier 1 (Server-side, deterministic):** DocAlign's server handles orchestration, deterministic checks, and infrastructure. Zero LLM cost.
- **Tier 2 (Agent-delegated, client-side):** All tasks requiring codebase exploration or LLM reasoning are delegated to the client's configured AI agent. The client pays their own LLM costs.

**DocAlign becomes an orchestration engine that decides WHAT to verify and WHEN. The client's agent decides HOW.**

---

## 2. Problem

The original architecture has DocAlign's server making all LLM calls (claim extraction, verification, fix generation, feedback interpretation). This creates two problems:

1. **Engineering complexity.** Each LLM call requires custom evidence assembly, token budget management, keyword extraction, relevance scoring, prompt engineering, and output parsing. Spikes B and C found this adds 10+ days of implementation work for subsystems (evidence assembly, learning generalization) that an AI agent handles natively.

2. **Cost scaling.** LLM costs scale with usage. At 100 repos with 200 claims each, verification alone costs $60-400/month at current Claude Sonnet pricing. DocAlign absorbs this cost and must price high enough to cover it, which limits bottom-up adoption.

---

## 3. The Two-Tier Model

### Tier 1: DocAlign Server (deterministic, zero LLM cost)

| Component | What it does | Why server-side |
|-----------|-------------|-----------------|
| **Webhook handler** | Receives GitHub events, queues jobs | Must be always-on, fast response |
| **Tree-sitter parser** (L0) | Parses code into ASTs, extracts entities | Deterministic, fast, no LLM needed |
| **Embedding index** (L0) | Generates/stores embeddings for semantic search | Cheap ($0.0001/entity), batch job |
| **Mapper Steps 1-3** (L2) | Direct reference, symbol lookup, vector similarity | Lookups against the index, no LLM |
| **Static rule evaluator** (Spike A) | Runs LLM-generated rules deterministically | Rule is data, evaluation is code |
| **Tier 1 verifier** | File exists? Dependency version matches? Route exists? | Deterministic checks |
| **Tier 2 verifier** | Pattern/grep checks (tsconfig, imports) | Deterministic checks |
| **Count-based suppression** (Spike C fallback) | Track dismissal counts, suppress after threshold | Simple counting |
| **PR comment formatter** (L5) | Formats findings into GitHub PR comments | Template-based |
| **Queue + scheduler** | Job queue (BullMQ), scheduled scans | Infrastructure |
| **Database** | Claims, mappings, rules, feedback, scan history | Storage |

### Tier 2: Client's Agent (exploration + reasoning)

| Task | Trigger | What the agent does | What it returns |
|------|---------|--------------------|-----------------|
| **Claim extraction** (L1) | Push to default branch | Reads doc files, browses code to understand what's testable, extracts structured claims | `Claim[]` with types, confidence, source locations |
| **Claim classification + rule generation** (L2 Step 4) | After extraction, for unmappable claims | Classifies (universal/flow/untestable), generates static rules by inspecting real code, decomposes flow claims | Classification + `StaticAnalysisRule` or `DecomposedSubClaim[]` |
| **Complex verification** (L3 Tier 4, Path 2) | On PR, for claims that can't be verified by entity extraction alone | Explores codebase, follows imports, assembles its own context, produces verdict | `AgentVerificationResponse` (verdict, reasoning, evidence files, optional rule fixes) |
| **Post-check** (L3 Tier 5) | After verification finds drift | Runs a confirmation check directly in the codebase | Confirmed / contradicted |
| **Fix generation** (L5) | After drift is confirmed | Generates context-aware doc update suggestions | Suggested text + file path + line range |
| **Feedback interpretation** (L7) | On developer thumbs-down + explanation | Interprets explanation, decides corrective action (suppress claim, update rule, flag doc for rewrite) | `CorrectionAction[]` |

### What does NOT use the agent

| Task | Why not agent |
|------|--------------|
| *(None)* | All LLM tasks are client-side. See Section 5. |

**All LLM work runs on the client** — both agent tasks (exploration, extraction) and pure LLM calls (Path 1 verification, embeddings). DocAlign's server handles only deterministic, zero-LLM-cost tasks. The server never sees client code. See Section 5 for rationale.

---

## 4. Agent Task API

The interface between DocAlign's server and the client's agent, regardless of how the agent is triggered.

### Endpoints

```
GET  /api/tasks/pending                — list tasks awaiting agent execution
POST /api/tasks/{id}/result            — submit agent's result for a task
GET  /api/tasks/{id}                   — get full task details (claim, context, mapped files)
```

### Task Types

```typescript
type AgentTaskType =
  | 'claim_extraction'       // L1: extract claims from doc files
  | 'claim_classification'   // L2 Step 4: classify + generate rule or decompose
  | 'verification'           // L3 Tier 4 Path 2: complex verification
  | 'post_check'             // L3 Tier 5: confirm drift finding
  | 'fix_generation'         // L5: generate suggested doc fix
  | 'feedback_interpretation'; // L7: interpret developer feedback

interface AgentTask {
  id: string;
  type: AgentTaskType;
  repo_id: string;
  /** Context the agent needs to execute the task */
  payload: AgentTaskPayload;
  /** When this task was created */
  created_at: string;
  /** Deadline — task is abandoned if not completed by this time */
  expires_at: string;
  status: 'pending' | 'in_progress' | 'completed' | 'expired';
}
```

### Payload per task type

```typescript
type AgentTaskPayload =
  | ClaimExtractionPayload
  | ClaimClassificationPayload
  | VerificationPayload
  | PostCheckPayload
  | FixGenerationPayload
  | FeedbackInterpretationPayload;

interface ClaimExtractionPayload {
  type: 'claim_extraction';
  /** Doc files that changed (paths relative to repo root) */
  doc_files: string[];
  /** Project context for better extraction */
  project_context: {
    language: string;
    frameworks: string[];
    dependencies: Record<string, string>;
  };
}

interface ClaimClassificationPayload {
  type: 'claim_classification';
  /** The claim that failed Steps 1-3 mapping */
  claim: { id: string; claim_text: string; claim_type: string; source_file: string };
  /** Project context */
  project_context: {
    language: string;
    frameworks: string[];
    dependencies: Record<string, string>;
  };
}

interface VerificationPayload {
  type: 'verification';
  /** The claim to verify */
  claim: { id: string; claim_text: string; claim_type: string; source_file: string };
  /** Files the mapper identified as potentially relevant */
  mapped_files: Array<{ path: string; confidence: number; entity_name?: string }>;
  /** Why this was routed to agent (no entity, large entity, multi-file, etc.) */
  routing_reason: string;
}

interface PostCheckPayload {
  type: 'post_check';
  /** The drift finding to confirm */
  finding: {
    claim_text: string;
    verdict: 'drifted';
    mismatch_description: string;
    evidence_files: string[];
  };
}

interface FixGenerationPayload {
  type: 'fix_generation';
  /** The confirmed drift finding */
  finding: {
    claim_text: string;
    source_file: string;
    source_line: number;
    mismatch_description: string;
    evidence_files: string[];
  };
}

interface FeedbackInterpretationPayload {
  type: 'feedback_interpretation';
  /** The dismissed finding */
  finding: {
    claim_id: string;
    claim_text: string;
    claim_type: string;
    source_file: string;
    verdict: string;
    mismatch_description: string;
  };
  /** Developer's explanation */
  explanation: {
    type: 'quick_pick' | 'free_text';
    value: string;
  };
  /** Existing suppression rules for context */
  existing_rules: Array<{ scope: string; target: string; reason: string }>;
}
```

### Result types

```typescript
interface AgentTaskResult {
  task_id: string;
  /** Whether the agent succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Task-specific result data */
  data: AgentResultData;
  /** Metadata for logging */
  metadata: {
    duration_ms: number;
    model_used?: string;
    tokens_used?: number;
    cost_usd?: number;
  };
}

type AgentResultData =
  | ClaimExtractionResult
  | ClaimClassificationResult
  | VerificationResult
  | PostCheckResult
  | FixGenerationResult
  | FeedbackInterpretationResult;

interface ClaimExtractionResult {
  type: 'claim_extraction';
  claims: Array<{
    claim_text: string;
    claim_type: string;
    source_file: string;
    source_line: number;
    confidence: number;
  }>;
}

interface ClaimClassificationResult {
  type: 'claim_classification';
  classification: 'universal' | 'flow' | 'untestable';
  /** For universal: the generated static rule */
  static_rule?: {
    scope: string;
    scope_exclude?: string[];
    checks: Array<{ type: string; [key: string]: unknown }>;
  };
  /** For flow: decomposed sub-claims */
  sub_claims?: Array<{
    sub_claim_text: string;
    expected_evidence_type: string;
    search_hints: string[];
  }>;
  /** For untestable: why */
  untestable_reason?: string;
  reasoning: string;
}

interface VerificationResult {
  type: 'verification';
  verdict: 'verified' | 'drifted' | 'uncertain';
  confidence: number;
  reasoning: string;
  evidence_files: string[];
  specific_mismatch?: string;
  suggested_fix?: string;
  /** Optional: agent noticed issues with Spike A rules or mappings */
  rule_fixes?: Array<{
    rule_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    reason: string;
  }>;
}

interface PostCheckResult {
  type: 'post_check';
  outcome: 'confirmed' | 'contradicted';
  reasoning: string;
}

interface FixGenerationResult {
  type: 'fix_generation';
  suggested_fix: {
    file_path: string;
    line_start: number;
    line_end: number;
    new_text: string;
    explanation: string;
  };
}

interface FeedbackInterpretationResult {
  type: 'feedback_interpretation';
  actions: Array<{
    action_type: 'suppress_claim' | 'suppress_file' | 'suppress_type'
      | 'update_rule' | 'suggest_doc_update' | 'no_action';
    target_id?: string;
    target_path?: string;
    duration_days?: number;
    reason: string;
    details?: Record<string, unknown>;
  }>;
}
```

---

## 5. The Tier 4 Simple Verification Question

One open question: should Tier 4 simple verification (Path 1 from Spike B) also use the client's agent?

**Decision: Always client-side. All LLM calls run on the client.**

| Factor | All-client-side |
|--------|----------------|
| Security | DocAlign **never sees client code**. Not even snippets. Removes the biggest enterprise objection. |
| Cost | Zero variable LLM costs for DocAlign. Fixed infrastructure only. Aggressive pricing possible. |
| Architecture | One execution path. No tier-dependent branching. Simpler to build, test, maintain. |
| Open source | Core engine (Action + CLI) can be open-sourced. Server = paid product. |
| Setup | Client needs an LLM API key. Minor friction — most AI-tool users already have one. |

**Rationale:** Path 1 claims are simple ("does this function match this claim?"), but even these send real code to the server if run server-side. The "never sees your code" guarantee is worth more than the latency improvement. Zero variable costs mean the Free tier costs DocAlign nothing per user, enabling unlimited free repos for maximum adoption velocity.

**Implementation:** The GitHub Action makes direct LLM API calls for Path 1 (fast, 1-3 seconds, using client's API key). It only spawns the full agent for Path 2 (complex exploration). This keeps Path 1 fast without sending code to DocAlign.

---

## 6. Agent Triggering Mechanisms

The client's agent needs to be triggered when DocAlign has tasks. Three mechanisms, supporting different workflows:

### 6.1 GitHub Action (recommended for v1)

The client adds a DocAlign workflow to their repo:

```yaml
name: DocAlign
on:
  pull_request:
    types: [opened, synchronize]
  push:
    branches: [main]

jobs:
  docalign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docalign/agent-action@v1
        with:
          docalign_token: ${{ secrets.DOCALIGN_TOKEN }}
          agent: claude-code
          agent_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**How it works:**
1. GitHub event triggers the Action
2. Action calls `GET /api/tasks/pending` for this repo
3. Action runs the configured agent for each task
4. Action calls `POST /api/tasks/{id}/result` with the agent's output
5. DocAlign server processes results, posts PR comment

**Pros:** Runs in CI (familiar to developers), uses client's API key, no DocAlign server load for agent tasks.
**Cons:** CI minutes cost (but most repos have plenty). Cold start on first run.

### 6.2 MCP Integration (for interactive use)

The client's coding agent calls DocAlign's MCP tools during their normal workflow:

```
Tool: docalign_get_pending_tasks
Tool: docalign_submit_verification
Tool: docalign_report_drift
Tool: docalign_get_claim_status
```

**Pros:** Zero setup beyond MCP server configuration. Agent can verify claims as part of its normal coding workflow.
**Cons:** Requires the developer to be actively using their coding agent. Not automatic.

### 6.3 DocAlign CLI (for local development)

```bash
# Verify all pending claims for this repo
docalign verify --agent claude-code --api-key $ANTHROPIC_API_KEY

# Extract claims from changed docs
docalign extract --agent claude-code

# Interpret feedback for a specific finding
docalign interpret --finding-id abc123 --explanation "migration in progress"
```

**Pros:** Developer can run on demand. Useful for testing and debugging.
**Cons:** Manual. Not automatic.

### Recommended approach

- **v1:** Repository dispatch (event-driven — DocAlign server triggers the Action via GitHub API when tasks are ready, reducing latency vs polling)
- **v1:** MCP tools (for interactive use by coding agents)
- **v2:** CLI (for power users and debugging)

---

## 7. Business Model Implications

### Cost structure

| Component | Cost bearer | Cost estimate |
|-----------|-------------|---------------|
| DocAlign server (webhook, queue, DB, scheduling) | DocAlign | ~$55-85/month fixed |
| ALL LLM tasks (extraction, verification, embeddings, fixes, feedback) | Client | ~$5-30/month per active repo |

DocAlign has **zero variable LLM costs**. All LLM work runs on the client using their API key. DocAlign's costs are fixed infrastructure regardless of user count.

### Pricing tiers

| Tier | What DocAlign does | What client provides | Price |
|------|-------------------|---------------------|-------|
| **Free** | Orchestration + deterministic checks. Core engine (GitHub Action + CLI) may be open-sourced. | LLM API key + GitHub Action setup | $0 |
| **Pro** | Same orchestration + team dashboard, scheduled scans, cross-repo analytics, notifications, SSO, priority support, longer data retention | LLM API key + GitHub Action setup | TBD (feature-based, not compute-based) |

Both tiers use the same execution model — all compute client-side. Pro is differentiated by **features**, not compute:
- Team dashboard (health scores across repos, drift trends, hotspot visualization)
- Scheduled full scans (cron-triggered)
- Cross-repo insights and analytics
- Slack/email notifications on drift
- SSO / team management
- Priority support
- Longer data retention
- Custom rule management UI

The Free tier is the bottom-up growth engine. DocAlign's marginal cost per free user is **zero**. Open-source core enables maximum distribution.

---

## 8. What This Simplifies in DocAlign's Codebase

### Deleted / never built

| Component | Why deleted | Replaced by |
|-----------|------------|-------------|
| Evidence assembly pipeline (token budgets, keyword scoring, relevance ranking) | Agent assembles its own context | Agent explores codebase freely |
| LLM prompt templates for verification | Agent writes its own prompts | Agent interface (claim + files in, verdict out) |
| LLM prompt templates for claim extraction | Agent writes its own prompts | Agent interface (doc files in, claims out) |
| LLM prompt templates for fix generation | Agent writes its own prompts | Agent interface (finding in, fix out) |
| Import-following logic | Agent follows imports naturally | Agent explores codebase |
| Post-check script generation + sandboxing | Agent runs checks directly | Agent has codebase access |
| Token counting / tiktoken integration | Agent manages its own context | Not needed |
| Complex feedback generalization logic | Agent interprets explanations | Agent interface (feedback in, actions out) |

### What DocAlign actually builds

1. **GitHub App** — webhook handler, API server
2. **Job queue** — BullMQ for async processing
3. **Tree-sitter index** — parse code, extract entities, store in DB
4. **Embedding index** — generate embeddings, vector similarity search
5. **Simple mapper** (Steps 1-3) — direct reference, symbol lookup, semantic search
6. **Static rule evaluator** — run Spike A rules deterministically
7. **Deterministic verifiers** (Tiers 1-2) — file exists, dependency version, pattern checks
8. **Agent Task API** — queue tasks, receive results, apply actions
9. **PR comment formatter** — template results into GitHub comments
10. **Count-based suppression** — simple dismissal tracking (Spike C fallback)
11. **Database + migrations** — PostgreSQL schema
12. **GitHub Action** — `docalign/agent-action` for client-side agent execution
13. **MCP server** — tools for interactive agent use

That's it. No evidence assembly. No LLM prompt engineering. No token budget management. No complex learning algorithms. The hard reasoning work is done by the client's agent.

---

## 9. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Client's agent produces bad results** (hallucination, wrong verdict) | Medium — wrong PR comments erode trust | Validation layer on agent results (check required fields, sanity-check verdicts). Tier 1-2 deterministic checks catch obvious errors. Post-check confirms drift findings. |
| **Client doesn't configure an agent** | High — no verification happens | DocAlign detects unconfigured agent and shows setup instructions. Free tier is clearly labeled "requires agent setup." Team/Enterprise tiers handle it server-side. |
| **Agent latency too high for PR workflow** | Medium — developers wait 2-5 minutes | Agent tasks run in parallel. GitHub Action runs as CI job (developers don't wait). Show "verification in progress" check on PR, update when done. |
| **Agent API changes break integration** | Medium — agent stops working | Version the agent interface. Validate agent output schema. Graceful degradation (skip agent tasks, run deterministic checks only). |
| **Vendor lock-in to specific agent** | Low — agents are commoditizing | Abstract agent interface (`AgentAdapter`). Support Claude Code, Cursor, custom command. Client can switch agents without changing DocAlign config. |
| **Free tier users generate support load without revenue** | Medium — support costs | Self-service documentation. Community support (GitHub Discussions). Limit free tier to N repos. |
| **Client's API key exposed in GitHub Action** | High — security breach | Use GitHub Secrets (encrypted). Never log API keys. DocAlign never sees the client's API key — it stays in the Action runner. |

---

## 10. Founder Decisions

1. **All LLM calls client-side (both tiers).** DocAlign never sees client code. Zero variable LLM costs. One execution path. The GitHub Action makes direct LLM API calls for Path 1 (fast) and spawns the agent for Path 2 (complex). *(Updated from original "client-side free, server-side paid" decision.)*

2. **All embeddings client-side (both tiers).** Same rationale as Decision 1. Embedding generation runs in the GitHub Action using client's API key. *(Updated from original "same pattern" decision.)*

3. **Tier 3 triage gate:** Remove entirely. With the agent handling complex cases and Path 1 handling simple ones, the triage gate adds latency and complexity for minimal value. All semantic claims go directly to Path 1 (entity extraction) or Path 2 (agent-delegated).

4. **Agent triggering:** Repository dispatch (event-driven). DocAlign server triggers the client's agent via GitHub repository dispatch events rather than having the Action poll for tasks. This is more responsive and reduces latency.

5. **Free tier limits:** No limits for now. Unlimited repos on the free tier to maximize adoption velocity. Limits may be introduced later if needed, but not at launch.

6. **Two tiers only (Free / Pro).** No Enterprise tier. Pro is differentiated by features (dashboard, scheduling, analytics, notifications, SSO, support), not by compute. Both tiers use identical execution model — all compute client-side.

7. **Onboarding requires Action setup.** On install, DocAlign requires the GitHub Action to be configured before the full scan can run. No partial onboarding. AHA moment requires working Action.
