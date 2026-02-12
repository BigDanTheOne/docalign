# Phase 3C: Error Handling & Recovery

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 3: Architecture Design Document
>
> **Inputs:** Phase 3A (System Architecture), PRD, Phase 2.5 Audit Findings (E1-E5, A4), ADR: Agent-First Architecture, L3/L4/L5 PRD specs, Infrastructure PRD
>
> **Date:** 2026-02-11

---

## 1. Error Classification Framework

### 1.1 Error Code Schema

All DocAlign errors use a structured code format for machine-parseable identification:

```
DOCALIGN_E{category}{sequence}

Category codes:
  1xx = GitHub API Errors
  2xx = Agent Task Errors
  3xx = Database Errors
  4xx = Internal Logic Errors
  5xx = Configuration Errors
  6xx = Redis / Queue Errors
```

Example: `DOCALIGN_E201` = Agent task LLM unparseable output.

### 1.2 Severity Levels

| Severity | Definition | User Impact | Operator Response |
|----------|-----------|-------------|-------------------|
| **CRITICAL** | System is non-functional for this repo or globally | Scan cannot complete, no PR output | Page on-call (future). Log + alert immediately. |
| **HIGH** | Scan degrades significantly, partial results only | Missing findings, incomplete report | Log + alert within 1 hour |
| **MEDIUM** | Single claim or task affected, scan continues | One finding missing or uncertain | Log. No alert. |
| **LOW** | Cosmetic or informational, no data loss | Minor display issue or warning | Log only. |

### 1.3 Error Structure (Internal)

Every error produced internally conforms to this structure:

```typescript
interface DocAlignError {
  code: string;            // e.g., "DOCALIGN_E101"
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;         // human-readable, for logs
  userMessage?: string;    // user-facing text (if applicable)
  context: {
    repoId?: string;
    scanRunId?: string;
    claimId?: string;
    taskId?: string;
    prNumber?: number;
  };
  cause?: Error;           // original error
  retryable: boolean;
  timestamp: string;       // ISO 8601
}
```

All errors are logged as structured JSON via pino (safe mode enabled per audit finding S10). Fields containing user-supplied strings are sanitized to prevent log injection (escape newlines and JSON control characters).

---

## 2. Error Categories

For MVP, errors are classified into 8 categories. Each category has a code prefix. Individual sub-codes (e.g., E101, E102) are logged internally for debugging but the CATEGORY is what drives recovery behavior and user-facing messages. This keeps the taxonomy maintainable for a solo founder.

| Category | Code | Covers | Retryable | Recovery Strategy |
|----------|------|--------|-----------|-------------------|
| **GITHUB** | E1xx | API rate limits, server errors, token expiry, signature failures, dispatch failures, comment/check failures, clone failures | Most yes (except signature, permissions) | Per-call retry profile. Rate limit: wait for `Retry-After`. Signature fail: reject immediately. |
| **AGENT** | E2xx | LLM parse/validation errors, task timeout, late results, conflicts, dispatch 404, Action crash, zero claims, no evidence, token limit, exploration limit | Parse errors: once. Timeout/crash: no. | Parse fail: retry once, then mark `uncertain`. Timeout: expire task, claim `uncertain`. No Action: Check Run with setup instructions. |
| **DATABASE** | E3xx | Connection loss, query timeout, constraint violations, deadlocks, migration failures, vector dimension mismatch | Connection/timeout/deadlock: yes. Others: no. | Connection retry profile. Deadlock: retry once. Constraint violation: treat as idempotent. Migration fail: block deploy. |
| **INTERNAL** | E4xx | Tree-sitter parse failure, routing errors, state machine violations, concurrent webhooks, force push, partial timeout | No (graceful degradation) | Skip unparseable files. Default to Path 2 on routing error. Save partial results on timeout. Warn on force push. |
| **CONFIG** | E5xx | Invalid YAML, invalid config values, missing secrets | No | Fall back to defaults for invalid config. Fail Action with clear message for missing secrets. Never fail a scan due to config. |
| **QUEUE** | E6xx | Redis connection loss, BullMQ job failures, stalled jobs, rate limit counter errors | Yes | Connection retry profile. Stalled jobs: BullMQ auto-recovery. Counter errors: skip rate check, allow request. |

**Key principle:** Every error resolves to one of three user-visible outcomes: (1) claim marked `uncertain` with reason, (2) scan continues with partial results, (3) scan fails with actionable error message. No error is silently swallowed.

**Detailed sub-codes** are preserved in the scenario playbooks (Section 4) and referenced in log messages. They are NOT part of the public API contract — only the category prefix matters for API error responses.

---

## 3. Recovery Strategies

### 3.1 Retry Policies

All retries use exponential backoff with jitter unless stated otherwise.

**Backoff formula:**

```
delay_ms = min(base_ms * 2^attempt, max_delay_ms) + random(0, jitter_ms)
```

**Standard retry profiles:**

| Profile | Base | Max Delay | Jitter | Max Retries | Use Case |
|---------|------|-----------|--------|-------------|----------|
| **per-call** | 1000ms | 4000ms | 500ms | 2 | Individual GitHub API calls, Redis ops. Configurable via `RETRY_PER_CALL_MAX` env var. |
| **per-job** | 1000ms | 16000ms | 1000ms | 3 | BullMQ job-level retries (1s, ~2s, ~4s). Configurable via `RETRY_PER_JOB_MAX` env var. |
| **connection** | 2000ms | 30000ms | 2000ms | 10 | Database/Redis reconnection |
| **token-refresh** | 500ms | 2000ms | 200ms | 2 | GitHub installation token refresh |

**Retry eligibility rules:**
- Network errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED): always retry
- HTTP 429 (rate limit): retry after `Retry-After` header value (or 60s default)
- HTTP 500/502/503: retry with per-call profile
- HTTP 401: retry once after token refresh
- HTTP 403 (not rate limit): do not retry (permissions issue)
- HTTP 404: do not retry
- HTTP 409/410: do not retry (conflict/gone are terminal)
- JSON parse errors (from agent): retry once with same input
- Zod validation errors (from agent): retry once with same input
- Database constraint violations: do not retry
- Database deadlocks: retry once with per-call profile

### 3.2 Circuit Breaker

> **MVP note:** Full circuit breaker implementation is deferred to post-MVP. For MVP, use simple retry with backoff (Section 3.1). The parameters below are documented for when circuit breakers are added based on operational demand.

A lightweight circuit breaker protects against cascading failures from external dependencies.

**Circuit breaker parameters:**

| Dependency | Failure Threshold | Reset Timeout | Half-Open Max |
|-----------|------------------|---------------|---------------|
| GitHub API | 5 failures in 60s | 120s | 2 probe requests |
| PostgreSQL | 3 failures in 30s | 60s | 1 probe query |
| Redis | 3 failures in 30s | 30s | 1 probe PING |

**States:**
- **CLOSED** (normal): all requests pass through. Track consecutive failures.
- **OPEN** (tripped): all requests immediately fail with circuit breaker error. Timer starts.
- **HALF-OPEN** (probing): allow limited requests through. If they succeed, return to CLOSED. If they fail, return to OPEN.

**When circuit is OPEN:**
- GitHub API circuit open: scans queue but do not process. Worker pauses GitHub-dependent jobs. Redis/DB jobs continue.
- PostgreSQL circuit open: entire worker pauses. API server returns HTTP 503 for all endpoints except `/health` (which reports degraded status).
- Redis circuit open: API server continues to receive webhooks (stores in memory buffer, max 100 events, drops oldest). Worker pauses all jobs. When Redis recovers, flush buffer to queue.

### 3.3 Graceful Degradation

When components are unhealthy, DocAlign degrades rather than fails completely.

| Component Down | Degraded Behavior | User Impact |
|---------------|-------------------|-------------|
| GitHub API (rate limited) | Switch to clone-based file access. Defer comment posting. Queue results. | Delayed PR comments. Scan results posted when API recovers. |
| Agent/Action (not configured) | Skip all LLM tasks. Run only Tier 1 deterministic checks. | Partial findings only (syntactic claims). Banner: "Agent not configured. Only syntactic checks ran." |
| Agent/Action (timeout) | Mark uncompleted agent tasks as expired. Post results from completed tasks + Tier 1/2. | Partial findings. Footer: "Some claims could not be verified (agent timeout)." |
| PostgreSQL (temporary) | Worker pauses. Webhook events buffered in Redis (BullMQ queue is durable). | Delayed scans. No data loss -- jobs resume when DB recovers. |
| Redis (temporary) | API server buffers up to 100 webhooks in memory. Worker stops. | Delayed scans. Possible webhook loss if buffer overflows. |
| tree-sitter (parse failure) | Skip unparseable files. Continue scan with remaining files. | Missing entities for those files. Semantic claims for those files route to Path 2. |

### 3.4 Partial Results Strategy

Whenever a scan is interrupted (timeout, error, cancellation), DocAlign saves all completed work:

1. **Completed L0 index updates:** Persisted. Not rolled back.
2. **Completed claim extractions:** Persisted. Available for future scans.
3. **Completed verification results:** Persisted. Posted in partial PR comment.
4. **Incomplete verifications:** Not saved. Claims remain in their previous state (or `pending` if new).

**Configurability:** Server-side scan timeout is configurable via `SCAN_TIMEOUT_MINUTES` env var (default: 10). Agent task expiry is configurable via `AGENT_TASK_TIMEOUT_MINUTES` env var (default: 30).

**Definition of "layer complete" (per audit finding E4):**
- L0 complete: all changed code files in the diff have been parsed and indexed.
- L1 complete: all changed doc files have had claims extracted (or extraction tasks submitted).
- L2 complete: all extracted claims have been mapped (Steps 1-3).
- L3 complete: all routed claims have verification results (deterministic + agent).
- L5 complete: PR comment and review comments posted.

A layer is "partially complete" if some but not all inputs were processed. Partial layers save their completed items.

---

## 4. Specific Scenario Playbooks

Each playbook specifies: trigger condition, detection method, automated response, user-facing output, and logging.

---

### Scenario 1: LLM Unparseable Output (DOCALIGN_E201)

**Trigger:** Agent submits a result where `data` field is not valid JSON or is a string that cannot be parsed as JSON.

**Detection:** `JSON.parse()` throws in the result handler for `POST /api/tasks/{id}/result`.

**Automated response:**
1. Return HTTP 400 to the Action with body: `{ "error": "DOCALIGN_E201", "message": "Result data is not valid JSON. Retry with valid JSON." }`
2. The Action retries the task once (same claim, same payload).
3. On second parse failure: server accepts the submission as a failure, sets `agent_tasks.status = 'failed'`, sets `agent_tasks.error = 'DOCALIGN_E201: unparseable output after retry'`.
4. The associated claim is marked `verdict = 'uncertain'`, `reason = 'llm_parse_error'`.

**User-facing output:** The claim appears in the PR summary's collapsible uncertain section: "Could not verify: claim analysis returned invalid output."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E201", taskId, claimId, rawOutputLength, attempt }`. On >10% parse failure rate across a scan run, log at ERROR with alert tag.

**Alert threshold (per audit finding E1):** If >10% of verification tasks in a single scan fail with DOCALIGN_E201, log: `{ code: "DOCALIGN_E201_THRESHOLD", scanRunId, failureRate, totalTasks }`.

---

### Scenario 2: LLM Wrong Structured Output (DOCALIGN_E202)

**Trigger:** Agent result is valid JSON but fails Zod schema validation (e.g., missing `verdict` field, `confidence` out of 0-1 range, unknown `verdict` value).

**Detection:** Zod `.safeParse()` returns `{ success: false }` with detailed error paths.

**Automated response:**
1. Return HTTP 400 with body: `{ "error": "DOCALIGN_E202", "message": "Result validation failed.", "details": zodError.issues }`.
2. The Action retries the task once.
3. On second validation failure: same handling as Scenario 1 -- task marked failed, claim marked uncertain.

**User-facing output:** Same as Scenario 1. Claim appears as uncertain: "Could not verify: claim analysis returned incomplete data."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E202", taskId, claimId, validationErrors: zodError.issues, attempt }`.

---

### Scenario 3: Webhook Delivery Failure / Idempotency (DOCALIGN_E303)

**Trigger:** GitHub retries a webhook delivery. The same `X-GitHub-Delivery` ID arrives twice.

**Detection:** BullMQ job deduplication. The job ID for PR scan jobs is `pr-scan-{repo_id}-{pr_number}`. The webhook delivery ID is stored in the job's `data.deliveryId`. On duplicate delivery ID, BullMQ's `add()` returns the existing job (no-op) because the job with the same jobId already exists.

**Automated response:**
1. BullMQ silently deduplicates. No new job created.
2. Return HTTP 200 to GitHub (acknowledge receipt).
3. If the existing job has already completed, the duplicate is harmless.
4. If the existing job is still running, the duplicate is harmless.

**User-facing output:** None. Completely transparent.

**Logging:** Log at DEBUG: `{ code: "webhook_duplicate", deliveryId, jobId, existingJobState }`.

---

### Scenario 4: Zero Claims Extracted (DOCALIGN_E208)

**Trigger:** Claim extraction task completes successfully but returns zero claims for documentation files that exist and are non-empty.

**Detection:** `result.data.claims.length === 0` AND the `doc_files` in the task payload are non-empty files.

**Automated response:**
1. Accept the result (zero claims is valid -- the docs might genuinely have no verifiable claims).
2. If this is a full scan and zero claims are extracted across ALL doc files, set repo health score to null and log a warning.
3. Do not retry. The LLM made a legitimate judgment.

**User-facing output:** PR summary comment: "No verifiable claims found in the changed documentation. DocAlign checks specific factual claims (paths, commands, versions, behaviors) -- this file may not contain any."

**Logging:** Log at INFO: `{ code: "DOCALIGN_E208", taskId, docFiles, scanRunId }`. Log at WARN if zero claims across an entire full scan: `{ code: "DOCALIGN_E208_FULL_SCAN", repoId, docFileCount }`.

---

### Scenario 5: No Evidence Found (DOCALIGN_E209)

**Trigger:** Verification task returns a verdict (typically `uncertain`) with `evidence_files: []`.

**Detection:** `result.data.evidence_files.length === 0` in the result handler.

**Automated response:**
1. Accept the result. The agent may legitimately find no relevant evidence.
2. If verdict is `drifted` with no evidence, downgrade to `uncertain` with reason: "Drift reported but no supporting evidence provided."
3. If verdict is `verified` with no evidence, accept but lower confidence by 0.3 (floor at 0.2).

**User-facing output:** Claim appears in the uncertain section: "Insufficient evidence to verify this claim."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E209", taskId, claimId, agentVerdict, adjustedVerdict }`.

---

### Scenario 6: Token Limit Mid-Analysis (DOCALIGN_E210)

**Trigger:** The Action's LLM call is truncated or fails due to context window limits. Agent reports `error: 'token_limit_exceeded'` in the task result.

**Detection:** `result.success === false && result.error?.includes('token_limit')` OR the LLM API returns a specific error code for context length exceeded.

**Automated response:**
1. Mark the task as failed with reason `token_limit_exceeded`.
2. Mark the associated claim as `uncertain` with reason `token_limit_exceeded`.
3. Do not retry (same input will hit the same limit).

**User-facing output:** Claim appears as uncertain: "Claim analysis exceeded model context limits. Consider splitting large documentation sections."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E210", taskId, claimId, modelUsed, estimatedTokens }`.

---

### Scenario 7: PR Comment Too Long (DOCALIGN_E107)

**Trigger:** Formatted PR summary comment body exceeds GitHub's 65,535 character limit.

**Detection:** Check `commentBody.length > 65000` before posting (use 65,000 as threshold to leave margin for encoding).

**Automated response:**
1. Truncate the findings table to fit within the limit.
2. Keep: header, health score line, severity counts, first N findings that fit.
3. Append: "Showing {N} of {total} findings. Full results available in review comments on individual lines."
4. All findings still get posted as individual review comments (those are separate API calls with their own character limits).
5. If a single review comment exceeds 65,535 characters (extremely unlikely), truncate the reasoning field and append: "Full analysis truncated. See summary comment for details."

**User-facing output:** Truncated summary comment with note explaining truncation. All findings still appear as review comments.

**Logging:** Log at WARN: `{ code: "DOCALIGN_E107", prNumber, originalLength, truncatedLength, findingsShown, findingsTotal }`.

---

### Scenario 8: Rate Limit Mid-Batch (DOCALIGN_E101)

**Trigger:** GitHub API returns HTTP 429 or `X-RateLimit-Remaining` reaches 0 while posting review comments or reading files.

**Detection:** HTTP response status 429 or `X-RateLimit-Remaining` header equals "0".

**Automated response:**
1. Read `Retry-After` header (or `X-RateLimit-Reset` timestamp). Calculate wait time.
2. If wait time < 5 minutes: pause and wait, then resume posting remaining comments.
3. If wait time >= 5 minutes: save all completed work. Post whatever summary comment we can (use data already retrieved). Mark remaining review comments as "deferred."
4. Queue a follow-up job to post remaining review comments after rate limit resets.
5. Switch to clone-based file access for any remaining file reads (per PRD 13.1.5).

**User-facing output:** If partial: summary comment is posted with all available data. A note at the bottom: "Some review comments are pending due to GitHub API limits and will appear shortly."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E101", rateLimitReset, remainingComments, strategy }`.

---

### Scenario 9: DB Connection Lost Mid-Scan (DOCALIGN_E301)

**Trigger:** PostgreSQL connection drops during an active scan job.

**Detection:** Database client throws connection error (e.g., `ECONNREFUSED`, `connection terminated unexpectedly`, socket hang up).

**Automated response:**
1. Circuit breaker tracks the failure.
2. Connection pool attempts reconnection using the `connection` retry profile (2s base, 30s max, 10 retries).
3. If reconnection succeeds within retry window: resume the scan from the current stage (stages are idempotent -- re-running a stage with the same input is safe).
4. If reconnection fails after all retries: circuit breaker opens. Worker pauses all jobs. BullMQ keeps jobs in the queue (Redis-backed). When PostgreSQL recovers and circuit breaker closes, jobs resume automatically.
5. In-progress job that lost connection: BullMQ stall detection will pick it up. Job is retried from the beginning (with per-job retry count).

**User-facing output:** If scan was for a PR: no comment posted during outage. When DB recovers and job retries, normal comment is posted (delayed). No user-visible error unless all retries exhausted, in which case: "DocAlign encountered a temporary infrastructure issue. This PR will be rescanned automatically."

**Logging:** Log at ERROR: `{ code: "DOCALIGN_E301", scanRunId, stage, retryAttempt, circuitState }`.

---

### Scenario 10: Concurrent Webhooks Same PR (DOCALIGN_E404)

**Trigger:** Two `pull_request.synchronize` webhooks arrive for the same PR within milliseconds (e.g., force push followed by immediate push).

**Detection:** BullMQ job ID collision: both produce `pr-scan-{repo_id}-{pr_number}`.

**Automated response:**
1. BullMQ debounce handles this. The second `queue.add()` call with the same job ID replaces the first job if it has not started, or the first job is marked for cancellation if in progress (per ADR-4 and Phase 3A Section 6.1).
2. The per-repo queue with concurrency 1 ensures only one scan runs at a time.
3. Cancellation is checked at stage boundaries (after L0 update, after extraction task creation, after each verification batch of 10, before PR comment). Cancellation is NOT a failure (audit finding E5).

**User-facing output:** The user sees only the result from the final scan. Earlier scans are silently replaced.

**Logging:** Log at DEBUG: `{ code: "DOCALIGN_E404", prNumber, replacedJobId, newDeliveryId }`.

---

### Scenario 11: Agent Task Timeout - 30 Minutes (DOCALIGN_E203)

**Trigger:** `expires_at` on an agent task passes without a result submission.

**Detection:** Hourly cleanup job queries: `SELECT * FROM agent_tasks WHERE status IN ('pending', 'in_progress') AND expires_at < NOW()`.

**Automated response:**
1. Set `agent_tasks.status = 'expired'`.
2. For each expired task:
   - If type is `verification`: set associated claim `verdict = 'uncertain'`, `reason = 'agent_timeout'`.
   - If type is `claim_extraction`: log warning. Claims for those doc files remain at whatever state they were in previously.
   - If type is `fix_generation`: no fix is generated. The drift finding is still posted without a suggestion.
3. If >20% of tasks in a scan expired (per audit finding A25): the PR comment includes a prominent banner at the top.

**User-facing output:**
- Per-claim: appears in uncertain section: "Verification timed out. The AI agent did not respond within 30 minutes."
- Banner (if >20% expired): "Warning: {N}% of claims could not be verified because the DocAlign Action did not complete in time. Check your Action configuration and LLM API key."
- Banner (if <=20% expired): footer note: "{N} claim(s) could not be verified due to timeout."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E203", taskId, taskType, claimId, createdAt, expiresAt }`.

---

### Scenario 12: Late Result - HTTP 410 (DOCALIGN_E204)

**Trigger:** Action submits a result via `POST /api/tasks/{id}/result` for a task that has already been marked `expired`.

**Detection:** Task lookup returns `status = 'expired'`.

**Automated response:**
1. Return HTTP 410 Gone with body: `{ "error": "DOCALIGN_E204", "message": "Task has expired. Result rejected." }`.
2. Do not update any claim state (the claim was already marked uncertain by the expiration handler).
3. Do not delete the task record (cleanup handles that on its own schedule).

**User-facing output:** None. The Action receives a 410 and logs it locally. The PR comment already reflects the timeout.

**Logging:** Log at INFO: `{ code: "DOCALIGN_E204", taskId, lateByMs, taskExpiredAt }`.

---

### Scenario 13: Action Fails Mid-Execution (DOCALIGN_E207)

**Trigger:** The GitHub Action run exits with a non-zero status (crash, uncaught exception, CI runner killed) while some tasks have been submitted and others have not.

**Detection:** Some tasks in the `agent_tasks` table for this scan have `status = 'completed'`, others remain `pending` or `in_progress`. The Action does not call a "batch complete" endpoint -- the server detects this via the expiration mechanism.

**Automated response:**
1. Completed task results are already persisted (each `POST /api/tasks/{id}/result` is atomic).
2. Remaining tasks will expire at their `expires_at` deadline (default 30min).
3. When expiration cleanup runs, remaining tasks are handled per Scenario 11.
4. The scan run continues server-side with whatever results have been collected.
5. When all tasks are either completed or expired, the server posts the PR comment with partial results.

**User-facing output:** Partial PR comment. Banner if >20% of tasks did not complete: "The DocAlign Action encountered an error. {N} of {M} claims were verified."

**Logging:** Log at WARN when first expiration for this scan is detected: `{ code: "DOCALIGN_E207", scanRunId, completedTasks, expiredTasks, totalTasks }`.

---

### Scenario 14: Dispatch Fails - No Action Configured (DOCALIGN_E206)

**Trigger:** `POST /repos/{owner}/{repo}/dispatches` returns HTTP 404, meaning the repository does not have the `docalign/agent-action` workflow file.

**Detection:** GitHub API response status 404 for the dispatch call.

**Automated response:**
1. Do not retry (the Action is not configured -- retrying will not help).
2. Set repo status to `awaiting_setup` if currently in `onboarding`.
3. Post a GitHub Check Run with conclusion `action_required` and title: "DocAlign: Action setup required."
4. Check Run summary includes setup instructions.
5. Skip all agent tasks. Run only Tier 1/2 deterministic checks if any claims exist (from a previous scan, or syntactic extraction from server-side).

**User-facing output:** Check Run: "DocAlign requires the GitHub Action to be configured before it can scan documentation. See [setup guide](https://docs.docalign.dev/setup) for instructions."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E206", repoId, owner, repo }`.

---

### Scenario 15: Installation Token Expired Mid-Scan (DOCALIGN_E103)

**Trigger:** GitHub API returns HTTP 401 during a scan, typically when a cached installation token has expired (1-hour lifetime).

**Detection:** HTTP 401 response from GitHub API. Check that the error is authentication-related (not permissions-related).

**Automated response:**
1. Clear the cached token for this installation.
2. Generate a new JWT and request a fresh installation access token.
3. Retry the failed API call with the new token (using the `token-refresh` retry profile: 500ms base, 2 retries).
4. If token refresh itself fails (e.g., private key issue), fail the current API call and propagate the error.

**User-facing output:** None. Token refresh is transparent. If refresh fails entirely, the scan errors with: "DocAlign could not authenticate with GitHub. Please check your app installation."

**Logging:** Log at INFO on successful refresh: `{ code: "token_refreshed", installationId }`. Log at ERROR on refresh failure: `{ code: "DOCALIGN_E103", installationId, refreshError }`.

---

### Scenario 16: Webhook Signature Fails (DOCALIGN_E105)

**Trigger:** The `X-Hub-Signature-256` header does not match the HMAC-SHA256 of the request body using `GITHUB_WEBHOOK_SECRET`.

**Detection:** HMAC comparison fails in the webhook middleware (constant-time comparison).

**Automated response:**
1. Return HTTP 401 Unauthorized immediately. Do not process the payload.
2. Do not enqueue any job.
3. Do not log the request body (could be attacker-controlled content).

**User-facing output:** None. The request is silently rejected.

**Logging:** Log at ERROR: `{ code: "DOCALIGN_E105", remoteIp, requestPath, deliveryId: headers['X-GitHub-Delivery'] || 'missing' }`. Do NOT log the body or signature.

---

### Scenario 17: Invalid .docalign.yml (DOCALIGN_E501/E502)

**Trigger:** The repository's `.docalign.yml` file contains invalid YAML syntax or values that fail schema validation.

**Detection:**
- YAML parse error: caught by YAML parser (DOCALIGN_E501).
- Schema validation error: caught by Zod validation after successful YAML parse (DOCALIGN_E502).

**Automated response:**
1. **Invalid YAML syntax (E501):** Fall back to ALL defaults for the entire configuration. No partial parsing.
2. **Schema validation errors (E502):** Use defaults for invalid fields only. Keep valid fields.
3. Never fail a scan due to config errors.
4. Continue the scan with the resolved configuration (defaults + valid overrides).
5. Include a configuration warning in the PR summary comment (per audit finding I10).

**User-facing output:** PR summary comment includes a note at the top: "Configuration warning: `.docalign.yml` {has invalid YAML syntax, using all defaults | field `{field}` is invalid ({reason}), using default value `{default}`}."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E501" or "DOCALIGN_E502", repoId, parseError or validationErrors, resolvedConfig }`.

---

### Scenario 18: Tree-sitter Parse Failure (DOCALIGN_E401)

**Trigger:** tree-sitter cannot parse a source file (corrupted file, unsupported encoding, file too large, or genuinely unparseable syntax).

**Detection:** tree-sitter parser returns a tree with `rootNode.hasError()` or throws during parse.

**Automated response:**
1. Skip the unparseable file. Do not add/update entities for this file.
2. Remove any existing entities for this file (they may be stale).
3. Continue the scan with remaining files.
4. Claims mapped to entities in this file: route to Path 2 (agent can read the raw file).
5. Claims mapped to this file path (not entity): still verifiable by Path 2.

**User-facing output:** None in PR comment. The file is simply not indexed -- its claims may appear as uncertain if the agent also cannot verify them.

**Logging:** Log at WARN: `{ code: "DOCALIGN_E401", repoId, filePath, language, errorDescription }`.

---

### Scenario 19: Embedding Dimension Mismatch (DOCALIGN_E307/E408)

**Trigger:** A query embedding has different dimensions than stored vectors (e.g., user changed `llm.embedding_model` from `text-embedding-3-small` (1536) to a model with 768 dimensions).

**Detection:**
- At query time: pgvector throws an error when comparing vectors of different dimensions.
- At storage time: INSERT fails due to vector dimension constraint.

**Automated response:**
1. Reject the query/insert. Do not crash.
2. Log the mismatch with both dimensions.
3. Disable semantic search (mapper Step 3) for this repo until re-index.
4. Fall back to Steps 1-2 (direct reference + symbol search) for mapping.
5. Claims that would have used semantic search: route to Path 2 (agent).
6. Post a warning in the PR summary: "Embedding model changed. Run a full re-index to restore semantic search."

**User-facing output:** PR summary footer: "Note: Semantic search is disabled because the embedding model configuration changed. Run a full scan to re-index."

**Logging:** Log at ERROR: `{ code: "DOCALIGN_E307", repoId, storedDimension, queryDimension, configuredModel }`.

---

### Scenario 20: Partial Scan Timeout (DOCALIGN_E407)

**Trigger:** The server-side 10-minute timeout for a scan job is reached before all layers complete.

**Detection:** BullMQ job timeout fires. The worker receives a timeout signal.

**Automated response:**
1. Save all completed work at the current stage boundary (per Section 3.4).
2. Set `scan_runs.status = 'partial'`.
3. Set `scan_runs.completed_at = NOW()`.
4. Record which layers completed and which were interrupted.
5. Post a partial PR comment with whatever results exist.
6. Update Check Run to `completed` with conclusion `neutral` (not `failure` -- partial is not a failure).

**User-facing output:** PR summary includes note: "Scan timed out after verifying {N} of {M} claims. Results shown are from the completed portion. Remaining claims will be checked on the next push."

**Logging:** Log at WARN: `{ code: "DOCALIGN_E407", scanRunId, completedLayers, interruptedLayer, claimsVerified, claimsRemaining, elapsedMs: 600000 }`.

---

## 5. Idempotency Design

### 5.1 Webhook Idempotency

**Deduplication key:** `X-GitHub-Delivery` header (UUID assigned by GitHub to each webhook delivery).

**Mechanism:**
1. On webhook receipt, extract the delivery ID from headers.
2. Use the delivery ID as metadata stored in the BullMQ job's `data.deliveryId`.
3. The BullMQ job ID for PR scans is `pr-scan-{repo_id}-{pr_number}`. This provides job-level deduplication (same PR, same repo = same job slot).
4. For `push` events: job ID is `push-scan-{repo_id}-{commit_sha}`. Same commit SHA = same job.
5. For `installation` events: job ID is `install-{installation_id}`. Duplicate installation webhooks are deduplicated.

**Edge case -- redelivery after job completion:** If GitHub redelivers a webhook after the job has already completed, BullMQ will attempt to add a job with the same ID. Since the original job has completed and was removed (BullMQ default `removeOnComplete`), a new job IS created. This is acceptable because:
- PR scans are idempotent: re-running produces the same results (or updated results if code changed).
- The PR comment strategy posts a NEW comment per push, so a duplicate scan produces a duplicate comment. Mitigation: before posting, check if a comment for this scan_run_id already exists. If so, skip posting.

**Idempotency token for scan results:**
- Each `scan_runs` record has a unique `id` (UUID).
- Before posting a PR comment, check: `SELECT id FROM scan_runs WHERE id = $1 AND comment_posted = true`. If already posted, skip.
- After posting, set `comment_posted = true` in the same transaction.

### 5.2 Agent Task Idempotency

**Task claiming:** Atomic `UPDATE agent_tasks SET status = 'in_progress', claimed_by = $1 WHERE id = $2 AND claimed_by IS NULL RETURNING *`. If no rows returned, the task was already claimed.

**Result submission:** `POST /api/tasks/{id}/result` checks:
1. Task exists: if not, return HTTP 404.
2. Task status is `in_progress` and `claimed_by` matches the submitter: if not, return HTTP 409 Conflict (already completed by another run) or HTTP 410 Gone (expired).
3. On valid submission: update task status to `completed`, store result, all within a single transaction.

**Double-submit protection:** If the same Action run submits a result twice for the same task (e.g., retry after network timeout on the response), the second submission hits the `status != 'in_progress'` check and receives HTTP 409. No data corruption.

### 5.3 PR Comment Idempotency

**Summary comment:** Each summary comment includes a hidden marker:
```html
<!-- docalign-summary scan-run-id={scan_run_id} -->
```

Before posting a new summary comment, search existing PR comments for this marker with the current `scan_run_id`. If found, the comment was already posted -- skip. This handles the case where the server crashes after posting but before recording `comment_posted = true` in the database.

**Review comments:** Each review comment includes a hidden marker:
```html
<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->
```

Before posting review comments, fetch existing PR review comments and extract markers. Skip any review comment where the `claim_id + scan_run_id` combination already exists.

---

## 6. User-Facing Error Messages

Every error that can produce user-visible output has exact text specified below. Messages are concise, actionable, and never expose internal implementation details.

### 6.1 PR Summary Comment Messages

| Code(s) | Context | Exact Message Text |
|----------|---------|-------------------|
| DOCALIGN_E201, E202 | Claim uncertain due to LLM output issue | "Could not verify this claim (analysis returned invalid output)." |
| DOCALIGN_E203 | Claim uncertain due to timeout | "Verification timed out. The DocAlign Action did not respond within the time limit." |
| DOCALIGN_E206 | Action not configured | *Posted as Check Run, not PR comment. See Section 6.2.* |
| DOCALIGN_E208 | Zero claims in changed docs | "No verifiable claims found in the changed documentation files." |
| DOCALIGN_E209 | No evidence for a claim | "Insufficient evidence to verify this claim." |
| DOCALIGN_E210 | Token limit hit | "Claim analysis exceeded model context limits." |
| DOCALIGN_E211 | Agent exploration exceeded | "Verification scope too broad (exceeded file exploration limit). Claim marked as uncertain." |
| DOCALIGN_E307, E408 | Embedding mismatch | "Semantic search is disabled due to embedding model change. Run a full scan to re-index." |
| DOCALIGN_E407 | Partial timeout | "Scan timed out after verifying {N} of {M} claims. Remaining claims will be checked on the next push." |
| DOCALIGN_E501 | Invalid YAML syntax | "Configuration warning: `.docalign.yml` has invalid YAML syntax. Using all default settings." |
| DOCALIGN_E502 | Invalid config value | "Configuration warning: field `{field}` is invalid ({reason}), using default value `{default}`." |
| DOCALIGN_E107 | Comment too long | "Showing {N} of {total} findings. Full results available in review comments on individual lines." |
| (rate limit banner) | >20% timeout/skip | "Warning: {N}% of claims could not be verified because the DocAlign Action did not complete in time. Check your Action configuration and LLM API key." |
| (partial banner) | Action crashed | "The DocAlign Action encountered an error. {N} of {M} claims were verified." |
| (agent not configured) | No agent, partial scan | "Agent not configured. Only syntactic checks were performed." |
| (rate limit defer) | GitHub rate limit mid-batch | "Some review comments are pending due to GitHub API rate limits and will appear shortly." |
| (force push warn) | SHA mismatch | "Note: These results are from commit `{sha}`. The PR has been updated since this scan ran." |

### 6.2 GitHub Check Run Messages

| Code(s) | Conclusion | Title | Summary |
|----------|-----------|-------|---------|
| DOCALIGN_E206 | `action_required` | "DocAlign: Action setup required" | "DocAlign requires the GitHub Action to be configured before it can scan documentation. See docs.docalign.dev/setup for instructions." |
| DOCALIGN_E301, E601 | `failure` | "DocAlign: Temporary error" | "DocAlign encountered a temporary infrastructure issue. This PR will be rescanned automatically." |
| DOCALIGN_E104 | `failure` | "DocAlign: Permission error" | "DocAlign no longer has permission to access this repository. Please check the app installation." |
| DOCALIGN_E407 | `neutral` | "DocAlign: Partial scan" | "Scan timed out. {N} of {M} claims verified. See PR comment for details." |
| (scan failure, all retries exhausted) | `failure` | "DocAlign: Scan failed" | "DocAlign encountered an error scanning this PR: {errorType}. The scan will be retried automatically." |

### 6.3 HTTP API Error Responses

All error responses from the Agent Task API follow this structure:

```json
{
  "error": "DOCALIGN_EXXX",
  "message": "Human-readable description of the error."
}
```

| Endpoint | Status | Code | Message |
|----------|--------|------|---------|
| `POST /api/tasks/{id}/result` | 400 | DOCALIGN_E201 | "Result data is not valid JSON. Retry with valid JSON." |
| `POST /api/tasks/{id}/result` | 400 | DOCALIGN_E202 | "Result validation failed. See `details` for specific field errors." |
| `POST /api/tasks/{id}/result` | 404 | — | "Task not found." |
| `POST /api/tasks/{id}/result` | 409 | DOCALIGN_E205 | "Task already completed by another Action run." |
| `POST /api/tasks/{id}/result` | 410 | DOCALIGN_E204 | "Task has expired. Result rejected." |
| `GET /api/tasks/pending` | 401 | — | "Invalid or missing DOCALIGN_TOKEN." |
| `GET /api/tasks/pending` | 403 | — | "Token does not have access to this repository." |
| `POST /webhook` | 401 | DOCALIGN_E105 | (No body. HTTP 401 only.) |
| `GET /api/dismiss` | 400 | — | "Invalid or expired dismiss token." |
| `GET /health` | 503 | — | `{ "status": "degraded", "reason": "database_unavailable" }` |

---

## 7. Audit Finding Resolutions

### 7.1 A4: Co-Change Retention Purge Race

**Finding:** The weekly co_changes purge job (180-day retention) could delete records that are currently referenced by active mapping confidence boosts.

**Resolution: Snapshot co-change boost at mapping creation time (denormalize).**

When a `claim_mapping` is created and the co-change boost is calculated (via `boostByCoChange()`), the boost value is baked into `claim_mappings.confidence` immediately. The `co_changes` table is used only for:
1. Computing the boost at mapping creation/refresh time.
2. Analytics and co-change pattern visibility.

The purge job can safely delete old co_changes records because no active query depends on them in real-time. The mapping confidence already incorporates the historical co-change signal.

**Implementation detail:**
- `claim_mappings.confidence` stores the final confidence including co-change boost.
- `claim_mappings` gains a `co_change_boost` column (REAL, default 0.0) for auditability: the boost that was added at mapping creation time.
- On mapping refresh (e.g., remapping after code change), the boost is recalculated from whatever co_changes records exist at that time.

**Purge job safety:** The purge query remains simple: `DELETE FROM co_changes WHERE committed_at < NOW() - INTERVAL '180 days'`. No need to check for active references.

### 7.2 E1: LLM Malformed Response Handling

**Finding:** Define handling for LLM JSON parse failures.

**Resolution:** Fully specified in Scenario 1 (Section 4). Summary:
- Retry once on JSON parse failure.
- On second failure: mark task failed, claim marked uncertain with reason `llm_parse_error`.
- Alert if >10% of verifications in a scan fail parsing.

### 7.3 E2: Agent Claims with Deleted Mapped Files

**Finding:** When a file-mapped claim points to a deleted file, define behavior.

**Resolution:**
- During L4 PR scan, when the diff shows a file deletion, the server removes all `claim_mappings` pointing to that file (per Phase 3A Section 6.3, A3 resolution).
- If a claim's ONLY mapping pointed to the deleted file, the claim has zero mappings.
- Zero-mapping claims are routed to Path 2 (agent-delegated) with `routing_reason = 'no_mappings'`.
- However, if the mapped file is deleted AND the claim references that specific file (e.g., `path_reference` to `src/old-file.ts`), the deterministic Tier 1 check catches this immediately: verdict = `drifted`, reason = "File does not exist."
- For non-path claims that lose their mapping: the agent can explore the codebase to find alternative evidence.
- We do NOT send claims to the agent with a stale deleted file hint. The `mapped_files` array in the verification payload is filtered to exclude files that do not exist in the current commit.

### 7.4 E3: Force Push During Scan

**Finding:** Store commit SHA and warn if PR HEAD changes.

**Resolution:** Fully specified in Scenario 10 (debounce handles concurrent pushes) and Phase 3A Section 6.3. Additional detail:
- `scan_runs.commit_sha` stores the HEAD SHA at scan start.
- Before posting the PR comment, the worker calls `GET /repos/{owner}/{repo}/pulls/{pr_number}` and compares `head.sha`.
- If different: prepend warning text to the summary comment (see Section 6.1, force push warn message).
- The scan results are still posted (they are valid for the commit they ran against). The next push will trigger a fresh scan.

### 7.5 E4: Partial Scan Timeout Behavior

**Finding:** Define per-layer completion semantics.

**Resolution:** Fully specified in Section 3.4 (Partial Results Strategy). Each layer's completion is defined. Partial layers save completed items. The PR comment notes the partial nature.

### 7.6 E5: Debounce Cancellation vs Failure

**Finding:** Cancellation should not count as a failure.

**Resolution:** Addressed in Phase 3A Section 6.1 and reiterated in Scenario 10 (Section 4). Cancellation due to debounce:
- Sets `scan_runs.status = 'cancelled'` (not `failed`).
- Does NOT increment the retry counter.
- Does NOT trigger error comments or Check Run failures.
- Saves any completed work from the cancelled scan.
- BullMQ job state is `completed` (with a cancellation flag in the result), not `failed`.

---

## 8. Cross-References

| Document | Relationship to This Document |
|----------|------------------------------|
| `phases/phase3-architecture.md` (3A) | Primary input. Error handling builds on state machines, concurrency model, and data architecture defined there. |
| `phases/phase2.5-audit-findings.md` | Source of E1-E5 and A4 findings resolved here. |
| `phases/adr-agent-first-architecture.md` | Defines the agent task API contract and triggering model that drives many error scenarios. |
| `prd/L3-verification-engine.md` | Defines verification tiers and evidence assembly -- context for agent task error scenarios. |
| `prd/L4-change-scanning.md` | Defines scan triggers, debounce, idempotency, and error handling table -- this document fully specifies those behaviors. |
| `prd/L5-report-fix.md` | Defines PR output format -- this document specifies exact error message text for all user-facing outputs. |
| `prd/infrastructure-deployment.md` | Defines retry policy, timeout policy, and secret management -- this document provides detailed recovery strategies. |
| `phases/phase3-integration-specs.md` (3B) | Will define detailed API contracts. Error responses in this document align with the contract structure. |
| `phases/phase3-infrastructure.md` (3D) | Will define monitoring and alerting. Alert thresholds in this document are inputs to 3D. |
| `phases/phase3-security.md` (3E) | Will define the security threat model. Webhook signature validation (E105) and token management (E103) are security concerns documented here for error handling completeness but owned by 3E. |

---

## 9. Error Code Quick Reference

See Section 2 for category-level recovery strategies. Individual sub-codes are used in log messages and scenario playbooks (Section 4) for precise identification. The sub-code numbering follows the pattern `DOCALIGN_E{category}{sequence}` where category 1xx=GitHub, 2xx=Agent, 3xx=Database, 4xx=Internal, 5xx=Config, 6xx=Queue.
