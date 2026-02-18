# Product Requirements Document: DocAlign

> Documentation-Reality Alignment Engine
> Version: 0.2 (Discovery Draft)
> Date: 2026-02-10
> Status: Pre-implementation. Contains placeholder sections marked with ⚠️ where detailed solutions are not yet developed.

> Technical implementation details have been extracted to phases/technical-reference.md. Layer specifications, infrastructure, and cost model have been extracted to dedicated files under `prd/` for agent navigability.

> **Changelog:**
> - 2026-02-11: Phase 6 PRD Reconciliation. Applied GATE42 decisions to Section 15 (MVP Scope). Key changes: (1) CLI promoted to MVP (GATE42-012), (2) review comments deferred to v2 (GATE42-016), (3) manual trigger model `@docalign review` (GATE42-009), (4) fix-commit flow added to MVP (GATE42-019/025/029), (5) StorageAdapter + SQLite adapter (GATE42-014), (6) Tier 2 framework shell clarified (TDD3-001), (7) co-change/decay/expiration deferred to v2, (8) MCP 5th tool `get_docs_for_file`, (9) Surfaces table updated.
> - 2026-02-11: Phase 2.5 PRD Reconciliation. Applied 28 changes from spikes A-C + ADR. Key structural changes: (1) all-client-side compute model — DocAlign server makes zero LLM calls, (2) two-path evidence assembly replaces token-budget model, (3) Tier 3 triage gate removed, (4) learning system solved — quick-pick + count-based permanent exclusion in MVP, agent-interpreted free-text in v2, (5) two tiers (Free/Pro), feature-differentiated, (6) onboarding requires Action setup, (7) Step 4 mapper solved by Spike A (v2), (8) new data models: agent_tasks, suppression_rules, static_analysis_rules. See `phases/phase2.5-prd-reconciliation.md`.
> - 2026-02-10: Restructured PRD for agent navigability. Extracted layer specs (L0-L7), infrastructure, and cost model to `prd/`. Added LLM model configurability policy.
> - 2026-02-09: Phase 1 final pass. Applied 3 founder decisions (broad framework support, union doc discovery, dismiss-all API). Applied 17 technical defaults (version comparison, similar paths, mapper threshold, evidence defaults, logging, chunking, rate limits, HNSW indexes, migrations, etc.). Added 22 MINOR requirement one-liners. Fixed 4 PRODUCT-VISION.md inconsistencies.
> - 2026-02-09: Phase 1 hardening. Resolved 14 BLOCKING findings. Added: onboarding flow, PR output strategy (hybrid), error handling, authentication, webhook security, code_example verification, evidence assembly rules, debounce/concurrency/idempotency specs, GitHub Checks, all-branch scanning. Updated: MCP to PostgreSQL, code indexing to auto-detect, uncertain verdict handling. Deferred: cost model and pricing to GTM.

---

## Document Map

| Document | Content |
|----------|---------|
| **PRD.md** (this file) | Product overview, architecture, onboarding, data models, MVP scope, experiments, configuration, glossary |
| [prd/L0-codebase-index.md](prd/L0-codebase-index.md) | Layer 0: Codebase Index — AST parsing, entity indexing, embeddings, incremental updates |
| [prd/L1-claim-extractor.md](prd/L1-claim-extractor.md) | Layer 1: Claim Extractor — doc parsing, claim taxonomy, syntactic + semantic extraction |
| [prd/L2-code-claim-mapper.md](prd/L2-code-claim-mapper.md) | Layer 2: Code-to-Claim Mapper — progressive mapping strategy, reverse index |
| [prd/L3-verification-engine.md](prd/L3-verification-engine.md) | Layer 3: Verification Engine — 4-tier pipeline (Tier 3 removed), two-path evidence assembly |
| [prd/L4-change-scanning.md](prd/L4-change-scanning.md) | Layer 4: Change-Triggered Scanning — triggers, scope controls, safeguards, error handling |
| [prd/L5-report-fix.md](prd/L5-report-fix.md) | Layer 5: Report & Fix Generation — PR output, review comments, health score, GitHub Checks |
| [prd/L6-mcp-server.md](prd/L6-mcp-server.md) | Layer 6: MCP Server — tools, architecture, local/remote modes |
| [prd/L7-learning-system.md](prd/L7-learning-system.md) | Layer 7: Learning System — feedback signals, co-change, confidence decay, generalization |
| [prd/infrastructure-deployment.md](prd/infrastructure-deployment.md) | Infrastructure & Deployment — GitHub App setup, auth, processing, scaling, uninstall |
| [prd/cost-model.md](prd/cost-model.md) | Cost Model — server costs (fixed), client costs (all LLM), pricing tiers |
| [phases/technical-reference.md](phases/technical-reference.md) | Technical implementation details — interfaces, SQL schemas, regex, tree-sitter queries, LLM prompts |

---

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

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [System Architecture](#2-system-architecture)
3. [Onboarding Flow](#3-onboarding-flow)
4. [Layer 0: Codebase Index](prd/L0-codebase-index.md)
5. [Layer 1: Claim Extractor](prd/L1-claim-extractor.md)
6. [Layer 2: Code-to-Claim Mapper](prd/L2-code-claim-mapper.md)
7. [Layer 3: Verification Engine](prd/L3-verification-engine.md)
8. [Layer 4: Change-Triggered Scanning](prd/L4-change-scanning.md)
9. [Layer 5: Report & Fix Generation](prd/L5-report-fix.md)
10. [Layer 6: MCP Server](prd/L6-mcp-server.md)
11. [Layer 7: Learning System](prd/L7-learning-system.md)
12. [Data Models](#12-data-models)
13. [Infrastructure & Deployment](prd/infrastructure-deployment.md)
14. [Cost Model](prd/cost-model.md)
15. [MVP Scope & Phasing](#15-mvp-scope--phasing)
16. [Experiment Plan](#16-experiment-plan)

---

## 1. Product Overview

### 1.1 Problem

Documentation in software repositories makes factual claims about the code: file paths, dependency versions, CLI commands, API routes, behavioral descriptions, architecture patterns. These claims drift as code evolves. No tool detects this drift at the semantic level.

AI coding agents (Claude Code, Cursor, Copilot, Codex) treat repository documentation as ground truth. Stale documentation causes agents to generate wrong code, wasting developer time.

### 1.2 Product

DocAlign is a system that:
1. Extracts factual claims from documentation files
2. Automatically maps each claim to the code that would prove or disprove it
3. Verifies each claim against the current code state
4. Alerts developers to drift on PRs and in CI
5. Suggests targeted fixes
6. Serves verified documentation to AI coding agents via MCP

<!-- docalign:skip reason="capability_description" description="Surfaces table listing product surfaces (GitHub App, CLI, MCP Server, Web Dashboard) with version priorities — product capability overview, not falsifiable code claims" -->
### 1.3 Surfaces

| Surface | Description | Priority |
|---------|-------------|----------|
| GitHub App | Runs on PRs. Posts drift findings as comments. | MVP |
| CLI | `docalign check` / `docalign scan` / `docalign fix` for local use. | MVP |
| MCP Server | AI agents query verified docs and report drift. | v2 |
| Web Dashboard | Repo health scores, trends, hotspot visualization. | v3 |

<!-- /docalign:skip -->
### 1.4 Target User

Primary: Individual developers who use AI coding agents on repos with documentation.
Adoption: Bottom-up. Developer installs, sees value, brings to team.
Not targeting: Technical writers, VP Engineering, compliance buyers (yet).

### 1.5 Constraints

- Solo founder (PM + engineering background)
- $20-100K runway
- No enterprise sales motion
- Bottom-up distribution only
- MVP must ship in 2-4 weeks

---

## 2. System Architecture

<!-- docalign:skip reason="illustrative_example" description="ASCII architecture diagram showing hypothetical flow between layers — illustrative system diagram, not factual claims about implementation" -->
### 2.1 High-Level Flow

```
Documentation Files          Codebase
      |                          |
      v                          v
+--------------+          +--------------+
| Layer 1:     |          | Layer 0:     |
| Claim        |          | Codebase     |
| Extractor    |          | Index        |
+--------------+          +--------------+
       |                        |
       |    +---------------+   |
       +---->  Layer 2:     <---+
            | Code-to-Claim |
            | Mapper        |
            +-------+-------+
                    |
                    v
            +--------------+
            | Layer 3:     |
            | Verification |
            | Engine       |
            +-------+------+
                    |
       +------------+------------+
       v            v            v
+----------+ +----------+ +----------+
| Layer 5: | | Layer 6: | | Layer 7: |
| Reports  | | MCP      | | Learning |
| & Fixes  | | Server   | | System   |
+----------+ +----------+ +----------+

Layer 4 (Change Triggers) orchestrates WHEN Layers 1-3 run.
```

**Execution model (ADR: Agent-First Architecture):**
DocAlign uses a split execution model. ALL LLM calls run on the client. DocAlign never sees client code.

- **DocAlign server (orchestration):** Webhook handling, job queue, database, mapper Steps 1-3 (lookups against index), static rule evaluation, Tiers 1-2 deterministic verification, count-based exclusion, PR comment formatting.
- **Client's GitHub Action:** ALL LLM tasks — claim extraction, Path 1 verification (direct LLM call), Path 2 verification (agent-delegated), embedding generation, fix generation, feedback interpretation. Uses client's own API key.

DocAlign orchestrates WHAT to verify and WHEN. The client's Action/agent decides HOW.
See `phases/adr-agent-first-architecture.md` for full specification.

<!-- /docalign:skip -->
### 2.2 Data Flow (PR Trigger)

1. GitHub webhook fires: `@docalign review` comment on a PR (GATE42-009) or PR opened/updated (v2)
2. Layer 4 extracts changed files from PR diff
3. Layer 0 updates the codebase index for changed code files (server-side, deterministic)
4. Server creates agent tasks for LLM work: claim extraction (if docs changed), verification (Path 1 + Path 2), fix generation
5. Server triggers client's GitHub Action via repository dispatch
6. Action runs: direct LLM calls for Path 1, agent for Path 2, submits results to DocAlign API
7. Layer 2 queries reverse index for affected claims (server-side)
8. Layer 3 applies deterministic checks (Tiers 1-2, server-side), merges with agent verification results
9. Layer 5 formats findings into PR comment (server-side)
10. Layer 7 records the interaction for future learning (server-side)

> Technical detail: see phases/technical-reference.md Section 1 (Tech Stack) and Section 2 (Repository Structure)

---

## 3. Onboarding Flow

### 3.1 Purpose

Define what happens when a user installs the DocAlign GitHub App on a repository (or organization). The onboarding flow is the user's first experience and the AHA moment -- they must see value (a full drift report) before ever opening a PR.

### 3.2 Installation Webhook Handler

On receiving the `installation.created` webhook:

1. **For each repository in the installation:**
   a. Create a `repos` record with GitHub installation ID, owner, repo name, default branch, and status = `onboarding`.
   b. Queue a **full scan job** for the repo with priority `high`.

2. **Org-wide installs:** When the app is installed on an entire org (multiple repos), create repo records and queue full scan jobs for each repo. Jobs are processed sequentially per the per-repo lock (see Section 8.4). Rate limit: max 10 concurrent full scan jobs across all repos in an installation event.

3. **`installation_repositories` events:** When repos are added to or removed from an existing installation, create/delete repo records accordingly and queue/cancel full scan jobs.

### 3.2.1 Prerequisites

The GitHub Action (`docalign/agent-action`) MUST be configured in the repository before the full scan can run. The Action handles all LLM tasks (claim extraction, verification, embeddings, auto-detect). Without it, DocAlign can only receive webhooks — no scanning, no claims, no AHA moment.

**Setup flow:**
1. User installs the DocAlign GitHub App
2. DocAlign detects no Action is configured → posts a GitHub Check with instructions: "Set up the DocAlign Action to enable scanning. See docs.docalign.dev/setup"
3. User adds the Action workflow file + API key to repo secrets
4. Action's first run triggers the full onboarding scan

### 3.3 Full Scan Job (Initial)

The full scan is the system's first pass on a new repo. It builds everything from scratch:

The full scan is orchestrated by the DocAlign server but LLM work executes in the client's GitHub Action:

1. **Server: Queue full scan job** for the repo.
2. **Server: Trigger client's GitHub Action** via repository dispatch.
3. **Action: Clone** the repo (shallow clone `git clone --depth 1`) to a temp directory.
4. **Action: Auto-detect project structure** using the client's LLM with the repo's file tree (see Appendix A, `code_patterns.include`). Submit detected patterns to DocAlign API.
5. **Server: Build L0 codebase index** — parse all source files with tree-sitter, extract entities, index the file tree (deterministic, no LLM).
6. **Action: Generate embeddings** for all code entities and claims (client's API key).
7. **Action: Extract ALL claims (L1)** — scan all documentation files. During full scans, the Action runs both syntactic (deterministic) and semantic (LLM) extraction since it has the cloned repo. Submit claims to DocAlign API. (During PR scans, syntactic extraction runs server-side via GitHub API; only semantic extraction is delegated to the Action.)
8. **Server: Create ALL mappings (L2)** — map every extracted claim to code evidence using Steps 1-3 of the mapper (deterministic lookups). Requires Steps 6-7 to complete first (embeddings and claims must be in the database for semantic search in mapper Step 3).
9. **Server + Action: Run verification (L3)** — Tiers 1-2 server-side (deterministic). Tier 4 Path 1 + Path 2 client-side (Action/agent). Results submitted to DocAlign API.
10. **Server: Compute health score**, cache the repo-wide health score, set repo status = `active`.
11. **Action: Cleanup** — delete the temp clone directory.

### 3.4 Timeout and Cost Budget

- **Timeout:** 15 minutes for the full initial scan job. If exceeded, save partial results (all completed layers), set repo status = `partial`, and log the timeout. Partial repos are usable -- PR scans will work with whatever index and claims exist. A follow-up full scan can be retried manually or on the next scheduled scan.
- **Cost for initial scan:** All LLM costs are borne by the client (their API key). DocAlign's cost is zero (server-side work is deterministic only). Typical client cost for initial scan:
  - Small repo (~50 claims): ~$0.50-2.00
  - Medium repo (~200 claims): ~$2.00-8.00
  - Large repo (~500+ claims): ~$5.00-20.00

### 3.5 Progress Indication

- On scan start: create a GitHub Check Run on the default branch's HEAD commit with status `in_progress`, title "DocAlign: Initial scan in progress".
- On scan completion: update the Check Run to `completed` with conclusion `success` and a summary: "DocAlign scanned N documentation files, found M claims, verified K. Health score: X%. N findings detected."
- On scan failure/timeout: update the Check Run to `completed` with conclusion `failure` and the error description.

### 3.6 Failure Behavior

- If the full scan fails (LLM API error, clone failure, timeout): set repo status = `error`, log the error, schedule an automatic retry in 10 minutes (max 3 retries).
- If all retries fail: set repo status = `error`. The repo remains in this state until a PR triggers a scan (which will attempt to bootstrap from scratch) or the user triggers a manual re-scan.
- A repo in `error` status still processes PR webhooks -- the PR scan will attempt to build the index and extract claims for the changed files, operating in a degraded mode.

### 3.7 Bootstrapping Guarantee

The full scan on install resolves the first-PR bootstrapping problem. By the time a user opens their first PR, the codebase index, claim database, and mappings already exist. The PR scan uses the reverse index as designed in Section 8.2.

If a PR arrives before the initial scan completes (race condition): queue the PR scan job behind the full scan job using the per-repo lock (Section 8.4). The PR scan will wait for the full scan to finish, then proceed normally.

---

## 4. Layer 0: Codebase Index

> **→ [Full specification: prd/L0-codebase-index.md](prd/L0-codebase-index.md)**
>
> Build a lightweight, doc-optimized representation of the codebase. Supports file existence checks, symbol lookup, semantic search, dependency version lookup, command/script lookup, and route lookup. AST parsing via tree-sitter for TS/JS/Python.

---

## 5. Layer 1: Claim Extractor

> **→ [Full specification: prd/L1-claim-extractor.md](prd/L1-claim-extractor.md)**
>
> Parse documentation files and decompose them into individual, verifiable claims. 10 claim types. Syntactic extraction (regex/heuristic) + semantic extraction (LLM). Code example sub-claim decomposition.

---

## 6. Layer 2: Code-to-Claim Mapper

> **→ [Full specification: prd/L2-code-claim-mapper.md](prd/L2-code-claim-mapper.md)**
>
> For each claim, identify which code files contain evidence to verify or disprove it. 4-step progressive mapping (direct reference → symbol search → semantic search → LLM-assisted). Reverse index for change-triggered scanning.

---

## 7. Layer 3: Verification Engine

> **→ [Full specification: prd/L3-verification-engine.md](prd/L3-verification-engine.md)**
>
> 4-tier pipeline (syntactic → pattern → semantic verification → post-check). Tier 3 triage gate removed (ADR). Semantic verification uses two paths: Path 1 (entity extraction + focused LLM) for simple claims, Path 2 (agent-delegated) for complex claims. All verification runs client-side. Evidence assembly rules. Produces verdict, severity, reasoning, and suggested fix.

---

## 8. Layer 4: Change-Triggered Scanning

> **→ [Full specification: prd/L4-change-scanning.md](prd/L4-change-scanning.md)**
>
> Orchestrate WHEN to run verification and WHICH claims to verify. PR trigger (MVP), push trigger, scheduled scans, CLI, MCP drift reports. Debounce, per-repo lock, idempotency, error handling.

---

## 9. Layer 5: Report & Fix Generation

> **→ [Full specification: prd/L5-report-fix.md](prd/L5-report-fix.md)**
>
> Present findings in actionable format. Summary PR comment with health score and findings (review comments deferred to v2 per GATE42-016). "Apply all fixes" link (GATE42-019). GitHub Checks. Feedback collection via reactions.

---

## 10. Layer 6: MCP Server

> **→ [Full specification: prd/L6-mcp-server.md](prd/L6-mcp-server.md)**
>
> Serve verified documentation to AI coding agents. 5 tools: get_docs, get_docs_for_file, get_doc_health, list_stale_docs, report_drift. Reads from PostgreSQL. Local and remote modes.

---

## 11. Layer 7: Learning System

> **→ [Full specification: prd/L7-learning-system.md](prd/L7-learning-system.md)**
>
> Improve verification accuracy over time. 4 signal types: developer feedback, co-change patterns, agent drift reports, confidence decay. Learning generalization solved (Spike C): explanation-driven + count-based permanent exclusion (MVP) + agent-interpreted free-text (v2).

---

## 12. Data Models

<!-- docalign:skip reason="illustrative_example" description="ASCII database schema diagram showing table hierarchy — visual illustration of schema structure" -->
### 12.1 Database Schema Overview

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

<!-- /docalign:skip -->
### 12.2 Entity Descriptions

**repos:** Repository metadata, GitHub installation info, cached health score, last indexed commit, configuration.

**code_entities:** Indexed code entities (functions, classes, routes, types, configs) with file path, line number, name, signature, embedding vector, and raw code for verification context.

**claims:** Extracted documentation claims with source file, line number, claim text, type, testability, structured extracted value, keywords, confidence, verification status, and embedding vector.

**claim_mappings:** Links between claims and code files/entities. Stores confidence, mapping method, and validation timestamp. Critical reverse index: given a code file, which claims map to it?

**verification_results:** Results of each verification run. Stores verdict, confidence, tier, severity, reasoning, mismatch details, suggested fix, evidence files, cost, and duration.

**feedback:** Developer feedback records (thumbs up/down, fix accepted/dismissed, all dismissed) linked to claims and verification results.

**co_changes:** Records of code files and doc files that changed together in commits. Used to boost mapping confidence.

**scan_runs:** Metadata about each scan run (trigger type, status, claim counts, cost, duration).

**agent_drift_reports:** Drift reports submitted by AI agents via MCP, linked to claims when possible.

**agent_tasks:** Pending, in-progress, completed, or expired tasks for the client's agent. Stores task type, payload, result, metadata (duration, cost, model used), status, and timestamps. See ADR Section 4.

**suppression_rules:** Learning-system-generated rules that suppress specific findings. Stores scope (claim, claim_type, file, extraction), origin (quick_pick, agent, count_based, developer_explicit), expiration, spot-check tracking, revocation signals. See Spike C.

**static_analysis_rules (v2):** LLM-generated or user-defined rules for verifying universal/quantified claims deterministically. Stores claim_id, scope glob, scope exclusions, checks array (import checks, pattern checks, AST checks), source, and generation cost. See Spike A.

**Data retention policy:** verification_results -- keep last 10 per claim, purge older results weekly. scan_runs -- archive (delete) after 90 days. feedback -- keep indefinitely. co_changes -- keep 6 months (180 days, purged weekly). agent_tasks -- archive completed tasks after 30 days. suppression_rules -- keep indefinitely (subject to expiration and revocation).

### 12.3 Key Indexes

- Code entities: indexed by (repo_id, file_path), (repo_id, name), and vector similarity on embedding
- Claims: indexed by repo_id, (repo_id, source_file), (repo_id, verification_status), and vector similarity on embedding
- Claim mappings: indexed by (repo_id, code_file) for the reverse lookup, and by claim_id
- Verification results: indexed by claim_id and scan_run_id
- Feedback: indexed by claim_id and repo_id

> Technical detail: see phases/technical-reference.md Section 4 (all SQL CREATE TABLE statements with full column definitions and indexes)

---

## 13. Infrastructure & Deployment

> **→ [Full specification: prd/infrastructure-deployment.md](prd/infrastructure-deployment.md)**
>
> GitHub App setup (permissions, webhooks, auth, tokens). Processing architecture (BullMQ job queue, 5 concurrent jobs). File access strategy. Scaling considerations. Uninstall behavior. API endpoints. Logging. Rate limits. Database migrations.

---

## 14. Cost Model

> **→ [Full specification: prd/cost-model.md](prd/cost-model.md)**
>
> DocAlign server costs (fixed infrastructure, zero LLM), client costs (all LLM via their API key), pricing tiers (Free/Pro, feature-based). Pricing decisions deferred to GTM.

---

## 15. MVP Scope & Phasing

### 15.1 MVP (Weeks 1-4)

**In scope:**
- GitHub App installation and webhook handling
- All-client-side execution model: Agent Task API, repository dispatch triggering, `docalign/agent-action` GitHub Action
- Onboarding requires Action setup before full scan (Section 3.2.1)
- Onboarding flow: full scan on install (Section 3), auto-detect project structure via client's LLM
- Two tiers: Free and Pro (same execution model, Pro adds features)
- Layer 0: Codebase index (tree-sitter for TS/JS/Python only, package.json parsing, file tree)
- Layer 1: Syntactic claim extraction (regex/heuristic for paths, commands, versions, routes, code_example sub-claims)
- Layer 1: Semantic claim extraction runs in client's GitHub Action
- Layer 1: `code_example` extraction with sub-claim decomposition (import paths, function/class names, syntax validation)
- Layer 2: Direct reference mapping (Steps 1-2 only)
- Layer 2: Basic semantic search mapping (Step 3, embedding similarity)
- Layer 3: Tier 1 syntactic verification (deterministic), including code_example sub-claim checks
- Layer 3: Tier 3 removed. Semantic verification via two paths: Path 1 (entity extraction + direct LLM call in Action) and Path 2 (agent-delegated for complex claims). All runs client-side.
- Two-path evidence assembly: Path 1 (direct LLM in Action) + Path 2 (agent-delegated)
- Agent adapter: Claude Code + custom-command
- Layer 4: Manual trigger model — `@docalign review` comment on PR (GATE42-009). No automatic PR webhook trigger in MVP.
- Layer 5: Summary comment only (review comments deferred to post-MVP per GATE42-016)
- Layer 5: "Apply all fixes" link in summary comment for user-initiated fix-commit (GATE42-019). GET→confirmation page→POST flow (GATE42-029). HMAC-only auth (GATE42-025). Conditional on >=1 generated fix (GATE42-036).
- Layer 5: Feedback collection includes explanation prompt (quick-picks) after thumbs-down
- Layer 5: GitHub Checks integration (in_progress, success, action_required, failure statuses)
- Layer 5: Zero-findings behavior (green check + brief summary comment)
- Layer 5: Uncertain verdict display (UNCERTAIN badge, no suggestions)
- Layer 5: Health score: verified / (verified + drifted), zero-denominator → "Scanning..." (GATE42-032). Scope is scan-run count (GATE42-035).
- Layer 7: feedback recording + quick-pick fast-path + count-based permanent exclusion in MVP. Agent-interpreted free-text and safety valves in v2.
- Error handling: error comments on PR for scan failures, partial result preservation
- Safeguards: debounce (30s), per-repo lock (BullMQ concurrency 1), idempotency (webhook delivery ID)
- Authentication: JWT + installation tokens, webhook signature verification
- StorageAdapter interface: abstract data access behind an interface; PostgreSQL adapter primary (GATE42-014)
- CLI: `docalign check` (deterministic-only), `docalign scan` (full pipeline), `docalign fix` (apply fixes locally). SQLite adapter for local use. (GATE42-012, GATE42-030)
- Uninstall: hard delete all data on `installation.deleted`
- Database: PostgreSQL on Supabase (server), SQLite via better-sqlite3 (CLI)
- Hosting: Railway

**Not in scope for MVP:**
- Layer 2 Step 4 (LLM-assisted mapping for vague claims — solved by Spike A, implement in v2)
- Layer 3 Tier 2 full strategies (framework shell with conservative fallthrough is in MVP per TDD3-001; most strategies return null)
- Layer 3 Tier 3 (triage gate removed by ADR — agent-first architecture makes it unnecessary)
- Layer 3 Tier 5 (post-check verification scripts)
- Layer 4: push trigger, scheduled scans
- Layer 5: review comments with inline suggestions (summary comment only per GATE42-016)
- Layer 5: auto-fix commits (automatic, no user action; user-initiated fix-commit IS in MVP per GATE42-019), health dashboard
- Layer 6: MCP server
- Layer 7: co-change tracking, confidence decay, suppression expiration (deferred to v2)
- Languages beyond TS/JS/Python
- GitLab/Bitbucket support

### 15.2 v2 (Weeks 5-8)

**Add:**
- Step 4 mapping: static analysis rules (universal claims) + claim decomposition (flow claims) — see Spike A
- Learning system v2: agent-interpreted free-text, safety valves (spot-checks, expiration, revocation), rule management UI, co-change tracking, confidence decay
- Post-check verification scripts (Tier 5) -- false positive reduction
- Tier 2 full pattern strategies (readFile API for L0, framework-specific checks)
- Review comments with inline suggestions on specific lines (GATE42-016)
- MCP server (read-only: `get_docs`, `get_docs_for_file`, `get_doc_health`, `list_stale_docs`) -- reads from PostgreSQL
- Auto-fix commit option (automatic, no user confirmation)
- Push-to-default-branch trigger (keeps claim database current)
- Go and Rust language support

### 15.3 v3 (Weeks 9-16)

**Add:**
- Full MCP (bidirectional: add `report_drift` tool)
- Scheduled full-repo scans
- Web dashboard with health scores and trends
- Multi-repo support
- Java language support
- GitLab support

### 15.4 v4+ (Weeks 16+)

**Add:**
- Document testing (Kang et al. pattern)
- IDE integration (inline health indicators)
- Team learnings (org-level patterns)
- Bitbucket support
- Custom verification rules
- API for custom integrations

---

## 16. Experiment Plan

<!-- docalign:skip reason="capability_description" description="Experiment plan sections (16.1–16.5) describing validation methods using external open-source repos as examples — methodology descriptions, not claims about this codebase" -->
### 16.1 Experiment: Semantic Claim Extraction Quality

**Goal:** Validate that LLMs can reliably extract testable claims from unstructured documentation.

**Method:**
1. Select 20 diverse README/doc files from popular open-source repos (Next.js, Fastify, Prisma, Django, Flask, Rust CLI tools, Go services)
2. Run the extraction prompt on each file
3. Manually label each extracted claim: "genuinely testable" / "vague/untestable" / "duplicate" / "missed obvious claim"
4. Calculate:
   - Precision = correct verifiable claims / total extracted claims (excludes duplicates from the count). Over-extraction = non-verifiable output items / total output items. These measure different aspects: precision measures quality, over-extraction measures noise.
   - Recall: what % of claims a human would identify were extracted?

**Success criteria:**
- Precision >= 70% (less than 30% noise)
- Recall >= 50% (catches at least half of real claims)
- Over-extraction < 20% of total output

**If criteria not met:**
- Iterate on prompt (add examples, tighten filtering instructions)
- Try different models (Claude Haiku, Gemini Flash)
- Consider two-pass: extract broadly, then filter with a second prompt
- Worst case: limit to syntactic extraction only in v1

### 16.2 Experiment: Mapping Accuracy

**Goal:** Validate that automatic mapping correctly identifies evidence files for claims.

**Method:**
1. Take the same 20 repos from Experiment 16.1
2. For each extracted claim, run the mapping pipeline (Steps 1-3)
3. Manually label: did the mapper find the correct evidence file(s)?
4. Calculate:
   - Mapping rate: what % of claims got at least one mapping?
   - Mapping accuracy: of mapped claims, what % mapped to the correct file?
   - Fallthrough rate: what % of claims reach Step 4 (unmappable)?

**Success criteria:**
- Mapping rate >= 70% (most claims get mapped)
- Mapping accuracy >= 80% (most mappings are correct)
- Fallthrough rate <= 20%

**If criteria not met:**
- Tune embedding similarity threshold
- Add more heuristics to Step 1 (e.g., parse markdown link targets)
- Expand symbol search to include fuzzy matching
- Accept lower mapping rate and focus on high-confidence mappings only

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

### 16.5 Experiment: End-to-End Accuracy (Public Repo Benchmark)

**Goal:** Measure the full pipeline's accuracy on real repos before public launch.

**Method:**
1. Select 10 popular repos with known documentation issues (search GitHub issues for "outdated docs", "stale README", "wrong instructions")
2. Run full scan on each repo
3. For each finding: is it a real documentation issue?
4. For each known issue: did the tool catch it?

**Success criteria:**
- Precision >= 60% (at most 40% false positives)
- Recall >= 40% (catches at least 40% of real issues)
- No finding flags a claim type that doesn't match the actual content (e.g., flagging a code example as a missing file path, or flagging a heading as a dependency version)

**This experiment should run before inviting beta users. Findings below criteria = iterate on pipeline before launch.**

---

<!-- /docalign:skip -->
## Appendix A: Configuration Options

Users can configure DocAlign behavior via `.docalign.yml` in the repo root.

**Available settings:**

| Category | Setting | Description | Default |
|----------|---------|-------------|---------|
| Doc patterns | `doc_patterns.include` | Glob patterns for documentation files to scan | The DOC_PATTERNS list from technical-reference.md Section 3.2. This is the canonical list. |
| Doc patterns | `doc_patterns.exclude` | Glob patterns for documentation files to skip | Changelogs, archives |
| Code patterns | `code_patterns.include` | Glob patterns for code files to index. If specified, overrides auto-detection. | Auto-detected via LLM on initial scan (see Section 3.3). Fallback if auto-detection fails: `**` with standard excludes. |
| Code patterns | `code_patterns.exclude` | Glob patterns for code files to skip | `node_modules/**, .git/**, dist/**, build/**, vendor/**, __pycache__/**, *.min.js` |
| Verification | `verification.min_severity` | Minimum severity to report in PR comments | "medium" |
| Verification | `verification.max_claims_per_pr` | Max claims to check per PR (cost control) | 50 |
| Verification | `verification.auto_fix` | Auto-commit fixes to PR branch | false |
| Verification | `verification.auto_fix_threshold` | Confidence threshold for auto-fix | 0.9 |
| Claim types | `claim_types.<type>` | Enable/disable specific claim types | All enabled |
| Suppression | `suppress` | Custom rules to suppress specific claims | None |
| Mapping | `mapping_threshold` | Semantic search similarity threshold for claim mapping | 0.7 |
| Check | `check.conclusion_on_findings` | GitHub Check conclusion when findings exist (`action_required` or `neutral`) | "action_required" |
| Check | `check.min_severity_to_block` | Minimum finding severity to trigger `action_required` conclusion | "high" |
| Scheduling | `schedule.full_scan` | Frequency of full repo scans | "weekly" |
| Scheduling | `schedule.full_scan_day` | Day of week for scheduled scans | "sunday" |
| Agent | `agent.adapter` | Agent adapter type for Path 2 tasks | "claude-code" |
| Agent | `agent.max_claims_per_pr` | Max claims to delegate to agent per PR | 20 |
| Agent | `agent.fallback` | What to do when agent unavailable | "skip" |
| Agent | `agent.concurrency` | Max parallel agent tasks | 5 |
| Client LLM | `llm.verification_model` | Model for Path 1 verification (client-side) | "claude-sonnet" |
| Client LLM | `llm.extraction_model` | Model for semantic claim extraction (client-side) | "claude-sonnet" |
| Client LLM | `llm.embedding_model` | Embedding model (client-side) | "openai/text-embedding-3-small" |
| Client LLM | `llm.embedding_dimensions` | Embedding vector dimensions | 1536 |

These settings are read by the GitHub Action, not by DocAlign's server.

**Suppression rule matching:** `pattern` field is a regex applied to `claim_text`. `claim_type` field is an exact match on the claim's type. `package` field is an exact match on `extracted_value.package` (for dependency_version claims only). All conditions in a rule must match (AND logic).

**Configuration validation:** Validate .docalign.yml with Zod schema. On invalid YAML syntax: fall back to all defaults, log warning. On schema validation errors (invalid values): use defaults for invalid fields, keep valid fields, log warning per invalid field. Never fail a scan due to config errors.

> Technical detail: see phases/technical-reference.md Section 9 (full YAML configuration schema with examples)

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Claim** | A factual assertion in a documentation file about the codebase (e.g., "uses bcrypt", "see config/default.yaml") |
| **Mapping** | A link between a claim and the code file(s)/entity(ies) that serve as evidence for verifying that claim |
| **Drift** | When a documentation claim no longer matches the current code reality |
| **Verification** | The process of checking a claim against its mapped code evidence |
| **Triage** | *(Removed in ADR)* Was a cheap LLM classification step. Replaced by all-client-side two-path model. |
| **Health Score** | Percentage of claims in a file/repo that are verified as accurate |
| **VerificationResult** | The output of Layer 3 for a single claim (any verdict: verified, drifted, or uncertain) |
| **Finding** | A VerificationResult where verdict is "drifted" or "uncertain". Use "finding" in all user-facing contexts. |
| **Evidence** | The code file(s) and content used to verify a claim |
| **Syntactic claim** | A claim verifiable by deterministic lookup (file path, command, version) |
| **Semantic claim** | A claim requiring LLM-based reasoning to verify (behavior, architecture) |
