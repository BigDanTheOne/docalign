# TDD-Infra: Infrastructure (GitHub App, API Server, Database, Deployment)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Sections 10-14), prd/infrastructure-deployment.md, phase3-infrastructure.md, phase3-integration-specs.md (Sections 1-2), phase3-decisions.md (3D-001 through 3D-006, XREF-001, 3B-D2), phase3-error-handling.md, phase3-security.md
>
> **Date:** 2026-02-11

---

## 1. Overview

TDD-Infra covers the foundational infrastructure layer of DocAlign: the Express API server, GitHub App webhook handling, Agent Task API, PostgreSQL database schema and migrations, Redis/BullMQ job queue, deployment configuration, and the health/observability surface.

This layer is the backbone upon which all domain layers (L0-L7) operate. It receives inbound events (GitHub webhooks, agent task results), authenticates and validates them, enqueues jobs for asynchronous processing, stores and retrieves persistent state, and exposes the Agent Task API for client-side GitHub Action communication.

**Scope:**

- Express API server (routes, middleware, request lifecycle)
- GitHub App registration, webhook signature verification, event routing
- GitHub authentication (JWT, installation tokens, caching)
- Agent Task API endpoints (`GET /api/tasks/pending`, `GET /api/tasks/:id`, `POST /api/tasks/:id/result`)
- DOCALIGN_TOKEN generation and validation
- PostgreSQL connection management, schema, migrations (node-pg-migrate)
- Redis connection, BullMQ queue setup
- Health endpoint and observability
- SIGTERM graceful shutdown
- Deployment configuration (Railway)
- Dismiss endpoint (`GET /api/dismiss`)

**Boundaries:** This TDD does NOT cover the BullMQ worker processors (owned by TDD-4 Triggers), domain logic for any layer (L0-L7), the GitHub Action client code, or the MCP server. It provides the server-side plumbing that other layers consume.

---

## 2. Dependencies

### 2.1 External Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.18 | HTTP server and routing |
| `@octokit/rest` | ^20 | GitHub REST API SDK |
| `@octokit/auth-app` | ^6 | GitHub App JWT + installation token authentication |
| `bullmq` | ^5 | Job queue (BullMQ on Redis) |
| `ioredis` | ^5 | Redis client (BullMQ dependency + direct use) |
| `pg` | ^8 | PostgreSQL client (node-postgres) |
| `node-pg-migrate` | ^7 | Database migration runner |
| `zod` | ^3 | Request/response schema validation |
| `pino` | ^8 | Structured JSON logging |
| `pino-http` | ^9 | HTTP request logging middleware |
| `helmet` | ^7 | Security headers middleware |
| `jsonwebtoken` | ^9 | GitHub App JWT signing (RS256) |

### 2.2 Consumes from

| Source | What | When |
|--------|------|------|
| GitHub (webhooks) | `pull_request`, `push`, `installation`, `installation_repositories`, `pull_request_review` events | Inbound HTTP POST to `/webhook` |
| GitHub (REST API) | Installation tokens, file content, Check Runs, PR reviews, repository dispatch | During scan processing |
| L4 `TriggerService` | `enqueuePRScan`, `enqueuePushScan`, `enqueueFullScan` | Webhook handler enqueues jobs |
| PostgreSQL | `repos`, `agent_tasks`, `scan_runs` tables + all schema tables | All persistent state |
| Redis | BullMQ queues, rate limit counters, installation token cache | Job management, auth |

### 2.3 Exposes to

| Consumer | What | When |
|----------|------|------|
| L4 Worker (BullMQ) | BullMQ queues with job payloads | Worker processes jobs from queues |
| GitHub Action (`docalign/agent-action`) | Agent Task API: `GET /api/tasks/pending`, `GET /api/tasks/:id`, `POST /api/tasks/:id/result` | Action polls for and submits tasks |
| GitHub | `GET /health` for monitoring | Railway health checks |
| GitHub (PR comments) | `GET /api/dismiss` | User clicks dismiss link |
| All layers | Database connection pool, Redis connection, logger instance | Shared infrastructure |

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md`. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `AgentTask` (Section 10.1) -- agent task record
- `AgentTaskType` (Section 1) -- task type enum
- `AgentTaskStatus` (Section 1) -- task status enum
- `AgentTaskPayload` (Section 10.2) -- task payload discriminated union
- `AgentTaskResult` (Section 10.3) -- task result from Action
- `AgentTaskResultData` (Section 10.3) -- result data discriminated union
- `TaskResultMetadata` (Section 10.3) -- result metadata
- `TaskListResponse` (Section 11.3) -- `GET /api/tasks/pending` response
- `TaskDetailResponse` (Section 11.3) -- `GET /api/tasks/:id` response
- `TaskResultResponse` (Section 11.3) -- `POST /api/tasks/:id/result` response
- `APIErrorResponse` (Section 11.3) -- error response format
- `HealthResponse` (Section 11.3) -- health check response
- `PRWebhookPayload` (Section 11.2) -- PR webhook payload
- `PushWebhookPayload` (Section 11.2) -- push webhook payload
- `InstallationCreatedPayload` (Section 11.2) -- installation created payload
- `RepositoryDispatchPayload` (Section 11.1) -- dispatch event payload
- `TokenValidation` (Section 11.4) -- token generation and validation
- `DocAlignError` (Section 13) -- error structure
- `DocAlignConfig` (Section 14) -- configuration type
- `RepoRow` (Section 12) -- repos table row
- `AgentTaskRow` (Section 12) -- agent_tasks table row
- `ScanRunRow` (Section 12) -- scan_runs table row
- `ScanStatus` (Section 1) -- scan status enum
- `RepoStatus` (Section 1) -- repo status enum

**Layer-internal types** (not in api-contracts, specific to infra implementation):

```typescript
/** In-memory cache entry for GitHub installation access tokens */
interface CachedInstallationToken {
  token: string;
  expiresAt: Date;
  installationId: number;
}

/** Parsed and validated webhook event for internal routing */
interface WebhookEvent {
  event_type: string;            // X-GitHub-Event header value
  action: string;                // payload.action
  delivery_id: string;           // X-GitHub-Delivery header value
  installation_id: number;
  payload: Record<string, unknown>;
}

/** Server configuration loaded from environment variables */
interface ServerConfig {
  port: number;                         // PORT, default 8080
  node_env: string;                     // NODE_ENV
  log_level: string;                    // LOG_LEVEL, default 'info'
  github_app_id: string;               // GITHUB_APP_ID
  github_private_key: string;          // GITHUB_PRIVATE_KEY (PEM)
  github_webhook_secret: string;       // GITHUB_WEBHOOK_SECRET
  github_webhook_secret_old?: string;  // GITHUB_WEBHOOK_SECRET_OLD (rotation window)
  database_url: string;                // DATABASE_URL
  redis_url: string;                   // REDIS_URL
  docalign_api_secret: string;         // DOCALIGN_API_SECRET
  docalign_token_ttl_days: number;     // DOCALIGN_TOKEN_TTL_DAYS, default 365
  scan_timeout_minutes: number;        // SCAN_TIMEOUT_MINUTES, default 10
  agent_task_timeout_minutes: number;  // AGENT_TASK_TIMEOUT_MINUTES, default 30
  retry_per_call_max: number;          // RETRY_PER_CALL_MAX, default 2
  retry_per_job_max: number;           // RETRY_PER_JOB_MAX, default 3
}

/** Database pool wrapper exposing query and transaction helpers */
interface DatabaseClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/** Rate limit check result */
interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}
```

---

## 4. Public API

### 4.1 handleWebhook

#### Signature

```typescript
handleWebhook(
  rawBody: Buffer,
  headers: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }>
```

#### Algorithm

```
function handleWebhook(rawBody, headers):
  // 1. Extract and validate required headers
  signature = headers['x-hub-signature-256']
  eventType = headers['x-github-event']
  deliveryId = headers['x-github-delivery']
  contentType = headers['content-type']

  if not signature or not eventType or not deliveryId:
    log(WARN, "webhook_missing_headers", { deliveryId })
    return { status: 401, body: {} }

  if contentType != 'application/json':
    return { status: 415, body: { error: "Unsupported content type" } }

  // 2. Verify webhook signature (try current secret, fall back to old)
  valid = verifyWebhookSignature(rawBody, signature, config.github_webhook_secret)
  if not valid and config.github_webhook_secret_old:
    valid = verifyWebhookSignature(rawBody, signature, config.github_webhook_secret_old)
  if not valid:
    log(ERROR, "DOCALIGN_E105", { deliveryId, remoteIp: headers['x-forwarded-for'] })
    return { status: 401, body: {} }

  // 3. Parse payload
  payload = JSON.parse(rawBody.toString('utf-8'))

  // 4. Route by event type
  switch eventType:
    case 'pull_request':
      return handlePullRequestEvent(payload, deliveryId)
    case 'push':
      return handlePushEvent(payload, deliveryId)
    case 'installation':
      return handleInstallationEvent(payload, deliveryId)
    case 'installation_repositories':
      return handleInstallationReposEvent(payload, deliveryId)
    case 'pull_request_review':
      return handlePullRequestReviewEvent(payload, deliveryId)
    default:
      log(DEBUG, "webhook_ignored", { eventType, deliveryId })
      return { status: 200, body: { received: true } }

  // 5. For PR opened/synchronize: look up repo, enqueue scan via L4
  // 6. For push: check if default branch, extract changed files, enqueue
  // 7. For installation created: create repo records, enqueue full scans
  // 8. For installation deleted: cancel jobs, delete repo data
```

#### I/O Example 1: Valid pull_request.opened

**Input:**
```
rawBody: Buffer containing PR webhook JSON
headers: {
  'x-hub-signature-256': 'sha256=<valid_hmac_hex>',
  'x-github-event': 'pull_request',
  'x-github-delivery': 'abc-123-def',
  'content-type': 'application/json'
}
```

**Output:**
```json
{ "status": 200, "body": { "received": true } }
```

Side effect: BullMQ job enqueued via `TriggerService.enqueuePRScan`.

#### I/O Example 2: Valid installation.created

**Input:**
```
rawBody: Buffer containing installation created JSON with 3 repositories
headers: {
  'x-hub-signature-256': 'sha256=<valid_hmac_hex>',
  'x-github-event': 'installation',
  'x-github-delivery': 'def-456-ghi',
  'content-type': 'application/json'
}
```

**Output:**
```json
{ "status": 200, "body": { "received": true } }
```

Side effect: 3 repo records created in `repos` table. Up to 3 full scan jobs enqueued.

#### Negative Example: Invalid signature

**Input:**
```
rawBody: Buffer containing valid JSON
headers: {
  'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000',
  'x-github-event': 'pull_request',
  'x-github-delivery': 'zzz-999',
  'content-type': 'application/json'
}
```

**Output:**
```json
{ "status": 401, "body": {} }
```

No side effects. No job enqueued. Log at ERROR: `DOCALIGN_E105`.

#### Edge Cases

- **Missing `x-hub-signature-256` header:** Return 401 immediately. Do not parse body.
- **Dual-secret rotation window:** Try new secret first, fall back to old. Accept if either matches.
- **`pull_request.closed` action:** Return 200 with `{ received: true }`, no scan enqueued.
- **Push to non-default branch:** Return 200, no scan. Check `payload.ref` against `payload.repository.default_branch`.
- **Unrecognized event type:** Return 200 (acknowledge receipt), log at DEBUG, no processing.
- **Payload >25MB:** Express body parser rejects with 413 before handler runs.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Invalid signature | DOCALIGN_E105 | Return 401. Log ERROR. No body logged. |
| JSON parse failure | DOCALIGN_E108 | Return 400. Payload might not be JSON. |
| Repo not found in DB | - | Return 200 (acknowledge). Log WARN. Possible unregistered repo. |
| Database error during lookup | DOCALIGN_E301 | Return 500. Retry via GitHub's webhook redelivery. |
| BullMQ enqueue failure | DOCALIGN_E601 | Return 500. GitHub will redeliver. |

---

### 4.2 getInstallationToken

#### Signature

```typescript
getInstallationToken(installationId: number): Promise<string>
```

#### Algorithm

```
function getInstallationToken(installationId):
  // 1. Check in-memory cache
  cached = tokenCache.get(installationId)
  if cached and cached.expiresAt - now > 5 minutes:
    return cached.token

  // 2. Generate JWT for GitHub App authentication
  now = Math.floor(Date.now() / 1000)
  jwt = sign({
    iat: now - 60,           // issued 60s ago (clock drift)
    exp: now + (10 * 60),    // expires in 10 minutes
    iss: config.github_app_id
  }, config.github_private_key, { algorithm: 'RS256' })

  // 3. Exchange JWT for installation access token
  response = POST /app/installations/{installationId}/access_tokens
    headers: { Authorization: "Bearer " + jwt }

  // 4. Cache and return
  tokenCache.set(installationId, {
    token: response.token,
    expiresAt: new Date(response.expires_at),
    installationId
  })

  return response.token
```

#### I/O Example 1: Cache miss (first request)

**Input:** `installationId: 12345678`

**Output:** `"ghs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`

Side effect: Token cached in `Map<number, CachedInstallationToken>` with 1-hour expiry.

#### I/O Example 2: Cache hit (within expiry window)

**Input:** `installationId: 12345678` (called again within 55 minutes)

**Output:** `"ghs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"` (same token, from cache)

No GitHub API call made.

#### Negative Example: Invalid private key

**Input:** `installationId: 12345678` (with corrupted `GITHUB_PRIVATE_KEY`)

**Output:** Throws `DocAlignError` with code `DOCALIGN_E103`, message "Failed to generate GitHub App JWT".

#### Edge Cases

- **Token expiring in <5 minutes:** Proactively refresh before expiry. Concurrent requests during refresh may briefly race; last writer wins (safe because all tokens for the same installation are equivalent).
- **GitHub API 401 on token exchange:** Clear cache entry, retry once with a fresh JWT. If still 401, the private key may be rotated -- throw DOCALIGN_E103.
- **GitHub API 5xx on token exchange:** Retry with `token-refresh` profile (500ms base, 2 retries).
- **Process restart:** Cache is empty. First request after restart triggers GitHub API call.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| JWT signing failure | DOCALIGN_E103 | Fatal for this installation. Log ERROR. Check private key env var. |
| GitHub 401 on exchange | DOCALIGN_E103 | Retry once with fresh JWT. If still fails, propagate. |
| GitHub 5xx on exchange | DOCALIGN_E101 | Retry with token-refresh profile. |
| Network timeout | DOCALIGN_E101 | Retry with token-refresh profile. |

---

### 4.3 createAgentTasks

#### Signature

```typescript
createAgentTasks(
  repoId: string,
  scanRunId: string,
  tasks: Array<{ type: AgentTaskType; payload: AgentTaskPayload }>
): Promise<string[]>  // returns task IDs
```

#### Algorithm

```
function createAgentTasks(repoId, scanRunId, tasks):
  // 1. Validate inputs
  if tasks.length === 0:
    return []

  // 2. Calculate expiry time from config
  expiresAt = NOW() + config.agent_task_timeout_minutes minutes

  // 3. Batch insert all tasks in a single transaction
  taskIds = []
  BEGIN TRANSACTION
    for each task in tasks:
      id = uuid()
      INSERT INTO agent_tasks (
        id, repo_id, scan_run_id, type, status, payload,
        claimed_by, error, expires_at, created_at, completed_at
      ) VALUES (
        id, repoId, scanRunId, task.type, 'pending', task.payload,
        null, null, expiresAt, NOW(), null
      )
      taskIds.push(id)
  COMMIT TRANSACTION

  // 4. Log creation
  log(INFO, "agent_tasks_created", {
    repoId, scanRunId, count: taskIds.length,
    types: tasks.map(t => t.type)
  })

  return taskIds
```

#### I/O Example 1: Create 3 verification tasks

**Input:**
```typescript
repoId: "550e8400-e29b-41d4-a716-446655440000",
scanRunId: "660e8400-e29b-41d4-a716-446655440001",
tasks: [
  { type: "verification", payload: { type: "verification", verification_path: 1, claim: {...}, evidence: {...}, routing_reason: "single_entity_mapped" } },
  { type: "verification", payload: { type: "verification", verification_path: 2, claim: {...}, mapped_files: [...], routing_reason: "multi_file" } },
  { type: "claim_extraction", payload: { type: "claim_extraction", doc_files: ["README.md"], project_context: {...} } }
]
```

**Output:**
```json
["770e8400-uuid-1", "770e8400-uuid-2", "770e8400-uuid-3"]
```

Side effect: 3 rows inserted in `agent_tasks` with status `'pending'` and `expires_at` 30 minutes from now.

#### I/O Example 2: Empty task list

**Input:**
```typescript
repoId: "550e8400-...", scanRunId: "660e8400-...", tasks: []
```

**Output:** `[]`

No database operations.

#### Negative Example: Database constraint violation (invalid repo_id)

**Input:**
```typescript
repoId: "nonexistent-repo-id",
scanRunId: "660e8400-...",
tasks: [{ type: "verification", payload: {...} }]
```

**Output:** Throws `DocAlignError` with code `DOCALIGN_E303`, message "Foreign key violation: repo_id does not exist".

Transaction rolled back. No tasks created.

#### Edge Cases

- **Large batch (200+ tasks):** Batch insert uses a single multi-row INSERT statement with parameter arrays. PostgreSQL handles this efficiently.
- **Duplicate scan_run_id + type combination:** Allowed. Multiple tasks of the same type per scan are valid (e.g., multiple verification tasks).
- **Task creation after scan is cancelled:** Caller (L4) is responsible for checking cancellation before calling this function.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| FK violation (repo_id) | DOCALIGN_E303 | Transaction rolled back. Caller handles. |
| FK violation (scan_run_id) | DOCALIGN_E303 | Transaction rolled back. Caller handles. |
| Database connection lost | DOCALIGN_E301 | Retry via per-call retry profile. |
| Serialization failure | DOCALIGN_E303 | Retry transaction once. |

---

### 4.4 getPendingTasks

#### Signature

```typescript
getPendingTasks(
  repoId: string,
  scanRunId?: string
): Promise<TaskListResponse>
```

#### Algorithm

```
function getPendingTasks(repoId, scanRunId?):
  // 1. Query pending tasks for this repo
  sql = `
    SELECT id, type, status, created_at, expires_at
    FROM agent_tasks
    WHERE repo_id = $1
      AND status = 'pending'
      AND expires_at > NOW()
  `
  params = [repoId]

  // 2. Optionally filter by scan_run_id
  if scanRunId:
    sql += " AND scan_run_id = $2"
    params.push(scanRunId)

  sql += " ORDER BY created_at ASC"

  // 3. Execute query
  result = db.query(sql, params)

  // 4. Format response
  return {
    tasks: result.rows.map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString()
    }))
  }
```

#### I/O Example 1: Two pending tasks

**Input:** `repoId: "550e8400-...", scanRunId: "660e8400-..."` **Output:** `{ tasks: [{ id: "770e-1", type: "claim_extraction", status: "pending", created_at: "...", expires_at: "..." }, { id: "770e-2", type: "verification", ... }] }`

#### I/O Example 2: No pending tasks

**Input:** `repoId: "550e8400-...", scanRunId: "660e8400-..."` **Output:** `{ tasks: [] }`

#### Negative Example: Token repo_id mismatch

This is caught at the middleware level before `getPendingTasks` is called. The middleware validates the DOCALIGN_TOKEN and extracts repo_id. If the query parameter `repo_id` does not match the token's repo_id, return HTTP 403.

#### Edge Cases

- **Expired tasks still in pending:** The `expires_at > NOW()` filter excludes them. They will be cleaned up by the expiration job.
- **Tasks claimed between list and GET:** The Action receives a list, then calls `GET /api/tasks/:id` to claim. If another Action run claims first, the GET returns 409.
- **No scan_run_id parameter:** Returns all pending tasks for the repo across all scans.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Database query timeout | DOCALIGN_E301 | Return 503. Action retries. |
| Invalid UUID format for repo_id | - | Return 400 via Zod validation. |

---

### 4.5 claimTask

#### Signature

```typescript
claimTask(
  taskId: string,
  repoId: string,
  actionRunId: string
): Promise<AgentTask>
```

#### Algorithm

```
function claimTask(taskId, repoId, actionRunId):
  // 1. Atomic claim via UPDATE ... WHERE claimed_by IS NULL
  //    Per decision 3B-D2: claiming happens during GET /api/tasks/:id
  result = db.query(`
    UPDATE agent_tasks
    SET status = 'in_progress',
        claimed_by = $1,
        expires_at = NOW() + INTERVAL '10 minutes'
    WHERE id = $2
      AND repo_id = $3
      AND claimed_by IS NULL
    RETURNING *
  `, [actionRunId, taskId, repoId])

  // 2. Handle claim outcomes
  if result.rowCount === 0:
    // Task was already claimed, expired, or does not exist
    existingTask = db.query(
      'SELECT id, status, claimed_by, expires_at FROM agent_tasks WHERE id = $1',
      [taskId]
    )

    if existingTask.rows.length === 0:
      throw DocAlignError(DOCALIGN_E404, "Task not found", { taskId })

    task = existingTask.rows[0]
    if task.status === 'expired' or task.expires_at < NOW():
      throw DocAlignError(DOCALIGN_E204, "Task expired", { taskId })

    if task.claimed_by is not null:
      throw DocAlignError(DOCALIGN_E205, "Task already claimed", { taskId, claimedBy: task.claimed_by })

  // 3. Log claim
  log(INFO, "agent_task_claimed", {
    taskId, repoId, actionRunId,
    taskType: result.rows[0].type
  })

  // 4. Return full task including payload
  return mapRowToAgentTask(result.rows[0])
```

#### I/O Example 1: Successful claim

**Input:** `taskId: "770e-1", repoId: "550e-...", actionRunId: "run-12345"`

**Output:**
```json
{
  "id": "770e-1",
  "repo_id": "550e-...",
  "scan_run_id": "660e-...",
  "type": "verification",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "payload": { "type": "verification", "verification_path": 1, "claim": {...}, "evidence": {...} },
  "error": null,
  "expires_at": "2026-02-11T14:40:00Z",
  "created_at": "2026-02-11T14:30:00Z",
  "completed_at": null
}
```

Side effect: `agent_tasks` row updated: `status='in_progress'`, `claimed_by='run-12345'`, `expires_at` extended by 10 minutes.

#### I/O Example 2: Task already expired

**Input:** `taskId: "770e-expired", repoId: "550e-...", actionRunId: "run-99"`

**Output:** Throws `DocAlignError` with code `DOCALIGN_E204`.

HTTP response: `{ "status": 410, "body": { "error": "DOCALIGN_E204", "message": "Task has expired. Result rejected." } }`

#### Negative Example: Task claimed by another run

**Input:** `taskId: "770e-1", repoId: "550e-...", actionRunId: "run-99999"` (task already claimed by "run-12345")

**Output:** Throws `DocAlignError` with code `DOCALIGN_E205`.

HTTP response: `{ "status": 409, "body": { "error": "DOCALIGN_E205", "message": "Task already completed by another Action run." } }`

#### Edge Cases

- **Race condition:** Two Action runs call `GET /api/tasks/:id` simultaneously. The `UPDATE ... WHERE claimed_by IS NULL` is atomic; exactly one succeeds, the other gets 409.
- **Task with wrong repo_id:** The `AND repo_id = $3` clause prevents cross-repo access. Returns 404 (not 403, to avoid leaking existence).
- **Task already completed:** Falls through to the "already claimed" path and returns 409.
- **Extended expiry:** Claiming resets `expires_at` to `NOW() + 10 minutes`, giving the agent fresh time regardless of how long the task was pending.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Task not found | 404 | Action skips this task. |
| Task expired | DOCALIGN_E204 / 410 | Action skips this task. |
| Task already claimed | DOCALIGN_E205 / 409 | Action skips this task. |
| Database connection lost | DOCALIGN_E301 | Action retries with backoff. |

---

### 4.6 submitTaskResult

#### Signature

```typescript
submitTaskResult(
  taskId: string,
  repoId: string,
  result: AgentTaskResult
): Promise<TaskResultResponse>
```

#### Algorithm

```
function submitTaskResult(taskId, repoId, result):
  // 1. Validate result against Zod schema (AgentTaskResultSchema)
  parseResult = AgentTaskResultSchema.safeParse(result)
  if not parseResult.success:
    throw DocAlignError(DOCALIGN_E202, "Result validation failed", {
      taskId, details: parseResult.error.issues
    })

  // 2. Check task state
  task = db.query(
    'SELECT id, status, claimed_by, expires_at, type FROM agent_tasks WHERE id = $1 AND repo_id = $2',
    [taskId, repoId]
  )

  if task.rows.length === 0:
    throw DocAlignError(404, "Task not found", { taskId })

  existingTask = task.rows[0]

  if existingTask.status === 'completed':
    throw DocAlignError(DOCALIGN_E205, "Task already completed", { taskId })

  if existingTask.status === 'expired' or existingTask.expires_at < NOW():
    throw DocAlignError(DOCALIGN_E204, "Task expired", { taskId })

  // 3. Validate result type matches task type
  if result.data.type !== existingTask.type
     and not (existingTask.type === 'verification' and result.data.type === 'verification'):
    throw DocAlignError(DOCALIGN_E202, "Result type does not match task type", {
      taskId, expected: existingTask.type, received: result.data.type
    })

  // 4. Apply post-processing rules (3C-005: drifted with no evidence -> uncertain)
  processedData = applyPostProcessingRules(result.data, existingTask.type)

  // 5. Update task record
  db.query(`
    UPDATE agent_tasks
    SET status = $1,
        completed_at = NOW(),
        error = $2
    WHERE id = $3
  `, [
    result.success ? 'completed' : 'failed',
    result.success ? null : result.error,
    taskId
  ])

  // 6. Log result
  log(INFO, "agent_task_result", {
    taskId,
    taskType: existingTask.type,
    status: result.success ? 'completed' : 'failed',
    durationMs: result.metadata.duration_ms,
    model: result.metadata.model_used,
    tokens: result.metadata.tokens_used,
    costUsd: result.metadata.cost_usd
  })

  return { status: 'accepted', task_id: taskId }
```

#### I/O Example 1: Successful verification result

**Input:**
```json
{
  "task_id": "770e-3",
  "success": true,
  "data": {
    "type": "verification",
    "verdict": "drifted",
    "confidence": 0.95,
    "reasoning": "Code uses argon2, not bcrypt.",
    "evidence_files": ["src/auth/password.ts"],
    "specific_mismatch": "Docs say bcrypt, code uses argon2",
    "suggested_fix": "Authentication uses argon2id."
  },
  "metadata": { "duration_ms": 2340, "model_used": "claude-sonnet-4-20250514", "tokens_used": 1250, "cost_usd": 0.008 }
}
```

**Output:**
```json
{ "status": "accepted", "task_id": "770e-3" }
```

#### I/O Example 2: Failed task submission (agent error)

**Input:**
```json
{
  "task_id": "770e-4",
  "success": false,
  "error": "LLM API returned 429: rate limited",
  "data": { "type": "verification", "verdict": "uncertain", "confidence": 0, "reasoning": "Rate limited", "evidence_files": [] },
  "metadata": { "duration_ms": 500 }
}
```

**Output:**
```json
{ "status": "accepted", "task_id": "770e-4" }
```

Task status set to `'failed'`, error stored.

#### Negative Example: Zod validation failure

**Input:**
```json
{
  "task_id": "770e-5",
  "success": true,
  "data": {
    "type": "verification",
    "verdict": "INVALID_VERDICT",
    "confidence": 2.0
  },
  "metadata": { "duration_ms": 100 }
}
```

**Output:** HTTP 400:
```json
{
  "error": "DOCALIGN_E202",
  "message": "Result validation failed.",
  "details": [
    { "path": ["data", "verdict"], "message": "Invalid enum value" },
    { "path": ["data", "confidence"], "message": "Number must be less than or equal to 1" }
  ]
}
```

#### Edge Cases

- **Drifted verdict with empty evidence_files:** Per 3C-005, verdict downgraded to `uncertain` with reason "Drift reported but no supporting evidence provided."
- **Verified verdict with empty evidence_files:** Accepted but confidence reduced by 0.3 (floor 0.2).
- **Double submission (same task, same run):** Second call sees task status is `completed`, returns 409.
- **Late result (task expired):** Returns 410 Gone. Result discarded.
- **success:false with valid data:** Task marked `'failed'`, error string stored, claim treated as `uncertain`.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Zod validation failure | DOCALIGN_E202 / 400 | Action retries once. Second failure = task marked failed. |
| JSON parse failure | DOCALIGN_E201 / 400 | Action retries once. |
| Task not found | 404 | Action logs and moves on. |
| Task already completed | DOCALIGN_E205 / 409 | Action logs and moves on. |
| Task expired | DOCALIGN_E204 / 410 | Action logs and moves on. |
| Database error | DOCALIGN_E301 / 500 | Action retries with backoff. |

---

### 4.7 validateToken

#### Signature

```typescript
validateToken(
  token: string,
  repoId: string
): Promise<boolean>
```

#### Algorithm

```
function validateToken(token, repoId):
  // 1. Format check (XREF-001: simplified format)
  if not token.startsWith('docalign_'):
    return false

  // 2. Length check (prefix 9 chars + 64 hex chars = 73 total)
  if token.length !== 73:
    return false

  // 3. Hash the token
  hash = SHA256(token).hex()

  // 4. Compare against stored hash
  result = db.query(
    'SELECT id FROM repos WHERE id = $1 AND token_hash = $2',
    [repoId, hash]
  )

  return result.rows.length > 0
```

#### I/O Example 1: Valid token

**Input:** `token: "docalign_a1b2c3...f0a1b2"`, `repoId: "550e8400-..."` **Output:** `true`

#### I/O Example 2: Valid format but wrong repo

**Input:** `token: "docalign_<valid_hex_for_different_repo>"`, `repoId: "550e8400-..."` **Output:** `false` (hash mismatch)

#### Negative Example: Malformed token

**Input:** `token: "invalid_prefix_abcdef"` **Output:** `false` (rejected at format check, no DB query)

#### Edge Cases

- **Empty token / wrong prefix / wrong length:** Returns false at format check (no DB query).
- **Deleted repo / NULL token_hash:** Query returns no rows. Returns false.
- **Constant-time comparison not needed:** We compare against a stored hash via SQL equality, not a raw secret.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Database connection error | DOCALIGN_E301 | Propagate. Caller returns 503. |
| Database query timeout | DOCALIGN_E301 | Propagate. Caller returns 503. |

---

### 4.8 healthCheck

#### Signature

```typescript
healthCheck(): Promise<HealthResponse>
```

#### Algorithm

```
function healthCheck():
  // 1. Check Redis connectivity (per 3D-002: health does NOT check PostgreSQL)
  redisOk = false
  try:
    pong = await redis.ping()
    redisOk = (pong === 'PONG')
  catch:
    redisOk = false

  // 2. Get queue metrics
  queueDepth = 0
  activeJobs = 0
  waitingJobs = 0
  if redisOk:
    counts = await queue.getJobCounts('waiting', 'active')
    activeJobs = counts.active
    waitingJobs = counts.waiting
    queueDepth = activeJobs + waitingJobs

  // 3. Calculate uptime
  uptimeSeconds = Math.floor((Date.now() - processStartTime) / 1000)

  // 4. Determine status
  status = redisOk ? 'ok' : 'degraded'

  return {
    status,
    redis: redisOk,
    queue_depth: queueDepth,
    active_jobs: activeJobs,
    waiting_jobs: waitingJobs,
    uptime_seconds: uptimeSeconds
  }
```

#### I/O Example 1: Healthy system

**Output:** `{ status: "ok", redis: true, queue_depth: 5, active_jobs: 2, waiting_jobs: 3, uptime_seconds: 86400 }` -- HTTP 200.

#### I/O Example 2: Redis unreachable

**Output:** `{ status: "degraded", redis: false, queue_depth: 0, active_jobs: 0, waiting_jobs: 0, uptime_seconds: 3600 }` -- HTTP 503.

#### Negative Example: N/A

Health check takes no user input. Always returns a response; only variable is internal state.

#### Edge Cases

- **Redis ping timeout:** Treat as `redis: false`. Use a 2-second timeout on the ping.
- **BullMQ `getJobCounts` failure:** Set all counts to 0, still report `redis: false`.
- **Very high queue depth (>1000):** Report accurately. Health check does NOT fail on high queue depth (that is a capacity issue, not a health issue -- per 3D-006).
- **Called during shutdown:** Server stops accepting new requests on SIGTERM, but in-flight health checks complete normally.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Redis unreachable | - | Return 503 with `status: 'degraded'`. |
| Unexpected error | - | Return 503 with `status: 'degraded'`. |

---

### 4.9 generateRepoToken

#### Signature

```typescript
generateRepoToken(): { token: string; hash: string }
```

#### Algorithm

```
function generateRepoToken():
  // 1. Generate 32 random bytes (XREF-001: simplified format)
  randomBytes = crypto.randomBytes(32)

  // 2. Construct token with prefix
  token = "docalign_" + randomBytes.toString('hex')

  // 3. Hash for storage
  hash = crypto.createHash('sha256').update(token).digest('hex')

  return { token, hash }
```

#### I/O Example 1: Token generation

**Output:** `{ token: "docalign_a1b2c3...f0a1b2" (73 chars), hash: "e3b0c442...b855" (64 hex) }`. Token returned to user once; hash stored in `repos.token_hash`.

#### I/O Example 2: Second call

**Output:** Different token and hash (cryptographically random on every call).

#### Negative Example: N/A

No failure mode under normal operation. `crypto.randomBytes` only fails if system entropy is exhausted (extremely rare).

#### Edge Cases

- **Token format consistency:** Always exactly 73 characters (9-char prefix + 64-hex).
- **Hash determinism:** Same token always produces same hash.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Entropy pool exhausted | - | `crypto.randomBytes` blocks until available. |

---

### 4.10 handleDismiss

#### Signature

```typescript
handleDismiss(
  queryParams: { token: string; claim_id: string; scan_run_id: string; repo_id: string; pr_number: string }
): Promise<{ redirect_url: string }>
```

#### Algorithm

```
function handleDismiss(params):
  // 1. Validate HMAC dismiss token (per 3E Section 2.4)
  valid = validateDismissToken(
    params.token,
    params.repo_id,
    parseInt(params.pr_number),
    params.scan_run_id
  )

  if not valid:
    throw DocAlignError(400, "Invalid or expired dismiss token")

  // 2. Look up repo to get GitHub owner/repo
  repo = db.query('SELECT github_owner, github_repo FROM repos WHERE id = $1', [params.repo_id])
  if repo.rows.length === 0:
    throw DocAlignError(404, "Repository not found")

  // 3. Record feedback (all_dismissed)
  INSERT INTO feedback (id, repo_id, claim_id, feedback_type, pr_number, created_at)
  VALUES (uuid(), params.repo_id, params.claim_id, 'all_dismissed', parseInt(params.pr_number), NOW())

  // 4. Redirect to PR
  owner = repo.rows[0].github_owner
  repoName = repo.rows[0].github_repo
  redirect_url = "https://github.com/" + owner + "/" + repoName + "/pull/" + params.pr_number

  return { redirect_url }
```

#### I/O Example 1: Valid dismiss

**Input:** `token=<valid_hmac>, claim_id=claim-001, scan_run_id=660e-..., repo_id=550e-..., pr_number=42` **Output:** HTTP 302 redirect to `https://github.com/acme/webapp/pull/42`. Side effect: feedback record created with `feedback_type: 'all_dismissed'`.

#### I/O Example 2: Expired token (>7 days old)

**Input:** `token=<expired_hmac>, ...` **Output:** HTTP 400 `{ "error": "Invalid or expired dismiss token." }`

#### Negative Example: Forged token

**Input:** `token=12345.abcdef, ...` **Output:** HTTP 400 `{ "error": "Invalid or expired dismiss token." }`

#### Edge Cases

- **Token reuse within 7-day window:** Allowed. Feedback may be recorded multiple times; count-based exclusion counts unique feedback records.
- **Repo deleted between token generation and click:** Returns 404.
- **scan_run_id mismatch:** Token validation fails because scan_run_id is part of the HMAC payload. Returns 400.

#### Error Handling

| Error | Code | Recovery |
|-------|------|----------|
| Invalid token | 400 | User sees error page. |
| Repo not found | 404 | User sees error page. |
| Database error | DOCALIGN_E301 / 500 | User sees error page. |

---

## 5. Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Webhook response time (signature verify + enqueue) | < 500ms (p99) | GitHub requires response within 10s. Our target is well under. |
| Health check response time | < 50ms (p99) | Railway polls every 30s. Must be fast. |
| `GET /api/tasks/pending` response time | < 200ms (p99) | Action polls this on startup. |
| `GET /api/tasks/:id` (claim + payload return) | < 300ms (p99) | Includes atomic UPDATE + full payload read. |
| `POST /api/tasks/:id/result` (validate + store) | < 500ms (p99) | Zod validation + DB write. |
| Token validation | < 50ms (p99) | Single indexed query on `(id, token_hash)`. |
| Installation token fetch (cache miss) | < 2000ms (p99) | Network round-trip to GitHub API. |
| Installation token fetch (cache hit) | < 1ms | In-memory Map lookup. |
| Database migration (full from scratch) | < 30s | All 14 migrations in sequence. |
| BullMQ job enqueue | < 50ms (p99) | Redis RPUSH. |
| Graceful shutdown | < 30s | Wait for in-progress jobs to complete. |
| PostgreSQL connection pool | max 10 connections | MVP single-process; upgrade at 10+ customers. |
| Concurrent webhook handling | 50 req/s | Express default. Adequate for MVP. |
| Memory footprint (server process) | < 300MB | Well within Railway's 512MB limit. |

---

## 6. Required Framework Knowledge

### 6.1 Express.js

- Raw body parsing for webhook signature verification (`express.raw({ type: 'application/json' })` on the `/webhook` route, `express.json()` on other routes).
- Middleware ordering: raw body -> signature verify -> JSON parse -> route handler.
- Error handling middleware (final `app.use((err, req, res, next) => {...})`).
- Trust proxy setting (`app.set('trust proxy', true)`) for Railway's reverse proxy.

### 6.2 node-postgres (pg)

- Connection pooling via `new Pool({ connectionString, ssl, max, idleTimeoutMillis, connectionTimeoutMillis })`.
- Parameterized queries: `pool.query('SELECT ... WHERE id = $1', [id])`.
- Transaction pattern: `const client = await pool.connect(); try { await client.query('BEGIN'); ... await client.query('COMMIT'); } catch { await client.query('ROLLBACK'); } finally { client.release(); }`.
- SSL configuration for Supabase: `ssl: { rejectUnauthorized: true }`.

### 6.3 BullMQ

- Queue creation: `new Queue('repo-{repoId}', { connection: redisConnection })`.
- Job options: `{ jobId, removeOnComplete: true, removeOnFail: false, attempts: 3, backoff: { type: 'exponential', delay: 1000 } }`.
- Worker creation: `new Worker('repo-{repoId}', processor, { connection, concurrency: 1 })`.
- Debounce via job ID: adding a job with the same ID replaces it if not yet started.
- Graceful shutdown: `worker.close(30_000)` waits for in-progress jobs.
- Job counts: `queue.getJobCounts('waiting', 'active', 'completed', 'failed')`.

### 6.4 GitHub App Authentication

- JWT signing with `jsonwebtoken`: `jwt.sign({ iat, exp, iss }, privateKey, { algorithm: 'RS256' })`.
- Installation token exchange via `@octokit/auth-app` or direct REST call.
- `X-GitHub-Api-Version: 2022-11-28` header on all API calls.
- Webhook signature verification: HMAC-SHA256 with `timingSafeEqual`.

### 6.5 node-pg-migrate

- Migration files in `migrations/` directory, numbered sequentially.
- `npm run migrate:up` applies all pending migrations.
- `npm run migrate:down` rolls back the last migration.
- Migrations run in Railway's `buildCommand` (pre-deploy).
- Each migration must be backwards-compatible (additive only).

### 6.6 Pino Logging

- Structured JSON logging to stdout.
- Child loggers for per-request context: `logger.child({ requestId, repoId })`.
- Redaction of sensitive fields: `redact: { paths: ['token', 'apiKey', ...] }`.
- Log levels: `debug`, `info`, `warn`, `error`, `fatal`.

---

## 7. Open Questions

| # | Question | Context | Impact | Proposed Resolution |
|---|----------|---------|--------|-------------------|
| 1 | Should webhook handler check delivery ID dedup in Redis (replay protection) for MVP? | XREF-002 defers this to post-MVP. BullMQ job ID dedup provides partial protection. | Low for MVP. GitHub rarely redelivers. BullMQ dedup covers the main case. | Skip for MVP. Rely on BullMQ job ID dedup. Add Redis delivery ID dedup post-MVP. |
| 2 | Should the API server and BullMQ worker run in the same process or separate processes for MVP? | 3D Section 1.1 says single process. At scale, separate for independent scaling. | Affects deployment config and resource allocation. | Single process for MVP per 3D. Split at >5 concurrent jobs (3D Section 12, Open Decision 4). |
| 3 | Should `GET /api/tasks/:id` extend expires_at on claim or use the original expiry? | 3B Section 2.2.2 says extends by 10 minutes from claim time. But this means fast-claiming tasks get more total time. | Minor. The 10-minute extension is generous. | Follow 3B: extend by 10 minutes from claim time. Agent has fresh 10 minutes to work. |
| 4 | How should the server handle a `repository_dispatch` that returns 404 but the repo was previously active? | Could mean the Action workflow file was deleted. | Repo enters a broken state if we do not handle it. | Set repo status to `awaiting_setup`. Post Check Run with setup instructions. Skip agent tasks, run deterministic only. |

---

## Appendix A: Database Schema Summary

All tables with key columns, constraints, and indexes. Column definitions match `phase4-api-contracts.md` Section 12. All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. All have `repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE` except `repos` itself.

### A.1 repos

Key columns: `github_owner TEXT`, `github_repo TEXT` (UNIQUE together), `github_installation_id INTEGER`, `default_branch TEXT DEFAULT 'main'`, `status TEXT CHECK IN ('onboarding','awaiting_setup','scanning','active','partial','error')`, `last_indexed_commit TEXT`, `last_full_scan_at TIMESTAMPTZ`, `config JSONB DEFAULT '{}'`, `health_score REAL`, `total_claims INTEGER DEFAULT 0`, `verified_claims INTEGER DEFAULT 0`, `token_hash TEXT`, `updated_at TIMESTAMPTZ`.

Indexes: `(github_installation_id)`, `(github_owner, github_repo)`.

### A.2 scan_runs

Key columns: `trigger_type TEXT CHECK IN ('pr','push','scheduled','manual','agent_report')`, `trigger_ref TEXT`, `status TEXT CHECK IN ('queued','running','completed','partial','failed','cancelled')`, `commit_sha TEXT NOT NULL`, `claims_checked/drifted/verified/uncertain INTEGER DEFAULT 0`, `total_token_cost INTEGER`, `total_duration_ms INTEGER`, `comment_posted BOOLEAN DEFAULT false`, `check_run_id BIGINT`, `started_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ`.

Indexes: `(repo_id)`, `(status) WHERE status IN ('queued','running')`, `(repo_id, trigger_type, started_at DESC)`.

### A.3 code_entities

Key columns: `file_path TEXT`, `line_number INTEGER`, `end_line_number INTEGER`, `entity_type TEXT CHECK IN ('function','class','route','type','config')`, `name TEXT`, `signature TEXT`, `raw_code TEXT`, `embedding VECTOR(1536)`, `last_commit_sha TEXT`, `updated_at TIMESTAMPTZ`.

Indexes: `(repo_id, file_path)`, `(repo_id, name)`, `(repo_id, entity_type)`.

### A.4 claims

Key columns: `source_file TEXT`, `line_number INTEGER`, `claim_text TEXT`, `claim_type TEXT CHECK IN ('path_reference','dependency_version','command','api_route','code_example','behavior','architecture','config','convention','environment')`, `testability TEXT CHECK IN ('syntactic','semantic','untestable')`, `extracted_value JSONB`, `keywords TEXT[]`, `extraction_confidence REAL`, `extraction_method TEXT CHECK IN ('regex','heuristic','llm')`, `verification_status TEXT DEFAULT 'pending'`, `last_verified_at TIMESTAMPTZ`, `embedding VECTOR(1536)`, `last_verification_result_id UUID`, `parent_claim_id UUID REFERENCES claims(id) ON DELETE SET NULL`, `updated_at TIMESTAMPTZ`.

Indexes: `(repo_id)`, `(repo_id, source_file)`, `(repo_id, claim_type)`, `(repo_id, verification_status)`.

### A.5 claim_mappings

Key columns: `claim_id UUID REFERENCES claims(id) ON DELETE CASCADE`, `code_file TEXT`, `code_entity_id UUID REFERENCES code_entities(id) ON DELETE SET NULL`, `confidence REAL`, `co_change_boost REAL DEFAULT 0.0`, `mapping_method TEXT CHECK IN ('direct_reference','symbol_search','semantic_search','llm_assisted','manual','co_change')`, `last_validated_at TIMESTAMPTZ`.

Indexes: `(claim_id)`, `(repo_id, code_file)`, `(code_entity_id) WHERE code_entity_id IS NOT NULL`.

### A.6 verification_results

Key columns: `claim_id UUID REFERENCES claims(id) ON DELETE CASCADE`, `scan_run_id UUID REFERENCES scan_runs(id) ON DELETE SET NULL`, `verdict TEXT CHECK IN ('verified','drifted','uncertain')`, `confidence REAL`, `tier INTEGER`, `severity TEXT CHECK IN ('high','medium','low')`, `reasoning TEXT`, `specific_mismatch TEXT`, `suggested_fix TEXT`, `evidence_files TEXT[]`, `token_cost INTEGER`, `duration_ms INTEGER`, `post_check_result TEXT CHECK IN ('confirmed','contradicted','skipped')`, `verification_path INTEGER CHECK IN (1,2)`.

Indexes: `(claim_id, created_at DESC)`, `(scan_run_id)`, `(repo_id, verdict)`.

### A.7 agent_tasks

Key columns: `scan_run_id UUID NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE`, `type TEXT CHECK IN ('claim_extraction','verification','claim_classification','fix_generation','post_check','feedback_interpretation')`, `status TEXT CHECK IN ('pending','in_progress','completed','failed','expired')`, `payload JSONB NOT NULL`, `claimed_by TEXT`, `error TEXT`, `expires_at TIMESTAMPTZ NOT NULL`, `completed_at TIMESTAMPTZ`.

Indexes: `(repo_id, status) WHERE status = 'pending'`, `(scan_run_id)`, `(expires_at) WHERE status IN ('pending','in_progress')`.

### A.8 feedback

Key columns: `claim_id UUID REFERENCES claims(id) ON DELETE CASCADE`, `verification_result_id UUID REFERENCES verification_results(id) ON DELETE SET NULL`, `feedback_type TEXT CHECK IN ('thumbs_up','thumbs_down','fix_accepted','fix_dismissed','all_dismissed')`, `quick_pick_reason TEXT CHECK IN ('not_relevant_to_this_file','intentionally_different','will_fix_later','docs_are_aspirational','this_is_correct')`, `free_text TEXT`, `github_user TEXT`, `pr_number INTEGER`.

Indexes: `(repo_id)`, `(claim_id)`, `(claim_id, feedback_type)`.

### A.9 co_changes

Key columns: `code_file TEXT`, `doc_file TEXT`, `commit_sha TEXT`, `committed_at TIMESTAMPTZ`.

Indexes: `(repo_id)`, `(repo_id, code_file, doc_file)`, `(committed_at)`.

### A.10 agent_drift_reports

Key columns: `claim_id UUID REFERENCES claims(id) ON DELETE SET NULL`, `doc_file TEXT`, `line_number INTEGER`, `claim_text TEXT`, `actual_behavior TEXT`, `evidence_files TEXT[]`, `agent_type TEXT`, `verification_status TEXT DEFAULT 'pending'`.

Indexes: `(repo_id)`.

### A.11 suppression_rules

Key columns: `scope TEXT CHECK IN ('claim','file','claim_type','pattern')`, `target_claim_id UUID REFERENCES claims(id) ON DELETE CASCADE`, `target_file TEXT`, `target_claim_type TEXT`, `target_pattern TEXT`, `reason TEXT NOT NULL`, `source TEXT CHECK IN ('quick_pick','count_based','agent_interpreted')`, `expires_at TIMESTAMPTZ`, `revoked BOOLEAN DEFAULT false`.

Indexes: `(repo_id) WHERE revoked = false`, `(target_claim_id) WHERE revoked = false AND target_claim_id IS NOT NULL`.

---

## Appendix B: API Route Definitions

### B.1 Route Table

| Method | Path | Auth | Handler | Middleware |
|--------|------|------|---------|-----------|
| POST | `/webhook` | HMAC signature | `handleWebhook` | `express.raw({ type: 'application/json', limit: '25mb' })` |
| GET | `/health` | None | `healthCheck` | None |
| GET | `/api/tasks/pending` | Bearer DOCALIGN_TOKEN | `getPendingTasks` | `express.json()`, `authMiddleware`, `validateQuery({ repo_id: z.string().uuid() })` |
| GET | `/api/tasks/:id` | Bearer DOCALIGN_TOKEN | `claimTask` | `express.json()`, `authMiddleware` |
| POST | `/api/tasks/:id/result` | Bearer DOCALIGN_TOKEN | `submitTaskResult` | `express.json({ limit: '1mb' })`, `authMiddleware` |
| GET | `/api/dismiss` | HMAC token (query param) | `handleDismiss` | None |

### B.2 Middleware Stack

**Global:** `helmet()` (security headers), `pino-http` (request logging), `cors({ origin: false })` (server-to-server only). **Per-route:** `/webhook` uses `express.raw({ limit: '25mb' })` for signature verification; `/api/*` uses `express.json({ limit: '1mb' })` + `authMiddleware`; `/health` and `/api/dismiss` have no auth middleware. **Error handler:** final middleware maps `DocAlignError` to HTTP response.

### B.3 Auth Middleware

Extracts Bearer token from `Authorization` header. Extracts `repo_id` from query param or task lookup (per INFRA-003). Calls `validateToken(token, repoId)`. On success, attaches `req.repoId` and calls `next()`. On failure, returns 401 `{ error: 'Invalid or missing DOCALIGN_TOKEN.' }`. Missing `repo_id` returns 400.

---

## Appendix C: railway.toml Configuration

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build && npm run migrate:up"

[deploy]
startCommand = "node dist/app.js"
healthcheckPath = "/health"
healthcheckTimeout = 5
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### C.1 Build and Deploy Flow

1. **Build phase:** Railway runs `npm run build` (TypeScript compilation) then `npm run migrate:up` (database migrations). Migrations complete before the new instance starts serving traffic.
2. **Deploy phase:** Railway starts `node dist/app.js`. The new instance runs health checks.
3. **Rolling deploy:** Old instance continues serving until new instance is healthy. Traffic switches. Old instance receives SIGTERM.
4. **Graceful shutdown:** On SIGTERM, server stops accepting new requests, waits up to 30s for in-progress BullMQ jobs, closes Redis and DB connections, exits with code 0.

### C.2 Graceful Shutdown

On SIGTERM: (1) `server.close()` stops new requests, (2) `worker.close(30_000)` waits for in-progress BullMQ jobs, (3) close Redis and DB connections, (4) `process.exit(0)`.

---

## Appendix D: Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP server port |
| `NODE_ENV` | No | `production` | Environment name |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `GITHUB_APP_ID` | Yes | - | GitHub App numeric ID |
| `GITHUB_PRIVATE_KEY` | Yes | - | GitHub App private key (PEM format, newlines as `\n`) |
| `GITHUB_WEBHOOK_SECRET` | Yes | - | Webhook signature verification secret |
| `GITHUB_WEBHOOK_SECRET_OLD` | No | - | Previous webhook secret (during rotation window) |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string (SSL required) |
| `REDIS_URL` | Yes | - | Redis connection string |
| `DOCALIGN_API_SECRET` | Yes | - | Secret for HMAC dismiss tokens |
| `DOCALIGN_TOKEN_TTL_DAYS` | No | `365` | Token expiry in days |
| `SCAN_TIMEOUT_MINUTES` | No | `10` | Server-side scan job timeout |
| `AGENT_TASK_TIMEOUT_MINUTES` | No | `30` | Agent task expiry from creation |
| `RETRY_PER_CALL_MAX` | No | `2` | Max per-call retries |
| `RETRY_PER_JOB_MAX` | No | `3` | Max per-job retries |

All required environment variables are validated at startup using Zod. If any required variable is missing, the server logs the missing variable names and exits with code 1. Optional variables use their documented defaults.

---

## Appendix E: GitHub App Permissions & Events

| Permission | Level | Used For |
|-----------|-------|----------|
| `contents: read` | Read | Read repo files, send repository dispatch |
| `pull_requests: write` | Write | Post PR comments, create reviews with suggestions |
| `metadata: read` | Read | Repo metadata (automatic with any GitHub App) |
| `checks: write` | Write | Create and update Check Runs |

**Webhook Event Subscriptions:**

| Event | Actions Handled |
|-------|----------------|
| `pull_request` | `opened`, `synchronize`, `closed` |
| `push` | (default branch only) |
| `installation` | `created`, `deleted` |
| `installation_repositories` | `added`, `removed` |
| `pull_request_review` | `submitted` |

All GitHub REST API calls include `X-GitHub-Api-Version: 2022-11-28`.

---

## Appendix F: Migration Dependency Order

Migrations are sequential, backwards-compatible (additive only), ordered for FK constraint satisfaction.

```
0001_enable_pgcrypto          -- gen_random_uuid() support
0002_create_repos             -- root table, no FK dependencies
0003_create_scan_runs         -- depends on repos
0004_create_code_entities     -- depends on repos
0005_create_claims            -- depends on repos
0006_create_claim_mappings    -- depends on claims, repos, code_entities
0007_create_verification_results -- depends on claims, repos, scan_runs
0008_create_agent_tasks       -- depends on repos, scan_runs
0009_create_feedback          -- depends on repos, claims, verification_results
0010_create_co_changes        -- depends on repos
0011_create_agent_drift_reports -- depends on repos, claims
0012_create_suppression_rules -- depends on repos, claims
0013_enable_pgvector          -- CREATE EXTENSION vector
0014_add_vector_columns       -- ADD COLUMN embedding VECTOR(1536) to code_entities, claims
0015_create_vector_indexes    -- HNSW indexes on embedding columns
```

npm scripts: `migrate:up` = `node-pg-migrate up`, `migrate:down` = `node-pg-migrate down --count 1`, `migrate:create` = `node-pg-migrate create --template-file-name migrations/template.ts`. Rollback is manual: code rollback first (`railway rollback`), then database (`npm run migrate:down`).

---

## Appendix G: Scheduled Jobs (BullMQ Repeatable)

| Job | Schedule | Description |
|-----|----------|-------------|
| `expire-agent-tasks` | Every hour | Mark pending/in_progress tasks past `expires_at` as `expired`. Set associated claims to `uncertain`. |
| `cleanup-agent-tasks` | Every 24 hours | Delete agent_task rows older than 30 days (completed) or 48 hours (expired). |
| `cleanup-scan-runs` | Weekly | Archive scan_runs older than 90 days. |
| `cleanup-verification-results` | Weekly | Keep only last 10 results per claim. Delete older ones. |
| `cleanup-co-changes` | Weekly | Delete co_changes older than 180 days. |
| `db-health-check` | Every 5 minutes | Query `pg_stat_activity`, `pg_total_relation_size()`, dead tuple ratio. Log as structured JSON. |

---

## Appendix H: Local Development

Docker Compose runs `pgvector/pgvector:pg16` on port 5432 (user/pass/db: `docalign/docalign/docalign_dev`) and `redis:7-alpine` on port 6379. Both have healthchecks. Local `.env` sets `DATABASE_URL=postgres://docalign:docalign@localhost:5432/docalign_dev`, `REDIS_URL=redis://localhost:6379`, test values for `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `DOCALIGN_API_SECRET`, and `NODE_ENV=development`, `LOG_LEVEL=debug`.
```
