# Phase 3B-E: Shared Decisions Log

> Coordination file for parallel sub-phases. Before making a design choice that could affect another sub-phase, write the decision here first.

---

## Decisions

### 3D-001: Migrations run in Railway buildCommand (pre-deploy)
- **Context:** Migrations must execute before the new code serves traffic.
- **Decision:** `buildCommand` in `railway.toml` runs `npm run build && npm run migrate:up`. Migrations complete during the build phase, before the new instance replaces the old one.
- **Cross-phase impact (3C, 3E):** Migrations MUST be backwards-compatible (additive only). Destructive schema changes require a two-phase deploy. Error handling (3C) must account for migration failures blocking deployment.
- **Date:** 2026-02-11

### 3D-002: Health check does NOT verify PostgreSQL on every call
- **Context:** `/health` is called every 30 seconds by Railway. Checking DB on every call is wasteful.
- **Decision:** Health endpoint checks Redis connectivity only. Database health is monitored by a separate BullMQ scheduled job every 5 minutes. Health returns 503 only if Redis is unreachable.
- **Cross-phase impact (3B):** Integration specs should document that `/health` returning 200 does NOT guarantee database availability. Agent Task API endpoints will return 503 on database failure independently.
- **Date:** 2026-02-11

### 3D-003: Retry policy is uniform across all error types
- **Context:** Audit finding I14 asked whether different error types should have different retry schedules.
- **Decision:** All errors use the same retry schedule: per-call (2 attempts, 1s/4s backoff), per-job (3 attempts, 1s/4s/16s backoff). No error-type-specific retry behavior in MVP.
- **Cross-phase impact (3C):** Error handling document should NOT define per-error-type retry schedules. Instead, errors are classified as retryable vs non-retryable. Non-retryable errors (auth failures, schema validation, rate limit exceeded at scan level) fail immediately.
- **Date:** 2026-02-11

### 3D-004: DOCALIGN_TOKEN is HMAC-based, not JWT
- **Context:** Need to define the token format for Agent Task API authentication.
- **Decision:** Token = `HMAC-SHA256(DOCALIGN_API_SECRET, repo_id + ":" + issued_at)`. Simpler than JWT, no library dependency. 90-day expiry enforced by checking `issued_at`.
- **Cross-phase impact (3B, 3E):** Integration specs (3B) must document token format in API auth section. Security (3E) must include HMAC secret rotation procedure and define what happens when `DOCALIGN_API_SECRET` rotates (all existing tokens invalidated -- require all clients to regenerate).
- **Date:** 2026-02-11

### 3D-005: Webhook secret dual-secret rotation window
- **Context:** Rotating `GITHUB_WEBHOOK_SECRET` must not cause webhook verification failures.
- **Decision:** During rotation, accept both `GITHUB_WEBHOOK_SECRET` (new) and `GITHUB_WEBHOOK_SECRET_OLD` (previous). Window is < 5 minutes. Old secret env var is removed on next deploy.
- **Cross-phase impact (3E):** Security doc must reference this dual-secret mechanism in the rotation procedures section.
- **Date:** 2026-02-11

### 3D-006: Queue depth definition for healthcheck
- **Context:** Audit finding I13 asked for an exact definition of `queue_depth`.
- **Decision:** `queue_depth` = total jobs in `waiting` + `active` states across all per-repo queues. Health endpoint also returns `active_jobs` and `waiting_jobs` separately.
- **Cross-phase impact (3B):** Integration specs should include the health endpoint response schema.
- **Date:** 2026-02-11

### 3C-001: Co-change boost denormalized into claim_mappings (A4 resolution)
- **Context:** Audit finding A4 identified a purge race: the weekly co_changes purge could delete records referenced by active mapping confidence boosts.
- **Decision:** The co-change boost is baked into `claim_mappings.confidence` at mapping creation time. A new `co_change_boost` column (REAL, default 0.0) is added for auditability. The `co_changes` table is no longer queried in real-time during scans -- only at mapping creation/refresh. Purge job needs no reference checking.
- **Cross-phase impact (3A, 3B):** Schema change: `claim_mappings` gains `co_change_boost` column. Integration specs (3B) should document that mapping refresh recalculates the boost from whatever co_changes records exist at that time.
- **Date:** 2026-02-11

### 3C-002: Circuit breaker parameters for external dependencies
- **Context:** Need to define failure thresholds before external dependencies cascade into full outages.
- **Decision:** Circuit breaker thresholds: GitHub API (5 failures/60s, 120s reset), PostgreSQL (3 failures/30s, 60s reset), Redis (3 failures/30s, 30s reset). When PostgreSQL circuit is OPEN, the worker pauses entirely. When Redis circuit is OPEN, the API server buffers up to 100 webhooks in memory.
- **Cross-phase impact (3D):** Infrastructure/monitoring alert thresholds should align with circuit breaker parameters. Dashboard should surface circuit breaker state.
- **Date:** 2026-02-11

### 3C-003: Error code schema (DOCALIGN_EXXX)
- **Context:** Need machine-parseable error codes across all components.
- **Decision:** All errors use structured codes: E1xx=GitHub, E2xx=Agent, E3xx=Database, E4xx=Internal, E5xx=Config, E6xx=Redis. Every API error response includes the error code in a JSON `error` field.
- **Cross-phase impact (3B, 3D, 3E):** 3B API responses must include these codes. 3D monitoring must parse these codes for alerting. 3E security events use E105 for webhook signature failures.
- **Date:** 2026-02-11

### 3C-004: Agent result validation -- retry once, then uncertain
- **Context:** Need canonical handling for malformed agent results.
- **Decision:** When an agent submits an unparseable or schema-invalid result, the server returns HTTP 400 with error details. The Action retries once. On second failure, the task is marked failed and the claim is marked uncertain with a specific reason code.
- **Cross-phase impact (3B):** Agent Task API response contract must return Zod validation errors in HTTP 400 body.
- **Date:** 2026-02-11

### 3C-005: Drifted verdict with no evidence downgraded to uncertain
- **Context:** Prevent false-positive drift findings that have no backing evidence from reaching users.
- **Decision:** If an agent returns `verdict: 'drifted'` with `evidence_files: []`, the server downgrades to `uncertain` with reason "Drift reported but no supporting evidence provided." Verified with no evidence is accepted but confidence reduced by 0.3.
- **Cross-phase impact (3B):** Result validation logic in integration specs.
- **Date:** 2026-02-11

### 3C-006: scan_runs gains comment_posted column
- **Context:** Prevent duplicate PR comments on job retries or webhook redeliveries.
- **Decision:** `scan_runs` gains a `comment_posted BOOLEAN DEFAULT false` column. Before posting a PR comment, the server checks this flag. After posting, it sets the flag to `true` in the same transaction. A secondary check (hidden HTML marker in existing PR comments) provides defense-in-depth.
- **Cross-phase impact (3A):** Schema update. Future TDD for L5 reporter must implement this check.
- **Date:** 2026-02-11

### 3E-001: DOCALIGN_TOKEN format refined (supersedes 3D-004)
- **Context:** 3D-004 specified HMAC-based token format. Phase 3E requires more detail: format validation, checksum, repo-scoped hash, and hash-only storage.
- **Decision:** Token format is `docalign_v1_<repo_hash>_<random>_<checksum>` where `repo_hash` = first 8 chars of SHA-256(repo_uuid), `random` = 16 bytes base62, `checksum` = first 4 chars of SHA-256(prefix+hash+random). Server stores ONLY SHA-256(full_token) in `repos.token_hash` column. The HMAC construction from 3D-004 is replaced by this format, which achieves the same goals (per-repo scope, format validation) without coupling to `DOCALIGN_API_SECRET` (so secret rotation does not invalidate all tokens).
- **Cross-phase impact (3B):** Agent Task API contract must document this token format and the HTTP 401 error when validation fails. (3D): Infrastructure must generate token during onboarding and add `token_hash` column to `repos` table.
- **Date:** 2026-02-11

### 3E-002: Row-level security via SET LOCAL per request
- **Context:** Audit finding S12 requires PostgreSQL RLS as defense-in-depth against cross-tenant data leaks.
- **Decision:** All tenant-scoped tables (claims, code_entities, claim_mappings, verification_results, feedback, co_changes, agent_tasks, scan_runs, suppression_rules) get RLS policies scoped by `repo_id`. Application sets `app.current_repo_id` via `SET LOCAL` at the start of each request/job transaction. Migrations use a separate superuser role that bypasses RLS.
- **Cross-phase impact (3D):** Must create two PostgreSQL roles: `docalign_app` (RLS enforced) and `docalign_migration` (superuser for schema changes). (3B): All database access patterns must set the session variable before queries.
- **Date:** 2026-02-11

### 3E-003: Webhook replay protection via delivery ID dedup
- **Context:** Audit finding S1 requires replay protection. GitHub does not provide a standard timestamp header.
- **Decision:** Store `X-GitHub-Delivery` header values in Redis with 5-minute TTL. Reject duplicate delivery IDs. This provides both idempotency and replay protection. Complements 3D-005 dual-secret rotation.
- **Cross-phase impact (3D):** Redis must have sufficient memory for delivery ID storage (~100 bytes per webhook, expiring in 5 min). (3B): Webhook handler must check delivery ID before enqueuing jobs.
- **Date:** 2026-02-11

### 3E-004: PR comment output sanitization required
- **Context:** Audit finding S9 requires sanitization of all user-controlled strings in PR comments.
- **Decision:** All strings from agent results and claim data (claim_text, reasoning, specific_mismatch, suggested_fix) must pass through `sanitizeForMarkdown()` or `sanitizeForCodeBlock()` before inclusion in PR comments. Functions escape markdown special chars, strip HTML, block `javascript:` and `data:` URLs, enforce length limits.
- **Cross-phase impact (3B):** L5 Reporter integration spec must call sanitization functions. (3C): Error messages displayed in PR comments must also be sanitized.
- **Date:** 2026-02-11

### 3E-005: Agent result Zod schema field limits
- **Context:** Need concrete max-length limits for all string fields in agent results to prevent abuse.
- **Decision:** reasoning: 2000 chars, evidence_files: 20 items x 512 chars, suggested_fix: 5000 chars, specific_mismatch: 2000 chars, rule_fixes: 5 items. Exceeding returns HTTP 400.
- **Cross-phase impact (3B):** Agent Task API contract must document these limits.
- **Date:** 2026-02-11

### 3E-006: Clone authentication via GIT_ASKPASS
- **Context:** Audit finding S2 requires that installation tokens never appear in clone URLs.
- **Decision:** Use `GIT_ASKPASS` environment variable with a temporary script (mode 0700, deleted after use) instead of embedding tokens in URLs. `GIT_TERMINAL_PROMPT=0` prevents interactive prompts.
- **Cross-phase impact (3D):** Deployment must ensure temp directory is writable. (3B): Clone operation spec must reference this pattern.
- **Date:** 2026-02-11

### 3B-D1: Entity Line Count -- Computed via JOIN, Not Stored
- **Context:** Audit finding A14 requires `entity_line_count` for Path 1/Path 2 routing. Options: store in `claim_mappings` or compute via JOIN.
- **Decision:** Compute on the fly via `LEFT JOIN code_entities` during the routing query. NOT stored as a denormalized column in `claim_mappings`.
- **Rationale:** Entity line counts change when code is updated. Storing creates stale denormalization. The JOIN is cheap (indexed on `code_entity_id`) and always returns fresh data.
- **Cross-phase impact (3C, TDD-2, TDD-3):** Error handling for NULL entity case (entity deleted between mapping and routing). Mapper and verifier TDDs must use the JOIN pattern.
- **Date:** 2026-02-11

### 3B-D2: Agent Task Claiming via GET (Not Separate Claim Endpoint)
- **Context:** Need to define how the Action claims tasks. Options: separate POST /claim endpoint, or atomic claim during GET /tasks/{id}.
- **Decision:** Task claiming is performed atomically during `GET /api/tasks/{id}`. The GET both returns task details AND sets `claimed_by` + `status = 'in_progress'` using `UPDATE ... WHERE claimed_by IS NULL RETURNING *`.
- **Rationale:** Eliminates a round-trip. Two API calls per task (list + claim/read) instead of three (list + claim + read).
- **Cross-phase impact (TDD-infra, TDD-4):** API server route handler must execute UPDATE in the GET handler. Action implementation uses two-step flow.
- **Date:** 2026-02-11

### 3B-D3: Dependency Version Returns Source Metadata
- **Context:** Audit finding A15 requires specifying getDependencyVersion() return format. Lock file versions vs manifest specifiers require different comparison logic.
- **Decision:** `getDependencyVersion()` returns `{ version: string; source: 'lockfile' | 'manifest' } | null`. Source metadata enables correct comparison logic in Tier 1.
- **Cross-phase impact (TDD-0, TDD-3):** L0 interface change. Tier 1 verifier uses source to choose exact vs range comparison.
- **Date:** 2026-02-11

### 3B-D4: MCP Server Uses Single Connection (Not Pooled)
- **Context:** Audit finding A16 requires specifying MCP server database connection. MCP is a single-user local process.
- **Decision:** Single PostgreSQL connection (not pooled). Read-only by default (`SET default_transaction_read_only = ON`). Separate writable connection for `report_drift` (v3).
- **Cross-phase impact (3D):** Does not affect server connection pooling strategy. TDD-6 (MCP) uses different connection config than server.
- **Date:** 2026-02-11

### 3B-D5: DOCALIGN_TOKEN Format Alignment with 3E-001
- **Context:** 3D-004 originally specified HMAC-SHA256 token format. 3E-001 refined it to `docalign_v1_<repo_hash>_<random>_<checksum>`. Integration specs (3B) must align.
- **Decision:** Adopted 3E-001's token format. Section 2.1 of phase3-integration-specs.md shows the token validation pattern that extracts repo_id from the `repo_hash` prefix and verifies via SHA-256 hash comparison against `repos.token_hash`.
- **Cross-phase impact:** None beyond existing 3E-001 impacts.
- **Date:** 2026-02-11

### XREF-001: Simplified DOCALIGN_TOKEN format (supersedes 3D-004, 3E-001)
- **Context:** Cross-reference review found 3 different token formats across docs (JWT in 3B, HMAC in 3D, custom format in 3E). Product direction: open-source distribution with hygienic security only.
- **Decision:** Token = `"docalign_" + crypto.randomBytes(32).toString('hex')`. Server stores SHA-256(token) in `repos.token_hash`. No DOCALIGN_API_SECRET dependency. No JWT. No checksums. 1-year default expiry (configurable). DOCALIGN_API_SECRET is retained for HMAC dismiss tokens and webhook secret rotation only.
- **Cross-phase impact:** All docs (3A, 3B, 3C, 3D, 3E) updated to use this format.
- **Date:** 2026-02-11

### XREF-002: Hygienic security posture for MVP
- **Context:** Distribution model is open-source + premium. Security should be basic hygiene, tightened on demand.
- **Decision:** MVP keeps: webhook HMAC verification, DOCALIGN_TOKEN auth, parameterized SQL, Zod validation, PR comment sanitization, TLS, core.setSecret(), hash-only token storage, pino structured logging. Deferred to post-MVP: RLS, circuit breaker, webhook replay protection (Redis dedup), ReDoS regex wrappers, prompt injection XML escaping, feedback abuse prevention, supply chain analysis, dual-secret rotation, installation token encryption, per-IP rate limiting, GIT_ASKPASS for clones.
- **Cross-phase impact (3E):** Security doc retains all analysis but marks deferred items explicitly. Pre-launch checklist reduced from 17 to ~6 items.
- **Date:** 2026-02-11

### XREF-003: Hard-coded values become configurable with sensible defaults
- **Context:** Product direction: defaults must not irritate users or require too many actions.
- **Decision:** All hard-coded operational parameters become configurable via environment variables or `.docalign.yml`. Key defaults changed: token expiry from 90 days to 1 year, retry counts configurable via env vars. Only mandatory config: LLM API key.
- **Cross-phase impact (3B, 3C, 3D):** Each hard-coded value annotated with its config key and default.
- **Date:** 2026-02-11

### XREF-004: Installation token caching is in-memory only
- **Context:** 3B said in-memory, 3D and 3E said Redis. For single-process MVP, in-memory is simpler and sufficient.
- **Decision:** Installation access tokens cached in `Map<installationId, CachedToken>` in process memory. NOT stored in Redis or database. Tokens are re-fetchable from GitHub on restart.
- **Cross-phase impact (3D, 3E):** Infrastructure and security docs updated.
- **Date:** 2026-02-11

### XREF-005: Subscribe to pull_request_review webhook
- **Context:** 3E said NOT subscribed, but 3B Section 1.1.5 defines a handler for fix acceptance detection.
- **Decision:** Subscribe to `pull_request_review` (submitted). Needed for fast fix acceptance detection per 3B.
- **Cross-phase impact (3E):** Security doc updated to include in subscription list.
- **Date:** 2026-02-11

### XREF-006: Standardized retry policy (2x backoff)
- **Context:** 3B used 4x multiplier, 3C used 2^n, 3D had clearest phrasing. Inconsistent across docs.
- **Decision:** Backoff formula: `min(base_ms * 2^attempt, max_delay_ms) + random(0, jitter_ms)`. Per-call: 2 total attempts (1 original + 1 retry), delays ~1s, ~2s. Per-job: 3 total attempts (1 original + 2 retries), delays ~1s, ~2s, ~4s. All configurable via env vars.
- **Cross-phase impact (3B, 3C):** Retry code updated to use 2x multiplier.
- **Date:** 2026-02-11

### XREF-007: Zod schema limits standardized (permissive defaults)
- **Context:** 3B had permissive limits (reasoning: 5000, evidence_files: 50), 3E had strict limits (reasoning: 2000, evidence_files: 20).
- **Decision:** Use permissive limits as defaults: reasoning max 5000, evidence_files max 50 items (512 chars each), specific_mismatch max 2000, suggested_fix max 5000, rule_fixes max 5 items.
- **Cross-phase impact (3E):** Security doc Zod schemas updated to match.
- **Date:** 2026-02-11

### REVIEW-001: Agent task creation timing clarified
- **Context:** 10-agent review found ambiguity: when exactly are agent tasks created relative to routing?
- **Decision:** Tasks created AFTER L0 index update and AFTER routing decision. Routing uses updated L0 index for entity mappings, line counts, token estimates. Tasks batch-inserted, then single repository dispatch sent with all task_ids.
- **Cross-phase impact (3A):** Section 7 step 5e updated with timing detail. (3B): Task creation SQL in Section 2.3 unchanged (already correct).
- **Date:** 2026-02-11

### REVIEW-002: Cancellation mechanism specified
- **Context:** 10-agent review found ambiguity: how does the worker know a job is cancelled?
- **Decision:** Redis key `cancel:{job_id}` with 10-minute TTL. Set by webhook handler when a new push replaces an active job. Worker checks at 4 stage boundaries. On detection: status='cancelled', save completed work, return with `{ cancelled: true }` (not a failure).
- **Cross-phase impact (3A):** Section 6.1 updated with concrete mechanism.
- **Date:** 2026-02-11

### REVIEW-003: Path 1 token cap enforced server-side
- **Context:** 10-agent review found ambiguity: who enforces the path1_max_evidence_tokens check?
- **Decision:** Enforced SERVER-SIDE during routing (before task creation). Server estimates token count from code_entities line counts + import line counts in L0 index. Overflow routes to Path 2. Action never makes this decision.
- **Cross-phase impact (3A):** Section 11.5 updated. (3B): No change needed (task payloads already reflect the routing decision).
- **Date:** 2026-02-11

### REVIEW-004: Webhook replay protection uses delivery ID dedup, NOT timestamp parsing
- **Context:** 10-agent review found conflict: 3B said "parse created_at timestamp", 3E said "Redis delivery ID TTL". These are incompatible mechanisms.
- **Decision:** Use 3E's approach: store X-GitHub-Delivery in Redis with 5min TTL. GitHub has no standard timestamp header. 3B's timestamp parsing reference was incorrect.
- **Cross-phase impact (3B):** Line 61 updated to reference delivery ID dedup. (3E): Already correct.
- **Date:** 2026-02-11

### REVIEW-005: Error taxonomy compressed (42 → 8 categories)
- **Context:** All 10 reviewers flagged 42 error codes as overkill for solo-founder MVP.
- **Decision:** Collapse to 8 category-level entries (GITHUB, AGENT, DATABASE, INTERNAL, CONFIG, QUEUE). Individual sub-codes (E101, E102, etc.) preserved in playbooks and logs but not in the taxonomy table. Summary table (Section 9) replaced with brief reference note.
- **Cross-phase impact (3C):** Sections 2 and 9 rewritten. Playbooks and all other sections unchanged.
- **Date:** 2026-02-11

### REVIEW-006: Security doc trimmed to match "hygienic only" directive
- **Context:** Reviewers flagged OWASP Top 10 assessment and Feedback Abuse Prevention as scope creep vs the "hygienic-only" directive (XREF-002).
- **Decision:** OWASP section compressed from ~120 lines to ~15 lines (reference checklist, not implementation). Feedback Abuse section compressed from ~50 lines to ~10 lines (entirely deferred, summary of built-in safety valves). Action versioning guidance reconciled with 3D (default @v1, SHA pinning as opt-in).
- **Cross-phase impact (3E):** Sections 7, 9 compressed. Section 8.2 updated for versioning consistency.
- **Date:** 2026-02-11

### REVIEW-007: co_change_boost and comment_posted columns added to 3A schema
- **Context:** 10-agent review found that 3A schema diagram was missing columns defined in decisions 3C-001 and 3C-006.
- **Decision:** 3A Section 5.1 schema updated to show `co_change_boost` on claim_mappings and `comment_posted` on scan_runs.
- **Cross-phase impact:** Schema is now consistent across all docs.
- **Date:** 2026-02-11

### REVIEW-008: Connection pool phrasing fixed
- **Context:** 3A said "Add connection pooling" at 5-10 customers, but 3D already configures a Node.js pool (max: 10). The real milestone is upgrading to Supabase Supavisor pooling.
- **Decision:** 3A Section 10.2 phrasing changed to "Increase pool size to 20 and add Supabase connection pooling via Supavisor."
- **Cross-phase impact:** 3D already correct.
- **Date:** 2026-02-11
