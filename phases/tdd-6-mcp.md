# TDD-6: MCP Server (Layer 6)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 8), prd/L6-mcp-server.md, phase3-integration-specs.md (Section 4), phase3-decisions.md (3B-D4), phase3-error-handling.md, technical-reference.md (Sections 3.7, 8.4)
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 6 (MCP Server) exposes DocAlign's verified documentation knowledge to AI coding agents via the Model Context Protocol. It is a standalone local process spawned by an agent's IDE or CLI (Claude Code, Cursor, etc.) that communicates over stdio transport and reads from the same PostgreSQL database that the GitHub App populates.

The MCP server provides four tools: `get_docs` (search documentation by topic, returning sections with verification metadata), `get_doc_health` (retrieve health score for a file, directory, or entire repo), `list_stale_docs` (surface documentation with known drift or staleness), and `report_drift` (accept agent-reported documentation inaccuracies). The first three tools are read-only (v2). `report_drift` requires write access and is a v3 feature; it is designed now for architectural readiness.

**Key architectural constraints:**
- Single PostgreSQL connection, not pooled (3B-D4) -- MCP server is a single-user local process.
- Read-only by default (`SET default_transaction_read_only = ON`). Separate writable connection for `report_drift` (v3).
- Zero LLM calls. All queries are SQL-based (claim embeddings are pre-computed by the GitHub Action).
- Invoked as `npx @docalign/mcp-server --repo <path>`.
- Must resolve repo identity from filesystem path to `repo_id` in PostgreSQL.

**Boundaries:** L6 does NOT extract claims, map claims, verify claims, or trigger scans. It is a read-only query layer over the data that L0-L5 and L7 produce. The sole exception is `report_drift` (v3), which inserts into `agent_drift_reports`.

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| PostgreSQL | `claims` table (claim text, type, verification status, embeddings, source file, line number) | `get_docs`, `get_doc_health`, `list_stale_docs` |
| PostgreSQL | `verification_results` table (verdict, confidence, last verified timestamp) | `get_docs`, `get_doc_health` |
| PostgreSQL | `repos` table (repo_id lookup by owner/repo, cached health_score) | All tools (repo resolution) |
| PostgreSQL (pgvector) | Cosine similarity search over `claims.embedding` | `get_docs` semantic search |
| PostgreSQL | `agent_drift_reports` table (insert) | `report_drift` (v3, write) |
| Filesystem | `.git/config` or `.git` remote URL to resolve repo identity | Server startup (repo resolution) |
| Environment / Config | `DOCALIGN_DATABASE_URL` or `~/.docalign/config.json` | Database connection resolution |
| `@modelcontextprotocol/server` | `McpServer` class, tool registration API | Server setup |
| `@modelcontextprotocol/node` | `NodeStdioServerTransport` | stdio transport |

### 2.2 Exposes to

| Consumer | Tool | When |
|----------|------|------|
| Claude Code, Cursor, any MCP-compatible agent | `get_docs` | Agent wants documentation about a topic |
| Claude Code, Cursor, any MCP-compatible agent | `get_doc_health` | Agent wants to check doc freshness before relying on it |
| Claude Code, Cursor, any MCP-compatible agent | `list_stale_docs` | Agent wants to know which docs are unreliable |
| Claude Code, Cursor, any MCP-compatible agent | `report_drift` (v3) | Agent discovered a doc inaccuracy while working |

### 2.3 Does NOT consume

| Layer | Why |
|-------|-----|
| L0 `CodebaseIndexService` | MCP reads claims/results directly from DB, not through L0 |
| L1-L5, L7 service APIs | MCP is decoupled; queries the database directly |
| Redis / BullMQ | MCP server has no queue interaction |
| GitHub API | MCP is local-only; no GitHub authentication |

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md` Section 8. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `GetDocsRequest` / `GetDocsResponse` (Section 8.1) -- get_docs tool I/O
- `GetDocHealthRequest` / `GetDocHealthResponse` (Section 8.1) -- get_doc_health tool I/O
- `ReportDriftRequest` / `ReportDriftResponse` (Section 8.1) -- report_drift tool I/O
- `ListStaleDocsRequest` / `ListStaleDocsResponse` (Section 8.1) -- list_stale_docs tool I/O
- `HealthScore` / `FileHealth` (Section 7.1) -- health score structure
- `Verdict` (Section 1) -- `'verified' | 'drifted' | 'uncertain'`
- `ClaimType` (Section 1) -- claim type enum
- `AgentDriftReportRow` (Section 12) -- database row for drift reports

**Referenced database row types:**
- `ClaimRow` (Section 12) -- claims table
- `VerificationResultRow` (Section 12) -- verification_results table
- `RepoRow` (Section 12) -- repos table

**Layer-internal types** (not in api-contracts, specific to L6 implementation):

```typescript
/** Resolved repo identity from filesystem path */
interface ResolvedRepo {
  repo_id: string;
  github_owner: string;
  github_repo: string;
}

/** MCP server configuration resolved at startup */
interface McpServerConfig {
  database_url: string;
  repo_path: string;             // --repo argument
  resolved_repo: ResolvedRepo;
  cache_ttl_seconds: number;     // default 60
  max_search_results: number;    // default 20
  stale_threshold_days: number;  // default 30
}

/** Internal representation of a doc section with aggregated claim data */
interface DocSection {
  file: string;
  section: string;               // heading or "Full Document" if no headings
  content: string;
  claims: ClaimWithResult[];
}

/** Claim joined with its latest verification result */
interface ClaimWithResult {
  claim_id: string;
  claim_text: string;
  claim_type: ClaimType;
  source_file: string;
  line_number: number;
  verification_status: Verdict | 'pending';
  last_verified_at: string | null;  // ISO 8601
  confidence: number | null;
  similarity?: number;              // populated only for semantic search results
}

/** In-memory cache entry */
interface CacheEntry<T> {
  data: T;
  expires_at: number;  // Date.now() + ttl
}

/** Database connection wrapper */
interface McpDbConnection {
  readonly client: PgClient;         // single pg.Client, NOT Pool
  readonly readOnly: boolean;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** CLI arguments parsed from process.argv */
interface CliArgs {
  repo: string;           // --repo <path>
  database_url?: string;  // --database-url <url> (override)
  verbose?: boolean;      // --verbose (debug logging to stderr)
}
```

---

## 4. Public API

Each MCP tool is specified as a function below. The MCP server also has lifecycle functions (startup, shutdown) that are documented first.

---

### 4.0 Server Lifecycle

#### 4.0.1 `startServer`

**Signature:**

```typescript
async function startServer(args: CliArgs): Promise<void>
```

**Algorithm:**
1. Parse CLI arguments from `process.argv` (Appendix B).
2. Resolve database URL via resolution chain: `args.database_url` -> `process.env.DOCALIGN_DATABASE_URL` -> `~/.docalign/config.json` -> error.
3. Resolve repo identity: read `.git/config` from `args.repo` to extract remote URL, parse `owner/repo`, query `repos` table for matching `github_owner` + `github_repo`. If no match, exit with error: "Repository not found in DocAlign database."
4. Create read-only `McpDbConnection` with `SET default_transaction_read_only = ON`.
5. If `report_drift` feature flag is enabled (v3), create a second writable `McpDbConnection`.
6. Initialize `McpServer` with name `"docalign"`, version from `package.json`.
7. Register all four tools via `server.tool()` with Zod schemas.
8. Create `NodeStdioServerTransport` and call `server.connect(transport)`.
9. Log startup info to stderr (MCP servers must NOT write to stdout -- it is reserved for the protocol).

**I/O Example 1 (success):**

```
Input:  npx @docalign/mcp-server --repo /home/dev/myproject
Output: (stderr) DocAlign MCP server started for myowner/myrepo (repo_id: abc-123)
        (stdio) MCP protocol messages begin flowing
```

**I/O Example 2 (repo not found):**

```
Input:  npx @docalign/mcp-server --repo /home/dev/unknown-project
Output: (stderr) Error: Repository not found in DocAlign database. Is the DocAlign GitHub App installed?
        (exit code 1)
```

**Negative Example (no database URL):**

```
Input:  npx @docalign/mcp-server --repo /home/dev/myproject
        (with no DOCALIGN_DATABASE_URL, no config file)
Output: (stderr) Error: No database URL configured. Set DOCALIGN_DATABASE_URL or run `docalign configure`.
        (exit code 1)
```

**Edge Cases:**
- `--repo` path does not contain `.git/` directory: exit with error "Not a git repository."
- Git remote has no `origin` remote: try all remotes in order; use first GitHub-hosted remote.
- Multiple repos in DB match the same `owner/repo`: use the one with the most recent `updated_at`.

**Error Handling:**
- Database connection failure at startup: exit with code 1 and descriptive message to stderr.
- Database connection drops after startup: tool handlers return MCP error `-32603` (internal error) with reconnect hint.

---

### 4.1 `get_docs`

**Signature:**

```typescript
async function handleGetDocs(
  params: GetDocsRequest,
  config: McpServerConfig,
  db: McpDbConnection
): Promise<GetDocsResponse>
```

**Algorithm:**
1. Validate `params.query` is non-empty string (Zod enforced by MCP SDK).
2. Check in-memory cache for key `get_docs:${hash(params)}`. If hit and not expired, return cached result.
3. Embed the query: look up the query embedding from `claims.embedding` column using pgvector cosine similarity search against all claims in the repo.
   - Note: The MCP server does NOT call an embedding API. Instead, it uses a text-based search approach: query claims using PostgreSQL full-text search on `claim_text` and `keywords`, combined with cosine similarity if the query can be matched to an existing claim's embedding as a proxy.
   - Revised approach (no LLM, no embedding API): Use PostgreSQL `ts_vector` full-text search on `claims.claim_text` combined with keyword matching on `claims.keywords`. If zero results from full-text search, fall back to `ILIKE '%' || query || '%'` on `claim_text`.
4. Filter claims by `repo_id = config.resolved_repo.repo_id`.
5. If `params.verified_only === true`, add filter: `verification_status = 'verified'`.
6. Limit results to `config.max_search_results` (default 20).
7. Group results by `source_file`. For each file, aggregate:
   - `section`: extract markdown heading from claim context (nearest `#` heading above the claim line). If none, use `"Full Document"`.
   - `content`: concatenate claim texts within the section (not full file content -- claims are the relevant excerpts).
   - `verification_status`: worst-case status across claims in the section (`drifted` > `uncertain` > `pending` > `verified`).
   - `last_verified`: most recent `last_verified_at` across claims in the section.
   - `claims_in_section`: count of claims in the section.
   - `verified_claims`: count of claims with `verification_status = 'verified'`.
   - `health_score`: `verified_claims / claims_in_section`.
8. Cache result with TTL `config.cache_ttl_seconds`.
9. Return `GetDocsResponse`.

**I/O Example 1 (topic search):**

```
Input:  { "query": "authentication" }
Output: {
  "sections": [
    {
      "file": "docs/auth.md",
      "section": "Password Hashing",
      "content": "Authentication uses argon2id with 64MB memory cost for password hashing.",
      "verification_status": "verified",
      "last_verified": "2026-02-07T14:23:00Z",
      "claims_in_section": 5,
      "verified_claims": 5,
      "health_score": 1.0
    },
    {
      "file": "README.md",
      "section": "Getting Started",
      "content": "Configure authentication by setting AUTH_SECRET in .env",
      "verification_status": "drifted",
      "last_verified": "2026-02-05T10:00:00Z",
      "claims_in_section": 3,
      "verified_claims": 1,
      "health_score": 0.33
    }
  ]
}
```

**I/O Example 2 (verified only):**

```
Input:  { "query": "API endpoints", "verified_only": true }
Output: {
  "sections": [
    {
      "file": "docs/api.md",
      "section": "User Endpoints",
      "content": "POST /api/v2/users creates a new user account.",
      "verification_status": "verified",
      "last_verified": "2026-02-10T09:00:00Z",
      "claims_in_section": 8,
      "verified_claims": 8,
      "health_score": 1.0
    }
  ]
}
```

**Negative Example (empty query):**

```
Input:  { "query": "" }
Output: MCP error { code: -32602, message: "query must be a non-empty string" }
```

**Edge Cases:**
- No claims match the query: return `{ "sections": [] }`. This is not an error.
- Query matches claims across many files (>20 claims): limit to `max_search_results`, ordered by relevance score descending.
- Claims with null embeddings (not yet embedded): included in full-text search results, excluded from semantic similarity ranking.
- Repo has zero claims (no scans have run): return empty sections with no error.

**Error Handling:**
- Database connection error: return MCP error `-32603` with message "Database connection error. Check DOCALIGN_DATABASE_URL."
- Query timeout (>5s): cancel query, return MCP error `-32603` with message "Query timed out. Try a more specific search."

---

### 4.2 `get_doc_health`

**Signature:**

```typescript
async function handleGetDocHealth(
  params: GetDocHealthRequest,
  config: McpServerConfig,
  db: McpDbConnection
): Promise<GetDocHealthResponse>
```

**Algorithm:**
1. Check in-memory cache for key `health:${params.path ?? 'repo'}`. If hit and not expired, return cached result.
2. If `params.path` is provided:
   a. If path ends with `/` (directory): query all claims where `source_file LIKE $path || '%'`.
   b. If path is a specific file: query all claims where `source_file = $path`.
   c. If no claims found for the path: return MCP error `-32000` with message "No documentation claims found for path '{path}'."
3. If `params.path` is omitted: query all claims for the repo.
4. For each claim, JOIN with the latest `verification_results` row (by `created_at DESC`).
5. Compute `HealthScore`:
   - `total_claims`: count of all claims in scope.
   - `verified`: count where `verification_status = 'verified'`.
   - `drifted`: count where `verification_status = 'drifted'`.
   - `uncertain`: count where `verification_status = 'uncertain'`.
   - `pending`: count where `verification_status = 'pending'`.
   - `score`: `verified / (verified + drifted)` if `(verified + drifted) > 0`, else `null`. Uncertain and pending are excluded from both numerator and denominator (matches L5 `calculateHealthScore` formula).
   - `by_file`: group by `source_file`, compute `FileHealth` per file.
   - `by_type`: count claims per `claim_type`.
   - `hotspots`: top 5 files ordered by `drifted` count descending.
6. Cache result with TTL `config.cache_ttl_seconds`.
7. Return `{ health: HealthScore }`.

**I/O Example 1 (specific file):**

```
Input:  { "path": "README.md" }
Output: {
  "health": {
    "total_claims": 12,
    "verified": 9,
    "drifted": 2,
    "uncertain": 1,
    "pending": 0,
    "score": 0.75,
    "by_file": {
      "README.md": { "total": 12, "verified": 9, "drifted": 2, "uncertain": 1 }
    },
    "by_type": {
      "path_reference": 4,
      "command": 3,
      "dependency_version": 2,
      "behavior": 2,
      "api_route": 1
    },
    "hotspots": ["README.md"]
  }
}
```

**I/O Example 2 (repo-wide):**

```
Input:  {}
Output: {
  "health": {
    "total_claims": 147,
    "verified": 120,
    "drifted": 15,
    "uncertain": 8,
    "pending": 4,
    "score": 0.84,
    "by_file": {
      "README.md": { "total": 12, "verified": 9, "drifted": 2, "uncertain": 1 },
      "docs/api.md": { "total": 45, "verified": 40, "drifted": 3, "uncertain": 2 },
      "docs/auth.md": { "total": 23, "verified": 22, "drifted": 1, "uncertain": 0 }
    },
    "by_type": {
      "path_reference": 35,
      "command": 20,
      "dependency_version": 18,
      "api_route": 25,
      "behavior": 30,
      "code_example": 10,
      "architecture": 5,
      "config": 2,
      "convention": 1,
      "environment": 1
    },
    "hotspots": ["docs/api.md", "README.md", "docs/deploy.md", "CONTRIBUTING.md", "docs/config.md"]
  }
}
```

**Negative Example (nonexistent path):**

```
Input:  { "path": "nonexistent/file.md" }
Output: MCP error { code: -32000, message: "No documentation claims found for path 'nonexistent/file.md'." }
```

**Edge Cases:**
- Directory path without trailing slash (e.g., `"docs"`): treat as directory prefix, same as `"docs/"`.
- Path matches both a file and a directory prefix: prefer the exact file match.
- All claims are `pending` (no scans have completed): return `score: null`, all counts accurate.
- Single claim in scope: `by_file` and `hotspots` still populated correctly.

**Error Handling:**
- Database connection error: MCP error `-32603`.
- Path contains path traversal attempts (`../`): sanitize and normalize before query. Do not expose filesystem paths.

---

### 4.3 `report_drift` (v3)

**Signature:**

```typescript
async function handleReportDrift(
  params: ReportDriftRequest,
  config: McpServerConfig,
  readDb: McpDbConnection,
  writeDb: McpDbConnection
): Promise<ReportDriftResponse>
```

**Algorithm:**
1. Validate required fields: `doc_file` (non-empty string), `claim_text` (non-empty string, max 2000 chars), `actual_behavior` (non-empty string, max 2000 chars).
2. Validate optional fields: `line_number` (positive integer if present), `evidence_files` (array of strings, max 20 items, each max 512 chars).
3. Attempt to match to an existing claim:
   a. Query `claims` where `repo_id = config.resolved_repo.repo_id AND source_file = params.doc_file`.
   b. If `params.line_number` is provided, find the closest claim by line number (within 5 lines).
   c. If no line-number match, use full-text similarity on `claim_text` to find the best match.
   d. If a match is found with confidence > 0.8, set `claim_id` to the matched claim's ID.
   e. If no match, set `claim_id = null` (the report is for a previously unknown claim).
4. Insert into `agent_drift_reports` table using the writable connection:
   ```sql
   INSERT INTO agent_drift_reports (
     repo_id, claim_id, doc_file, line_number, claim_text,
     actual_behavior, evidence_files, agent_type, verification_status
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
   RETURNING id;
   ```
   - `agent_type`: detect from MCP client metadata if available, else `'unknown'`.
5. Return `{ acknowledged: true, claim_id: report_id }`.

**I/O Example 1 (with line number):**

```
Input:  {
  "doc_file": "README.md",
  "line_number": 45,
  "claim_text": "Authentication uses bcrypt with 12 salt rounds",
  "actual_behavior": "The code in src/auth/password.ts imports argon2, not bcrypt",
  "evidence_files": ["src/auth/password.ts"]
}
Output: {
  "acknowledged": true,
  "claim_id": "rpt-abc123-def456"
}
```

**I/O Example 2 (no line number, new claim):**

```
Input:  {
  "doc_file": "docs/deploy.md",
  "claim_text": "Deploy using docker-compose up",
  "actual_behavior": "The project uses Kubernetes manifests in k8s/ directory, no docker-compose.yml exists"
}
Output: {
  "acknowledged": true,
  "claim_id": "rpt-xyz789-abc012"
}
```

**Negative Example (missing required field):**

```
Input:  {
  "doc_file": "README.md",
  "claim_text": "Some claim"
}
Output: MCP error { code: -32602, message: "actual_behavior is required" }
```

**Edge Cases:**
- `doc_file` does not exist in the claims database (never scanned): accept the report anyway. The file may be real but not yet indexed.
- `evidence_files` contains paths outside the repo: accept but log warning. The paths are informational, not validated.
- Multiple reports for the same claim in quick succession: each creates a separate `agent_drift_reports` row. Deduplication is a server-side concern when processing reports.
- `claim_text` exceeds 2000 characters: truncate to 2000 chars and accept.

**Error Handling:**
- Write connection not available (v2 mode, report_drift disabled): return MCP error `-32603` with message "Drift reporting is not available in this version. Upgrade to DocAlign v3."
- Database write failure: return MCP error `-32603` with message "Failed to record drift report. Please try again."
- Writable connection drops: attempt one reconnection. If that fails, return MCP error `-32603`.

---

### 4.4 `list_stale_docs`

**Signature:**

```typescript
async function handleListStaleDocs(
  params: ListStaleDocsRequest,
  config: McpServerConfig,
  db: McpDbConnection
): Promise<ListStaleDocsResponse>
```

**Algorithm:**
1. Resolve `max_results`: use `params.max_results` if provided (clamp to 1-100 range), else default 10.
2. Check in-memory cache for key `stale_docs:${max_results}`. If hit and not expired, return cached result.
3. Query claims grouped by `source_file`, aggregating:
   ```sql
   SELECT
     c.source_file AS file,
     COUNT(*) FILTER (WHERE c.verification_status = 'drifted') AS drifted_claims,
     COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') AS uncertain_claims,
     MAX(c.last_verified_at) AS last_verified
   FROM claims c
   WHERE c.repo_id = $repo_id
   GROUP BY c.source_file
   HAVING
     COUNT(*) FILTER (WHERE c.verification_status = 'drifted') > 0
     OR COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') > 0
     OR MAX(c.last_verified_at) < NOW() - INTERVAL '$stale_days days'
     OR MAX(c.last_verified_at) IS NULL
   ORDER BY
     COUNT(*) FILTER (WHERE c.verification_status = 'drifted') DESC,
     COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') DESC,
     MAX(c.last_verified_at) ASC NULLS FIRST
   LIMIT $max_results;
   ```
4. Format each row into `ListStaleDocsResponse.stale_docs[]` entry.
5. Cache result with TTL `config.cache_ttl_seconds`.
6. Return `ListStaleDocsResponse`.

**I/O Example 1 (default):**

```
Input:  {}
Output: {
  "stale_docs": [
    {
      "file": "docs/api.md",
      "drifted_claims": 3,
      "uncertain_claims": 1,
      "last_verified": "2026-02-01T10:00:00Z"
    },
    {
      "file": "README.md",
      "drifted_claims": 2,
      "uncertain_claims": 0,
      "last_verified": "2026-02-05T14:30:00Z"
    },
    {
      "file": "docs/deploy.md",
      "drifted_claims": 0,
      "uncertain_claims": 2,
      "last_verified": "2026-01-15T08:00:00Z"
    }
  ]
}
```

**I/O Example 2 (limited results):**

```
Input:  { "max_results": 1 }
Output: {
  "stale_docs": [
    {
      "file": "docs/api.md",
      "drifted_claims": 3,
      "uncertain_claims": 1,
      "last_verified": "2026-02-01T10:00:00Z"
    }
  ]
}
```

**Negative Example (max_results out of range):**

```
Input:  { "max_results": -5 }
Output: MCP error { code: -32602, message: "max_results must be between 1 and 100" }
```

**Edge Cases:**
- No stale docs (everything verified, nothing old): return `{ "stale_docs": [] }`. Not an error.
- All claims are `pending` (first scan not yet complete): every file with pending claims appears as stale (last_verified is null).
- Files where ALL claims are drifted appear first (highest priority for agent caution).
- `stale_threshold_days` config (default 30): files with `last_verified` older than this threshold AND zero drifted/uncertain claims are still included (they are stale by age).

**Error Handling:**
- Database connection error: MCP error `-32603`.
- Query timeout (unlikely with aggregation on small tables): cancel and return MCP error `-32603`.

---

## 5. Performance Targets

### 5.1 Response Time Targets

| Tool | Target p50 | Target p95 | Notes |
|------|-----------|-----------|-------|
| `get_docs` | < 200ms | < 500ms | Full-text search, no embedding API call |
| `get_doc_health` | < 100ms | < 300ms | Aggregation query on indexed columns |
| `list_stale_docs` | < 100ms | < 300ms | Aggregation query with HAVING filter |
| `report_drift` | < 200ms | < 500ms | Single INSERT + optional claim matching |

### 5.2 Scale Assumptions

| Metric | MVP Target |
|--------|-----------|
| Claims per repo | < 500 |
| Doc files per repo | < 50 |
| Concurrent MCP connections per machine | 1 (single process, single user) |
| Cache entries | < 100 (bounded by repo claim count) |

### 5.3 Resource Targets

| Resource | Target |
|----------|--------|
| Memory usage | < 50 MB (excluding Node.js baseline) |
| Database connections | 1 read-only (v2), + 1 writable (v3) |
| Startup time | < 2 seconds (including DB connection + repo resolution) |
| Cache memory | < 5 MB (in-memory Map with TTL eviction) |

### 5.4 Query Performance Guardrails

- All queries include `WHERE repo_id = $1` to leverage the `idx_claims_repo` index.
- Full-text search uses PostgreSQL `to_tsvector` / `to_tsquery` with `GIN` index on `claim_text`. If this index does not exist, fall back to `ILIKE` (slower but functional).
- The `get_docs` query has a `statement_timeout` of 5 seconds.
- All other queries have a `statement_timeout` of 3 seconds.
- Cache TTL of 60 seconds prevents repeated identical queries from hitting the database.

---

## 6. Required Framework Knowledge

### 6.1 MCP SDK (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`)

**Server setup pattern:**

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStdioServerTransport } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const server = new McpServer({
  name: 'docalign',
  version: '0.1.0'
});

// Tool registration uses Zod schemas for input validation
server.tool(
  'get_docs',
  {
    query: z.string().min(1).describe('What you want to know about'),
    verified_only: z.boolean().default(false).describe('Only return verified docs')
  },
  async ({ query, verified_only }, extra) => {
    const result = await handleGetDocs({ query, verified_only }, config, db);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  }
);

// stdio transport for local process spawning
const transport = new NodeStdioServerTransport();
await server.connect(transport);
```

**Key SDK behaviors:**
- `server.tool()` accepts a Zod schema as the second argument; the SDK handles JSON Schema generation and input validation automatically.
- Tool handlers return `{ content: Array<{ type: 'text', text: string }> }`. Structured data is JSON-serialized into the text field.
- The SDK handles JSON-RPC 2.0 framing, method routing, and error serialization.
- Errors thrown from tool handlers are caught by the SDK and returned as JSON-RPC errors.
- `NodeStdioServerTransport` reads from stdin, writes to stdout. All application logging MUST go to stderr.

### 6.2 PostgreSQL (`pg` client library)

**Single connection pattern (not pooled, per 3B-D4):**

```typescript
import { Client } from 'pg';

const client = new Client({ connectionString: databaseUrl });
await client.connect();

// Read-only mode for safety
await client.query('SET default_transaction_read_only = ON');
// Statement timeout to prevent runaway queries
await client.query('SET statement_timeout = 5000');  // 5 seconds
```

**Reconnection:** On connection error, attempt one reconnect with 2-second delay. If reconnect fails, the tool handler returns an MCP error. The MCP server process stays alive (the agent can retry the tool call).

### 6.3 pgvector Full-Text Search

The MCP server does NOT call embedding APIs. For `get_docs` search, it relies on PostgreSQL full-text search:

```sql
-- Full-text search on claim_text
SELECT *, ts_rank(to_tsvector('english', claim_text), plainto_tsquery('english', $query)) AS rank
FROM claims
WHERE repo_id = $repo_id
  AND to_tsvector('english', claim_text) @@ plainto_tsquery('english', $query)
ORDER BY rank DESC
LIMIT $max_results;
```

Fallback when full-text search returns zero results:

```sql
-- Keyword fallback using ILIKE
SELECT *
FROM claims
WHERE repo_id = $repo_id
  AND (claim_text ILIKE '%' || $query || '%' OR $query = ANY(keywords))
ORDER BY last_verified_at DESC NULLS LAST
LIMIT $max_results;
```

### 6.4 Git Remote URL Parsing

Repo identity resolution from `.git/config`:

```typescript
// Parse git remote URL to extract owner/repo
// Handles: https://github.com/owner/repo.git
//          git@github.com:owner/repo.git
//          ssh://git@github.com/owner/repo.git
function parseGitRemoteUrl(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return null;
}
```

---

## 7. Open Questions

### OQ-1: Semantic Search Without Embedding API

**Question:** The current design uses full-text search for `get_docs` because the MCP server cannot call embedding APIs (zero LLM calls constraint). Should we support an optional mode where the user provides an embedding API key to the MCP server for higher-quality semantic search?

**Impact:** Low for MVP. Full-text search on claim_text + keywords provides reasonable results for targeted queries. Semantic search would improve recall for vague queries ("how does the system handle errors").

**Proposed resolution:** Defer to v3. Full-text search is sufficient for v2. If user feedback indicates poor search quality, add optional embedding API support via `~/.docalign/config.json` `embedding_api_key` field.

### OQ-2: Section Extraction Heuristic

**Question:** The `get_docs` tool groups claims by "section" (nearest markdown heading). This requires reading the original doc file content from the filesystem or storing section headers alongside claims. The current claims table does not store section information.

**Impact:** Medium. Without section grouping, results are grouped only by file, which is less useful for large docs.

**Proposed resolution:** For v2, group by file only. Add `section_heading` column to `claims` table in v3 (populated during extraction by L1). For now, the `section` field in the response is set to the filename without path (e.g., `"auth.md"`).

### OQ-3: Cache Invalidation on Scan Completion

**Question:** The in-memory cache has a fixed TTL (60s). If a scan completes and updates claim statuses, the MCP server's cache may serve stale results for up to 60 seconds.

**Impact:** Low. Scans happen infrequently (on PR push). A 60-second delay is acceptable. The agent can re-query if results seem stale.

**Proposed resolution:** Accept the 60-second staleness window for v2. For v3, consider PostgreSQL `LISTEN/NOTIFY` to invalidate cache on scan completion, or reduce TTL to 30 seconds.

### OQ-4: Full-Text Search Index Migration

**Question:** The claims table does not currently have a GIN index on `to_tsvector('english', claim_text)`. This index is needed for efficient full-text search.

**Impact:** High for performance. Without the index, full-text search does a sequential scan on the claims table.

**Proposed resolution:** Add the GIN index in the same migration that creates the MCP-related infrastructure. Migration SQL:

```sql
CREATE INDEX idx_claims_fulltext ON claims
  USING GIN (to_tsvector('english', claim_text));
```

This is a new index on an existing table. It is additive and backwards-compatible with existing migrations.

---

## Appendix A: MCP Tool Definitions (JSON Schema)

These are the canonical JSON schemas for each MCP tool, matching the format required by the MCP protocol specification. The SDK generates these from Zod schemas, but they are documented here as the contract.

### A.1 `get_docs`

```json
{
  "name": "get_docs",
  "description": "Search project documentation for information about a topic. Returns relevant documentation sections with verification status indicating whether the content is confirmed accurate, potentially stale, or uncertain.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "description": "What you want to know about (e.g., 'authentication', 'API endpoints', 'deployment process')"
      },
      "verified_only": {
        "type": "boolean",
        "default": false,
        "description": "If true, only return documentation that has been verified as accurate. Default: false."
      }
    },
    "required": ["query"]
  }
}
```

### A.2 `get_doc_health`

```json
{
  "name": "get_doc_health",
  "description": "Check the freshness/accuracy status of a specific documentation file or the entire repo. Use this before relying on documentation that might be outdated.",
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

### A.3 `report_drift` (v3)

```json
{
  "name": "report_drift",
  "description": "Report a suspected documentation inaccuracy you discovered while working with the code. This helps keep documentation fresh.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "doc_file": {
        "type": "string",
        "minLength": 1,
        "description": "The documentation file containing the inaccurate claim"
      },
      "line_number": {
        "type": "integer",
        "minimum": 1,
        "description": "Approximate line number of the claim"
      },
      "claim_text": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000,
        "description": "The text of the inaccurate claim"
      },
      "actual_behavior": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000,
        "description": "What the code actually does (your evidence)"
      },
      "evidence_files": {
        "type": "array",
        "items": { "type": "string", "maxLength": 512 },
        "maxItems": 20,
        "description": "Code files that show the actual behavior"
      }
    },
    "required": ["doc_file", "claim_text", "actual_behavior"]
  }
}
```

### A.4 `list_stale_docs`

```json
{
  "name": "list_stale_docs",
  "description": "List documentation files that have known inaccuracies or haven't been verified recently. Useful before starting work to know which docs to be cautious about.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "max_results": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 10,
        "description": "Maximum number of results to return. Default: 10."
      }
    }
  }
}
```

---

## Appendix B: Connection Config

### B.1 CLI Arguments

```
Usage: npx @docalign/mcp-server [options]

Options:
  --repo <path>           Path to the git repository (required)
  --database-url <url>    PostgreSQL connection string (overrides env/config)
  --verbose               Enable debug logging to stderr
  --version               Print version and exit
  --help                  Print usage and exit
```

**Parsing:** Use `process.argv` directly (no dependency on a CLI framework for a 4-argument parser).

### B.2 Database URL Resolution Chain

Resolution order (first match wins):

1. `--database-url` CLI argument
2. `DOCALIGN_DATABASE_URL` environment variable
3. `~/.docalign/config.json` field `database_url`
4. Error: "No database URL configured."

```typescript
interface DocalignUserConfig {
  database_url?: string;
  // Future: embedding_api_key, default_repo, etc.
}

const CONFIG_DIR = path.join(os.homedir(), '.docalign');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
```

### B.3 Connection Parameters

**Read-only connection (v2, all tools except report_drift):**

```typescript
const readClient = new Client({
  connectionString: databaseUrl,
  // Single connection, not pooled (3B-D4)
  application_name: 'docalign-mcp',
  statement_timeout: 5000,        // 5s default, overridden per-query where needed
  query_timeout: 10000,           // 10s hard limit
  connectionTimeoutMillis: 5000,  // 5s connection timeout
});

// After connect:
await readClient.query('SET default_transaction_read_only = ON');
```

**Writable connection (v3, report_drift only):**

```typescript
const writeClient = new Client({
  connectionString: databaseUrl,
  application_name: 'docalign-mcp-write',
  statement_timeout: 5000,
  query_timeout: 10000,
  connectionTimeoutMillis: 5000,
});

// No SET default_transaction_read_only -- this connection can write
```

### B.4 Repo Identity Resolution

```typescript
async function resolveRepo(
  repoPath: string,
  db: McpDbConnection
): Promise<ResolvedRepo> {
  // 1. Find .git directory
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  // 2. Read git remote URL
  const gitConfigPath = path.join(gitDir, 'config');
  const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
  const remoteUrl = extractRemoteUrl(gitConfig); // parse [remote "origin"] url = ...

  // 3. Parse owner/repo from URL
  const parsed = parseGitRemoteUrl(remoteUrl);
  if (!parsed) {
    throw new Error(`Could not parse GitHub owner/repo from remote URL: ${remoteUrl}`);
  }

  // 4. Look up in repos table
  const rows = await db.query<RepoRow>(
    'SELECT * FROM repos WHERE github_owner = $1 AND github_repo = $2 ORDER BY updated_at DESC LIMIT 1',
    [parsed.owner, parsed.repo]
  );

  if (rows.length === 0) {
    throw new Error(
      `Repository ${parsed.owner}/${parsed.repo} not found in DocAlign database. ` +
      'Is the DocAlign GitHub App installed for this repo?'
    );
  }

  return {
    repo_id: rows[0].id,
    github_owner: rows[0].github_owner,
    github_repo: rows[0].github_repo,
  };
}
```

---

## Appendix C: Caching Strategy

### C.1 Cache Design

The MCP server uses a simple in-memory `Map<string, CacheEntry<unknown>>` for caching query results. This is appropriate because:
- Single-user, single-process: no cache coherence concerns.
- Small data volume: at MVP scale (<500 claims), all cache entries fit easily in memory.
- Short TTL (60s): staleness window is acceptable for documentation health queries.

### C.2 Cache Keys

| Tool | Cache Key Pattern | TTL |
|------|------------------|-----|
| `get_docs` | `get_docs:${sha256(JSON.stringify(params))}` | 60s |
| `get_doc_health` | `health:${params.path ?? 'repo'}` | 60s |
| `list_stale_docs` | `stale_docs:${max_results}` | 60s |
| `report_drift` | Not cached (write operation) | N/A |

### C.3 Cache Eviction

- **TTL-based:** Each entry has an `expires_at` timestamp. On read, check if expired and evict.
- **Size-based:** If cache grows beyond 200 entries, evict the 100 oldest entries (by `expires_at`). This is a safety valve, not expected in normal operation.
- **Manual invalidation:** No manual invalidation in v2. Cache entries naturally expire.

### C.4 Implementation

```typescript
class SimpleCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries = 200;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires_at) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    if (this.store.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.store.set(key, { data, expires_at: Date.now() + ttlSeconds * 1000 });
  }

  private evictOldest(): void {
    const entries = [...this.store.entries()]
      .sort((a, b) => a[1].expires_at - b[1].expires_at);
    const toRemove = entries.slice(0, Math.floor(this.maxEntries / 2));
    for (const [key] of toRemove) {
      this.store.delete(key);
    }
  }
}
```

---

## Appendix D: Error Code Mapping

MCP errors follow JSON-RPC 2.0 conventions. DocAlign-specific errors are mapped as follows:

| Condition | JSON-RPC Error Code | Message Template |
|-----------|-------------------|-----------------|
| Missing required parameter | `-32602` | `"{param} is required"` |
| Invalid parameter value | `-32602` | `"{param} must be {constraint}"` |
| Database connection failure | `-32603` | `"Database connection error. Check DOCALIGN_DATABASE_URL."` |
| Database query timeout | `-32603` | `"Query timed out. Try a more specific search."` |
| Database query error | `-32603` | `"Internal database error."` |
| Repo not found in DB | `-32000` | `"Repository not found in DocAlign database."` |
| No claims for path | `-32000` | `"No documentation claims found for path '{path}'."` |
| Write not available (v2) | `-32603` | `"Drift reporting is not available in this version."` |

**Error response format (per MCP spec):**

```typescript
// The MCP SDK handles serialization. Tool handlers throw McpError instances.
import { McpError, ErrorCode } from '@modelcontextprotocol/server';

throw new McpError(ErrorCode.InvalidParams, 'query must be a non-empty string');
throw new McpError(ErrorCode.InternalError, 'Database connection error.');
```

---

## Appendix E: File Structure

```
src/layers/L6-mcp/
  server.ts          # startServer(), CLI parsing, McpServer setup, transport init
  tools.ts           # Tool registration (Zod schemas + handler wiring)
  handlers.ts        # handleGetDocs, handleGetDocHealth, handleReportDrift, handleListStaleDocs
  queries.ts         # SQL query builders for each tool
  repo-resolver.ts   # Git remote parsing, repo identity resolution
  db-connection.ts   # McpDbConnection wrapper, reconnection logic
  cache.ts           # SimpleCache implementation
  config.ts          # CliArgs parsing, database URL resolution, McpServerConfig
```

**Package entry point:**

```json
{
  "name": "@docalign/mcp-server",
  "bin": {
    "docalign-mcp": "./dist/layers/L6-mcp/server.js"
  }
}
```

---

## Appendix F: SQL Queries Reference

### F.1 get_docs -- Full-Text Search

```sql
-- Primary: full-text search
SELECT
  c.id AS claim_id,
  c.claim_text,
  c.claim_type,
  c.source_file,
  c.line_number,
  c.verification_status,
  c.last_verified_at,
  ts_rank(to_tsvector('english', c.claim_text), plainto_tsquery('english', $2)) AS rank
FROM claims c
WHERE c.repo_id = $1
  AND to_tsvector('english', c.claim_text) @@ plainto_tsquery('english', $2)
ORDER BY rank DESC
LIMIT $3;
```

```sql
-- Fallback: ILIKE keyword search
SELECT
  c.id AS claim_id,
  c.claim_text,
  c.claim_type,
  c.source_file,
  c.line_number,
  c.verification_status,
  c.last_verified_at
FROM claims c
WHERE c.repo_id = $1
  AND (c.claim_text ILIKE '%' || $2 || '%' OR $2 = ANY(c.keywords))
ORDER BY c.last_verified_at DESC NULLS LAST
LIMIT $3;
```

### F.2 get_doc_health -- Aggregation

```sql
-- File-level health (specific file or repo-wide)
SELECT
  c.source_file,
  c.claim_type,
  c.verification_status,
  COUNT(*) AS count
FROM claims c
WHERE c.repo_id = $1
  AND ($2 IS NULL OR c.source_file = $2 OR c.source_file LIKE $2 || '%')
GROUP BY c.source_file, c.claim_type, c.verification_status;
```

### F.3 list_stale_docs -- Staleness Query

```sql
SELECT
  c.source_file AS file,
  COUNT(*) FILTER (WHERE c.verification_status = 'drifted') AS drifted_claims,
  COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') AS uncertain_claims,
  MAX(c.last_verified_at) AS last_verified
FROM claims c
WHERE c.repo_id = $1
GROUP BY c.source_file
HAVING
  COUNT(*) FILTER (WHERE c.verification_status = 'drifted') > 0
  OR COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') > 0
  OR MAX(c.last_verified_at) < NOW() - INTERVAL '1 day' * $2
  OR MAX(c.last_verified_at) IS NULL
ORDER BY
  COUNT(*) FILTER (WHERE c.verification_status = 'drifted') DESC,
  COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') DESC,
  MAX(c.last_verified_at) ASC NULLS FIRST
LIMIT $3;
```

### F.4 report_drift -- Claim Matching

```sql
-- Match by line proximity
SELECT id, claim_text, line_number,
  ABS(line_number - $3) AS line_distance
FROM claims
WHERE repo_id = $1
  AND source_file = $2
  AND ABS(line_number - $3) <= 5
ORDER BY line_distance ASC
LIMIT 1;
```

```sql
-- Match by text similarity (fallback)
SELECT id, claim_text,
  similarity(claim_text, $3) AS sim
FROM claims
WHERE repo_id = $1
  AND source_file = $2
  AND similarity(claim_text, $3) > 0.3
ORDER BY sim DESC
LIMIT 1;
```

Note: The `similarity()` function requires the `pg_trgm` extension. If not available, fall back to exact substring match.

### F.5 report_drift -- Insert

```sql
INSERT INTO agent_drift_reports (
  id, repo_id, claim_id, doc_file, line_number,
  claim_text, actual_behavior, evidence_files,
  agent_type, verification_status, created_at
) VALUES (
  gen_random_uuid(), $1, $2, $3, $4,
  $5, $6, $7,
  $8, 'pending', NOW()
)
RETURNING id;
```

### F.6 Required Index (Migration)

```sql
-- Full-text search index for MCP get_docs tool
CREATE INDEX CONCURRENTLY idx_claims_fulltext
  ON claims USING GIN (to_tsvector('english', claim_text));

-- Trigram similarity index for report_drift claim matching (requires pg_trgm)
CREATE INDEX CONCURRENTLY idx_claims_trgm
  ON claims USING GIN (claim_text gin_trgm_ops);
```
