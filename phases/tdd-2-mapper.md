# TDD-2: Code-to-Claim Mapper (Layer 2)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 4), prd/L2-code-claim-mapper.md, technical-reference.md (Sections 3.3), tdd-0-codebase-index.md, tdd-1-claim-extractor.md, phase3-architecture.md, phase3-decisions.md (3C-001, 3B-D1), phase3-error-handling.md, spike-a-vague-claim-mapping.md
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 2 (Code-to-Claim Mapper) links extracted documentation claims to specific code files and entities that can serve as evidence for verification. It runs a progressive 4-step mapping pipeline (direct reference, symbol search, semantic search, LLM-assisted), maintains a reverse index for change-triggered scanning, and provides mapping maintenance operations (rename, delete, refresh). The mapper is entirely server-side and deterministic for Steps 1-3 (zero LLM calls); Step 4 is skipped in MVP.

**Boundaries:** L2 does NOT extract claims (L1), verify claims (L3), discover which files changed in a PR (L4), or generate embeddings (client-side Action). L2 receives structured `Claim` records and uses L0's lookup primitives to find code evidence. It produces `ClaimMapping` records consumed by L3 (verification routing and evidence assembly), L4 (reverse index for scope resolution), L5 (evidence context for PR comments), and L7 (co-change boost integration).

**MVP scope:** Steps 1-3 are fully implemented. Step 4 (LLM-assisted mapping for architecture/universal claims) is skipped entirely. Claims that fall through all three steps without a mapping are tracked with `mapping_method: 'skipped_flow'` or `'skipped_universal'` to inform v2 priorities.

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| L0 (CodebaseIndexService) | `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `searchRoutes`, `getDependencyVersion` | Steps 1-3 mapping |
| L1 (ClaimExtractorService) | `Claim` records with `extracted_value`, `keywords`, `claim_type` | Input to `mapClaim` |
| L7 (LearningService) | `getCoChangeBoost(repoId, codeFile, docFile)` | co_change_boost calculation at mapping creation |
| PostgreSQL | `claim_mappings` table, `code_entities` table (for entity line count JOIN) | All CRUD operations, reverse index query |
| `.docalign.yml` config | `mapping.semantic_threshold` (default 0.7) | Semantic search filtering |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| L3 (Verifier) | `getMappingsForClaim(claimId)` | Retrieve mappings for verification routing and evidence assembly |
| L3 (Verifier) | `getEntityLineCount(mappingId)` | Path 1/Path 2 routing decision (token estimation) |
| L4 (Worker) | `mapClaim(repoId, claim)` | Map new/changed claims after extraction |
| L4 (Worker) | `findClaimsByCodeFiles(repoId, codeFiles)` | Reverse index: which claims are affected by code changes |
| L4 (Worker) | `updateCodeFilePaths(repoId, renames)` | Maintenance: file renames in diff |
| L4 (Worker) | `removeMappingsForFiles(repoId, deletedFiles)` | Maintenance: file deletions in diff |
| L4 (Worker) | `refreshMapping(claimId)` | Re-run mapping pipeline after entity changes |
| L5 (Reporter) | `getMappingsForClaim(claimId)` | Evidence file list for PR comment formatting |
| L7 (Learning) | `getMappingsForClaim(claimId)` | Co-change tracking correlation |

Cross-layer call index (from phase4-api-contracts.md Section 15):
- L2 -> L0: `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `searchRoutes`, `getDependencyVersion`
- L2 -> L7: `getCoChangeBoost`
- L4 -> L2: `findClaimsByCodeFiles`, `mapClaim`, `updateCodeFilePaths`, `removeMappingsForFiles`

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md` Section 4. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `ClaimMapping` (Section 4.1) -- a single mapping from claim to code file/entity
- `MappingMethod` (Section 1) -- `'direct_reference' | 'symbol_search' | 'semantic_search' | 'llm_assisted' | 'manual' | 'co_change'`
- `ClaimMappingRow` (Section 12) -- database row type
- `Claim` (Section 3.1) -- input claim with `extracted_value` discriminated union
- `ExtractedValue` (Section 3.1) -- per-type structured extraction data
- `ClaimType` (Section 1) -- claim type enum
- `CodeEntity` (Section 2.1) -- code entity from L0 index
- `DependencyVersion` (Section 2.1) -- version + source metadata
- `RouteEntity` (Section 2.1) -- API route definition
- `ScriptInfo` (Section 2.1) -- package script definition

**Referenced service interfaces:**
- `MapperService` (Section 4.2) -- the full public API surface
- `CodebaseIndexService` (Section 2.2) -- L0 functions consumed by L2
- `LearningService` (Section 9.2) -- `getCoChangeBoost` consumed by L2

**Layer-internal types** (not in api-contracts, specific to L2 implementation):

```typescript
/** A candidate mapping produced by a single pipeline step before persistence */
interface MappingCandidate {
  code_file: string;
  code_entity_id: string | null;  // null = whole-file mapping
  confidence: number;              // raw confidence before co_change_boost
  mapping_method: MappingMethod;
  source_step: 1 | 2 | 3;         // which pipeline step produced this
}

/** Merged mappings after deduplication across pipeline steps */
interface MergedMappings {
  candidates: MappingCandidate[];
  skipped_step4: boolean;          // true if claim fell through Steps 1-3
  skip_classification: 'skipped_flow' | 'skipped_universal' | null;
}

/** Configuration for the mapping pipeline, loaded from .docalign.yml */
interface MappingConfig {
  semantic_threshold: number;       // default 0.7
  semantic_top_k: number;           // default 5
}

/** Runner-to-manifest mapping for command claims */
interface RunnerManifestMap {
  runner: string;
  manifest_files: string[];         // e.g., ['package.json'] for npm
}

/** Result of the getDependencyManifestFile helper */
interface DependencyManifestResult {
  file_path: string;                // e.g., 'package.json'
  version: string;
  source: 'lockfile' | 'manifest';
}

/** Step 4 skip tracking record (MVP only) */
interface SkippedClaimRecord {
  claim_id: string;
  classification: 'skipped_flow' | 'skipped_universal';
  reason: string;
}
```

---

## 4. Public API

### 4.1 mapClaim

#### Signature

```typescript
mapClaim(repoId: string, claim: Claim): Promise<ClaimMapping[]>
```

#### Algorithm (pseudocode)

```
function mapClaim(repoId, claim):
  config = loadMappingConfig(repoId)
  allCandidates: MappingCandidate[] = []

  // === STEP 1: Direct Reference Mapping ===
  step1Candidates = mapDirectReference(repoId, claim)
  allCandidates.push(...step1Candidates)

  // IMPORTANT: Do NOT stop on high-confidence (>= 0.9) match.
  // Continue through ALL steps to find additional mappings.
  // A behavior claim may map to multiple files.

  // === STEP 2: Symbol Search ===
  if claim.keywords.length > 0:
    step2Candidates = mapBySymbol(repoId, claim)
    allCandidates.push(...step2Candidates)

  // === STEP 3: Semantic Search ===
  step3Candidates = mapBySemantic(repoId, claim, config)
  allCandidates.push(...step3Candidates)

  // === STEP 4: LLM-Assisted (MVP: SKIP) ===
  merged = deduplicateAndMerge(allCandidates)

  if merged.candidates.length == 0:
    // No mappings found through Steps 1-3.
    // Classify for v2 tracking.
    classification = classifySkippedClaim(claim)
    merged.skipped_step4 = true
    merged.skip_classification = classification
    // Do NOT create a mapping record. The claim has zero mappings.
    // L3 will route it to Path 2 with routing_reason = 'no_mapping'.
    return []

  // === Apply co-change boost (3C-001) ===
  boostedCandidates = []
  for candidate in merged.candidates:
    boost = await learningService.getCoChangeBoost(
      repoId, candidate.code_file, claim.source_file
    )
    boostedConfidence = min(candidate.confidence + boost, 1.0)
    boostedCandidates.push({
      ...candidate,
      confidence: boostedConfidence,
      co_change_boost: boost
    })

  // === Persist mappings ===
  BEGIN TRANSACTION
  // Delete existing mappings for this claim (refresh)
  DELETE FROM claim_mappings WHERE claim_id = claim.id AND repo_id = repoId

  mappings: ClaimMapping[] = []
  for candidate in boostedCandidates:
    mapping = {
      id: generateUUID(),
      claim_id: claim.id,
      repo_id: repoId,
      code_file: candidate.code_file,
      code_entity_id: candidate.code_entity_id,
      confidence: candidate.confidence,
      co_change_boost: candidate.co_change_boost,
      mapping_method: candidate.mapping_method,
      created_at: NOW(),
      last_validated_at: NOW()
    }
    INSERT INTO claim_mappings VALUES (mapping)
    mappings.push(mapping)
  COMMIT TRANSACTION

  return mappings
```

**Step 1 sub-algorithm (`mapDirectReference`):**

```
function mapDirectReference(repoId, claim): MappingCandidate[]
  switch claim.claim_type:

    case 'path_reference':
      path = claim.extracted_value.path
      exists = await L0.fileExists(repoId, path)
      if exists:
        return [{
          code_file: path,
          code_entity_id: null,
          confidence: 1.0,
          mapping_method: 'direct_reference',
          source_step: 1
        }]
      return []

    case 'command':
      runner = claim.extracted_value.runner
      script = claim.extracted_value.script
      manifestFiles = getManifestFilesForRunner(runner)
      candidates = []
      for file in manifestFiles:
        exists = await L0.fileExists(repoId, file)
        if exists:
          candidates.push({
            code_file: file,
            code_entity_id: null,
            confidence: 1.0,
            mapping_method: 'direct_reference',
            source_step: 1
          })
      return candidates

    case 'dependency_version':
      pkg = claim.extracted_value.package
      depResult = await L0.getDependencyVersion(repoId, pkg)
      if depResult != null:
        manifestFile = resolveManifestFile(repoId, pkg, depResult.source)
        return [{
          code_file: manifestFile,
          code_entity_id: null,
          confidence: 1.0,
          mapping_method: 'direct_reference',
          source_step: 1
        }]
      return []

    case 'api_route':
      method = claim.extracted_value.method
      path = claim.extracted_value.path
      route = await L0.findRoute(repoId, method, path)
      if route != null:
        return [{
          code_file: route.file_path,
          code_entity_id: route.id,
          confidence: 1.0,
          mapping_method: 'direct_reference',
          source_step: 1
        }]
      // Fallback: fuzzy route search
      fuzzyRoutes = await L0.searchRoutes(repoId, path)
      candidates = []
      for r in fuzzyRoutes:
        if r.similarity >= 0.7:
          candidates.push({
            code_file: r.file,
            code_entity_id: null,
            confidence: r.similarity * 0.9,
            mapping_method: 'direct_reference',
            source_step: 1
          })
      return candidates

    default:
      return []
```

**Step 2 sub-algorithm (`mapBySymbol`):**

```
function mapBySymbol(repoId, claim): MappingCandidate[]
  candidates = []
  for keyword in claim.keywords:
    entities = await L0.findSymbol(repoId, keyword)
    for entity in entities:
      candidates.push({
        code_file: entity.file_path,
        code_entity_id: entity.id,
        confidence: 0.85,
        mapping_method: 'symbol_search',
        source_step: 2
      })
  return deduplicateByEntity(candidates)
```

**Step 3 sub-algorithm (`mapBySemantic`):**

```
function mapBySemantic(repoId, claim, config): MappingCandidate[]
  results = await L0.searchSemantic(repoId, claim.claim_text, config.semantic_top_k)
  candidates = []
  for result in results:
    if result.similarity >= config.semantic_threshold:
      candidates.push({
        code_file: result.file_path,
        code_entity_id: result.id,
        confidence: result.similarity * 0.8,
        mapping_method: 'semantic_search',
        source_step: 3
      })
  return candidates
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  claim: {
    id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    source_file: "README.md",
    line_number: 45,
    claim_text: "See `src/auth/handler.ts` for the authentication logic.",
    claim_type: "path_reference",
    extracted_value: { type: "path_reference", path: "src/auth/handler.ts" },
    keywords: ["auth", "handler"],
    ...
  }

Output: [
  {
    id: "mapping-uuid-001",
    claim_id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/handler.ts",
    code_entity_id: null,
    confidence: 1.0,
    co_change_boost: 0.06,
    mapping_method: "direct_reference",
    created_at: "2026-02-11T10:00:00Z",
    last_validated_at: "2026-02-11T10:00:00Z"
  },
  {
    id: "mapping-uuid-002",
    claim_id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/handler.ts",
    code_entity_id: "entity-uuid-101",
    confidence: 0.91,
    co_change_boost: 0.06,
    mapping_method: "symbol_search",
    created_at: "2026-02-11T10:00:00Z",
    last_validated_at: "2026-02-11T10:00:00Z"
  }
]
// Step 1 found the file (whole-file mapping, confidence 1.0).
// Step 2 found the "handleLogin" function via keyword "handler" (entity mapping, confidence 0.85 + 0.06 boost).
// Both returned because pipeline does NOT stop on high-confidence match.
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  claim: {
    id: "claim-uuid-020",
    repo_id: "repo-uuid-001",
    source_file: "docs/architecture.md",
    line_number: 42,
    claim_text: "The authentication service handles password reset via email.",
    claim_type: "behavior",
    extracted_value: { type: "behavior", description: "The authentication service handles password reset via email." },
    keywords: ["AuthService", "password", "reset", "email"],
    ...
  }

Output: [
  {
    id: "mapping-uuid-010",
    claim_id: "claim-uuid-020",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/service.ts",
    code_entity_id: "entity-uuid-100",
    confidence: 0.85,
    co_change_boost: 0.0,
    mapping_method: "symbol_search",
    created_at: "2026-02-11T10:00:00Z",
    last_validated_at: "2026-02-11T10:00:00Z"
  },
  {
    id: "mapping-uuid-011",
    claim_id: "claim-uuid-020",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/password.ts",
    code_entity_id: "entity-uuid-102",
    confidence: 0.66,
    co_change_boost: 0.0,
    mapping_method: "semantic_search",
    created_at: "2026-02-11T10:00:00Z",
    last_validated_at: "2026-02-11T10:00:00Z"
  }
]
// Step 1: no direct reference (behavior claim, no path/command/dep/route).
// Step 2: "AuthService" keyword matched class entity in service.ts (0.85).
// Step 3: semantic search found "hashPassword" function in password.ts (similarity 0.82, scaled to 0.82 * 0.8 = 0.656).
```

#### Negative Example

An architecture claim that falls through all three steps produces zero mappings and is tracked as skipped:

```
Input:
  repoId: "repo-uuid-001"
  claim: {
    id: "claim-uuid-030",
    claim_type: "architecture",
    claim_text: "The system uses event-driven architecture with RabbitMQ for async processing.",
    extracted_value: { type: "architecture", description: "..." },
    keywords: ["event-driven", "RabbitMQ", "async"],
    ...
  }

Output: []
// Step 1: no direct reference for architecture claims.
// Step 2: no symbol named "event-driven" or "RabbitMQ" found.
// Step 3: no code entity with similarity >= 0.7 to this claim text.
// Step 4: SKIPPED (MVP). Claim classified as 'skipped_flow'.
// Return empty array. L3 routes to Path 2 with routing_reason = 'no_mapping'.
```

This function does NOT produce a placeholder mapping record with confidence 0 for unmapped claims. Zero mappings is the correct signal for "no code evidence found."

#### Edge Cases

- **Claim with empty `keywords`:** Step 2 (symbol search) is skipped. Steps 1 and 3 still execute.
- **Claim with empty `extracted_value`:** Step 1 (direct reference) returns no candidates. Steps 2 and 3 still execute based on keywords and claim_text.
- **Duplicate candidates across steps:** `deduplicateAndMerge` keeps the highest-confidence candidate per (code_file, code_entity_id) pair. If Step 1 returns confidence 1.0 for a file and Step 3 returns 0.64 for the same file+entity, the Step 1 result wins.
- **code_example claim:** Step 1 is not applicable. Step 2 searches for each import path and symbol from `extracted_value.imports[]` and `extracted_value.symbols[]`. Step 3 uses the full code block text.
- **config claim:** Step 2 searches for the config key name. Step 3 uses semantic search on the description.
- **convention/environment claim:** Same as behavior: Step 2 on keywords, Step 3 on claim_text.
- **Claim already has mappings (re-mapping):** Existing mappings are deleted in the transaction before inserting new ones. This is a full replace, not a merge.
- **L0.searchSemantic returns empty (no embeddings):** Step 3 produces zero candidates. Graceful degradation -- other steps still contribute.
- **co_change_boost would push confidence above 1.0:** Capped at 1.0 via `min(confidence + boost, 1.0)`.

#### Error Handling

- **L0 function failure (DOCALIGN_E301):** Each L0 call is individually retryable via the per-call retry profile. If a Step fails after retries, that Step produces zero candidates. Other Steps still execute. The scan continues with partial mapping.
- **Database transaction failure on mapping persistence (DOCALIGN_E301):** Throw `DocAlignError`, retryable. L4 Worker retries the mapping job.
- **L0.searchSemantic embedding dimension mismatch (DOCALIGN_E408):** L0 returns `[]` (per TDD-0 Section 4.11). Step 3 produces zero candidates. No crash.
- **Database constraint violation on INSERT (DOCALIGN_E303):** Log and skip the individual mapping. Continue with remaining candidates.

---

### 4.2 findClaimsByCodeFiles

#### Signature

```typescript
findClaimsByCodeFiles(repoId: string, codeFiles: string[]): Promise<Claim[]>
```

#### Algorithm

```
function findClaimsByCodeFiles(repoId, codeFiles):
  if codeFiles.length == 0:
    return []

  // Reverse index query (indexed on repo_id, code_file)
  claims = SELECT DISTINCT c.* FROM claims c
    JOIN claim_mappings m ON c.id = m.claim_id
    WHERE m.code_file = ANY($codeFiles)
      AND m.repo_id = $repoId
    ORDER BY c.source_file, c.line_number

  return claims.map(row => toClaimModel(row))
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  codeFiles: ["src/auth/handler.ts", "src/routes/users.ts"]

Output: [
  {
    id: "claim-uuid-001",
    source_file: "README.md",
    line_number: 45,
    claim_type: "path_reference",
    claim_text: "See `src/auth/handler.ts` for the authentication logic.",
    ...
  },
  {
    id: "claim-uuid-011",
    source_file: "docs/api.md",
    line_number: 4,
    claim_type: "api_route",
    claim_text: "GET /api/v2/users/:id - Get user by ID",
    ...
  },
  {
    id: "claim-uuid-020",
    source_file: "docs/architecture.md",
    line_number: 42,
    claim_type: "behavior",
    claim_text: "The authentication service handles password reset via email.",
    ...
  }
]
// Returns all claims that have at least one mapping pointing to any of the given code files.
// Ordered by source_file then line_number.
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  codeFiles: ["src/utils/logger.ts"]

Output: []
// No claims are mapped to this utility file.
```

#### Negative Example

Does NOT return claims that merely mention a file path in their `claim_text` without having a mapping to it. If a claim says "see `src/utils/logger.ts`" but the mapping was removed (e.g., file was deleted), this function returns `[]` for that file. Only persisted `claim_mappings` records drive this query.

Does NOT return claims from other repos. The `repoId` parameter scopes the query.

#### Edge Cases

- **Empty `codeFiles` array:** Return `[]` immediately without executing a query.
- **Same claim mapped to multiple files in the input:** The `DISTINCT` ensures the claim appears only once.
- **Large file list (100+ files):** The `ANY($codeFiles)` uses the `idx_mappings_repo_codefile` index. Performance is acceptable for up to ~500 files per query.
- **Code file that was renamed:** If `updateCodeFilePaths` was called before this query, the old file path no longer exists in mappings. The new file path is in the mappings. The caller (L4) is responsible for calling `updateCodeFilePaths` before `findClaimsByCodeFiles`.

#### Error Handling

- **Database error (DOCALIGN_E301):** Throw `DocAlignError`, retryable.
- **Database query timeout (DOCALIGN_E302):** Throw `DocAlignError`, retryable. This is the most performance-critical query in L2 -- ensure proper indexing.

---

### 4.3 getMappingsForClaim

#### Signature

```typescript
getMappingsForClaim(claimId: string): Promise<ClaimMapping[]>
```

#### Algorithm

```
function getMappingsForClaim(claimId):
  rows = SELECT * FROM claim_mappings
    WHERE claim_id = $claimId
    ORDER BY confidence DESC, code_file ASC

  return rows.map(row => toClaimMappingModel(row))
```

#### Input/Output Example 1

```
Input:  getMappingsForClaim("claim-uuid-001")
Output: [
  {
    id: "mapping-uuid-001",
    claim_id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/handler.ts",
    code_entity_id: null,
    confidence: 1.0,
    co_change_boost: 0.06,
    mapping_method: "direct_reference",
    created_at: "2026-02-11T10:00:00Z",
    last_validated_at: "2026-02-11T10:00:00Z"
  },
  {
    id: "mapping-uuid-002",
    claim_id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/handler.ts",
    code_entity_id: "entity-uuid-101",
    confidence: 0.91,
    co_change_boost: 0.06,
    mapping_method: "symbol_search",
    created_at: "2026-02-11T10:00:00Z",
    last_validated_at: "2026-02-11T10:00:00Z"
  }
]
// Ordered by confidence descending.
```

#### Input/Output Example 2

```
Input:  getMappingsForClaim("claim-uuid-nonexistent")
Output: []
// Claim does not exist or has no mappings.
```

#### Negative Example

Does NOT validate that the claim exists. If `claimId` is a valid UUID but the claim was deleted (CASCADE deletes removed its mappings), this returns `[]`. It does NOT throw an error.

#### Edge Cases

- **Claim with zero mappings (architecture claim that fell through):** Returns `[]`.
- **Claim with many mappings (code_example with 10+ symbol hits):** Returns all, ordered by confidence descending.
- **Invalid UUID format for claimId:** PostgreSQL rejects. Catch and return `[]`.

#### Error Handling

- **Database error (DOCALIGN_E301):** Throw `DocAlignError`, retryable.

---

### 4.4 refreshMapping

#### Signature

```typescript
refreshMapping(claimId: string): Promise<ClaimMapping[]>
```

#### Algorithm

```
function refreshMapping(claimId):
  // 1. Load the claim
  claim = SELECT * FROM claims WHERE id = $claimId
  if claim == null:
    return []

  // 2. Re-run the full mapping pipeline
  // This internally deletes old mappings and creates new ones
  newMappings = await mapClaim(claim.repo_id, claim)

  // 3. Update last_validated_at on all new mappings
  UPDATE claim_mappings SET last_validated_at = NOW()
    WHERE claim_id = $claimId

  return newMappings
```

#### Input/Output Example 1

```
Input:  refreshMapping("claim-uuid-001")
Output: [
  {
    id: "mapping-uuid-050",
    claim_id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    code_file: "src/auth/service.ts",
    code_entity_id: "entity-uuid-110",
    confidence: 0.85,
    co_change_boost: 0.04,
    mapping_method: "symbol_search",
    ...
  }
]
// File was renamed from handler.ts to service.ts. Old direct_reference mapping
// is gone (file path no longer matches). Symbol search found the entity in the new file.
```

#### Input/Output Example 2

```
Input:  refreshMapping("claim-uuid-nonexistent")
Output: []
// Claim does not exist. No mappings created.
```

#### Negative Example

Does NOT preserve old mappings that are no longer valid. `refreshMapping` is a full re-run of the pipeline, which first deletes all existing mappings for the claim (inside `mapClaim`). If the code was refactored and old symbols no longer exist, the old mappings are replaced (or the claim may end up with zero mappings).

#### Edge Cases

- **Claim was deleted between function call start and claim lookup:** Returns `[]`. No error.
- **Concurrent refresh for the same claim:** Transaction isolation in `mapClaim` prevents conflicts. Second call sees committed state of first.
- **co_change_boost recalculated:** Yes -- refresh calls `getCoChangeBoost` with whatever co_changes records exist at that time (per 3C-001).

#### Error Handling

- **Database error (DOCALIGN_E301):** Throw `DocAlignError`, retryable.
- **L0 function failure during re-mapping:** Per-step graceful degradation (same as `mapClaim`).

---

### 4.5 updateCodeFilePaths

#### Signature

```typescript
updateCodeFilePaths(repoId: string, renames: Array<{ from: string; to: string }>): Promise<number>
```

#### Algorithm

```
function updateCodeFilePaths(repoId, renames):
  if renames.length == 0:
    return 0

  totalUpdated = 0
  BEGIN TRANSACTION

  for rename in renames:
    result = UPDATE claim_mappings
      SET code_file = $rename.to,
          last_validated_at = NOW()
      WHERE repo_id = $repoId
        AND code_file = $rename.from

    totalUpdated += result.rowCount

  COMMIT TRANSACTION
  return totalUpdated
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  renames: [
    { from: "src/auth/handler.ts", to: "src/auth/controller.ts" },
    { from: "src/utils/old-helper.ts", to: "src/utils/helper.ts" }
  ]

Output: 3
// 2 mappings pointed to handler.ts (now updated to controller.ts).
// 1 mapping pointed to old-helper.ts (now updated to helper.ts).
// Total: 3 rows updated.
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  renames: [
    { from: "src/nonexistent.ts", to: "src/renamed.ts" }
  ]

Output: 0
// No mappings pointed to the old file path.
```

#### Negative Example

Does NOT update `code_entities.file_path`. That is L0's responsibility (handled in `updateFromDiff`). This function ONLY updates `claim_mappings.code_file`.

Does NOT re-run the mapping pipeline. It performs a path substitution only. If the rename changes the semantics of the mapping (e.g., file was renamed AND restructured), a subsequent `refreshMapping` is needed.

#### Edge Cases

- **Rename chain (A -> B, B -> C in same diff):** Process renames sequentially within the transaction. If the diff reports both renames, the first UPDATE changes A->B, the second changes B->C. The final state is correct.
- **Rename to an existing file path (unlikely but possible via git merge):** The UPDATE succeeds. Two different claims may now map to the same file. This is valid behavior.
- **Empty renames array:** Return 0 immediately.

#### Error Handling

- **Database transaction failure (DOCALIGN_E301):** Throw `DocAlignError`, retryable. Rollback ensures no partial updates.

---

### 4.6 removeMappingsForFiles

#### Signature

```typescript
removeMappingsForFiles(repoId: string, deletedFiles: string[]): Promise<number>
```

#### Algorithm

```
function removeMappingsForFiles(repoId, deletedFiles):
  if deletedFiles.length == 0:
    return 0

  result = DELETE FROM claim_mappings
    WHERE repo_id = $repoId
      AND code_file = ANY($deletedFiles)

  return result.rowCount
```

#### Input/Output Example 1

```
Input:
  repoId: "repo-uuid-001"
  deletedFiles: ["src/legacy/old-auth.ts", "src/legacy/deprecated.ts"]

Output: 5
// 3 mappings pointed to old-auth.ts, 2 to deprecated.ts. All 5 deleted.
```

#### Input/Output Example 2

```
Input:
  repoId: "repo-uuid-001"
  deletedFiles: ["src/nonexistent.ts"]

Output: 0
// No mappings pointed to this file.
```

#### Negative Example

Does NOT delete the claims themselves. Only their code-side mappings are removed. A claim that loses its last mapping becomes a zero-mapping claim. L3 will route it to Path 2 on next verification.

Does NOT trigger re-mapping automatically. If a claim loses its only mapping and should be re-mapped to alternative files, the caller (L4 Worker) must call `refreshMapping(claimId)` separately.

#### Edge Cases

- **Empty `deletedFiles` array:** Return 0 immediately.
- **Same file in `deletedFiles` multiple times:** The `ANY` handles duplicates. Only one DELETE pass needed.
- **Large list (100+ deleted files):** Acceptable performance with the `idx_mappings_repo_codefile` index.

#### Error Handling

- **Database error (DOCALIGN_E301):** Throw `DocAlignError`, retryable.

---

### 4.7 getEntityLineCount

#### Signature

```typescript
getEntityLineCount(mappingId: string): Promise<number | null>
```

#### Algorithm

```
function getEntityLineCount(mappingId):
  // Decision 3B-D1: computed via LEFT JOIN, not stored
  result = SELECT
    ce.end_line_number - ce.line_number + 1 AS line_count
  FROM claim_mappings cm
  LEFT JOIN code_entities ce ON cm.code_entity_id = ce.id
  WHERE cm.id = $mappingId

  if result == null:
    return null  // mapping does not exist

  if result.line_count == null:
    return null  // code_entity_id is null (whole-file mapping) or entity was deleted

  return result.line_count
```

#### Input/Output Example 1

```
Input:  getEntityLineCount("mapping-uuid-002")
Output: 24
// Mapping points to entity-uuid-101 (handleLogin function)
// which spans lines 22-45 (end_line_number - line_number + 1 = 45 - 22 + 1 = 24)
```

#### Input/Output Example 2

```
Input:  getEntityLineCount("mapping-uuid-001")
Output: null
// Mapping has code_entity_id = null (whole-file mapping).
// No entity to count lines for.
```

#### Negative Example

Does NOT compute line count from the file itself (e.g., by counting lines in the raw file). It uses ONLY the `code_entities` table's `line_number` and `end_line_number` columns. If the entity was deleted between mapping creation and this query (SET NULL via FK), returns `null`.

Does NOT store the result in the mapping. Per decision 3B-D1, the line count is always computed live via JOIN to ensure freshness when entity code changes.

#### Edge Cases

- **Mapping does not exist:** Returns `null`.
- **Entity was deleted (code_entity_id was SET NULL by FK cascade):** Returns `null`. L3 treats this as a file-only mapping for routing purposes.
- **Entity with `end_line_number == line_number`:** Returns 1 (single-line entity, e.g., a route definition).
- **Invalid UUID for mappingId:** PostgreSQL rejects. Catch and return `null`.

#### Error Handling

- **Database error (DOCALIGN_E301):** Throw `DocAlignError`, retryable.

---

## 5. Performance Targets

| Operation | Target | Measured By |
|-----------|--------|-------------|
| `mapClaim` -- path_reference (Step 1 only hits) | < 15ms | Wall clock including L0.fileExists + DB insert |
| `mapClaim` -- command/dependency/route (Step 1) | < 20ms | Wall clock including L0 lookup + DB insert |
| `mapClaim` -- behavior claim (Steps 1-3) | < 300ms | Wall clock including all L0 calls + DB insert |
| `mapClaim` -- code_example (Steps 1-3, multiple symbols) | < 500ms | Wall clock including N findSymbol calls + semantic search |
| `findClaimsByCodeFiles` (10 files) | < 20ms | DB query time (indexed) |
| `findClaimsByCodeFiles` (100 files) | < 100ms | DB query time (indexed) |
| `getMappingsForClaim` | < 10ms | DB query time (indexed on claim_id) |
| `refreshMapping` (single claim) | < 500ms | Same as mapClaim + claim lookup |
| `updateCodeFilePaths` (10 renames) | < 20ms | DB update time |
| `removeMappingsForFiles` (10 files) | < 15ms | DB delete time |
| `getEntityLineCount` | < 5ms | DB query time (indexed JOIN) |
| Deduplication across steps (50 candidates) | < 2ms | In-memory processing |

**Capacity targets:**

| Metric | MVP Target |
|--------|-----------|
| Mappings per claim | Up to 20 |
| Total mappings per repo | Up to 25,000 (5,000 claims x 5 avg mappings) |
| Reverse index query (files per PR) | Up to 500 files |

---

## 6. Required Framework Knowledge

The implementing agent must be familiar with:

| Library/Tool | Version | Usage in L2 |
|-------------|---------|-------------|
| `pg` (node-postgres) | ^8.x | PostgreSQL queries for mapping CRUD, batch inserts, reverse index queries |
| `uuid` (or `crypto.randomUUID`) | Built-in | Generating mapping UUIDs |
| `minimatch` or `picomatch` | Latest | Glob pattern matching (future: Step 4 static rule scope matching, v2) |

**SQL knowledge required:**

- `ANY()` array operator for multi-file reverse index queries
- `LEFT JOIN` for entity line count computation (3B-D1)
- `DELETE ... WHERE` for mapping removal
- `INSERT ... ON CONFLICT` awareness (not used: full replace strategy via DELETE+INSERT)
- Transaction isolation levels (default READ COMMITTED is sufficient)
- Understanding of the `idx_mappings_repo_codefile` and `idx_mappings_claim` indexes

**L0 API knowledge required:**

The implementer must understand all L0 functions consumed (TDD-0):
- `fileExists` -- returns boolean, checks both entity table and file tree
- `findSymbol` -- exact match + case-insensitive fallback, returns `CodeEntity[]`
- `searchSemantic` -- pgvector cosine similarity, returns entities with similarity score
- `findRoute` -- exact match with parameterized path normalization
- `searchRoutes` -- structural path similarity matching
- `getDependencyVersion` -- returns `{ version, source }` or null
- `scriptExists` -- checks package.json scripts, Makefile targets, etc.
- `getEntityByFile` -- all entities in a file, used indirectly for evidence

**Claim type knowledge required:**

The implementer must understand all `ExtractedValue` discriminated union variants (from api-contracts Section 3.1) and how each maps to L0 lookups (see Appendix A).

---

## 7. Open Questions

1. **Fuzzy route search confidence scaling:** When `findRoute` returns null and `searchRoutes` returns fuzzy matches, the current design scales confidence as `similarity * 0.9`. This is an arbitrary factor. It should be validated with real data during Experiment 16.2 (semantic threshold calibration). The factor may need adjustment.

2. **code_example claim mapping depth:** When a code example block has 5 imports and 8 symbols, the mapper runs `findSymbol` 13 times. For large code blocks with many references, this could be slow. Consider batching symbol lookups if this becomes a bottleneck (query: `SELECT * FROM code_entities WHERE repo_id = $1 AND name = ANY($names)`).

3. **Manifest file resolution for dependency claims:** The mapper needs to resolve which specific manifest file contains a given dependency (e.g., `package.json` vs `requirements.txt`). L0's `getDependencyVersion` returns the version but not the file path directly. The mapper infers the file path from the runner ecosystem. If L0 adds a `getManifestFileForPackage` function, the resolution becomes cleaner. For MVP, the inference logic is sufficient.

4. **Step 4 skip classification accuracy:** The MVP heuristic for classifying skipped claims as `skipped_flow` vs `skipped_universal` uses keyword detection ("all", "every", "no", "never", "always", "each"). This may mis-classify some claims. The classification is for analytics only (informing v2 priorities), so mis-classification has low impact.

5. **Semantic threshold per-claim-type:** The current design uses a single `semantic_threshold` (0.7) for all claim types. Behavior claims may benefit from a lower threshold (more recall), while code_example claims may benefit from a higher threshold (more precision). Consider per-type thresholds in v2.

---

## Appendix A: Step-by-Step Mapping Logic per Claim Type

This appendix specifies exactly which pipeline steps apply to each claim type and what L0 functions are called.

### A.1 path_reference

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | Look up exact file path | `fileExists(repoId, path)` | 1.0 if exists |
| 2 | Search for filename-derived keywords | `findSymbol(repoId, keyword)` per keyword | 0.85 per match |
| 3 | Semantic search on claim text | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |

**Step 1 detail:** Extract `path` from `extracted_value.path`. Call `fileExists`. If true, create whole-file mapping (code_entity_id = null).

### A.2 command

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | Map runner to manifest file | `fileExists(repoId, manifestFile)` | 1.0 if exists |
| 2 | Search for script name as symbol | `findSymbol(repoId, script)` | 0.85 per match |
| 3 | Semantic search on command text | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |

**Step 1 detail:** Extract `runner` and `script` from `extracted_value`. Map runner to manifest files:

| Runner | Manifest Files |
|--------|---------------|
| `npm`, `npx`, `yarn`, `pnpm` | `package.json` |
| `make` | `Makefile` |
| `cargo` | `Cargo.toml` |
| `go` | `go.mod` (v2) |
| `pip`, `python` | `pyproject.toml`, `requirements.txt` |
| `docker` | `Dockerfile`, `docker-compose.yml` |
| `kubectl` | (no manifest; skip Step 1) |
| `unknown` | (skip Step 1) |

For each manifest file, call `fileExists`. Create whole-file mapping if found.

### A.3 dependency_version

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | Look up dependency in manifests | `getDependencyVersion(repoId, package)` | 1.0 if found |
| 2 | Search for package name as symbol | `findSymbol(repoId, package)` | 0.85 per match |
| 3 | Semantic search | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |

**Step 1 detail:** Extract `package` from `extracted_value`. Call `getDependencyVersion`. If found, resolve to manifest file path. For npm packages, the manifest is `package.json` (or lockfile). For Python packages, it is `requirements.txt` or `pyproject.toml`. The `source` field from `DependencyVersion` helps disambiguate: `'lockfile'` maps to the lockfile, `'manifest'` maps to the manifest.

**Manifest file resolution table:**

| Ecosystem | source='manifest' | source='lockfile' |
|-----------|-------------------|-------------------|
| npm/yarn/pnpm | `package.json` | `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` |
| Python (pip) | `requirements.txt` | (none commonly used) |
| Python (poetry) | `pyproject.toml` | `poetry.lock` |
| Rust | `Cargo.toml` | `Cargo.lock` |
| Go | `go.mod` | `go.sum` |

For MVP, map to the primary manifest file (not lockfile) since that is what documentation typically references.

### A.4 api_route

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | Exact route match | `findRoute(repoId, method, path)` | 1.0 if found |
| 1 (fallback) | Fuzzy route search | `searchRoutes(repoId, path)` | similarity * 0.9 |
| 2 | Search for path segment keywords | `findSymbol(repoId, keyword)` per keyword | 0.85 per match |
| 3 | Semantic search | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |

**Step 1 detail:** Extract `method` and `path` from `extracted_value`. Call `findRoute` for exact match. If found, create entity-level mapping (code_entity_id = route entity id). If not found, call `searchRoutes` for fuzzy matches. Filter by `similarity >= 0.7`. Scale confidence to `similarity * 0.9`.

### A.5 code_example

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | N/A (no direct reference for code blocks) | -- | -- |
| 2 | Search for each import and symbol | `findSymbol(repoId, name)` per import/symbol | 0.85 per match |
| 3 | Semantic search on full code block | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |

**Step 2 detail:** Extract `imports[]` and `symbols[]` from `extracted_value`. For each import, extract the module name (last segment of import path, e.g., `'./auth'` becomes `'auth'`). For each symbol, use as-is. Call `findSymbol` for each. Collect all entity matches.

### A.6 behavior / config / convention / environment

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | N/A (no deterministic lookup for these types) | -- | -- |
| 2 | Search for each keyword | `findSymbol(repoId, keyword)` per keyword | 0.85 per match |
| 3 | Semantic search on description/claim_text | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |

**Step 2 detail:** Use `claim.keywords[]` directly. These were generated by L1 during extraction.

### A.7 architecture (MVP: skip Step 4)

| Step | Action | L0 Function | Confidence |
|------|--------|-------------|------------|
| 1 | N/A | -- | -- |
| 2 | Search for each keyword | `findSymbol(repoId, keyword)` per keyword | 0.85 per match |
| 3 | Semantic search on description | `searchSemantic(repoId, claimText, topK)` | similarity * 0.8 |
| 4 | **SKIPPED** | -- | -- |

If Steps 2-3 produce zero mappings, classify for tracking:
- Contains "all", "every", "no ", "never", "always", "each", "any" (whole word, case-insensitive) -> `'skipped_universal'`
- Otherwise -> `'skipped_flow'`

---

## Appendix B: Co-Change Boost Calculation

Per decision 3C-001, the co-change boost is denormalized into `claim_mappings.co_change_boost` at mapping creation time.

### B.1 Boost Source

The boost is retrieved from L7 via `LearningService.getCoChangeBoost(repoId, codeFile, docFile)`. L7 computes the boost from the `co_changes` table:

```
boost = min(co_change_count * 0.02, 0.1)
// 0 co-changes: 0.0 boost
// 1 co-change:  0.02 boost
// 3 co-changes: 0.06 boost
// 5+ co-changes: 0.1 boost (capped)
```

### B.2 Application

The boost is added to the raw confidence from the pipeline step:

```
final_confidence = min(raw_confidence + co_change_boost, 1.0)
```

For example:
- Symbol search confidence 0.85 + boost 0.06 = 0.91
- Semantic search confidence 0.56 + boost 0.10 = 0.66
- Direct reference confidence 1.0 + boost 0.04 = 1.0 (capped)

### B.3 Storage

Both `confidence` (the final boosted value) and `co_change_boost` (the boost amount) are stored in the `claim_mappings` row. This enables:
- L3 to use `confidence` directly for routing decisions
- Auditing to see the unboosted confidence: `confidence - co_change_boost`
- Refresh to recalculate the boost from current co_changes data

### B.4 Refresh Behavior

When `refreshMapping` is called, the boost is recalculated from whatever `co_changes` records exist at that time. If old co_changes were purged (180-day retention), the boost may decrease. This is correct: the signal weakens as historical data ages out.

---

## Appendix C: Reverse Index Schema and Query

### C.1 Database Schema

The reverse index is implemented via the `claim_mappings` table with its `idx_mappings_repo_codefile` index:

```sql
-- From technical-reference.md Section 4.4
CREATE TABLE claim_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  code_file TEXT NOT NULL,
  code_entity_id UUID REFERENCES code_entities(id) ON DELETE SET NULL,
  confidence REAL NOT NULL,
  co_change_boost REAL NOT NULL DEFAULT 0.0,
  mapping_method TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Critical reverse index: given code files, find mapped claims
CREATE INDEX idx_mappings_repo_codefile ON claim_mappings(repo_id, code_file);

-- Forward index: given a claim, find its mappings
CREATE INDEX idx_mappings_claim ON claim_mappings(claim_id);
```

### C.2 Reverse Index Query

The primary reverse index query used by `findClaimsByCodeFiles`:

```sql
SELECT DISTINCT c.*
FROM claims c
JOIN claim_mappings m ON c.id = m.claim_id
WHERE m.code_file = ANY($1)
  AND m.repo_id = $2
ORDER BY c.source_file, c.line_number;
```

This query:
- Uses the `idx_mappings_repo_codefile` composite index for fast lookup
- JOINs to the `claims` table to return full claim data
- Uses `DISTINCT` to avoid duplicate claims when a claim maps to multiple changed files
- Accepts an array of file paths via `ANY($1)` for batch lookup

### C.3 Performance Characteristics

| Scenario | Expected Performance |
|----------|---------------------|
| 10 changed files, 50 total mappings matched | < 20ms |
| 100 changed files, 500 total mappings matched | < 100ms |
| 500 changed files (large refactor), 2000 mappings matched | < 500ms |

The index handles up to 25,000 mappings per repo (MVP capacity target) without degradation.

---

## Appendix D: Deduplication and Merge Algorithm

When a claim passes through multiple pipeline steps, the same code file or entity may appear in candidates from different steps. The deduplication strategy resolves these overlaps.

### D.1 Algorithm

```
function deduplicateAndMerge(candidates: MappingCandidate[]): MergedMappings:
  // Dedup key: (code_file, code_entity_id)
  // When code_entity_id is null, key is (code_file, null)
  // Keep the candidate with the highest confidence per key

  bestByKey = Map<string, MappingCandidate>

  for candidate in candidates:
    key = candidate.code_file + "|" + (candidate.code_entity_id ?? "null")
    existing = bestByKey.get(key)

    if existing == null OR candidate.confidence > existing.confidence:
      bestByKey.set(key, candidate)

  return {
    candidates: Array.from(bestByKey.values()),
    skipped_step4: false,
    skip_classification: null
  }
```

### D.2 Merge Rules

1. **Same file, same entity:** Keep highest confidence.
2. **Same file, different entities:** Keep both (they represent different evidence within the same file).
3. **Same file, one entity-level + one whole-file:** Keep both. The entity-level mapping provides specific evidence; the whole-file mapping provides context.
4. **Direct reference always wins over symbol/semantic for same target:** Direct reference has confidence 1.0, which is always highest.

### D.3 Example

```
Candidates from pipeline:
  Step 1: { code_file: "src/auth/handler.ts", entity: null, confidence: 1.0, method: "direct_reference" }
  Step 2: { code_file: "src/auth/handler.ts", entity: "entity-101", confidence: 0.85, method: "symbol_search" }
  Step 3: { code_file: "src/auth/handler.ts", entity: "entity-101", confidence: 0.66, method: "semantic_search" }
  Step 3: { code_file: "src/auth/password.ts", entity: "entity-102", confidence: 0.58, method: "semantic_search" }

After dedup:
  { code_file: "src/auth/handler.ts", entity: null, confidence: 1.0 }      -- from Step 1, key: handler.ts|null
  { code_file: "src/auth/handler.ts", entity: "entity-101", confidence: 0.85 } -- from Step 2, key: handler.ts|entity-101 (beats Step 3's 0.66)
  { code_file: "src/auth/password.ts", entity: "entity-102", confidence: 0.58 } -- from Step 3, unique key
```

---

## Appendix E: Skipped Claim Classification (MVP)

### E.1 Classification Heuristic

When a claim falls through Steps 1-3 with zero mappings, classify it for v2 analytics:

```
function classifySkippedClaim(claim: Claim): 'skipped_flow' | 'skipped_universal'
  text = claim.claim_text.toLowerCase()

  // Universal indicators (whole word match)
  universalPatterns = [
    /\ball\b/,
    /\bevery\b/,
    /\bno\s/,
    /\bnever\b/,
    /\balways\b/,
    /\beach\b/,
    /\bany\b/
  ]

  for pattern in universalPatterns:
    if pattern.test(text):
      return 'skipped_universal'

  return 'skipped_flow'
```

### E.2 Tracking

Skipped claims are NOT stored in `claim_mappings`. Instead, the classification is logged:

```
log(INFO, {
  code: "MAPPER_STEP4_SKIP",
  claimId: claim.id,
  claimType: claim.claim_type,
  classification: classification,
  claimText: claim.claim_text.substring(0, 200)
})
```

This log data is used for analytics to measure the distribution of flow vs universal skipped claims and inform v2 implementation priorities.

---

## Appendix F: Runner-to-Manifest File Mapping

Used by Step 1 when mapping `command` claims.

```typescript
const RUNNER_MANIFEST_MAP: RunnerManifestMap[] = [
  { runner: 'npm',     manifest_files: ['package.json'] },
  { runner: 'npx',     manifest_files: ['package.json'] },
  { runner: 'yarn',    manifest_files: ['package.json'] },
  { runner: 'pnpm',    manifest_files: ['package.json'] },
  { runner: 'make',    manifest_files: ['Makefile'] },
  { runner: 'cargo',   manifest_files: ['Cargo.toml'] },
  { runner: 'go',      manifest_files: ['go.mod'] },
  { runner: 'pip',     manifest_files: ['pyproject.toml', 'requirements.txt'] },
  { runner: 'python',  manifest_files: ['pyproject.toml', 'requirements.txt'] },
  { runner: 'docker',  manifest_files: ['Dockerfile', 'docker-compose.yml', 'compose.yml'] },
  { runner: 'kubectl', manifest_files: [] },  // no manifest
  { runner: 'unknown', manifest_files: [] },  // no manifest
];

function getManifestFilesForRunner(runner: string): string[] {
  const entry = RUNNER_MANIFEST_MAP.find(m => m.runner === runner);
  return entry?.manifest_files ?? [];
}
```

---

## Appendix G: Error Code Reference (L2-specific)

| Code | Scenario | Severity | Recovery |
|------|----------|----------|----------|
| DOCALIGN_E301 | Database connection/query failure | high | Retry with per-call profile |
| DOCALIGN_E302 | Database query timeout (reverse index) | high | Retry with per-call profile |
| DOCALIGN_E303 | Database constraint violation on INSERT | medium | Skip individual mapping, log, continue |
| DOCALIGN_E401 | L0 function failure (tree-sitter related) | medium | Step produces zero candidates, other steps continue |
| DOCALIGN_E408 | Embedding dimension mismatch in semantic search | medium | Step 3 returns zero candidates, Steps 1-2 still contribute |

All error codes conform to the schema in phase3-error-handling.md Section 1.1.

---

## Appendix H: Entity Line Count JOIN Query (3B-D1)

The entity line count is used by L3 for Path 1/Path 2 routing (token estimation). Per decision 3B-D1, it is computed via LEFT JOIN rather than stored.

### H.1 Query

```sql
SELECT
  cm.id AS mapping_id,
  cm.code_file,
  cm.code_entity_id,
  ce.line_number,
  ce.end_line_number,
  CASE
    WHEN ce.id IS NOT NULL
    THEN ce.end_line_number - ce.line_number + 1
    ELSE NULL
  END AS line_count
FROM claim_mappings cm
LEFT JOIN code_entities ce ON cm.code_entity_id = ce.id
WHERE cm.id = $1;
```

### H.2 Batch Variant

For routing multiple mappings at once (used by L3 when routing a batch of claims):

```sql
SELECT
  cm.id AS mapping_id,
  cm.claim_id,
  cm.code_file,
  cm.code_entity_id,
  cm.confidence,
  CASE
    WHEN ce.id IS NOT NULL
    THEN ce.end_line_number - ce.line_number + 1
    ELSE NULL
  END AS line_count
FROM claim_mappings cm
LEFT JOIN code_entities ce ON cm.code_entity_id = ce.id
WHERE cm.claim_id = ANY($1)
ORDER BY cm.claim_id, cm.confidence DESC;
```

### H.3 NULL Handling

- `code_entity_id IS NULL` (whole-file mapping): `line_count` is NULL. L3 treats this as "unknown size" and routes to Path 2 with reason `'file_only_mapping'`.
- Entity was deleted (SET NULL via FK): same as above.
- Entity exists but `end_line_number == line_number`: `line_count` is 1. L3 treats this as a small entity (Path 1 eligible).
