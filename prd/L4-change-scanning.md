> Part of [DocAlign PRD](../PRD.md)

## 8. Layer 4: Change-Triggered Scanning

### 8.1 Purpose

Determine WHEN to run verification and WHICH claims to verify based on events. This layer orchestrates Layers 1-3 in response to triggers.

### 8.2 Functional Requirements

**Trigger: PR Opened/Updated (Primary -- MVP)**

DocAlign scans PRs targeting any branch, not just the default branch.

1. Receive GitHub webhook for PR opened or updated
2. Get list of changed files from PR diff
3. Separate documentation files from code files
4. Update codebase index for changed code files (Layer 0)
5. Create agent task for claim re-extraction (if docs changed). Trigger agent via repository dispatch. (Layer 1)
6. Find claims affected by code changes using the reverse index (Layer 2)
7. Include claims from changed doc files (they may reference unchanged code)
8. Merge, deduplicate. **Server** routes claims to Path 1 or Path 2 using deterministic routing logic (see Spike B Section 5.3). Server creates agent tasks in the `agent_tasks` table for all client-side work (Path 1 verification, Path 2 verification, semantic extraction). Server triggers the Action via repository dispatch. The Action polls `GET /api/tasks/pending`, executes tasks, and submits results via `POST /api/tasks/{id}/result`. (Layer 3)
9. Filter to actionable findings (drifted and uncertain claims). Uncertain claims are included with a distinct "UNCERTAIN" badge but do NOT generate fix suggestions (the system cannot suggest a fix if it cannot determine what is wrong).
10. Post PR output: summary comment + review comments on specific lines (Layer 5). See Section 9.2 for the hybrid output strategy.

**Trigger: Push to Default Branch**
- Same flow as PR but no PR comment to post
- Updates stored verification results and repo health score
- Keeps the claim database current between PRs

**Trigger: Scheduled Full Scan**
- Re-extract all claims from all doc files
- Re-map all claims (some mappings may have gone stale)
- Verify ALL claims (not just changed ones)
- Generate health report
- Catches drift accumulated from many small changes where no individual PR triggered a re-check

**Trigger: Manual CLI**
- `docalign check` -- check only claims mapped to staged files (pre-commit)
- `docalign scan` -- full repo scan
- `docalign scan docs/api.md` -- scan specific doc file
- `docalign fix docs/api.md` -- generate and apply fixes

**Trigger: Agent Drift Report (MCP)**
- When an agent reports suspected drift via MCP
- Find the claim being reported (or create a new one)
- Queue immediate re-verification
- If confirmed drifted: create a finding record
- Optionally notify the developer

### 8.3 Scope Controls

- Max claims per PR: 50 (default, configurable via `.docalign.yml`). Hard cap: 200. If more claims are affected, prioritize by severity and confidence.
- Max agent tasks (Path 2) per PR: 20 (default, configurable via `agent.max_claims_per_pr`). All LLM costs are borne by client.
- Timeout: 10 minutes total per PR scan for server-side work (matches per-job timeout in Section 13.2). Client-side tasks: no hard timeout imposed by DocAlign (user aborts Action run if stuck). DocAlign marks tasks as expired server-side after `expires_at` deadline (default 30 minutes).

### 8.4 Safeguards

**Debounce:** When a new push arrives within 30 seconds of a queued/in-progress scan for the same PR, cancel the pending/in-progress job and queue a new one with the latest commit SHA. Implementation: BullMQ job replacement by job ID (keyed on PR number). The job ID for PR scans is `pr-scan-{repo_id}-{pr_number}`. When a new webhook arrives, call `queue.add()` with the same job ID and `{ jobId, removeOnFail: true }` -- BullMQ replaces the existing job if it has not yet started, or marks it for cancellation if in progress (the worker checks for cancellation at each pipeline stage boundary).

**Concurrent scan serialization:** Concurrent scans on the same repo are serialized using a per-repo lock. When a new scan job is queued for a repo that has a scan in progress, it waits until the current scan completes. Implementation: BullMQ named queue per repo with concurrency 1. Queue name: `repo-{repo_id}`. All scan jobs for a repo (PR scans, full scans, push scans) are placed in the same per-repo queue.

**Idempotency:** Use the GitHub webhook delivery ID (`X-GitHub-Delivery` header) as the BullMQ job deduplication key. If a webhook is delivered twice, the second job add is a no-op. Before posting a PR comment, the system does not need to check for existing comments since each push creates a new summary comment (see Section 9.2).

**Rate limits:**
- Per-repo rate limit: max 100 scans per day
- Per-org rate limit: max 1000 scans per day

**Per-repo rate limit enforcement:** Redis counter with key `ratelimit:{repo_id}:{utc_date}`, TTL 48 hours. When limit (100 scans/day) is hit: post a PR comment "DocAlign scan limit reached for today. This PR will be scanned tomorrow." and skip the scan. Per-org limit (1000/day): same pattern with key `ratelimit:org:{org_id}:{utc_date}`.

### 8.5 Inputs and Outputs

**Inputs:**
- GitHub webhook events (PR, push)
- Cron schedule
- CLI invocation
- MCP drift reports

**Outputs:**
- Triggers verification pipeline execution with the correct scope of claims
- Results flow to Layer 5 (reporting), Layer 7 (learning), and the database

### 8.6 Error Handling (PR Scans)

When a PR scan fails, the system must communicate the failure to the user rather than failing silently.

**Error comment on PR:** When a scan fails after all retries are exhausted, post a brief comment on the PR: "DocAlign encountered an error scanning this PR: [error type]. The scan will be retried automatically." Also update the GitHub Check Run to `failure` status (see Section 9.6).

**Error types and handling:**

| Error Type | Description | Handling |
|------------|-------------|----------|
| LLM API failure (429/529) | Rate limit or overloaded | Retry 3x with exponential backoff (1s, 4s, 16s). If all fail, post error comment. |
| LLM API timeout | Response not received in 30s | Retry 3x. Save partial results from completed verifications. |
| LLM malformed response | JSON parse error or missing fields | Retry once with same input. If still malformed, mark claim as `uncertain`. |
| GitHub API rate limit | 5000 req/hour shared limit exhausted | Check `X-RateLimit-Remaining` header. If < 100, switch to clone-based file access. If clone also fails, defer scan. |
| GitHub API permission denied | Token expired or permissions revoked | Refresh installation token. If still denied, post error comment and log. |
| Job timeout (10 min) | Scan exceeds time budget | Save all completed verification results. Post partial results with a note: "Scan timed out after verifying N of M claims." |
| AST parse failure | tree-sitter cannot parse a file | Skip the file, log warning. Continue with remaining files. |
| Clone failure | Cannot clone repo (disk, network, permissions) | Retry once. If fails, post error comment. |
| Unexpected error | Unhandled exception | Log full stack trace. Post generic error comment. |

**Partial success:** If a scan completes some verifications before failing, save the completed results and post them with a note indicating the scan was partial. Do not discard completed work.

**Retry policy:** 3 attempts with exponential backoff (already defined in Section 13.2). Retries apply at the job level. Individual LLM calls within a job have their own per-call retry (2 retries, exponential backoff, per the table above).

### 8.7 Open Questions

(None currently -- this layer is well-defined.)

> Technical detail: see phases/technical-reference.md Section 3.5 (webhook handlers, debouncing constants)

