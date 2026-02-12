> Part of [DocAlign PRD](../PRD.md)

## 13. Infrastructure & Deployment

### 13.1 GitHub App Setup

**App permissions required:**
- `contents: read` -- read repo files
- `pull_requests: write` -- post PR comments and review comments
- `metadata: read` -- repo metadata
- `checks: write` -- create check runs for scan status (REQUIRED, not optional)

**Webhook events:**
- `pull_request` (opened, synchronize, closed)
- `push` (to default branch)
- `installation` (created, deleted)
- `installation_repositories` (added, removed)

**Webhook security:** All incoming webhooks MUST verify the `X-Hub-Signature-256` header using the app's webhook secret. Requests with missing or invalid signatures must be rejected with HTTP 401. This prevents spoofed webhook payloads from triggering unauthorized scans, consuming LLM budget, or posting malicious PR comments.

### 13.1.1 Authentication & Token Management

**GitHub App authentication flow:**
1. The app authenticates to GitHub using a JWT signed with the app's private key (RS256). The JWT is valid for 10 minutes.
2. For each installation, the app exchanges the JWT for an installation access token via `POST /app/installations/{installation_id}/access_tokens`. Installation tokens are valid for 1 hour.
3. All GitHub API calls (reading files, posting comments, creating check runs) use the installation access token.

**Token refresh strategy:**
- Cache installation tokens in memory with their expiry time.
- Before each GitHub API call, check if the cached token has < 5 minutes remaining. If so, fetch a new token.
- Tokens are NOT passed via job payloads. Workers fetch tokens on demand using the installation ID (stored in the job payload).
- If a token expires mid-job (edge case), the worker fetches a fresh token and retries the failed API call.

**Clone authentication:** For shallow clones of private repos, use HTTPS clone URL with the installation token: `https://x-access-token:{token}@github.com/{owner}/{repo}.git`.

**Secret management:**

**Server-side secrets** (stored as environment variables on Railway):
- `GITHUB_APP_ID` — GitHub App ID
- `GITHUB_PRIVATE_KEY` — GitHub App private key (PEM format)
- `GITHUB_WEBHOOK_SECRET` — Webhook signature verification secret
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string (for BullMQ)
- `DOCALIGN_API_SECRET` — Secret for signing API tokens issued to clients

**Client-side secrets** (in GitHub repo Secrets, used by the Action):
- `DOCALIGN_TOKEN` — API token for communicating with DocAlign server
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — Client's LLM API key (never sent to DocAlign)

### 13.1.2 API Endpoints

API server endpoints: (a) `POST /webhook` -- GitHub webhook receiver, (b) `GET /health` -- healthcheck for Railway (returns 200 OK), (c) `GET /api/dismiss` -- dismiss all findings for a PR (see Section 9.2).

**Agent Task API:**
- `GET /api/tasks/pending?repo_id={id}` — list tasks awaiting agent execution
- `GET /api/tasks/{id}` — get full task details (claim, context, mapped files)
- `POST /api/tasks/{id}/result` — submit agent's result for a completed task

These endpoints are called by the `docalign/agent-action` GitHub Action running in the client's CI.
Authentication: DocAlign API token (provided during setup, stored as GitHub Secret).

**Result validation:** All agent task results are validated against a strict schema (Zod) before storage. Malformed results are rejected with HTTP 400. Text fields (reasoning, suggested_fix, evidence_summary) are sanitized to prevent injection when rendered in PR comments.

### 13.1.3 GitHub API Version

Pin `X-GitHub-Api-Version: 2022-11-28` header on all GitHub REST API calls.

### 13.1.4 Logging

Logging: structured JSON to stdout. Log events: webhook received (type, repo, delivery_id), job started/completed/failed (job_id, repo, duration_ms), LLM call (model, input_tokens, output_tokens, cost_usd, duration_ms), PR comment posted (repo, pr_number, findings_count), error (type, message, stack). Healthcheck endpoint: `GET /health` returns `{ status: 'ok', queue_depth: N }`.

### 13.1.5 GitHub API Rate Limit Management

GitHub API rate limit management: read `X-RateLimit-Remaining` header on every API response. When remaining < 20% of limit: switch to clone-based file access for non-critical operations. When remaining < 5%: defer all non-essential API calls. Log rate limit status on every job.

### 13.1.6 Database Migrations

Database migrations: use node-pg-migrate. Migrations run as a pre-deploy hook on Railway. Migration files are numbered sequentially. No automatic rollback -- manual rollback scripts are provided for each migration.

### 13.2 Processing Architecture

Webhooks are received by an API server, which queues jobs for asynchronous processing by a worker. This is necessary because GitHub webhooks must respond within 10 seconds, but verification can take 1-5 minutes. The queue handles retries, rate limiting, and concurrent processing.

**Server-side jobs** (deterministic, run on DocAlign server):
- Index update (tree-sitter), Claim mapping (Steps 1-3 lookups), Deterministic verification (Tiers 1-2), Static rule evaluation, PR comment formatting, Count-based exclusion tracking

**Client-side jobs** (run in GitHub Action, triggered via repository dispatch):
- ALL LLM tasks: Claim extraction, Path 1 verification (direct LLM), Path 2 verification (agent), Embedding generation, Fix generation, Feedback interpretation (v2)

**Timeout policy:** Server-side jobs: 10 minutes. Client-side tasks: no hard timeout imposed by DocAlign (user aborts agent if stuck). DocAlign marks tasks as expired after `expires_at` deadline (configurable, default 30 minutes).

**Expired task behavior:** When a task passes its `expires_at` deadline: (1) server marks it `status: 'expired'`, (2) the associated claim is marked `verdict: 'uncertain'` with reason `'agent_timeout'`, (3) if the Action later submits a result for an expired task, the server rejects it with HTTP 410 Gone. Expired tasks are cleaned up (deleted) after 48 hours.

**Concurrency:** Server-side: 5 jobs. Client-side: configurable via `.docalign.yml` `agent.concurrency` (default 5, max 20).
**Retry:** 3 attempts with exponential backoff

### 13.3 File Access Strategy

- **PR-triggered checks (few files):** Read files via GitHub API
- **Full scans (many files):** Shallow clone (`git clone --depth 1`) to temp directory
- Hybrid approach based on how many files need reading

### 13.4 Scaling Considerations (Not MVP)

- Multi-worker for parallel repo processing
- Cache embeddings, claim extractions, and mappings in Redis for repeat checks
- CDN for MCP server queries to hosted API

### 13.5 Uninstall Behavior

When the `installation.deleted` webhook is received, immediately delete all data for the associated repos: claims, claim_mappings, verification_results, scan_runs, feedback, code_entities, agent_drift_reports, co_changes, agent_tasks, suppression_rules, static_analysis_rules, and repo records. This is a hard delete, not a soft delete. Cancel any in-progress or queued scan jobs for the affected repos.

For `installation_repositories.removed` events (individual repos removed from installation), delete data for only the removed repos.

### 13.6 Open Questions

(None currently -- infrastructure is well-defined for MVP.)

> Technical detail: see phases/technical-reference.md Section 8 (processing architecture diagram, worker job types, file access strategy, MCP server architecture)

