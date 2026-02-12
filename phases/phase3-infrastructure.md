# Phase 3D: Infrastructure & DevOps

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 3: Architecture Design Document
>
> **Inputs:** Phase 3A (System Architecture), PRD infrastructure-deployment, L4-change-scanning, Phase 2.5 Audit Findings (I4, I6, I8-I14), technical-reference
>
> **Date:** 2026-02-11

---

## 1. Infrastructure Topology

### 1.1 Topology Diagram

```
                        ┌──────────────────────────────────────────────┐
                        │               INTERNET                        │
                        └──────────┬───────────────────────────────────┘
                                   │
                          HTTPS (TLS 1.2+)
                                   │
                        ┌──────────▼───────────────────────────────────┐
                        │          Railway (us-west)                     │
                        │                                               │
                        │  ┌─────────────────────────────────────────┐  │
                        │  │  docalign-server (single service, MVP)   │  │
                        │  │                                          │  │
                        │  │  ┌────────────┐   ┌──────────────────┐  │  │
                        │  │  │ API Server │   │ Worker (BullMQ)  │  │  │
                        │  │  │ (Express)  │   │ (same process)   │  │  │
                        │  │  │ :8080      │   │                  │  │  │
                        │  │  └─────┬──────┘   └────────┬─────────┘  │  │
                        │  │        │                    │            │  │
                        │  │        └────────┬───────────┘            │  │
                        │  │                 │                        │  │
                        │  └─────────────────┼────────────────────────┘  │
                        │                    │                           │
                        │  ┌─────────────────▼────────────────────────┐  │
                        │  │  Railway Redis Addon                      │  │
                        │  │  (BullMQ queues, rate limit counters,     │  │
                        │  │   installation token cache)               │  │
                        │  └───────────────────────────────────────────┘  │
                        │                                               │
                        └───────────────────────────────────────────────┘
                                   │
                          External network
                         ┌─────────┴──────────┐
                         │                    │
              ┌──────────▼─────────┐   ┌──────▼───────────────────┐
              │  Supabase          │   │  GitHub                   │
              │  (us-east-1)       │   │                           │
              │                    │   │  - Webhooks → DocAlign    │
              │  PostgreSQL 15+    │   │  - REST/GraphQL API       │
              │  + pgvector        │   │  - GitHub Actions runners │
              │  + node-pg-migrate │   │  - Marketplace            │
              │                    │   │                           │
              └────────────────────┘   └───────────────────────────┘
```

### 1.2 Service Inventory

| Service | Provider | Purpose | MVP Tier/Plan | Estimated Monthly Cost |
|---------|----------|---------|---------------|----------------------|
| **docalign-server** | Railway | API + Worker (single process) | Hobby ($5/mo + usage) | $5-20 |
| **Redis** | Railway Addon | BullMQ, rate limits, token cache | Included with Railway | $0 (addon) |
| **PostgreSQL** | Supabase | All persistent state + pgvector | Free tier (500MB, 2 projects) | $0 (MVP) |
| **GitHub App** | GitHub | Webhooks, API, permissions | Free | $0 |
| **GitHub Action** | GitHub Marketplace | Client-side LLM execution | Free (client's CI minutes) | $0 |
| **DNS** | Cloudflare (free) | DNS management for api.docalign.dev | Free | $0 |

**Total MVP infrastructure cost:** $5-20/month (Railway only).

### 1.3 Network Connectivity

| From | To | Protocol | Authentication |
|------|-----|----------|---------------|
| GitHub Webhooks | Railway (docalign-server) | HTTPS POST | HMAC-SHA256 signature |
| docalign-server | GitHub API | HTTPS | JWT + Installation token |
| docalign-server | Supabase PostgreSQL | TLS (port 5432) | Connection string (SSL required) |
| docalign-server | Railway Redis | TLS (port 6379) | REDIS_URL with password |
| GitHub Action | docalign-server API | HTTPS | Bearer DOCALIGN_TOKEN |
| docalign-server | GitHub (repository_dispatch) | HTTPS | Installation token |

**Firewall/access control:** Railway provides automatic HTTPS termination. Supabase enforces SSL-only connections. Redis is internal to Railway network (not publicly accessible). No additional firewall rules needed for MVP.

---

## 2. Deployment Strategy

### 2.1 Environments

| Environment | Purpose | Provider | Branch |
|-------------|---------|----------|--------|
| **production** | Live service | Railway | `main` |
| **staging** | Pre-release testing | Railway | `staging` |
| **local** | Development | Docker Compose | any |

**Staging environment:** Separate Railway project with its own Supabase database (Supabase free tier allows 2 projects). Staging uses a separate GitHub App (test app) registered against a test org. Staging Redis is a separate Railway addon.

### 2.2 Railway Configuration

**Service: `docalign-server`**

| Setting | Value |
|---------|-------|
| **Builder** | Nixpacks (auto-detected from `package.json`) |
| **Build command** | `npm run build` |
| **Start command** | `node dist/app.js` |
| **Health check path** | `/health` |
| **Health check timeout** | 5 seconds |
| **Health check interval** | 30 seconds |
| **Restart policy** | On failure (max 3 restarts) |
| **Region** | us-west1 |
| **Instance memory** | 512MB (Railway Hobby default) |
| **Root directory** | `/` (monorepo root, server code in `src/`) |

**Railway `railway.toml`:**

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

**Key detail:** The `buildCommand` runs `npm run migrate:up` after `npm run build`. This executes `node-pg-migrate up` as a pre-deploy step. Migrations run before the new code starts serving traffic, ensuring the database schema is always ahead of or in sync with the application code.

### 2.3 Zero-Downtime Deployment

Railway supports rolling deployments by default:
1. New instance starts alongside old instance.
2. Railway runs the health check against the new instance.
3. Once healthy, traffic switches to the new instance.
4. Old instance is shut down.

**Graceful shutdown handling:**
- On `SIGTERM`, the server must:
  1. Stop accepting new webhook requests (close the HTTP listener).
  2. Wait for in-progress BullMQ jobs to complete (up to 30 seconds grace period).
  3. Close database and Redis connections.
  4. Exit with code 0.

```typescript
// Shutdown handler (pseudo-code for architecture doc, not implementation)
process.on('SIGTERM', async () => {
  server.close();                    // stop accepting new HTTP requests
  await worker.close(30_000);        // wait up to 30s for jobs to finish
  await redis.quit();
  await db.end();
  process.exit(0);
});
```

**Migration safety:** Since migrations run in `buildCommand` (before the new instance starts), the old instance is still running during migrations. Therefore:
- Migrations MUST be backwards-compatible (additive only: new tables, new columns with defaults, new indexes).
- Destructive migrations (drop column, rename column) require a two-phase approach: (1) deploy code that handles both schemas, (2) next deploy runs the destructive migration.

### 2.4 Rollback Procedure

1. **Code rollback:** Railway supports instant rollback to the previous deployment via the dashboard or CLI: `railway rollback`.
2. **Database rollback:** Manual. Run `npm run migrate:rollback` which executes the corresponding rollback SQL script.
3. **Rollback order:** Always rollback code first, then database (since code is backwards-compatible with the previous schema).
4. **Rollback decision criteria:** If health check fails after 3 restarts, or error rate exceeds 10% of requests within 5 minutes of deployment.

---

## 3. CI/CD Pipeline

### 3.1 Pipeline Stages

```
┌───────────┐   ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐
│   Lint    │──>│   Test   │──>│  Build   │──>│  Deploy   │──>│  Verify  │
│           │   │          │   │          │   │ (staging) │   │          │
│ eslint    │   │ unit     │   │ tsc      │   │ Railway   │   │ smoke    │
│ prettier  │   │ integ    │   │ bundle   │   │ auto      │   │ tests    │
│ tsc check │   │ (pg+redis│   │          │   │           │   │          │
│           │   │  in CI)  │   │          │   │           │   │          │
└───────────┘   └──────────┘   └──────────┘   └───────────┘   └──────────┘
                                                     │
                                              (manual gate)
                                                     │
                                              ┌──────▼──────┐
                                              │   Deploy    │
                                              │ (production)│
                                              │  Railway    │
                                              └─────────────┘
```

### 3.2 GitHub Actions Workflow (Server CI)

**File:** `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint          # eslint + prettier check
      - run: npm run typecheck     # tsc --noEmit

  test:
    runs-on: ubuntu-latest
    needs: lint
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: docalign_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgres://test:test@localhost:5432/docalign_test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run migrate:up
      - run: npm test             # vitest (unit + integration)
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
```

**Deployment trigger:** Railway is connected to the GitHub repo. Pushes to `staging` branch auto-deploy to staging. Pushes to `main` branch auto-deploy to production. Railway only deploys if the CI workflow passes (branch protection rule).

### 3.3 Test Strategy (CI)

| Test Type | Tool | Scope | CI Stage |
|-----------|------|-------|----------|
| **Unit tests** | Vitest | Pure functions, claim routing, formatting, schema validation | `test` |
| **Integration tests** | Vitest + real PostgreSQL + Redis | Database queries, BullMQ job flow, migration verification | `test` |
| **Smoke tests** | Custom script (curl-based) | Health endpoint, webhook signature verify, task API auth | `verify` (post-deploy) |
| **Type checking** | tsc --noEmit | Full type coverage | `lint` |
| **Lint** | ESLint + Prettier | Code style, import ordering | `lint` |

**Test database:** CI uses a `pgvector/pgvector:pg16` Docker image with the pgvector extension pre-installed. Migrations run before tests. Tests use transaction rollbacks for isolation.

### 3.4 GitHub Action Release Process

The `docalign/agent-action` is a separate repository. It has its own CI/CD:

```yaml
# .github/workflows/release.yml (in docalign/agent-action repo)
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build        # ncc compile to single dist/index.js
      - run: npm test

  release:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      # Update the major version tag (e.g., v1 -> latest v1.x.x)
      - name: Update major version tag
        run: |
          VERSION=${GITHUB_REF#refs/tags/}
          MAJOR=$(echo $VERSION | cut -d. -f1)
          git tag -fa $MAJOR -m "Update $MAJOR tag"
          git push origin $MAJOR --force
```

See Section 5 for full GitHub Action specification.

---

## 4. Database Operations

### 4.1 Migration Tool: node-pg-migrate

**Configuration (`database.json` or env-based):**

```json
{
  "databaseUrl": { "ENV": "DATABASE_URL" },
  "migrationsDir": "migrations",
  "migrationsTable": "pgmigrations",
  "direction": "up"
}
```

**npm scripts:**

```json
{
  "migrate:up": "node-pg-migrate up",
  "migrate:down": "node-pg-migrate down --count 1",
  "migrate:create": "node-pg-migrate create --template-file-name migrations/template.ts"
}
```

**Migration file naming:** `NNNN_description.sql` (e.g., `0001_create_repos.sql`, `0002_create_scan_runs.sql`).

**Migration dependency order** (from Phase 3A Section 5.3):
```
0001_create_repos
0002_create_scan_runs
0003_create_code_entities
0004_create_claims
0005_create_claim_mappings
0006_create_verification_results
0007_create_feedback
0008_create_co_changes
0009_create_agent_drift_reports
0010_create_agent_tasks
0011_create_suppression_rules
0012_create_static_analysis_rules
0013_enable_pgvector
0014_add_vector_columns_and_indexes
```

**Rollback scripts:** Alongside each migration file, a corresponding rollback script exists at `migrations/rollback/NNNN_rollback_description.sql`. Rollbacks are manual (not automatic). Execute via `npm run migrate:down` or by running the rollback SQL directly.

**Migration testing in CI:** The CI pipeline runs `npm run migrate:up` against a clean PostgreSQL instance with pgvector. This validates that all migrations apply cleanly from scratch. Rollback scripts are tested by running `npm run migrate:up && npm run migrate:down --count N && npm run migrate:up` to verify roundtrip integrity.

### 4.2 Backup Strategy

| Aspect | Value |
|--------|-------|
| **Provider** | Supabase (managed backups) |
| **RPO (Recovery Point Objective)** | 24 hours (Supabase free tier: daily backups) |
| **RTO (Recovery Time Objective)** | 1 hour (Supabase restore from dashboard) |
| **Backup frequency** | Daily (automatic, managed by Supabase) |
| **Backup retention** | 7 days (Supabase free tier) |
| **Point-in-time recovery** | Not available on free tier. Available on Pro ($25/mo) |
| **Manual backup** | `pg_dump` via Supabase connection string, stored in S3 (weekly, scripted) |

**Upgrade path:** At ~10 paying customers, upgrade to Supabase Pro ($25/mo) for:
- Point-in-time recovery (RPO drops to ~minutes)
- 30-day backup retention
- 8GB database size
- Connection pooling via Supavisor

**Disaster recovery procedure:**
1. Detect data loss (monitoring alert or user report).
2. Restore from latest Supabase backup via dashboard.
3. Re-run migrations if needed (migrations are idempotent UP).
4. Trigger full re-scan for affected repos (re-index + re-extract + re-verify).
5. Post-mortem: document cause and update runbook.

### 4.3 Connection Management

**MVP (0-10 customers):** Direct connections, no pooling.

```typescript
// Database connection (pseudo-code)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,                // max connections in Node.js pool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
```

**Scaling path (10+ customers, audit finding I2):** Add Supabase connection pooling via Supavisor (PgBouncer-compatible). Change `DATABASE_URL` to the pooled connection string. Adjust `max` to 20, `idleTimeoutMillis` to 30_000.

**Connection retry:** On connection failure, retry with exponential backoff (1s, 2s, 4s). Max 3 retries. If all fail, mark the job as failed and let BullMQ handle job-level retry.

### 4.4 Database Monitoring

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Active connections | `pg_stat_activity` count | > 80% of max (e.g., > 80 of 100) |
| Longest running query | `pg_stat_activity` duration | > 60 seconds |
| Table size (top 5) | `pg_total_relation_size()` | > 80% of Supabase tier limit |
| Dead tuples ratio | `pg_stat_user_tables` | > 20% dead tuples (needs VACUUM) |
| Migration version | `pgmigrations` table | Mismatch with expected version |

**Monitoring implementation:** A scheduled BullMQ job (`db-health-check`, every 5 minutes) queries these metrics and logs them as structured JSON (see Section 8). Alerts are triggered by threshold breaches logged at `error` level.

---

## 5. GitHub Action: `docalign/agent-action`

### 5.1 Action Definition (`action.yml`)

```yaml
name: 'DocAlign Agent'
description: 'Run DocAlign verification tasks using your LLM API key. Extracts claims, verifies documentation accuracy, and reports drift.'
author: 'docalign'

branding:
  icon: 'file-text'
  color: 'blue'

inputs:
  docalign_token:
    description: 'DocAlign API token for this repository'
    required: true
  docalign_api_url:
    description: 'DocAlign API base URL'
    required: false
    default: 'https://api.docalign.dev'
  anthropic_api_key:
    description: 'Anthropic API key for LLM calls'
    required: false
  openai_api_key:
    description: 'OpenAI API key for embeddings'
    required: false
  config_path:
    description: 'Path to .docalign.yml config file'
    required: false
    default: '.docalign.yml'

runs:
  using: 'node20'
  main: 'dist/index.js'
```

### 5.2 Client Workflow File

Users add this to their repo at `.github/workflows/docalign.yml`:

```yaml
name: DocAlign
on:
  repository_dispatch:
    types: [docalign-scan]

permissions:
  contents: read
  checks: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docalign/agent-action@v1
        with:
          docalign_token: ${{ secrets.DOCALIGN_TOKEN }}
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
```

### 5.3 Action Runtime Flow

1. Receive `repository_dispatch` event with `client_payload: { repo_id, scan_run_id, scan_type, trigger_ref, task_ids }`.
2. Read `.docalign.yml` configuration (model choices, concurrency, limits).
3. Authenticate with DocAlign API using `DOCALIGN_TOKEN`.
4. Poll `GET /api/tasks/pending?repo_id={repo_id}` for assigned tasks.
5. Execute tasks in parallel (concurrency from config, default 5, max 20):
   - **claim_extraction:** Run LLM extraction prompt, submit structured claims.
   - **path1_verification:** Build evidence from entity data, run LLM verification, submit verdict.
   - **path2_verification:** Spawn agent (Claude Code custom-command), submit verdict.
   - **embedding_generation:** Call embedding API, submit vectors.
   - **fix_generation:** Generate suggested fix text, submit.
6. Submit each result via `POST /api/tasks/{id}/result`.
7. On completion, log summary (tasks completed, failed, cost estimate).
8. Exit. If tasks remain and Action timed out, DocAlign server marks them as expired.

**Secret masking:** All API keys are registered with `core.setSecret()` at startup to prevent accidental logging in CI output (audit finding S14).

### 5.4 Marketplace Publishing

| Aspect | Detail |
|--------|--------|
| **Marketplace listing** | Published from day 1 for discoverability (Phase 3A decision) |
| **Repository** | `docalign/agent-action` (public) |
| **Category** | Code Quality |
| **Pricing** | Free |
| **Verification** | Apply for GitHub Marketplace verified creator badge |
| **Icon** | DocAlign logo (file-text icon with blue branding) |
| **README** | Setup instructions, configuration reference, example workflow |

### 5.5 Action Versioning

**Strategy:** Semantic versioning with major version tags.

- Tags: `v1.0.0`, `v1.1.0`, `v1.2.0`, etc.
- Major version tag: `v1` (floats to latest `v1.x.x`).
- Users reference `docalign/agent-action@v1` to get latest compatible version.
- Breaking changes bump major version: `v2`.

**Release checklist:**
1. Update `CHANGELOG.md` with changes.
2. Run `npm run build` to compile with `@vercel/ncc`.
3. Commit compiled `dist/index.js`.
4. Tag with semver: `git tag v1.x.x`.
5. Push tag: `git push origin v1.x.x`.
6. CI auto-updates the major version tag (see Section 3.4).

### 5.6 Client Setup Sequence

When the Action is not yet configured, DocAlign posts a GitHub Check with setup instructions:

```
DocAlign: Setup Required

To enable DocAlign scanning, add the following to your repository:

1. Create .github/workflows/docalign.yml:
   (workflow YAML shown)

2. Add repository secrets:
   - DOCALIGN_TOKEN: (generated during GitHub App install, shown once)
   - ANTHROPIC_API_KEY: Your Anthropic API key
   - OPENAI_API_KEY: Your OpenAI API key (for embeddings)

3. Push the workflow file to trigger your first scan.

Documentation: https://docs.docalign.dev/setup
```

---

## 6. Secret Management

### 6.1 Server-Side Secrets

| Secret | Storage | Format | Rotation Period |
|--------|---------|--------|-----------------|
| `GITHUB_APP_ID` | Railway env var | Integer | Static (only changes if app recreated) |
| `GITHUB_PRIVATE_KEY` | Railway env var | PEM (RSA 2048) | 12 months (see rotation procedure in Phase 3E) |
| `GITHUB_WEBHOOK_SECRET` | Railway env var | Random string (32+ chars) | On compromise (see zero-downtime rotation below) |
| `DATABASE_URL` | Railway env var | PostgreSQL connection string (SSL) | Managed by Supabase (rotate on compromise) |
| `REDIS_URL` | Railway env var | Redis connection string | Managed by Railway addon |
| `DOCALIGN_API_SECRET` | Railway env var | Random string (64 chars, hex) | 6 months. Used for HMAC dismiss tokens only (not for DOCALIGN_TOKEN). |

### 6.2 Client-Side Secrets

| Secret | Storage | Format | Rotation |
|--------|---------|--------|----------|
| `DOCALIGN_TOKEN` | GitHub repo secret | Random 256-bit token (`docalign_` prefix) | 1-year default, configurable via `DOCALIGN_TOKEN_TTL_DAYS` |
| `ANTHROPIC_API_KEY` | GitHub repo secret | Anthropic API key | Client-managed |
| `OPENAI_API_KEY` | GitHub repo secret | OpenAI API key | Client-managed |

### 6.3 Webhook Secret Zero-Downtime Rotation

DocAlign never sees downtime when rotating the webhook secret:

1. Generate new webhook secret: `openssl rand -hex 32`.
2. Update the GitHub App settings to use the new secret.
3. For a brief window (< 5 minutes), verify webhooks against BOTH old and new secrets (try new first, fall back to old).
4. Update Railway env var `GITHUB_WEBHOOK_SECRET` to the new value.
5. Railway redeploys (rolling deployment).
6. After deploy completes, the old secret is no longer needed.

**Implementation note:** The dual-secret verification window is handled by storing both secrets in environment variables (`GITHUB_WEBHOOK_SECRET` and `GITHUB_WEBHOOK_SECRET_OLD`) and checking both during the rotation window.

### 6.4 DOCALIGN_TOKEN Lifecycle (audit finding S5)

1. **Generation:** On GitHub App installation, the server generates a per-repo token: `"docalign_" + crypto.randomBytes(32).toString('hex')`. Server stores `SHA-256(token)` in `repos.token_hash`. The token is shown to the user once.
2. **Distribution:** Token is displayed once during setup (in the GitHub Check instructions). User copies it to their repo secrets.
3. **Validation:** On each API call, server hashes the provided token with SHA-256 and compares against `repos.token_hash`.
4. **Rotation:** Tokens expire after 1 year by default (configurable via `DOCALIGN_TOKEN_TTL_DAYS` env var). The Action logs a warning 30 days before expiry. User regenerates via `POST /api/repos/{id}/rotate-token`.
5. **Revocation:** On uninstall, all tokens for the repo are invalidated (repo record deleted via cascade, `token_hash` is gone).

---

## 7. Domain, DNS, SSL/TLS

### 7.1 Domain Structure

| Domain | Purpose | Provider |
|--------|---------|----------|
| `docalign.dev` | Primary domain | Registrar (e.g., Namecheap, Google Domains) |
| `api.docalign.dev` | API + webhook endpoint | Railway custom domain |
| `docs.docalign.dev` | Documentation site (future) | GitHub Pages or Vercel |

### 7.2 DNS Configuration

| Record | Type | Value | Proxy |
|--------|------|-------|-------|
| `api.docalign.dev` | CNAME | `{project}.up.railway.app` | No (direct to Railway) |
| `docalign.dev` | A | Landing page hosting IP | Optional |
| `docs.docalign.dev` | CNAME | GitHub Pages or Vercel | Optional |

### 7.3 SSL/TLS

| Aspect | Detail |
|--------|--------|
| **Certificate** | Auto-provisioned by Railway (Let's Encrypt) |
| **Minimum TLS version** | TLS 1.2 (Railway default) |
| **Certificate renewal** | Automatic (Railway managed) |
| **HSTS** | Enabled via response headers |
| **Supabase connection** | SSL required (`sslmode=require` in DATABASE_URL) |
| **Redis connection** | TLS enforced by Railway addon |

**Response headers set by the application:**

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

---

## 8. Observability

### 8.1 Structured JSON Logging

**Library:** pino (with `safe: true` to prevent log injection per audit finding S10).

**Log format:** All logs are structured JSON written to stdout. Railway captures stdout and makes it searchable.

**Example log lines:**

```json
{"level":"info","time":"2026-02-11T14:23:01.234Z","msg":"webhook_received","event":"pull_request.opened","repo":"acme/widgets","delivery_id":"abc-123-def","installation_id":12345}
```

```json
{"level":"info","time":"2026-02-11T14:23:02.456Z","msg":"job_started","job_id":"pr-scan-uuid-42","job_type":"pr_scan","repo_id":"uuid-repo-1","pr_number":42,"queue_depth":3}
```

```json
{"level":"info","time":"2026-02-11T14:23:45.789Z","msg":"job_completed","job_id":"pr-scan-uuid-42","job_type":"pr_scan","repo_id":"uuid-repo-1","duration_ms":43333,"claims_checked":12,"claims_drifted":2,"claims_verified":9,"claims_uncertain":1}
```

```json
{"level":"info","time":"2026-02-11T14:23:46.001Z","msg":"pr_comment_posted","repo":"acme/widgets","pr_number":42,"findings_count":2,"comment_id":98765}
```

```json
{"level":"info","time":"2026-02-11T14:23:50.100Z","msg":"agent_task_result","task_id":"uuid-task-1","task_type":"path1_verification","status":"completed","duration_ms":2340,"model":"claude-sonnet","input_tokens":1200,"output_tokens":350}
```

```json
{"level":"warn","time":"2026-02-11T14:24:00.200Z","msg":"rate_limit_approaching","repo_id":"uuid-repo-1","remaining":120,"limit":5000,"reset_at":"2026-02-11T15:00:00Z"}
```

```json
{"level":"error","time":"2026-02-11T14:25:00.300Z","msg":"job_failed","job_id":"pr-scan-uuid-99","job_type":"pr_scan","repo_id":"uuid-repo-2","error_type":"database_connection","error_message":"connection refused","attempt":2,"max_attempts":3,"stack":"Error: connect ECONNREFUSED..."}
```

```json
{"level":"info","time":"2026-02-11T14:26:00.400Z","msg":"cost_tracking","event":"scan_completed","repo_id":"uuid-repo-1","scan_run_id":"uuid-scan-1","server_cost_usd":0,"client_estimated_cost_usd":0.15,"claims_total":12,"agent_tasks":3}
```

```json
{"level":"info","time":"2026-02-11T14:27:00.500Z","msg":"db_health_check","active_connections":8,"max_connections":100,"longest_query_ms":234,"table_sizes_mb":{"claims":12.5,"code_entities":45.2,"verification_results":8.1},"dead_tuple_ratio":0.02}
```

### 8.2 Log Levels by Component

| Component | Level | What Gets Logged |
|-----------|-------|-----------------|
| **Webhook handler** | `info` | Every webhook received (type, repo, delivery_id) |
| **Webhook handler** | `warn` | Invalid signature, rate limited |
| **Webhook handler** | `error` | Signature verification failure |
| **BullMQ Worker** | `info` | Job started, completed (with duration, claim counts) |
| **BullMQ Worker** | `warn` | Job approaching timeout (>80% of 10min), cancellation |
| **BullMQ Worker** | `error` | Job failed (with error type, message, stack) |
| **Agent Task API** | `info` | Task claimed, result submitted |
| **Agent Task API** | `warn` | Late result (task expired), invalid result schema |
| **Agent Task API** | `error` | Auth failure, internal error |
| **Database** | `info` | Health check metrics (every 5 min) |
| **Database** | `warn` | Connection pool > 70% utilized, slow query (>5s) |
| **Database** | `error` | Connection failure, migration failure |
| **GitHub API** | `info` | Rate limit status on every response |
| **GitHub API** | `warn` | Rate limit < 20% remaining |
| **GitHub API** | `error` | API call failure (after retries) |
| **Health check** | `debug` | Every health check request (disabled in production) |
| **Cleanup jobs** | `info` | Purge job completed (records deleted count) |

### 8.3 Metrics

Railway does not provide a built-in metrics system. For MVP, metrics are derived from structured logs.

**Key metrics (extracted from logs):**

| Metric | Source Log Event | Aggregation |
|--------|-----------------|-------------|
| Webhook throughput | `webhook_received` count | Per minute |
| Job throughput | `job_completed` count | Per hour |
| Job duration (p50, p95, p99) | `job_completed.duration_ms` | Per hour |
| Error rate | `job_failed` / `job_completed` | Per hour |
| Queue depth | `job_started.queue_depth` | Point-in-time |
| Claims per scan | `job_completed.claims_checked` | Per scan |
| Drift rate | `job_completed.claims_drifted / claims_checked` | Per scan |
| Agent task completion rate | `agent_task_result` where `status=completed` / total | Per hour |
| DB connection utilization | `db_health_check.active_connections` | Per 5 min |
| GitHub API rate limit remaining | `rate_limit_approaching.remaining` | Per request |

### 8.4 Cost Tracking Events

Every scan completion logs a cost tracking event:

```json
{
  "level": "info",
  "msg": "cost_tracking",
  "event": "scan_completed",
  "repo_id": "uuid",
  "scan_run_id": "uuid",
  "server_cost_usd": 0,
  "client_estimated_cost_usd": 0.15,
  "claims_total": 12,
  "path1_tasks": 8,
  "path2_tasks": 2,
  "embedding_tasks": 0,
  "extraction_tasks": 1,
  "total_input_tokens": 15000,
  "total_output_tokens": 4500
}
```

**Client cost estimation:** Calculated from agent task results (`input_tokens`, `output_tokens`, model used). Per-model pricing stored in a config lookup table. Estimate is logged for observability but NOT displayed to users in MVP (users track their own LLM API costs).

### 8.5 Alerting Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **Health check down** | `/health` returns non-200 for > 2 minutes | Critical | Page on-call (Railway notification) |
| **High error rate** | > 10% of jobs fail within 15-minute window | Critical | Investigate immediately |
| **Queue depth growing** | Queue depth > 50 for > 10 minutes | Warning | Check for stuck jobs, consider scaling |
| **Database connections saturated** | Active connections > 80% of max for > 5 minutes | Warning | Evaluate connection pooling |
| **Long-running query** | Any query > 60 seconds | Warning | Investigate, consider query optimization |
| **GitHub API rate limit** | Remaining < 10% | Warning | Reduce API call frequency, batch requests |
| **Disk/DB size** | Table sizes > 80% of Supabase tier limit | Warning | Plan tier upgrade or data cleanup |
| **Migration mismatch** | App expected migration != DB migration version | Critical | Block deploy, investigate |
| **Agent task expiry spike** | > 30% of agent tasks expire in 1 hour | Warning | Check client Action health |
| **Memory pressure** | Process RSS > 400MB (of 512MB limit) | Warning | Investigate memory leaks, reduce concurrency |

**Alerting implementation (MVP):** Railway provides basic health check alerts (down/up notifications). For log-based alerts, use a simple cron job that queries recent logs and sends Slack/email notifications when thresholds are breached. Upgrade to Datadog or Grafana Cloud at ~20 customers.

### 8.6 Dashboard Design (MVP)

**Primary dashboard: Railway built-in metrics**
- CPU usage, Memory usage, Network I/O
- Deploy history, logs viewer

**Custom dashboard (future, ~20 customers):**

```
┌─────────────────────────────────────────────────────────┐
│  DocAlign Operations Dashboard                           │
├─────────────────┬───────────────────────────────────────┤
│  Service Health │  Key Metrics (last 24h)                │
│  ● API: UP     │  Webhooks received: 342                │
│  ● Worker: UP  │  Scans completed: 287                  │
│  ● DB: UP      │  Scans failed: 3 (1.0%)               │
│  ● Redis: UP   │  Avg scan duration: 42s                │
│                 │  Queue depth (now): 2                  │
├─────────────────┼───────────────────────────────────────┤
│  DB Connections │  GitHub API Rate Limit                 │
│  8 / 100       │  ████████░░ 4,200 / 5,000 remaining   │
│  (8%)          │  Resets in: 23 min                     │
├─────────────────┼───────────────────────────────────────┤
│  Top Repos      │  Error Breakdown                      │
│  (by scan vol)  │  DB connection: 1                     │
│  1. acme/web    │  GitHub API 429: 2                    │
│  2. acme/api    │  Agent timeout: 0                     │
│  3. beta/docs   │  Other: 0                             │
├─────────────────┴───────────────────────────────────────┤
│  Scan Duration (p50/p95) — Last 7 Days                   │
│  [sparkline chart]                                       │
├─────────────────────────────────────────────────────────┤
│  Cost Tracking — Last 30 Days                            │
│  Server cost: $12.50 (Railway)                           │
│  Supabase: $0 (free tier)                                │
│  Client LLM cost (estimated): $45.20 across 15 repos    │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Local Development Environment

### 9.1 Prerequisites

| Tool | Version | Install Command |
|------|---------|-----------------|
| Node.js | 20.x LTS | `brew install node@20` (macOS) or `nvm install 20` |
| npm | 10.x+ | (bundled with Node.js 20) |
| Docker | 24.x+ | `brew install --cask docker` (macOS) |
| Docker Compose | 2.x+ | (bundled with Docker Desktop) |
| Git | 2.x+ | `brew install git` (macOS) |
| GitHub CLI | 2.x+ | `brew install gh` (optional, for Action testing) |

### 9.2 Setup Steps

**Step 1: Clone the repository**

```bash
git clone https://github.com/docalign/docalign.git
cd docalign
```

**Step 2: Install dependencies**

```bash
npm install
```

**Step 3: Start local PostgreSQL and Redis**

```bash
docker compose up -d
```

**`docker-compose.yml`:**

```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - '5432:5432'
    environment:
      POSTGRES_USER: docalign
      POSTGRES_PASSWORD: docalign
      POSTGRES_DB: docalign_dev
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U docalign']
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

**Step 4: Create `.env` file**

```bash
cp .env.example .env
```

**`.env.example`:**

```bash
# Database
DATABASE_URL=postgres://docalign:docalign@localhost:5432/docalign_dev

# Redis
REDIS_URL=redis://localhost:6379

# GitHub App (create a test app at https://github.com/settings/apps)
GITHUB_APP_ID=your_test_app_id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=dev-webhook-secret

# API Secret (generate: openssl rand -hex 32)
DOCALIGN_API_SECRET=dev-api-secret-change-me

# Server
PORT=8080
NODE_ENV=development
LOG_LEVEL=debug
```

**Step 5: Run database migrations**

```bash
npm run migrate:up
```

**Step 6: Verify the database**

```bash
docker exec -it $(docker compose ps -q postgres) psql -U docalign -d docalign_dev -c "\dt"
```

This should list all DocAlign tables (repos, claims, code_entities, etc.).

**Step 7: Start the development server**

```bash
npm run dev
```

This starts the Express server + BullMQ worker in watch mode (using `tsx watch` or `nodemon`). The server listens on `http://localhost:8080`.

**Step 8: Verify the server is running**

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"status":"ok","queue_depth":0}
```

### 9.3 Testing Webhooks Locally

**Option A: smee.io (recommended for development)**

```bash
# Install smee client
npm install -g smee-client

# Create a channel at https://smee.io/new (gives you a URL)
# Set this URL as the webhook URL in your test GitHub App settings

# Forward webhooks to local server
smee -u https://smee.io/YOUR_CHANNEL_ID -t http://localhost:8080/webhook -p 8080
```

**Option B: ngrok**

```bash
ngrok http 8080
# Use the ngrok URL as the webhook URL in your test GitHub App
```

**Option C: Manual webhook replay**

```bash
# Send a test webhook with a valid signature
node scripts/send-test-webhook.js --event pull_request --action opened --repo test/repo
```

The `send-test-webhook.js` script constructs a valid webhook payload, signs it with the local `GITHUB_WEBHOOK_SECRET`, and POSTs it to `http://localhost:8080/webhook`.

### 9.4 Running the GitHub Action Locally

**Using `act` (GitHub Actions local runner):**

```bash
# Install act
brew install act

# Run the docalign Action locally
cd path/to/test-repo
act repository_dispatch \
  -e .github/test-events/docalign-scan.json \
  -s DOCALIGN_TOKEN=test-token \
  -s ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -s OPENAI_API_KEY=$OPENAI_API_KEY
```

**Test event file (`.github/test-events/docalign-scan.json`):**

```json
{
  "action": "docalign-scan",
  "client_payload": {
    "repo_id": "test-repo-uuid",
    "scan_run_id": "test-scan-uuid",
    "scan_type": "pr",
    "trigger_ref": "42",
    "task_ids": ["task-uuid-1", "task-uuid-2"]
  }
}
```

### 9.5 Running Tests Locally

```bash
# Unit tests
npm test

# Unit tests in watch mode
npm run test:watch

# Integration tests (requires Docker services running)
npm run test:integration

# Type checking
npm run typecheck

# Lint
npm run lint

# All checks (CI equivalent)
npm run check:all
```

### 9.6 Local Database Commands

```bash
# Create a new migration
npm run migrate:create -- my_migration_name

# Run all pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Reset database (drop and recreate)
docker compose down -v && docker compose up -d && npm run migrate:up

# Connect to local database
docker exec -it $(docker compose ps -q postgres) psql -U docalign -d docalign_dev

# View BullMQ queues (Redis CLI)
docker exec -it $(docker compose ps -q redis) redis-cli
> KEYS bull:*
```

---

## 10. Audit Finding Resolutions

### I4: Org-Wide Onboarding UX

**Finding:** 50-repo org takes 75+ minutes to onboard. Need progress indication and prioritization.

**Resolution:**
- **Prioritization:** Sort repos by `pushed_at` (most recently active first). Onboard in that order.
- **Progress indication:** Post a single GitHub Issue in each repo being scanned with title "DocAlign: Initial scan in progress." Close the issue when the scan completes or fails.
- **Repo selection:** For MVP, scan all repos in the installation. Repo selection during install is deferred (requires a web UI or config file, which is post-MVP).
- **Batch limit:** Max 10 concurrent full scan jobs across all repos in a single installation event (already specified in PRD Section 3.2).
- **Time estimate:** With 10 concurrent scans and ~5-minute average per repo, a 50-repo org completes in ~25 minutes. Progress is visible per-repo via GitHub Issues.

### I6: GitHub API Rate Limits

**Finding:** At 50-100 customers, GitHub API rate limits (5000 req/hr shared per installation) become a bottleneck.

**Resolution:**
- **Batch review comments:** Use single `POST /repos/{owner}/{repo}/pulls/{pr}/reviews` call with multiple comments in the `comments` array, instead of individual comment POSTs. This is already specified in the PRD.
- **GraphQL where possible:** Use GraphQL for batch file reads (`repository.object` query for multiple files in one request). GraphQL has a separate, more generous rate limit (5000 points/hr, most queries cost 1 point).
- **Request higher limits:** Once the GitHub App is verified on the Marketplace, apply for higher rate limits via GitHub support.
- **Rate limit tracking:** Log `X-RateLimit-Remaining` on every API response (see observability Section 8). Adaptive behavior:
  - Remaining < 20%: switch to clone-based file access for non-critical operations.
  - Remaining < 5%: defer all non-essential API calls, queue them for after reset.
- **Installation-level isolation:** Each installation has its own rate limit. Cross-installation calls use different tokens, different limits.

### I8: HNSW Vector Index Partitioning

**Finding:** At 50K+ repos, vector search on `code_entities` and `claims` tables degrades.

**Resolution (deferred to 1000+ customers):**
- Partition `code_entities` and `claims` by `repo_id` using PostgreSQL declarative partitioning (hash partitioning, 32 partitions initially).
- Queries always include `WHERE repo_id = $1`, so partition pruning is effective.
- HNSW indexes are per-partition (smaller indexes, faster search).
- Migration: create new partitioned table, backfill from old table, swap with `ALTER TABLE ... RENAME`.
- **MVP action:** No partitioning. Single-table HNSW indexes perform well up to ~500K rows (adequate for 1000 repos with 500 entities each).

### I9: Verification Results Table Partitioning

**Finding:** At 100K+ repos, `verification_results` table grows unbounded.

**Resolution (deferred to 5000+ customers):**
- Partition `verification_results` by `created_at` (monthly range partitions).
- Drop old partitions instead of DELETE (instant, no VACUUM needed).
- Retention policy: keep 6 months of partitions.
- **MVP action:** Rely on the existing retention policy (keep last 10 per claim, weekly purge job). This is sufficient for MVP scale.

### I10: Configuration Validation Visibility

**Finding:** Invalid `.docalign.yml` should be surfaced to the user, not just logged.

**Resolution:**
- On invalid configuration, include a note in the PR summary comment:
  ```
  > **Configuration warning:** `verification.min_severity` has invalid value "critical" (expected: high, medium, low). Using default: "medium".
  ```
- One warning line per invalid field, appended to the bottom of the PR summary comment in a collapsible `<details>` section.
- Log at `warn` level with field name, invalid value, and default used.
- Never fail a scan due to config errors (already specified in PRD Appendix A).

### I11: tree-sitter 4+ Language Handling

**Finding:** If a repo uses more than 3 languages, tree-sitter grammar loading needs an eviction strategy.

**Resolution:**
- **LRU cache for grammars:** Maintain a cache of loaded tree-sitter WASM grammars. Cache size: 4 grammars (covers MVP languages TS/JS/Python plus one additional).
- **Eviction:** When a 5th grammar is requested, evict the least-recently-used grammar. Grammar loading is ~50ms (WASM instantiation), so eviction cost is negligible.
- **Per-job scope:** Grammar cache is per-worker-process. Since the MVP runs a single process, the cache is shared across jobs. Cache is warmed on first use.
- **Memory impact:** Each tree-sitter WASM grammar uses ~2-5MB. 4 grammars = ~8-20MB. Well within the 512MB container limit.

### I13: Healthcheck Queue Depth Definition

**Finding:** The `/health` endpoint returns `queue_depth` but the definition is ambiguous.

**Resolution:**
- `queue_depth` = total count of jobs in `waiting` + `active` states across ALL per-repo queues.
- Implementation: `await queue.getJobCounts('waiting', 'active')` summed across queues.
- The health endpoint returns:
  ```json
  {
    "status": "ok",
    "queue_depth": 5,
    "active_jobs": 2,
    "waiting_jobs": 3,
    "uptime_seconds": 86400,
    "version": "1.0.0"
  }
  ```
- Health check returns HTTP 200 as long as the process is running and can connect to Redis. It does NOT fail on high queue depth (that is a capacity issue, not a health issue).
- **Degraded state:** If Redis is unreachable, return HTTP 503 with `{ "status": "degraded", "error": "redis_unreachable" }`.
- **Database check:** The health endpoint does NOT check PostgreSQL on every call (too expensive at 30s interval). Database health is checked by the separate `db-health-check` scheduled job (every 5 minutes).

### I14: Retry Timing Per Error Type

**Finding:** Retry behavior should be standardized across all error types.

**Resolution:**
- **Per-call retries (within a single job execution):**
  - Attempts: 2 (original + 1 retry). Configurable via `RETRY_PER_CALL_MAX` env var.
  - Backoff: exponential with 2x multiplier (1s, 2s)
  - Applies to: GitHub API calls, database queries, Redis commands
  - On final failure: propagate error to job level

- **Per-job retries (BullMQ job-level):**
  - Attempts: 3 (original + 2 retries). Configurable via `RETRY_PER_JOB_MAX` env var.
  - Backoff: exponential with 2x multiplier (1s, 2s, 4s)
  - Applies to: all job types (pr_scan, full_scan, push_scan, cleanup)
  - On final failure: mark scan as `failed`, post error comment on PR

- **Standardized across error types:** All errors use the same retry schedule. No error-type-specific retry behavior in MVP. The rationale: simplicity over optimization. Most transient errors (rate limits, connection timeouts, temporary unavailability) resolve within the same backoff window.

- **Non-retryable errors** (fail immediately, no retry):
  - Invalid webhook signature (HTTP 401)
  - Task already completed (HTTP 409)
  - Task expired (HTTP 410)
  - Malformed agent result (HTTP 400)
  - Rate limit exceeded (scan-level, not API-call-level)

---

## 11. Cross-References

| Document | Relevance to This Phase |
|----------|------------------------|
| `phases/phase3-architecture.md` (3A) | Service topology, ADRs, concurrency model, data architecture, scaling milestones |
| `PRD.md` | Product requirements, onboarding flow, configuration options |
| `prd/infrastructure-deployment.md` | GitHub App permissions, auth flow, API endpoints, secret management |
| `prd/L4-change-scanning.md` | Webhook handling, debounce, rate limits, error handling |
| `phases/phase2.5-audit-findings.md` | Infrastructure audit findings I4, I6, I8-I14 |
| `phases/technical-reference.md` | Database schemas, interfaces, processing architecture |
| `phases/phase3-integration-specs.md` (3B) | Agent Task API contracts, webhook payload schemas |
| `phases/phase3-error-handling.md` (3C) | Error taxonomy, retry policies, partial result handling |
| `phases/phase3-security.md` (3E) | Threat model, token rotation procedures, RLS policies |
| `phases/adr-agent-first-architecture.md` | Repository dispatch, task lifecycle, client-side execution |

---

## 12. Open Decisions

| # | Decision | Options | Recommendation | Status |
|---|----------|---------|---------------|--------|
| 1 | Railway vs Fly.io | Railway (simpler) vs Fly.io (more control) | Railway for MVP (simpler deploy, adequate for scale) | **Decided: Railway** (per PRD) |
| 2 | Monitoring upgrade timing | Datadog vs Grafana Cloud vs custom | Evaluate at ~20 paying customers based on operational pain | Deferred |
| 3 | Supabase Pro upgrade timing | Free tier limit (500MB) | Upgrade at ~10 paying customers or ~300MB used | Deferred |
| 4 | Multi-worker deployment | Horizontal scaling trigger | Split API + Worker at >5 concurrent jobs needed | Deferred (per 3A Section 10.2) |
