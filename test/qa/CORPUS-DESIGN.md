# QA Corpus Design — DocAlign Accuracy Testing System

**Status:** Spec complete. Implementation pending.
**Purpose:** Defines the end-to-end testing system for measuring and preventing false positives and false negatives in the DocAlign pipeline.

---

## 1. Problem Statement

DocAlign has been validated only against its own repository. Before shipping, the system needs a repeatable, CI-integrated mechanism that answers three questions on every pull request:

1. Does the pipeline report drift where there is none? (**false positives**)
2. Does the pipeline miss drift that exists? (**false negatives — wrong verdict**)
3. Does the pipeline fail to extract claims that exist in documents? (**false negatives — missed extraction**)

These are distinct failure modes with different root causes and different testing strategies. A test suite that only checks one cannot give confidence about the others.

---

## 2. Error Taxonomy

### 2.1 False Positives (FP)

The system reports a claim as `drifted` when it is actually `verified`.

**Root cause:** The extraction, mapping, or verification layer incorrectly characterises a match failure as drift.

**Test strategy:** Run the full pipeline on a corpus where all claims are known to be in sync. Assert zero drifted findings.

### 2.2 False Negatives — Wrong Verdict (FN Type 1)

A claim is extracted and mapped correctly, but the verifier returns `verified` when the code has actually drifted from the documentation.

**Root cause:** The verification logic (L3 Tier 1/2 for syntactic, sidecar assertions for semantic) fails to detect a real change.

**Test strategy:** Apply a known mutation to the code, run the pipeline, assert the expected finding appears.

### 2.3 False Negatives — Missed Extraction (FN Type 2)

A claim that exists in the documentation is never extracted. It never enters the pipeline and is therefore never verified.

**Root cause:** The L1 extractor (regex for syntactic, P-EXTRACT for semantic) fails to identify a claim.

**Test strategy:** Run the extract step with recorded LLM responses and assert the output tags match a stored snapshot. Any missing tag is a regression.

---

## 3. How the Inline Tag System Affects Testing

DocAlign's `docalign extract` step (described in `_team/docs/false-positive-analysis.md`) runs Claude once per document file and writes inline HTML comment tags into the document:

- `<!-- docalign:skip -->` — examples, instructions, historical content. Extractors ignore these regions.
- `<!-- docalign:check type="..." -->` — deterministic claims (paths, versions, commands, routes). Regex extractors verify these.
- `<!-- docalign:semantic claim="..." id="..." -->` — semantic claims. Verified via evidence assertions stored in `.docalign/semantic/claims.json` (the sidecar).

**Critical property:** once the sidecar is committed, semantic verification is fully deterministic. The sidecar stores concrete grep-style evidence assertions (`{ pattern, scope, expect }`). The L3 verifier evaluates these assertions against the current code without calling the LLM. The LLM's role ends at extraction time.

This means:

| Track | LLM required? | Why |
|---|---|---|
| Track 1 (zero-finding gate) | No | Uses pre-tagged corpus with committed sidecar |
| Track 2 (mutation gate) | No | Same pre-tagged corpus + deterministic mutations |
| Track 3 (extract snapshot) | Via recording | Tests the extract step itself using replayed fixtures |
| Track 4 (cold-start gate) | Via recording | Tests full pipeline from untagged input |

Tracks 1 and 2 are completely deterministic, including for semantic claims. Tracks 3 and 4 replay pre-recorded Claude API responses stored as fixture files in the corpus. No live API key is required in CI.

---

## 4. System Architecture: Four Tracks

All four tracks run on every pull request. Total CI budget: under 90 seconds.

### Track 1 — Zero-Finding Gate

**Input:** `tagged/` state of the corpus (docs with inline tags, committed sidecar).
**Operation:** Run the full `check` pipeline (L0 index → L1 extract from tags → L2 map → L3 verify).
**Assertion:** Zero drifted findings.
**Failure means:** The pipeline reports drift on known-good content. A false positive has been introduced.

### Track 2 — Mutation Gate

**Input:** `tagged/` state + one mutation applied in memory.
**Operation:** Same check pipeline as Track 1.
**Assertion:** Exactly the expected findings appear (no more, no fewer).
**Failure means:** Either (a) an expected finding is missing — FN Type 1 regression — or (b) an unexpected finding appears — FP regression introduced by the mutation logic.

Each mutation in the mutation library produces one test case. Adding a mutation file automatically adds a test case with no code changes.

### Track 3 — Extract Snapshot

**Input:** `untagged/` state (raw docs, no tags, no sidecar).
**Operation:** Run `docalign extract` with LLM responses served from `llm-fixtures.json`.
**Assertion:** The tags written to documents match the stored Vitest snapshot.
**Failure means:** A change to the P-EXTRACT prompt or the extraction logic has altered what gets tagged. Human review required before the snapshot can be updated.

Update command: `npm run corpus:record -- --update` (requires `ANTHROPIC_API_KEY`).

### Track 4 — Cold-Start Gate

**Input:** `untagged/` state + one mutation applied in memory.
**Operation:** Full pipeline including extract (LLM via fixtures), then check.
**Assertion:** Expected findings appear after each mutation.
**Failure means:** The end-to-end pipeline from a raw project fails to detect a known drift. Tests the system as a first-time user experiences it.

---

## 5. The Corpus Runner

The corpus runner is the shared infrastructure for all four tracks. It is a single function that takes a corpus path and options, creates a real in-memory SQLite database, runs real migrations, and executes real pipeline service classes. No mocks of business logic.

The only injected boundary is the LLM client — replaced with a fixture client for Tracks 3 and 4.

### 5.1 Interface

```typescript
// test/corpus/runner.ts

export interface RunOptions {
  preTags: boolean;          // true = skip extract, load tagged/ state
  llmFixtures?: string;      // path to llm-fixtures.json (Tracks 3 & 4)
  mutations?: MutationDef[]; // applied as in-memory file content patches
}

export interface RunResult {
  findings: Finding[];
  claimsExtracted: number;
  claimsVerified: number;
  tags?: TagSnapshot;        // populated when preTags: false (Tracks 3 & 4)
}

export async function runCorpus(
  corpusPath: string,
  opts: RunOptions
): Promise<RunResult>
```

### 5.2 Internal Steps

1. Create in-memory SQLite database, run all migrations.
2. Load corpus files from `tagged/` or `untagged/` depending on `opts.preTags`.
3. Apply mutations to in-memory file content (no disk writes).
4. Run L0 indexer on code files.
5. If `preTags: false`: run extract step with injected LLM client (real or fixture).
6. Run L1 extractor on (possibly newly tagged) doc files.
7. Run L2 mapper.
8. Run L3 verifier.
9. Collect and return findings.

### 5.3 Mutation Application

Mutations patch in-memory file content before the pipeline runs. Supported operations:

- `delete_line_matching` — remove the first line containing the given pattern.
- `replace_line_matching` — replace the first line containing `find` with `replace`.
- `rename_file` — change the path of a file in the in-memory file map (simulates `git mv`).
- `delete_file` — remove a file from the in-memory file map.
- `set_json_field` — set a specific JSON path value (e.g. `dependencies.express` in `package.json`).

### 5.4 LLM Fixture Client

When `llmFixtures` is provided, the LLM client reads from `llm-fixtures.json` instead of calling the API. The fixture file is a map from document file path to recorded Claude response:

```json
{
  "README.md": { "tags": [...], "semantic_claims": [...] },
  "docs/guides/mcp.md": { "tags": [...], "semantic_claims": [...] }
}
```

The fixture client is deterministic and requires no network access. It raises an error if a fixture is missing for a requested file (prevents silent fallback to real API in CI).

---

## 6. The synthetic-node Corpus

### 6.1 Project Concept

**Name:** Taskflow API
**Stack:** Express, TypeScript, PostgreSQL, pino, zod, jsonwebtoken, bcrypt
**Shape:** REST API for task management with a service layer, event system, and MCP server

The project is designed so that every claim in its documentation has a clear, inspectable code target. It is realistic enough to surface real-world extraction and verification challenges (example tables, instructional content, MCP tool schemas, prerequisite versions).

### 6.2 Directory Layout

```
test/fixtures/corpora/synthetic-node/
├── untagged/                        ← raw project, no docalign tags, no sidecar
│   ├── README.md
│   ├── CONTRIBUTING.md
│   ├── CHANGELOG.md
│   ├── docs/
│   │   ├── guides/
│   │   │   ├── getting-started.md
│   │   │   ├── configuration.md
│   │   │   ├── deployment.md
│   │   │   ├── mcp.md
│   │   │   └── claude-code.md
│   │   ├── api/
│   │   │   ├── overview.md
│   │   │   ├── users.md
│   │   │   ├── tasks.md
│   │   │   └── errors.md
│   │   └── architecture/
│   │       ├── overview.md
│   │       ├── middleware.md
│   │       └── services.md
│   ├── src/
│   │   ├── index.ts
│   │   ├── config/
│   │   │   └── index.ts
│   │   ├── routes/
│   │   │   ├── users.ts
│   │   │   └── tasks.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rateLimit.ts
│   │   │   ├── logger.ts
│   │   │   └── errorHandler.ts
│   │   ├── services/
│   │   │   ├── UserService.ts
│   │   │   ├── TaskService.ts
│   │   │   └── NotificationService.ts
│   │   ├── events/
│   │   │   └── emitter.ts
│   │   ├── db/
│   │   │   └── client.ts
│   │   └── mcp/
│   │       └── server.ts
│   ├── .claude/
│   │   ├── mcp.json
│   │   └── agents/
│   │       └── taskflow.md
│   ├── package.json
│   ├── tsconfig.json
│   ├── docker-compose.yml
│   └── .env.example
│
├── tagged/                          ← produced by corpus:tag, committed after review
│   └── (same structure + inline docalign tags + .docalign/semantic/claims.json)
│
├── mutations/                       ← one JSON file per mutation
│   ├── det-001-bump-express.json
│   ├── det-002-bump-zod.json
│   ├── ...
│   └── sem-auto-*.json              ← auto-generated from sidecar, do not edit manually
│
├── llm-fixtures.json                ← recorded Claude responses, produced by corpus:record
└── expected/
    └── cold-start-clean.json        ← expected findings for Track 4 on clean state (should be [])
```

### 6.3 Code File Blueprints

Each code file must implement exactly what the documentation claims about it. These are the minimum requirements; additional realistic code is encouraged.

**`src/index.ts`**
- Import and register middleware in this exact order: logger, auth (on protected routes), rateLimit, routes, errorHandler
- Mount all routes under `/api/v1`
- Read port from `config/index.ts`, default to 3000
- Set `express.json()` middleware (content-type application/json)

**`src/config/index.ts`**
- Export a config object reading: `PORT` (default 3000), `DATABASE_URL` (required), `JWT_SECRET` (required), `RATE_LIMIT_MAX` (default 100)
- All env vars must be read in this file (central config module)

**`src/routes/users.ts`**
- Register: `GET /api/v1/users`, `GET /api/v1/users/:id`, `POST /api/v1/users`, `PATCH /api/v1/users/:id`, `DELETE /api/v1/users/:id`
- `POST /api/v1/users` must call `res.status(201)` on success
- Use `UserService.createUser({ name, email })` — function name and parameter shape must match doc claims

**`src/routes/tasks.ts`**
- Register: `GET /api/v1/tasks`, `POST /api/v1/tasks`, `PATCH /api/v1/tasks/:id`, `DELETE /api/v1/tasks/:id`
- All task queries must be scoped to `req.user.id` (authenticated user)

**`src/middleware/auth.ts`**
- Import `jsonwebtoken`
- Sign tokens with `expiresIn: '24h'`
- On valid token: attach decoded payload to `req.user`
- On missing/invalid token: respond with `401 Unauthorized`
- Read secret from `process.env.JWT_SECRET`

**`src/middleware/rateLimit.ts`**
- Configure: `max: 100`, `windowMs: 15 * 60 * 1000`
- Read max from `process.env.RATE_LIMIT_MAX` with fallback to 100

**`src/middleware/logger.ts`**
- Import `pino` (version must be 8.15.0 in package.json)
- Attach `requestId` (generated per request) and `duration` (ms) to every log line

**`src/middleware/errorHandler.ts`**
- Must be the last middleware registered in `src/index.ts`
- Respond with `{ code: string, message: string, details?: unknown }` shape

**`src/services/UserService.ts`**
- Export `createUser({ name, email })` function (name must match exactly)
- Import `bcrypt`, use cost factor 12: `bcrypt.hash(password, 12)`

**`src/services/TaskService.ts`**
- Import `emitter` from `src/events/emitter.ts`
- When a task status is set to `done`: emit `task.completed` event

**`src/services/NotificationService.ts`**
- Import `emitter` from `src/events/emitter.ts`
- Subscribe to `task.completed` event on construction/init

**`src/events/emitter.ts`**
- Export a singleton `EventEmitter` instance

**`src/db/client.ts`**
- Read `process.env.DATABASE_URL`
- Export a database client/pool

**`src/mcp/server.ts`**
- Register exactly 4 tools using the MCP SDK: `get_tasks`, `create_task`, `complete_task`, `get_users`
- `create_task` schema: `title` (string, required), `assigneeId` (string, optional) — use Zod
- `complete_task` implementation: call `TaskService` to set status to `done`, which emits `task.completed`
- Import and reuse `src/db/client.ts` (shared database connection)

**`.claude/mcp.json`**
- Configure the MCP server pointing to `src/mcp/server.ts`
- Include `cwd` field set to the repository root (scoped to current repo)

**`.claude/agents/taskflow.md`**
- Agent definition listing all 4 MCP tools in its allowed tools section
- Triggered by `/taskflow` command

**`package.json`**
- `dependencies`: `express@4.18.2`, `zod@3.22.0`, `pino@8.15.0`, `jsonwebtoken`, `bcrypt`
- `scripts`: `dev`, `build`, `test`, `lint`, `typecheck`, `migrate`

### 6.4 Full Claim Inventory

58 claims across 15 documentation files.

#### README.md (6 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C01 | dep_version | `express@4.18.2` | `package.json` dependencies |
| C02 | dep_version | `zod@3.22.0` | `package.json` dependencies |
| C03 | command | `npm run dev` | `package.json` scripts |
| C04 | path_reference | `src/config/index.ts` | file existence |
| C05 | semantic | "JWT authentication, rate limiting, and structured logging included" | `src/middleware/auth.ts`, `rateLimit.ts`, `logger.ts` existence + imports |
| C06 | semantic | "Server runs on port 3000 by default" | `src/config/index.ts` PORT default |

#### docs/guides/getting-started.md (3 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C07 | command | `npm run build` | `package.json` scripts |
| C08 | command | `npm run dev` | `package.json` scripts |
| C09 | path_reference | `.env.example` | file existence |

#### docs/guides/configuration.md (6 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C10 | env_var | `DATABASE_URL` (required) | `src/db/client.ts` reads `process.env.DATABASE_URL` |
| C11 | env_var | `JWT_SECRET` (required) | `src/middleware/auth.ts` reads `process.env.JWT_SECRET` |
| C12 | env_var | `PORT` default `3000` | `src/config/index.ts` |
| C13 | env_var | `RATE_LIMIT_MAX` default `100` | `src/middleware/rateLimit.ts` |
| C14 | path_reference | `src/config/index.ts` is the central config module | file existence |
| C15 | semantic | "All env vars have documented defaults except DATABASE_URL and JWT_SECRET" | `src/config/index.ts` — only those two have no default |

#### docs/guides/deployment.md (3 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C16 | command | `docker compose up -d` | `docker-compose.yml` existence |
| C17 | command | `npm run migrate` | `package.json` scripts |
| C18 | path_reference | Build output in `dist/` | `tsconfig.json` `outDir: "dist"` |

#### docs/api/overview.md (4 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C19 | semantic | "All endpoints prefixed with `/api/v1`" | route mount point in `src/index.ts` |
| C20 | semantic | "All responses are `application/json`" | `express.json()` in `src/index.ts` |
| C21 | semantic | "Unauthenticated requests receive `401 Unauthorized`" | `src/middleware/auth.ts` |
| C22 | semantic | "Rate limit: 100 requests per 15 minutes per IP" | `src/middleware/rateLimit.ts` config |

#### docs/api/users.md (7 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C23 | api_route | `GET /api/v1/users` | `src/routes/users.ts` |
| C24 | api_route | `GET /api/v1/users/:id` | `src/routes/users.ts` |
| C25 | api_route | `POST /api/v1/users` | `src/routes/users.ts` |
| C26 | api_route | `PATCH /api/v1/users/:id` | `src/routes/users.ts` |
| C27 | api_route | `DELETE /api/v1/users/:id` | `src/routes/users.ts` |
| C28 | semantic | "`POST /api/v1/users` returns `201 Created` with user object" | `res.status(201)` in `src/routes/users.ts` |
| C29 | code_example | `createUser({ name, email })` function signature | `UserService.createUser` in `src/services/UserService.ts` |

#### docs/api/tasks.md (5 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C30 | api_route | `GET /api/v1/tasks` | `src/routes/tasks.ts` |
| C31 | api_route | `POST /api/v1/tasks` | `src/routes/tasks.ts` |
| C32 | api_route | `PATCH /api/v1/tasks/:id` | `src/routes/tasks.ts` |
| C33 | api_route | `DELETE /api/v1/tasks/:id` | `src/routes/tasks.ts` |
| C34 | semantic | "Tasks are scoped to the authenticated user" | `req.user.id` used in task queries in `src/routes/tasks.ts` |

#### docs/api/errors.md (2 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C35 | code_example | Error shape: `{ code: string, message: string, details?: unknown }` | `src/middleware/errorHandler.ts` response format |
| C36 | path_reference | `src/middleware/errorHandler.ts` centralises all error handling | file existence |

#### docs/architecture/overview.md (3 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C37 | semantic | "Request pipeline: Logger → Auth → RateLimit → Route Handler → ErrorHandler" | middleware registration order in `src/index.ts` |
| C38 | path_reference | `src/services/` contains all business logic | directory existence |
| C39 | semantic | "Notifications use an event-driven model via `src/events/emitter.ts`" | `src/events/emitter.ts` usage in `TaskService` and `NotificationService` |

#### docs/architecture/middleware.md (4 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C40 | dep_version | `pino@8.15.0` | `package.json` dependencies |
| C41 | semantic | "Logger middleware attaches `requestId` and `duration` to every log line" | `src/middleware/logger.ts` |
| C42 | semantic | "Auth middleware attaches decoded payload to `req.user`" | `src/middleware/auth.ts` |
| C43 | semantic | "ErrorHandler is registered last — catches all unhandled errors" | last `app.use()` call in `src/index.ts` |

#### docs/architecture/services.md (3 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C44 | semantic | "`TaskService` emits `task.completed` event when task status set to `done`" | `src/services/TaskService.ts` |
| C45 | semantic | "`NotificationService` subscribes to `task.completed`" | `src/services/NotificationService.ts` |
| C46 | semantic | "`UserService` uses bcrypt with cost factor 12" | `bcrypt.hash(password, 12)` in `src/services/UserService.ts` |

#### CONTRIBUTING.md (3 claims)

| ID | Type | Claimed value | Code target |
|---|---|---|---|
| C47 | command | `npm test` | `package.json` scripts |
| C48 | command | `npm run lint` | `package.json` scripts |
| C49 | command | `npm run typecheck` | `package.json` scripts |

#### CHANGELOG.md (0 claims)

Entirely skip regions. Designed to stress-test that historical version records, old route references, and past dependency versions are never extracted as current claims.

#### docs/guides/mcp.md (5 claims)

| ID | Type | Claimed value | Verification level |
|---|---|---|---|
| C50 | path_reference | `.claude/mcp.json` | deterministic — file existence |
| C51 | semantic | "MCP server exposes 4 tools: `get_tasks`, `create_task`, `complete_task`, `get_users`" | low — tool names parseable from `src/mcp/server.ts` |
| C52 | semantic | "`create_task` accepts `title` (string, required) and `assigneeId` (string, optional)" | medium — requires understanding Zod schema in `src/mcp/server.ts` |
| C53 | semantic | "MCP server shares the database connection with the REST API" | low — import of `src/db/client.ts` in `src/mcp/server.ts` |
| C54 | semantic | "`complete_task` sets task status to `done` and emits `task.completed`" | high — behavioral, requires code comprehension across `src/mcp/server.ts` and `src/services/TaskService.ts` |

#### docs/guides/claude-code.md (4 claims)

| ID | Type | Claimed value | Verification level |
|---|---|---|---|
| C55 | path_reference | `.claude/agents/taskflow.md` | deterministic — file existence |
| C56 | semantic | "The agent has access to all 4 MCP tools" | low — tool list in `.claude/agents/taskflow.md` |
| C57 | semantic | "The agent is scoped to the current repository via `cwd` setting" | low — `cwd` field in `.claude/mcp.json` |
| C58 | semantic | "Invoking `/taskflow` creates a task from current context" | medium — trigger definition in `.claude/agents/taskflow.md` |

### 6.5 Skip Region Inventory

Skip regions are deliberately included in the corpus to test that the extract step correctly avoids false extraction. Each represents a realistic FP trap.

| Category | Example content | Appears in |
|---|---|---|
| Runtime prerequisite | "Requires Node.js 18 or higher" | README, getting-started, deployment |
| Installation instruction | "Run `npm install` to install dependencies" | getting-started |
| Example values | `postgres://user:pass@localhost/taskflow` | configuration |
| Copy-paste instruction | "Copy `.env.example` to `.env`" | getting-started, configuration |
| Historical record | "## [1.0.0] — bumped express to 4.17.0" | CHANGELOG (entire file) |
| Historical architecture | "Before v2.0, the app used a single-file monolith" | architecture/overview |
| Reference table | Full error code table: `{ "code": "USER_NOT_FOUND", "message": "..." }` | api/errors |
| Illustrative output | Example log JSON `{ "level": 30, "msg": "GET /api/v1/users 200 12ms" }` | architecture/middleware |
| Future plans | "We plan to add Redis caching in v3" | architecture/overview |
| Example curl command | `curl -X POST http://localhost:3000/api/v1/users -d '{"name":"Alice"}'` | api/users, api/overview |
| Comparison content | "Unlike express 3.x, express 4 does not bundle a router..." | README |
| LLM behavioral claim | "The agent intelligently routes requests to the right tool" | claude-code |
| MCP prerequisite | "Requires MCP protocol version 1.0 or higher" | mcp |
| Placeholder config | `"command": "node dist/mcp/server.js --repo /path/to/your/repo"` in mcp.json example | mcp |

### 6.6 MCP Documentation — Special Considerations

MCP and Claude Code documentation introduces a category of claims that sit at the boundary of deterministic and semantic verification. Three sub-categories:

**Near-deterministic** (tool names, file existence): verifiable by parsing source code structure.

**Schema-semantic** (parameter names, types, required/optional): verifiable by understanding the Zod schema definition in `src/mcp/server.ts`. Requires code comprehension but is not purely behavioral.

**Truly indeterminate** (Claude's runtime behavior, agent "intelligence"): cannot be verified from code. Must be tagged `docalign:skip` during extract. These claims depend on how the LLM interprets the configuration at runtime, not on what the code contains.

The extract step is expected to classify C54 and C58 as semantic claims requiring evidence assertions, and to classify the "intelligent routing" language as skip regions.

---

## 7. The Mutation Library

### 7.1 Mutation File Format

Each mutation is a JSON file in `mutations/`. Files named `det-*` are handwritten for deterministic claims. Files named `sem-auto-*` are generated by `npm run corpus:gen-mutations` and must not be edited manually.

```json
{
  "id": "det-006-remove-get-users-route",
  "type": "deterministic",
  "description": "Remove GET /api/v1/users handler — claim C23 becomes false",
  "changes": [
    {
      "file": "src/routes/users.ts",
      "operation": "delete_line_matching",
      "pattern": "router.get('/api/v1/users'"
    }
  ],
  "expected_findings": [
    {
      "claim_id": "C23",
      "claim_type": "api_route",
      "verdict": "drifted"
    }
  ]
}
```

### 7.2 Supported Mutation Operations

| Operation | Parameters | Effect |
|---|---|---|
| `delete_line_matching` | `file`, `pattern` | Delete first line containing pattern |
| `replace_line_matching` | `file`, `find`, `replace` | Replace first line containing `find` with `replace` |
| `rename_file` | `from`, `to` | Change file path in memory |
| `delete_file` | `file` | Remove file from memory |
| `set_json_field` | `file`, `path`, `value` | Set a JSON path (e.g. `dependencies.express`) |

### 7.3 Deterministic Mutations (Handwritten)

| ID | Operation | Target | Breaks claim |
|---|---|---|---|
| det-001 | set_json_field `dependencies.express` → `^4.19.0` | `package.json` | C01 |
| det-002 | set_json_field `dependencies.zod` → `^3.23.0` | `package.json` | C02 |
| det-003 | replace_line_matching `"dev":` → `"start:dev":` | `package.json` | C03, C08 |
| det-004 | rename_file `src/config/index.ts` → `src/config/config.ts` | — | C04, C14 |
| det-005 | replace_line_matching `createUser` → `addUser` | `src/services/UserService.ts` | C29 |
| det-006 | delete_line_matching `router.get('/api/v1/users'` | `src/routes/users.ts` | C23 |
| det-007 | replace_line_matching `router.post` → `router.put` (users) | `src/routes/users.ts` | C25 |
| det-008 | delete_line_matching `router.delete.*users` | `src/routes/users.ts` | C27 |
| det-009 | delete_line_matching `router.get.*tasks` | `src/routes/tasks.ts` | C30 |
| det-010 | replace_line_matching `"migrate":` → remove script | `package.json` | C17 |
| det-011 | delete_file `.env.example` | — | C09 |
| det-012 | set_json_field `dependencies.pino` → `^9.0.0` | `package.json` | C40 |
| det-013 | replace_line_matching `complete_task` → `finish_task` (MCP tool registration) | `src/mcp/server.ts` | C51, C54 |
| det-014 | delete_file `.claude/mcp.json` | — | C50, C57 |
| det-015 | delete_file `.claude/agents/taskflow.md` | — | C55, C56, C58 |

Note: det-013 breaks two claims (C51 and C54). The expected_findings array must list both. This is intentional — it tests that the system correctly attributes multiple findings to a single code change.

### 7.4 Semantic Mutation Auto-Generation

Auto-generated mutations are produced by `npm run corpus:gen-mutations` and written to `mutations/sem-auto-*.json`. They must not be edited manually. Regenerate after any change to the sidecar.

**Algorithm:**

```typescript
for each claim in sidecar.claims:
  for each assertion at index i in claim.evidence_assertions:
    if assertion.expect === 'exists':
      generate mutation:
        id: `sem-auto-${claim.id}-assert-${i}`
        changes: [{ file: assertion.scope, operation: 'delete_line_matching', pattern: assertion.pattern }]
        expected_findings: [{ claim_id: claim.id, verdict: 'drifted' }]

    if assertion.expect === 'not_exists':
      generate mutation:
        id: `sem-auto-${claim.id}-assert-${i}`
        changes: [{ file: assertion.scope, operation: 'replace_line_matching', find: '/* placeholder */', replace: assertion.pattern }]
        expected_findings: [{ claim_id: claim.id, verdict: 'drifted' }]
```

**Validity check:** if `assertion.pattern` matches more than one line in `assertion.scope`, skip generation and emit a warning. Ambiguous patterns cannot produce reliable mutations. This is a signal that the sidecar assertion needs to be more specific.

**Expected auto-generated mutations from semantic claims:**

These are approximate — actual patterns depend on what Claude writes in the sidecar during bootstrap.

| Claim | Assertion (expected) | Mutation effect |
|---|---|---|
| C05 | `import.*auth` exists in `src/middleware/auth.ts` | remove auth import |
| C06 | `PORT.*3000` exists in `src/config/index.ts` | remove port default |
| C15 | no default for `DATABASE_URL` in config | add a fallback default |
| C22 | `max: 100` in `src/middleware/rateLimit.ts` | change to `max: 200` |
| C22 | `windowMs: 15 \* 60 \* 1000` in `rateLimit.ts` | delete windowMs line |
| C28 | `res.status(201)` in `src/routes/users.ts` | change to `res.status(200)` |
| C34 | `req.user.id` in `src/routes/tasks.ts` | remove user scoping |
| C37 | middleware registration order in `src/index.ts` | swap logger and errorHandler |
| C41 | `requestId` in `src/middleware/logger.ts` | remove requestId attachment |
| C44 | `task.completed` emit in `src/services/TaskService.ts` | remove emit call |
| C45 | `task.completed` subscribe in `src/services/NotificationService.ts` | remove listener |
| C46 | `bcrypt.hash.*12` in `src/services/UserService.ts` | change cost to 10 |
| C52 | `assigneeId` in `src/mcp/server.ts` Zod schema | rename to `assignee_id` |
| C53 | `import.*db/client` in `src/mcp/server.ts` | replace with new db connection |
| C54 | `task.completed` emit path through `complete_task` tool | break the task.completed chain |

---

## 8. LLM Fixture Mechanism

### 8.1 File Format

`llm-fixtures.json` maps each document file path to a pre-recorded Claude response. The response format mirrors the P-EXTRACT prompt output structure.

```json
{
  "README.md": {
    "recorded_at": "2026-02-18",
    "model": "claude-sonnet-4-6",
    "skip_regions": [
      { "start_line": 45, "end_line": 52, "reason": "comparison_table" },
      { "start_line": 3, "end_line": 3, "reason": "prerequisite_version" }
    ],
    "check_regions": [
      { "line": 12, "type": "dep_version" },
      { "line": 18, "type": "command" }
    ],
    "semantic_claims": [
      {
        "id": "C05",
        "claim_text": "JWT authentication, rate limiting, and structured logging included",
        "line": 22,
        "evidence_assertions": [
          { "pattern": "import.*from.*auth", "scope": "src/middleware/auth.ts", "expect": "exists" }
        ]
      }
    ]
  }
}
```

### 8.2 Recording Workflow

```bash
# Record all fixtures (requires ANTHROPIC_API_KEY):
npm run corpus:record

# Record only changed files:
npm run corpus:record -- --changed

# Update after prompt change:
npm run corpus:record -- --update

# Generate tagged/ from untagged/ using fixtures:
npm run corpus:tag
```

After recording: review the fixture file and the tagged/ output manually before committing. The review verifies that:
- Skip regions correctly cover all FP trap content (Section 6.5)
- All 58 claims are tagged (check regions + semantic claims)
- No legitimate claim is accidentally in a skip region

### 8.3 When to Re-record

| Trigger | Action |
|---|---|
| P-EXTRACT prompt changed | Re-record all fixtures, review Track 3 snapshot diff |
| New doc file added to corpus | Re-record that file only |
| New skip region category discovered | Re-record affected file, verify Track 1 still passes |
| Model version upgrade | Re-record all fixtures, compare claim inventory against previous |

---

## 9. Bootstrap Workflow

Run once to initialise the corpus. All subsequent CI runs are self-contained.

```
Step 1: Write all code files in untagged/ per Section 6.3 blueprints.

Step 2: Write all doc files in untagged/ containing the claims from Section 6.4
        and skip regions from Section 6.5. Use realistic prose — not just bare claims.

Step 3: npm run corpus:record
        Calls Claude API once per doc file. Saves llm-fixtures.json.

Step 4: Review llm-fixtures.json.
        Verify all 58 claims are present. Verify skip regions match Section 6.5.
        Manually fix any missed or incorrectly tagged claims by editing the fixture file.

Step 5: npm run corpus:tag
        Applies fixtures to untagged/ → produces tagged/.
        Commits both untagged/ and tagged/ to the repository.

Step 6: Write handwritten mutations (det-001 through det-015) per Section 7.3.

Step 7: npm run corpus:gen-mutations
        Reads sidecar from tagged/.docalign/semantic/claims.json.
        Writes sem-auto-*.json files to mutations/.
        Review generated mutations — flag any with ambiguous patterns (Section 7.4).

Step 8: npm run test:corpus
        All four tracks should pass.
        Track 1: zero findings on clean tagged/.
        Track 2: each mutation produces its expected findings.
        Track 3: extract snapshot matches stored snapshot.
        Track 4: zero findings on cold start (clean state), expected findings on cold start + mutation.

Step 9: Commit everything. CI is now self-contained.
```

---

## 10. CI Integration

### 10.1 Test Scripts

```json
{
  "test:corpus": "vitest run test/corpus/",
  "test:corpus:fp": "vitest run test/corpus/track1-fp.test.ts",
  "test:corpus:fn": "vitest run test/corpus/track2-fn.test.ts",
  "test:corpus:extract": "vitest run test/corpus/track3-extract-snapshot.test.ts",
  "test:corpus:coldstart": "vitest run test/corpus/track4-cold-start.test.ts",
  "corpus:record": "ts-node test/corpus/scripts/record.ts",
  "corpus:tag": "ts-node test/corpus/scripts/tag.ts",
  "corpus:gen-mutations": "ts-node test/corpus/scripts/gen-mutations.ts"
}
```

### 10.2 CI Gate

`test:corpus` runs on every PR as part of the standard `npm run test` suite. No API key required. Estimated run time: under 90 seconds.

### 10.3 What Triggers Re-recording

Re-recording is a manual step run locally before committing prompt or corpus changes. The resulting `llm-fixtures.json` update is committed and reviewed in the PR diff like any other file. A changed fixture file in a PR is a signal to reviewers that prompt behaviour has changed.

---

## 11. Implementation Checklist

Work to be done in future sessions. Execute in order.

- [ ] **Corpus runner** (`test/corpus/runner.ts`) — implement `runCorpus`, mutation application, fixture LLM client
- [ ] **Test files** (`test/corpus/track1-fp.test.ts` through `track4-cold-start.test.ts`) — implement using runner
- [ ] **`toContainFinding` matcher** (`test/corpus/matchers.ts`) — partial match on claim_id, claim_type, verdict; assert no unexpected findings
- [ ] **Code files** (`untagged/src/**`) — implement per Section 6.3 blueprints
- [ ] **Documentation files** (`untagged/docs/**`, `untagged/README.md`, etc.) — write per Section 6.4 claim inventory and Section 6.5 skip regions
- [ ] **`corpus:record` script** — call Claude API per doc file, write `llm-fixtures.json`
- [ ] **`corpus:tag` script** — apply fixture output to `untagged/` → produce `tagged/`
- [ ] **`corpus:gen-mutations` script** — read sidecar, write `sem-auto-*.json` files
- [ ] **Handwritten mutations** (`mutations/det-001` through `det-015`) — implement per Section 7.3
- [ ] **Bootstrap** — run full bootstrap workflow (Section 9), verify all four tracks pass
- [ ] **CI integration** — add `test:corpus` to the standard `npm run test` pipeline

---

## 12. Key Design Decisions and Rationale

**Why four tracks instead of one end-to-end test?**
Each track isolates a different failure mode. A single end-to-end test that fails tells you nothing about whether the problem is in extraction, mapping, or verification. Track isolation gives actionable failure signals.

**Why is semantic verification deterministic after bootstrap?**
The sidecar stores concrete grep-pattern assertions written by Claude during extract. Evaluating these patterns against source files requires no LLM. The LLM contributes only once (at extract time) and its output is frozen in the sidecar.

**Why auto-generate semantic mutations from the sidecar?**
Each sidecar assertion defines exactly what code pattern is required for a claim to be verified. Inverting that assertion (delete the pattern) is the minimal mutation that makes the claim false. Auto-generation ensures every assertion is tested and eliminates the need to manually figure out what change breaks a semantic claim.

**Why include MCP/Claude Code documentation?**
These doc types introduce claims at multiple levels of verification difficulty: deterministic (file existence), near-deterministic (tool names), schema-semantic (parameter types), and truly indeterminate (runtime LLM behavior). They stress-test the boundary between what the system can and cannot verify, and exercise the skip-region classifier on a category of content it will encounter frequently in real codebases.

**Why is CHANGELOG.md entirely skip regions?**
Version history is the canonical false positive trap. Every past version entry contains dependency versions, API routes, and file paths that are no longer current. The system must recognise that the entire file is historical context, not a set of claims about current state.
