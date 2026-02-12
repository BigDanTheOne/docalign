# Phase 3A: System Architecture Document

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 3: Architecture Design Document
>
> **Inputs:** Hardened PRD (post-reconciliation), Spikes A-C, ADR: Agent-First Architecture, Phase 2.5 Audit Findings
>
> **Date:** 2026-02-11

---

## 1. System Overview

DocAlign is a documentation-reality alignment engine. It extracts factual claims from documentation, maps them to code, verifies each claim, and reports drift on pull requests.

**Core architectural constraint:** DocAlign's server makes zero LLM calls. All LLM work runs on the client's GitHub Action using their own API key. DocAlign orchestrates WHAT to verify and WHEN. The client's agent decides HOW.

---

## 2. Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GITHUB                                      │
│                                                                     │
│  ┌──────────┐   webhooks    ┌──────────────────────────────────┐   │
│  │  GitHub   │─────────────>│       DocAlign Server             │   │
│  │  (repos,  │<─────────────│                                  │   │
│  │   PRs)    │  API calls   │  ┌──────────┐  ┌─────────────┐  │   │
│  └──────────┘               │  │ API      │  │ Worker      │  │   │
│       ^                     │  │ Server   │  │ (BullMQ)    │  │   │
│       │                     │  │ (Express)│  │             │  │   │
│  repo dispatch              │  └────┬─────┘  └──────┬──────┘  │   │
│       │                     │       │               │          │   │
│  ┌────┴─────────┐           │  ┌────┴───────────────┴───────┐  │   │
│  │ GitHub Action│           │  │        Shared Services      │  │   │
│  │ (docalign/   │<─ tasks ──│  │  ┌─────────┐ ┌──────────┐  │  │   │
│  │  agent-action│── results>│  │  │ GitHub  │ │ Tree-     │  │  │   │
│  │  )           │           │  │  │ Client  │ │ sitter    │  │  │   │
│  │              │           │  │  └─────────┘ └──────────┘  │  │   │
│  │  ┌────────┐  │           │  └────────────┬───────────────┘  │   │
│  │  │ LLM    │  │           │               │                  │   │
│  │  │ Client │  │           │  ┌────────────┴───────────────┐  │   │
│  │  └────────┘  │           │  │       Data Layer            │  │   │
│  │  ┌────────┐  │           │  │  ┌───────────┐ ┌────────┐  │  │   │
│  │  │ Agent  │  │           │  │  │PostgreSQL │ │ Redis  │  │  │   │
│  │  │(Claude │  │           │  │  │(Supabase) │ │(BullMQ)│  │  │   │
│  │  │ Code)  │  │           │  │  │+ pgvector │ │        │  │  │   │
│  │  └────────┘  │           │  │  └───────────┘ └────────┘  │  │   │
│  └──────────────┘           │  └────────────────────────────┘  │   │
│   Client infrastructure     │        DocAlign infrastructure    │   │
│   (client pays LLM)         │        (fixed cost, zero LLM)    │   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Runs On | Responsibility | LLM Calls |
|-----------|---------|---------------|-----------|
| **API Server** | Railway | Webhook receiver, Agent Task API, dismiss endpoint, healthcheck | Zero |
| **Worker** | Railway (same process or separate) | Job processing: index updates, mapping, deterministic verification, PR comment formatting | Zero |
| **PostgreSQL** | Supabase | All persistent state: repos, claims, entities, mappings, results, feedback, rules | N/A |
| **Redis** | Railway (or managed) | BullMQ job queue, rate limit counters, installation token cache | N/A |
| **GitHub Action** | Client's CI runners | ALL LLM tasks: extraction, verification (Path 1 + Path 2), embeddings, fix generation, feedback interpretation | All |
| **MCP Server** (v2) | Developer's machine | Agent tool interface, reads from PostgreSQL | Zero |
| **CLI** (v2) | Developer's machine | Local scanning, manual verification triggers | Via client's key |

---

## 3. Architectural Decision Records (ADRs)

### ADR-1: All-Client-Side Execution Model

**Decision:** All LLM calls run on the client's GitHub Action using their own API key. DocAlign's server makes zero LLM calls and never sees client code.

**Alternatives considered:**
- Server-side LLM calls (original PRD design): DocAlign makes all LLM calls. **Rejected:** creates variable LLM costs, requires DocAlign to see client code, limits pricing flexibility.
- Hybrid (server-side for cheap calls, client-side for expensive): **Rejected:** two execution paths add complexity. "Never sees your code" is a stronger guarantee than "sometimes sees your code."

**Rationale:** Zero variable costs. "Never sees your code" guarantee removes enterprise objection. Enables aggressive free tier (zero marginal cost per user). One execution path simplifies architecture.

**Consequences:** Client must configure GitHub Action + LLM API key. Adds onboarding friction. Client bears all LLM costs. DocAlign cannot control LLM quality/model choice.

> Full specification: `phases/adr-agent-first-architecture.md`

### ADR-2: Two-Path Evidence Assembly

**Decision:** Claims are routed to Path 1 (entity extraction + direct LLM call, ~60-70%) or Path 2 (agent-delegated verification, ~30-40%) based on deterministic routing logic.

**Alternatives considered:**
- Fixed token budget per claim: **Rejected:** insufficient for multi-file claims, requires keyword extraction/relevance scoring.
- Adaptive budget tiers (S/M/L): **Rejected:** three code paths, still fails on hard cases.
- Iterative retrieval with feedback loops: **Rejected:** up to 3x latency, cannot distinguish insufficient context from genuine ambiguity.

**Rationale:** Path 1 is trivially simple (tree-sitter extract, <5ms, $0). Path 2 eliminates all retrieval complexity by delegating to an actual agent. Building sophisticated evidence retrieval is building a worse version of what agents already do.

**Consequences:** Path 2 is expensive ($0.02-0.20/claim) and slow (10-60s). Mitigated by routing majority to Path 1. Agent quality varies by provider/model.

> Full specification: `phases/spike-b-evidence-assembly.md`

### ADR-3: Tier 3 Triage Gate Removed

**Decision:** Remove the cheap LLM triage step (classify claim as obviously accurate/drifted/uncertain before deep verification). All semantic claims go directly to Path 1 or Path 2.

**Alternatives considered:**
- Keep triage (original PRD): **Rejected:** with all-client-side model, triage adds latency and cost for minimal value. Client already pays per-call — an extra classification call wastes their budget.

**Rationale:** Path 1 is already fast and cheap ($0.003-0.012). Triage would cost similar but produce less information. The routing decision (Path 1 vs Path 2) replaces triage as the cost optimization mechanism.

**Consequences:** Slightly higher LLM cost for claims that would have been triaged as "obviously accurate." Offset by eliminating an entire pipeline stage.

### ADR-4: BullMQ Job Queue with Per-Repo Serialization

**Decision:** Use BullMQ (Redis-backed) for async job processing. Scans for the same repo are serialized (concurrency 1 per repo). Cross-repo concurrency: 5 server-side jobs.

**Alternatives considered:**
- PostgreSQL-based queue (pg-boss): **Rejected:** adds polling overhead, less battle-tested for real-time job processing.
- Direct processing in webhook handler: **Rejected:** GitHub webhooks must respond within 10 seconds. Verification takes 1-5 minutes.
- Per-org concurrency instead of per-repo: Deferred to scaling phase (audit finding I1).

**Rationale:** BullMQ provides retry, rate limiting, job deduplication, and cancellation. Per-repo serialization prevents race conditions on shared state (claims, mappings, verification results). Redis is already needed for rate limit counters.

**Consequences:** Only one scan per repo at a time. Queueing delay when webhooks arrive faster than processing. Mitigation: debounce (30s window replaces pending jobs).

### ADR-5: Repository Dispatch for Agent Triggering

**Decision:** DocAlign server triggers the client's GitHub Action via repository dispatch events (not webhook-triggered Action, not polling).

**Alternatives considered:**
- Action triggers on PR events directly: **Rejected:** Action wouldn't know which tasks to run without querying DocAlign first. Extra round-trip.
- Action polls DocAlign API: **Rejected:** adds latency (polling interval) and wastes CI minutes.

**Rationale:** Repository dispatch is event-driven. DocAlign creates tasks in the database, then triggers the Action with a dispatch event containing the repo_id and scan context. Action runs immediately.

**Consequences:** Requires `contents: read` and `metadata: read` permissions on the GitHub App to send repository dispatch. Action must be pre-configured in the repo.

### ADR-6: Dual Mechanism for Vague Claims (v2)

**Decision:** Universal/quantified claims use static analysis rules (deterministic, zero LLM cost at evaluation time). Architecture flow claims use decomposition into sub-claims.

**Alternatives considered:**
- Skip all vague claims (MVP approach): Confirmed acceptable for MVP.
- LLM verification for all vague claims: **Rejected:** cost scales with repo size × universal claim count per PR.
- Single mechanism (decomposition only): **Rejected:** decomposition doesn't catch new files that violate universal claims.

**Rationale:** Universal claims need an admission-control pattern (evaluate on every new file). Static rules provide this at $0 cost per evaluation. Flow claims need semantic understanding of multi-component relationships. Different problems, different solutions.

**Consequences:** Two code paths for vague claims. Static rule quality depends on LLM generation. ~20-30% of universal claims resist static rules and fall through to decomposition + LLM.

> Full specification: `phases/spike-a-vague-claim-mapping.md`

### ADR-7: Explanation-Driven Learning with Count-Based Fallback

**Decision:** On thumbs-down, prompt developer with quick-picks. Quick-picks trigger deterministic corrective actions (no LLM). Bare thumbs-down: 2 silent dismissals → permanently exclude claim. Free-text interpretation by agent in v2.

**Alternatives considered:**
- Count-only suppression: **Rejected:** too slow to converge (needs weeks at low volumes), cannot learn novel patterns.
- LLM inference from bare thumbs-down: **Rejected:** too ambiguous, may hallucinate overly broad rules.
- Approval gate before applying corrections: **Rejected:** adds friction, delays learning, developers ignore proposals.

**Rationale:** One explained dismissal gives the same information as 5-10 unexplained ones. Quick-picks make explanation zero-friction (one click). No approval gate because speed of learning matters more than perfection. Safety valves (expiration, spot-checks, undo) bound risk.

**Consequences:** Possible over-correction from vague explanations (mitigated by narrow scoping, expiration). Developers who never explain get only per-claim suppression.

> Full specification: `phases/spike-c-learning-generalization.md`

### ADR-8: PostgreSQL + pgvector (Co-located)

**Decision:** Use PostgreSQL (Supabase) for all persistent state, including vector embeddings via pgvector extension. No separate vector database.

**Alternatives considered:**
- Separate vector DB (Pinecone, Weaviate): **Rejected:** adds operational complexity, another service to manage, data synchronization issues.
- SQLite for local mode: Deferred. MCP server (v2) will use PostgreSQL connection, not local SQLite.

**Rationale:** Co-located vectors simplify queries (JOIN claims with their embeddings in one query). Supabase provides managed pgvector. HNSW indexes provide good recall without minimum row count requirements. One database to manage.

**Consequences:** Vector search performance limited by PostgreSQL (adequate for per-repo queries, not for cross-repo at scale). Scaling past ~50K repos may require partitioning (audit finding I8).

---

## 4. Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Language** | TypeScript (Node.js) | GitHub App ecosystem, async I/O for webhook handling, tree-sitter WASM bindings, fast iteration |
| **Web framework** | Express.js | Minimal, well-known, sufficient for 4 API endpoints |
| **AST parsing** | tree-sitter (WASM) | Multi-language (TS/JS/Python MVP), battle-tested, node bindings available |
| **Database** | PostgreSQL 15+ (Supabase) | Managed, free tier for dev, familiar, pgvector extension |
| **Vector search** | pgvector (HNSW indexes) | Co-located with relational data, no extra service |
| **Job queue** | BullMQ (Redis-backed) | Retry, rate limiting, job deduplication, cancellation, battle-tested |
| **Cache / counters** | Redis | Rate limit counters (atomic INCR), installation token cache, BullMQ backend |
| **Hosting** | Railway | Simple deployment, reasonable pricing, environment variable management |
| **Database migrations** | node-pg-migrate | Lightweight, no ORM overhead, SQL-based migrations |
| **GitHub integration** | Octokit / @octokit/rest | Official GitHub SDK, TypeScript types |
| **Validation** | Zod | Runtime type validation for agent results, config, webhook payloads |
| **Logging** | pino | Structured JSON logging, safe mode prevents log injection (audit finding S10) |
| **GitHub Action** | TypeScript (actions toolkit) | @actions/core, @actions/github for Action runtime |

---

## 5. Data Architecture

### 5.1 Schema Overview

```
repos
  +-- code_entities (L0) ─── pgvector embedding
  +-- claims (L1) ─── pgvector embedding
  |     +-- claim_mappings (L2) ─── co_change_boost (REAL, default 0.0)
  |     +-- verification_results (L3)
  |     +-- feedback (L7)
  |     +-- suppression_rules (L7, Spike C)
  +-- static_analysis_rules (Spike A, v2)
  +-- co_changes (L7)
  +-- agent_drift_reports (L6)
  +-- agent_tasks (ADR)
  +-- scan_runs (L4) ─── comment_posted (BOOLEAN, default false)
```

### 5.2 Key Schema Decisions

**Primary keys:** UUIDs (`gen_random_uuid()`). Avoids sequential ID enumeration. Compatible with distributed generation if needed later.

**Cascade deletes:** All child tables use `ON DELETE CASCADE` from `repos`. Uninstall = delete repo record → cascades to all related data. This is a hard delete per PRD Section 13.5.

**JSONB for flexible fields:** `claims.extracted_value` (per-type structured data), `repos.config` (cached repo configuration). Avoids per-type tables while keeping queryability.

**Vector columns:** `code_entities.embedding VECTOR(1536)` and `claims.embedding VECTOR(1536)`. HNSW indexes for approximate nearest neighbor search. Dimension matches OpenAI text-embedding-3-small default.

**Embedding dimension change handling (audit finding G6):** If `llm.embedding_model` changes, a full re-index is required (all embeddings regenerated). The system validates that embedding dimensions match between stored vectors and new queries. Dimension mismatch → reject query, log error, prompt full re-index.

### 5.3 Migration Strategy

- **Tool:** node-pg-migrate
- **Location:** `migrations/` directory, numbered sequentially (e.g., `001_create_repos.sql`)
- **Execution:** Pre-deploy hook on Railway (runs before new code is deployed)
- **Rollback:** Manual rollback scripts provided alongside each migration (`migrations/rollback/001_rollback_create_repos.sql`). No automatic rollback — manual intervention required. (Audit finding I12)
- **Dependency order:** repos → scan_runs → code_entities → claims → claim_mappings → verification_results → feedback → co_changes → agent_drift_reports → agent_tasks → suppression_rules → static_analysis_rules

### 5.4 Data Retention

| Table | Retention | Cleanup |
|-------|-----------|---------|
| verification_results | Last 10 per claim | Weekly purge job |
| scan_runs | 90 days | Weekly archive job |
| feedback | Indefinite | — |
| co_changes | 180 days | Weekly purge job |
| agent_tasks (completed) | 30 days | Daily cleanup |
| agent_tasks (expired) | 48 hours | Hourly cleanup (audit finding I5) |
| suppression_rules | Indefinite (subject to expiration/revocation) | — |

---

## 6. Concurrency Model

### 6.1 Server-Side Concurrency

```
Incoming webhooks
       │
       ▼
┌──────────────┐
│  API Server  │  (stateless, handles N concurrent requests)
│  (Express)   │
└──────┬───────┘
       │ enqueue job
       ▼
┌──────────────────────────────────────┐
│          BullMQ (Redis)              │
│                                      │
│  Per-repo queues: concurrency = 1    │
│  ┌──────────┐ ┌──────────┐          │
│  │repo-{id1}│ │repo-{id2}│ ...      │
│  └──────────┘ └──────────┘          │
│                                      │
│  Global concurrency: 5 server jobs   │
└──────────────────┬───────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │   Worker(s)  │  (5 concurrent jobs max)
            └──────────────┘
```

**Per-repo serialization:** All scan types (PR scan, full scan, push scan) for a single repo go into the same per-repo queue with concurrency 1. Queue name: `repo-{repo_id}`. This prevents race conditions on shared repo state.

**Debounce:** When a new push arrives within 30 seconds of a queued/in-progress scan for the same PR, the new webhook replaces the pending job. Job ID: `pr-scan-{repo_id}-{pr_number}`. BullMQ replaces the existing job if not yet started, or marks for cancellation if in progress.

**Cancellation mechanism:** The worker uses a per-job cancellation flag stored in BullMQ job data. When a new webhook replaces a job:
- If job is `waiting`: BullMQ `removeJobs()` removes it; a new job is enqueued.
- If job is `active`: the new webhook sets a Redis key `cancel:{job_id}` with 10-minute TTL. The active worker checks this key at stage boundaries (below). On detection, the worker sets `scan_runs.status = 'cancelled'`, saves completed work, and returns (job completes with `{ cancelled: true }` in result, NOT as a failure).

**Cancellation check points (audit finding A7):** Workers check `cancel:{job_id}` at stage boundaries:
1. After L0 index update
2. After claim extraction task creation
3. After each verification batch of 10 claims
4. Before PR comment posting

If cancelled, save all completed work and exit gracefully. Cancellation does NOT count as a job failure (audit finding E5) — retries apply only to execution errors.

### 6.2 Client-Side Concurrency

The GitHub Action runs LLM tasks with configurable concurrency:

```
Action receives repository dispatch
       │
       ▼
┌──────────────────────────────────┐
│  GitHub Action Runner            │
│                                  │
│  Poll: GET /api/tasks/pending    │
│       │                          │
│       ▼                          │
│  Execute tasks in parallel       │
│  (concurrency: config, default 5)│
│       │                          │
│       ▼                          │
│  Submit: POST /api/tasks/{id}/result │
└──────────────────────────────────┘
```

**Max concurrency:** Default 5, configurable up to 20 via `.docalign.yml` `agent.concurrency`.

### 6.3 Race Condition Mitigations

**Agent task claiming (audit finding A1):**
- `agent_tasks` table has a `claimed_by` column (action_run_id).
- `GET /api/tasks/pending` filters by `claimed_by IS NULL`, then atomically sets `claimed_by` and `status = 'in_progress'` using `UPDATE ... WHERE claimed_by IS NULL RETURNING *`.
- `POST /api/tasks/{id}/result` returns HTTP 409 Conflict if already completed by a different run.

**Agent task expiration race (audit finding A2):**
- When a task is polled/assigned (status set to `in_progress`), extend `expires_at` by 10 minutes from the assignment time.
- If the Action submits a result for an expired task, server returns HTTP 410 Gone.

**Rename detection in incremental index (audit finding A3):**
- Git diff uses `--name-status` to detect renames (R status code).
- Update both `code_entities.file_path` and `claim_mappings.code_file` in the same database transaction.

**Uninstall during active scan (audit finding A5):**
- On `installation.deleted` webhook: first cancel all in-progress and queued jobs for affected repos (`queue.removeJobs()` filtered by repo_id), then delete data via cascading delete on the `repos` record.

**Transaction boundaries (audit finding A6):**
- Verification batch writes: wrap in a single database transaction. If any row fails, rollback all, mark scan `failed`, save partial results to a separate error log.
- Individual operations within a scan (index update, claim extraction results, mapping) each get their own transaction — scan-level rollback is not necessary for these.

**Force push during scan (audit finding E3):**
- Store `commit_sha` in `scan_runs` at scan start.
- Before posting PR comment, check current PR HEAD. If different from stored SHA, prepend warning: "Results are from commit `abc123`. PR has been updated since."

---

## 7. Request/Response Flow: PR Scan (Primary Use Case)

```
1. GitHub sends pull_request webhook (opened/synchronize)
       │
       ▼
2. API Server: verify webhook signature (HMAC-SHA256)
       │
       ▼
3. API Server: check rate limits (per-repo: 100/day, per-org: 1000/day)
       │
       ▼
4. API Server: enqueue PR scan job (BullMQ, job ID = pr-scan-{repo_id}-{pr_number})
       │ (debounce: replaces existing job if within 30s)
       ▼
5. Worker picks up job
       │
       ├── 5a. Create GitHub Check Run (status: in_progress)
       │
       ├── 5b. Fetch PR diff via GitHub API (changed files)
       │
       ├── 5c. Separate: doc files vs code files
       │
       ├── 5d. L0: Update codebase index for changed code files
       │        (tree-sitter parse, entity diff, deterministic)
       │
       ├── 5e. Create agent tasks in DB:
       │        Timing: tasks are created AFTER L0 index update (5d) and AFTER
       │        the routing decision (Path 1 vs Path 2) is made. Routing uses
       │        the updated L0 index to determine entity mappings, line counts,
       │        and token estimates. Tasks are inserted in a single batch INSERT,
       │        then the repository dispatch (5f) is sent with all task_ids.
       │        - Claim extraction (if docs changed)
       │        - Path 1 verification tasks (entity-mapped claims, token estimate < path1_max_evidence_tokens)
       │        - Path 2 verification tasks (file/multi/none-mapped claims, or Path 1 overflow)
       │
       ├── 5f. Trigger GitHub Action via repository dispatch
       │        Event payload: { repo_id, scan_run_id, task_ids }
       │
       │   ┌─── GitHub Action runs ───┐
       │   │                           │
       │   │  Poll tasks, execute:     │
       │   │  - Claim extraction (LLM) │
       │   │  - Path 1 verification    │
       │   │  - Path 2 verification    │
       │   │  - Fix generation         │
       │   │  Submit results via API   │
       │   └───────────────────────────┘
       │
       ├── 5g. Worker: receives results, runs Tiers 1-2 (deterministic)
       │        for claims not needing LLM
       │
       ├── 5h. L2: Find claims affected by code changes (reverse index lookup)
       │        Merge with claims from changed doc files, deduplicate
       │
       ├── 5i. Check suppression rules (filter out suppressed claims)
       │        (audit finding A10)
       │
       ├── 5j. Merge all verification results (deterministic + agent)
       │
       ├── 5k. L5: Format PR comment (summary + review comments)
       │        - Sort findings: severity desc, file path alpha, line asc
       │        - Max 25 in summary, all get review comments
       │        - Uncertain claims: collapsible <details> section only
       │        - Mark old review comments as "(Resolved ✓)" if applicable
       │
       ├── 5l. Post to GitHub:
       │        - Summary comment (Issues API)
       │        - Review comments with suggestions (Pull Request Review API)
       │        - Update Check Run (completed, conclusion based on findings)
       │
       └── 5m. L7: Record scan results, update health score
```

---

## 8. State Machine Diagrams

### 8.1 Repo Installation Lifecycle

```
                    installation.created
                          │
                          ▼
                    ┌──────────┐
                    │onboarding│
                    └────┬─────┘
                         │
              Action configured?
              /                  \
            NO                   YES
             │                    │
             ▼                    ▼
     ┌───────────────┐    ┌────────────┐
     │awaiting_setup │    │ scanning   │
     │(Check posted  │    │(full scan) │
     │ with setup    │    └─────┬──────┘
     │ instructions) │          │
     └───────┬───────┘     scan result?
             │            /    |        \
      Action added     success partial  failure
             │           │      │         │
             ▼           ▼      ▼         ▼
       ┌──────────┐  ┌──────┐ ┌───────┐ ┌─────┐
       │ scanning │  │active│ │partial│ │error│──retry──>scanning
       └──────────┘  └──┬───┘ └───┬───┘ └──┬──┘  (max 3)
                        │         │         │
                        │    PR scan works  │
                        │    with partial   │
                        │    data           │
                        │                   │
                    ┌───┴───────────────────┘
                    │
           installation.deleted
                    │
                    ▼
              ┌───────────┐
              │ deleted   │ (hard delete all data)
              └───────────┘
```

**Transitions:**

| From | Event | To | Action |
|------|-------|----|--------|
| — | `installation.created` | `onboarding` | Create repo record, check for Action |
| `onboarding` | Action not found | `awaiting_setup` | Post Check with setup instructions |
| `onboarding` / `awaiting_setup` | Action configured | `scanning` | Queue full scan |
| `scanning` | Scan success | `active` | Cache health score |
| `scanning` | Scan partial (timeout) | `partial` | Save completed results |
| `scanning` | Scan failure | `error` | Log, schedule retry (max 3) |
| `error` | Retry | `scanning` | Re-queue full scan |
| `error` | PR webhook | `error` (process PR) | PR scan in degraded mode |
| Any | `installation.deleted` | `deleted` | Cancel jobs, hard delete all data |

### 8.2 Claim Lifecycle

```
              claim extracted
                    │
                    ▼
              ┌─────────┐
              │ pending  │ (not yet verified)
              └────┬─────┘
                   │
              verification
             /     |      \
        verified  drifted  uncertain
           │        │         │
           ▼        ▼         ▼
     ┌──────────┐ ┌───────┐ ┌───────────┐
     │ verified │ │drifted│ │ uncertain │
     └────┬─────┘ └───┬───┘ └─────┬─────┘
          │           │           │
          │     feedback?         │
          │      /    \           │
          │   thumbs  thumbs     │
          │    up      down      │
          │    │        │        │
          │    │   explanation?   │
          │    │   /        \    │
          │    │  yes        no  │
          │    │   │       count │
          │    │   ▼       >=2? │
          │    │  suppress  /  \ │
          │    │  (rule)  YES  NO│
          │    │           │    ││
          │    │           ▼    ││
          │    │      ┌────────┐││
          │    │      │excluded│││
          │    │      └────────┘││
          │    │                ││
          └────┴────────────────┘│
               │                 │
          code changes /         │
          doc changes /          │
          scheduled scan         │
               │                 │
               ▼                 │
          re-verification ───────┘
          (back to pending)
```

**Key transitions:**

| From | Event | To | Condition |
|------|-------|----|-----------|
| — | Claim extracted | `pending` | — |
| `pending` | Verification completes | `verified` / `drifted` / `uncertain` | Based on verdict |
| `drifted` | Thumbs-down + explanation | `suppressed` (via rule) | Quick-pick or free-text |
| `drifted` | 2× bare thumbs-down | `excluded` | Count-based permanent exclusion |
| `excluded` | Claim text changes (doc updated) | `pending` | Fresh extraction creates new claim |
| Any | Code/doc changes | `pending` | Re-verification triggered |
| Any | Scheduled scan | `pending` | Re-verification triggered |

### 8.3 Scan Run Lifecycle

```
              webhook received
                    │
                    ▼
              ┌─────────┐
              │ queued   │
              └────┬─────┘
                   │
              worker picks up
                   │
                   ▼
              ┌──────────┐
              │ running   │
              └────┬──────┘
                   │
              result?
           /    |      \       \
     completed partial failed  cancelled
         │        │      │        │
         ▼        ▼      ▼        ▼
   ┌──────────┐ ┌──────┐ ┌──────┐ ┌──────────┐
   │completed │ │partial│ │failed│ │cancelled │
   │          │ │       │ │      │ │(debounce)│
   └──────────┘ └──────┘ └──┬───┘ └──────────┘
                             │
                        retry (max 3)
                             │
                             ▼
                         ┌─────────┐
                         │ queued  │
                         └─────────┘
```

**Transitions:**

| From | Event | To | Action |
|------|-------|----|--------|
| — | Webhook enqueues job | `queued` | Create scan_run record |
| `queued` | Worker dequeues | `running` | Set started_at, create Check Run |
| `queued` | New push within 30s | `cancelled` | Job replaced by debounce |
| `running` | All layers complete | `completed` | Post PR comment, update Check Run |
| `running` | Timeout (10min server) | `partial` | Save completed results, post partial |
| `running` | Unrecoverable error | `failed` | Post error comment, update Check Run |
| `running` | Debounce (new push) | `cancelled` | Save completed work, exit |
| `failed` | Auto-retry | `queued` | Exponential backoff (1s, 4s, 16s) |

### 8.4 Agent Task Lifecycle

```
         server creates task
                │
                ▼
          ┌──────────┐
          │ pending   │
          └────┬──────┘
               │
          Action polls + claims
               │
               ▼
          ┌──────────────┐
          │ in_progress   │ (extends expires_at)
          └────┬──────────┘
               │
          result?
         /     |       \
     success  failure  timeout
        │       │         │
        ▼       ▼         ▼
  ┌──────────┐ ┌──────┐ ┌────────┐
  │completed │ │failed│ │expired │
  └──────────┘ └──────┘ └────────┘
                                │
                           claim → uncertain
                           (reason: agent_timeout)
```

**Transitions:**

| From | Event | To | Action |
|------|-------|----|--------|
| — | Server creates | `pending` | Set expires_at (default +30min) |
| `pending` | Action claims task | `in_progress` | Set claimed_by, extend expires_at |
| `in_progress` | Result submitted | `completed` | Validate result (Zod), store |
| `in_progress` | Agent error | `failed` | Log error, claim → uncertain |
| `pending`/`in_progress` | expires_at passed | `expired` | Claim → uncertain (reason: agent_timeout) |
| `expired` | Late result submitted | `expired` (rejected) | Return HTTP 410 Gone |
| `completed`/`expired` | 48h cleanup | (deleted) | Remove from table |

---

## 9. Security Model (Overview)

> Full threat model: `phases/phase3-security.md` (Phase 3E)

### 9.1 Authentication

| Actor | Authenticates Via | Scope |
|-------|------------------|-------|
| GitHub → DocAlign | Webhook signature (HMAC-SHA256 on `X-Hub-Signature-256`) | Per-webhook verification |
| DocAlign → GitHub | JWT (app private key, RS256) → Installation access token (1hr) | Per-installation API access |
| GitHub Action → DocAlign | DOCALIGN_TOKEN (API token, stored in repo secrets) | Per-repo task API access |
| DocAlign → PostgreSQL | DATABASE_URL connection string | Full database access |
| DocAlign → Redis | REDIS_URL connection string | Full Redis access |
| MCP Server → PostgreSQL (v2) | Database connection string | Read access |

### 9.2 Data Privacy Boundaries

```
┌──────────────────────────────────────────────────┐
│              CLIENT SIDE                          │
│  (code never leaves client infrastructure)        │
│                                                   │
│  GitHub repo files ──> GitHub Action ──> LLM API  │
│                                                   │
│  Code stays here. DocAlign never sees it.         │
└───────────────────────┬──────────────────────────┘
                        │ structured results only
                        │ (verdicts, reasoning, claim text)
                        ▼
┌──────────────────────────────────────────────────┐
│              DOCALIGN SERVER                      │
│  (sees only metadata + structured results)        │
│                                                   │
│  Never receives: source code, file contents,      │
│  API keys, secrets, raw diffs                     │
│                                                   │
│  Receives: claim text, verdicts, reasoning,       │
│  file paths, entity names, line numbers           │
└──────────────────────────────────────────────────┘
```

### 9.3 Secret Management

| Secret | Storage | Rotation |
|--------|---------|----------|
| `GITHUB_APP_ID` | Railway env var | Static (changes only if app recreated) |
| `GITHUB_PRIVATE_KEY` | Railway env var | See JWT rotation procedure (Phase 3E) |
| `GITHUB_WEBHOOK_SECRET` | Railway env var | Manual rotation with zero-downtime |
| `DATABASE_URL` | Railway env var | Managed by Supabase |
| `REDIS_URL` | Railway env var | Managed by provider |
| `DOCALIGN_API_SECRET` | Railway env var | Used for HMAC dismiss tokens only (not for DOCALIGN_TOKEN) |
| `DOCALIGN_TOKEN` (per-repo) | GitHub repo secrets | Random 256-bit token, 1 year default expiry, per-repo scoped |
| `ANTHROPIC_API_KEY` (client) | GitHub repo secrets | Client-managed, never seen by DocAlign |

---

## 10. Scalability Path

### 10.1 MVP Capacity Targets

| Resource | MVP Target | Bottleneck |
|----------|-----------|------------|
| Active repos | 50-100 | Per-repo serialization, DB connections |
| Claims per repo | 500 | Vector search performance |
| PRs per day (total) | 500 | Worker concurrency (5 jobs) |
| Concurrent scans | 5 (server) | BullMQ global concurrency |

### 10.2 Scaling Milestones

| Milestone | Trigger | Action |
|-----------|---------|--------|
| **5-10 customers** | PostgreSQL connection limits (100) | Increase pool size to 20 and add Supabase connection pooling via Supavisor (audit finding I2) |
| **20-30 customers** | tree-sitter memory (5 concurrent full scans > 512MB) | Memory monitoring per job, reduce full scan concurrency to 2, keep PR scan at 5 (audit finding I3) |
| **30-50 customers** | Per-repo queue serialization bottleneck | Evaluate per-org concurrency limits (N=5 repos in parallel) (audit finding I1) |
| **50-100 customers** | GitHub API rate limits (5000 req/hr) | Batch review comments in single API call, use GraphQL where possible, request higher limits (audit finding I6) |
| **100-500 customers** | Single worker process limit | Multi-worker deployment (horizontal scaling) |
| **1000+ customers** | Vector search across large tables | Partition `code_entities` and `claims` by `repo_id` (audit finding I8) |
| **5000+ customers** | `verification_results` table size | Partition by `created_at` (monthly), drop old partitions (audit finding I9) |

### 10.3 What We Intentionally Don't Build for MVP

- Multi-region deployment
- Read replicas
- CDN / caching layer
- Connection pooling (add at ~10 customers)
- Table partitioning (add at ~1000 customers)
- Custom rate limit tiers per customer

---

## 11. Integration Contracts (Summary)

> Full specification: `phases/phase3-integration-specs.md` (Phase 3B)

### 11.1 Repository Dispatch Event (audit finding A8)

**Event type:** `docalign-scan`

**Payload:**
```typescript
{
  repo_id: string;          // DocAlign's internal repo UUID
  scan_run_id: string;      // Scan run UUID for correlation
  scan_type: 'pr' | 'full' | 'push';
  trigger_ref: string;      // PR number or commit SHA
  task_ids: string[];       // Pre-created task IDs to execute
}
```

The Action receives this via `github.event.client_payload`, polls `GET /api/tasks/pending`, and executes each task.

### 11.2 Agent Task API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tasks/pending?repo_id={id}` | GET | List unclaimed tasks |
| `/api/tasks/{id}` | GET | Get full task details |
| `/api/tasks/{id}/result` | POST | Submit task result |

**Authentication:** `Authorization: Bearer {DOCALIGN_TOKEN}` header. Token is per-repo scoped.

**Result validation:** All results validated against strict Zod schema. Malformed → HTTP 400. Text fields (reasoning, suggested_fix, evidence_summary) sanitized to prevent injection in PR comments.

### 11.3 Sub-Claim Data Model (audit finding A9)

Sub-claims (from Spike A decomposition) are stored as **separate rows in the `claims` table** with `parent_claim_id` set. They are first-class claims with their own IDs, own mappings, own verification results, and own feedback. The parent claim's `extracted_value` JSONB contains `{ sub_claim_ids: string[] }` for navigation.

Code example sub-claims (from L1) use a different pattern: the parent claim's `extracted_value` contains `{ language, imports[], symbols[], commands[] }`. These are NOT separate DB rows — they are checked as part of the parent claim's Tier 1 verification (import path check, symbol existence check, syntax validation).

### 11.4 Claim Prioritization (audit finding A17)

When claims exceed `max_claims_per_pr` (default 50, hard cap 200):

```
Priority score = severity_weight × confidence

severity_weight: HIGH = 3, MEDIUM = 2, LOW = 1

Sort by priority score descending.
Ties broken by: file path (alphabetical), then line number (ascending).

Top N claims are verified. Remainder marked as "skipped" with reason "exceeded_claim_limit".
```

### 11.5 Path 1 Evidence Constraints (audit findings A22, A23)

- **Token cap:** `path1_max_evidence_tokens` config (default: 4000). Enforced SERVER-SIDE during routing (step 5e, before task creation). The server estimates token count from `code_entities` line counts + import line counts stored in the L0 index. If entity code + imports + type signatures exceeds this, route to Path 2 with reason `evidence_too_large`. The Action never needs to make this decision.
- **Type signature limit:** Cap at 3 type definitions or 100 lines total. Include only types directly referenced in the entity's signature, not transitive dependencies.

### 11.6 Agent Exploration Limit (audit finding A24)

- `max_agent_files_per_claim` config (default: 15). If agent exceeds, abort with verdict `uncertain` + reason "investigation too broad."
- Enforced by the Action, not the server (server can't observe agent's file reads).

### 11.7 Agent Unavailability Banner (audit finding A25)

- If >20% of claims were skipped due to agent unavailability: prominent banner at top of PR summary comment.
- If ≤20%: footer note only.

---

## 12. Audit Finding Resolution Matrix

Items from `phases/phase2.5-audit-findings.md` addressed in this document:

| ID | Finding | Resolution | Section |
|----|---------|------------|---------|
| A1 | Agent task polling collision | `claimed_by` column + atomic UPDATE | §6.3 |
| A2 | Agent task expiration race | Extend expires_at on claim | §6.3 |
| A3 | Rename detection in incremental index | `--name-status` + transaction | §6.3 |
| A5 | Uninstall during active scan | Cancel jobs before delete | §6.3 |
| A6 | Transaction boundaries | Per-batch transactions | §6.3 |
| A7 | BullMQ cancellation granularity | 4 stage boundaries defined | §6.1 |
| A8 | Repository dispatch payload | Schema defined | §11.1 |
| A9 | Sub-claim data model | Separate DB rows for Spike A; JSONB for code_example | §11.3 |
| A10 | Suppression rules in claim extraction | Filter before verification in scan flow | §7 step 5i |
| A12 | Deleted doc file cleanup | Detect in diff, delete claims | §7 step 5c |
| A17 | Claim prioritization formula | severity × confidence, descending | §11.4 |
| A22 | Path 1 evidence token cap | 4000 token default, overflow → Path 2 | §11.5 |
| A23 | Same-file type signature limit | 3 types or 100 lines | §11.5 |
| A24 | Agent file exploration limit | 15 files default, Action-enforced | §11.6 |
| A25 | Agent unavailable banner | >20% threshold | §11.7 |
| I1 | Per-repo queue scaling | Deferred, tracked in §10.2 | §10.2 |
| I2 | Connection pooling | Deferred to ~10 customers | §10.2 |
| I3 | tree-sitter memory | Deferred to ~20 customers | §10.2 |
| I5 | Agent task cleanup | Hourly for expired (48h), daily for completed (30d) | §5.4 |
| I7 | Redis rate limit optimization | Atomic INCR (not GET+SET) | §6.1 |
| I12 | Migration rollback scripts | Manual rollback alongside migrations | §5.3 |
| E3 | Force push during scan | SHA check before posting | §6.3 |
| E5 | Debounce cancellation vs failure | Cancellation ≠ failure, no retry | §6.1 |
| G6 | Embedding dimension change | Full re-index required | §5.2 |

**Deferred to Phase 3B-E:**

| ID | Finding | Deferred To |
|----|---------|------------|
| A4 | Co-change retention purge race | Phase 3C (error handling) |
| A13 | Agent result handling | Phase 3B (integration specs) |
| A14 | Entity line count for routing | Phase 3B (integration specs) |
| A15 | Dependency version lookup format | Phase 3B (integration specs) |
| A16 | MCP server database connection | Phase 3B (integration specs) |
| A18 | "Same claim" definition | Phase 3B (integration specs) |
| A19 | Version comparison edge cases | Phase 3B (integration specs) |
| A20 | Auto-detect failure behavior | Phase 3B (integration specs) |
| A21 | Monorepo version match order | Phase 3B (integration specs) |
| S1-S19 | Security findings | Phase 3E (security threat model) |
| E1-E5 | Error handling findings | Phase 3C (error handling) |
| I4, I6, I8-I14 | Remaining infra findings | Phase 3D (infrastructure) |
| G1-G8 | Integration findings | Phase 3B (integration specs) |

---

## 13. Coverage Matrix: User Stories → Components

| User Story | Components Involved | MVP? |
|-----------|-------------------|------|
| Install DocAlign GitHub App on repo | API Server (webhook handler), DB (repos table) | Yes |
| Set up GitHub Action with API key | GitHub Action, Agent Task API | Yes |
| Full onboarding scan on install | Worker, L0, L1, L2, L3, L5, GitHub Action | Yes |
| PR opened → drift findings posted | L4 (webhook), L0, L2, L3, L5, GitHub Action | Yes |
| Review comment with suggestion on specific line | L5 (PR comment formatter), GitHub API | Yes |
| Accept suggestion (one-click fix) | L5 (feedback detection), L7 (feedback recording) | Yes |
| Thumbs-down → explanation prompt | L5, L7 (quick-pick fast-path) | Yes |
| Count-based exclusion after 2 dismissals | L7 (count tracker, suppression rules) | Yes |
| GitHub Check Run shows scan status | L5, L4 (check run creation/update) | Yes |
| Zero findings → green check + brief comment | L5, L4 | Yes |
| Dismiss all findings on a PR | L5 (dismiss API endpoint) | Yes |
| Configure via `.docalign.yml` | Config validation, GitHub Action | Yes |
| CLI: `docalign check` / `docalign scan` | CLI, Agent Task API | v2 |
| MCP: `get_docs` / `get_doc_health` | MCP Server, DB | v2 |
| MCP: `report_drift` | MCP Server, L7, DB | v3 |
| Free-text feedback → agent interpretation | L7, GitHub Action (agent) | v2 |
| Static analysis rules (universal claims) | L2 Step 4, L3, DB | v2 |
| Scheduled full scans | L4 (scheduler), Worker, GitHub Action | v3 |
| Web dashboard (health scores, trends) | Dashboard app, DB | v3 |

**Orphaned stories:** None. All MVP stories map to at least one component.

---

## 14. Resolved Design Decisions

1. **Worker deployment:** Same Railway service for MVP. Split when we need >5 worker concurrency. ✅
2. **Redis provider:** Railway Redis addon for simplicity. Switch to Upstash if we need persistence guarantees. ✅
3. **GitHub Action marketplace:** Publish to Marketplace from day 1 for discoverability. ✅
4. **Embedding dimension:** Fixed 1536 (text-embedding-3-small). Re-index required on model change. Document the constraint. ✅

---

## 15. Cross-References

| Document | Purpose | Status |
|----------|---------|--------|
| `PRD.md` | Product requirements (WHAT to build) | Complete |
| `prd/L0-L7, infrastructure, cost-model` | Layer specifications | Complete |
| `phases/adr-agent-first-architecture.md` | Agent-first execution model | Complete |
| `phases/spike-a-vague-claim-mapping.md` | Universal + flow claim handling | Complete |
| `phases/spike-b-evidence-assembly.md` | Two-path evidence assembly | Complete |
| `phases/spike-c-learning-generalization.md` | Learning generalization | Complete |
| `phases/phase2.5-audit-findings.md` | Audit items for Phase 3 | Input (this phase) |
| `phases/phase3-integration-specs.md` | Integration details | Phase 3B (next) |
| `phases/phase3-error-handling.md` | Error taxonomy | Phase 3C (next) |
| `phases/phase3-infrastructure.md` | Deployment, CI/CD, monitoring | Phase 3D (next) |
| `phases/phase3-security.md` | Security threat model | Phase 3E (next) |
