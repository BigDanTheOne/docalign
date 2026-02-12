# TDD-4: Change Triggers (Layer 4)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 6), phase3-architecture.md (Sections 6-7, 11), phase3-error-handling.md (Sections 3-4), phase3-decisions.md (REVIEW-001/002/003, 3C-006), phase3-integration-specs.md (Sections 1-2), prd/L4-change-scanning.md
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 4 (Change Triggers) is the orchestration layer of DocAlign. It receives scan requests from the API server (via webhook-driven enqueue calls), creates BullMQ jobs, and runs the worker processors that execute the full scan pipeline -- coordinating L0 (index update), L1 (claim extraction), L2 (mapping), L3 (verification), L5 (reporting), and L7 (learning) in sequence. It enforces debounce, per-repo serialization, rate limits, cancellation, timeouts, and claim prioritization.

L4 owns the `scan_runs` lifecycle (queued -> running -> completed/partial/failed/cancelled) and is the only layer that writes to this table. The TriggerService public API is consumed by the API server webhook handlers. The BullMQ worker processors are internal functions that contain the core orchestration logic.

**Boundaries:** L4 does NOT perform claim extraction, mapping, verification, or reporting itself. It calls other layers' public APIs for all domain logic. L4 does NOT handle webhook parsing or signature verification (that is the API server's responsibility).

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| L0 `CodebaseIndexService` | `updateFromDiff(repoId, changedFiles)` | PR/push scan: index update (step 5d) |
| L0 `CodebaseIndexService` | `getFileTree(repoId)` | Scope resolution: classify doc vs code files |
| L1 `ClaimExtractorService` | `reExtract(repoId, docFile, content)` | Doc file changed in PR/push |
| L1 `ClaimExtractorService` | `deleteClaimsForFile(repoId, docFile)` | Doc file deleted in PR/push |
| L1 `ClaimExtractorService` | `getClaimsByRepo(repoId)` | Full scan: re-extract all |
| L2 `MapperService` | `findClaimsByCodeFiles(repoId, codeFiles)` | Reverse index lookup |
| L2 `MapperService` | `mapClaim(repoId, claim)` | New claims need mapping |
| L2 `MapperService` | `updateCodeFilePaths(repoId, renames)` | File renames in diff |
| L2 `MapperService` | `removeMappingsForFiles(repoId, files)` | File deletions in diff |
| L2 `MapperService` | `getMappingsForClaim(claimId)` | Get mappings for routing |
| L3 `VerifierService` | `verifyDeterministic(claim, mappings)` | Tiers 1-2 server-side |
| L3 `VerifierService` | `routeClaim(claim, mappings)` | Routing decision before task creation |
| L3 `VerifierService` | `buildPath1Evidence(claim, mappings)` | Build evidence for Path 1 tasks |
| L3 `VerifierService` | `mergeResults(scanRunId)` | After all tasks complete |
| L5 `ReporterService` | `postPRComment(owner, repo, prNumber, payload, installationId)` | Post findings |
| L5 `ReporterService` | `markResolved(...)` | Mark old comments resolved |
| L5 `ReporterService` | `calculateHealthScore(repoId)` | Update cached health score |
| L7 `LearningService` | `isClaimSuppressed(claim)` | Filter suppressed claims |
| L7 `LearningService` | `recordCoChanges(repoId, codeFiles, docFiles, sha)` | Push scan: track co-changes |
| GitHub API (Octokit) | PR diff, file content, Check Run API, repository dispatch | PR scan flow |
| Redis | Cancellation keys, rate limit counters | Debounce and rate limiting |
| BullMQ | Job queue, debounce, per-repo serialization | All scan types |
| PostgreSQL | `scan_runs`, `agent_tasks`, `repos` tables | State persistence |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| API Server (webhook handler) | `enqueuePRScan` | `pull_request.opened` / `pull_request.synchronize` |
| API Server (webhook handler) | `enqueuePushScan` | `push` to default branch |
| API Server (installation handler) | `enqueueFullScan` | `installation.created`, manual trigger |
| API Server (cancel handler) | `cancelScan` | User-initiated cancel, uninstall |
| Worker (internal) | `updateScanStatus` | Pipeline stage transitions |
| Worker (internal) | `resolveScope` | Determine which claims to verify |

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md`. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `ScanRun` (Section 6.1) -- scan execution record
- `ScanStatus` (Section 1) -- `'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'`
- `ScanType` (Section 1) -- `'pr' | 'full' | 'push'`
- `TriggerType` (Section 1) -- `'pr' | 'push' | 'scheduled' | 'manual' | 'agent_report'`
- `Claim` (Section 3.1) -- claim record
- `ClaimMapping` (Section 4.1) -- mapping record
- `VerificationResult` (Section 5.1) -- verification output
- `RoutingDecision` (Section 5.1) -- routing decision
- `FormattedEvidence` (Section 5.2) -- Path 1 evidence payload
- `FileChange` (Section 2.1) -- diff entry from GitHub
- `AgentTask` (Section 10.1) -- agent task record
- `AgentTaskPayload` (Section 10.2) -- task payload discriminated union
- `RepositoryDispatchPayload` (Section 11.1) -- dispatch event payload
- `PRCommentPayload` (Section 7.1) -- PR comment data
- `Finding` (Section 7.1) -- individual finding
- `HealthScore` (Section 7.1) -- repo health metrics
- `DocAlignConfig` (Section 14) -- parsed `.docalign.yml`

**Referenced service interfaces:**
- `TriggerService` (Section 6.2) -- the public API surface
- `CodebaseIndexService` (Section 2.2)
- `ClaimExtractorService` (Section 3.2)
- `MapperService` (Section 4.2)
- `VerifierService` (Section 5.2)
- `ReporterService` (Section 7.2)
- `LearningService` (Section 9.2)

**Layer-internal types** (not in api-contracts, specific to L4 implementation):

```typescript
/** BullMQ job data for a PR scan */
interface PRScanJobData {
  repo_id: string;
  pr_number: number;
  head_sha: string;
  base_ref: string;
  installation_id: number;
  delivery_id: string;
}

/** BullMQ job data for a push scan */
interface PushScanJobData {
  repo_id: string;
  commit_sha: string;
  installation_id: number;
  changed_files: FileChange[];
}

/** BullMQ job data for a full scan */
interface FullScanJobData {
  repo_id: string;
  installation_id: number;
}

/** Internal classification of changed files */
interface ClassifiedFiles {
  code_files: FileChange[];
  doc_files: FileChange[];
  renames: Array<{ from: string; to: string }>;
  deletions: string[];
}

/** Claim with its priority score for max_claims_per_pr cap */
interface PrioritizedClaim {
  claim: Claim;
  priority_score: number;    // severity_weight * confidence
}

/** Scan pipeline stage for cancellation check tracking */
type PipelineStage =
  | 'index_update'
  | 'extraction'
  | 'mapping_lookup'
  | 'routing'
  | 'task_creation'
  | 'agent_waiting'
  | 'deterministic_verify'
  | 'merge_results'
  | 'reporting';

/** Rate limit check result */
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset_at: Date;
  scope: 'repo' | 'org';
}
```

---

## 4. Public API

### 4.1 enqueuePRScan

#### Signature

```typescript
enqueuePRScan(
  repoId: string,
  prNumber: number,
  headSha: string,
  installationId: number,
  deliveryId: string
): Promise<string>  // returns scan_run_id
```

#### Algorithm

```
function enqueuePRScan(repoId, prNumber, headSha, installationId, deliveryId):
  // 1. Rate limit check
  rateLimitResult = checkRateLimit(repoId, installationId)
  if not rateLimitResult.allowed:
    log(INFO, "rate_limit_exceeded", { repoId, scope: rateLimitResult.scope })
    throw DocAlignError(DOCALIGN_E405, "Rate limit exceeded", { repoId })

  // 2. Create scan_run record
  scanRunId = uuid()
  INSERT INTO scan_runs (
    id, repo_id, trigger_type, trigger_ref, status, commit_sha,
    claims_checked, claims_drifted, claims_verified, claims_uncertain,
    total_token_cost, total_duration_ms, comment_posted, check_run_id, started_at
  ) VALUES (
    scanRunId, repoId, 'pr', String(prNumber), 'queued', headSha,
    0, 0, 0, 0, 0, 0, false, null, NOW()
  )

  // 3. Enqueue BullMQ job with debounce
  jobId = "pr-scan-" + repoId + "-" + prNumber
  queueName = "repo-" + repoId

  // Check if an active job exists for this PR
  existingJob = queue.getJob(jobId)
  if existingJob and existingJob.isActive():
    // Mark existing job for cancellation
    redis.set("cancel:" + existingJob.id, "1", { EX: 600 })

  // Add new job (replaces waiting job, or queues after active)
  queue.add(queueName, {
    repo_id: repoId,
    pr_number: prNumber,
    head_sha: headSha,
    base_ref: baseRef,
    installation_id: installationId,
    delivery_id: deliveryId
  }, {
    jobId: jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 600000  // 10 minutes
  })

  return scanRunId
```

#### Input/Output Example 1

```
Input:  enqueuePRScan("repo-uuid-001", 42, "abc123def", 12345, "gh-delivery-uuid-001")
Output: "scan-run-uuid-550"
// Scan run created with status 'queued', BullMQ job enqueued
// Job ID: "pr-scan-repo-uuid-001-42"
// Queue: "repo-repo-uuid-001"
```

#### Input/Output Example 2

```
Input:  enqueuePRScan("repo-uuid-001", 42, "def456ghi", 12345, "gh-delivery-uuid-002")
Output: "scan-run-uuid-551"
// Second push to same PR. Previous job (if waiting) is replaced.
// If previous job was active, cancel:pr-scan-repo-uuid-001-42 key is set.
```

#### Negative Example

Does NOT execute the scan pipeline. It only enqueues the job. The actual scan processing happens in the BullMQ worker (processPRScan). Does NOT verify the webhook signature -- that is the API server's responsibility before calling this function.

#### Edge Cases

- Rapid-fire pushes: only the most recent enqueue survives due to BullMQ job ID replacement.
- Rate limit reached: throws `DocAlignError` with code `DOCALIGN_E405`. Caller (API server) should still respond HTTP 200 to GitHub.
- Repo not found in DB: caller must verify repo exists before calling. This function does not validate repo existence.
- Duplicate delivery ID: BullMQ deduplicates by job ID (`pr-scan-{repo_id}-{pr_number}`), not delivery ID. Two different deliveries for the same PR produce the same job ID -- natural dedup.

#### Error Handling

- Redis connection failure during enqueue: throw `DocAlignError` code `DOCALIGN_E601`, retryable.
- Database failure during scan_run INSERT: throw `DocAlignError` code `DOCALIGN_E301`, retryable.
- BullMQ add failure: throw `DocAlignError` code `DOCALIGN_E601`, retryable.

---

### 4.2 enqueuePushScan

#### Signature

```typescript
enqueuePushScan(
  repoId: string,
  commitSha: string,
  installationId: number
): Promise<string>  // returns scan_run_id
```

#### Algorithm

```
function enqueuePushScan(repoId, commitSha, installationId):
  // 1. Rate limit check
  rateLimitResult = checkRateLimit(repoId, installationId)
  if not rateLimitResult.allowed:
    log(INFO, "rate_limit_exceeded", { repoId, scope: rateLimitResult.scope })
    throw DocAlignError(DOCALIGN_E405, "Rate limit exceeded", { repoId })

  // 2. Create scan_run record
  scanRunId = uuid()
  INSERT INTO scan_runs (
    id, repo_id, trigger_type, trigger_ref, status, commit_sha,
    claims_checked, claims_drifted, claims_verified, claims_uncertain,
    total_token_cost, total_duration_ms, comment_posted, started_at
  ) VALUES (
    scanRunId, repoId, 'push', commitSha, 'queued', commitSha,
    0, 0, 0, 0, 0, 0, false, NOW()
  )

  // 3. Enqueue BullMQ job
  jobId = "push-scan-" + repoId + "-" + commitSha
  queueName = "repo-" + repoId

  queue.add(queueName, {
    repo_id: repoId,
    commit_sha: commitSha,
    installation_id: installationId
  }, {
    jobId: jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 600000
  })

  return scanRunId
```

#### Input/Output Example 1

```
Input:  enqueuePushScan("repo-uuid-001", "abc123def", 12345)
Output: "scan-run-uuid-600"
// Job ID: "push-scan-repo-uuid-001-abc123def"
```

#### Input/Output Example 2

```
Input:  enqueuePushScan("repo-uuid-001", "abc123def", 12345)
Output: "scan-run-uuid-601"
// Same commit SHA pushed again (redelivery). BullMQ deduplicates by job ID.
// The second queue.add() is a no-op if the first job exists.
```

#### Negative Example

Does NOT post any PR comments. Push scans update health scores and the claim database only. Does NOT process pushes to non-default branches -- the API server filters those out before calling.

#### Edge Cases

- Push with zero commits (e.g., tag push): the API server should not call this function for tag pushes. If called with an empty commit list, the worker pipeline handles it gracefully (empty diff -> no changes -> quick completion).
- Same commit SHA as last indexed: the worker pipeline detects no changes and completes quickly.

#### Error Handling

- Same as `enqueuePRScan`: Redis `DOCALIGN_E601`, DB `DOCALIGN_E301`.

---

### 4.3 enqueueFullScan

#### Signature

```typescript
enqueueFullScan(
  repoId: string,
  installationId: number
): Promise<string>  // returns scan_run_id
```

#### Algorithm

```
function enqueueFullScan(repoId, installationId):
  // No rate limit check for full scans (they are infrequent, triggered by install/schedule)

  scanRunId = uuid()
  INSERT INTO scan_runs (
    id, repo_id, trigger_type, trigger_ref, status, commit_sha,
    claims_checked, claims_drifted, claims_verified, claims_uncertain,
    total_token_cost, total_duration_ms, comment_posted, started_at
  ) VALUES (
    scanRunId, repoId, 'scheduled', null, 'queued', '',
    0, 0, 0, 0, 0, 0, false, NOW()
  )

  jobId = "full-scan-" + repoId + "-" + Date.now()
  queueName = "repo-" + repoId

  queue.add(queueName, {
    repo_id: repoId,
    installation_id: installationId
  }, {
    jobId: jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 600000
  })

  return scanRunId
```

#### Input/Output Example 1

```
Input:  enqueueFullScan("repo-uuid-001", 12345)
Output: "scan-run-uuid-700"
// Job ID: "full-scan-repo-uuid-001-1739290800000"
// Full scans use a timestamp suffix since they are not deduplicated like PR scans
```

#### Input/Output Example 2

```
Input:  enqueueFullScan("repo-uuid-new", 67890)
Output: "scan-run-uuid-701"
// First scan for a newly installed repo. trigger_type = 'scheduled'
```

#### Negative Example

Does NOT skip rate limits for full scans. Full scans are typically rare (onboarding, scheduled). Does NOT use a PR-style debounce -- each full scan enqueue creates a new job (timestamp in job ID prevents dedup). They are serialized by the per-repo queue.

#### Edge Cases

- Full scan requested while a PR scan is in progress: the full scan waits in the per-repo queue (concurrency 1).
- Multiple full scan requests (e.g., during onboarding retries): each creates a separate job. The per-repo queue serializes them. If this causes queue buildup, the second full scan will see the data from the first and complete quickly.

#### Error Handling

- Same as `enqueuePRScan`: Redis `DOCALIGN_E601`, DB `DOCALIGN_E301`.

---

### 4.4 resolveScope

#### Signature

```typescript
resolveScope(
  repoId: string,
  changedCodeFiles: string[],
  changedDocFiles: string[]
): Promise<Claim[]>
```

#### Algorithm

```
function resolveScope(repoId, changedCodeFiles, changedDocFiles):
  claimSet = new Set<string>()   // claim IDs for dedup
  claims = []

  // 1. Claims from changed doc files (these may reference unchanged code)
  for docFile in changedDocFiles:
    docClaims = L1.getClaimsByFile(repoId, docFile)
    for claim in docClaims:
      if not claimSet.has(claim.id):
        claimSet.add(claim.id)
        claims.push(claim)

  // 2. Claims affected by code changes (reverse index lookup)
  if changedCodeFiles.length > 0:
    codeClaims = L2.findClaimsByCodeFiles(repoId, changedCodeFiles)
    for claim in codeClaims:
      if not claimSet.has(claim.id):
        claimSet.add(claim.id)
        claims.push(claim)

  return claims
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  changedCodeFiles: ["src/auth/handler.ts", "src/utils/helpers.ts"]
  changedDocFiles: ["docs/api.md"]

Output: [
  { id: "claim-001", source_file: "docs/api.md", claim_text: "POST /api/auth/login returns 200...", ... },
  { id: "claim-002", source_file: "docs/api.md", claim_text: "Authentication uses bcrypt...", ... },
  { id: "claim-003", source_file: "README.md", claim_text: "Run npm run test:unit...", ... }
]
// claim-001 and claim-002 from changed doc file
// claim-003 from reverse index lookup (mapped to src/auth/handler.ts)
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  changedCodeFiles: ["src/config/database.ts"]
  changedDocFiles: []

Output: [
  { id: "claim-010", source_file: "docs/architecture.md", claim_text: "Database connection uses connection pooling...", ... }
]
// Only code changed. Reverse index found one claim mapped to the changed file.
```

#### Negative Example

Does NOT filter suppressed claims. Suppression filtering happens later in the pipeline (step 5i). Does NOT prioritize or cap claims -- that is done after resolveScope returns, using the `max_claims_per_pr` configuration.

Does NOT include claims from unchanged doc files that happen to reference unchanged code. Scope is strictly the diff-affected set.

#### Edge Cases

- Both code and doc files change, with overlapping claims: deduplication by claim ID ensures no double-counting.
- Zero changed files in both categories: return `[]`.
- Changed doc file has no extracted claims (new file, not yet extracted): return only code-affected claims. L1 extraction happens in an earlier pipeline step.

#### Error Handling

- L1 or L2 call failure: propagate the error. Caller (worker) handles per-job retry.
- Database timeout: `DocAlignError` code `DOCALIGN_E302`, retryable.

---

### 4.5 cancelScan

#### Signature

```typescript
cancelScan(scanRunId: string): Promise<void>
```

#### Algorithm

```
function cancelScan(scanRunId):
  // 1. Look up the scan run
  scanRun = SELECT * FROM scan_runs WHERE id = scanRunId
  if scanRun is null:
    throw DocAlignError(DOCALIGN_E404, "Scan run not found")

  if scanRun.status in ('completed', 'failed', 'cancelled'):
    return  // already terminal, no-op

  // 2. If queued, remove the BullMQ job
  if scanRun.status == 'queued':
    jobId = findJobIdForScanRun(scanRunId)
    queue.remove(jobId)
    UPDATE scan_runs SET status = 'cancelled', completed_at = NOW()
      WHERE id = scanRunId

  // 3. If running, set Redis cancellation key
  if scanRun.status == 'running':
    jobId = findJobIdForScanRun(scanRunId)
    redis.set("cancel:" + jobId, "1", { EX: 600 })
    // Worker will detect at next stage boundary and set status to 'cancelled'
```

#### Input/Output Example 1

```
Input:  cancelScan("scan-run-uuid-550")
Output: void
// Scan was 'queued'. BullMQ job removed. Status set to 'cancelled'.
```

#### Input/Output Example 2

```
Input:  cancelScan("scan-run-uuid-551")
Output: void
// Scan was 'running'. Redis key cancel:pr-scan-repo-uuid-001-42 set with 10min TTL.
// Worker will detect cancellation at next stage boundary.
```

#### Negative Example

Does NOT immediately stop a running worker. The worker checks for cancellation only at defined stage boundaries. There may be a delay of up to one stage before the worker notices the cancellation.

Does NOT delete the scan_run record. Cancelled scans are preserved for auditing.

#### Edge Cases

- Scan already completed: no-op, returns successfully.
- Scan already cancelled: no-op, returns successfully.
- Scan run ID not found: throws `DOCALIGN_E404`.

#### Error Handling

- Redis failure when setting cancel key: log `DOCALIGN_E601` at WARN. The scan will continue to completion (cancellation is best-effort).
- Database failure: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.6 updateScanStatus

#### Signature

```typescript
updateScanStatus(
  scanRunId: string,
  status: ScanStatus,
  stats?: Partial<Pick<ScanRun,
    'claims_checked' | 'claims_drifted' | 'claims_verified' |
    'claims_uncertain' | 'total_token_cost' | 'total_duration_ms'
  >>
): Promise<void>
```

#### Algorithm

```
function updateScanStatus(scanRunId, status, stats):
  updateFields = { status }

  if status in ('completed', 'partial', 'failed', 'cancelled'):
    updateFields.completed_at = NOW()

  if stats:
    merge stats into updateFields

  UPDATE scan_runs SET ...updateFields WHERE id = scanRunId
```

#### Input/Output Example 1

```
Input:  updateScanStatus("scan-run-uuid-550", "running")
Output: void
// Status transitions from 'queued' to 'running'
```

#### Input/Output Example 2

```
Input:  updateScanStatus("scan-run-uuid-550", "completed", {
  claims_checked: 25,
  claims_drifted: 3,
  claims_verified: 20,
  claims_uncertain: 2,
  total_token_cost: 1500,
  total_duration_ms: 45000
})
Output: void
// Status set to 'completed' with all stats. completed_at set to NOW().
```

#### Negative Example

Does NOT validate state machine transitions. The caller (worker processor) is responsible for calling this with valid transitions. An invalid transition (e.g., `completed -> queued`) would succeed at the database level but represents a bug.

#### Edge Cases

- Stats object with zero values: accepted (valid for a scan with no findings).
- Scan run not found: UPDATE affects zero rows. Log a warning but do not throw.

#### Error Handling

- Database failure: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.7 processPRScan (Internal Worker Processor)

This is the core orchestration function executed by the BullMQ worker when a PR scan job is dequeued. It is NOT part of the TriggerService public API -- it is the internal worker callback.

#### Signature

```typescript
// BullMQ worker processor callback
async function processPRScan(job: Job<PRScanJobData>): Promise<void>
```

#### Algorithm (Full Pipeline Pseudocode)

```
async function processPRScan(job):
  data = job.data
  scanRunId = findScanRunForJob(data.repo_id, 'pr', String(data.pr_number))
  startTime = Date.now()

  try:
    // ── STEP 1: Transition to 'running', create GitHub Check Run ──
    updateScanStatus(scanRunId, 'running')
    checkRunId = github.createCheckRun(owner, repo, {
      name: 'DocAlign',
      head_sha: data.head_sha,
      status: 'in_progress'
    })
    UPDATE scan_runs SET check_run_id = checkRunId WHERE id = scanRunId

    // ── STEP 2: Fetch PR diff ──
    diffFiles = github.getPRFiles(owner, repo, data.pr_number, data.installation_id)
    // Returns FileChange[] with filename, status, additions, deletions, patch

    // ── STEP 3: Classify changed files ──
    classified = classifyFiles(diffFiles, repoConfig)
    // Separates into: code_files, doc_files, renames, deletions

    // ── STEP 4: L0 index update ──
    indexResult = L0.updateFromDiff(data.repo_id, diffFiles)
    log(INFO, "index_updated", { scanRunId, ...indexResult })

    // Handle renames: update claim_mappings.code_file
    if classified.renames.length > 0:
      L2.updateCodeFilePaths(data.repo_id, classified.renames)

    // Handle deletions: remove mappings for deleted code files
    if classified.deletions.length > 0:
      L2.removeMappingsForFiles(data.repo_id, classified.deletions.map(f => f.filename))

    // ── CANCELLATION CHECK 1: After L0 index update ──
    if await isCancelled(job.id):
      await savePartialAndExit(scanRunId, startTime)
      return

    // ── STEP 5: Doc file processing (extraction) ──
    // 5a. Delete claims for removed doc files
    for docFile in classified.doc_files where docFile.status == 'removed':
      L1.deleteClaimsForFile(data.repo_id, docFile.filename)

    // 5b. Re-extract claims for added/modified doc files
    extractionResults = []
    for docFile in classified.doc_files where docFile.status in ('added','modified','renamed'):
      content = github.getFileContent(owner, repo, docFile.filename, data.head_sha, data.installation_id)
      result = L1.reExtract(data.repo_id, docFile.filename, content)
      extractionResults.push(result)

    // 5c. Map new claims from extraction
    for result in extractionResults:
      for claim in result.added:
        L2.mapClaim(data.repo_id, claim)

    // 5d. Create agent tasks for semantic extraction (doc files that need LLM)
    agentExtractionFiles = classified.doc_files
      .filter(f => f.status in ('added', 'modified') and needsSemanticExtraction(f))
    // Agent extraction tasks are created in step 8 below with all other agent tasks

    // ── CANCELLATION CHECK 2: After extraction ──
    if await isCancelled(job.id):
      await savePartialAndExit(scanRunId, startTime)
      return

    // ── STEP 6: Resolve scope (which claims to verify) ──
    codeFilePaths = classified.code_files.map(f => f.filename)
    docFilePaths = classified.doc_files.map(f => f.filename)
    allClaims = resolveScope(data.repo_id, codeFilePaths, docFilePaths)

    // ── STEP 7: Filter suppressed claims ──
    unsuppressedClaims = []
    for claim in allClaims:
      if not await L7.isClaimSuppressed(claim):
        unsuppressedClaims.push(claim)

    // ── STEP 8: Prioritize and cap claims ──
    config = getRepoConfig(data.repo_id)
    maxClaims = min(config.verification.max_claims_per_pr ?? 50, 200)
    prioritized = prioritizeClaims(unsuppressedClaims)
    claimsToVerify = prioritized.slice(0, maxClaims)
    skippedClaims = prioritized.slice(maxClaims)

    // ── STEP 9: Deterministic verification (Tiers 1-2) ──
    deterministicResults = []
    claimsNeedingAgent = []
    for claim in claimsToVerify:
      mappings = await L2.getMappingsForClaim(claim.id)
      deterministicResult = await L3.verifyDeterministic(claim, mappings)
      if deterministicResult is not null:
        deterministicResults.push(deterministicResult)
        await L3.storeResult(deterministicResult)
      else:
        claimsNeedingAgent.push({ claim, mappings })

    // ── STEP 10: Route non-deterministic claims and create agent tasks ──
    agentTasks = []
    for { claim, mappings } in claimsNeedingAgent:
      routing = await L3.routeClaim(claim, mappings)

      if routing.path == 1:
        evidence = await L3.buildPath1Evidence(claim, mappings)
        agentTasks.push({
          type: 'verification',
          payload: {
            type: 'verification',
            verification_path: 1,
            claim: toClaimSummary(claim),
            evidence: evidence,
            routing_reason: routing.reason
          }
        })
      else:  // Path 2
        mappedFileHints = mappings.map(m => ({
          path: m.code_file,
          confidence: m.confidence,
          entity_name: null
        }))
        agentTasks.push({
          type: 'verification',
          payload: {
            type: 'verification',
            verification_path: 2,
            claim: toClaimSummary(claim),
            mapped_files: mappedFileHints,
            routing_reason: routing.reason
          }
        })

    // Add agent extraction tasks if needed
    if agentExtractionFiles.length > 0:
      agentTasks.push({
        type: 'claim_extraction',
        payload: {
          type: 'claim_extraction',
          doc_files: agentExtractionFiles.map(f => f.filename),
          project_context: getProjectContext(data.repo_id)
        }
      })

    // Batch INSERT all agent tasks via Infra.createAgentTasks
    if agentTasks.length > 0:
      taskIds = await Infra.createAgentTasks(data.repo_id, scanRunId, agentTasks)

    // ── CANCELLATION CHECK 3 (first of batch checks): After task creation ──
    if await isCancelled(job.id):
      await savePartialAndExit(scanRunId, startTime)
      return

    // ── STEP 11: Trigger GitHub Action via repository dispatch ──
    if agentTasks.length > 0:
      dispatchResult = await triggerRepositoryDispatch(owner, repo, data.installation_id, {
        repo_id: data.repo_id,
        scan_run_id: scanRunId,
        scan_type: 'pr',
        trigger_ref: String(data.pr_number),
        task_ids: agentTasks.map(t => t.id)
      })

      if dispatchResult.status == 404:
        // Action not configured (DOCALIGN_E206)
        log(WARN, "DOCALIGN_E206", { repoId: data.repo_id })
        // Continue with deterministic results only

      else:
        // Wait for agent tasks to complete (poll with timeout)
        await waitForAgentTasks(scanRunId, agentTasks.map(t => t.id), {
          timeout_ms: 600000 - (Date.now() - startTime),  // remaining time
          poll_interval_ms: 5000,
          cancellation_check_interval: 10,  // check cancel every 10 polls
          job_id: job.id
        })

    // ── CANCELLATION CHECK 4 (batch check during wait): checked inside waitForAgentTasks ──
    // waitForAgentTasks checks cancel:{job_id} every 10 poll iterations

    // ── STEP 12: Merge all results ──
    allResults = await L3.mergeResults(scanRunId)

    // Compute stats
    stats = computeStats(allResults, deterministicResults)
    updateScanStatus(scanRunId, 'running', stats)

    // ── STEP 13: Post PR comment ──
    // Check for force push (SHA mismatch)
    currentPR = await github.getPR(owner, repo, data.pr_number, data.installation_id)
    shaChanged = currentPR.head.sha !== data.head_sha

    // Build findings
    findings = buildFindings(allResults, claimsToVerify)

    // Calculate health score
    healthScore = await L5.calculateHealthScore(data.repo_id)

    // Calculate agent unavailable percentage
    agentUnavailablePct = computeAgentUnavailablePct(agentTasks, scanRunId)

    // Build PR comment payload
    payload = {
      findings,
      health_score: healthScore,
      scan_run_id: scanRunId,
      agent_unavailable_pct: agentUnavailablePct
    }

    // ── CANCELLATION CHECK 4: Before PR comment posting ──
    if await isCancelled(job.id):
      await savePartialAndExit(scanRunId, startTime)
      return

    // Check comment_posted flag (3C-006: prevent duplicates)
    scanRun = SELECT comment_posted FROM scan_runs WHERE id = scanRunId
    if not scanRun.comment_posted:
      // Mark resolved old comments
      resolvedClaimIds = findResolvedClaims(allResults, data.pr_number)
      if resolvedClaimIds.length > 0:
        await L5.markResolved(owner, repo, data.pr_number, resolvedClaimIds, scanRunId, data.installation_id)

      // Post comment (with force push warning if applicable)
      commentResult = await L5.postPRComment(owner, repo, data.pr_number, payload, data.installation_id)

      // Update scan run atomically
      UPDATE scan_runs SET comment_posted = true WHERE id = scanRunId

    // Update Check Run
    conclusion = determineCheckConclusion(allResults, skippedClaims)
    github.updateCheckRun(owner, repo, checkRunId, {
      status: 'completed',
      conclusion: conclusion
    })

    // ── STEP 14: Record co-changes for learning ──
    if codeFilePaths.length > 0 and docFilePaths.length > 0:
      await L7.recordCoChanges(data.repo_id, codeFilePaths, docFilePaths, data.head_sha)

    // ── COMPLETE ──
    finalStats = computeFinalStats(allResults, startTime)
    updateScanStatus(scanRunId, 'completed', finalStats)

  catch (error):
    if error is TimeoutError:
      // DOCALIGN_E407: save partial results
      partialResults = await L3.mergeResults(scanRunId)
      partialStats = computeStats(partialResults, [])
      updateScanStatus(scanRunId, 'partial', { ...partialStats, total_duration_ms: 600000 })

      // Post partial PR comment
      if not scanRun.comment_posted:
        partialPayload = buildPartialPayload(partialResults, scanRunId)
        await L5.postPRComment(owner, repo, data.pr_number, partialPayload, data.installation_id)
        UPDATE scan_runs SET comment_posted = true WHERE id = scanRunId

      // Update Check Run
      github.updateCheckRun(owner, repo, checkRunId, {
        status: 'completed',
        conclusion: 'neutral'
      })

    else:
      log(ERROR, "scan_failed", { scanRunId, error })
      updateScanStatus(scanRunId, 'failed', { total_duration_ms: Date.now() - startTime })
      throw error  // BullMQ will retry per job retry policy
```

#### Input/Output Example 1

```
Input (job.data):
  {
    repo_id: "repo-uuid-001",
    pr_number: 42,
    head_sha: "abc123def",
    base_ref: "main",
    installation_id: 12345,
    delivery_id: "gh-delivery-uuid-001"
  }

Output: void (side effects):
  - scan_runs.status transitions: queued -> running -> completed
  - GitHub Check Run created and completed
  - L0 index updated with changed files
  - Claims extracted, mapped, verified
  - PR summary comment posted
  - PR review comments posted on specific lines
  - Health score updated
```

#### Input/Output Example 2

```
Input (job.data):
  {
    repo_id: "repo-uuid-001",
    pr_number: 99,
    head_sha: "fff999",
    base_ref: "main",
    installation_id: 12345,
    delivery_id: "gh-delivery-uuid-050"
  }

Output: void (side effects for zero-finding scan):
  - scan_runs.status: queued -> running -> completed
  - claims_checked: 5, claims_drifted: 0, claims_verified: 5
  - PR comment: "All documentation claims are consistent with the code."
  - Check Run: completed, conclusion: 'success'
```

#### Negative Example

Does NOT run LLM calls server-side. All LLM work is delegated to the GitHub Action via agent tasks and repository dispatch. The worker only executes deterministic operations (L0 parsing, Tier 1-2 verification, claim routing) and waits for agent results.

Does NOT process webhooks for closed PRs. The API server filters `action: 'closed'` before enqueuing.

#### Edge Cases

- PR with only doc changes (no code): skip L0 update, extract claims, verify all claims in changed docs.
- PR with only code changes (no docs): skip extraction, use reverse index to find affected claims.
- Action not configured (dispatch 404): run Tier 1-2 only, post partial results with "Agent not configured" banner.
- All claims are deterministically verified: no agent tasks created, no dispatch needed.
- Force push detected (SHA mismatch at step 13): prepend warning to PR comment.
- Scan cancelled between steps: save completed work, set status to `cancelled`, exit gracefully.
- Zero affected claims: post "No verifiable claims affected by this PR" comment, Check Run success.

#### Error Handling

- **Timeout (DOCALIGN_E407):** Save partial results, post partial comment, status = `partial`, Check Run conclusion = `neutral`.
- **GitHub API failure (DOCALIGN_E101-E104):** Individual API calls retry per per-call profile. If diff fetch fails entirely, the scan fails and is retried at job level.
- **Dispatch 404 (DOCALIGN_E206):** Not an error. Skip agent tasks, run deterministic only.
- **Database failure (DOCALIGN_E301):** Job fails, BullMQ retries per job retry policy.
- **Cancellation:** Save completed work, status = `cancelled`. NOT a failure, does NOT increment retry count.

---

### 4.8 processPushScan (Internal Worker Processor)

#### Signature

```typescript
async function processPushScan(job: Job<PushScanJobData>): Promise<void>
```

#### Algorithm (Pseudocode)

```
async function processPushScan(job):
  data = job.data
  scanRunId = findScanRunForJob(data.repo_id, 'push', data.commit_sha)
  startTime = Date.now()

  try:
    updateScanStatus(scanRunId, 'running')

    // 1. Compute diff from push payload (commits.added/removed/modified)
    diffFiles = computeFilesFromPushPayload(data)

    // 2. Classify files
    classified = classifyFiles(diffFiles, repoConfig)

    // 3. L0 index update
    L0.updateFromDiff(data.repo_id, diffFiles)

    // Handle renames and deletions
    if classified.renames.length > 0:
      L2.updateCodeFilePaths(data.repo_id, classified.renames)
    if classified.deletions.length > 0:
      L2.removeMappingsForFiles(data.repo_id, classified.deletions.map(f => f.filename))

    // ── CANCELLATION CHECK 1 ──
    if await isCancelled(job.id): return savePartialAndExit(scanRunId, startTime)

    // 4. Doc file processing
    for docFile in classified.doc_files where docFile.status == 'removed':
      L1.deleteClaimsForFile(data.repo_id, docFile.filename)
    for docFile in classified.doc_files where docFile.status in ('added','modified'):
      content = github.getFileContent(owner, repo, docFile.filename, data.commit_sha, data.installation_id)
      L1.reExtract(data.repo_id, docFile.filename, content)

    // ── CANCELLATION CHECK 2 ──
    if await isCancelled(job.id): return savePartialAndExit(scanRunId, startTime)

    // 5. Resolve scope
    allClaims = resolveScope(data.repo_id,
      classified.code_files.map(f => f.filename),
      classified.doc_files.map(f => f.filename))

    // 6. Filter suppressed
    unsuppressed = allClaims.filter(c => !await L7.isClaimSuppressed(c))

    // 7. Deterministic verification
    for claim in unsuppressed:
      mappings = await L2.getMappingsForClaim(claim.id)
      result = await L3.verifyDeterministic(claim, mappings)
      if result: await L3.storeResult(result)

    // 8. Create agent tasks for non-deterministic claims, trigger dispatch
    // (same pattern as processPRScan steps 10-11)
    // ...agent task creation and dispatch...

    // 9. Wait for agent tasks
    // ...same waitForAgentTasks pattern...

    // 10. Merge results
    allResults = await L3.mergeResults(scanRunId)

    // 11. Update health score (NO PR comment for push scans)
    await L5.calculateHealthScore(data.repo_id)

    // 12. Record co-changes
    codeFilePaths = classified.code_files.map(f => f.filename)
    docFilePaths = classified.doc_files.map(f => f.filename)
    if codeFilePaths.length > 0 and docFilePaths.length > 0:
      await L7.recordCoChanges(data.repo_id, codeFilePaths, docFilePaths, data.commit_sha)

    // 13. Complete
    finalStats = computeFinalStats(allResults, startTime)
    updateScanStatus(scanRunId, 'completed', finalStats)

  catch (error):
    if error is TimeoutError:
      partialResults = await L3.mergeResults(scanRunId)
      updateScanStatus(scanRunId, 'partial', computeStats(partialResults, []))
    else:
      updateScanStatus(scanRunId, 'failed', { total_duration_ms: Date.now() - startTime })
      throw error
```

#### Input/Output Example 1

```
Input (job.data):
  { repo_id: "repo-uuid-001", commit_sha: "abc123", installation_id: 12345 }

Output: void (side effects):
  - L0 index updated
  - Claims re-verified
  - Health score recalculated
  - Co-changes recorded
  - No PR comment posted
```

#### Input/Output Example 2

```
Input (job.data):
  { repo_id: "repo-uuid-001", commit_sha: "deadbeef", installation_id: 12345 }

Output: void (zero-change push):
  - Diff is empty. All steps are no-ops.
  - scan_runs.status: completed with claims_checked: 0
```

#### Negative Example

Does NOT post PR comments. Push scans are silent -- they update the internal state only. Does NOT create a GitHub Check Run (Check Runs are PR-specific).

#### Edge Cases

- Push to non-default branch: the API server filters this out before calling `enqueuePushScan`. This function assumes the push is to the default branch.
- Empty push (no file changes): completes quickly with zero stats.

#### Error Handling

- Same as processPRScan: timeout -> partial, other errors -> failed + retry.

---

### 4.9 processFullScan (Internal Worker Processor)

#### Signature

```typescript
async function processFullScan(job: Job<FullScanJobData>): Promise<void>
```

#### Algorithm (Pseudocode)

```
async function processFullScan(job):
  data = job.data
  scanRunId = findScanRunForJob(data.repo_id, 'scheduled', null)
  startTime = Date.now()

  try:
    updateScanStatus(scanRunId, 'running')

    // 1. Clone the repository (full content needed)
    repoPath = await cloneRepo(data.repo_id, data.installation_id)

    // 2. Full L0 index rebuild
    allFiles = walkFileTree(repoPath)
    allFileChanges = allFiles.map(f => ({ filename: f, status: 'added', additions: 0, deletions: 0 }))
    L0.updateFromDiff(data.repo_id, allFileChanges)

    // ── CANCELLATION CHECK 1 ──
    if await isCancelled(job.id): return savePartialAndExit(scanRunId, startTime)

    // 3. Re-extract ALL doc files
    docFiles = allFiles.filter(f => isDocFile(f))
    for docFile in docFiles:
      content = readFile(repoPath, docFile)
      L1.reExtract(data.repo_id, docFile, content)

    // ── CANCELLATION CHECK 2 ──
    if await isCancelled(job.id): return savePartialAndExit(scanRunId, startTime)

    // 4. Re-map ALL claims
    allClaims = await L1.getClaimsByRepo(data.repo_id)
    for claim in allClaims:
      await L2.mapClaim(data.repo_id, claim)

    // 5. Filter suppressed
    unsuppressed = allClaims.filter(c => !await L7.isClaimSuppressed(c))

    // 6. Deterministic verification for all unsuppressed claims
    deterministicResults = []
    claimsNeedingAgent = []
    for claim in unsuppressed:
      mappings = await L2.getMappingsForClaim(claim.id)
      result = await L3.verifyDeterministic(claim, mappings)
      if result:
        deterministicResults.push(result)
        await L3.storeResult(result)
      else:
        claimsNeedingAgent.push({ claim, mappings })

    // ── CANCELLATION CHECK 3 ──
    if await isCancelled(job.id): return savePartialAndExit(scanRunId, startTime)

    // 7. Route and create agent tasks (same pattern as PR scan)
    agentTasks = buildRoutedAgentTasks(claimsNeedingAgent)
    if agentTasks.length > 0:
      taskIds = await Infra.createAgentTasks(data.repo_id, scanRunId, agentTasks)
      await triggerRepositoryDispatch(owner, repo, data.installation_id, {
        repo_id: data.repo_id, scan_run_id: scanRunId,
        scan_type: 'full', trigger_ref: 'full-scan',
        task_ids: agentTasks.map(t => t.id)
      })
      await waitForAgentTasks(scanRunId, agentTasks.map(t => t.id), {
        timeout_ms: 600000 - (Date.now() - startTime),
        poll_interval_ms: 5000,
        cancellation_check_interval: 10,
        job_id: job.id
      })

    // 8. Merge all results
    allResults = await L3.mergeResults(scanRunId)

    // 9. Calculate and cache health score
    healthScore = await L5.calculateHealthScore(data.repo_id)
    UPDATE repos SET health_score = healthScore.score,
      total_claims = healthScore.total_claims,
      verified_claims = healthScore.verified,
      last_full_scan_at = NOW()
      WHERE id = data.repo_id

    // 10. Update repo status
    UPDATE repos SET status = 'active' WHERE id = data.repo_id AND status = 'scanning'

    // 11. Complete
    finalStats = computeFinalStats(allResults, startTime)
    updateScanStatus(scanRunId, 'completed', finalStats)

    // Cleanup
    removeCloneDir(repoPath)

  catch (error):
    removeCloneDir(repoPath)  // always cleanup
    if error is TimeoutError:
      partialResults = await L3.mergeResults(scanRunId)
      updateScanStatus(scanRunId, 'partial', computeStats(partialResults, []))
      UPDATE repos SET status = 'partial' WHERE id = data.repo_id AND status = 'scanning'
    else:
      updateScanStatus(scanRunId, 'failed', { total_duration_ms: Date.now() - startTime })
      throw error
```

#### Input/Output Example 1

```
Input (job.data):
  { repo_id: "repo-uuid-new", installation_id: 67890 }

Output: void (side effects):
  - Full L0 index built from clone
  - All doc files extracted
  - All claims mapped and verified
  - Health score calculated and cached
  - repos.status transitions: scanning -> active
```

#### Input/Output Example 2

```
Input (job.data):
  { repo_id: "repo-uuid-001", installation_id: 12345 }

Output: void (timeout scenario):
  - Partial L0 index built
  - Some claims verified before timeout
  - scan_runs.status = 'partial'
  - repos.status = 'partial'
  - repos.health_score updated with partial data
```

#### Negative Example

Does NOT post PR comments (no PR context). Does NOT create a GitHub Check Run. Does NOT debounce with PR scans -- full scans and PR scans share the same per-repo queue and are serialized.

#### Edge Cases

- Clone failure: throws, job retries via BullMQ.
- Empty repository (no files): completes quickly, health_score = null.
- Repository with thousands of claims: all verified, may hit timeout for very large repos.
- Full scan during onboarding with no Action: dispatch 404, Tier 1-2 only, status set to `awaiting_setup` instead of `active`.

#### Error Handling

- **Clone failure (DOCALIGN_E106):** Job fails, BullMQ retries.
- **Timeout (DOCALIGN_E407):** Save partial results, update repos.status to `partial`.
- **Action not configured (DOCALIGN_E206):** Run deterministic only, set repos.status to `awaiting_setup`, create Check Run with setup instructions.

---

## 5. Performance Targets

| Operation | Target | Measured By |
|-----------|--------|-------------|
| `enqueuePRScan` (enqueue latency) | < 100ms | Time from function call to BullMQ add completion |
| `enqueuePushScan` (enqueue latency) | < 100ms | Same |
| `enqueueFullScan` (enqueue latency) | < 100ms | Same |
| `resolveScope` (scope resolution) | < 200ms | L1 + L2 query time |
| Rate limit check | < 10ms | Redis INCR + GET |
| Cancellation check | < 5ms | Redis EXISTS |
| PR scan end-to-end (P50, 50 claims) | < 3 minutes | scan_runs.total_duration_ms |
| PR scan end-to-end (P95, 200 claims) | < 8 minutes | scan_runs.total_duration_ms |
| Push scan end-to-end (P50) | < 2 minutes | scan_runs.total_duration_ms |
| Full scan (500 claims) | < 10 minutes | scan_runs.total_duration_ms |
| Job queue throughput | 5 concurrent server-side jobs | BullMQ global concurrency setting |
| Per-repo queue throughput | 1 concurrent job per repo | BullMQ per-queue concurrency |
| Agent task wait poll interval | 5 seconds | Configurable |
| Maximum scan timeout | 10 minutes (server-side) | BullMQ job timeout |

---

## 6. Required Framework Knowledge

| Library/Tool | Version | Usage in L4 |
|-------------|---------|-------------|
| `bullmq` | ^5.x | Job queue: per-repo queues, debounce (job ID replacement), job timeout, retry with backoff, concurrency control, stalled job recovery |
| `ioredis` | ^5.x | Redis client: cancellation keys (`cancel:{job_id}` with TTL), rate limit counters (`INCR` + `EXPIRE`), installation token cache |
| `@octokit/rest` | ^20.x | GitHub API: fetch PR diff (`GET /repos/{owner}/{repo}/pulls/{pr_number}/files`), get file content, create/update Check Runs, send repository dispatch, get PR details for force push detection |
| `pg` (node-postgres) | ^8.x | PostgreSQL: `scan_runs` CRUD, `agent_tasks` batch INSERT, `repos` status updates |
| `uuid` | ^9.x | UUID generation for scan_run IDs |
| `pino` | ^8.x | Structured logging with safe mode |

**BullMQ-specific knowledge required:**

- **Named queues:** Creating a queue per repo (`new Queue('repo-' + repoId, { connection })`) for per-repo serialization.
- **Job ID for debounce:** Using `jobId` option in `queue.add()` to achieve natural deduplication. When a job with the same ID is added and the existing job is `waiting`, BullMQ replaces it.
- **Worker concurrency:** Setting `concurrency: 5` on the Worker to limit global server-side parallelism, with individual per-repo queues at concurrency 1.
- **Job timeout:** Using the `timeout` option (in ms) on jobs. BullMQ throws a specific error when the timeout fires.
- **Retry with backoff:** Using `attempts` and `backoff` options for automatic retry with exponential delay.
- **Stalled job recovery:** BullMQ's built-in stall detection (`stalledInterval` setting) for jobs where the worker crashes.
- **Job lifecycle events:** Listening for `completed`, `failed`, `stalled` events for monitoring.

**Redis-specific knowledge required:**

- **Atomic rate limiting:** `INCR` + `EXPIRE` pattern for rate limit counters. Key format: `ratelimit:{repo_id}:{utc_date}` with 48-hour TTL.
- **Cancellation keys:** `SET cancel:{job_id} 1 EX 600` to signal cancellation. Worker checks with `EXISTS cancel:{job_id}`.

**GitHub API-specific knowledge required:**

- **Repository dispatch:** `POST /repos/{owner}/{repo}/dispatches` with `event_type: 'docalign-scan'` and `client_payload` containing the scan context.
- **Check Run API:** `POST /repos/{owner}/{repo}/check-runs` to create, `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}` to update.
- **PR files API:** `GET /repos/{owner}/{repo}/pulls/{pr_number}/files` returns `FileChange[]` with diff patches.
- **Installation tokens:** JWT-based authentication flow, token caching, refresh on 401.

---

## 7. Open Questions

1. **Agent task completion detection:** The current design uses polling (`waitForAgentTasks`) to detect when all agent tasks for a scan have completed. An alternative is a webhook callback from the Action when all tasks are done, which would reduce polling overhead. Recommend polling for MVP simplicity, with a callback optimization post-MVP.

2. **Full scan clone strategy:** For very large repos (>1GB), cloning may be slow or exceed disk limits on Railway. Should L4 support a "shallow clone" (`--depth 1`) for full scans? This is sufficient since we only need the current state, not history. Recommend shallow clone for MVP.

3. **Per-repo queue cleanup:** BullMQ creates a queue per repo. When a repo is uninstalled, should the queue be explicitly deleted from Redis? BullMQ does not auto-clean empty queues. Recommend a periodic cleanup job that removes queues for deleted repos.

4. **Push scan diff computation:** The push webhook payload includes `commits[].added/removed/modified`, but this may not capture renames. Should push scans also use the GitHub compare API (`GET /repos/{owner}/{repo}/compare/{before}...{after}`) for accurate rename detection? Recommend using the compare API for push scans to match PR scan accuracy.

---

## Appendix A: Full PR Scan Pipeline (Numbered Steps)

This appendix maps to Phase 3A Section 7 (steps 5a-5m) with all cross-layer calls.

| Step | Description | Cross-Layer Calls | Cancellation Check |
|------|-------------|-------------------|-------------------|
| 1 | Transition scan to `running`, create GitHub Check Run | GitHub API: `POST /check-runs` | -- |
| 2 | Fetch PR diff (changed files) | GitHub API: `GET /pulls/{pr}/files` | -- |
| 3 | Classify files into code vs doc | Internal (glob pattern matching) | -- |
| 4 | Update codebase index for code changes | `L0.updateFromDiff(repoId, files)` | -- |
| 4b | Update mappings for renames | `L2.updateCodeFilePaths(repoId, renames)` | -- |
| 4c | Remove mappings for deletions | `L2.removeMappingsForFiles(repoId, deletions.map(f => f.filename))` | -- |
| -- | **CANCELLATION CHECK 1** | `redis.exists("cancel:" + jobId)` | YES |
| 5 | Delete claims for removed doc files | `L1.deleteClaimsForFile(repoId, file)` | -- |
| 6 | Re-extract claims for changed doc files | `L1.reExtract(repoId, file, content)` | -- |
| 7 | Map new claims from extraction | `L2.mapClaim(repoId, claim)` | -- |
| -- | **CANCELLATION CHECK 2** | `redis.exists("cancel:" + jobId)` | YES |
| 8 | Resolve scope (find all affected claims) | `L2.findClaimsByCodeFiles(repoId, files)`, `L1.getClaimsByFile(repoId, file)` | -- |
| 9 | Filter suppressed claims | `L7.isClaimSuppressed(claim)` | -- |
| 10 | Prioritize and cap claims | Internal (severity * confidence sort) | -- |
| 11 | Run deterministic verification (Tiers 1-2) | `L3.verifyDeterministic(claim, mappings)` | -- |
| 12 | Route non-deterministic claims | `L3.routeClaim(claim, mappings)` | -- |
| 13 | Build Path 1 evidence | `L3.buildPath1Evidence(claim, mappings)` | -- |
| 14 | Create agent tasks (batch INSERT) | PostgreSQL: INSERT agent_tasks | -- |
| -- | **CANCELLATION CHECK 3** | `redis.exists("cancel:" + jobId)` | YES |
| 15 | Trigger repository dispatch | GitHub API: `POST /repos/{owner}/{repo}/dispatches` | -- |
| 16 | Wait for agent task completion | PostgreSQL: poll agent_tasks status | YES (every 10 polls) |
| 17 | Merge all results (deterministic + agent) | `L3.mergeResults(scanRunId)` | -- |
| 18 | Check for force push (SHA mismatch) | GitHub API: `GET /pulls/{pr}` | -- |
| 19 | Build findings and health score | `L5.calculateHealthScore(repoId)` | -- |
| -- | **CANCELLATION CHECK 4** | `redis.exists("cancel:" + jobId)` | YES |
| 20 | Mark old comments resolved | `L5.markResolved(owner, repo, pr, claimIds, scanRunId, installId)` | -- |
| 21 | Post PR comment + review comments | `L5.postPRComment(owner, repo, pr, payload, installId)` | -- |
| 22 | Update Check Run to completed | GitHub API: `PATCH /check-runs/{id}` | -- |
| 23 | Record co-changes | `L7.recordCoChanges(repoId, codeFiles, docFiles, sha)` | -- |
| 24 | Update scan status to `completed` | PostgreSQL: UPDATE scan_runs | -- |

---

## Appendix B: Helper Functions

These are internal utility functions used by the worker processors. Not part of the public API.

### B.1 isCancelled

```typescript
async function isCancelled(jobId: string): Promise<boolean> {
  return (await redis.exists('cancel:' + jobId)) === 1;
}
```

### B.2 savePartialAndExit

```typescript
async function savePartialAndExit(scanRunId: string, startTime: number): Promise<void> {
  const duration = Date.now() - startTime;
  const partialResults = await L3.mergeResults(scanRunId);
  const stats = computeStats(partialResults, []);
  await updateScanStatus(scanRunId, 'cancelled', { ...stats, total_duration_ms: duration });
  // Note: cancelled != failed. No retry count increment.
}
```

### B.3 checkRateLimit

```typescript
async function checkRateLimit(repoId: string, installationId: number): Promise<RateLimitResult> {
  const today = new Date().toISOString().slice(0, 10);

  // Per-repo check (100/day)
  const repoKey = `ratelimit:${repoId}:${today}`;
  const repoCount = await redis.incr(repoKey);
  if (repoCount === 1) await redis.expire(repoKey, 172800); // 48h TTL
  if (repoCount > 100) {
    return { allowed: false, remaining: 0, reset_at: nextMidnightUTC(), scope: 'repo' };
  }

  // Per-org check (1000/day)
  const orgId = await getOrgIdForRepo(repoId);
  const orgKey = `ratelimit:org:${orgId}:${today}`;
  const orgCount = await redis.incr(orgKey);
  if (orgCount === 1) await redis.expire(orgKey, 172800);
  if (orgCount > 1000) {
    return { allowed: false, remaining: 0, reset_at: nextMidnightUTC(), scope: 'org' };
  }

  return { allowed: true, remaining: 100 - repoCount, reset_at: nextMidnightUTC(), scope: 'repo' };
}
```

### B.4 classifyFiles

Classifies `FileChange[]` into code vs doc files using extension matching and `.docalign.yml` patterns. Doc extensions: `.md`, `.mdx`, `.rst`, `.txt`, `.adoc`. Also populates `renames` (from renamed files) and `deletions` (from removed files). Files matching `exclude` patterns are dropped entirely.

### B.5 prioritizeClaims

Sorts claims by `severity_weight * extraction_confidence` descending. Severity weights: high=3, medium=2, low=1. Ties broken by file path (alphabetical), then line number (ascending). Per Phase 3A Section 11.4.

### B.6 waitForAgentTasks

Polls `agent_tasks` table every `poll_interval_ms` (default 5s) until all tasks for `scanRunId` are completed/failed/expired, or `timeout_ms` is reached. Checks `cancel:{job_id}` Redis key every `cancellation_check_interval` polls (default 10). On timeout, marks remaining tasks as expired via `expireRemainingTasks(scanRunId)`.

---

## Appendix C: Error Code Reference (L4-specific)

| Code | Scenario | Severity | Recovery |
|------|----------|----------|----------|
| DOCALIGN_E101 | GitHub API rate limit mid-scan | high | Pause/wait or defer comments |
| DOCALIGN_E103 | Installation token expired | medium | Refresh token, retry call |
| DOCALIGN_E106 | Clone failure | high | Retry job via BullMQ |
| DOCALIGN_E206 | Action not configured (dispatch 404) | medium | Skip agent tasks, run Tier 1-2 only |
| DOCALIGN_E301 | Database connection failure | high | Retry with connection profile |
| DOCALIGN_E404 | Concurrent webhooks / state conflict | low | BullMQ debounce handles |
| DOCALIGN_E405 | Rate limit exceeded (per-repo/per-org) | low | Skip scan, log |
| DOCALIGN_E407 | Scan timeout (10 minutes) | high | Save partial results, post partial comment |
| DOCALIGN_E601 | Redis connection failure | high | Retry with connection profile |

All error codes conform to the schema in phase3-error-handling.md Section 1.1.

---

## Appendix D: BullMQ Queue Configuration

- **Queue creation:** One queue per repo, created lazily on first scan. Name: `repo-{repoId}`. Default job options: `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`, `removeOnComplete: { count: 100 }`, `removeOnFail: { count: 50 }`.
- **Worker:** Global worker processes jobs from all `repo-*` queues. `concurrency: 5` (ADR-4). `stalledInterval: 30000ms`. `maxStalledCount: 2`.
- **Job routing:** The processor dispatches to `processPRScan`, `processPushScan`, or `processFullScan` based on the presence of `pr_number` vs `commit_sha` in `job.data`.
- **Wildcard queues:** BullMQ v5 supports `repo-*` pattern. If unavailable, use explicit queue registration per installed repo.
