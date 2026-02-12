# Phase 5A: Integration Golden Examples

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 5A
> **"DocAlign" is a working title.** Final product name TBD. When renaming, replace: "DocAlign", "docalign", `.docalign.yml`, `@docalign`, `DOCALIGN_*` env vars, `docalign/*` URLs.
>
> **Inputs:** TDDs (Phase 4A), Prompt Specs (Phase 4B), UX Specs (Phase 4C), Config Spec (Phase 4D), API Contracts
>
> **Purpose:** End-to-end integration examples spanning the full pipeline. Each example traces a complete flow from trigger through every layer to final PR comment output. These examples serve as golden tests for implementation.
>
> **Date:** 2026-02-11

---

## Overview

This document contains 4 integration examples covering the primary verification and fix-application scenarios:

| Example | Scenario | Key Layers Exercised | LLM Calls |
|---------|----------|---------------------|-----------|
| IE-01 | Syntactic drift — dependency version mismatch | L0→L1→L2→L3(Tier 1)→L5 | None (fully deterministic) |
| IE-02 | Semantic drift — API behavior changed | L0→L1→L2→L3(Tier 4)→L5 | P-EXTRACT, P-VERIFY, P-FIX |
| IE-03 | Clean PR — no drift detected | L4 scope resolution→L5 | None |
| IE-04 | Apply fix commit — developer clicks "Apply all fixes" | Fix endpoint→GitHub Git Trees API | None (fix application only) |

IE-01 through IE-03 use the **manual trigger model** (`@docalign review` comment, per GATE42-009) and **default configuration** (zero-config, per GATE42-015). IE-04 traces the fix-application flow triggered by clicking the "Apply all fixes" link from a summary comment (per GATE42-019, GATE42-022, GATE42-023, GATE42-024).

---

<!-- IE-01, IE-02, IE-03 sections follow -->

## Integration Example IE-01: Syntactic Drift -- Dependency Version Mismatch

### Scenario

A Node.js task management API project's README claims `express@4.18.2`. A PR bumps `package.json` to `express@4.19.0` without updating the README. Triggered by `@docalign review`.

**Pipeline path:** Fully deterministic. L0 -> L1 -> L2 -> L3 (Tier 1) -> L5. Zero LLM calls.

**Repo context:** 12 total claims from prior scans. 11 verified, 0 drifted before this scan. This scan checks the 1 in-scope claim (the version claim mapped to `package.json`) and finds it drifted. Post-scan state: 11 verified, 1 drifted. Health = 11/12 = 91.7% ~ 92%.

---

### Trigger

The developer comments on PR #47:

```json
{
  "action": "created",
  "comment": {
    "id": 1820001,
    "body": "Bumped express for the security patch. @docalign review",
    "user": { "login": "amara-dev" }
  },
  "issue": {
    "number": 47,
    "pull_request": { "url": "https://api.github.com/repos/amara-dev/taskflow/pulls/47" }
  },
  "repository": {
    "id": 98765432,
    "full_name": "amara-dev/taskflow",
    "owner": { "login": "amara-dev" },
    "name": "taskflow"
  },
  "installation": { "id": 55001 }
}
```

The server matches `/\b@docalign\s+review\b/i` in `comment.body`, adds `:eyes:` reaction to comment 1820001, creates a Check Run (`in_progress`, title: `DocAlign: Scanning documentation...`), and enqueues a PR scan for the HEAD commit.

---

### Input: Repository State

**File tree:**

```
taskflow/
  README.md
  package.json
  package-lock.json
  .docalign.yml
  src/
    index.ts
    routes/
      tasks.ts
      health.ts
    middleware/
      auth.ts
  tsconfig.json
```

**README.md** (full contents):

```markdown
# Taskflow

A lightweight task management API built with Node.js.

## Tech Stack

Uses [express](https://expressjs.com/) `v4.18.2` for the HTTP server.
Uses TypeScript with strict mode enabled.

## Getting Started

1. Clone the repo
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start the development server

The server starts on port `3000` by default.

## API Endpoints

- `GET /tasks` -- list all tasks
- `POST /tasks` -- create a new task
- `GET /tasks/:id` -- get a task by ID

## Project Structure

- `src/index.ts` -- application entry point
- `src/routes/tasks.ts` -- task CRUD route handlers
- `src/middleware/auth.ts` -- authentication middleware

## License

MIT
```

**package.json** (full contents, post-PR):

```json
{
  "name": "taskflow",
  "version": "1.0.3",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.19.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "@types/express": "^4.17.21"
  }
}
```

**src/ files:** Standard Express route handlers. Not shown in full -- their contents are not relevant to this deterministic verification path.

---

### Input: PR Diff

PR #47 modifies only `package.json`. README.md is NOT in the diff.

```diff
diff --git a/package.json b/package.json
index 3a1f2b4..7c8e9d0 100644
--- a/package.json
+++ b/package.json
@@ -7,7 +7,7 @@
     "start": "node dist/index.js"
   },
   "dependencies": {
-    "express": "^4.18.2",
+    "express": "^4.19.0",
     "uuid": "^9.0.0"
   },
   "devDependencies": {
```

---

### Layer 0 Output: Codebase Index (relevant entities)

L0 `updateFromDiff()` processes the changed file (`package.json`). The dependency index is updated.

**DependencyVersion** (from `getDependencyVersion("repo-tf-001", "express")`):

```json
{
  "version": "^4.19.0",
  "source": "manifest"
}
```

**CodeEntity objects** (pre-existing, for route files -- not directly used in this scenario but present in the index):

```json
[
  {
    "id": "ent-a1b2c3d4-0001-4000-8000-000000000001",
    "repo_id": "repo-tf-001",
    "file_path": "src/routes/tasks.ts",
    "line_number": 5,
    "end_line_number": 48,
    "entity_type": "route",
    "name": "tasksRouter",
    "signature": "Router (GET /tasks, POST /tasks, GET /tasks/:id)",
    "embedding": null,
    "raw_code": "...",
    "last_commit_sha": "a1b2c3d4e5f6",
    "created_at": "2026-02-09T10:00:00Z",
    "updated_at": "2026-02-09T10:00:00Z"
  },
  {
    "id": "ent-a1b2c3d4-0001-4000-8000-000000000002",
    "repo_id": "repo-tf-001",
    "file_path": "src/routes/health.ts",
    "line_number": 3,
    "end_line_number": 12,
    "entity_type": "route",
    "name": "healthRouter",
    "signature": "Router (GET /health)",
    "embedding": null,
    "raw_code": "...",
    "last_commit_sha": "a1b2c3d4e5f6",
    "created_at": "2026-02-09T10:00:00Z",
    "updated_at": "2026-02-09T10:00:00Z"
  }
]
```

---

### Layer 1 Output: Extracted Claims

Claims were extracted from `README.md` during the initial full scan. They are retrieved from the database for scope resolution. The following 6 claims exist for `README.md`:

```json
[
  {
    "id": "claim-a1b2c3d4-0001-4000-8000-000000000001",
    "repo_id": "repo-tf-001",
    "source_file": "README.md",
    "line_number": 7,
    "claim_text": "Uses express v4.18.2 for the HTTP server.",
    "claim_type": "dependency_version",
    "testability": "syntactic",
    "extracted_value": {
      "type": "dependency_version",
      "package": "express",
      "version": "4.18.2"
    },
    "keywords": ["express", "4.18.2", "HTTP server"],
    "extraction_confidence": 0.99,
    "extraction_method": "regex",
    "verification_status": "verified",
    "last_verified_at": "2026-02-09T12:00:00Z",
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-08T09:00:00Z",
    "updated_at": "2026-02-09T12:00:00Z"
  },
  {
    "id": "claim-a1b2c3d4-0001-4000-8000-000000000002",
    "repo_id": "repo-tf-001",
    "source_file": "README.md",
    "line_number": 12,
    "claim_text": "Run npm install to install dependencies",
    "claim_type": "command",
    "testability": "syntactic",
    "extracted_value": {
      "type": "command",
      "runner": "npm",
      "script": "install"
    },
    "keywords": ["npm", "install"],
    "extraction_confidence": 0.95,
    "extraction_method": "regex",
    "verification_status": "verified",
    "last_verified_at": "2026-02-09T12:00:00Z",
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-08T09:00:00Z",
    "updated_at": "2026-02-09T12:00:00Z"
  },
  {
    "id": "claim-a1b2c3d4-0001-4000-8000-000000000003",
    "repo_id": "repo-tf-001",
    "source_file": "README.md",
    "line_number": 13,
    "claim_text": "Run npm run dev to start the development server",
    "claim_type": "command",
    "testability": "syntactic",
    "extracted_value": {
      "type": "command",
      "runner": "npm",
      "script": "dev"
    },
    "keywords": ["npm", "dev", "development server"],
    "extraction_confidence": 0.95,
    "extraction_method": "regex",
    "verification_status": "verified",
    "last_verified_at": "2026-02-09T12:00:00Z",
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-08T09:00:00Z",
    "updated_at": "2026-02-09T12:00:00Z"
  },
  {
    "id": "claim-a1b2c3d4-0001-4000-8000-000000000004",
    "repo_id": "repo-tf-001",
    "source_file": "README.md",
    "line_number": 24,
    "claim_text": "src/index.ts -- application entry point",
    "claim_type": "path_reference",
    "testability": "syntactic",
    "extracted_value": {
      "type": "path_reference",
      "path": "src/index.ts"
    },
    "keywords": ["src/index.ts", "entry point"],
    "extraction_confidence": 0.98,
    "extraction_method": "regex",
    "verification_status": "verified",
    "last_verified_at": "2026-02-09T12:00:00Z",
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-08T09:00:00Z",
    "updated_at": "2026-02-09T12:00:00Z"
  },
  {
    "id": "claim-a1b2c3d4-0001-4000-8000-000000000005",
    "repo_id": "repo-tf-001",
    "source_file": "README.md",
    "line_number": 25,
    "claim_text": "src/routes/tasks.ts -- task CRUD route handlers",
    "claim_type": "path_reference",
    "testability": "syntactic",
    "extracted_value": {
      "type": "path_reference",
      "path": "src/routes/tasks.ts"
    },
    "keywords": ["src/routes/tasks.ts", "route handlers"],
    "extraction_confidence": 0.98,
    "extraction_method": "regex",
    "verification_status": "verified",
    "last_verified_at": "2026-02-09T12:00:00Z",
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-08T09:00:00Z",
    "updated_at": "2026-02-09T12:00:00Z"
  },
  {
    "id": "claim-a1b2c3d4-0001-4000-8000-000000000006",
    "repo_id": "repo-tf-001",
    "source_file": "README.md",
    "line_number": 26,
    "claim_text": "src/middleware/auth.ts -- authentication middleware",
    "claim_type": "path_reference",
    "testability": "syntactic",
    "extracted_value": {
      "type": "path_reference",
      "path": "src/middleware/auth.ts"
    },
    "keywords": ["src/middleware/auth.ts", "authentication"],
    "extraction_confidence": 0.98,
    "extraction_method": "regex",
    "verification_status": "verified",
    "last_verified_at": "2026-02-09T12:00:00Z",
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-08T09:00:00Z",
    "updated_at": "2026-02-09T12:00:00Z"
  }
]
```

**Scope resolution:** L4 calls `findClaimsByCodeFiles(repoId, ["package.json"])`. The mapper's reverse index returns claim `claim-a1b2c3d4-...-000000000001` (the `dependency_version` claim for express) because it maps to `package.json`. Only this 1 claim is in scope for verification.

The other 5 claims are NOT in scope -- their mapped code files (`src/index.ts`, `src/routes/tasks.ts`, `src/middleware/auth.ts`, `package.json` for the commands) were not changed in this PR (commands map to `package.json` but the scope check also considers whether the specific mapping -- the `scripts` section -- is affected; for this example, the npm commands are still valid and their script entries were not changed in the diff).

> **Simplification note:** For this integration example, we show only the 1 in-scope claim proceeding through L2-L5. The other 5 claims retain their existing `verified` status from the prior scan.

---

### Layer 2 Output: Claim Mappings

The mapping for the version claim already exists from the initial scan. It is retrieved from the database:

```json
{
  "id": "map-a1b2c3d4-0001-4000-8000-000000000001",
  "claim_id": "claim-a1b2c3d4-0001-4000-8000-000000000001",
  "repo_id": "repo-tf-001",
  "code_file": "package.json",
  "code_entity_id": null,
  "confidence": 1.0,
  "co_change_boost": 0.0,
  "mapping_method": "direct_reference",
  "created_at": "2026-02-08T09:00:30Z",
  "last_validated_at": "2026-02-09T12:00:00Z"
}
```

**Mapping rationale:** `claim_type: "dependency_version"` with `extracted_value.package: "express"` triggers the direct-reference Step 1 path in the mapper. The mapper calls `getDependencyVersion("repo-tf-001", "express")` which returns a result, confirming `package.json` (source: `"manifest"`) is the mapped code file. `confidence: 1.0` because this is a direct, unambiguous reference. `code_entity_id: null` because the dependency is a whole-file-level concept in `package.json`, not a specific code entity.

---

### Layer 3 Output: Verification Results

L4 calls `verifyDeterministic(claim, [mapping])`. The verifier routes this to **Tier 1** because:
- `claim_type` is `"dependency_version"` (syntactic-testable)
- `testability` is `"syntactic"`
- A mapping exists to `package.json` with `confidence: 1.0`

**Tier 1 deterministic comparison:**
1. Extract `claimed_version` from `claim.extracted_value.version` -> `"4.18.2"`
2. Call `getDependencyVersion("repo-tf-001", "express")` -> `{ version: "^4.19.0", source: "manifest" }`
3. Strip semver range prefix: `"^4.19.0"` -> `"4.19.0"`
4. Compare `"4.18.2"` !== `"4.19.0"` -> **mismatch detected**
5. Verdict: `"drifted"`, severity: `"medium"` (version drift, not a breaking change indicator)

```json
{
  "id": "vr-a1b2c3d4-0001-4000-8000-000000000001",
  "claim_id": "claim-a1b2c3d4-0001-4000-8000-000000000001",
  "repo_id": "repo-tf-001",
  "scan_run_id": "scan-a1b2c3d4-0001-4000-8000-000000000001",
  "verdict": "drifted",
  "confidence": 1.0,
  "tier": 1,
  "severity": "medium",
  "reasoning": "Deterministic version comparison: README claims express v4.18.2 but package.json specifies ^4.19.0.",
  "specific_mismatch": "README claims express@4.18.2 but package.json has ^4.19.0",
  "suggested_fix": "Uses [express](https://expressjs.com/) `v4.19.0` for the HTTP server.",
  "evidence_files": ["package.json"],
  "token_cost": null,
  "duration_ms": 8,
  "post_check_result": null,
  "verification_path": null,
  "created_at": "2026-02-11T14:23:00Z"
}
```

**Key observations:**
- `token_cost: null` -- zero LLM calls, fully deterministic.
- `duration_ms: 8` -- sub-millisecond index lookup + comparison.
- `verification_path: null` -- Tier 1/2 do not use Path 1/Path 2 routing (those are for LLM tiers).
- `post_check_result: null` -- post-checks are only for LLM-generated results.
- `suggested_fix` contains the full replacement line text for the README.

---

### Layer 4: Scan Run

```json
{
  "id": "scan-a1b2c3d4-0001-4000-8000-000000000001",
  "repo_id": "repo-tf-001",
  "trigger_type": "manual",
  "trigger_ref": "47",
  "status": "completed",
  "commit_sha": "f4e5d6c7b8a9012345678901234567890abcdef0",
  "claims_checked": 1,
  "claims_drifted": 1,
  "claims_verified": 0,
  "claims_uncertain": 0,
  "total_token_cost": 0,
  "total_duration_ms": 342,
  "comment_posted": true,
  "check_run_id": 9900001,
  "started_at": "2026-02-11T14:22:59Z",
  "completed_at": "2026-02-11T14:23:00Z"
}
```

**Notes:**
- `trigger_type: "manual"` -- triggered by `@docalign review` command.
- `trigger_ref: "47"` -- PR number.
- `claims_checked: 1` -- only the express version claim was in scope.
- `claims_verified: 0` -- the one in-scope claim was drifted, not verified. (The 11 previously verified claims are not re-checked in this scan.)
- `total_token_cost: 0` -- no LLM usage.
- `total_duration_ms: 342` -- includes webhook processing, scope resolution, Tier 1 check, comment posting.

---

### Layer 5 Output: PR Summary Comment

L5 computes health score from the full repo state (not just this scan's scope):
- `verified`: 11 (from prior scans, unchanged)
- `drifted`: 1 (this scan's finding)
- `score`: 11 / (11 + 1) = 0.9167 -> `92%`

The following markdown is posted as a PR comment via the GitHub Issues API:

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id=scan-a1b2c3d4-0001-4000-8000-000000000001 -->

Found **1 documentation issue(s)** in this PR:

**11 verified** | **1 drifted** -- **92% health**

| Severity | File | Line | Issue |
|----------|------|------|-------|
| MEDIUM | `README.md` | 7 | README claims express@4.18.2 but package.json has ^4.19.0 |

---

### MEDIUM: README claims express@4.18.2 but package.json has ^4.19.0
**docs:** `README.md` line 7
**claim:** "Uses express v4.18.2 for the HTTP server."
**evidence:** `package.json`

Deterministic version comparison: README claims express v4.18.2 but package.json specifies ^4.19.0.

> This finding references `README.md` which is not modified in this PR.

<details>
<summary>Suggested fix</summary>

```diff
- Uses [express](https://expressjs.com/) `v4.18.2` for the HTTP server.
+ Uses [express](https://expressjs.com/) `v4.19.0` for the HTTP server.
```
</details>

---

[**Apply all fixes**](https://app.docalign.dev/api/fix/apply?repo=repo-tf-001&scan_run_id=scan-a1b2c3d4-0001-4000-8000-000000000001&token=hmac_abc123) -- creates a commit on this PR branch with all documentation fixes.

---

Commit: `f4e5d6c` | Scanned at 2026-02-11T14:23:00Z
Repo health: 92% (11/12 claims verified)
```

**Critical detail: "This finding references `README.md` which is not modified in this PR."**

This note is appended per TDD5-003 in phase4-decisions.md. The drift was detected because `package.json` changed (a code file that maps to the version claim in README.md), but README.md itself was NOT part of the PR diff. The finding appears in the summary comment with this note. The "Apply all fixes" link (GATE42-019) allows the developer to fix the drift with one click.

---

### Layer 5 Output: Review Comments

**Not applicable.** Review comments are not part of the MVP output (GATE42-016). All findings are communicated via the summary comment above. The "Apply all fixes" link provides one-click fix application.

---

### Layer 5 Output: Check Run

```json
{
  "name": "DocAlign",
  "status": "completed",
  "conclusion": "neutral",
  "output": {
    "title": "DocAlign: Found 1 documentation issue(s)",
    "summary": "Found 1 documentation issues (1 medium). Health score: 92%."
  }
}
```

**Notes:**
- `conclusion: "neutral"` -- default behavior when `block_on_findings: false` (the default config). Findings exist but do not block merge.
- The summary parenthetical omits zero-count severities: only `1 medium` is shown (no "0 high, 0 low").

---

### Anti-example

This scenario validates the following constraints:

- **MUST NOT use LLM:** The entire pipeline is deterministic. `claim_type: "dependency_version"` with `testability: "syntactic"` routes to Tier 1. The version comparison is a string operation against the L0 index. `token_cost` is `null` and `total_token_cost` is `0`. No agent tasks are created. No `VerificationPayload` is dispatched to the GitHub Action.

- **MUST NOT show uncertain claims in PR output:** There are no uncertain claims in this scenario. If there were (e.g., a behavior claim that timed out), they would be excluded from the summary comment per Section 2.1.3 of the UX specs. Only `verdict: "drifted"` findings appear in PR output.

- **MUST NOT block merge:** The Check Run conclusion is `neutral`, not `action_required`. The default `block_on_findings: false` config means findings are informational. The developer can merge without addressing the drift. Only if the repo configured `check.block_on_findings: true` AND the finding severity met or exceeded `check.min_severity_to_block` would the conclusion change to `action_required`.

- **MUST NOT post inline review comments (deferred to post-MVP per GATE42-016).** All findings are communicated via the summary comment. The "Apply all fixes" link (GATE42-019) provides one-click fix application for all drifted findings.

---

# Integration Example IE-02: Semantic Drift -- API Behavior Changed

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 5A: Integration Examples
>
> **Tests:** L0 (route entity extraction), L1 (syntactic + semantic claim extraction), L2 (route mapping + symbol search), L3 (Path 1 routing + Tier 4 semantic verification), L5 (summary comment + fix generation)
>
> **LLM Calls:** P-EXTRACT (claim extraction), P-VERIFY Path 1 (semantic verification), P-FIX (fix generation)
>
> **Key Decision:** TDD5-003 -- Non-Diff Lines Fall Back to Summary-Only

---

## Scenario

A REST API project (Node.js/Express/TypeScript) has documentation in `docs/api.md` stating that `POST /api/users` returns `201 Created` with body `{ id, email, created_at }`. A PR changes the `createUser` handler in `src/routes/users.ts` so it returns `200 OK` with body `{ id, email, username }` (omitting `created_at`, adding `username`). The documentation is NOT updated in the PR. A developer comments `@docalign review` on the PR.

---

## Trigger

GitHub `issue_comment.created` webhook fires when the developer posts a comment.

```json
{
  "action": "created",
  "issue": {
    "number": 87,
    "pull_request": {
      "url": "https://api.github.com/repos/acme/user-service/pulls/87"
    }
  },
  "comment": {
    "id": 2001234567,
    "body": "Changed the user creation response shape to match the new frontend requirements. @docalign review",
    "user": { "login": "dev-sarah" }
  },
  "repository": {
    "id": 90001,
    "full_name": "acme/user-service",
    "owner": { "login": "acme" },
    "name": "user-service"
  },
  "installation": { "id": 55001 }
}
```

The server matches `@docalign review` via regex `/\b@docalign\s+review\b/i`, adds an `:eyes:` reaction to comment `2001234567`, and enqueues a PR scan for PR #87 at HEAD SHA `f4a8c3d`.

---

## Input: Repository State

### File Tree (relevant subset)

```
acme/user-service/
  docs/
    api.md
  src/
    routes/
      users.ts
    middleware/
      auth.ts
    models/
      user.ts
  package.json
  tsconfig.json
  .docalign.yml
```

### `docs/api.md` (unchanged in PR)

```markdown
# User Service API

## Authentication

All endpoints require a Bearer token in the `Authorization` header.

## Endpoints

### POST /api/users

Creates a new user account.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "created_at": "2026-01-15T10:30:00Z"
}
```

### GET /api/users/:id

Returns a single user by ID.

**Response:** `200 OK`

```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "username": "johndoe",
  "created_at": "2026-01-15T10:30:00Z"
}
```

### DELETE /api/users/:id

Deletes a user account. Returns `204 No Content`.
```

### `src/routes/users.ts` -- BEFORE the PR

```typescript
import { Router, Request, Response } from 'express';
import { UserModel } from '../models/user';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createUserSchema } from '../schemas/user';

const router = Router();

router.use(authMiddleware);

// GET /api/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ id: user.id, email: user.email, username: user.username, created_at: user.createdAt.toISOString() });
});

// POST /api/users
router.post('/', validate(createUserSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await UserModel.create({ email, password });
  res.status(201).json({
    id: user.id,
    email: user.email,
    created_at: user.createdAt.toISOString()
  });
});

// DELETE /api/users/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await UserModel.deleteById(req.params.id);
  res.status(204).send();
});

export default router;
```

### `src/routes/users.ts` -- AFTER the PR (modified)

```typescript
import { Router, Request, Response } from 'express';
import { UserModel } from '../models/user';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createUserSchema } from '../schemas/user';

const router = Router();

router.use(authMiddleware);

// GET /api/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ id: user.id, email: user.email, username: user.username, created_at: user.createdAt.toISOString() });
});

// POST /api/users
router.post('/', validate(createUserSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await UserModel.create({ email, password });
  res.status(200).json({
    id: user.id,
    email: user.email,
    username: user.username
  });
});

// DELETE /api/users/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await UserModel.deleteById(req.params.id);
  res.status(204).send();
});

export default router;
```

### `package.json` (relevant excerpt)

```json
{
  "name": "user-service",
  "version": "2.1.0",
  "dependencies": {
    "express": "^4.18.2",
    "uuid": "^9.0.0"
  }
}
```

---

## Input: PR Diff

The PR modifies only `src/routes/users.ts`. The file `docs/api.md` is NOT in the diff.

```diff
diff --git a/src/routes/users.ts b/src/routes/users.ts
index abc1234..def5678 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -23,10 +23,10 @@ router.get('/:id', async (req: Request, res: Response) => {
 router.post('/', validate(createUserSchema), async (req: Request, res: Response) => {
   const { email, password } = req.body;
   const user = await UserModel.create({ email, password });
-  res.status(201).json({
+  res.status(200).json({
     id: user.id,
     email: user.email,
-    created_at: user.createdAt.toISOString()
+    username: user.username
   });
 });
```

Changed files:

```json
[
  {
    "filename": "src/routes/users.ts",
    "status": "modified",
    "additions": 3,
    "deletions": 3,
    "patch": "<unified diff above>"
  }
]
```

---

## Layer 0 Output: Codebase Index (Relevant Entities)

After L4 calls `L0.updateFromDiff()`, the index contains these relevant entities.

### RouteEntity (for POST /api/users)

```json
{
  "id": "route-e8a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "file_path": "src/routes/users.ts",
  "line_number": 23,
  "method": "POST",
  "path": "/api/users"
}
```

### CodeEntity (createUser handler -- anonymous, identified by route)

```json
{
  "id": "entity-a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "file_path": "src/routes/users.ts",
  "line_number": 23,
  "end_line_number": 32,
  "entity_type": "route",
  "name": "POST /api/users",
  "signature": "router.post('/', validate(createUserSchema), async (req, res) => { ... })",
  "embedding": null,
  "raw_code": "router.post('/', validate(createUserSchema), async (req: Request, res: Response) => {\n  const { email, password } = req.body;\n  const user = await UserModel.create({ email, password });\n  res.status(200).json({\n    id: user.id,\n    email: user.email,\n    username: user.username\n  });\n});",
  "last_commit_sha": "f4a8c3d",
  "created_at": "2026-02-10T09:00:00Z",
  "updated_at": "2026-02-11T14:00:00Z"
}
```

### CodeEntity (GET /api/users/:id handler)

```json
{
  "id": "entity-b2c3d4e5-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "file_path": "src/routes/users.ts",
  "line_number": 12,
  "end_line_number": 19,
  "entity_type": "route",
  "name": "GET /api/users/:id",
  "signature": "router.get('/:id', async (req, res) => { ... })",
  "embedding": null,
  "raw_code": "router.get('/:id', async (req: Request, res: Response) => {\n  const user = await UserModel.findById(req.params.id);\n  if (!user) {\n    return res.status(404).json({ error: 'User not found' });\n  }\n  res.json({ id: user.id, email: user.email, username: user.username, created_at: user.createdAt.toISOString() });\n});",
  "last_commit_sha": "f4a8c3d",
  "created_at": "2026-02-10T09:00:00Z",
  "updated_at": "2026-02-11T14:00:00Z"
}
```

---

## Layer 1 Output: Extracted Claims

L1 processes `docs/api.md` in two phases: syntactic extraction (server-side, deterministic) and semantic extraction (client-side, LLM via P-EXTRACT).

### Syntactic Claims (deterministic, extracted by regex/heuristic)

```json
[
  {
    "id": "claim-c1a00001-aaaa-bbbb-cccc-000000000001",
    "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
    "source_file": "docs/api.md",
    "line_number": 11,
    "claim_text": "POST /api/users",
    "claim_type": "api_route",
    "testability": "syntactic",
    "extracted_value": { "type": "api_route", "method": "POST", "path": "/api/users" },
    "keywords": ["POST", "/api/users"],
    "extraction_confidence": 1.0,
    "extraction_method": "regex",
    "verification_status": "pending",
    "last_verified_at": null,
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-10T09:05:00Z",
    "updated_at": "2026-02-10T09:05:00Z"
  },
  {
    "id": "claim-c1a00001-aaaa-bbbb-cccc-000000000002",
    "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
    "source_file": "docs/api.md",
    "line_number": 29,
    "claim_text": "GET /api/users/:id",
    "claim_type": "api_route",
    "testability": "syntactic",
    "extracted_value": { "type": "api_route", "method": "GET", "path": "/api/users/:id" },
    "keywords": ["GET", "/api/users/:id"],
    "extraction_confidence": 1.0,
    "extraction_method": "regex",
    "verification_status": "pending",
    "last_verified_at": null,
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-10T09:05:00Z",
    "updated_at": "2026-02-10T09:05:00Z"
  },
  {
    "id": "claim-c1a00001-aaaa-bbbb-cccc-000000000003",
    "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
    "source_file": "docs/api.md",
    "line_number": 43,
    "claim_text": "DELETE /api/users/:id",
    "claim_type": "api_route",
    "testability": "syntactic",
    "extracted_value": { "type": "api_route", "method": "DELETE", "path": "/api/users/:id" },
    "keywords": ["DELETE", "/api/users/:id"],
    "extraction_confidence": 1.0,
    "extraction_method": "regex",
    "verification_status": "pending",
    "last_verified_at": null,
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-10T09:05:00Z",
    "updated_at": "2026-02-10T09:05:00Z"
  }
]
```

### Semantic Claims (LLM-extracted via P-EXTRACT)

These are the behavior claims extracted by the LLM from the doc content that cannot be captured by regex.

```json
[
  {
    "id": "claim-c1a00001-aaaa-bbbb-cccc-000000000004",
    "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
    "source_file": "docs/api.md",
    "line_number": 7,
    "claim_text": "All endpoints require a Bearer token in the Authorization header.",
    "claim_type": "behavior",
    "testability": "semantic",
    "extracted_value": { "type": "behavior", "description": "All endpoints require a Bearer token in the Authorization header." },
    "keywords": ["Bearer", "Authorization", "authMiddleware", "token"],
    "extraction_confidence": 0.9,
    "extraction_method": "llm",
    "verification_status": "pending",
    "last_verified_at": null,
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-10T09:06:00Z",
    "updated_at": "2026-02-10T09:06:00Z"
  },
  {
    "id": "claim-c1a00001-aaaa-bbbb-cccc-000000000005",
    "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
    "source_file": "docs/api.md",
    "line_number": 21,
    "claim_text": "POST /api/users returns 201 Created with a response body containing id, email, and created_at fields.",
    "claim_type": "behavior",
    "testability": "semantic",
    "extracted_value": { "type": "behavior", "description": "POST /api/users returns 201 Created with a response body containing id, email, and created_at fields." },
    "keywords": ["POST", "users", "201", "created_at", "createUser"],
    "extraction_confidence": 0.95,
    "extraction_method": "llm",
    "verification_status": "pending",
    "last_verified_at": null,
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-10T09:06:00Z",
    "updated_at": "2026-02-10T09:06:00Z"
  },
  {
    "id": "claim-c1a00001-aaaa-bbbb-cccc-000000000006",
    "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
    "source_file": "docs/api.md",
    "line_number": 45,
    "claim_text": "DELETE /api/users/:id returns 204 No Content.",
    "claim_type": "behavior",
    "testability": "semantic",
    "extracted_value": { "type": "behavior", "description": "DELETE /api/users/:id returns 204 No Content." },
    "keywords": ["DELETE", "users", "204", "deleteById"],
    "extraction_confidence": 0.9,
    "extraction_method": "llm",
    "verification_status": "pending",
    "last_verified_at": null,
    "embedding": null,
    "parent_claim_id": null,
    "created_at": "2026-02-10T09:06:00Z",
    "updated_at": "2026-02-10T09:06:00Z"
  }
]
```

---

## Layer 1 Detail: LLM Call (P-EXTRACT)

### Prompt Sent

**System prompt:** _(as defined in phase4b-prompt-specs.md Section 2.2)_

**User prompt:**

```
Project context:
- Language: TypeScript
- Frameworks: Express

Documentation file: docs/api.md
Chunk heading: Endpoints
Start line: 9

---
### POST /api/users

Creates a new user account.

**Request:**
...

**Response:** `201 Created`

{
  "id": "uuid-string",
  "email": "user@example.com",
  "created_at": "2026-01-15T10:30:00Z"
}

### GET /api/users/:id
...

### DELETE /api/users/:id

Deletes a user account. Returns `204 No Content`.
---

Extract all verifiable semantic claims from this documentation section. Return a JSON object matching the schema exactly.
```

### Response Received

```json
{
  "type": "claim_extraction",
  "claims": [
    {
      "claim_text": "POST /api/users returns 201 Created with a response body containing id, email, and created_at fields.",
      "claim_type": "behavior",
      "source_file": "docs/api.md",
      "source_line": 21,
      "confidence": 0.95,
      "keywords": ["POST", "users", "201", "created_at", "createUser"]
    },
    {
      "claim_text": "DELETE /api/users/:id returns 204 No Content.",
      "claim_type": "behavior",
      "source_file": "docs/api.md",
      "source_line": 45,
      "confidence": 0.9,
      "keywords": ["DELETE", "users", "204", "deleteById"]
    }
  ]
}
```

**Token usage:** 872 input, 143 output. **Duration:** 1,240 ms. **Cost:** ~$0.004.

Note: The LLM correctly skips the API route patterns (`POST /api/users`, `GET /api/users/:id`, `DELETE /api/users/:id`) because those are syntactic claim types handled deterministically. It extracts only the behavior claims about status codes and response shapes.

---

## Layer 2 Output: Claim Mappings

L2 maps each claim to code via the 4-step progressive pipeline. The focus claim is `claim-c1a00001-aaaa-bbbb-cccc-000000000005` (the behavior claim about `POST /api/users` returning `201 Created`).

### Mapping for the syntactic api_route claim (claim ...0001)

**Step 1 (Direct Reference):** `L0.findRoute("repo-...", "POST", "/api/users")` returns `route-e8a1b2c3-...`.

```json
{
  "id": "mapping-d1e2f3a4-1111-2222-3333-444444444401",
  "claim_id": "claim-c1a00001-aaaa-bbbb-cccc-000000000001",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "code_file": "src/routes/users.ts",
  "code_entity_id": "entity-a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "confidence": 1.0,
  "co_change_boost": 0.0,
  "mapping_method": "direct_reference",
  "created_at": "2026-02-10T09:10:00Z",
  "last_validated_at": "2026-02-11T14:01:00Z"
}
```

### Mapping for the behavior claim (claim ...0005) -- the drifted claim

**Step 1 (Direct Reference):** The behavior claim contains `"POST /api/users"` text. L2 parses keywords and calls `L0.findRoute("repo-...", "POST", "/api/users")` which returns `route-e8a1b2c3-...`, mapping to `entity-a1b2c3d4-...`.

**Step 2 (Symbol Search):** L2 also calls `L0.findSymbol("repo-...", "createUser")` -- no match (the handler is anonymous, registered as `POST /api/users`). Keywords `"201"`, `"created_at"` do not match any symbol names.

**Step 3 (Semantic Search):** Skipped because Step 1 already produced a high-confidence mapping.

```json
{
  "id": "mapping-d1e2f3a4-1111-2222-3333-444444444405",
  "claim_id": "claim-c1a00001-aaaa-bbbb-cccc-000000000005",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "code_file": "src/routes/users.ts",
  "code_entity_id": "entity-a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "confidence": 0.95,
  "co_change_boost": 0.0,
  "mapping_method": "direct_reference",
  "created_at": "2026-02-10T09:10:00Z",
  "last_validated_at": "2026-02-11T14:01:00Z"
}
```

---

## Layer 3: Routing Decision

L4 calls `L3.routeClaim(claim, mappings)` for the behavior claim `...0005`. The claim has a single entity-level mapping to `entity-a1b2c3d4-...` in one file.

**Token estimation:**
- Entity spans lines 23-32 = 10 lines.
- `10 lines * 60 chars/line / 4 chars/token = 150 entity tokens`.
- Import estimate: `30 * 4 = 120 tokens`.
- Total: `150 + 120 = 270 tokens`.
- Cap: `4000 tokens`. `270 < 4000` -- fits in Path 1.

```json
{
  "claim_id": "claim-c1a00001-aaaa-bbbb-cccc-000000000005",
  "path": 1,
  "reason": "single_entity_mapped",
  "entity_token_estimate": 270
}
```

---

## Layer 3: Evidence Assembly (Path 1)

L4 calls `L3.buildPath1Evidence(claim, mappings)` to assemble the compact evidence payload.

```json
{
  "formatted_evidence": "--- File: src/routes/users.ts ---\n\n// Imports\nimport { Router, Request, Response } from 'express';\nimport { UserModel } from '../models/user';\nimport { authMiddleware } from '../middleware/auth';\nimport { validate } from '../middleware/validate';\nimport { createUserSchema } from '../schemas/user';\n\n// Entity: POST /api/users (lines 23-32)\nrouter.post('/', validate(createUserSchema), async (req: Request, res: Response) => {\n  const { email, password } = req.body;\n  const user = await UserModel.create({ email, password });\n  res.status(200).json({\n    id: user.id,\n    email: user.email,\n    username: user.username\n  });\n});",
  "metadata": {
    "path": 1,
    "file_path": "src/routes/users.ts",
    "entity_name": "POST /api/users",
    "entity_lines": [23, 32],
    "entity_token_estimate": 150,
    "imports_token_estimate": 95,
    "total_token_estimate": 245
  }
}
```

---

## Layer 3 Output: Verification Results

The GitHub Action receives the `verification` agent task with the above evidence and runs the P-VERIFY Path 1 prompt. The LLM detects two mismatches: (1) status code changed from 201 to 200, (2) response body shape changed (added `username`, removed `created_at`).

### VerificationResult for the drifted behavior claim (claim ...0005)

```json
{
  "id": "vr-f1e2d3c4-aaaa-bbbb-cccc-000000000005",
  "claim_id": "claim-c1a00001-aaaa-bbbb-cccc-000000000005",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "scan_run_id": "scan-99887766-5544-3322-1100-aabbccddeeff",
  "verdict": "drifted",
  "confidence": 0.97,
  "tier": 4,
  "severity": "high",
  "reasoning": "The documentation claims POST /api/users returns 201 Created with fields id, email, and created_at. The actual code returns 200 OK (not 201) with fields id, email, and username (created_at is omitted, username is added). Both the status code and the response body shape have changed.",
  "specific_mismatch": "Documentation says '201 Created with { id, email, created_at }' but code returns 200 OK with { id, email, username }. Status code changed (201 -> 200), created_at removed, username added.",
  "suggested_fix": "POST /api/users returns 200 OK with a response body containing id, email, and username fields.",
  "evidence_files": ["src/routes/users.ts"],
  "token_cost": 847,
  "duration_ms": 1820,
  "post_check_result": null,
  "verification_path": 1,
  "created_at": "2026-02-11T14:02:30Z"
}
```

### VerificationResult for the syntactic api_route claim (claim ...0001) -- verified

```json
{
  "id": "vr-f1e2d3c4-aaaa-bbbb-cccc-000000000001",
  "claim_id": "claim-c1a00001-aaaa-bbbb-cccc-000000000001",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "scan_run_id": "scan-99887766-5544-3322-1100-aabbccddeeff",
  "verdict": "verified",
  "confidence": 1.0,
  "tier": 1,
  "severity": null,
  "reasoning": "Route POST /api/users exists in the codebase at src/routes/users.ts:23.",
  "specific_mismatch": null,
  "suggested_fix": null,
  "evidence_files": ["src/routes/users.ts"],
  "token_cost": null,
  "duration_ms": 2,
  "post_check_result": null,
  "verification_path": null,
  "created_at": "2026-02-11T14:01:05Z"
}
```

(Other claims in the repo are verified similarly. The full scan yields 13 verified, 1 drifted, 1 uncertain -- the uncertain claim is an architecture claim that could not be resolved and is hidden from PR output per GATE42-002.)

---

## Layer 3 Detail: LLM Call (P-VERIFY)

### Prompt Sent

**System prompt:** _(as defined in phase4b-prompt-specs.md Section 4A.2)_

**User prompt:**

```
Verify this documentation claim against the source code evidence.

<claim file="docs/api.md" line="21" type="behavior">
POST /api/users returns 201 Created with a response body containing id, email, and created_at fields.
</claim>

<evidence>
--- File: src/routes/users.ts ---

// Imports
import { Router, Request, Response } from 'express';
import { UserModel } from '../models/user';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createUserSchema } from '../schemas/user';

// Entity: POST /api/users (lines 23-32)
router.post('/', validate(createUserSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await UserModel.create({ email, password });
  res.status(200).json({
    id: user.id,
    email: user.email,
    username: user.username
  });
});
</evidence>

Respond as JSON:
{
  "verdict": "verified" | "drifted" | "uncertain",
  "confidence": <0.0 to 1.0>,
  "severity": "high" | "medium" | "low" | null,
  "reasoning": "1-2 sentence explanation of your verdict",
  "specific_mismatch": "what exactly is wrong (null if verified or uncertain)",
  "suggested_fix": "corrected documentation text (null if verified or uncertain)",
  "evidence_files": ["files examined"]
}
```

### Response Received

```json
{
  "verdict": "drifted",
  "confidence": 0.97,
  "severity": "high",
  "reasoning": "The documentation claims POST /api/users returns 201 Created with fields id, email, and created_at. The actual code returns 200 OK (not 201) with fields id, email, and username (created_at is omitted, username is added). Both the status code and the response body shape have changed.",
  "specific_mismatch": "Documentation says '201 Created with { id, email, created_at }' but code returns 200 OK with { id, email, username }. Status code changed (201 -> 200), created_at removed, username added.",
  "suggested_fix": "POST /api/users returns 200 OK with a response body containing id, email, and username fields.",
  "evidence_files": ["src/routes/users.ts"]
}
```

**Token usage:** 412 input, 152 output. **Duration:** 1,820 ms. **Cost:** ~$0.003.

---

## Layer 4: Scan Run

```json
{
  "id": "scan-99887766-5544-3322-1100-aabbccddeeff",
  "repo_id": "repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f",
  "trigger_type": "manual",
  "trigger_ref": "87",
  "status": "completed",
  "commit_sha": "f4a8c3d1e2b3a4c5d6e7f8a9b0c1d2e3f4a5b6c7",
  "claims_checked": 15,
  "claims_drifted": 1,
  "claims_verified": 13,
  "claims_uncertain": 1,
  "total_token_cost": 1862,
  "total_duration_ms": 8450,
  "comment_posted": true,
  "check_run_id": 30001234,
  "started_at": "2026-02-11T14:00:00Z",
  "completed_at": "2026-02-11T14:00:09Z"
}
```

---

## Layer 5: Fix Generation (P-FIX)

L5 invokes a `fix_generation` agent task for the drifted finding. The P-FIX prompt generates corrected documentation text.

### P-FIX Prompt Sent

**System prompt:** _(as defined in phase4b-prompt-specs.md Section 5.2)_

**User prompt:**

```
Generate corrected documentation for this drifted claim.

<finding>
  <claim file="docs/api.md" line="21">POST /api/users returns 201 Created with a response body containing id, email, and created_at fields.</claim>
  <mismatch>Documentation says '201 Created with { id, email, created_at }' but code returns 200 OK with { id, email, username }. Status code changed (201 -> 200), created_at removed, username added.</mismatch>
  <evidence_files>src/routes/users.ts</evidence_files>
</finding>

Respond as JSON:
{
  "suggested_fix": {
    "file_path": "docs/api.md",
    "line_start": 21,
    "line_end": 21,
    "new_text": "the corrected documentation text",
    "explanation": "brief explanation of what changed"
  }
}
```

### P-FIX Response Received

```json
{
  "suggested_fix": {
    "file_path": "docs/api.md",
    "line_start": 21,
    "line_end": 27,
    "new_text": "**Response:** `200 OK`\n\n```json\n{\n  \"id\": \"uuid-string\",\n  \"email\": \"user@example.com\",\n  \"username\": \"johndoe\"\n}\n```",
    "explanation": "Updated status code from 201 to 200 and response body to show username instead of created_at."
  }
}
```

**Token usage:** 298 input, 87 output. **Duration:** 980 ms. **Cost:** ~$0.002.

### Constructed DocFix Object

The server constructs the full `DocFix` from the P-FIX response and finding context:

```json
{
  "file": "docs/api.md",
  "line_start": 21,
  "line_end": 27,
  "old_text": "**Response:** `201 Created`\n\n```json\n{\n  \"id\": \"uuid-string\",\n  \"email\": \"user@example.com\",\n  \"created_at\": \"2026-01-15T10:30:00Z\"\n}\n```",
  "new_text": "**Response:** `200 OK`\n\n```json\n{\n  \"id\": \"uuid-string\",\n  \"email\": \"user@example.com\",\n  \"username\": \"johndoe\"\n}\n```",
  "reason": "Updated status code from 201 to 200 and response body to show username instead of created_at.",
  "claim_id": "claim-c1a00001-aaaa-bbbb-cccc-000000000005",
  "confidence": 0.97
}
```

---

## Layer 5 Output: PR Summary Comment

The summary comment is posted via the GitHub Issues API. Since `docs/api.md` is NOT in the PR diff, the drifted finding appears in the summary with a note per TDD5-003 in phase4-decisions.md.

### Health Score Calculation

- `verified = 13`, `drifted = 1`, `uncertain = 1` (excluded from denominator per GATE42-002)
- `score = 13 / (13 + 1) = 0.9286` -> `93%`
- `scored_total = 13 + 1 = 14`

### Exact Comment Markdown

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id=scan-99887766-5544-3322-1100-aabbccddeeff -->

Found **1 documentation issue(s)** in this PR:

**13 verified** | **1 drifted** -- **93% health**

| Severity | File | Line | Issue |
|----------|------|------|-------|
| HIGH | `docs/api.md` | 21 | POST /api/users response status and body changed |

---

### HIGH: POST /api/users response status and body changed
**docs:** `docs/api.md` line 21
**claim:** "POST /api/users returns 201 Created with a response body containing id, email, and created_at fields."
**evidence:** `src/routes/users.ts`

The documentation claims POST /api/users returns 201 Created with fields id, email, and created_at. The actual code returns 200 OK (not 201) with fields id, email, and username (created_at is omitted, username is added). Both the status code and the response body shape have changed.

> This finding references `docs/api.md` which is not modified in this PR.

<details>
<summary>Suggested fix</summary>

```diff
- **Response:** `201 Created`
-
- ```json
- {
-   "id": "uuid-string",
-   "email": "user@example.com",
-   "created_at": "2026-01-15T10:30:00Z"
- }
- ```
+ **Response:** `200 OK`
+
+ ```json
+ {
+   "id": "uuid-string",
+   "email": "user@example.com",
+   "username": "johndoe"
+ }
+ ```
```
</details>

---

[**Apply all fixes**](https://app.docalign.dev/api/fix/apply?repo=repo-7f8e9d0c-1b2a-3c4d-5e6f-7a8b9c0d1e2f&scan_run_id=scan-99887766-5544-3322-1100-aabbccddeeff&token=hmac_def456) -- creates a commit on this PR branch with all documentation fixes.

---

Commit: `f4a8c3d` | Scanned at 2026-02-11T14:00:09Z
Repo health: 93% (13/14 claims verified)
```

---

## Layer 5 Output: Review Comments

**Not applicable.** Review comments are not part of the MVP output (GATE42-016). All findings are communicated via the summary comment above. The "Apply all fixes" link provides one-click fix application.

---

## Layer 5 Output: Check Run

```
Name:       DocAlign
Status:     completed
Conclusion: neutral
Title:      DocAlign: Found 1 documentation issue(s)
Summary:    Found 1 documentation issues (1 high). Health score: 93%.
```

The conclusion is `neutral` (non-blocking) per GATE42-003 (default `check.block_on_findings: false`).

---

## Anti-example

This scenario should NOT produce the following:

1. **Should NOT show uncertain claims in PR output.** The 1 uncertain claim (an architecture claim that could not be resolved) is excluded from the health line and the summary table per GATE42-002. The health line reads `**13 verified** | **1 drifted** -- **93% health**` -- no uncertain count appears.

2. **Should NOT block the PR.** The Check Run conclusion is `neutral`, not `action_required` or `failure`. Even though the finding is HIGH severity, the default configuration does not block. Only if `check.block_on_findings: true` and `check.min_severity_to_block: "high"` were set would the conclusion be `action_required`.

3. **Should NOT post inline review comments (deferred to post-MVP per GATE42-016).** All findings are communicated via the summary comment. The "Apply all fixes" link (GATE42-019) provides one-click fix application for all drifted findings.

4. **Should NOT include a reaction feedback prompt or dismiss-all link.** Per GATE42-005, reaction-based feedback and dismiss-all are deferred to post-MVP.

5. **Should NOT report the `api_route` syntactic claim as drifted.** The route `POST /api/users` still exists in the codebase. Tier 1 verification correctly reports it as `verified`. The drift is in the behavior (status code + response shape), not the route existence.

6. **Should NOT edit or delete any previous summary comments.** Each scan produces a new summary comment. Old comments are left as-is per GATE42-008.

7. **Should NOT count the uncertain claim in the health score denominator.** Health = `verified / (verified + drifted)` = `13 / 14 = 93%`. The uncertain claim is excluded from both numerator and denominator per the health score formula in phase4c-ux-specs.md Section 11.1.

---

## Integration Example IE-03: Clean PR -- No Drift Detected

> Part of [Phase 5A: Integration Golden Examples](phase5-integration-examples.md)
>
> **Scenario:** A developer adds a new internal utility function to a file that no documentation claims reference. No doc files are changed. The developer explicitly requests a review via `@docalign review`. DocAlign confirms it ran and found nothing in scope.
>
> **Key layers exercised:** L4 (scope resolution) -> L5 (reporter)
>
> **LLM calls:** None. Pipeline short-circuits at L4 scope resolution. L0, L1, L2, L3 are NOT exercised for verification in this example.

---

### Scenario

A REST API project has existing documentation with 20 verified claims across `README.md` and `docs/api.md`. A developer opens PR #18 adding a new internal utility function `formatDate` to `src/utils/helpers.ts`. No documentation references this file. The developer comments `@docalign review` to trigger a scan. DocAlign runs scope resolution, determines zero claims are affected, posts a confirmation comment, and completes the Check Run with `success`.

---

### Trigger

The developer posts a comment on PR #18:

```
Updated the date formatting, @docalign review please
```

GitHub fires an `issue_comment.created` webhook:

```json
{
  "action": "created",
  "issue": {
    "number": 18,
    "pull_request": {
      "url": "https://api.github.com/repos/acme/rest-api/pulls/18"
    }
  },
  "comment": {
    "id": 2048576001,
    "body": "Updated the date formatting, @docalign review please",
    "user": { "login": "devjane" }
  },
  "repository": {
    "id": 801234567,
    "full_name": "acme/rest-api",
    "owner": { "login": "acme" },
    "name": "rest-api"
  },
  "installation": { "id": 51234567 }
}
```

**Server actions on receipt:**

1. Regex match: `/\b@docalign\s+review\b/i` matches in `comment.body`.
2. Add `:eyes:` reaction to comment ID `2048576001` (instant acknowledgment).
3. Fetch PR details for `pulls/18` to get `head.sha`.
4. Call `enqueuePRScan("repo-f47ac10b-58cc-4372-a567-0e02b2c3d479", 18, "e4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9", 51234567, "gh-delivery-ie03-001")`.

---

### Input: Repository State

**File tree (relevant subset):**

```
acme/rest-api/
  README.md
  docs/
    api.md
  src/
    routes/
      users.ts
      auth.ts
    utils/
      helpers.ts        <-- changed in this PR
    middleware/
      pagination.ts
  package.json
  .docalign.yml          <-- absent (using defaults, per GATE42-015)
```

**README.md** (contains claims about routes and auth, NOT about helpers.ts):

```markdown
# REST API

A REST API built with Express and TypeScript.

## Getting Started

Install dependencies with `npm install`, then run `npm run dev`.

## Authentication

Authentication is handled in `src/routes/auth.ts` using JWT tokens.

## API Endpoints

- `GET /api/users` - List all users
- `POST /api/users` - Create a new user

See `docs/api.md` for full API documentation.
```

**docs/api.md** (contains claims about routes and pagination, NOT about helpers.ts):

```markdown
# API Reference

## Users

### GET /api/users

Returns a paginated list of users. Default page size is 25.

### POST /api/users

Creates a new user. Requires `name` and `email` fields.

### GET /api/users/:id

Returns a single user by ID.
```

**src/utils/helpers.ts** (the file being changed in this PR -- showing state AFTER the PR):

```typescript
/**
 * General utility functions.
 */

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
}

// New function added in this PR
export function formatDate(date: Date, locale: string = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
```

**Existing claims in the database** (20 claims from prior full scan, all verified):

| Claim ID | Source File | Line | Claim Type | Claim Text (abbreviated) | Mapped Code Files |
|----------|------------|------|-----------|--------------------------|-------------------|
| `c-3a1b2c3d-...01` | README.md | 7 | command | "Install dependencies with `npm install`" | package.json |
| `c-3a1b2c3d-...02` | README.md | 7 | command | "run `npm run dev`" | package.json |
| `c-3a1b2c3d-...03` | README.md | 11 | path_reference | "handled in `src/routes/auth.ts`" | src/routes/auth.ts |
| `c-3a1b2c3d-...04` | README.md | 11 | behavior | "using JWT tokens" | src/routes/auth.ts |
| `c-3a1b2c3d-...05` | README.md | 15 | api_route | "GET /api/users - List all users" | src/routes/users.ts |
| `c-3a1b2c3d-...06` | README.md | 16 | api_route | "POST /api/users - Create a new user" | src/routes/users.ts |
| `c-3a1b2c3d-...07` | README.md | 18 | path_reference | "See `docs/api.md`" | docs/api.md |
| `c-3a1b2c3d-...08` | docs/api.md | 7 | api_route | "GET /api/users" | src/routes/users.ts |
| `c-3a1b2c3d-...09` | docs/api.md | 9 | behavior | "Default page size is 25" | src/middleware/pagination.ts |
| `c-3a1b2c3d-...10` | docs/api.md | 11 | api_route | "POST /api/users" | src/routes/users.ts |
| `c-3a1b2c3d-...11` | docs/api.md | 13 | behavior | "Requires `name` and `email` fields" | src/routes/users.ts |
| `c-3a1b2c3d-...12` | docs/api.md | 15 | api_route | "GET /api/users/:id" | src/routes/users.ts |
| ... | ... | ... | ... | ... | ... |
| `c-3a1b2c3d-...20` | docs/api.md | ... | ... | *(8 more claims across docs/api.md)* | ... |

**Key observation:** No claim in the database maps to `src/utils/helpers.ts`. The `claim_mappings` table has zero rows where `code_file = 'src/utils/helpers.ts'`.

---

### Input: PR Diff

The PR modifies a single file:

```diff
diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts
index a1b2c3d..e4f5g6h 100644
--- a/src/utils/helpers.ts
+++ b/src/utils/helpers.ts
@@ -5,3 +5,14 @@
 export function slugify(text: string): string {
   return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
 }
+
+// New function added in this PR
+export function formatDate(date: Date, locale: string = 'en-US'): string {
+  return new Intl.DateTimeFormat(locale, {
+    year: 'numeric',
+    month: 'long',
+    day: 'numeric',
+  }).format(date);
+}
```

**GitHub PR Files API response** (`GET /repos/acme/rest-api/pulls/18/files`):

```json
[
  {
    "filename": "src/utils/helpers.ts",
    "status": "modified",
    "additions": 11,
    "deletions": 0,
    "patch": "@@ -5,3 +5,14 @@ ... (unified diff above)"
  }
]
```

---

### Layer 4: Scope Resolution

The L4 worker (`processPRScan`) executes the following steps:

**Step 1: Transition to running, create Check Run.**

```
updateScanStatus("scan-b7e8f9a0-1c2d-4e3f-a5b6-c7d8e9f0a1b2", "running")
github.createCheckRun("acme", "rest-api", {
  name: "DocAlign",
  head_sha: "e4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
  status: "in_progress",
  title: "DocAlign: Scanning documentation..."
})
// check_run_id = 9876543210
```

**Step 2: Fetch PR diff.**

```
diffFiles = github.getPRFiles("acme", "rest-api", 18, 51234567)
// Returns: [{ filename: "src/utils/helpers.ts", status: "modified", additions: 11, deletions: 0 }]
```

**Step 3: Classify changed files.**

```
classified = classifyFiles(diffFiles, defaultConfig)
// Result:
//   code_files:  [{ filename: "src/utils/helpers.ts", status: "modified", additions: 11, deletions: 0 }]
//   doc_files:   []       <-- no doc files changed
//   renames:     []
//   deletions:   []
```

**Step 4: L0 index update.**

```
L0.updateFromDiff("repo-f47ac10b-58cc-4372-a567-0e02b2c3d479", diffFiles)
// Result: { entities_added: 1, entities_updated: 0, entities_removed: 0, files_skipped: [] }
// The new formatDate function is indexed. (Index update is always performed regardless of scope.)
```

**Step 5: Doc file processing -- SKIPPED.**

No doc files changed. No extraction, no re-extraction, no claim deletion. Steps 5a-5d are no-ops.

**Step 6: Resolve scope.**

This is the critical step for IE-03:

```
codeFilePaths = ["src/utils/helpers.ts"]
docFilePaths  = []

allClaims = resolveScope(
  "repo-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  codeFilePaths,       // ["src/utils/helpers.ts"]
  docFilePaths         // []
)
```

Inside `resolveScope`:

1. **Changed doc files:** `docFilePaths = []` -- no doc files changed, so no claims from doc files.
2. **Reverse index lookup:** `L2.findClaimsByCodeFiles("repo-f47ac10b-...", ["src/utils/helpers.ts"])` executes:

```sql
SELECT DISTINCT c.*
FROM claims c
JOIN claim_mappings m ON c.id = m.claim_id
WHERE m.code_file = ANY(ARRAY['src/utils/helpers.ts'])
  AND m.repo_id = 'repo-f47ac10b-58cc-4372-a567-0e02b2c3d479'
ORDER BY c.source_file, c.line_number;
```

**Result: 0 rows.** No claims have a `claim_mapping` with `code_file = 'src/utils/helpers.ts'`.

3. **Final result:** `allClaims = []` -- zero claims in scope.

**Steps 7-14 short-circuit.** With zero claims in scope:
- Step 7 (filter suppressed): no claims to filter.
- Step 8 (prioritize/cap): no claims to prioritize.
- Steps 9-11 (verification): no claims to verify. No deterministic checks, no agent tasks, no repository dispatch.
- Step 12 (merge results): no results to merge.
- Step 13 (post PR comment): proceeds with zero-findings payload.

---

### Layer 4: Scan Run

The `ScanRun` record after completion:

```json
{
  "id": "scan-b7e8f9a0-1c2d-4e3f-a5b6-c7d8e9f0a1b2",
  "repo_id": "repo-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "trigger_type": "manual",
  "trigger_ref": "18",
  "status": "completed",
  "commit_sha": "e4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
  "claims_checked": 0,
  "claims_drifted": 0,
  "claims_verified": 0,
  "claims_uncertain": 0,
  "total_token_cost": 0,
  "total_duration_ms": 320,
  "comment_posted": true,
  "check_run_id": 9876543210,
  "started_at": "2026-02-11T14:22:59.800Z",
  "completed_at": "2026-02-11T14:23:00.120Z"
}
```

**Notes on the ScanRun:**
- `claims_checked: 0` -- no claims were in scope, so none were checked.
- `claims_verified: 0` -- not a contradiction; it means zero claims needed verification in this PR.
- `total_token_cost: 0` -- no LLM calls were made.
- `total_duration_ms: 320` -- very fast. Only L0 index update (~150ms), PR diff fetch (~100ms), scope resolution query (~20ms), comment posting (~50ms for GitHub API latency).
- `trigger_type: "manual"` -- triggered by `@docalign review` command.

---

### Layer 5 Output: PR Summary Comment

L5 is called with a payload representing zero findings and the existing repo-wide health score:

```
L5.postPRComment("acme", "rest-api", 18, {
  findings: [],
  health_score: {
    total_claims: 20,
    verified: 20,
    drifted: 0,
    uncertain: 0,
    pending: 0,
    score: 1.0,
    by_file: {
      "README.md": { total: 7, verified: 7, drifted: 0, uncertain: 0 },
      "docs/api.md": { total: 13, verified: 13, drifted: 0, uncertain: 0 }
    },
    by_type: {
      "api_route": 5,
      "behavior": 3,
      "command": 2,
      "path_reference": 3,
      "dependency_version": 4,
      "config": 2,
      "code_example": 1
    },
    hotspots: []
  },
  scan_run_id: "scan-b7e8f9a0-1c2d-4e3f-a5b6-c7d8e9f0a1b2",
  agent_unavailable_pct: 0
}, 51234567)
```

L5 determines the outcome as `no_claims_in_scope` (zero findings, zero claims checked) and renders the **Section 2.3** template per GATE42-001 (full-format summary comment even for clean PRs):

**Exact markdown posted via `POST /repos/acme/rest-api/issues/18/comments`:**

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id=scan-b7e8f9a0-1c2d-4e3f-a5b6-c7d8e9f0a1b2 -->

No documentation claims are affected by the changes in this PR.

**20 verified** | **0 drifted** -- **100% health**

Commit: `e4a1b2c` | Scanned at 2026-02-11T14:23:00Z
Repo health: 100% (20/20 claims verified)
```

**Format compliance notes:**
- Header: `## DocAlign: Documentation Health Check` -- standard header per all templates.
- Hidden marker: `<!-- docalign-summary scan-run-id=... -->` -- for deduplication and tracking.
- Body: "No documentation claims are affected by the changes in this PR." -- per Section 2.3 template.
- Health line: `**20 verified** | **0 drifted** -- **100% health**` -- per GATE42-002 (no uncertain count in health line). Formula: `score = 20 / (20 + 0) = 1.0`, displayed as `100%`.
- Footer: Commit SHA (first 7 chars) + timestamp + repo health with claim ratio.
- No `agent_unavailable_banner` (0% unavailable).
- No `force_push_warning` (HEAD SHA matches scan SHA).
- No `config_warnings` (no `.docalign.yml` issues; using defaults).

---

### Layer 5 Output: Review Comments

**Not applicable.** Review comments are not part of the MVP output (GATE42-016). No findings exist in this scan, and no "Apply all fixes" link is shown (no fixes to apply).

---

### Layer 5 Output: Check Run

The Check Run is updated to completed:

```
octokit.checks.update({
  owner: "acme",
  repo: "rest-api",
  check_run_id: 9876543210,
  status: "completed",
  conclusion: "success",
  output: {
    title: "DocAlign: No claims in scope",
    summary: "No documentation claims are affected by this PR."
  }
})
```

**Check Run fields:**

| Field | Value |
|-------|-------|
| Name | `DocAlign` |
| Status | `completed` |
| Conclusion | `success` |
| Title | `DocAlign: No claims in scope` |
| Summary | `No documentation claims are affected by this PR.` |

**Per GATE42-003:** The conclusion is `success`, not `neutral`. `neutral` is reserved for PRs where findings exist but are non-blocking. A clean PR with no claims in scope is a success.

**Per Section 3.2 of phase4c-ux-specs:**

| Event | Status | Conclusion | Title |
|-------|--------|------------|-------|
| No claims in scope | `completed` | `success` | `DocAlign: No claims in scope` |

---

### Anti-example

This example should **NOT** produce any of the following:

1. **Should NOT skip posting a comment.** The developer explicitly asked for a review via `@docalign review`. Silence would be confusing -- the developer needs confirmation that DocAlign ran and found nothing relevant. Per GATE42-001, clean PRs still receive a full-format summary comment.

2. **Should NOT show uncertain claims in the health line.** Per GATE42-002, the health line is `**{verified} verified** | **{drifted} drifted** -- **{score_pct}% health**`. No uncertain count. Even though `HealthScore.uncertain` may be 0, it is not rendered.

3. **Should NOT display "0 issues" in a way that implies nothing was checked vs nothing was found.** The message "No documentation claims are affected by the changes in this PR" is clear: the PR's changes do not overlap with any documented claims. This is distinct from "we checked claims and they all passed" (which would be Section 2.2's "All N claims verified" message).

4. **Should NOT verify ALL claims in the repo.** Scope resolution limits verification to claims affected by the PR diff. Since no claims map to `src/utils/helpers.ts` and no doc files changed, zero claims are in scope. The 20 existing claims retain their existing verification status from prior scans -- they are not re-verified.

5. **Should NOT use Check Run conclusion `neutral`.** Per GATE42-003, `neutral` means "findings exist but non-blocking." No claims in scope means `success`.

6. **Should NOT create any agent tasks or trigger a repository dispatch.** With zero claims to verify, there is no work for the GitHub Action agent. `total_token_cost: 0`.

7. **Should NOT show a health line of `Scanning...`.** The repo has been scanned before (20 verified, 0 drifted). The denominator `verified + drifted = 20` is non-zero, so a percentage is displayed (100%), not "Scanning...".

8. **Should NOT post the "All N claims verified" template (Section 2.2).** That template is for when claims ARE in scope and all pass verification. IE-03 is a "No Claims in Scope" case (Section 2.3) -- qualitatively different. The distinction matters: Section 2.2 implies claims were checked; Section 2.3 implies the PR is out of scope entirely.

---

## Integration Example IE-04: Apply Fix Commit

> **"DocAlign" is a working title.** Final product name TBD.
>
> **Purpose:** Traces the complete flow when a developer clicks the "Apply all fixes" link from a DocAlign summary comment. This is NOT a scan pipeline -- it is a fix-application flow triggered by a user action.
>
> **Key decisions:** GATE42-019, GATE42-022, GATE42-023, GATE42-024, GATE42-025, GATE42-028, GATE42-029, GATE42-031

---

### Scenario

A prior scan of PR #47 on `amara-dev/taskflow` found 2 drifted findings: a version drift in `README.md` and a behavior drift in `docs/api.md`. DocAlign posted a summary comment with diff blocks and an "Apply all fixes" link at the bottom. The developer clicks that link.

**Pipeline path:** HTTP GET to fix endpoint -> HMAC validation -> PR state check -> confirmation page -> HTTP POST -> re-validate HMAC -> re-check PR state -> branch state fetch -> fix application -> commit creation -> confirmation comment -> result page.

**Repo context:** Same `amara-dev/taskflow` repo from IE-01. `repo_id = "repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b"`. Installation ID `55001`.
(Note: IE-01 uses the shorthand `repo-tf-001` for the same repo. In implementation, repo IDs are UUIDs.)

---

### Precondition: Prior Scan Results

The scan `scan_run_id = "scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4"` ran against commit `a1b2c3d` on PR branch `fix/update-pagination`. It produced 2 drifted findings with fixes:

**Finding 1 -- Version drift in README.md:**

```typescript
const fix1: DocFix = {
  file: "README.md",
  line_start: 45,
  line_end: 45,
  old_text: "This project uses express@4.18.2 for the HTTP server.",
  new_text: "This project uses express@4.19.0 for the HTTP server.",
  reason: "package.json shows express@4.19.0, not 4.18.2",
  claim_id: "claim-1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6",
  confidence: 1.0
};
```

**Finding 2 -- Behavior drift in docs/api.md:**

```typescript
const fix2: DocFix = {
  file: "docs/api.md",
  line_start: 201,
  line_end: 201,
  old_text: "API returns 20 items per page by default.",
  new_text: "API returns 25 items per page by default.",
  reason: "src/api/middleware/pagination.ts sets DEFAULT_PAGE_SIZE = 25",
  claim_id: "claim-2b3c4d5e-6f7a-8b9c-0d1e-f2a3b4c5d6e7",
  confidence: 0.95
};
```

The summary comment posted on PR #47 included both findings with diff blocks and this link at the bottom:

```markdown
[Apply all fixes](https://app.docalign.dev/api/fix/apply?repo=repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b&scan_run_id=scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4&token=f7c8a9b0e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8)
```

---

### Input: User Clicks "Apply All Fixes"

The developer `amara-dev` clicks the link. The browser sends:

```http
GET /api/fix/apply?repo=repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b&scan_run_id=scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4&token=f7c8a9b0e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8 HTTP/1.1
Host: app.docalign.dev
```

No user authentication is required. The HMAC token is the sole security layer (GATE42-025). Anyone with the link can apply the fixes -- the link itself is the credential.

---

### Step 1: HMAC Validation

The server extracts the URL parameters:

```
repo        = "repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b"
scan_run_id = "scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4"
token       = "f7c8a9b0e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8"
```

(The URL parameter is named `repo`; this is the same value as `repo_id` used in the HMAC computation.)

The server computes the expected HMAC:

```
expected = HMAC-SHA256(
  key:  DOCALIGN_API_SECRET,
  data: "repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b:scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4"
)
```

The server uses a timing-safe comparison (`crypto.timingSafeEqual`) to compare the expected HMAC with the provided `token`.

**Result:** Match. Proceed to Step 2.

**Failure case:** If the token does not match, the server returns:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{ "error": "Invalid fix token." }
```

---

### Step 2: PR State Check

The server looks up `scan_run_id = "scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4"` in the database to find the associated PR:

```typescript
const scanRun: ScanRun = {
  id: "scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4",
  repo_id: "repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b",
  trigger_type: "manual",
  trigger_ref: "47",
  status: "completed",
  commit_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  claims_checked: 12,
  claims_drifted: 2,
  claims_verified: 10,
  claims_uncertain: 0,
  // ...
};
```

The server fetches the PR to check its state (GATE42-028):

```http
GET /repos/amara-dev/taskflow/pulls/47
Authorization: Bearer ghs_installation_token_55001
Accept: application/vnd.github+json
```

**Response (relevant fields):**

```json
{
  "number": 47,
  "head": {
    "ref": "fix/update-pagination",
    "sha": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1"
  },
  "state": "open"
}
```

The server checks `"state": "open"`. Only open PRs are eligible for fix application. If the PR has been merged or closed since the scan, fixes cannot be applied.

**Result:** PR is open. Proceed.

**Failure case:** If `state` is `"closed"` or `"merged"`:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{ "error": "This PR is no longer open. Fixes cannot be applied." }
```

---

### Two-Phase Flow: GET Returns Confirmation Page, POST Applies Fixes (GATE42-029)

The fix-application flow uses a GET->Confirmation->POST pattern to prevent accidental state mutation from link clicks.

**Phase 1 (GET -- this request):** After HMAC validation (Step 1) and PR state check (Step 2), the server looks up the scan to count available fixes. It does NOT apply any fixes. Instead, it returns a confirmation HTML page:

```html
<!DOCTYPE html>
<html>
<head><title>DocAlign - Confirm Fix Application</title></head>
<body>
  <h1>Apply Documentation Fixes</h1>
  <p>Apply <strong>2 fixes</strong> to PR <strong>#47</strong> on <strong>amara-dev/taskflow</strong>?</p>
  <ul>
    <li><code>README.md</code> line 45: Update express version reference</li>
    <li><code>docs/api.md</code> line 201: Update default pagination limit</li>
  </ul>
  <form method="POST" action="/api/fix/apply">
    <input type="hidden" name="repo" value="repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b" />
    <input type="hidden" name="scan_run_id" value="scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4" />
    <input type="hidden" name="token" value="f7c8a9b0e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8" />
    <button type="submit">Confirm</button>
  </form>
</body>
</html>
```

The developer reviews the summary and clicks "Confirm."

**Phase 2 (POST):** The browser sends:

```http
POST /api/fix/apply HTTP/1.1
Host: app.docalign.dev
Content-Type: application/x-www-form-urlencoded

repo=repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b&scan_run_id=scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4&token=f7c8a9b0e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8
```

The server re-validates the HMAC (Step 1 logic) and re-checks that the PR is still open (Step 2 logic). Both must pass again -- the PR could have been merged between the GET and the POST. If either check fails, the server returns the appropriate error.

**Idempotency note (GATE42-031):** There is no idempotency protection. If the user clicks "Confirm" twice (e.g., double-click), the second POST will attempt to apply fixes again. Since the first POST already applied the text replacements, the `old_text` values will no longer match, and all fixes will fail. The server will post an "all fixes fail" comment. This is acceptable behavior.

After re-validation succeeds, the server proceeds to Step 3.

---

### Step 3: Fetch Latest Branch State

The server reuses the PR data already fetched in Step 2. The latest commit on the PR branch is `b2c3d4e`, which differs from the scan's `commit_sha` (`a1b2c3d`). The branch has received 1 new commit since the scan ran. This is expected -- the server will apply fixes to the **current** file contents, not the scan-time contents.

The server fetches the fixes stored for this scan run from the database:

```sql
SELECT * FROM doc_fixes
WHERE scan_run_id = 'scan-e71a2b3c-9d4e-5f6a-b7c8-d9e0f1a2b3c4'
  AND repo_id = 'repo-bf29a3c1-4e8d-4a17-b6f0-1c9d2e3f4a5b'
ORDER BY file, line_start;
```

This returns `fix1` and `fix2` from the precondition above.

---

### Step 4: Apply Fixes

For each `DocFix`, the server fetches the current file content from the latest commit on the PR branch and attempts to apply the text replacement.

**Fix 1: README.md**

Fetch current content:

```http
GET /repos/amara-dev/taskflow/contents/README.md?ref=fix/update-pagination
Authorization: Bearer ghs_installation_token_55001
Accept: application/vnd.github.raw+json
```

**Response:** The raw file content. The server searches for the `old_text`:

```
old_text: "This project uses express@4.18.2 for the HTTP server."
```

Found at line 45. The text has not changed since the scan, despite the new commit (the new commit modified a different file). The server replaces it with `new_text`:

```
new_text: "This project uses express@4.19.0 for the HTTP server."
```

**Result:** Fix 1 applied successfully.

**Fix 2: docs/api.md**

Fetch current content:

```http
GET /repos/amara-dev/taskflow/contents/docs/api.md?ref=fix/update-pagination
Authorization: Bearer ghs_installation_token_55001
Accept: application/vnd.github.raw+json
```

**Response:** The raw file content. The server searches for:

```
old_text: "API returns 20 items per page by default."
```

Found at line 201. The text is unchanged. The server replaces with:

```
new_text: "API returns 25 items per page by default."
```

**Result:** Fix 2 applied successfully. Both fixes applied. Proceed to commit.

**Application logic (pseudocode):**

```typescript
const appliedFixes: DocFix[] = [];
const failedFixes: Array<{ fix: DocFix; reason: string }> = [];
const modifiedFiles: Map<string, string> = new Map(); // file -> new content

for (const fix of fixes) {
  const content = await fetchFileContent(owner, repo, fix.file, headRef);
  const existingContent = modifiedFiles.get(fix.file) ?? content;

  if (!existingContent.includes(fix.old_text)) {
    failedFixes.push({
      fix,
      reason: `Target text in ${fix.file} has changed since the scan.`
    });
    continue;
  }

  // Note: Use a replacer function to avoid $-pattern interpretation in new_text:
  const newContent = existingContent.replace(fix.old_text, () => fix.new_text);
  modifiedFiles.set(fix.file, newContent);
  appliedFixes.push(fix);
}
```

Note: if multiple fixes target the same file, the server applies them sequentially to the same in-memory content, so later fixes see the result of earlier fixes.

---

### Step 5: Create Commit

The server creates a commit on the PR branch using the GitHub Git Trees API. This is a three-step process: create blobs, create a tree, create a commit.

**Step 5a: Create blobs for modified files.**

For each modified file, create a blob with the new content:

```http
POST /repos/amara-dev/taskflow/git/blobs
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "content": "<base64-encoded content of README.md with fix applied>",
  "encoding": "base64"
}
```

**Response:**

```json
{
  "sha": "aaa111bbb222ccc333ddd444eee555fff666aaa1",
  "url": "https://api.github.com/repos/amara-dev/taskflow/git/blobs/aaa111b"
}
```

Same for `docs/api.md`:

```http
POST /repos/amara-dev/taskflow/git/blobs
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "content": "<base64-encoded content of docs/api.md with fix applied>",
  "encoding": "base64"
}
```

**Response:**

```json
{
  "sha": "bbb222ccc333ddd444eee555fff666aaa111bbb2",
  "url": "https://api.github.com/repos/amara-dev/taskflow/git/blobs/bbb222c"
}
```

**Step 5b: Create a new tree based on the latest commit's tree.**

First, get the current commit's tree SHA:

```http
GET /repos/amara-dev/taskflow/git/commits/b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1
Authorization: Bearer ghs_installation_token_55001
```

**Response (relevant fields):**

```json
{
  "sha": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
  "tree": {
    "sha": "tree-aaa111bbb222ccc333ddd444eee555fff666aaa1"
  }
}
```

Create the new tree with the modified files:

```http
POST /repos/amara-dev/taskflow/git/trees
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "base_tree": "tree-aaa111bbb222ccc333ddd444eee555fff666aaa1",
  "tree": [
    {
      "path": "README.md",
      "mode": "100644",
      "type": "blob",
      "sha": "aaa111bbb222ccc333ddd444eee555fff666aaa1"
    },
    {
      "path": "docs/api.md",
      "mode": "100644",
      "type": "blob",
      "sha": "bbb222ccc333ddd444eee555fff666aaa111bbb2"
    }
  ]
}
```

**Response:**

```json
{
  "sha": "tree-ccc333ddd444eee555fff666aaa111bbb222ccc3",
  "url": "https://api.github.com/repos/amara-dev/taskflow/git/trees/tree-ccc333d"
}
```

**Step 5c: Create the commit.**

```http
POST /repos/amara-dev/taskflow/git/commits
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "message": "docs: fix documentation drift detected by DocAlign",
  "tree": "tree-ccc333ddd444eee555fff666aaa111bbb222ccc3",
  "parents": ["b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1"],
  "author": {
    "name": "docalign[bot]",
    "email": "noreply@docalign.dev",
    "date": "2026-02-11T15:10:00Z"
  },
  "committer": {
    "name": "docalign[bot]",
    "email": "noreply@docalign.dev",
    "date": "2026-02-11T15:10:00Z"
  }
}
```

**Response:**

```json
{
  "sha": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
  "message": "docs: fix documentation drift detected by DocAlign",
  "author": {
    "name": "docalign[bot]",
    "email": "noreply@docalign.dev",
    "date": "2026-02-11T15:10:00Z"
  }
}
```

**Step 5d: Update the branch ref to point to the new commit.**

```http
PATCH /repos/amara-dev/taskflow/git/refs/heads/fix/update-pagination
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "sha": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
  "force": false
}
```

**Response:**

```json
{
  "ref": "refs/heads/fix/update-pagination",
  "object": {
    "sha": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
    "type": "commit"
  }
}
```

`force: false` ensures the update is a fast-forward. If someone pushed to the branch between Step 3 and now, this call fails with HTTP 422, and the server returns an error to the user asking them to retry.

---

### Step 6: Post Confirmation Comment

The server posts a confirmation comment on PR #47:

```http
POST /repos/amara-dev/taskflow/issues/47/comments
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "body": "Applied 2 documentation fixes in commit c3d4e5f.\n\n- `README.md` line 45: Updated express version reference (4.18.2 -> 4.19.0)\n- `docs/api.md` line 201: Updated default pagination limit (20 -> 25)"
}
```

The comment is concise and lists what was changed so the developer can verify at a glance.

---

### Output: Updated PR State

After the fix commit, the PR looks like this:

**Commit history on `fix/update-pagination`:**

1. `a1b2c3d` -- Original PR commits (developer)
2. `b2c3d4e` -- Additional commit since scan (developer)
3. **`c3d4e5f`** -- `docs: fix documentation drift detected by DocAlign` (docalign[bot])

**PR comments:**

1. DocAlign summary comment (from the scan) -- contains findings and "Apply all fixes" link
2. **New:** "Applied 2 documentation fixes in commit c3d4e5f." (confirmation)

**Next scan behavior:** If the developer triggers `@docalign review` again, the new scan runs against the latest commit (`c3d4e5f`) which includes the fixed documentation. The two previously drifted claims should now verify as correct. The commit by `docalign[bot]` does NOT auto-trigger a new scan (bot commits are filtered out by the webhook handler, per standard GitHub App behavior).

---

### Error Scenario: Partial Failure

**Alternative flow:** The developer clicks "Apply all fixes," but since the scan, someone pushed a commit that edited `docs/api.md` -- specifically, they rewrote line 201 to say "API uses cursor-based pagination." The `old_text` from fix2 no longer exists in the file.

**Step 4 (Partial):**

Fix 1 (README.md): `old_text` found. Applied successfully.

Fix 2 (docs/api.md): `old_text` ("API returns 20 items per page by default.") NOT found in the current file content. The text was changed by the intervening commit.

```typescript
failedFixes.push({
  fix: fix2,
  reason: "Target text in docs/api.md has changed since the scan."
});
```

**Step 5 (Partial):** The server proceeds to commit with only the README.md fix. The tree includes only one modified blob (README.md). The commit is created normally.

**Step 6 (Partial Failure Comment):**

```http
POST /repos/amara-dev/taskflow/issues/47/comments
Authorization: Bearer ghs_installation_token_55001
Content-Type: application/json

{
  "body": "Applied 1 of 2 documentation fixes in commit c3d4e5f.\n\n**Applied:**\n- `README.md` line 45: Updated express version reference (4.18.2 -> 4.19.0)\n\n**Could not apply:**\n- `docs/api.md` line 201: Target text has changed since the scan. Run `@docalign review` to rescan."
}
```

The comment clearly separates applied fixes from failed ones and tells the developer what to do next (rescan to get fresh findings and fixes for the changed file).

**Edge case -- all fixes fail:** If no fixes can be applied (all `old_text` values have changed), the server does NOT create a commit. It posts a comment:

```
Could not apply documentation fixes. The target files have changed since the scan. Run `@docalign review` to re-scan.
```

---

### Anti-example

What this flow should NOT do:

- **Should NOT apply fixes on a merged or closed PR (GATE42-028).** The PR state check in Step 2 must reject PRs that are no longer open. If a developer clicks the "Apply all fixes" link after the PR has been merged or closed, the server returns HTTP 400: "This PR is no longer open. Fixes cannot be applied."

- **Should NOT apply fixes on GET request directly (GATE42-029).** The GET request returns a confirmation page showing fix details. Only the POST request (triggered by clicking "Confirm") actually applies fixes. This prevents accidental state mutation from link prefetching, crawlers, or misclicks.

- **Should NOT apply fixes without re-reading the latest file state.** The server must always fetch file contents from the current HEAD of the PR branch, not from the scan-time snapshot. Applying fixes to stale content would create merge conflicts or overwrite intervening changes.

- **Should NOT silently skip failed fixes.** Every fix that cannot be applied must be reported in the confirmation comment with a reason. The developer needs to know which documentation is still drifted.

- **Should NOT trigger a new scan.** The commit is authored by `docalign[bot]`. The webhook handler ignores bot-authored pushes to prevent infinite scan loops. The developer must explicitly trigger a rescan with `@docalign review`.

- **Should NOT apply fixes from a different scan_run_id.** The HMAC binds the `repo_id` and `scan_run_id` together. Even if the URL parameters are tampered with (e.g., substituting a different `scan_run_id`), the HMAC validation in Step 1 will reject the request.

- **Should NOT work with an invalid or expired HMAC token.** The HMAC is deterministic (not time-based), so it does not expire in the traditional sense. However, if the `DOCALIGN_API_SECRET` is rotated, all previously generated HMAC tokens become invalid. The server must reject them.

- **Should NOT use `force: true` when updating the branch ref.** The ref update must be a fast-forward to avoid overwriting concurrent pushes. If the fast-forward fails (HTTP 422), the server should return an error asking the user to retry.

- **Should NOT create an empty commit.** If all fixes fail to apply, no commit is created. The server only posts an explanatory comment.
