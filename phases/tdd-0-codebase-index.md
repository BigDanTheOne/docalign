# TDD-0: Codebase Index (Layer 0)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 2), phase3-architecture.md, phase3-integration-specs.md, phase3-decisions.md, phase3-error-handling.md, technical-reference.md (Sections 3.1, 6), prd/L0-codebase-index.md
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 0 (Codebase Index) builds and maintains a lightweight, doc-verification-optimized representation of a repository's source code, file structure, package metadata, and API routes. It is the foundational data layer consumed by every other DocAlign layer -- L1 (claim extraction keywords), L2 (claim-to-code mapping), L3 (deterministic verification + evidence assembly), and L4 (incremental index updates on PR/push).

The index is entirely server-side and deterministic (zero LLM calls). It uses tree-sitter WASM for AST parsing, direct file parsing for package manifests, and pgvector for semantic search over entity embeddings. Embedding generation itself is client-side (GitHub Action), but storage and querying are server-side.

**Boundaries:** L0 does NOT extract claims, map claims to code, or verify claims. It provides the lookup primitives that other layers compose.

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| GitHub API (via L4 Worker) | Raw file content (source code, manifests) | Full scan (clone) or PR scan (API fetch) |
| GitHub API (via L4 Worker) | `FileChange[]` from PR diff | Incremental update on PR/push |
| PostgreSQL (pgvector) | Stored embeddings for cosine similarity search | `searchSemantic()` queries |
| GitHub Action (client) | Generated embedding vectors (`number[1536]`) | Stored via `updateFromDiff` or full index |
| `.docalign.yml` config | `code_patterns.include/exclude`, `llm.embedding_dimensions` | File filtering during indexing |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| L2 (Mapper) | `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `searchRoutes`, `getDependencyVersion` | Claim mapping Steps 1-3 |
| L3 (Verifier) | `fileExists`, `findSymbol`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getAvailableScripts`, `getEntityByFile`, `getFileTree` | Tier 1/2 deterministic verification, Path 1 evidence assembly |
| L4 (Worker) | `updateFromDiff` | Index update on every PR/push scan |
| L4 (Worker) | `getFileTree` | Scope resolution (doc vs code file classification) |
| L5 (Reporter) | `getEntityByFile` (indirect via L3) | Evidence context for PR comments |

Cross-layer call index (from phase4-api-contracts.md Section 15):
- L2 -> L0: `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `searchRoutes`, `getDependencyVersion`
- L3 -> L0: `fileExists`, `findSymbol`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getAvailableScripts`, `getEntityByFile`, `getFileTree`
- L4 -> L0: `updateFromDiff`, `getFileTree`

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md` Section 2. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `CodeEntity` (Section 2.1) -- indexed structural entity
- `FileChange` (Section 2.1) -- diff entry from GitHub
- `DependencyVersion` (Section 2.1) -- version + source metadata (3B-D3)
- `RouteEntity` (Section 2.1) -- API route definition
- `ScriptInfo` (Section 2.1) -- package script definition
- `IndexUpdateResult` (Section 2.2) -- incremental update stats
- `EntityType` (Section 1) -- `'function' | 'class' | 'route' | 'type' | 'config'`

**Referenced service interface:**
- `CodebaseIndexService` (Section 2.2) -- the full public API surface

**Layer-internal types** (not in api-contracts, specific to L0 implementation):

```typescript
/** tree-sitter parse result for a single file */
interface ParsedFileResult {
  file_path: string;
  language: SupportedLanguage;
  entities: ParsedEntity[];
  has_errors: boolean;           // rootNode.hasError()
  parse_duration_ms: number;
}

/** Entity extracted from tree-sitter before DB persistence */
interface ParsedEntity {
  name: string;
  entity_type: EntityType;
  line_number: number;
  end_line_number: number;
  signature: string;
  raw_code: string;
}

/** Supported MVP languages */
type SupportedLanguage = 'typescript' | 'javascript' | 'python';

/** File extension to language mapping */
type ExtensionMap = Record<string, SupportedLanguage>;

/** Parsed package manifest (generic across ecosystems) */
interface ParsedManifest {
  file_path: string;
  dependencies: Record<string, string>;    // name -> version specifier
  dev_dependencies: Record<string, string>;
  scripts: Record<string, string>;         // name -> command
  source: 'lockfile' | 'manifest';
}

/** Route framework detector result */
interface DetectedFramework {
  name: 'express' | 'fastify' | 'koa' | 'flask' | 'fastapi' | 'django';
  language: SupportedLanguage;
}

/** Entity diff result for incremental updates */
interface EntityDiff {
  added: ParsedEntity[];
  updated: Array<{ old_id: string; new_entity: ParsedEntity; signature_changed: boolean }>;
  removed: string[];             // entity IDs to delete
}
```

---

## 4. Public API

### 4.1 fileExists

#### Signature

```typescript
fileExists(repoId: string, path: string): Promise<boolean>
```

#### Algorithm

1. Query `code_entities` table: `SELECT 1 FROM code_entities WHERE repo_id = $1 AND file_path = $2 LIMIT 1`.
2. If found, return `true`.
3. Else, query the file tree cache (in-memory or Redis): check if `path` exists in the repo's file list.
4. Return result.

Note: file tree includes ALL files (not just parseable ones). `code_entities` only includes files with extractable entities. The file tree check covers files like `config.yaml` that have no AST entities.

#### Input/Output Example 1

```
Input:  fileExists("repo-uuid-001", "src/auth/handler.ts")
Output: true
// File exists in the repository's file tree
```

#### Input/Output Example 2

```
Input:  fileExists("repo-uuid-001", "src/auth/old-handler.ts")
Output: false
// File was deleted in a previous commit
```

#### Negative Example

This function does NOT check whether a path is a directory. `fileExists("repo-uuid-001", "src/auth/")` returns `false` (directories are not tracked). Callers that receive `false` for a directory-like path should not treat this as drift -- that is L3's responsibility.

#### Edge Cases

- Path with leading `./` or `../`: normalize before lookup (strip `./`, reject `../` as invalid).
- Path with trailing slash: strip and return `false` (directories are not files).
- Empty string path: return `false`.
- Case sensitivity: paths are case-sensitive (matches filesystem behavior on Linux; macOS repos should use exact casing from git).

#### Error Handling

- Database connection failure: throw `DocAlignError` with code `DOCALIGN_E301`, retryable. Caller (L2/L3) handles retry via per-call retry profile.

---

### 4.2 getFileTree

#### Signature

```typescript
getFileTree(repoId: string): Promise<string[]>
```

#### Algorithm

1. Query distinct file paths: `SELECT DISTINCT file_path FROM code_entities WHERE repo_id = $1 ORDER BY file_path`.
2. UNION with non-entity tracked files from a `repo_files` table (or materialized view): `SELECT path FROM repo_files WHERE repo_id = $1`.
3. Return sorted array of all unique file paths.

Implementation note: For MVP, the file tree is built during full scan by walking the git clone. For incremental updates, it is maintained by adding/removing entries based on `FileChange[]` status.

#### Input/Output Example 1

```
Input:  getFileTree("repo-uuid-001")
Output: [
  ".docalign.yml",
  "Makefile",
  "README.md",
  "docs/api.md",
  "package.json",
  "src/auth/handler.ts",
  "src/auth/password.ts",
  "src/index.ts",
  "src/routes/users.ts",
  "tsconfig.json"
]
```

#### Input/Output Example 2

```
Input:  getFileTree("repo-uuid-nonexistent")
Output: []
// Repo has no indexed files (or repo does not exist in DB)
```

#### Negative Example

Does NOT return directory entries. `"src/"` or `"src/auth/"` never appear in the result. Only leaf file paths are returned.

Does NOT return `.git/` internal files or files matching `.gitignore` patterns.

#### Edge Cases

- Repo with zero files (fresh install, no scan yet): return `[]`.
- Repo with >10,000 files: query returns all. No pagination at this layer. Callers (L2 LLM-assisted mapping) are responsible for filtering.
- Files excluded by `.docalign.yml` `code_patterns.exclude`: still appear in file tree (exclusion affects entity indexing, not file existence). This is correct: a claim referencing `src/test.spec.ts` should verify as `true` even if the file is excluded from entity indexing.

#### Error Handling

- Database query timeout: throw `DocAlignError` with code `DOCALIGN_E302`, retryable.

---

### 4.3 findSymbol

#### Signature

```typescript
findSymbol(repoId: string, name: string): Promise<CodeEntity[]>
```

#### Algorithm

1. Exact match: `SELECT * FROM code_entities WHERE repo_id = $1 AND name = $2`.
2. If zero results, try case-insensitive: `SELECT * FROM code_entities WHERE repo_id = $1 AND LOWER(name) = LOWER($2)`.
3. Return all matches sorted by `file_path, line_number`.

#### Input/Output Example 1

```
Input:  findSymbol("repo-uuid-001", "AuthService")
Output: [
  {
    id: "entity-uuid-100",
    repo_id: "repo-uuid-001",
    file_path: "src/auth/service.ts",
    line_number: 15,
    end_line_number: 87,
    entity_type: "class",
    name: "AuthService",
    signature: "class AuthService",
    embedding: [0.012, -0.034, ...],    // 1536 floats
    raw_code: "class AuthService {\n  constructor(private db: Database) {}\n  async login(email: string, password: string) {...}\n  ...\n}",
    last_commit_sha: "abc123",
    created_at: "2026-02-10T10:00:00Z",
    updated_at: "2026-02-11T14:30:00Z"
  }
]
```

#### Input/Output Example 2

```
Input:  findSymbol("repo-uuid-001", "handleLogin")
Output: [
  {
    id: "entity-uuid-101",
    repo_id: "repo-uuid-001",
    file_path: "src/auth/handler.ts",
    line_number: 22,
    end_line_number: 45,
    entity_type: "function",
    name: "handleLogin",
    signature: "async function handleLogin(req: Request, res: Response): Promise<void>",
    embedding: [...],
    raw_code: "async function handleLogin(req: Request, res: Response): Promise<void> {\n  const { email, password } = req.body;\n  ...\n}",
    last_commit_sha: "def456",
    created_at: "2026-02-10T10:00:00Z",
    updated_at: "2026-02-10T10:00:00Z"
  }
]
```

#### Negative Example

Does NOT perform fuzzy/substring matching. `findSymbol("repo-uuid-001", "Auth")` returns `[]` if no entity is named exactly `"Auth"`. Substring search is the job of `searchSemantic`.

Does NOT search across repos. The `repoId` parameter scopes all queries to a single repo.

#### Edge Cases

- Multiple entities with the same name in different files: return all. Caller (L2) ranks by mapping confidence.
- Name collision between function and type (e.g., `User` function and `User` interface): return both. `entity_type` discriminates.
- Empty name: return `[]`.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.4 getEntityByFile

#### Signature

```typescript
getEntityByFile(repoId: string, filePath: string): Promise<CodeEntity[]>
```

#### Algorithm

1. `SELECT * FROM code_entities WHERE repo_id = $1 AND file_path = $2 ORDER BY line_number`.
2. Return all entities in the file, ordered by line number.

#### Input/Output Example 1

```
Input:  getEntityByFile("repo-uuid-001", "src/routes/users.ts")
Output: [
  {
    id: "entity-uuid-200",
    file_path: "src/routes/users.ts",
    line_number: 5,
    end_line_number: 5,
    entity_type: "route",
    name: "GET /api/v2/users",
    signature: "router.get('/api/v2/users', listUsers)",
    ...
  },
  {
    id: "entity-uuid-201",
    file_path: "src/routes/users.ts",
    line_number: 15,
    end_line_number: 45,
    entity_type: "function",
    name: "listUsers",
    signature: "async function listUsers(req: Request, res: Response): Promise<void>",
    ...
  }
]
```

#### Input/Output Example 2

```
Input:  getEntityByFile("repo-uuid-001", "config/defaults.yaml")
Output: []
// YAML files are not parsed by tree-sitter; no entities extracted
```

#### Negative Example

Does NOT return entities from files with similar names. `getEntityByFile("repo-uuid-001", "src/routes/user.ts")` returns `[]` if only `users.ts` exists.

#### Edge Cases

- File with tree-sitter parse errors (DOCALIGN_E401): returns `[]` because entities were removed per error handling playbook Scenario 18.
- Binary file: returns `[]` (never parsed).

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.5 getEntityById

#### Signature

```typescript
getEntityById(entityId: string): Promise<CodeEntity | null>
```

#### Algorithm

1. `SELECT * FROM code_entities WHERE id = $1`.
2. Return entity or `null` if not found.

#### Input/Output Example 1

```
Input:  getEntityById("entity-uuid-100")
Output: { id: "entity-uuid-100", name: "AuthService", ... }
```

#### Input/Output Example 2

```
Input:  getEntityById("entity-uuid-deleted")
Output: null
// Entity was removed during incremental update
```

#### Negative Example

Does NOT validate that the entity belongs to any particular repo. The `entityId` is a UUID primary key; cross-repo access is prevented by RLS policies (post-MVP, per 3E-002).

#### Edge Cases

- Invalid UUID format: PostgreSQL will reject; catch and return `null`.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.6 findRoute

#### Signature

```typescript
findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null>
```

#### Algorithm

1. Normalize method to uppercase: `method = method.toUpperCase()`.
2. Normalize path: strip trailing slash (except for root `/`).
3. Exact match: `SELECT * FROM code_entities WHERE repo_id = $1 AND entity_type = 'route' AND name = $2 || ' ' || $3`.
   - Route entities store name as `"GET /api/v2/users"`.
4. If no exact match, try parameterized match:
   - Convert claim path segments to regex: `/users/:id` matches `/users/{id}` or `/users/<id>`.
   - Query all routes, filter by method, then match path patterns.
5. Return first match or `null`.

#### Input/Output Example 1

```
Input:  findRoute("repo-uuid-001", "POST", "/api/v2/users")
Output: {
  id: "entity-uuid-300",
  file_path: "src/routes/users.ts",
  line_number: 50,
  method: "POST",
  path: "/api/v2/users"
}
```

#### Input/Output Example 2

```
Input:  findRoute("repo-uuid-001", "GET", "/api/v1/users")
Output: null
// Route was upgraded to v2; /api/v1/users no longer exists
```

#### Negative Example

Does NOT perform similarity matching. If the claim says `"GET /api/users"` but the code has `"GET /api/v2/users"`, `findRoute` returns `null`. Use `searchRoutes` for fuzzy matching.

#### Edge Cases

- Path parameters in different formats: `/users/:id`, `/users/{id}`, `/users/<int:id>` (Flask). Normalize all to a canonical pattern before comparison.
- Method `*` or `ALL` (Express `app.all()`): matches any method. Stored as method `"ALL"`.
- Multiple routes with same method+path in different files (e.g., test vs production): return the first non-test file match.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.7 searchRoutes

#### Signature

```typescript
searchRoutes(repoId: string, path: string): Promise<Array<{
  method: string;
  path: string;
  file: string;
  line: number;
  similarity: number;
}>>
```

#### Algorithm

1. Fetch all route entities for the repo: `SELECT * FROM code_entities WHERE repo_id = $1 AND entity_type = 'route'`.
2. For each route, compute path similarity score:
   a. Exact path match (ignoring method): similarity = 1.0.
   b. Prefix match (e.g., `/api/v2/users` matches claim `/api/v2/users/:id`): similarity = 0.9.
   c. Segment overlap: count matching path segments / max segments. Score = 0.5 + (0.4 * overlap_ratio).
   d. No overlap: similarity = 0.0.
3. Filter routes with similarity > 0.3.
4. Sort by similarity descending.
5. Return top 10.

#### Input/Output Example 1

```
Input:  searchRoutes("repo-uuid-001", "/api/v1/users")
Output: [
  { method: "GET",  path: "/api/v2/users",     file: "src/routes/users.ts", line: 5,  similarity: 0.82 },
  { method: "POST", path: "/api/v2/users",     file: "src/routes/users.ts", line: 50, similarity: 0.82 },
  { method: "GET",  path: "/api/v2/users/:id", file: "src/routes/users.ts", line: 30, similarity: 0.75 }
]
```

#### Input/Output Example 2

```
Input:  searchRoutes("repo-uuid-001", "/webhook")
Output: []
// No routes have any path similarity to "/webhook"
```

#### Negative Example

Does NOT use embedding similarity. Route search is purely structural (path segment comparison). Semantic search of route intent is handled by `searchSemantic`.

#### Edge Cases

- Repo with zero routes: return `[]`.
- Very common path prefixes (e.g., `/api`): many routes match with low similarity. The top-10 limit and 0.3 threshold prevent noise.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.8 getDependencyVersion

#### Signature

```typescript
getDependencyVersion(repoId: string, packageName: string): Promise<DependencyVersion | null>
```

#### Algorithm

1. Query the dependency index (a separate in-memory or DB structure built from parsed manifests):
   - Check lockfiles first (exact versions): `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`.
   - If lockfile match found: return `{ version, source: 'lockfile' }`.
   - If no lockfile match, check manifests: `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`.
   - If manifest match found: return `{ version, source: 'manifest' }`.
2. Search order for monorepos (PRD 4.7): check ALL manifest files, return first match. Monorepo-aware per-package scoping is v3.
3. If no match: return `null`.

#### Input/Output Example 1

```
Input:  getDependencyVersion("repo-uuid-001", "react")
Output: { version: "18.2.0", source: "lockfile" }
// Exact version from package-lock.json
```

#### Input/Output Example 2

```
Input:  getDependencyVersion("repo-uuid-001", "express")
Output: { version: "^4.18.0", source: "manifest" }
// Range specifier from package.json (no lockfile present or lockfile not parsed)
```

#### Negative Example

Does NOT resolve version ranges to exact versions. If `package.json` says `"^4.18.0"` and there is no lockfile, the returned `version` is `"^4.18.0"` as-is. Version comparison logic (exact vs range) is L3's responsibility, using the `source` field to choose the comparison strategy (per decision 3B-D3).

Does NOT search for transitive dependencies. Only direct dependencies listed in manifests/lockfiles are indexed.

#### Edge Cases

- Package name normalization: `lodash.merge` vs `lodash-merge` -- match as-is (no normalization). Package ecosystems treat these differently.
- Scoped packages: `@types/react` -- match the full scoped name including `@`.
- Python packages: `Flask` vs `flask` -- case-insensitive match for Python packages (pip is case-insensitive).
- Multiple manifests with different versions (monorepo): return the first match found (root `package.json` first, then subdirectories sorted alphabetically).

#### Error Handling

- Database/cache error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.9 scriptExists

#### Signature

```typescript
scriptExists(repoId: string, scriptName: string): Promise<boolean>
```

#### Algorithm

1. Query the script index: look up `scriptName` in parsed manifests.
2. Check sources in order:
   a. `package.json` `scripts` field (npm/yarn/pnpm scripts).
   b. `Makefile` targets.
   c. `Cargo.toml` aliases (rare, v2).
   d. `pyproject.toml` `[tool.poetry.scripts]` or `[project.scripts]`.
3. Return `true` if found in any source.

#### Input/Output Example 1

```
Input:  scriptExists("repo-uuid-001", "test:unit")
Output: true
// "test:unit": "vitest run --dir tests/unit" exists in package.json scripts
```

#### Input/Output Example 2

```
Input:  scriptExists("repo-uuid-001", "test:e2e")
Output: false
// No script named "test:e2e" found in any manifest
```

#### Negative Example

Does NOT verify that the script command actually works. It only checks existence in the manifest. A script defined as `"test:e2e": "exit 1"` would return `true`.

#### Edge Cases

- Makefile targets: `scriptExists("repo-uuid-001", "build")` checks both `package.json` scripts AND Makefile targets. Returns `true` if found in either.
- Script name with special characters: `"pre:deploy"`, `"post-install"` -- match exactly as written.

#### Error Handling

- Database/cache error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.10 getAvailableScripts

#### Signature

```typescript
getAvailableScripts(repoId: string): Promise<ScriptInfo[]>
```

#### Algorithm

1. Collect all scripts from all parsed manifests for the repo.
2. For each script, create a `ScriptInfo` with `name`, `command`, and `file_path` of the manifest that defines it.
3. Sort by `file_path`, then `name`.
4. Return the full list.

#### Input/Output Example 1

```
Input:  getAvailableScripts("repo-uuid-001")
Output: [
  { name: "build",     command: "tsc --build",              file_path: "package.json" },
  { name: "dev",       command: "tsx watch src/index.ts",    file_path: "package.json" },
  { name: "lint",      command: "eslint src/",               file_path: "package.json" },
  { name: "test",      command: "vitest",                    file_path: "package.json" },
  { name: "test:unit", command: "vitest run --dir tests/unit", file_path: "package.json" },
  { name: "deploy",    command: "railway up",                file_path: "Makefile" }
]
```

#### Input/Output Example 2

```
Input:  getAvailableScripts("repo-uuid-empty")
Output: []
// Repo has no package.json, Makefile, or other script-defining files
```

#### Negative Example

Does NOT include lifecycle scripts that are auto-generated (e.g., npm's implicit `start` if a `server.js` exists). Only explicitly defined scripts.

#### Edge Cases

- Duplicate script names across manifests (e.g., `build` in both `package.json` and `Makefile`): return both with their respective `file_path`.

#### Error Handling

- Database/cache error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.11 searchSemantic

#### Signature

```typescript
searchSemantic(repoId: string, query: string, topK: number): Promise<Array<CodeEntity & { similarity: number }>>
```

#### Algorithm

1. Validate: if `topK < 1`, set to 5 (default). If `topK > 50`, cap at 50.
2. The `query` string must already be an embedding vector OR the caller provides the raw text and this function embeds it. **Decision:** The function receives the raw text query. Embedding is done server-side using a pre-computed query embedding cache or by calling the embedding API (client-side, via a pre-generated batch).

   **MVP simplification:** `searchSemantic` expects the caller to provide a pre-embedded query vector. The function signature accepts `query: string` but internally looks up a cached embedding for the query. If no cached embedding exists, the function falls back to `findSymbol` with extracted keywords and returns results with `similarity: 0.5` (synthetic score).

3. Query pgvector:
   ```sql
   SELECT *, 1 - (embedding <=> $query_vector) AS similarity
   FROM code_entities
   WHERE repo_id = $1 AND embedding IS NOT NULL
   ORDER BY embedding <=> $query_vector
   LIMIT $topK;
   ```
4. Filter results where `similarity >= 0.7` (configurable via `mapping.semantic_threshold`).
5. Return results sorted by similarity descending.

#### Input/Output Example 1

```
Input:  searchSemantic("repo-uuid-001", "password hashing authentication", 5)
Output: [
  {
    id: "entity-uuid-100",
    name: "AuthService",
    file_path: "src/auth/service.ts",
    entity_type: "class",
    similarity: 0.87,
    ...
  },
  {
    id: "entity-uuid-102",
    name: "hashPassword",
    file_path: "src/auth/password.ts",
    entity_type: "function",
    similarity: 0.82,
    ...
  }
]
```

#### Input/Output Example 2

```
Input:  searchSemantic("repo-uuid-001", "banana smoothie recipe", 5)
Output: []
// No code entities are semantically similar to a cooking query
```

#### Negative Example

Does NOT search claim text or documentation content. It searches code entity embeddings only. L1 claim embeddings are a separate table.

Does NOT return entities with `embedding IS NULL`. Entities awaiting embedding generation are invisible to semantic search.

#### Edge Cases

- Embedding dimension mismatch (DOCALIGN_E307/E408): pgvector throws. Catch the error, log at ERROR, return `[]`. Caller (L2) falls through to Step 3 alternatives or routes to Path 2.
- Repo with zero embedded entities: return `[]`.
- Query that matches many entities above threshold: returns only `topK` results.

#### Error Handling

- Embedding dimension mismatch: catch pgvector error, log `DOCALIGN_E408`, return `[]`. Do not throw -- this is graceful degradation per error handling Scenario 19.
- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.12 updateFromDiff

#### Signature

```typescript
updateFromDiff(repoId: string, changedFiles: FileChange[]): Promise<IndexUpdateResult>
```

#### Algorithm (pseudocode)

```
function updateFromDiff(repoId, changedFiles):
  result = { entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] }

  // Classify files
  codeFiles = changedFiles.filter(f => isSupportedCodeFile(f.filename))
  manifestFiles = changedFiles.filter(f => isManifestFile(f.filename))
  allFiles = changedFiles  // for file tree update

  BEGIN TRANSACTION

  // 1. Update file tree
  for file in allFiles:
    if file.status == 'added':
      insertFileTree(repoId, file.filename)
    elif file.status == 'removed':
      removeFileTree(repoId, file.filename)
    elif file.status == 'renamed':
      renameFileTree(repoId, file.previous_filename, file.filename)

  // 2. Process renamed code files (audit finding A3)
  for file in codeFiles where file.status == 'renamed':
    UPDATE code_entities SET file_path = file.filename
      WHERE repo_id = repoId AND file_path = file.previous_filename
    // claim_mappings.code_file updated by L2.updateCodeFilePaths (called by L4 worker)

  // 3. Process removed code files
  for file in codeFiles where file.status == 'removed':
    deletedCount = DELETE FROM code_entities
      WHERE repo_id = repoId AND file_path = file.filename
    result.entities_removed += deletedCount

  // 4. Process added/modified code files
  for file in codeFiles where file.status in ('added', 'modified', 'renamed'):
    fileContent = fetchFileContent(repoId, file.filename)  // from clone or API
    language = detectLanguage(file.filename)

    if language == null:
      result.files_skipped.push(file.filename)
      continue

    parseResult = treeSitterParse(language, fileContent)

    if parseResult.has_errors:
      log(WARN, DOCALIGN_E401, { repoId, filePath: file.filename, language })
      // Remove existing entities for this file (they may be stale)
      DELETE FROM code_entities WHERE repo_id = repoId AND file_path = file.filename
      result.files_skipped.push(file.filename)
      continue

    existingEntities = SELECT * FROM code_entities
      WHERE repo_id = repoId AND file_path = file.filename

    diff = computeEntityDiff(existingEntities, parseResult.entities)

    // Apply diff
    for entity in diff.added:
      INSERT INTO code_entities (repo_id, file_path, ...) VALUES (...)
      result.entities_added++

    for update in diff.updated:
      UPDATE code_entities SET name = ..., signature = ..., raw_code = ...,
        line_number = ..., end_line_number = ...,
        embedding = CASE WHEN update.signature_changed THEN NULL ELSE embedding END,
        updated_at = NOW()
        WHERE id = update.old_id
      result.entities_updated++
      // If signature_changed, embedding is set to NULL
      // Client-side Action will re-embed these entities

    for entityId in diff.removed:
      DELETE FROM code_entities WHERE id = entityId
      result.entities_removed++

  // 5. Process manifest files
  for file in manifestFiles:
    if file.status == 'removed':
      clearManifestData(repoId, file.filename)
    else:
      fileContent = fetchFileContent(repoId, file.filename)
      manifest = parseManifest(file.filename, fileContent)
      upsertManifestData(repoId, manifest)

  COMMIT TRANSACTION

  return result
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  changedFiles: [
    { filename: "src/auth/handler.ts", status: "modified", additions: 5, deletions: 2 },
    { filename: "src/utils/new-helper.ts", status: "added", additions: 30, deletions: 0 },
    { filename: "src/legacy/old.ts", status: "removed", additions: 0, deletions: 50 },
    { filename: "package.json", status: "modified", additions: 1, deletions: 1 }
  ]

Output:
  {
    entities_added: 3,      // 3 new functions in new-helper.ts
    entities_updated: 2,    // 2 functions changed signature in handler.ts
    entities_removed: 4,    // 4 entities from old.ts deleted
    files_skipped: []
  }
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  changedFiles: [
    { filename: "README.md", status: "modified", additions: 10, deletions: 5 },
    { filename: "docs/api.md", status: "added", additions: 100, deletions: 0 }
  ]

Output:
  {
    entities_added: 0,
    entities_updated: 0,
    entities_removed: 0,
    files_skipped: ["README.md", "docs/api.md"]
    // .md files are not parseable code files; they update the file tree but produce no entities
  }
```

#### Negative Example

Does NOT re-extract claims from documentation files. That is L1's job. L0 only indexes code entities and file structure.

Does NOT trigger re-mapping of claims. L4 Worker is responsible for calling `L2.updateCodeFilePaths` and `L2.removeMappingsForFiles` after `updateFromDiff` completes.

Does NOT generate embeddings. When a signature changes, the embedding is set to `NULL`. The GitHub Action generates new embeddings client-side and stores them via a separate API call.

#### Edge Cases

- File renamed AND modified: process as rename (update `file_path`) then as modified (re-parse entities).
- Empty `changedFiles` array: return `{ entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] }`.
- Binary file in changedFiles: skip (not a supported code file).
- Very large file (>1MB): skip with WARN log. Add to `files_skipped`.

#### Error Handling

- tree-sitter parse failure (DOCALIGN_E401): skip file, remove stale entities, add to `files_skipped`. Do not abort the transaction.
- Database constraint violation during INSERT: log `DOCALIGN_E303`, skip entity. Transaction continues.
- Transaction failure: rollback all changes. Throw `DocAlignError` code `DOCALIGN_E301`. L4 Worker retries the entire job.

---

## 5. Performance Targets

| Operation | Target | Measured By |
|-----------|--------|-------------|
| tree-sitter parse of a single TS file (500 lines) | < 10ms | `parseResult.parse_duration_ms` |
| tree-sitter parse of 100 changed files | < 2 seconds total | Sum of per-file parse durations |
| `fileExists` lookup | < 5ms | DB query time |
| `findSymbol` lookup | < 10ms | DB query time (indexed on `repo_id, name`) |
| `findRoute` exact match | < 10ms | DB query time |
| `searchSemantic` (topK=5) | < 50ms | pgvector HNSW query time |
| `getDependencyVersion` | < 5ms | In-memory/cached lookup |
| `scriptExists` | < 5ms | In-memory/cached lookup |
| `getFileTree` (10,000 files) | < 100ms | DB query time |
| `updateFromDiff` (100 files) | < 5 seconds | End-to-end including DB writes |
| tree-sitter WASM memory per language | < 30MB | Process memory measurement |
| Maximum 3 language grammars loaded simultaneously | < 100MB total | Process memory measurement |

**Index sizes (capacity planning):**

| Metric | MVP Target |
|--------|-----------|
| Entities per repo | Up to 10,000 |
| Files per repo | Up to 50,000 |
| Routes per repo | Up to 500 |
| Dependencies per repo | Up to 1,000 |

---

## 6. Required Framework Knowledge

The implementing agent must be familiar with:

| Library/Tool | Version | Usage in L0 |
|-------------|---------|-------------|
| `tree-sitter` (WASM) | Latest | AST parsing for TypeScript, JavaScript, Python |
| `tree-sitter-typescript` | Latest | TypeScript/JavaScript grammar |
| `tree-sitter-python` | Latest | Python grammar |
| `web-tree-sitter` | Latest | WASM runtime for tree-sitter in Node.js |
| `pg` (node-postgres) | ^8.x | PostgreSQL queries for entity CRUD |
| `pgvector/pg` | Latest | Vector similarity queries |
| `semver` | ^7.x | Version string parsing (used in `getDependencyVersion` for lockfile version extraction) |
| `minimatch` or `picomatch` | Latest | Glob pattern matching for code_patterns include/exclude |
| `@iarna/toml` or `toml` | Latest | Parsing `pyproject.toml`, `Cargo.toml` |
| `yaml` (js-yaml) | ^4.x | Parsing `.docalign.yml` config |
| `fast-glob` | Latest | File tree walking during full scan |

**tree-sitter query knowledge:** The implementer must write and test tree-sitter S-expression queries for:

### TypeScript/JavaScript Entity Extraction

```scheme
;; Exported function declarations
(export_statement
  declaration: (function_declaration
    name: (identifier) @function.name
    parameters: (formal_parameters) @function.params
    return_type: (type_annotation)? @function.return_type
  )
) @function.export

;; Exported arrow functions (const export pattern)
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @function.name
      value: (arrow_function
        parameters: (formal_parameters) @function.params
        return_type: (type_annotation)? @function.return_type
      )
    )
  )
) @function.arrow_export

;; Exported class declarations
(export_statement
  declaration: (class_declaration
    name: (type_identifier) @class.name
    body: (class_body) @class.body
  )
) @class.export

;; Exported interface/type declarations
(export_statement
  declaration: (interface_declaration
    name: (type_identifier) @type.name
    body: (interface_body) @type.body
  )
) @type.export

(export_statement
  declaration: (type_alias_declaration
    name: (type_identifier) @type.name
    value: (_) @type.value
  )
) @type.alias_export

;; Express/Fastify route definitions
;; Matches: app.get('/path', handler), router.post('/path', handler)
(call_expression
  function: (member_expression
    object: (identifier) @router.object
    property: (property_identifier) @router.method
    (#match? @router.method "^(get|post|put|patch|delete|head|options|all)$")
  )
  arguments: (arguments
    (string (string_fragment) @route.path)
  )
) @route.definition
```

### Python Entity Extraction

```scheme
;; Top-level function definitions
(function_definition
  name: (identifier) @function.name
  parameters: (parameters) @function.params
  return_type: (type)? @function.return_type
) @function.def

;; Class definitions
(class_definition
  name: (identifier) @class.name
  body: (block) @class.body
) @class.def

;; Flask route decorators
;; Matches: @app.route('/path', methods=['GET'])
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @flask.app
        attribute: (identifier) @flask.decorator
        (#eq? @flask.decorator "route")
      )
      arguments: (argument_list
        (string (string_content) @route.path)
      )
    )
  )
  definition: (function_definition
    name: (identifier) @route.handler
  )
) @route.flask

;; FastAPI route decorators
;; Matches: @app.get('/path'), @router.post('/path')
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @fastapi.app
        attribute: (identifier) @fastapi.method
        (#match? @fastapi.method "^(get|post|put|patch|delete|head|options)$")
      )
      arguments: (argument_list
        (string (string_content) @route.path)
      )
    )
  )
  definition: (function_definition
    name: (identifier) @route.handler
  )
) @route.fastapi

;; Django URL patterns (urlpatterns list in urls.py)
;; Matches: path('api/users/', views.user_list)
(call
  function: (identifier) @django.func
  (#eq? @django.func "path")
  arguments: (argument_list
    (string (string_content) @route.path)
  )
) @route.django
```

### Manifest Parsing Knowledge

| File | Parsing Method | Key Fields |
|------|---------------|------------|
| `package.json` | `JSON.parse()` | `dependencies`, `devDependencies`, `scripts` |
| `package-lock.json` | `JSON.parse()` | `packages[""].dependencies` (v3 format) |
| `yarn.lock` | Line-based parser or `@yarnpkg/lockfile` | Package name + version lines |
| `pnpm-lock.yaml` | YAML parse | `packages` map |
| `requirements.txt` | Line-based: `package==version` or `package>=version` | Package name + version specifier |
| `pyproject.toml` | TOML parse | `[project].dependencies`, `[tool.poetry.dependencies]` |
| `Cargo.toml` | TOML parse | `[dependencies]`, `[dev-dependencies]` |
| `Cargo.lock` | TOML parse | `[[package]]` entries |
| `go.mod` | Line-based: `require (...)` blocks | Module path + version |
| `Makefile` | Regex: `/^([a-zA-Z_][a-zA-Z0-9_-]*):/m` | Target names |

---

## 7. Open Questions

1. **Embedding generation trigger for full scan:** During a full scan, all entities need embeddings. The current architecture (client-side embedding via GitHub Action) means the full scan Action must receive all un-embedded entities and generate embeddings for them. The mechanism for this batch embedding flow needs to be specified in TDD-infra (Action implementation).

2. **File tree persistence strategy:** The file tree for `fileExists` and `getFileTree` can be stored as:
   - (a) A separate `repo_files` table with one row per file path.
   - (b) A JSONB column on the `repos` table.
   - (c) An in-memory cache rebuilt from `code_entities` UNION file list.
   Option (a) is most reliable for large repos. Option (c) is fastest but loses non-code files on restart. Recommend (a) for MVP.

3. **Koa route extraction:** Koa uses `router.get('/path', handler)` similar to Express but with `@koa/router`. The tree-sitter queries from Express may work directly. Needs validation during implementation.

4. **Django URL pattern extraction:** Django's `urlpatterns` can use `re_path()` with regex patterns or `path()` with converters. The tree-sitter query above covers `path()` only. `re_path()` support is deferred to post-MVP if needed.

5. **Lockfile parsing depth:** For monorepos with workspace lockfiles (`pnpm-lock.yaml` with `importers`), should L0 parse per-workspace versions? Current decision: no, return first match (PRD 4.7). Flag for v3 monorepo support.

---

## Appendix A: Entity Diff Algorithm

The `computeEntityDiff` function determines what changed between existing DB entities and freshly parsed entities for a single file.

```
function computeEntityDiff(existing: CodeEntity[], parsed: ParsedEntity[]): EntityDiff:
  diff = { added: [], updated: [], removed: [] }

  // Build lookup by (name, entity_type) -- unique within a file
  existingMap = Map<string, CodeEntity>
  for e in existing:
    key = e.name + ":" + e.entity_type
    existingMap.set(key, e)

  parsedSet = Set<string>
  for p in parsed:
    key = p.name + ":" + p.entity_type
    parsedSet.add(key)

    if existingMap.has(key):
      existingEntity = existingMap.get(key)
      signatureChanged = existingEntity.signature != p.signature
      codeChanged = existingEntity.raw_code != p.raw_code
      lineChanged = existingEntity.line_number != p.line_number

      if signatureChanged or codeChanged or lineChanged:
        diff.updated.push({
          old_id: existingEntity.id,
          new_entity: p,
          signature_changed: signatureChanged
        })
    else:
      diff.added.push(p)

  for key in existingMap.keys():
    if not parsedSet.has(key):
      diff.removed.push(existingMap.get(key).id)

  return diff
```

**Match key:** `(name, entity_type)` uniquely identifies an entity within a file. If a file has two functions with the same name (overloads in TS), they are distinguished by including the parameter count in the match key: `name + ":" + entity_type + ":" + param_count`.

---

## Appendix B: Supported File Extensions

```typescript
const EXTENSION_MAP: ExtensionMap = {
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.mjs':  'javascript',
  '.cjs':  'javascript',
  '.py':   'python',
};

const MANIFEST_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Makefile',
  'Dockerfile',
]);

function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = path.extname(filePath);
  return EXTENSION_MAP[ext] ?? null;
}

function isManifestFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return MANIFEST_FILES.has(basename);
}

function isSupportedCodeFile(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}
```

---

## Appendix C: Route Entity Name Convention

Route entities are stored in `code_entities` with:
- `entity_type = 'route'`
- `name = "{METHOD} {path}"` (e.g., `"GET /api/v2/users"`, `"POST /api/v2/users"`)
- `signature = "{framework_call}"` (e.g., `"router.get('/api/v2/users', listUsers)"`)
- `line_number` = line of the route definition
- `end_line_number` = same as `line_number` (routes are typically single-line definitions)

For parameterized routes, the name preserves the parameter format from the source code:
- Express: `"GET /api/users/:id"`
- FastAPI: `"GET /api/users/{user_id}"`
- Flask: `"GET /api/users/<int:user_id>"`
- Django: `"GET api/users/<int:pk>/"`

The `findRoute` function normalizes parameter formats during comparison (Section 4.6).

---

## Appendix D: Error Code Reference (L0-specific)

| Code | Scenario | Severity | Recovery |
|------|----------|----------|----------|
| DOCALIGN_E401 | tree-sitter parse failure | medium | Skip file, remove stale entities, continue scan |
| DOCALIGN_E408 | Embedding dimension mismatch (query) | high | Disable semantic search, fall back to Steps 1-2, suggest re-index |
| DOCALIGN_E301 | Database connection/query failure | high | Retry with per-call profile |
| DOCALIGN_E302 | Database query timeout | high | Retry with per-call profile |
| DOCALIGN_E303 | Database constraint violation | medium | Skip entity, log, continue |

All error codes conform to the schema in phase3-error-handling.md Section 1.1.
