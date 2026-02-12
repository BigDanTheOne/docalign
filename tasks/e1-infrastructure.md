# Epic E1: Infrastructure Foundation

## Task E1-01: Project Scaffold + Vitest + Pino Logger
- **Files:** `docalign/package.json`, `docalign/tsconfig.json`, `docalign/vitest.config.ts`, `docalign/src/app.ts`, `docalign/src/shared/logger.ts`, `docalign/src/shared/types.ts`, `docalign/src/config/defaults.ts`
- **Implements:** TDD-Infra §6.6 (Pino logging), §3 (ServerConfig)
- **Types used:** `ServerConfig`, `DocAlignError`, `DocAlignConfig`
- **Tests:** `docalign/test/shared/logger.test.ts` -- logger creates child loggers, redacts sensitive fields; `docalign/test/config/defaults.test.ts` -- env parsing, missing required vars exits with code 1, optional vars use defaults
- **Done when:** `npm run build` compiles without errors; `npx vitest run` executes; logger outputs structured JSON to stdout; Zod env validation rejects missing `DATABASE_URL` and accepts valid config
- **Estimated effort:** 2 hours

## Task E1-02: StorageAdapter Interface + PostgreSQL Connection Pool
- **Files:** `docalign/src/shared/storage-adapter.ts`, `docalign/src/shared/db.ts`, `docalign/src/shared/pg-adapter.ts`
- **Implements:** TDD-Infra §3 (DatabaseClient), GATE42-014 (StorageAdapter)
- **Types used:** `RepoRow`, `AgentTaskRow`, `ScanRunRow`, `RepoStatus`, `AgentTaskStatus`, `ScanStatus`, `AgentTaskType`, `TriggerType`
- **Tests:** `docalign/test/shared/pg-adapter.test.ts` -- CRUD operations for repos, agent_tasks, scan_runs tables; transaction rollback on error; connection pool lifecycle (connect/end)
- **Done when:** `StorageAdapter` TypeScript interface is defined with methods for repos, agent_tasks, and scan_runs CRUD; `PostgresAdapter` implements the interface; `pg-adapter.test.ts` passes against a test PostgreSQL database with all CRUD methods verified (insert, select, update, delete)
- **Estimated effort:** 3 hours

## Task E1-03: Database Migrations (Infrastructure Tables)
- **Files:** `docalign/migrations/0001_enable_pgcrypto.ts`, `docalign/migrations/0002_create_repos.ts`, `docalign/migrations/0003_create_scan_runs.ts`, `docalign/migrations/0008_create_agent_tasks.ts`, `docalign/migrations/template.ts`
- **Implements:** TDD-Infra Appendix A (§A.1 repos, §A.2 scan_runs, §A.7 agent_tasks), Appendix F (migration ordering)
- **Types used:** `RepoRow`, `ScanRunRow`, `AgentTaskRow`, `RepoStatus`, `ScanStatus`, `AgentTaskStatus`, `AgentTaskType`, `TriggerType`
- **Tests:** `docalign/test/migrations/infra-tables.test.ts` -- migrations run up successfully; tables exist with correct columns, constraints, and indexes; migrations run down without error
- **Done when:** `npm run migrate:up` creates `repos`, `scan_runs`, and `agent_tasks` tables with all columns, constraints, CHECK constraints, indexes, and foreign keys matching Appendix A; `npm run migrate:down` rolls back cleanly; migration test passes
- **Estimated effort:** 3 hours

## Task E1-04: Express Server + Middleware + Health Endpoint
- **Files:** `docalign/src/app.ts`, `docalign/src/routes/health.ts`, `docalign/src/middleware/error-handler.ts`
- **Implements:** TDD-Infra §4.8 (healthCheck), §6.1 (Express.js), Appendix B (§B.2 middleware stack)
- **Types used:** `HealthResponse`
- **Tests:** `docalign/test/routes/health.test.ts` -- healthy system returns 200 with `{ status: "ok", redis: true, ... }`; Redis down returns 503 with `{ status: "degraded", redis: false, ... }`; uptime_seconds increases over time; `docalign/test/middleware/error-handler.test.ts` -- DocAlignError maps to correct HTTP status and response shape; unknown errors return 500
- **Done when:** `GET /health` returns `HealthResponse` with HTTP 200 when Redis is up and HTTP 503 when Redis is down; `helmet()` sets security headers; `pino-http` logs all requests; error middleware maps `DocAlignError` to `APIErrorResponse`; trust proxy is enabled; all tests pass
- **Estimated effort:** 3 hours

## Task E1-05: Redis Connection + BullMQ Queue Setup
- **Files:** `docalign/src/shared/redis.ts`, `docalign/src/shared/queue.ts`
- **Implements:** TDD-Infra §6.3 (BullMQ), §2.1 (ioredis, bullmq)
- **Types used:** `ScanType` (used in job payload typing)
- **Tests:** `docalign/test/shared/queue.test.ts` -- BullMQ queue `docalign:scan` enqueues a job; job is retrievable; `getJobCounts()` returns correct waiting/active counts; queue graceful close completes within 30s
- **Done when:** Redis connects via `REDIS_URL`; BullMQ `Queue` named `docalign:scan` is created; test job enqueues and is retrievable; `queue.getJobCounts()` works (used by health endpoint); all queue tests pass
- **Estimated effort:** 2 hours

## Task E1-06: SIGTERM Graceful Shutdown
- **Files:** `docalign/src/app.ts` (modify), `docalign/src/shutdown.ts`
- **Implements:** TDD-Infra Appendix C (§C.2 graceful shutdown)
- **Types used:** None (infrastructure-only)
- **Tests:** `docalign/test/shutdown.test.ts` -- SIGTERM stops accepting new HTTP requests; in-progress BullMQ jobs complete before exit; Redis and DB connections close; process exits with code 0
- **Done when:** On SIGTERM: (1) `server.close()` stops new requests, (2) BullMQ worker close waits up to 30s, (3) Redis disconnects, (4) PostgreSQL pool ends, (5) process exits 0; shutdown test passes
- **Estimated effort:** 2 hours

## Task E1-07: Webhook Endpoint + Signature Verification
- **Files:** `docalign/src/routes/webhook.ts`, `docalign/src/layers/L4-triggers/webhook-verify.ts`
- **Implements:** TDD-Infra §4.1 (handleWebhook steps 1-3), §6.4 (webhook signature verification), Appendix B (§B.1 POST /webhook route), Appendix E
- **Types used:** `PRWebhookPayload`, `PushWebhookPayload`, `InstallationCreatedPayload`
- **Tests:** `docalign/test/routes/webhook.test.ts` -- valid signature returns 200; invalid signature returns 401 with DOCALIGN_E105 logged; missing headers return 401; dual-secret rotation accepts old secret; wrong content-type returns 415; unrecognized event returns 200 with `{ received: true }`
- **Done when:** `POST /webhook` uses `express.raw({ type: 'application/json', limit: '25mb' })` for raw body; HMAC-SHA256 verification uses `timingSafeEqual`; dual-secret rotation works; all negative cases (missing headers, bad signature, bad content-type) tested; all webhook signature tests pass
- **Estimated effort:** 3 hours

## Task E1-08: Webhook Event Routing + Installation Handlers
- **Files:** `docalign/src/routes/webhook.ts` (modify), `docalign/src/layers/L4-triggers/pr-webhook.ts` (stub), `docalign/src/layers/L4-triggers/push-webhook.ts` (stub)
- **Implements:** TDD-Infra §4.1 (handleWebhook steps 4-8), Appendix E (event subscriptions)
- **Types used:** `PRWebhookPayload`, `PushWebhookPayload`, `InstallationCreatedPayload`, `RepoRow`, `RepoStatus`
- **Tests:** `docalign/test/routes/webhook-routing.test.ts` -- `pull_request.opened` routes to PR handler stub; `push` to default branch routes to push handler stub; `push` to non-default branch returns 200 with no processing; `installation.created` creates repo records in DB; `installation.deleted` removes repo records; `pull_request.closed` returns 200 with no scan; `issue_comment.created` with `@docalign review` logs and acknowledges
- **Done when:** All 7 event types from Appendix E route correctly; `installation.created` inserts repos via `StorageAdapter`; stubs for PR/push handlers log and return; event routing test passes
- **Estimated effort:** 3 hours

## Task E1-09: GitHub App Auth (JWT + Installation Tokens + Cache)
- **Files:** `docalign/src/shared/github-auth.ts`
- **Implements:** TDD-Infra §4.2 (getInstallationToken), §6.4 (GitHub App authentication)
- **Types used:** `CachedInstallationToken` (layer-internal type from TDD-Infra §3)
- **Tests:** `docalign/test/shared/github-auth.test.ts` -- JWT generated with correct `iss`, `iat` (now-60s), `exp` (now+10min), RS256 algorithm; installation token fetched and cached; cache hit returns same token without API call; cache miss when token <5min from expiry triggers refresh; invalid private key throws DOCALIGN_E103
- **Done when:** `getInstallationToken(installationId)` generates JWT, exchanges for installation token, caches with TTL; cache returns existing token when >5min from expiry; retry once on 401; all auth tests pass (GitHub API mocked with nock or msw)
- **Estimated effort:** 3 hours

## Task E1-10: DOCALIGN_TOKEN Generation + Validation + Auth Middleware
- **Files:** `docalign/src/shared/token.ts`, `docalign/src/middleware/auth.ts`
- **Implements:** TDD-Infra §4.7 (validateToken), §4.9 (generateRepoToken), Appendix B (§B.3 auth middleware)
- **Types used:** `TokenValidation`
- **Tests:** `docalign/test/shared/token.test.ts` -- generated token is exactly 73 chars with `docalign_` prefix; SHA-256 hash is deterministic; `validateToken` returns true for valid token+repoId pair; returns false for wrong repoId; returns false for malformed token (wrong prefix, wrong length); `docalign/test/middleware/auth.test.ts` -- valid Bearer token passes; missing Authorization header returns 401; invalid token returns 401; missing repo_id returns 400; repo_id mismatch returns 403
- **Done when:** `generateRepoToken()` returns `{ token, hash }` with 73-char token; `validateToken(token, repoId)` queries `repos.token_hash`; auth middleware extracts Bearer token, validates, attaches `req.repoId`; all token and auth middleware tests pass
- **Estimated effort:** 2 hours

## Task E1-11: Agent Task API Endpoints (Pending + Claim + Submit)
- **Files:** `docalign/src/routes/tasks.ts`
- **Implements:** TDD-Infra §4.3 (createAgentTasks), §4.4 (getPendingTasks), §4.5 (claimTask), §4.6 (submitTaskResult), Appendix B (§B.1 route table: GET /api/tasks/pending, GET /api/tasks/:id, POST /api/tasks/:id/result)
- **Types used:** `AgentTask`, `AgentTaskType`, `AgentTaskStatus`, `AgentTaskPayload`, `AgentTaskResult`, `AgentTaskResultData`, `TaskResultMetadata`, `TaskListResponse`, `TaskDetailResponse`, `TaskResultResponse`, `APIErrorResponse`
- **Tests:** `docalign/test/routes/tasks.test.ts` -- `GET /api/tasks/pending` returns pending tasks filtered by repo_id; `GET /api/tasks/:id` claims task atomically (sets status=in_progress, claimed_by, extends expires_at); concurrent claims result in one 200 and one 409; expired task returns 410; `POST /api/tasks/:id/result` accepts valid result, updates status to completed; Zod validation rejects invalid verdict/confidence; double submission returns 409; all endpoints require DOCALIGN_TOKEN auth
- **Done when:** All three Agent Task API endpoints work end-to-end with DOCALIGN_TOKEN auth; atomic claim via `UPDATE ... WHERE claimed_by IS NULL` prevents double-claim; Zod validates `AgentTaskResult`; all task endpoint tests pass
- **Estimated effort:** 4 hours

## Task E1-12: Dismiss Endpoint
- **Files:** `docalign/src/routes/dismiss.ts`
- **Implements:** TDD-Infra §4.10 (handleDismiss), Appendix B (§B.1 GET /api/dismiss)
- **Types used:** `FeedbackType` (for `all_dismissed` enum value), `APIErrorResponse`
- **Tests:** `docalign/test/routes/dismiss.test.ts` -- valid HMAC token + valid params redirects (302) to correct GitHub PR URL; invalid HMAC returns 400; expired token (>7 days) returns 400; missing repo returns 404; feedback record created in DB with `feedback_type: 'all_dismissed'`
- **Done when:** `GET /api/dismiss?token=...&claim_id=...&scan_run_id=...&repo_id=...&pr_number=...` validates HMAC dismiss token, creates feedback record, returns 302 redirect to `https://github.com/{owner}/{repo}/pull/{pr_number}`; all dismiss tests pass
- **Estimated effort:** 2 hours

## Task E1-13: Railway Deployment Config + Docker Compose (Local Dev)
- **Files:** `docalign/railway.toml`, `docalign/Procfile`, `docalign/docker-compose.yml`, `docalign/.env.example`
- **Implements:** TDD-Infra Appendix C (railway.toml configuration), Appendix D (environment variables), Appendix H (local development Docker Compose)
- **Types used:** None (configuration only)
- **Tests:** `docalign/test/deployment/config.test.ts` -- validates that all required env vars from Appendix D are present in `.env.example`; `railway.toml` matches expected build/deploy commands
- **Done when:** `railway.toml` has `buildCommand = "npm run build && npm run migrate:up"` and `startCommand = "node dist/app.js"` with healthcheck at `/health`; `docker-compose.yml` runs `pgvector/pgvector:pg16` on 5432 and `redis:7-alpine` on 6379 with healthchecks; `.env.example` lists all env vars from Appendix D; config validation test passes
- **Estimated effort:** 2 hours

## Task E1-14: Integration Tests (End-to-End Endpoint Sweep)
- **Files:** `docalign/test/integration/e1-endpoints.test.ts`
- **Implements:** TDD-Infra §5 (performance targets as soft assertions), Appendix B (all routes)
- **Types used:** `HealthResponse`, `TaskListResponse`, `TaskDetailResponse`, `TaskResultResponse`, `APIErrorResponse`, `PRWebhookPayload`, `InstallationCreatedPayload`
- **Tests:** `docalign/test/integration/e1-endpoints.test.ts` -- full server boot with test DB and Redis; health endpoint returns 200; webhook with valid signature returns 200; webhook with invalid signature returns 401; create repo via installation webhook; generate DOCALIGN_TOKEN for repo; `GET /api/tasks/pending` with auth; create task, claim via `GET /api/tasks/:id`, submit result via `POST /api/tasks/:id/result`; dismiss with valid HMAC; graceful shutdown completes
- **Done when:** Integration test boots a real Express server against test PostgreSQL + Redis; all route combinations tested in sequence (happy path + key error paths); test completes in <30 seconds; all assertions pass
- **Estimated effort:** 3 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E1-01 | Project Scaffold + Vitest + Pino Logger | 2 |
| E1-02 | StorageAdapter Interface + PostgreSQL Connection Pool | 3 |
| E1-03 | Database Migrations (Infrastructure Tables) | 3 |
| E1-04 | Express Server + Middleware + Health Endpoint | 3 |
| E1-05 | Redis Connection + BullMQ Queue Setup | 2 |
| E1-06 | SIGTERM Graceful Shutdown | 2 |
| E1-07 | Webhook Endpoint + Signature Verification | 3 |
| E1-08 | Webhook Event Routing + Installation Handlers | 3 |
| E1-09 | GitHub App Auth (JWT + Installation Tokens + Cache) | 3 |
| E1-10 | DOCALIGN_TOKEN Generation + Validation + Auth Middleware | 2 |
| E1-11 | Agent Task API Endpoints (Pending + Claim + Submit) | 4 |
| E1-12 | Dismiss Endpoint | 2 |
| E1-13 | Railway Deployment Config + Docker Compose (Local Dev) | 2 |
| E1-14 | Integration Tests (End-to-End Endpoint Sweep) | 3 |
| **Total** | | **37 hours** |

## Task Dependency Order
- E1-01 is the starting point (no dependencies)
- E1-02 depends on E1-01 (needs types, logger)
- E1-03 depends on E1-02 (needs pg connection for migration runner)
- E1-04 depends on E1-01, E1-05 (health endpoint checks Redis)
- E1-05 depends on E1-01
- E1-06 depends on E1-04, E1-05 (shuts down server, queue, connections)
- E1-07 depends on E1-04 (needs Express server with routes)
- E1-08 depends on E1-07, E1-02 (needs webhook route + StorageAdapter for repo CRUD)
- E1-09 depends on E1-01 (standalone, needs only config)
- E1-10 depends on E1-02 (needs StorageAdapter for token hash lookup)
- E1-11 depends on E1-04, E1-10, E1-02 (needs server, auth middleware, StorageAdapter)
- E1-12 depends on E1-04, E1-02 (needs server, StorageAdapter for feedback + repo lookup)
- E1-13 depends on E1-04 (needs working server to validate config)
- E1-14 depends on all prior tasks (end-to-end validation)

## Story-to-Task Mapping
- **S1.1** (Server Foundation + Storage Layer): E1-01, E1-02, E1-03, E1-04, E1-05, E1-06
- **S1.2** (GitHub App Integration): E1-07, E1-08, E1-09, E1-10
- **S1.3** (API Endpoints + Deployment): E1-11, E1-12, E1-13, E1-14
