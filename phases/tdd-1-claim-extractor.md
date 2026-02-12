# TDD-1: Claim Extractor (Layer 1)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 3), phase3-architecture.md (Sections 7, 11.3), phase3-decisions.md, phase3-error-handling.md, technical-reference.md (Sections 3.2, 5), prd/L1-claim-extractor.md, spike-a-vague-claim-mapping.md
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 1 (Claim Extractor) parses documentation files and decomposes them into individual, verifiable claims about the codebase. It owns two extraction modes: syntactic extraction (deterministic, regex/heuristic, server-side) and the data model for semantically extracted claims (LLM-based, executed client-side in the GitHub Action). L1 also provides CRUD operations for claims, including re-extraction on doc file changes, deduplication, and verification status updates.

**Boundaries:** L1 does NOT map claims to code (L2), verify claims (L3), discover which doc files changed (L4), or generate embeddings (client-side Action). L1 receives raw doc file content and produces structured `Claim` records. Semantic extraction is orchestrated by the server (task creation) but executed by the GitHub Action; L1's server-side role is limited to syntactic extraction and claim persistence.

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| L4 (Worker) | Raw doc file content (`string`) + file path | `extractSyntactic()`, `reExtract()` |
| L4 (Worker) | Instruction to delete claims for a removed file | `deleteClaimsForFile()` |
| L7 (Learning) | Verification status updates | `updateVerificationStatus()` |
| PostgreSQL | Stored claims for query, diff, deduplication | All query and mutation functions |
| `.docalign.yml` config | `doc_patterns.include/exclude`, `claim_types` enable/disable | Filtering during extraction |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| L4 (Worker) | `reExtract(repoId, docFile, content)` | Doc file changed in PR/push |
| L4 (Worker) | `deleteClaimsForFile(repoId, docFile)` | Doc file deleted in PR/push |
| L2 (Mapper) | `getClaimsByFile(repoId, sourceFile)`, `getClaimsByRepo(repoId)`, `getClaimById(claimId)` | Mapping new/changed claims |
| L3 (Verifier) | `getClaimById(claimId)` | Verification lookup |
| L5 (Reporter) | `getClaimsByRepo(repoId)`, `getClaimById(claimId)` | Health score calculation, PR comment formatting |
| L7 (Learning) | `updateVerificationStatus(claimId, status)` | After count-based exclusion |

Cross-layer call index (from phase4-api-contracts.md Section 15):
- L4 -> L1: `reExtract`, `deleteClaimsForFile`
- L7 -> L1: `updateVerificationStatus`
- L2, L3, L5 -> L1: `getClaimsByFile`, `getClaimsByRepo`, `getClaimById` (read-only queries)

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md` Section 3. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `Claim` (Section 3.1) -- extracted documentation claim
- `ExtractedValue` (Section 3.1) -- discriminated union of per-type structured data
- `ClaimType` (Section 1) -- `'path_reference' | 'dependency_version' | 'command' | 'api_route' | 'code_example' | 'behavior' | 'architecture' | 'config' | 'convention' | 'environment'`
- `Testability` (Section 1) -- `'syntactic' | 'semantic' | 'untestable'`
- `ExtractionMethod` (Section 1) -- `'regex' | 'heuristic' | 'llm'`
- `Verdict` (Section 1) -- `'verified' | 'drifted' | 'uncertain'`
- `ClaimRow` (Section 12) -- database row type

**Referenced service interface:**
- `ClaimExtractorService` (Section 3.2) -- the full public API surface

**Layer-internal types** (not in api-contracts, specific to L1 implementation):

```typescript
/** Result of pre-processing a doc file before extraction */
interface PreProcessedDoc {
  cleaned_content: string;       // content with HTML, SVG, base64, frontmatter stripped
  original_line_map: number[];   // maps cleaned line index -> original line number
  format: 'markdown' | 'mdx' | 'rst' | 'plaintext';
  file_size_bytes: number;
}

/** A single regex match before it becomes a Claim */
interface RawExtraction {
  claim_text: string;
  claim_type: ClaimType;
  extracted_value: ExtractedValue;
  line_number: number;           // in original file (mapped back from cleaned)
  pattern_name: string;          // which regex/heuristic produced this match
}

/** Diff result from re-extraction */
interface ClaimDiff {
  added: RawExtraction[];        // new claims not in previous set
  unchanged: string[];           // claim IDs that match exactly
  updated: Array<{              // claims where text changed but identity matches
    existing_id: string;
    new_extraction: RawExtraction;
  }>;
  removed: string[];             // claim IDs no longer present
}

/** Document chunk for LLM extraction (used in task payload) */
interface DocChunk {
  heading: string | null;        // ## heading that starts this chunk
  content: string;               // chunk text
  start_line: number;            // original file line number
  word_count: number;
}

/** Known dependencies loaded from L0 for version validation */
interface KnownDependencies {
  packages: Set<string>;         // all package names from manifests
}

/** Syntactic extraction configuration (from .docalign.yml) */
interface ExtractionConfig {
  enabled_claim_types: Set<ClaimType>;
  doc_exclude_patterns: string[];
}
```

---

## 4. Public API

### 4.1 extractSyntactic

#### Signature

```typescript
extractSyntactic(repoId: string, docFile: string, content: string): Promise<Claim[]>
```

#### Algorithm (pseudocode)

```
function extractSyntactic(repoId, docFile, content):
  // 1. Pre-process
  if content.length > 100 * 1024:
    log(WARN, "File exceeds 100KB limit, skipping", { repoId, docFile })
    return []

  format = detectFormat(docFile)  // .md -> markdown, .mdx -> mdx, .rst -> rst

  if format == 'rst':
    // RST files use LLM-only extraction (semantic); no syntactic patterns apply
    return []

  preprocessed = preProcess(content, format)

  // 2. Load config and known dependencies
  config = loadExtractionConfig(repoId)
  knownDeps = loadKnownDependencies(repoId)  // from L0 dependency index

  // 3. Run all regex/heuristic extractors
  rawExtractions = []

  if config.enabled_claim_types.has('path_reference'):
    rawExtractions.push(...extractPaths(preprocessed, docFile))

  if config.enabled_claim_types.has('command'):
    rawExtractions.push(...extractCommands(preprocessed))

  if config.enabled_claim_types.has('dependency_version'):
    rawExtractions.push(...extractDependencyVersions(preprocessed, knownDeps))

  if config.enabled_claim_types.has('api_route'):
    rawExtractions.push(...extractApiRoutes(preprocessed))

  if config.enabled_claim_types.has('code_example'):
    rawExtractions.push(...extractCodeExamples(preprocessed))

  // 4. Validate paths (sandbox check)
  rawExtractions = rawExtractions.filter(e =>
    e.claim_type != 'path_reference' || isValidPath(e.extracted_value.path)
  )

  // 5. Deduplicate within this file
  rawExtractions = deduplicateWithinFile(rawExtractions)

  // 6. Convert to Claim records and persist
  claims = []
  for extraction in rawExtractions:
    claim = toClaim(repoId, docFile, extraction)
    claims.push(claim)

  // 7. Batch insert
  insertedClaims = batchInsertClaims(claims)

  return insertedClaims
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  docFile: "README.md"
  content: "# My Project\n\nSee `src/auth/handler.ts` for the authentication logic.\n\nRun `pnpm test:unit` to execute tests.\n"

Output: [
  {
    id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    source_file: "README.md",
    line_number: 3,
    claim_text: "See `src/auth/handler.ts` for the authentication logic.",
    claim_type: "path_reference",
    testability: "syntactic",
    extracted_value: { type: "path_reference", path: "src/auth/handler.ts" },
    keywords: ["auth", "handler"],
    extraction_confidence: 1.0,
    extraction_method: "regex",
    verification_status: "pending",
    last_verified_at: null,
    embedding: null,
    parent_claim_id: null,
    created_at: "2026-02-11T10:00:00Z",
    updated_at: "2026-02-11T10:00:00Z"
  },
  {
    id: "claim-uuid-002",
    repo_id: "repo-uuid-001",
    source_file: "README.md",
    line_number: 5,
    claim_text: "Run `pnpm test:unit` to execute tests.",
    claim_type: "command",
    testability: "syntactic",
    extracted_value: { type: "command", runner: "pnpm", script: "test:unit" },
    keywords: ["pnpm", "test:unit"],
    extraction_confidence: 1.0,
    extraction_method: "regex",
    verification_status: "pending",
    last_verified_at: null,
    embedding: null,
    parent_claim_id: null,
    created_at: "2026-02-11T10:00:00Z",
    updated_at: "2026-02-11T10:00:00Z"
  }
]
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  docFile: "docs/api.md"
  content: "## API Reference\n\nPOST /api/v2/users - Create a new user\nGET /api/v2/users/:id - Get user by ID\n"

Output: [
  {
    id: "claim-uuid-010",
    repo_id: "repo-uuid-001",
    source_file: "docs/api.md",
    line_number: 3,
    claim_text: "POST /api/v2/users - Create a new user",
    claim_type: "api_route",
    testability: "syntactic",
    extracted_value: { type: "api_route", method: "POST", path: "/api/v2/users" },
    keywords: ["api", "users", "POST"],
    extraction_confidence: 1.0,
    extraction_method: "regex",
    verification_status: "pending",
    ...
  },
  {
    id: "claim-uuid-011",
    source_file: "docs/api.md",
    line_number: 4,
    claim_text: "GET /api/v2/users/:id - Get user by ID",
    claim_type: "api_route",
    testability: "syntactic",
    extracted_value: { type: "api_route", method: "GET", path: "/api/v2/users/:id" },
    ...
  }
]
```

#### Negative Example

An RST file produces zero syntactic claims because Markdown regex patterns do not apply to RST:

```
Input:
  repoId: "repo-uuid-001"
  docFile: "README.rst"
  content: "Authentication\n==============\n\nSee ``src/auth/handler.ts`` for details."

Output: []
// RST files return empty -- syntactic extraction is Markdown-only.
// Semantic extraction (LLM) handles RST via the claim_extraction agent task.
```

#### Edge Cases

- **File > 100KB:** Return `[]` with a WARN log. Do not attempt extraction.
- **Empty content string:** Return `[]`.
- **No claims found:** Return `[]`. This is a valid result (DOCALIGN_E208 is informational, not an error).
- **MDX file with JSX components:** Pre-processing strips JSX tags; remaining text is processed normally.
- **`.cursorrules` file:** Treated as plaintext markdown. Same extraction patterns apply.
- **File with only frontmatter (no body):** Return `[]` after frontmatter stripping.
- **Binary content detected (null bytes):** Return `[]` with WARN log.
- **Disabled claim type in config:** Skip that extractor entirely. If all types disabled, return `[]`.

#### Error Handling

- **Database insert failure (DOCALIGN_E301):** Throw `DocAlignError`, retryable. Caller (L4 Worker) retries the job.
- **Pre-processing failure (malformed content):** Catch, log WARN, return `[]`. Do not crash the scan.
- **Regex timeout (catastrophic backtracking):** Each regex execution is wrapped with a 50ms timeout. On timeout, skip that pattern, log WARN with pattern name, continue with remaining patterns.

---

### 4.2 getClaimsByFile

#### Signature

```typescript
getClaimsByFile(repoId: string, sourceFile: string): Promise<Claim[]>
```

#### Algorithm

1. `SELECT * FROM claims WHERE repo_id = $1 AND source_file = $2 ORDER BY line_number`.
2. Map `ClaimRow` to `Claim` (camelCase conversion, JSONB parsing for `extracted_value`).
3. Return results.

#### Input/Output Example 1

```
Input:  getClaimsByFile("repo-uuid-001", "README.md")
Output: [
  { id: "claim-uuid-001", source_file: "README.md", line_number: 3, claim_type: "path_reference", ... },
  { id: "claim-uuid-002", source_file: "README.md", line_number: 5, claim_type: "command", ... },
  { id: "claim-uuid-003", source_file: "README.md", line_number: 12, claim_type: "dependency_version", ... }
]
// All claims from README.md, ordered by line number
```

#### Input/Output Example 2

```
Input:  getClaimsByFile("repo-uuid-001", "docs/nonexistent.md")
Output: []
// No claims exist for this file
```

#### Negative Example

Does NOT return claims from files with similar names. `getClaimsByFile("repo-uuid-001", "readme.md")` returns `[]` if claims are stored under `"README.md"`. File paths are case-sensitive.

#### Edge Cases

- File has been deleted but claims remain (stale state): returns existing claims. Caller decides whether to clean up.
- File with zero claims (all prose, no verifiable assertions): returns `[]`.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.3 getClaimsByRepo

#### Signature

```typescript
getClaimsByRepo(repoId: string): Promise<Claim[]>
```

#### Algorithm

1. `SELECT * FROM claims WHERE repo_id = $1 ORDER BY source_file, line_number`.
2. Map rows to `Claim[]`.
3. Return results.

#### Input/Output Example 1

```
Input:  getClaimsByRepo("repo-uuid-001")
Output: [
  { id: "claim-uuid-001", source_file: "CONTRIBUTING.md", line_number: 5, ... },
  { id: "claim-uuid-002", source_file: "CONTRIBUTING.md", line_number: 12, ... },
  { id: "claim-uuid-010", source_file: "README.md", line_number: 3, ... },
  { id: "claim-uuid-011", source_file: "README.md", line_number: 45, ... },
  { id: "claim-uuid-020", source_file: "docs/api.md", line_number: 10, ... }
]
// All claims across all doc files, ordered by file then line
```

#### Input/Output Example 2

```
Input:  getClaimsByRepo("repo-uuid-empty")
Output: []
// Repo exists but has no doc files or no extracted claims
```

#### Negative Example

Does NOT filter by verification status. Returns all claims regardless of whether they are `pending`, `verified`, `drifted`, or `uncertain`. Filtering is the caller's responsibility.

#### Edge Cases

- Repo with 1000+ claims: returns all. No pagination at this layer. Callers (L5 health score) process in-memory.
- Repo ID does not exist in DB: returns `[]` (no error thrown).

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.
- Query timeout on large repos: throw `DocAlignError` code `DOCALIGN_E302`, retryable.

---

### 4.4 getClaimById

#### Signature

```typescript
getClaimById(claimId: string): Promise<Claim | null>
```

#### Algorithm

1. `SELECT * FROM claims WHERE id = $1`.
2. Return mapped `Claim` or `null`.

#### Input/Output Example 1

```
Input:  getClaimById("claim-uuid-001")
Output: {
  id: "claim-uuid-001",
  repo_id: "repo-uuid-001",
  source_file: "README.md",
  line_number: 3,
  claim_text: "See `src/auth/handler.ts` for the authentication logic.",
  claim_type: "path_reference",
  testability: "syntactic",
  extracted_value: { type: "path_reference", path: "src/auth/handler.ts" },
  keywords: ["auth", "handler"],
  extraction_confidence: 1.0,
  extraction_method: "regex",
  verification_status: "pending",
  last_verified_at: null,
  embedding: null,
  parent_claim_id: null,
  created_at: "2026-02-11T10:00:00Z",
  updated_at: "2026-02-11T10:00:00Z"
}
```

#### Input/Output Example 2

```
Input:  getClaimById("claim-uuid-nonexistent")
Output: null
// Claim was deleted or never existed
```

#### Negative Example

Does NOT validate that the claim belongs to any particular repo. The `claimId` is a UUID primary key. Cross-repo access is prevented by application-level checks in the caller (and post-MVP by RLS per 3E-002).

#### Edge Cases

- Invalid UUID format: PostgreSQL rejects the query. Catch and return `null`.
- Claim exists but has `parent_claim_id` set (sub-claim): returned normally. Caller determines whether to also fetch the parent.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.5 reExtract

#### Signature

```typescript
reExtract(repoId: string, docFile: string, content: string): Promise<{
  added: Claim[];
  updated: Claim[];
  removed: string[];
}>
```

#### Algorithm (pseudocode)

```
function reExtract(repoId, docFile, content):
  // 1. Extract new claims from updated content
  newRawExtractions = runSyntacticExtraction(repoId, docFile, content)
  // (same pipeline as extractSyntactic steps 1-5, but returns RawExtraction[])

  // 2. Load existing claims for this file
  existingClaims = SELECT * FROM claims
    WHERE repo_id = repoId AND source_file = docFile
    AND extraction_method IN ('regex', 'heuristic')
    // Only diff syntactic claims; LLM claims are managed by agent tasks

  // 3. Compute diff
  diff = computeClaimDiff(existingClaims, newRawExtractions)

  BEGIN TRANSACTION

  // 4. Insert added claims
  addedClaims = []
  for extraction in diff.added:
    claim = toClaim(repoId, docFile, extraction)
    INSERT INTO claims VALUES (claim)
    addedClaims.push(claim)

  // 5. Update changed claims (preserve ID, verification history)
  updatedClaims = []
  for update in diff.updated:
    UPDATE claims SET
      claim_text = update.new_extraction.claim_text,
      line_number = update.new_extraction.line_number,
      extracted_value = update.new_extraction.extracted_value,
      keywords = generateKeywords(update.new_extraction),
      updated_at = NOW()
      // NOTE: verification_status is NOT reset.
      // If extracted_value changed, L3 re-verifies on next scan.
    WHERE id = update.existing_id
    updatedClaims.push(updated claim)

  // 6. Remove deleted claims
  removedIds = diff.removed
  DELETE FROM claims WHERE id = ANY(removedIds)
  // CASCADE deletes claim_mappings via FK

  COMMIT TRANSACTION

  return { added: addedClaims, updated: updatedClaims, removed: removedIds }
```

**Claim identity matching for diff:** Two claims are considered "the same" if they have the same `claim_type` AND the same identity key:
- `path_reference`: `extracted_value.path`
- `command`: `extracted_value.runner + ":" + extracted_value.script`
- `dependency_version`: `extracted_value.package`
- `api_route`: `extracted_value.method + " " + extracted_value.path`
- `code_example`: line number range (code blocks are positional)
- All others: `claim_text` exact match

If identity matches but `claim_text` or `extracted_value` differs, the claim is "updated" (same ID, new text). If identity has no match, it is "added." If an existing identity has no match in new extractions, it is "removed."

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  docFile: "README.md"
  content: "# Project\n\nSee `src/auth/service.ts` for auth.\n\nRun `pnpm test:integration` to test.\n"
  // Previously: `src/auth/handler.ts` and `pnpm test:unit`

Output: {
  added: [
    { id: "claim-uuid-050", claim_type: "command",
      extracted_value: { type: "command", runner: "pnpm", script: "test:integration" }, ... }
  ],
  updated: [
    { id: "claim-uuid-001", claim_type: "path_reference",
      extracted_value: { type: "path_reference", path: "src/auth/service.ts" }, ... }
      // Same identity (path_reference), but path changed from handler.ts to service.ts
  ],
  removed: ["claim-uuid-002"]
  // The old `pnpm test:unit` claim was removed (replaced by test:integration)
}
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  docFile: "README.md"
  content: "# Project\n\nSee `src/auth/handler.ts` for auth.\n\nRun `pnpm test:unit` to test.\n"
  // Content unchanged from previous extraction

Output: {
  added: [],
  updated: [],
  removed: []
}
// No changes detected
```

#### Negative Example

Does NOT re-extract LLM-sourced (semantic) claims. Only claims with `extraction_method IN ('regex', 'heuristic')` are diffed. Semantic claims are managed by the `claim_extraction` agent task and are replaced wholesale when the task completes.

```
Input:
  repoId: "repo-uuid-001"
  docFile: "docs/architecture.md"
  content: "...updated architecture prose..."
  // File had 3 LLM-extracted claims and 1 regex-extracted path

Output: {
  added: [],
  updated: [],   // or updates to the 1 regex claim if it changed
  removed: []
  // The 3 LLM claims are untouched. Server creates a new claim_extraction
  // agent task for the semantic re-extraction.
}
```

#### Edge Cases

- Doc file is new (no existing claims): all extractions appear in `added`, `removed` is `[]`.
- Doc file content is empty or whitespace only: all existing syntactic claims are in `removed`.
- Doc file format changed (e.g., renamed from `.md` to `.rst`): RST extraction returns `[]` for syntactic; all existing Markdown-based claims appear in `removed`.
- Concurrent `reExtract` calls for the same file: transaction isolation prevents conflicts. Second call sees committed state of first.

#### Error Handling

- Transaction failure: rollback. Throw `DocAlignError` code `DOCALIGN_E301`, retryable. L4 Worker retries the job.
- Claim insert constraint violation (duplicate ID): catch, log `DOCALIGN_E303`, skip. Should not happen with UUID generation.

---

### 4.6 deleteClaimsForFile

#### Signature

```typescript
deleteClaimsForFile(repoId: string, docFile: string): Promise<number>
```

#### Algorithm

1. `DELETE FROM claims WHERE repo_id = $1 AND source_file = $2 RETURNING id`.
2. CASCADE deletes remove associated `claim_mappings` rows via FK.
3. Return count of deleted claims.

#### Input/Output Example 1

```
Input:  deleteClaimsForFile("repo-uuid-001", "docs/removed-guide.md")
Output: 7
// 7 claims (both syntactic and semantic) were deleted for this file
```

#### Input/Output Example 2

```
Input:  deleteClaimsForFile("repo-uuid-001", "docs/nonexistent.md")
Output: 0
// No claims existed for this file
```

#### Negative Example

Does NOT delete claims from other files. `deleteClaimsForFile("repo-uuid-001", "docs/")` deletes ZERO claims -- it is an exact file path match, not a prefix match.

Does NOT selectively delete only syntactic or only semantic claims. ALL claims for the file are removed, regardless of `extraction_method`.

#### Edge Cases

- File had sub-claims (claims with `parent_claim_id` pointing to claims in this file): all are deleted (they share the same `source_file`).
- Claims from this file are referenced by `verification_results`: results are NOT cascade-deleted (they reference claims via FK with no CASCADE). Orphaned results are acceptable -- they become historical records.
- Concurrent delete + reExtract for same file: transaction isolation handles this. The operation that commits first wins.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

### 4.7 updateVerificationStatus

#### Signature

```typescript
updateVerificationStatus(claimId: string, status: Verdict | 'pending'): Promise<void>
```

#### Algorithm

1. `UPDATE claims SET verification_status = $2, last_verified_at = CASE WHEN $2 != 'pending' THEN NOW() ELSE last_verified_at END, updated_at = NOW() WHERE id = $1`.
2. If zero rows affected, log WARN (claim was deleted between verification and status update). Do NOT throw.

#### Input/Output Example 1

```
Input:  updateVerificationStatus("claim-uuid-001", "verified")
Output: void
// claim-uuid-001 now has verification_status='verified', last_verified_at=now()
```

#### Input/Output Example 2

```
Input:  updateVerificationStatus("claim-uuid-001", "pending")
Output: void
// claim-uuid-001 reset to pending. last_verified_at unchanged (preserves last known verification time).
```

#### Negative Example

Does NOT validate that the status transition is logical. Calling `updateVerificationStatus(id, "verified")` on a claim that is already `"verified"` simply updates `last_verified_at` again. There is no state machine enforcement -- this is intentional, as the same claim may be re-verified in different scan runs.

#### Edge Cases

- Claim was deleted between verification and status update (race condition): zero rows affected. Log WARN, return `void`. Not an error -- the claim is gone, so the status update is moot.
- Status value `'pending'`: accepted. Used by L7 when count-based exclusion is later revoked.

#### Error Handling

- Database error: throw `DocAlignError` code `DOCALIGN_E301`, retryable.

---

## 5. Performance Targets

| Operation | Target | Measured By |
|-----------|--------|-------------|
| `extractSyntactic` (single doc file, <50KB) | < 100ms | Wall clock time including all regex passes and DB insert |
| `extractSyntactic` (large doc file, ~100KB) | < 200ms | Wall clock time |
| Pre-processing (strip HTML, frontmatter, etc.) | < 10ms | Per file |
| Single regex pattern execution | < 5ms per file | Per pattern per file |
| `getClaimsByFile` | < 10ms | DB query time (indexed on `repo_id, source_file`) |
| `getClaimsByRepo` (500 claims) | < 50ms | DB query time (indexed on `repo_id`) |
| `getClaimById` | < 5ms | DB query time (indexed on primary key) |
| `reExtract` (20 existing claims, 25 new extractions) | < 200ms | Including diff computation and DB transaction |
| `deleteClaimsForFile` | < 10ms | DB delete time |
| `updateVerificationStatus` | < 5ms | DB update time |
| Batch insert (50 claims) | < 100ms | DB batch insert |

**Capacity targets:**

| Metric | MVP Target |
|--------|-----------|
| Claims per repo | Up to 5,000 |
| Claims per doc file | Up to 200 |
| Doc files per repo | Up to 500 |

---

## 6. Required Framework Knowledge

The implementing agent must be familiar with:

| Library/Tool | Version | Usage in L1 |
|-------------|---------|-------------|
| `pg` (node-postgres) | ^8.x | PostgreSQL queries for claim CRUD, batch inserts |
| `uuid` (or `crypto.randomUUID`) | Built-in | Generating claim UUIDs |
| `minimatch` or `picomatch` | Latest | Glob pattern matching for DOC_PATTERNS/DOC_EXCLUDE |
| `gray-matter` | ^4.x | Stripping YAML frontmatter from markdown/MDX files |
| `fast-glob` | Latest | Doc file discovery (DOC_PATTERNS union + heuristic scan) |

**Regex knowledge required:**

- JavaScript regex syntax with named capture groups
- Global match iteration (`matchAll`)
- Catastrophic backtracking awareness: all patterns must be tested for exponential blowup. Use the RE2 algorithm or wrap with timeout.
- Multi-line mode (`/m` flag) for code block matching

**Markdown knowledge required:**

- Fenced code block syntax (triple backtick with optional language identifier)
- Inline code (single backtick)
- Markdown link syntax: `[text](url)`
- Heading syntax (`#`, `##`, etc.) for chunk boundary detection
- Frontmatter syntax (YAML between `---` delimiters)
- MDX component syntax (`<Component prop={value}>` tags)

**Pre-processing knowledge:**

- HTML tag stripping (regex-based, not DOM parser -- documents are not valid HTML)
- Base64 image detection and removal (`data:image/...;base64,...`)
- SVG content detection and removal (`<svg>...</svg>`)
- JSX component tag stripping for MDX files

---

## 7. Open Questions

1. **Sub-claim extraction depth for code_example blocks:** The PRD states sub-claims (imports, symbols, commands) are extracted from code blocks. Per 3A Section 11.3, code_example sub-claims are JSONB-embedded in the parent's `extracted_value`, NOT separate DB rows. However, Spike A decomposition sub-claims ARE separate rows with `parent_claim_id`. The implementing agent must be careful to distinguish these two sub-claim patterns. Code_example sub-claims go into `{ language, imports[], symbols[], commands[] }` on the parent. Spike A sub-claims go into the `claims` table as new rows.

2. **Keyword generation strategy for semantic claims:** Syntactic claims generate keywords deterministically (e.g., path segments, package name, script name). Semantic claims (LLM-extracted) include keywords in the agent task result. The implementing agent should ensure keywords are stored consistently regardless of extraction method.

3. **Deduplication across files:** The PRD specifies dedup by `claim_type + extracted_value` for syntactic claims. When two files reference the same path, should both claims be stored (different `source_file`) and only one verified? Current design: store both, but mark as duplicates. Verification runs once and result propagates. The propagation mechanism is not yet specified. For MVP, verify both independently (simpler, slightly wasteful).

4. **Version regex false positive rate:** The VERSION_PATTERNS regex can match "Section 2.1" or "Table 3.2" as version claims. The known-dependency validation step filters most false positives. But if the repo has no manifest files, ALL version claims are discarded. This is acceptable for MVP (repos without manifests have no version claims to verify).

---

## Appendix A: Pre-Processing Pipeline

```
function preProcess(content: string, format: DocFormat): PreProcessedDoc:
  lines = content.split('\n')
  originalLineMap = []  // maps output line index -> original 1-based line number

  // Step 1: Strip YAML frontmatter (lines between --- delimiters at start of file)
  if lines[0] == '---':
    endIdx = lines.indexOf('---', 1)
    if endIdx > 0:
      lines = lines.slice(endIdx + 1)
      // Update line map: first output line maps to original line (endIdx + 2)

  // Step 2: Strip HTML tags
  for i, line in lines:
    line = line.replace(/<[^>]+>/g, '')  // remove HTML tags
    lines[i] = line

  // Step 3: Strip base64 images
  // Pattern: ![...](data:image/...;base64,...) or src="data:image/..."
  for i, line in lines:
    line = line.replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '')
    line = line.replace(/src="data:image\/[^"]+"/g, '')
    lines[i] = line

  // Step 4: Strip inline SVG
  // Multi-line: find <svg...>...</svg> blocks and blank them
  inSvg = false
  for i, line in lines:
    if line.includes('<svg'):
      inSvg = true
    if inSvg:
      lines[i] = ''
    if line.includes('</svg>'):
      inSvg = false

  // Step 5: Strip JSX component tags (MDX only)
  if format == 'mdx':
    for i, line in lines:
      // Remove self-closing: <Component prop="value" />
      line = line.replace(/<[A-Z][a-zA-Z]*\s[^>]*\/>/g, '')
      // Remove opening/closing: <Component>...</Component>
      // (simplified: strip lines that are pure JSX)
      if line.match(/^\s*<\/?[A-Z]/):
        lines[i] = ''
      else:
        lines[i] = line

  // Step 6: Build line map
  for i in range(len(lines)):
    originalLineMap[i] = i + frontmatterOffset + 1  // 1-based

  cleaned = lines.join('\n')

  return {
    cleaned_content: cleaned,
    original_line_map: originalLineMap,
    format: format,
    file_size_bytes: Buffer.byteLength(content, 'utf8')
  }
```

---

## Appendix B: Regex Patterns for Syntactic Extraction

These patterns are sourced from technical-reference.md Section 5. The implementing agent must use these exact patterns (or functionally equivalent) as the extraction foundation.

### B.1 File Path References

```typescript
const FILE_PATH_PATTERNS = [
  // Pattern 1: Backtick-wrapped paths — `path/to/file.ext`
  { name: 'backtick_path', regex: /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g },

  // Pattern 2: Markdown links — [text](path/to/file.ext)
  { name: 'markdown_link_path', regex: /\[.*?\]\(\.?\/?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\)/g },

  // Pattern 3: "see/in/at/from" text references
  { name: 'text_ref_path', regex: /(?:see|in|at|from|file)\s+[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/gi },
];

// POST-MATCH FILTERS (applied to every match):
// 1. Reject if contains '://' (URLs)
// 2. Reject if extension is image: .png, .jpg, .jpeg, .gif, .svg, .ico
// 3. Reject if path matches the current doc file (self-reference)
// 4. Reject if starts with '#' (anchor-only link)
// 5. Reject if extension is style: .css, .scss, .less
// 6. Reject if fails path validation (see Appendix C)
```

### B.2 CLI Commands

```typescript
const COMMAND_BLOCK_PATTERN = {
  // Fenced code blocks with shell language hints
  name: 'code_block_command',
  regex: /```(?:bash|sh|shell|zsh|console)?\n([\s\S]*?)```/g,
};

const COMMAND_INLINE_PATTERNS = [
  // Inline commands with known runner prefixes
  { name: 'inline_runner_command',
    regex: /`((?:npm|npx|yarn|pnpm|pip|cargo|go|make|docker|kubectl)\s+[^`]+)`/g },

  // "run/execute/use X" patterns
  { name: 'run_pattern_command',
    regex: /(?:run|execute|use)\s+`([^`]+)`/gi },
];

// CODE BLOCK LINE PARSING:
// 1. Split block content by newlines
// 2. If ANY line starts with '$' or '>': treat only those lines as commands
//    (strip the prompt prefix). Other lines are output — skip them.
// 3. If NO lines have prompt prefixes: treat all non-empty, non-comment lines
//    as commands. Comment lines start with '#'.
// 4. For each command line, detect the runner:
//    - First word if it matches a known runner (npm, npx, yarn, pnpm, pip,
//      cargo, go, make, docker, kubectl)
//    - "unknown" if no known runner detected
// 5. Extract script = everything after the runner keyword
```

### B.3 Dependency Versions

```typescript
const VERSION_PATTERNS = [
  // "React 18.2.0" / "Express v4.18"
  { name: 'word_version',
    regex: /(\w+(?:\.\w+)?)\s+v?(\d+\.\d+(?:\.\d+)?)/gi },

  // "Express version 4" / "React ^18.0.0"
  { name: 'explicit_version',
    regex: /(\w+(?:\.\w+)?)\s+(?:version\s+)?[v^~]?(\d+[\d.]*)/gi },

  // "uses Express.js" / "built with Fastify" / "requires Node.js" / "depends on lodash"
  { name: 'uses_pattern',
    regex: /(?:uses?|built\s+with|requires?|depends\s+on)\s+(\w+(?:\.\w+)?(?:\.js)?)/gi },

  // "Node.js 18+" / "Python 3.10" / "Ruby 3.2"
  { name: 'runtime_version',
    regex: /(?:Node\.?js|Python|Ruby|Go|Rust|Java)\s+(\d+[\d.+]*)/gi },
];

// POST-MATCH VALIDATION (critical for false positive reduction):
// 1. Load known dependencies from L0: getDependencyVersion(repoId, matchedPackage)
// 2. If matched package IS a known dependency: keep the claim
// 3. If matched package is NOT a known dependency:
//    a. Check if it's a runtime name (Node.js, Python, etc.) -- keep
//    b. Otherwise DISCARD the claim (prevents "Section 2.1" false positives)
// 4. Runtime version claims (Node.js 18+) always kept regardless of manifests
```

### B.4 API Routes

```typescript
const ROUTE_PATTERNS = [
  // "GET /api/v2/users" / "POST /users/:id" / "`DELETE /api/items/{itemId}`"
  { name: 'http_method_path',
    regex: /(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+[`"]?(\/[a-zA-Z0-9_\-/:{}.*]+)/gi },
];

// Extract:
// - method: the HTTP verb (uppercased)
// - path: the route path (strip surrounding backticks/quotes)
```

### B.5 Code Example Blocks

```typescript
const CODE_EXAMPLE_PATTERN = {
  // Fenced code blocks with any language identifier (or none)
  name: 'fenced_code_block',
  regex: /```(\w*)\n([\s\S]*?)```/g,
  // Capture group 1: language identifier (empty string if none)
  // Capture group 2: block content
};

// EXTRACTION LOGIC:
// 1. Match all fenced code blocks
// 2. Skip blocks already matched as CLI commands (bash/sh/shell/zsh/console)
//    UNLESS they contain mixed content (commands + imports)
// 3. For each code block, create a parent claim with:
//    claim_type: 'code_example'
//    extracted_value: {
//      type: 'code_example',
//      language: captured_language || null,
//      imports: extractImports(block_content),
//      symbols: extractSymbols(block_content),
//      commands: extractCommands(block_content)
//    }
//    Per 3A Section 11.3: imports, symbols, commands are JSONB fields on
//    the parent claim. They are NOT separate DB rows.
//
// IMPORT EXTRACTION from block content:
//   - JS/TS: /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
//   - JS/TS: /require\(\s*['"]([^'"]+)['"]\s*\)/g
//   - Python: /from\s+(\S+)\s+import/g
//
// SYMBOL EXTRACTION from block content:
//   - Function calls: /([A-Z][a-zA-Z0-9]*)\s*\(/g (PascalCase = likely class/component)
//   - Function calls: /([a-z][a-zA-Z0-9]*)\s*\(/g (camelCase = likely function)
//   - De-duplicate symbols within a block
//
// COMMAND EXTRACTION from block content:
//   - Same logic as B.2 code block line parsing
```

---

## Appendix C: Path Validation

```
function isValidPath(path: string): boolean:
  // 1. Reject paths containing '..' traversal
  if path.includes('..'):
    return false

  // 2. Reject absolute paths (starts with /)
  if path.startsWith('/'):
    return false

  // 3. Reject file:// URLs
  if path.startsWith('file://'):
    return false

  // 4. Reject paths with null bytes
  if path.includes('\0'):
    return false

  // 5. Strip leading './' (normalize)
  if path.startsWith('./'):
    path = path.slice(2)

  // 6. Reject empty path after normalization
  if path.length == 0:
    return false

  // 7. Reject paths longer than 500 characters (sanity limit)
  if path.length > 500:
    return false

  return true
```

Note: Symlink detection is NOT performed at extraction time (L1 does not have filesystem access). Symlink validation happens at verification time (L3 Tier 1) when checking against the L0 index.

---

## Appendix D: Document Chunking for LLM Extraction

This logic is used when creating `claim_extraction` agent task payloads. L4 (Worker) calls this to prepare the doc file for the LLM.

```
function chunkDocument(content: string, docFile: string): DocChunk[]:
  // 1. Pre-process (same as Appendix A)
  preprocessed = preProcess(content, detectFormat(docFile))

  // 2. Split at ## heading boundaries
  sections = splitAtHeadings(preprocessed.cleaned_content)

  chunks = []
  for section in sections:
    wordCount = countWords(section.content)

    // Skip sections under 50 words (unlikely to contain verifiable claims)
    if wordCount < 50:
      continue

    // If section exceeds 2000 words, split at paragraph boundaries
    if wordCount > 2000:
      paragraphs = section.content.split(/\n\n+/)
      currentChunk = { heading: section.heading, content: '', start_line: section.startLine, word_count: 0 }

      for paragraph in paragraphs:
        paraWords = countWords(paragraph)
        if currentChunk.word_count + paraWords > 2000 AND currentChunk.word_count > 0:
          chunks.push(currentChunk)
          currentChunk = { heading: section.heading + ' (cont.)', content: '', start_line: currentLine, word_count: 0 }
        currentChunk.content += paragraph + '\n\n'
        currentChunk.word_count += paraWords

      if currentChunk.word_count >= 50:
        chunks.push(currentChunk)
    else:
      chunks.push({
        heading: section.heading,
        content: section.content,
        start_line: section.startLine,
        word_count: wordCount
      })

  return chunks
```

**Splitting rules:**
1. Primary split: `##` heading boundaries (any heading level >= 2).
2. Secondary split: paragraph boundaries (`\n\n+`) if section > 2000 words.
3. Tertiary split: 2000-word intervals if no headings and no paragraph breaks.
4. Minimum chunk size: 50 words (smaller chunks are skipped).
5. Maximum file size: 100KB (files larger are skipped entirely).

---

## Appendix E: Claim Identity and Deduplication

### Within-file deduplication

```
function deduplicateWithinFile(extractions: RawExtraction[]): RawExtraction[]:
  seen = Map<string, RawExtraction>  // identity key -> first extraction

  for extraction in extractions:
    key = getIdentityKey(extraction)
    if not seen.has(key):
      seen.set(key, extraction)
    // else: duplicate within same file, keep first occurrence

  return Array.from(seen.values())
```

### Cross-file deduplication (query-time)

Cross-file deduplication is NOT enforced at insert time. Both files get their own claims. Deduplication is a query-time concern for verification scheduling:

```sql
-- Find duplicate claims across files (same type + same extracted_value)
SELECT claim_type, extracted_value, array_agg(id) as claim_ids, count(*) as dup_count
FROM claims
WHERE repo_id = $1 AND extraction_method IN ('regex', 'heuristic')
GROUP BY claim_type, extracted_value
HAVING count(*) > 1;
```

For semantic claims, deduplication uses embedding cosine similarity > 0.95 (client-side, during the `claim_extraction` agent task).

### Identity key function

```
function getIdentityKey(extraction: RawExtraction): string:
  switch extraction.claim_type:
    case 'path_reference':
      return 'path:' + extraction.extracted_value.path
    case 'command':
      return 'cmd:' + extraction.extracted_value.runner + ':' + extraction.extracted_value.script
    case 'dependency_version':
      return 'dep:' + extraction.extracted_value.package
    case 'api_route':
      return 'route:' + extraction.extracted_value.method + ':' + extraction.extracted_value.path
    case 'code_example':
      return 'code:' + extraction.line_number  // positional identity
    default:
      return extraction.claim_type + ':' + extraction.claim_text
```

---

## Appendix F: Keyword Generation

Keywords are used by L2 (Mapper) for symbol search. Generated deterministically for syntactic claims.

```
function generateKeywords(extraction: RawExtraction): string[]:
  switch extraction.claim_type:
    case 'path_reference':
      // Extract filename and directory names
      parts = extraction.extracted_value.path.split('/')
      filename = parts[parts.length - 1]
      nameWithoutExt = filename.replace(/\.[^.]+$/, '')
      return unique([nameWithoutExt, ...parts.filter(p => p.length > 2)])

    case 'command':
      return [extraction.extracted_value.runner, extraction.extracted_value.script]

    case 'dependency_version':
      pkg = extraction.extracted_value.package
      return [pkg, pkg.replace(/[-_.]js$/i, '')]  // "Express.js" -> also "Express"

    case 'api_route':
      // Extract meaningful path segments (skip param placeholders)
      segments = extraction.extracted_value.path
        .split('/')
        .filter(s => s.length > 0 && !s.startsWith(':') && !s.startsWith('{'))
      return [extraction.extracted_value.method, ...segments]

    case 'code_example':
      // Combine imported module names + called function names
      ev = extraction.extracted_value
      return unique([
        ...(ev.imports || []).map(i => i.split('/').pop()),
        ...(ev.symbols || []),
        ...(ev.commands || []).map(c => c.split(' ')[0])
      ].filter(Boolean))

    default:
      return []
```

---

## Appendix G: Error Code Reference (L1-specific)

| Code | Scenario | Severity | Recovery |
|------|----------|----------|----------|
| DOCALIGN_E208 | Zero claims extracted from doc file | low | Valid result. Log at INFO level. Not an error. |
| DOCALIGN_E301 | Database connection/query failure | high | Retry with per-call profile |
| DOCALIGN_E302 | Database query timeout | high | Retry with per-call profile |
| DOCALIGN_E303 | Database constraint violation | medium | Skip affected claim, log, continue |
| DOCALIGN_E501 | Invalid .docalign.yml configuration | medium | Fall back to defaults, log WARN |
| DOCALIGN_E502 | Invalid config value (e.g., unknown claim_type) | medium | Ignore invalid entry, use defaults |

All error codes conform to the schema in phase3-error-handling.md Section 1.1.

---

## Appendix H: Doc File Discovery

Used during full scans and onboarding. Not part of `ClaimExtractorService` interface but implemented in L1 module for reuse.

```
function discoverDocFiles(repoId: string, fileTree: string[]): string[]:
  // Source 1: Match against DOC_PATTERNS
  patternMatches = fileTree.filter(f => matchesAny(f, DOC_PATTERNS))

  // Source 2: Heuristic scan — .md files at root + first 2 directory levels
  heuristicMatches = fileTree.filter(f =>
    f.endsWith('.md') &&
    f.split('/').length <= 3  // root=1 level, dir/file=2, dir/dir/file=3
  )

  // Union and deduplicate
  allMatches = unique([...patternMatches, ...heuristicMatches])

  // Apply DOC_EXCLUDE patterns
  result = allMatches.filter(f => !matchesAny(f, DOC_EXCLUDE))

  return result.sort()
```

**DOC_PATTERNS:**
```
['README.md', 'README.mdx', 'README.rst', 'CONTRIBUTING.md', 'ARCHITECTURE.md',
 'CLAUDE.md', 'AGENTS.md', 'COPILOT-INSTRUCTIONS.md', '.cursorrules',
 'docs/**/*.md', 'docs/**/*.mdx', 'doc/**/*.md', 'wiki/**/*.md',
 'adr/**/*.md', 'ADR-*.md', '**/CLAUDE.md', '**/AGENTS.md', 'api/**/*.md']
```

**DOC_EXCLUDE:**
```
['node_modules/**', 'vendor/**', '.git/**', '**/CHANGELOG.md', '**/LICENSE.md']
```
