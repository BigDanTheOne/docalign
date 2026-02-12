# Phase 3B: Integration Specifications

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 3: Architecture Design Document
>
> **Inputs:** Phase 3A System Architecture, PRD (post-reconciliation), Phase 2.5 Audit Findings (A13-A21, G1-G8), ADR: Agent-First Architecture, Spike B: Evidence Assembly, Technical Reference
>
> **Date:** 2026-02-11

---

## Table of Contents

1. [GitHub API Integration](#1-github-api-integration)
2. [Agent Task API (Detailed)](#2-agent-task-api-detailed)
3. [LLM API Integration (Client-Side)](#3-llm-api-integration-client-side)
4. [MCP Protocol (v2)](#4-mcp-protocol-v2)
5. [Audit Finding Resolutions](#5-audit-finding-resolutions)
6. [Cross-References](#6-cross-references)

---

## 1. GitHub API Integration

All GitHub API calls use the REST API v3 unless noted. Pin header: `X-GitHub-Api-Version: 2022-11-28`. SDK: `@octokit/rest` (TypeScript).

### 1.1 Webhook Events

DocAlign subscribes to 4 webhook event types. All webhooks are delivered to `POST /webhook`.

#### 1.1.1 `pull_request`

**Actions handled:** `opened`, `synchronize`, `closed`

**Signature verification:**

```
X-Hub-Signature-256: sha256=<hex_digest>
```

Verification algorithm:

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

**Replay protection (audit finding S1 -- cross-ref to Phase 3E):** Store `X-GitHub-Delivery` header values in Redis with a 5-minute TTL. Reject duplicate delivery IDs. This provides both idempotency and replay protection. Note: GitHub does not include a standard timestamp header, so replay protection is based on delivery ID dedup, NOT on timestamp parsing. (Post-MVP; see XREF-002 for MVP security posture.)

**Request headers consumed:**

| Header | Usage |
|--------|-------|
| `X-Hub-Signature-256` | HMAC-SHA256 verification |
| `X-GitHub-Event` | Event type routing |
| `X-GitHub-Delivery` | Idempotency key (BullMQ job dedup) |
| `Content-Type` | Must be `application/json` |

**Payload handling for `pull_request.opened` / `pull_request.synchronize`:**

```typescript
// Extracted fields from webhook payload
interface PRWebhookPayload {
  action: 'opened' | 'synchronize' | 'closed';
  number: number;                            // PR number
  pull_request: {
    head: {
      sha: string;                           // current HEAD commit SHA
      ref: string;                           // branch name
    };
    base: {
      ref: string;                           // target branch
    };
  };
  repository: {
    id: number;                              // GitHub repo ID
    full_name: string;                       // "owner/repo"
    owner: { login: string };
    name: string;
  };
  installation: {
    id: number;                              // GitHub installation ID
  };
}
```

**Server response:** Respond `HTTP 200 OK` with `{ received: true }` within 10 seconds (GitHub timeout). Actual processing is async via BullMQ.

**Processing flow:**

1. Verify signature -- reject with `HTTP 401` if invalid.
2. Parse payload, extract `installation.id`.
3. Look up `repos` record by `github_installation_id` + `repository.full_name`.
4. If `action === 'closed'` -- no scan. Log and return.
5. Check rate limits (per-repo, per-org). If exceeded, return `200` (no scan, log).
6. Enqueue BullMQ job:
   - Queue: `repo-{repo_id}`
   - Job ID: `pr-scan-{repo_id}-{pr_number}` (enables debounce)
   - Payload: `{ repo_id, pr_number, head_sha, base_ref, installation_id, delivery_id }`
   - Debounce: if job with same ID exists and is not yet started, replace it. If in progress, mark for cancellation.

#### 1.1.2 `push`

**Actions handled:** Push events to the default branch only.

**Payload fields consumed:**

```typescript
interface PushWebhookPayload {
  ref: string;                  // "refs/heads/main"
  after: string;                // new HEAD SHA
  before: string;               // previous HEAD SHA
  commits: Array<{
    id: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
  };
  installation: { id: number };
}
```

**Processing:** Extract branch from `ref`. If not the default branch, ignore. Otherwise, enqueue a push scan job.

#### 1.1.3 `installation`

**Actions handled:** `created`, `deleted`

**`installation.created` payload:**

```typescript
interface InstallationCreatedPayload {
  action: 'created';
  installation: {
    id: number;
    account: { login: string; type: 'User' | 'Organization' };
    permissions: Record<string, string>;
  };
  repositories: Array<{
    id: number;
    full_name: string;
    private: boolean;
  }>;
}
```

**Processing on `created`:**

1. For each repository in `repositories`:
   a. Create `repos` record: `{ github_installation_id, github_owner, github_repo, default_branch, status: 'onboarding' }`.
   b. Check whether the DocAlign Action workflow exists (via GitHub API file content check).
   c. If Action exists: set `status = 'scanning'`, queue full scan.
   d. If Action does not exist: set `status = 'awaiting_setup'`, create Check Run with setup instructions.

**`installation.deleted` processing:**

1. Look up all `repos` records for this `installation.id`.
2. Cancel all in-progress and queued BullMQ jobs for affected repos (`queue.removeJobs()` filtered by repo_id).
3. Delete all `repos` records (cascading delete removes all child data).

#### 1.1.4 `installation_repositories`

**Actions handled:** `added`, `removed`

**`added`:** Create repo records for new repos, queue full scan for each.

**`removed`:** Cancel jobs, delete repo records (cascade) for removed repos only.

#### 1.1.5 `pull_request_review` (Fix Acceptance Detection -- Audit Finding G2)

**Actions handled:** `submitted`

This webhook detects when a developer accepts a GitHub suggestion (fix). When a review is submitted with `state: 'commented'`, inspect review comments for suggestion acceptance events.

**Primary detection (fast path):** When a `pull_request_review` event arrives with a comment body that matches a previous DocAlign suggestion:

```typescript
interface PRReviewPayload {
  action: 'submitted';
  review: {
    id: number;
    body: string;
    state: 'commented' | 'approved' | 'changes_requested';
    commit_id: string;
  };
  pull_request: { number: number };
  repository: { full_name: string };
  installation: { id: number };
}
```

**Fallback detection (authoritative):** On the next `pull_request.synchronize` event, diff the changed doc files against previously suggested fixes. Substring match allowing minor edits (whitespace normalization, trailing punctuation). If the fix text appears in the new commit, record `fix_accepted` feedback.

### 1.2 GitHub REST API Endpoints

#### 1.2.1 Installation Access Token

**Endpoint:** `POST /app/installations/{installation_id}/access_tokens`

**Authentication:** JWT signed with GitHub App private key (RS256).

**JWT construction:**

```typescript
import jwt from 'jsonwebtoken';

function createAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,              // issued 60s ago (clock drift)
      exp: now + (10 * 60),       // expires in 10 minutes
      iss: appId,
    },
    privateKey,
    { algorithm: 'RS256' }
  );
}
```

**Request:**

```http
POST /app/installations/12345678/access_tokens
Authorization: Bearer <app_jwt>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**Response (200 OK):**

```json
{
  "token": "ghs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expires_at": "2026-02-11T15:30:00Z",
  "permissions": {
    "contents": "read",
    "pull_requests": "write",
    "checks": "write",
    "metadata": "read"
  }
}
```

**Caching strategy:**

```typescript
interface CachedToken {
  token: string;
  expiresAt: Date;
  installationId: number;
}

// In-memory Map<installationId, CachedToken>
// Before each GitHub API call:
//   if cachedToken.expiresAt - now < 5 minutes: refresh
// Token is NOT stored in Redis or DB (security -- ephemeral only)
```

#### 1.2.2 List PR Changed Files

**Endpoint:** `GET /repos/{owner}/{repo}/pulls/{pull_number}/files`

**Request:**

```http
GET /repos/acme/webapp/pulls/42/files?per_page=100
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**Response (200 OK):**

```json
[
  {
    "sha": "abc123",
    "filename": "src/auth/handler.ts",
    "status": "modified",
    "additions": 12,
    "deletions": 3,
    "changes": 15,
    "patch": "@@ -10,7 +10,7 @@ ..."
  },
  {
    "sha": "def456",
    "filename": "docs/auth.md",
    "status": "added",
    "additions": 45,
    "deletions": 0,
    "changes": 45
  }
]
```

**Pagination:** If >100 files, paginate using `Link` header. Max 300 files per PR (GitHub limit). For PRs exceeding 300 files, use the compare endpoint instead.

**File status values and handling:**

| `status` | Processing |
|----------|-----------|
| `added` | If doc: extract claims. If code: add to L0 index. |
| `modified` | If doc: re-extract claims. If code: update L0 index. |
| `removed` | If doc: delete claims for this file (audit finding A12). If code: remove entities from L0. |
| `renamed` | Update `code_entities.file_path` and `claim_mappings.code_file` in same transaction (audit finding A3). |

#### 1.2.3 Get File Content

**Endpoint:** `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}`

**Request:**

```http
GET /repos/acme/webapp/contents/src/auth/handler.ts?ref=abc123def
Authorization: Bearer <installation_token>
Accept: application/vnd.github.raw+json
X-GitHub-Api-Version: 2022-11-28
```

**Response (200 OK):** Raw file content (when `Accept: application/vnd.github.raw+json` is used).

**Size limit:** GitHub returns a 403 for files >100MB. Files >1MB return base64-encoded content (use the Blob API instead). For DocAlign, cap at 1MB per file -- skip larger files with a warning.

#### 1.2.4 Repository Dispatch (Trigger GitHub Action)

**Endpoint:** `POST /repos/{owner}/{repo}/dispatches`

**Request:**

```http
POST /repos/acme/webapp/dispatches
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "event_type": "docalign-scan",
  "client_payload": {
    "repo_id": "550e8400-e29b-41d4-a716-446655440000",
    "scan_run_id": "660e8400-e29b-41d4-a716-446655440001",
    "scan_type": "pr",
    "trigger_ref": "42",
    "task_ids": [
      "770e8400-e29b-41d4-a716-446655440002",
      "770e8400-e29b-41d4-a716-446655440003"
    ]
  }
}
```

**Response:** `204 No Content` on success. No response body.

**Payload schema (audit finding A8 -- resolved in 3A, detailed here):**

```typescript
interface RepositoryDispatchPayload {
  /** DocAlign's internal repo UUID */
  repo_id: string;
  /** Scan run UUID for correlation and task polling */
  scan_run_id: string;
  /** Type of scan that triggered this dispatch */
  scan_type: 'pr' | 'full' | 'push';
  /** PR number (for pr scans) or commit SHA (for push/full scans) */
  trigger_ref: string;
  /** Pre-created task IDs the Action should execute */
  task_ids: string[];
}
```

**GitHub Action receives this via:**

```typescript
const payload = github.context.payload.client_payload as RepositoryDispatchPayload;
```

**Failure handling:** If dispatch returns 404 (Action not configured), set repo status to `awaiting_setup` and create a Check Run with setup instructions.

#### 1.2.5 Check Run API

**Create Check Run:**

```http
POST /repos/{owner}/{repo}/check-runs
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "name": "DocAlign",
  "head_sha": "abc123def456",
  "status": "in_progress",
  "output": {
    "title": "DocAlign: Scanning documentation...",
    "summary": "Verifying documentation claims against code changes."
  }
}
```

**Response (201 Created):**

```json
{
  "id": 987654321,
  "name": "DocAlign",
  "status": "in_progress"
}
```

Store the `check_run_id` in `scan_runs` table for later updates.

**Update Check Run (scan complete):**

```http
PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "status": "completed",
  "conclusion": "action_required",
  "output": {
    "title": "DocAlign: Found 3 documentation issues",
    "summary": "Found 3 documentation issues (1 high, 2 medium). Health score: 94%.\n\n| Severity | File | Line | Issue |\n|----------|------|------|-------|\n| HIGH | README.md | 45 | Password hashing library changed |\n| MEDIUM | docs/api.md | 112 | API version outdated |\n| MEDIUM | CONTRIBUTING.md | 23 | Config file renamed |"
  }
}
```

**Conclusion mapping (from 3A Section 9.6):**

| Condition | `conclusion` |
|-----------|-------------|
| HIGH findings exist (respects `check.min_severity_to_block`) | `action_required` |
| Only MEDIUM/LOW findings | `neutral` |
| Zero findings | `success` |
| Scan failure | `failure` |

#### 1.2.6 PR Comment (Issues API)

**Summary comment -- create:**

```http
POST /repos/{owner}/{repo}/issues/{pr_number}/comments
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "body": "## DocAlign: Documentation Health Check\n\nFound **3 documentation issues** related to your code changes:\n...\n\n<!-- docalign-summary scan-run-id=660e8400 -->"
}
```

**Response (201 Created):**

```json
{
  "id": 1234567890,
  "body": "...",
  "created_at": "2026-02-11T14:30:00Z"
}
```

The hidden HTML comment marker `<!-- docalign-summary scan-run-id={scan_run_id} -->` identifies DocAlign summary comments for tracking.

#### 1.2.7 Pull Request Review API (Review Comments)

**Create review with line comments and suggestions:**

```http
POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "commit_id": "abc123def456",
  "event": "COMMENT",
  "comments": [
    {
      "path": "README.md",
      "line": 45,
      "body": "**DocAlign: HIGH** -- Password hashing library changed\n\n**Claim:** \"Authentication uses bcrypt with 12 salt rounds\"\n**Evidence:** `src/auth/password.ts` now imports `argon2`, not `bcrypt`\n\n```suggestion\nAuthentication uses argon2id with 64MB memory cost for password hashing.\n```\n\n<!-- docalign-review-comment claim-id=claim-001 scan-run-id=660e8400 -->"
    },
    {
      "path": "docs/api.md",
      "line": 112,
      "body": "**DocAlign: MEDIUM** -- API version outdated\n\n**Claim:** \"POST /api/v1/users\"\n**Evidence:** Route in `src/routes/users.ts:34` is `/api/v2/users`\n\n```suggestion\nPOST /api/v2/users\n```\n\n<!-- docalign-review-comment claim-id=claim-002 scan-run-id=660e8400 -->"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "id": 98765,
  "state": "commented",
  "comments": [
    { "id": 11111, "path": "README.md", "line": 45 },
    { "id": 22222, "path": "docs/api.md", "line": 112 }
  ]
}
```

**Review comment marker format (audit finding G1):**

```
<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->
```

Placed at the end of each review comment body. Used for:
- Tracking which comments belong to which scan run.
- Marking resolved comments on subsequent pushes.
- Correlating feedback reactions to specific claims.

**Batching:** All review comments for a single PR scan are sent in a single `POST /pulls/{pr}/reviews` call. This counts as 1 API request regardless of comment count (up to 30 comments per review -- GitHub limit). If >30 findings, split into multiple review API calls.

**Marking resolved comments on subsequent pushes:**

On a new scan, retrieve previous review comments (list review comments API), match by `claim-id` marker, and for findings no longer present, update comment body to prepend `**(Resolved)** ~~`:

```http
PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
Content-Type: application/json

{
  "body": "**(Resolved)** ~~Previous finding text~~\n\n<!-- docalign-review-comment claim-id=claim-001 scan-run-id=660e8400 resolved-by=770e8400 -->"
}
```

### 1.3 Rate Limit Strategy

**GitHub API rate limit:** 5,000 requests per hour per installation.

**Tracking:**

```typescript
interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: Date;
}

// Updated on every GitHub API response from headers:
// X-RateLimit-Remaining, X-RateLimit-Limit, X-RateLimit-Reset
```

**Thresholds and actions:**

| Remaining % | Action |
|-------------|--------|
| > 20% | Normal operation |
| 10-20% | Switch to clone-based file access for bulk reads. Batch review comments. |
| 5-10% | Defer non-essential API calls (health score updates, resolved comment marking). |
| < 5% | Defer all non-critical operations. Log alert. Only post essential PR comments. |

**Per-scan rate limit budget estimation:**

| Operation | API Calls | Notes |
|-----------|-----------|-------|
| List PR files | 1-3 | Paginated if >100 files |
| Get file contents | 0-20 | Only for PR scans (few files). Full scans use clone. |
| Create Check Run | 1 | Per scan |
| Update Check Run | 1 | Per scan |
| Post summary comment | 1 | Per scan |
| Post review (batch) | 1-2 | Up to 30 comments each |
| Repository dispatch | 1 | Trigger Action |
| Mark resolved comments | 0-10 | PATCH per previously resolved finding |
| **Total per PR scan** | **~6-40** | Varies by PR size |

**At 5,000 req/hr, budget supports ~125-800 PR scans per hour per installation.** Well within MVP targets.

**DocAlign server-side rate limits (Redis-backed):**

```typescript
// Atomic INCR (audit finding I7 -- not GET+SET)
async function checkRateLimit(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
  const multi = redis.multi();
  multi.incr(key);
  multi.expire(key, ttlSeconds);     // only sets if key is new
  const [count] = await multi.exec();
  return (count as number) <= limit;
}

// Keys:
// ratelimit:repo:{repo_id}:{utc_date}       -- 100/day per repo
// ratelimit:org:{org_id}:{utc_date}          -- 1000/day per org
```

### 1.4 Installation Lifecycle

See state machine in 3A Section 8.1. The integration points are:

| State Transition | GitHub API Call | Notes |
|-----------------|-----------------|-------|
| `onboarding` -> `awaiting_setup` | Create Check Run with setup instructions | Check summary includes link to setup docs |
| `onboarding` -> `scanning` | Repository dispatch (triggers full scan Action) | Only after confirming Action exists |
| `scanning` -> `active` | Update Check Run (`success`) | After successful full scan |
| `scanning` -> `error` | Update Check Run (`failure`) | After failed full scan |
| Any -> `deleted` | No GitHub API calls | Data deletion is internal |

**Action existence check:**

```http
GET /repos/{owner}/{repo}/contents/.github/workflows/docalign.yml
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Returns `200` if file exists, `404` if not. Also check for `docalign.yaml` (both extensions).

---

## 2. Agent Task API (Detailed)

The Agent Task API is the contract between the DocAlign server and the GitHub Action (`docalign/agent-action`). All LLM work flows through this API.

### 2.1 Authentication

**Token type:** `DOCALIGN_TOKEN` -- a per-repo API token stored in the repository's GitHub Secrets.

**Token construction:**

```typescript
// Server generates token during repo setup
function generateRepoToken(): { token: string; hash: string } {
  const token = 'docalign_' + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
  // Store `hash` in repos.token_hash. Show `token` to user once.
}
```

**Token validation on every request:**

```typescript
async function validateToken(token: string, repoId: string): Promise<boolean> {
  if (!token.startsWith('docalign_')) return false;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const repo = await db.query(
    'SELECT id FROM repos WHERE id = $1 AND token_hash = $2',
    [repoId, hash]
  );
  return repo.rows.length > 0;
}
```

**Request header:**

```
Authorization: Bearer <DOCALIGN_TOKEN>
```

**Scope:** A token grants access only to tasks for its `repo_id`. Attempting to access tasks for a different repo returns `HTTP 403 Forbidden`.

**Configurability:** Token expiry is configurable via `DOCALIGN_TOKEN_TTL_DAYS` environment variable (default: 365 days). Token rotation endpoint: `POST /api/repos/{id}/rotate-token`.

### 2.2 Endpoints

#### 2.2.1 `GET /api/tasks/pending`

List unclaimed tasks for a repo. Called by the Action to discover work.

**Request:**

```http
GET /api/tasks/pending?repo_id=550e8400-e29b-41d4-a716-446655440000&scan_run_id=660e8400-e29b-41d4-a716-446655440001
Authorization: Bearer <DOCALIGN_TOKEN>
```

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `repo_id` | Yes | Must match token's `repo_id` |
| `scan_run_id` | No | Filter to specific scan run |

**Response (200 OK):**

```json
{
  "tasks": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "type": "claim_extraction",
      "status": "pending",
      "created_at": "2026-02-11T14:30:00Z",
      "expires_at": "2026-02-11T15:00:00Z"
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440003",
      "type": "verification",
      "status": "pending",
      "created_at": "2026-02-11T14:30:01Z",
      "expires_at": "2026-02-11T15:00:01Z"
    }
  ]
}
```

**Atomicity (audit finding A1):** This endpoint returns tasks with `claimed_by IS NULL`. After listing, the Action calls `GET /api/tasks/{id}` to claim each task individually.

**Response (200 OK, empty):**

```json
{
  "tasks": []
}
```

When the Action receives an empty list, it exits (all work done or already claimed by another run).

#### 2.2.2 `GET /api/tasks/{id}`

Get full task details and atomically claim the task.

**Request:**

```http
GET /api/tasks/770e8400-e29b-41d4-a716-446655440002
Authorization: Bearer <DOCALIGN_TOKEN>
```

**Server behavior on GET:**

```sql
UPDATE agent_tasks
SET status = 'in_progress',
    claimed_by = $action_run_id,
    expires_at = NOW() + INTERVAL '10 minutes'
WHERE id = $task_id
  AND repo_id = $repo_id
  AND claimed_by IS NULL
RETURNING *;
```

- If the task is already claimed by another run: return `HTTP 409 Conflict`.
- If the task is expired: return `HTTP 410 Gone`.
- If the task does not exist or belongs to a different repo: return `HTTP 404 Not Found`.
- On successful claim: extends `expires_at` by 10 minutes from claim time (audit finding A2).

**Response (200 OK) -- `claim_extraction` task:**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "type": "claim_extraction",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:00Z",
  "expires_at": "2026-02-11T14:40:00Z",
  "payload": {
    "type": "claim_extraction",
    "doc_files": [
      "README.md",
      "docs/api.md"
    ],
    "project_context": {
      "language": "typescript",
      "frameworks": ["express", "prisma"],
      "dependencies": {
        "express": "4.18.2",
        "prisma": "5.10.0",
        "@types/node": "20.11.0"
      }
    }
  }
}
```

**Response (200 OK) -- `verification` task (Path 1 -- entity-mapped):**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440003",
  "type": "verification",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:01Z",
  "expires_at": "2026-02-11T14:40:01Z",
  "payload": {
    "type": "verification",
    "verification_path": 1,
    "claim": {
      "id": "claim-001",
      "claim_text": "Authentication uses bcrypt with 12 salt rounds",
      "claim_type": "behavior",
      "source_file": "README.md",
      "source_line": 45
    },
    "evidence": {
      "formatted_evidence": "// File: src/auth/password.ts\n// Imports:\nimport { hash, compare } from 'argon2';\nimport { Logger } from '../logger';\n\n// Entity: hashPassword (lines 15-28)\nasync function hashPassword(plain: string): Promise<string> {\n  return hash(plain, { type: 2, memoryCost: 65536 });\n}",
      "metadata": {
        "path": 1,
        "file_path": "src/auth/password.ts",
        "entity_name": "hashPassword",
        "entity_lines": [15, 28],
        "entity_token_estimate": 120,
        "imports_token_estimate": 35,
        "total_token_estimate": 155
      }
    },
    "routing_reason": "single_entity_mapped"
  }
}
```

**Response (200 OK) -- `verification` task (Path 2 -- agent-delegated):**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440004",
  "type": "verification",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:02Z",
  "expires_at": "2026-02-11T14:40:02Z",
  "payload": {
    "type": "verification",
    "verification_path": 2,
    "claim": {
      "id": "claim-005",
      "claim_text": "Data flows from the API layer through a message queue to the background worker",
      "claim_type": "architecture",
      "source_file": "ARCHITECTURE.md",
      "source_line": 12
    },
    "mapped_files": [
      { "path": "src/api/routes/orders.ts", "confidence": 0.85, "entity_name": "createOrder" },
      { "path": "src/queue/publisher.ts", "confidence": 0.72, "entity_name": null },
      { "path": "src/workers/order-processor.ts", "confidence": 0.68, "entity_name": null }
    ],
    "routing_reason": "multi_file"
  }
}
```

**Response (200 OK) -- `claim_classification` task:**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440005",
  "type": "claim_classification",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:03Z",
  "expires_at": "2026-02-11T14:40:03Z",
  "payload": {
    "type": "claim_classification",
    "claim": {
      "id": "claim-010",
      "claim_text": "All API responses use camelCase keys",
      "claim_type": "convention",
      "source_file": "docs/api-guidelines.md"
    },
    "project_context": {
      "language": "typescript",
      "frameworks": ["express"],
      "dependencies": {}
    }
  }
}
```

**Response (200 OK) -- `fix_generation` task:**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440006",
  "type": "fix_generation",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:04Z",
  "expires_at": "2026-02-11T14:40:04Z",
  "payload": {
    "type": "fix_generation",
    "finding": {
      "claim_text": "Authentication uses bcrypt with 12 salt rounds",
      "source_file": "README.md",
      "source_line": 45,
      "mismatch_description": "Code uses argon2, not bcrypt",
      "evidence_files": ["src/auth/password.ts"]
    }
  }
}
```

**Response (200 OK) -- `post_check` task:**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440007",
  "type": "post_check",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:05Z",
  "expires_at": "2026-02-11T14:40:05Z",
  "payload": {
    "type": "post_check",
    "finding": {
      "claim_text": "Authentication uses bcrypt with 12 salt rounds",
      "verdict": "drifted",
      "mismatch_description": "Code uses argon2, not bcrypt. src/auth/password.ts imports argon2.",
      "evidence_files": ["src/auth/password.ts"]
    }
  }
}
```

**Response (200 OK) -- `feedback_interpretation` task:**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440008",
  "type": "feedback_interpretation",
  "status": "in_progress",
  "claimed_by": "run-12345",
  "created_at": "2026-02-11T14:30:06Z",
  "expires_at": "2026-02-11T14:40:06Z",
  "payload": {
    "type": "feedback_interpretation",
    "finding": {
      "claim_id": "claim-001",
      "claim_text": "Authentication uses bcrypt with 12 salt rounds",
      "claim_type": "behavior",
      "source_file": "README.md",
      "verdict": "drifted",
      "mismatch_description": "Code uses argon2, not bcrypt"
    },
    "explanation": {
      "type": "free_text",
      "value": "We're migrating to argon2 gradually, both are valid during the transition"
    },
    "existing_rules": [
      {
        "scope": "claim",
        "target": "claim-001",
        "reason": "Migration in progress"
      }
    ]
  }
}
```

#### 2.2.3 `POST /api/tasks/{id}/result`

Submit the result for a completed task.

**Request:**

```http
POST /api/tasks/770e8400-e29b-41d4-a716-446655440003/result
Authorization: Bearer <DOCALIGN_TOKEN>
Content-Type: application/json

{
  "task_id": "770e8400-e29b-41d4-a716-446655440003",
  "success": true,
  "data": {
    "type": "verification",
    "verdict": "drifted",
    "confidence": 0.95,
    "reasoning": "Code uses argon2, not bcrypt. The hashPassword function in src/auth/password.ts imports from 'argon2' and uses argon2.hash() with type 2 (argon2id).",
    "evidence_files": ["src/auth/password.ts", "package.json"],
    "specific_mismatch": "Documentation says 'bcrypt with 12 salt rounds' but code uses argon2id with 64MB memory cost",
    "suggested_fix": "Authentication uses argon2id with 64MB memory cost for password hashing."
  },
  "metadata": {
    "duration_ms": 2340,
    "model_used": "claude-sonnet-4-20250514",
    "tokens_used": 1250,
    "cost_usd": 0.008
  }
}
```

**Result validation (Zod schemas):**

```typescript
import { z } from 'zod';

const VerificationResultSchema = z.object({
  type: z.literal('verification'),
  verdict: z.enum(['verified', 'drifted', 'uncertain']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(5000),
  evidence_files: z.array(z.string().max(512)).min(0).max(50),
  specific_mismatch: z.string().max(2000).nullable().optional(),
  suggested_fix: z.string().max(5000).nullable().optional(),
  rule_fixes: z.array(z.object({
    rule_id: z.string(),
    field: z.string(),
    old_value: z.unknown(),
    new_value: z.unknown(),
    reason: z.string(),
  })).optional(),
});

const ClaimExtractionResultSchema = z.object({
  type: z.literal('claim_extraction'),
  claims: z.array(z.object({
    claim_text: z.string().min(1).max(2000),
    claim_type: z.enum([
      'path_reference', 'dependency_version', 'command', 'api_route',
      'code_example', 'behavior', 'architecture', 'config',
      'convention', 'environment'
    ]),
    source_file: z.string(),
    source_line: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
    keywords: z.array(z.string()).optional(),
    extracted_value: z.unknown().optional(),
  })).min(0).max(500),
});

const ClaimClassificationResultSchema = z.object({
  type: z.literal('claim_classification'),
  classification: z.enum(['universal', 'flow', 'untestable']),
  static_rule: z.object({
    scope: z.string(),
    scope_exclude: z.array(z.string()).optional(),
    checks: z.array(z.object({
      type: z.string(),
    }).passthrough()),
  }).optional(),
  sub_claims: z.array(z.object({
    sub_claim_text: z.string(),
    expected_evidence_type: z.string(),
    search_hints: z.array(z.string()),
  })).optional(),
  untestable_reason: z.string().optional(),
  reasoning: z.string().min(1).max(5000),
});

const PostCheckResultSchema = z.object({
  type: z.literal('post_check'),
  outcome: z.enum(['confirmed', 'contradicted']),
  reasoning: z.string().min(1).max(2000),
});

const FixGenerationResultSchema = z.object({
  type: z.literal('fix_generation'),
  suggested_fix: z.object({
    file_path: z.string(),
    line_start: z.number().int().min(1),
    line_end: z.number().int().min(1),
    new_text: z.string().min(1).max(10000),
    explanation: z.string().min(1).max(2000),
  }),
});

const FeedbackInterpretationResultSchema = z.object({
  type: z.literal('feedback_interpretation'),
  actions: z.array(z.object({
    action_type: z.enum([
      'suppress_claim', 'suppress_file', 'suppress_type',
      'update_rule', 'suggest_doc_update', 'no_action'
    ]),
    target_id: z.string().optional(),
    target_path: z.string().optional(),
    duration_days: z.number().int().min(1).max(365).optional(),
    reason: z.string().min(1).max(1000),
    details: z.record(z.unknown()).optional(),
  })).min(1).max(10),
});

const AgentTaskResultSchema = z.object({
  task_id: z.string().uuid(),
  success: z.boolean(),
  error: z.string().max(5000).optional(),
  data: z.discriminatedUnion('type', [
    VerificationResultSchema,
    ClaimExtractionResultSchema,
    ClaimClassificationResultSchema,
    PostCheckResultSchema,
    FixGenerationResultSchema,
    FeedbackInterpretationResultSchema,
  ]),
  metadata: z.object({
    duration_ms: z.number().int().min(0),
    model_used: z.string().optional(),
    tokens_used: z.number().int().min(0).optional(),
    cost_usd: z.number().min(0).optional(),
  }),
});
```

**Agent result handling (audit finding A13):**

When the agent returns malformed or unexpected data:

| Condition | HTTP Status | Action |
|-----------|-------------|--------|
| Valid Zod schema | `200 OK` | Store result, process normally |
| Zod validation fails (schema mismatch) | `400 Bad Request` | Return `{ error: "Validation failed", details: zodErrors }` |
| Task already completed by different run | `409 Conflict` | Return `{ error: "Task already completed" }` |
| Task expired | `410 Gone` | Return `{ error: "Task expired" }` |
| Task not found or wrong repo | `404 Not Found` | Return `{ error: "Task not found" }` |
| `success: false` with error string | `200 OK` | Store error, mark claim as `uncertain` with reason from error |
| Agent returns freeform text instead of JSON | `400 Bad Request` | Action should catch this before sending; if not, Zod rejects |
| Agent refuses to answer | `200 OK` | Agent sets `success: false, error: "refused"`, claim becomes `uncertain` |
| Agent returns partial result (some fields missing) | `400 Bad Request` | Zod schema enforces required fields; partial fails validation |

**Text sanitization:**

All text fields that will appear in PR comments (`reasoning`, `suggested_fix`, `evidence_summary`, `specific_mismatch`, `explanation`) are sanitized:

```typescript
function sanitizeForMarkdown(text: string): string {
  return text
    .replace(/javascript:/gi, '')          // Prevent URL injection
    .replace(/<script/gi, '&lt;script')    // Prevent HTML injection
    .replace(/<!--/g, '&lt;!--')           // Prevent HTML comment injection
    .slice(0, 5000);                       // Enforce max length
}
```

**Success response (200 OK):**

```json
{
  "status": "accepted",
  "task_id": "770e8400-e29b-41d4-a716-446655440003"
}
```

### 2.3 Task Creation (Server-Side)

Tasks are created by the server worker during scan processing. The server creates tasks in the `agent_tasks` table, then triggers the Action via repository dispatch.

**Task creation SQL:**

```sql
INSERT INTO agent_tasks (id, repo_id, scan_run_id, type, payload, status, expires_at, created_at)
VALUES (
  gen_random_uuid(),
  $repo_id,
  $scan_run_id,
  $type,
  $payload::jsonb,
  'pending',
  NOW() + INTERVAL '30 minutes',
  NOW()
)
RETURNING id;
```

**Task lifecycle (from 3A Section 8.4):**

```
pending --> in_progress --> completed
                       \--> failed (agent error)
pending/in_progress --> expired (timeout)
```

### 2.4 Action Polling Flow

The GitHub Action follows this sequence:

```typescript
// 1. Parse repository dispatch payload
const { repo_id, scan_run_id, task_ids } = github.context.payload.client_payload;

// 2. Poll for pending tasks
const tasks = await fetch(`${DOCALIGN_API}/api/tasks/pending?repo_id=${repo_id}&scan_run_id=${scan_run_id}`, {
  headers: { 'Authorization': `Bearer ${DOCALIGN_TOKEN}` }
}).then(r => r.json());

// 3. For each task, claim and execute
await Promise.allSettled(
  tasks.tasks.map(async (task) => {
    // Claim the task (GET details + atomic claim)
    const details = await fetch(`${DOCALIGN_API}/api/tasks/${task.id}`, {
      headers: { 'Authorization': `Bearer ${DOCALIGN_TOKEN}` }
    }).then(r => {
      if (r.status === 409) return null; // Already claimed
      if (r.status === 410) return null; // Expired
      return r.json();
    });

    if (!details) return;

    // Execute based on task type
    const result = await executeTask(details);

    // Submit result
    await fetch(`${DOCALIGN_API}/api/tasks/${task.id}/result`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DOCALIGN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(result)
    });
  })
);
```

**Concurrency:** Controlled by `agent.concurrency` config (default 5, max 20). The Action processes up to N tasks in parallel using `Promise.allSettled` with a concurrency limiter (e.g., `p-limit`).

---

## 3. LLM API Integration (Client-Side)

All LLM calls run in the GitHub Action using the client's API key. DocAlign provides prompt templates and structured output schemas; the Action executes the calls.

### 3.1 Supported Providers

| Provider | Default Model | Used For | Config Key |
|----------|--------------|----------|------------|
| **Anthropic** | `claude-sonnet-4-20250514` | Verification (Path 1), Claim extraction, Fix generation, Feedback interpretation | `llm.verification_model`, `llm.extraction_model` |
| **OpenAI** | `text-embedding-3-small` | Embeddings (1536 dimensions) | `llm.embedding_model` |

The provider is inferred from the model name:
- Models starting with `claude-` use the Anthropic API.
- Models starting with `gpt-`, `o1-`, or `text-embedding-` use the OpenAI API.

### 3.2 Anthropic API Integration

**Base URL:** `https://api.anthropic.com/v1`

**Authentication:**

```
x-api-key: <ANTHROPIC_API_KEY>
anthropic-version: 2023-06-01
```

#### 3.2.1 Messages API (Verification, Extraction, Fix Generation)

**Request:**

```http
POST https://api.anthropic.com/v1/messages
x-api-key: <ANTHROPIC_API_KEY>
anthropic-version: 2023-06-01
Content-Type: application/json

{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "temperature": 0,
  "messages": [
    {
      "role": "user",
      "content": "You are a documentation accuracy verifier...\n\n<claim file=\"README.md\" line=\"45\" type=\"behavior\">\nAuthentication uses bcrypt with 12 salt rounds\n</claim>\n\n<evidence>\n<code file=\"src/auth/password.ts\" lines=\"15-28\">\nimport { hash, compare } from 'argon2';\n\nasync function hashPassword(plain: string): Promise<string> {\n  return hash(plain, { type: 2, memoryCost: 65536 });\n}\n</code>\n</evidence>\n\nRespond in JSON:\n{\n  \"verdict\": \"verified\" | \"drifted\" | \"uncertain\",\n  \"severity\": \"high\" | \"medium\" | \"low\",\n  \"reasoning\": \"1-2 sentence explanation\",\n  \"specific_mismatch\": \"what exactly is wrong (null if verified)\",\n  \"suggested_fix\": \"corrected claim text (null if verified or uncertain)\"\n}"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "{\n  \"verdict\": \"drifted\",\n  \"severity\": \"high\",\n  \"reasoning\": \"The code uses argon2 (imported from 'argon2' package), not bcrypt. The hashPassword function uses argon2.hash with type 2 (argon2id) and 64MB memory cost.\",\n  \"specific_mismatch\": \"Documentation says 'bcrypt with 12 salt rounds' but code uses argon2id with 64MB memory cost\",\n  \"suggested_fix\": \"Authentication uses argon2id with 64MB memory cost for password hashing.\"\n}"
    }
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 523,
    "output_tokens": 187
  }
}
```

**Structured output extraction:**

```typescript
function parseVerificationResponse(response: AnthropicMessage): VerificationResult {
  const text = response.content[0].text;
  // Strip markdown fences if present
  const jsonStr = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(jsonStr);
  return VerificationResultSchema.parse(parsed);
}
```

**Parameters per task type:**

| Task | `max_tokens` | `temperature` | Notes |
|------|-------------|---------------|-------|
| Claim extraction | 4000 | 0 | May return many claims |
| Verification (Path 1) | 1000 | 0 | Single verdict |
| Fix generation | 2000 | 0 | May include multi-line fix |
| Feedback interpretation | 1000 | 0 | Action list |
| Auto-detect project structure | 500 | 0 | JSON config |

#### 3.2.2 Agent API (Path 2 Verification)

Path 2 uses a full AI agent (e.g., Claude Code via CLI) rather than a single API call. The Action spawns the agent process:

```typescript
// Claude Code adapter
async function verifyWithAgent(
  request: AgentVerificationRequest,
  config: AgentConfig
): Promise<AgentVerificationResponse> {
  const prompt = buildAgentPrompt(request);

  // Spawn Claude Code in the checked-out repo
  const result = await execAsync(
    `claude --print "${prompt}" --output-format json`,
    {
      cwd: repoRoot,
      timeout: config.timeout_seconds * 1000,
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    }
  );

  return AgentVerificationResponseSchema.parse(JSON.parse(result.stdout));
}
```

**Custom command adapter:**

```typescript
// For users with their own agent setup
async function verifyWithCustomCommand(
  request: AgentVerificationRequest,
  config: AgentConfig
): Promise<AgentVerificationResponse> {
  const inputFile = await writeTempFile(JSON.stringify(request));

  const result = await execAsync(
    `${config.command} --input ${inputFile} --output-format json`,
    {
      cwd: repoRoot,
      timeout: config.timeout_seconds * 1000
    }
  );

  return AgentVerificationResponseSchema.parse(JSON.parse(result.stdout));
}
```

### 3.3 OpenAI API Integration

**Base URL:** `https://api.openai.com/v1`

**Authentication:**

```
Authorization: Bearer <OPENAI_API_KEY>
```

#### 3.3.1 Embeddings API

**Request:**

```http
POST https://api.openai.com/v1/embeddings
Authorization: Bearer <OPENAI_API_KEY>
Content-Type: application/json

{
  "model": "text-embedding-3-small",
  "input": [
    "async function hashPassword(plain: string): Promise<string>",
    "class UserService implements IUserService",
    "POST /api/v2/users - Create a new user account"
  ],
  "dimensions": 1536
}
```

**Response (200 OK):**

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0012, -0.0034, 0.0056, ...]
    },
    {
      "object": "embedding",
      "index": 1,
      "embedding": [0.0078, -0.0091, 0.0023, ...]
    },
    {
      "object": "embedding",
      "index": 2,
      "embedding": [-0.0045, 0.0067, 0.0089, ...]
    }
  ],
  "model": "text-embedding-3-small",
  "usage": {
    "prompt_tokens": 42,
    "total_tokens": 42
  }
}
```

**Batch embedding strategy:**

```typescript
const BATCH_SIZE = 100; // Max items per API call (OpenAI limit: 2048)
const PARALLEL_BATCHES = 3; // Concurrent batch calls

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batches = chunk(texts, BATCH_SIZE);
  const results: number[][] = [];

  for (const batchGroup of chunk(batches, PARALLEL_BATCHES)) {
    const batchResults = await Promise.all(
      batchGroup.map(batch =>
        openai.embeddings.create({
          model: config.embedding_model,
          input: batch,
          dimensions: config.embedding_dimensions,
        })
      )
    );
    for (const result of batchResults) {
      results.push(...result.data.map(d => d.embedding));
    }
  }

  return results;
}
```

**Embedding dimension validation (audit finding G6):**

```typescript
function validateEmbeddingDimension(
  storedDimension: number,
  newDimension: number
): void {
  if (storedDimension !== newDimension) {
    throw new EmbeddingDimensionMismatchError(
      `Stored embeddings use dimension ${storedDimension}, ` +
      `but current model produces dimension ${newDimension}. ` +
      `A full re-index is required. Run a full scan to regenerate all embeddings.`
    );
  }
}
```

### 3.4 Retry and Backoff Strategy

All LLM API calls use the same retry logic:

```typescript
interface RetryConfig {
  maxRetries: number;       // 2 (per-call retries)
  initialDelayMs: number;   // 1000
  maxDelayMs: number;       // 16000
  backoffMultiplier: number; // 2
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = { maxRetries: 2, initialDelayMs: 1000, maxDelayMs: 16000, backoffMultiplier: 2 }
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Do not retry on non-retryable errors
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        throw error;
      }

      // Retry on 429 (rate limit), 500, 502, 503, 529 (overloaded)
      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        );
        // For 429, use Retry-After header if present
        const retryAfter = error.headers?.['retry-after'];
        const actualDelay = retryAfter ? parseInt(retryAfter) * 1000 : delay;
        await sleep(actualDelay);
      }
    }
  }
  throw lastError;
}
```

**Per-provider retry behavior:**

| Provider | Retryable Status Codes | Rate Limit Header |
|----------|----------------------|-------------------|
| Anthropic | 429, 500, 529 | `retry-after` (seconds) |
| OpenAI | 429, 500, 502, 503 | `retry-after` (seconds) |

### 3.5 Cost Tracking

The Action tracks cost per task and reports it in task result metadata.

```typescript
interface CostEstimate {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-haiku-3.5': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'text-embedding-3-small': { input: 0.02 / 1_000_000, output: 0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input) + (outputTokens * pricing.output);
}
```

Cost data is submitted per task and aggregated per scan in the `scan_runs` table (`total_token_cost`, `total_duration_ms`).

---

## 4. MCP Protocol (v2)

The MCP server is a v2 feature. This section defines the integration contract for implementation readiness.

### 4.1 Transport

**Protocol:** MCP (Model Context Protocol) over stdio.

**Invocation:**

```bash
npx @docalign/mcp-server --repo /path/to/repo
```

**Configuration (Claude Code):**

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "docalign": {
      "command": "npx",
      "args": ["@docalign/mcp-server", "--repo", "/path/to/repo"]
    }
  }
}
```

**Configuration (Cursor):**

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "docalign": {
      "command": "npx",
      "args": ["@docalign/mcp-server", "--repo", "."]
    }
  }
}
```

### 4.2 Database Connection (Audit Finding A16)

The MCP server connects to PostgreSQL using this resolution order:

1. **Environment variable:** `DOCALIGN_DATABASE_URL` -- if set, use directly.
2. **Config file:** `~/.docalign/config.json` field `database_url`.
3. **Interactive prompt:** If neither is found, prompt on first run: "Enter your DocAlign database URL:" and save to `~/.docalign/config.json`.

```typescript
async function resolveDatabaseUrl(): Promise<string> {
  // 1. Environment variable
  if (process.env.DOCALIGN_DATABASE_URL) {
    return process.env.DOCALIGN_DATABASE_URL;
  }

  // 2. Config file
  const configPath = path.join(os.homedir(), '.docalign', 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.database_url) return config.database_url;
  }

  // 3. Interactive prompt
  const url = await promptUser('Enter your DocAlign database URL: ');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ database_url: url }, null, 2));
  return url;
}
```

**Connection pooling:** MCP server uses a single connection (not pooled) -- it is a single-user local process.

**Read-only access:** The MCP server uses `SET default_transaction_read_only = ON` on connection to prevent accidental writes. Exception: `report_drift` tool (v3) requires write access -- it connects with a separate writable connection.

### 4.3 Tool Schemas

#### 4.3.1 `get_docs`

```json
{
  "name": "get_docs",
  "description": "Search project documentation for information about a topic. Returns relevant documentation sections with verification status indicating whether the content is confirmed accurate, potentially stale, or uncertain.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "What you want to know about (e.g., 'authentication', 'API endpoints', 'deployment process')"
      },
      "verified_only": {
        "type": "boolean",
        "description": "If true, only return documentation that has been verified as accurate. Default: false.",
        "default": false
      }
    },
    "required": ["query"]
  }
}
```

**Response format:**

```json
{
  "results": [
    {
      "file": "docs/auth.md",
      "section": "Password Hashing",
      "content": "Authentication uses argon2id with 64MB memory cost...",
      "verification_status": "verified",
      "last_verified": "2026-02-07T14:23:00Z",
      "claims_in_section": 5,
      "verified_claims": 5,
      "health_score": 1.0
    }
  ]
}
```

#### 4.3.2 `get_doc_health`

```json
{
  "name": "get_doc_health",
  "description": "Check the freshness/accuracy status of a specific documentation file or the entire repo.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path to a doc file (e.g., 'README.md') or directory (e.g., 'docs/'). Omit for repo-wide health."
      }
    }
  }
}
```

**Response format:**

```json
{
  "path": "README.md",
  "total_claims": 23,
  "verified": 20,
  "drifted": 2,
  "uncertain": 1,
  "pending": 0,
  "health_score": 0.91,
  "last_scanned": "2026-02-11T14:00:00Z",
  "hotspots": [
    { "line": 45, "claim": "Authentication uses bcrypt...", "status": "drifted" }
  ]
}
```

#### 4.3.3 `report_drift` (v3)

```json
{
  "name": "report_drift",
  "description": "Report a suspected documentation inaccuracy you discovered while working with the code.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "doc_file": { "type": "string", "description": "The documentation file containing the inaccurate claim" },
      "line_number": { "type": "number", "description": "Approximate line number of the claim" },
      "claim_text": { "type": "string", "description": "The text of the inaccurate claim" },
      "actual_behavior": { "type": "string", "description": "What the code actually does" },
      "evidence_files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Code files that show the actual behavior"
      }
    },
    "required": ["doc_file", "claim_text", "actual_behavior"]
  }
}
```

**Response format:**

```json
{
  "status": "accepted",
  "report_id": "rpt-12345",
  "message": "Drift report recorded. Re-verification has been queued."
}
```

#### 4.3.4 `list_stale_docs`

```json
{
  "name": "list_stale_docs",
  "description": "List documentation files that have known inaccuracies or haven't been verified recently.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "max_results": { "type": "number", "description": "Maximum number of results. Default: 10.", "default": 10 }
    }
  }
}
```

**Response format:**

```json
{
  "stale_docs": [
    {
      "file": "docs/api.md",
      "drifted_claims": 3,
      "uncertain_claims": 1,
      "health_score": 0.72,
      "last_verified": "2026-02-01T10:00:00Z"
    }
  ]
}
```

### 4.4 Error Responses

MCP errors follow the JSON-RPC 2.0 error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Database connection failed",
    "data": {
      "detail": "Could not connect to PostgreSQL at localhost:5432. Check DOCALIGN_DATABASE_URL."
    }
  }
}
```

**Error codes:**

| Code | Meaning | When |
|------|---------|------|
| `-32602` | Invalid params | Missing required field, invalid query |
| `-32603` | Internal error | Database connection failure, query error |
| `-32000` | No data | Repo not found in database, no claims indexed |

---

## 5. Audit Finding Resolutions

### 5.1 Architecture Findings (Assigned to Phase 3B)

#### A13: Agent Result Handling

**Finding:** Define behavior when agent returns freeform text, refuses to answer, or returns partial results.

**Resolution:** Fully specified in Section 2.2.3 of this document. Summary:

- All results validated against strict Zod schemas (Section 2.2.3).
- Freeform text instead of JSON: `400 Bad Request` (Action should catch before sending).
- Agent refuses to answer: Action submits `{ success: false, error: "refused" }`. Server marks claim `uncertain`.
- Partial result (missing required fields): `400 Bad Request` from Zod validation.
- Agent returns unexpected verdict value: Zod `z.enum` rejects it.
- All text fields sanitized before rendering in PR comments.

#### A14: Entity Line Count for Routing

**Finding:** Need `entity_line_count` for Path 1/Path 2 routing. Query `code_entities` join on the fly or store in `claim_mappings`.

**Resolution:** Compute on the fly via JOIN during routing. The routing query:

```sql
SELECT
  cm.*,
  (ce.line_end - ce.line_start + 1) as entity_line_count
FROM claim_mappings cm
LEFT JOIN code_entities ce ON cm.code_entity_id = ce.id
WHERE cm.claim_id = $claim_id
ORDER BY cm.confidence DESC;
```

**Rationale:** Entity line counts change when code is updated. Storing in `claim_mappings` creates a stale denormalization. The JOIN is cheap (indexed on `code_entity_id`) and always returns fresh data. At MVP scale (<500 claims/repo), this adds negligible overhead.

**Decision logged to `phase3-decisions.md`:** 3B-D1.

#### A15: Dependency Version Lookup Format

**Finding:** `getDependencyVersion()` should document whether it returns resolved version from lock file or specifier from manifest.

**Resolution:**

```typescript
/**
 * Returns the dependency version using this resolution order:
 * 1. Lock file resolved version (package-lock.json, yarn.lock, pnpm-lock.yaml, poetry.lock)
 * 2. Manifest specifier (package.json, pyproject.toml, Cargo.toml, go.mod)
 *
 * If lock file exists AND contains the package: return resolved version (e.g., "18.2.0").
 * If no lock file or package not in lock file: return raw specifier (e.g., "^18.0.0").
 * If package not found anywhere: return null.
 */
async function getDependencyVersion(
  repoId: string,
  packageName: string
): Promise<{ version: string; source: 'lockfile' | 'manifest' } | null>
```

**Lock file parsing priority:**

| Ecosystem | Lock File | Manifest |
|-----------|-----------|----------|
| npm/pnpm | `package-lock.json` / `pnpm-lock.yaml` | `package.json` |
| yarn | `yarn.lock` | `package.json` |
| Python | `poetry.lock` / `requirements.txt` (pinned) | `pyproject.toml` / `setup.py` |
| Rust | `Cargo.lock` | `Cargo.toml` |
| Go | `go.sum` | `go.mod` |

**Monorepo version match order (audit finding A21):**

When multiple manifest files exist (monorepo), check in order:
1. Files closest to repo root (shortest path length).
2. Ties broken alphabetically.
3. Return the first match.

```typescript
function findManifestFiles(fileTree: string[], manifestName: string): string[] {
  return fileTree
    .filter(f => f.endsWith(`/${manifestName}`) || f === manifestName)
    .sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });
}
```

#### A16: MCP Server Database Connection

**Finding:** Define how MCP server authenticates to PostgreSQL.

**Resolution:** Fully specified in Section 4.2 of this document. Resolution order: env var -> config file -> interactive prompt.

#### A18: "Same Claim" Definition for Count-Based Exclusion

**Finding:** Define what "same claim" means for count-based permanent exclusion.

**Resolution:** "Same claim" = same `claim_id` (database primary key). Not same text. Not same meaning.

**Implications:**

- Each claim row in the DB has a unique ID.
- When a claim is re-extracted (doc file changed), a new claim row is created with a new ID. The old claim row is deleted. This resets the dismissal count (intentional -- the re-extracted claim may be different).
- Deduplicated claims share a single `claim_id` in the database. Multiple source locations are tracked in `claims.source_locations` (JSONB array), but the claim is verified once.
- Dismissing a claim with 3 source locations requires 2 thumbs-down on that single claim, not 2 per location.

```sql
-- Count dismissals for permanent exclusion
SELECT COUNT(*) as dismissal_count
FROM feedback f
WHERE f.claim_id = $claim_id
  AND f.feedback_type = 'thumbs_down'
  AND f.claim_id NOT IN (
    -- Exclude dismiss-all feedback (0x learning weight)
    SELECT DISTINCT fb.claim_id FROM feedback fb
    WHERE fb.feedback_type = 'all_dismissed'
  );
```

**Threshold:** 2 bare thumbs-down (without explanation) on the same `claim_id` triggers permanent exclusion.

#### A19: Version Comparison Edge Cases

**Finding:** Define handling for "18+", semver ranges in docs, "~18.2.0" / "^18.0.0".

**Resolution:**

```typescript
interface VersionComparison {
  docVersion: string;        // What the documentation says
  actualVersion: string;     // What the code has (resolved from lock/manifest)
  source: 'lockfile' | 'manifest';
}

function versionsMatch(docVersion: string, actualVersion: string): boolean {
  // 1. Strip trailing "+" from doc version: "18+" -> "18"
  const cleaned = docVersion.replace(/\+$/, '');

  // 2. If doc version is a bare major: "18" matches any "18.x.y"
  if (/^\d+$/.test(cleaned)) {
    return actualVersion.startsWith(cleaned + '.');
  }

  // 3. If doc version is major.minor: "18.2" matches any "18.2.x"
  if (/^\d+\.\d+$/.test(cleaned)) {
    return actualVersion.startsWith(cleaned + '.') || actualVersion === cleaned;
  }

  // 4. If doc version is exact: "18.2.0" requires exact match
  if (/^\d+\.\d+\.\d+/.test(cleaned)) {
    return semver.eq(semver.coerce(cleaned), semver.coerce(actualVersion));
  }

  // 5. Semver ranges in docs ("~18.2.0", "^18.0.0"):
  //    Compare against the resolved version from lock file.
  //    If the resolved version satisfies the range, verdict = verified.
  if (/^[~^]/.test(cleaned)) {
    return semver.satisfies(actualVersion, cleaned);
  }

  // 6. Non-semver strings (e.g., "latest", "stable"): cannot verify -> uncertain
  return false; // Will produce 'uncertain' verdict
}
```

**Version comparison summary:**

| Doc Format | Example | Match Logic |
|-----------|---------|-------------|
| `18+` | "Node.js 18+" | Strip `+`, major prefix match: `18.x.y` |
| `18` | "React 18" | Major prefix match: `18.x.y` |
| `18.2` | "React 18.2" | Major.minor prefix match: `18.2.x` |
| `18.2.0` | "React 18.2.0" | Exact semver match |
| `^18.0.0` | "^18.0.0 in docs" | Compare resolved version against range |
| `~18.2.0` | "~18.2.0 in docs" | Compare resolved version against range |
| `latest` | "uses latest" | Cannot verify -> `uncertain` |

#### A20: Auto-Detect Project Structure Failure

**Finding:** Define failure behavior when project structure auto-detection fails.

**Resolution:**

```typescript
interface AutoDetectResult {
  status: 'success' | 'failed';
  config?: {
    language: string;
    frameworks: string[];
    code_patterns: { include: string[]; exclude: string[] };
  };
  error?: string;
}

// Failure conditions:
// 1. LLM returns invalid JSON -> status: 'failed'
// 2. LLM call times out (30 seconds) -> status: 'failed'
// 3. LLM returns valid JSON but fields are nonsensical -> status: 'failed'

// On failure:
// - Action submits { status: 'failed', error: 'reason' } to DocAlign API
// - Server applies fallback: code_patterns.include = ['**'], code_patterns.exclude = standard excludes
// - Log warning: "Auto-detect failed for repo {repo_id}: {error}. Using default patterns."
// - Scan continues normally with default patterns
// - Config validation warning appears in next PR summary (audit finding I10):
//   "Configuration note: Project structure auto-detection failed. Using default file patterns."
```

#### A21: Monorepo Version Match Order

**Finding:** Define lookup order for manifests in monorepos.

**Resolution:** Covered in A15 above. Closest to repo root first (shortest path), then alphabetically. Return first match.

### 5.2 Integration Findings (G1-G8)

#### G1: Review Comment Marker Format

**Finding:** Define exact marker format for review comments.

**Resolution:** Fully specified in Section 1.2.7:

```
<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->
```

Additional marker for resolved comments:

```
<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} resolved-by={new_scan_run_id} -->
```

And for summary comments:

```
<!-- docalign-summary scan-run-id={scan_run_id} -->
```

#### G2: Fix Acceptance Detection

**Finding:** Define how fix acceptance is detected.

**Resolution:** Fully specified in Section 1.1.5. Dual mechanism:

1. **Primary (fast path):** `pull_request_review` webhook detects suggestion acceptance events.
2. **Fallback (authoritative):** On next `pull_request.synchronize`, diff changed doc files against previously suggested fixes using substring match (whitespace-normalized).

#### G3: L0 File Tree Format

**Finding:** Define `getFileTree()` return format.

**Resolution:**

```typescript
/**
 * Returns a flat array of all file paths in the repository,
 * relative to the repo root, sorted alphabetically.
 * All paths use forward slashes (even on Windows).
 * Excludes files matching .gitignore patterns.
 * Excludes files matching code_patterns.exclude.
 *
 * Example: ['README.md', 'docs/api.md', 'src/auth/handler.ts', 'src/index.ts']
 */
async function getFileTree(repoId: string): Promise<string[]>
```

**Implementation note:** Populated from git's tracked files list (`git ls-files`), which automatically respects `.gitignore`. Stored in `code_entities` table (the file tree is the distinct set of `file_path` values, plus any files not containing parseable entities but still in the repo).

#### G4: Evidence Format Template

**Finding:** Document the evidence format for Path 1 verification.

**Resolution:** The `formatEvidence()` function produces this format (from Spike B Section 5.1):

```
// File: {file_path}
// Imports:
{import_lines}

// Entity: {entity_name} (lines {start_line}-{end_line})
{entity_code}

// Type Signatures:
{type_signatures}
```

Full TypeScript specification:

```typescript
function formatEvidence(params: {
  file_path: string;
  imports: string;        // Up to 30 lines of imports
  entity_code: string;    // Full entity body from tree-sitter
  entity_name: string;
  entity_lines: [number, number];
  type_signatures?: string; // Optional same-file type defs
}): string {
  let evidence = `// File: ${params.file_path}\n`;
  evidence += `// Imports:\n${params.imports}\n\n`;
  evidence += `// Entity: ${params.entity_name} (lines ${params.entity_lines[0]}-${params.entity_lines[1]})\n`;
  evidence += params.entity_code;

  if (params.type_signatures) {
    evidence += `\n\n// Type Signatures:\n${params.type_signatures}`;
  }

  return evidence;
}
```

#### G5: Co-Change Tracking in PRs

**Finding:** L4 PR scan should also call `recordCoChanges()`.

**Resolution:** Deferred to v2 (co-change tracking is a v2/v3 feature). Noted in the coverage matrix. No action for MVP.

#### G6: Embedding Dimension Change Handling

**Finding:** Define behavior when embedding model changes.

**Resolution:** Resolved in 3A Section 5.2 and detailed in Section 3.3 of this document:

1. When `llm.embedding_model` changes in `.docalign.yml`, the next scan detects a dimension mismatch.
2. All existing embeddings are invalidated.
3. A full re-index is required (all embeddings regenerated).
4. Until re-index completes, semantic search (mapper Step 3) is disabled; only Steps 1-2 are used for mapping.
5. The system logs an error and prompts re-index via Check Run output.

#### G7: Zero-Findings vs No-Claims-In-Scope

**Finding:** L5 should distinguish between "no claims needed verification" and "all claims verified, 0 issues."

**Resolution:**

```typescript
type ScanOutcome =
  | { type: 'no_claims_in_scope'; message: string }
  | { type: 'all_verified'; total_checked: number; health_score: number }
  | { type: 'findings_found'; total_checked: number; findings: Finding[]; health_score: number };

function determineScanOutcome(
  claimsChecked: number,
  findings: Finding[]
): ScanOutcome {
  if (claimsChecked === 0) {
    return {
      type: 'no_claims_in_scope',
      message: 'No documentation claims were affected by the changes in this PR.'
    };
  }

  if (findings.length === 0) {
    return {
      type: 'all_verified',
      total_checked: claimsChecked,
      health_score: 1.0
    };
  }

  return {
    type: 'findings_found',
    total_checked: claimsChecked,
    findings,
    health_score: (claimsChecked - findings.length) / claimsChecked
  };
}
```

**PR comment rendering:**

- `no_claims_in_scope`: Brief summary comment: "No documentation claims are affected by this PR. (M claims in repo, all up to date.)" Check Run conclusion: `success`.
- `all_verified`: "All N claims verified. Documentation is in sync. Health score: 100%." Check Run conclusion: `success`.
- `findings_found`: Full summary + review comments. Check Run conclusion per severity rules.

#### G8: Syntax Validation Language Coverage

**Finding:** L1 syntax validation only runs for languages supported by L0 tree-sitter grammars.

**Resolution:**

```typescript
const SUPPORTED_SYNTAX_VALIDATION_LANGUAGES = new Set([
  'typescript', 'ts',
  'javascript', 'js', 'jsx', 'tsx',
  'python', 'py',
  // v2: 'go', 'rust'
  // v3: 'java'
]);

function shouldValidateSyntax(codeBlockLanguage: string | null): boolean {
  if (!codeBlockLanguage) return false;
  return SUPPORTED_SYNTAX_VALIDATION_LANGUAGES.has(codeBlockLanguage.toLowerCase());
}

// Unsupported language code blocks:
// - Skip syntax validation (not a failure)
// - Still extract sub-claims (imports, symbols, commands) from the text
// - Mark the syntax_validated field as false
// - Do NOT report "syntax invalid" for unsupported languages
```

---

## 6. Cross-References

| Document | Relevant Sections | Relationship |
|----------|------------------|--------------|
| `phases/phase3-architecture.md` | Sections 2, 6, 7, 8, 9, 11 | Primary input. This document details the integration contracts summarized there. |
| `PRD.md` | Sections 2, 3, 12, Appendix A | Product requirements that drive integration design. |
| `phases/adr-agent-first-architecture.md` | Sections 4, 5, 6 | Agent Task API contract originates here. This document provides full request/response examples. |
| `phases/spike-b-evidence-assembly.md` | Sections 5.1-5.4 | Two-path evidence assembly, routing logic, data structures. This document integrates them into the task API. |
| `phases/technical-reference.md` | Sections 3.1-3.8, 4, 7 | TypeScript interfaces, SQL schemas, LLM prompts. This document specifies exact HTTP contracts. |
| `prd/L0-codebase-index.md` | Section 4.4 (embeddings) | Embedding generation runs client-side. Dimension handling specified here. |
| `prd/L3-verification-engine.md` | Sections 7.2, 7.5 | Verification pipeline, two-path model. This document specifies the API contracts. |
| `prd/L4-change-scanning.md` | Sections 8.2, 8.4 | Webhook handling, safeguards. This document specifies exact webhook payloads. |
| `prd/L5-report-fix.md` | Section 9.2 | PR output strategy. This document specifies exact GitHub API calls. |
| `prd/L6-mcp-server.md` | Sections 10.2, 10.3 | MCP tools and architecture. This document specifies tool schemas and DB connection. |
| `prd/infrastructure-deployment.md` | Section 13.1 | GitHub App setup, auth. This document specifies exact endpoints and payloads. |
| `phases/phase2.5-audit-findings.md` | Sections 2, 5 | Audit findings A13-A21, G1-G8. All resolved in this document. |
| `phases/phase3-error-handling.md` | (Phase 3C) | Error taxonomy -- complements the error handling specified here for agent results. |
| `phases/phase3-security.md` | (Phase 3E) | Security threat model -- webhook signature, token lifecycle, injection prevention cross-referenced here. |
| `phases/phase3-infrastructure.md` | (Phase 3D) | Deployment, monitoring -- complements rate limit and scaling details here. |
| `phases/phase3-decisions.md` | Decisions log | Cross-sub-phase decisions from this document logged there. |

---

## Appendix A: Audit Finding Resolution Matrix

| ID | Finding | Resolution | Section |
|----|---------|------------|---------|
| **A13** | Agent result handling (freeform, partial, refused) | Zod validation, sanitization, error taxonomy | 2.2.3, 5.1 |
| **A14** | Entity line count for routing | JOIN on code_entities (computed, not stored) | 5.1 |
| **A15** | Dependency version lookup format | Lock file first, manifest fallback, return source | 5.1 |
| **A16** | MCP server database connection | Env var -> config file -> interactive prompt | 4.2, 5.1 |
| **A18** | "Same claim" definition | Same `claim_id` (DB primary key), reset on re-extraction | 5.1 |
| **A19** | Version comparison edge cases | Full comparison logic for all formats | 5.1 |
| **A20** | Auto-detect failure behavior | Fallback to `**` with standard excludes, log warning | 5.1 |
| **A21** | Monorepo version match order | Closest to root first, alphabetical tiebreak | 5.1 |
| **G1** | Review comment marker format | `<!-- docalign-review-comment claim-id={} scan-run-id={} -->` | 1.2.7, 5.2 |
| **G2** | Fix acceptance detection | Dual: webhook fast path + diff fallback | 1.1.5, 5.2 |
| **G3** | L0 file tree format | Flat array, relative paths, forward slashes, sorted | 5.2 |
| **G4** | Evidence format template | File header + imports + entity code + type sigs | 5.2 |
| **G5** | Co-change tracking in PRs | Deferred to v2 | 5.2 |
| **G6** | Embedding dimension change handling | Full re-index required, dimension validation | 3.3, 5.2 |
| **G7** | Zero-findings vs no-claims-in-scope | Three outcome types with distinct messages | 5.2 |
| **G8** | Syntax validation language coverage | Only tree-sitter-supported languages; unsupported = skip | 5.2 |
