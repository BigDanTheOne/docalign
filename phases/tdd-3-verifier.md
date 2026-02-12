# TDD-3: Verification Engine (Layer 3)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Sections 1, 5), prd/L3-verification-engine.md, technical-reference.md (Sections 3.4, 7), tdd-0-codebase-index.md, tdd-1-claim-extractor.md, tdd-2-mapper.md, spike-b-evidence-assembly.md, phase3-architecture.md (ADRs 2-3, Section 7), phase3-decisions.md (3C-005, 3B-D1, 3B-D3, REVIEW-003), phase3-error-handling.md
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 3 (Verification Engine) determines whether a documentation claim still accurately reflects the codebase. It executes deterministic verification (Tiers 1-2, server-side, zero LLM calls), routes semantic claims to Path 1 or Path 2 for client-side LLM verification (Tier 4), assembles entity-extracted evidence for Path 1, and provides result storage and retrieval. Tier 5 (post-check) is stubbed for v2.

**Boundaries:** L3 does NOT extract claims (L1), map claims to code (L2), trigger scans (L4), format PR comments (L5), or execute LLM calls (client-side Action). L3 receives `Claim` + `ClaimMapping[]` pairs and produces `VerificationResult` records (for deterministic tiers) or `RoutingDecision` + `FormattedEvidence` structures (for agent-delegated tiers). All LLM-based verification (Tier 4) happens in the GitHub Action; L3's server-side role is limited to deterministic checks, routing, evidence assembly, and result persistence.

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| L0 (CodebaseIndexService) | `fileExists`, `findSymbol`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getAvailableScripts`, `getEntityByFile`, `getFileTree` | Tier 1/2 verification, Path 1 evidence assembly |
| L2 (MapperService) | `getMappingsForClaim(claimId)`, `getEntityLineCount(mappingId)` | Called by L4 before invoking L3; mappings passed as arguments |
| L1 (ClaimExtractorService) | `Claim` records with `extracted_value`, `claim_type`, `testability` | Input to all verification functions (passed by L4) |
| PostgreSQL | `verification_results` table | `storeResult`, `mergeResults`, `getLatestResult` |
| `.docalign.yml` config | `mapping.path1_max_evidence_tokens` (default 4000) | Routing token cap |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| L4 (Worker) | `verifyDeterministic(claim, mappings)` | Tiers 1-2 server-side verification |
| L4 (Worker) | `routeClaim(claim, mappings)` | Routing decision before agent task creation |
| L4 (Worker) | `buildPath1Evidence(claim, mappings)` | Build evidence payload for Path 1 agent tasks |
| L4 (Worker) | `storeResult(result)` | Persist verification results (deterministic + agent) |
| L4 (Worker) | `mergeResults(scanRunId)` | Merge all results after scan completes |
| L5 (Reporter) | `getLatestResult(claimId)` | Fetch latest result for PR comment formatting |
| L7 (Learning) | `getLatestResult(claimId)` | Feedback correlation |

Cross-layer call index (from phase4-api-contracts.md Section 15):
- L3 -> L0: `fileExists`, `findSymbol`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getAvailableScripts`, `getEntityByFile`, `getFileTree`
- L4 -> L3: `verifyDeterministic`, `routeClaim`, `buildPath1Evidence`, `storeResult`, `mergeResults`

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md`. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `VerificationResult` (Section 5.1) -- verification outcome record
- `RoutingDecision` (Section 5.1) -- Path 1/2 routing decision
- `RoutingReason` (Section 5.1) -- reason enum for routing
- `FormattedEvidence` (Section 5.2) -- evidence payload for Path 1
- `Verdict` (Section 1) -- `'verified' | 'drifted' | 'uncertain'`
- `Severity` (Section 1) -- `'high' | 'medium' | 'low'`
- `VerificationPath` (Section 1) -- `1 | 2`
- `PostCheckOutcome` (Section 1) -- `'confirmed' | 'contradicted' | 'skipped'`
- `Claim` (Section 3.1) -- input claim with `extracted_value` discriminated union
- `ExtractedValue` (Section 3.1) -- per-type structured extraction data
- `ClaimType` (Section 1) -- claim type enum
- `ClaimMapping` (Section 4.1) -- code mapping with optional entity
- `CodeEntity` (Section 2.1) -- indexed code entity
- `DependencyVersion` (Section 2.1) -- version + source metadata (3B-D3)
- `RouteEntity` (Section 2.1) -- API route definition
- `ScriptInfo` (Section 2.1) -- package script definition
- `VerificationResultRow` (Section 12) -- database row type

**Referenced service interfaces:**
- `VerifierService` (Section 5.2) -- the full public API surface
- `CodebaseIndexService` (Section 2.2) -- L0 functions consumed by L3
- `MapperService` (Section 4.2) -- L2 `getEntityLineCount` for routing

**Layer-internal types** (not in api-contracts, specific to L3 implementation):

```typescript
/** Result of Levenshtein-based similar path search */
interface SimilarPathResult {
  path: string;
  distance: number;          // Levenshtein edit distance
  match_type: 'basename' | 'full_path';
}

/** Version comparison result for dependency claims */
interface VersionComparison {
  matches: boolean;
  comparison_type: 'major_only' | 'major_minor' | 'exact';
  documented_version: string;
  actual_version: string;
  source: 'lockfile' | 'manifest';
}

/** Pattern verification strategy for Tier 2 */
interface PatternStrategy {
  name: string;
  applies_to: ClaimType[];
  /** Returns a result or null (falls through to Tier 4) */
  execute(
    claim: Claim,
    index: CodebaseIndexService
  ): Promise<VerificationResult | null>;
}

/** Configuration for the verification engine, from .docalign.yml */
interface VerifierConfig {
  path1_max_evidence_tokens: number;  // default 4000
  path1_max_import_lines: number;     // default 30
  path1_max_type_signatures: number;  // default 3
  path1_max_type_lines: number;       // default 100
  chars_per_token: number;            // default 4
}

/** Close match result for script/command lookup */
interface CloseMatchResult {
  name: string;
  distance: number;
}

/** Token estimation result for routing decisions */
interface TokenEstimate {
  entity_tokens: number;
  import_tokens: number;
  type_signature_tokens: number;
  total: number;
}

/** Route search alternative for API route verification */
interface RouteAlternative {
  method: string;
  path: string;
  file: string;
  line: number;
  similarity: number;
}
```

---

## 4. Public API

### 4.1 verifyDeterministic

#### Signature

```typescript
verifyDeterministic(claim: Claim, mappings: ClaimMapping[]): Promise<VerificationResult | null>
```

#### Algorithm (pseudocode)

```
function verifyDeterministic(claim, mappings):
  startTime = now()

  // === TIER 1: Syntactic Verification ===
  if claim.testability == 'syntactic':
    result = null

    switch claim.claim_type:
      case 'path_reference':
        result = verifyPathReference(claim)
      case 'command':
        result = verifyCommand(claim)
      case 'dependency_version':
        result = verifyDependencyVersion(claim)
      case 'api_route':
        result = verifyApiRoute(claim)
      case 'code_example':
        result = verifyCodeExample(claim)
      default:
        // Syntactic claim of unknown type -- fall through
        result = null

    if result != null:
      result.duration_ms = now() - startTime
      result.tier = 1
      result.confidence = 1.0
      result.token_cost = null      // deterministic, no LLM
      result.verification_path = null
      result.post_check_result = null
      return result

  // === TIER 2: Pattern Verification ===
  if claim.claim_type in ['convention', 'environment']:
    strategy = getPatternStrategy(claim)
    if strategy != null:
      result = strategy.execute(claim, L0)
      if result != null:
        result.duration_ms = now() - startTime
        result.tier = 2
        result.token_cost = null
        result.verification_path = null
        result.post_check_result = null
        return result

  // Neither Tier 1 nor Tier 2 produced a result.
  // Claim proceeds to Tier 4 (LLM, client-side). Return null.
  return null
```

#### Input/Output Example 1

```
Input:
  claim: {
    id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    claim_type: "path_reference",
    testability: "syntactic",
    claim_text: "See `src/auth/handler.ts` for authentication logic.",
    extracted_value: { type: "path_reference", path: "src/auth/handler.ts" },
    ...
  }
  mappings: [{
    id: "mapping-uuid-001",
    code_file: "src/auth/handler.ts",
    code_entity_id: null,
    confidence: 1.0,
    ...
  }]

Output: {
  id: "<generated-uuid>",
  claim_id: "claim-uuid-001",
  repo_id: "repo-uuid-001",
  scan_run_id: "<current-scan-run-id>",
  verdict: "verified",
  confidence: 1.0,
  tier: 1,
  severity: null,
  reasoning: "File 'src/auth/handler.ts' exists in the repository.",
  specific_mismatch: null,
  suggested_fix: null,
  evidence_files: ["src/auth/handler.ts"],
  token_cost: null,
  duration_ms: 3,
  post_check_result: null,
  verification_path: null,
  created_at: "2026-02-11T14:00:00Z"
}
```

#### Input/Output Example 2

```
Input:
  claim: {
    id: "claim-uuid-002",
    repo_id: "repo-uuid-001",
    claim_type: "dependency_version",
    testability: "syntactic",
    claim_text: "Uses React 18",
    extracted_value: { type: "dependency_version", package: "react", version: "18" },
    ...
  }
  mappings: [{ code_file: "package.json", code_entity_id: null, ... }]

Output: {
  id: "<generated-uuid>",
  claim_id: "claim-uuid-002",
  repo_id: "repo-uuid-001",
  scan_run_id: "<current-scan-run-id>",
  verdict: "verified",
  confidence: 1.0,
  tier: 1,
  severity: null,
  reasoning: "Package 'react' version '18.2.0' (from lockfile) matches documented version '18' (major-only prefix match).",
  specific_mismatch: null,
  suggested_fix: null,
  evidence_files: ["package.json"],
  token_cost: null,
  duration_ms: 4,
  post_check_result: null,
  verification_path: null,
  created_at: "2026-02-11T14:00:00Z"
}
```

#### Negative Example

A behavior claim (`testability: 'semantic'`) passed to `verifyDeterministic` returns `null`, NOT an uncertain result. Semantic claims cannot be verified deterministically and must proceed to Tier 4:

```
Input:
  claim: {
    id: "claim-uuid-020",
    claim_type: "behavior",
    testability: "semantic",
    claim_text: "The AuthService handles password reset via email.",
    ...
  }
  mappings: [{ code_file: "src/auth/service.ts", ... }]

Output: null
// Behavior claims are NOT handled by Tiers 1-2.
// Claim proceeds to routeClaim() -> Tier 4 (LLM).
```

#### Edge Cases

- **Syntactic claim with unrecognized `claim_type`:** Falls through Tier 1 switch, tries Tier 2 (no match for non-convention types), returns `null`.
- **Convention claim with no matching pattern strategy:** Tier 2 returns `null`. Claim proceeds to Tier 4.
- **Claim with `testability: 'untestable'`:** Both tiers skip. Returns `null`. L4 Worker marks as `uncertain` directly (no agent task created).
- **Empty mappings array:** Tier 1 functions that need file context (path_reference, code_example) still operate using `extracted_value` and L0 lookups, not mappings. Mappings are informational for evidence_files only.
- **L0 function returns unexpected error:** Caught at per-call level, retried per retry profile. If still failing, the individual Tier 1 check returns `null` (falls through), not a crash.

#### Error Handling

- **L0 function failure (DOCALIGN_E301):** Each L0 call retried per per-call retry profile (2 attempts, 1s/4s backoff). On exhaustion, the individual check returns `null` (claim falls through to Tier 4). Scan continues.
- **Database error during result construction (DOCALIGN_E301):** UUID generation failure is critical. Throw `DocAlignError`, retryable at the job level.
- **Unexpected exception in Tier 1/2 check:** Caught at the function boundary. Log `DOCALIGN_E401` with context (claim_id, claim_type). Return `null` (safe fallback to Tier 4).

---

### 4.2 routeClaim

#### Signature

```typescript
routeClaim(claim: Claim, mappings: ClaimMapping[]): Promise<RoutingDecision>
```

#### Algorithm (pseudocode)

```
function routeClaim(claim, mappings):
  config = loadVerifierConfig(claim.repo_id)

  // No mappings -> Path 2
  if mappings.length == 0:
    return { claim_id: claim.id, path: 2, reason: 'no_mapping', entity_token_estimate: null }

  // Partition mappings by file
  fileGroups = groupBy(mappings, m => m.code_file)

  // Multi-file -> Path 2
  if fileGroups.size > 1:
    return { claim_id: claim.id, path: 2, reason: 'multi_file', entity_token_estimate: null }

  // Single file -- check entity mappings
  entityMappings = mappings.filter(m => m.code_entity_id != null)

  // No entity-level mappings (file-only) -> Path 2
  if entityMappings.length == 0:
    return { claim_id: claim.id, path: 2, reason: 'file_only_mapping', entity_token_estimate: null }

  // Single or multiple entities in same file -- estimate tokens
  totalTokenEstimate = 0

  for mapping in entityMappings:
    lineCount = await L2.getEntityLineCount(mapping.id)
    if lineCount == null:
      // Entity deleted or whole-file mapping slipped through; fall to Path 2
      return { claim_id: claim.id, path: 2, reason: 'file_only_mapping', entity_token_estimate: null }
    entityTokens = estimateTokens(lineCount, config.chars_per_token)
    totalTokenEstimate += entityTokens

  // Add estimated import tokens (30 lines max ~ 120 tokens)
  importTokenEstimate = 30 * config.chars_per_token  // ~120 tokens at 4 chars/token
  totalTokenEstimate += importTokenEstimate

  // Enforce path1_max_evidence_tokens cap (REVIEW-003: server-side)
  if totalTokenEstimate > config.path1_max_evidence_tokens:
    return {
      claim_id: claim.id,
      path: 2,
      reason: 'evidence_too_large',
      entity_token_estimate: totalTokenEstimate
    }

  // Fits in Path 1
  reason = entityMappings.length == 1 ? 'single_entity_mapped' : 'multi_entity_small'
  return {
    claim_id: claim.id,
    path: 1,
    reason: reason,
    entity_token_estimate: totalTokenEstimate
  }

function estimateTokens(lineCount, charsPerToken):
  avgCharsPerLine = 60  // conservative average for code
  return Math.ceil((lineCount * avgCharsPerLine) / charsPerToken)
```

#### Input/Output Example 1

```
Input:
  claim: { id: "claim-uuid-020", claim_type: "behavior", ... }
  mappings: [{
    id: "mapping-uuid-010",
    code_file: "src/auth/service.ts",
    code_entity_id: "entity-uuid-100",
    confidence: 0.85,
    ...
  }]
  // L2.getEntityLineCount("mapping-uuid-010") returns 73

Output: {
  claim_id: "claim-uuid-020",
  path: 1,
  reason: "single_entity_mapped",
  entity_token_estimate: 1215
  // 73 lines * 60 chars/line / 4 chars/token = 1095 entity + 120 imports = 1215
}
```

#### Input/Output Example 2

```
Input:
  claim: { id: "claim-uuid-025", claim_type: "architecture", ... }
  mappings: [
    { id: "m-1", code_file: "src/api/handler.ts", code_entity_id: "e-1", ... },
    { id: "m-2", code_file: "src/queue/worker.ts", code_entity_id: "e-2", ... }
  ]

Output: {
  claim_id: "claim-uuid-025",
  path: 2,
  reason: "multi_file",
  entity_token_estimate: null
}
```

#### Negative Example

A claim with a single entity mapping that exceeds the token cap is NOT routed to Path 1, even though it has a clean entity-level mapping:

```
Input:
  claim: { id: "claim-uuid-030", claim_type: "behavior", ... }
  mappings: [{
    id: "m-3",
    code_file: "src/services/user-service.ts",
    code_entity_id: "entity-uuid-200",
    ...
  }]
  // L2.getEntityLineCount("m-3") returns 520

Output: {
  claim_id: "claim-uuid-030",
  path: 2,
  reason: "evidence_too_large",
  entity_token_estimate: 7920
  // 520 * 60 / 4 = 7800 + 120 imports = 7920 > 4000 cap
}
// Despite being a single-entity mapping, the evidence is too large for Path 1.
```

#### Edge Cases

- **Mapping with `code_entity_id` that was deleted (FK SET NULL):** `getEntityLineCount` returns `null`. Route to Path 2 with `file_only_mapping`.
- **Multiple entities in the same file, all small:** Sum token estimates. If total < cap, route to Path 1 with `multi_entity_small`.
- **Single mapping with `code_entity_id = null` (whole-file):** Caught by `entityMappings.length == 0` check. Route to Path 2 with `file_only_mapping`.
- **Claim with empty mappings after suppression filtering:** L4 filters suppressed claims before calling `routeClaim`. If all mappings are removed, `mappings.length == 0` -> Path 2 `no_mapping`.
- **Token estimate exactly at cap boundary:** `>` is strict. A claim at exactly 4000 tokens routes to Path 1.

#### Error Handling

- **L2.getEntityLineCount database failure (DOCALIGN_E301):** Per-call retry. On exhaustion, route to Path 2 with `file_only_mapping` as safe fallback.
- **Config load failure (DOCALIGN_E501):** Use hardcoded defaults: `path1_max_evidence_tokens = 4000`, `chars_per_token = 4`.

---

### 4.3 buildPath1Evidence

#### Signature

```typescript
buildPath1Evidence(claim: Claim, mappings: ClaimMapping[]): Promise<FormattedEvidence>
```

#### Algorithm (pseudocode)

```
function buildPath1Evidence(claim, mappings):
  config = loadVerifierConfig(claim.repo_id)

  // Use the primary entity mapping (highest confidence with entity)
  entityMapping = mappings
    .filter(m => m.code_entity_id != null)
    .sort((a, b) => b.confidence - a.confidence)[0]

  if entityMapping == null:
    throw DocAlignError(DOCALIGN_E401, "buildPath1Evidence called without entity mapping")

  filePath = entityMapping.code_file

  // STEP 1: Get all entities in the file
  allEntities = await L0.getEntityByFile(claim.repo_id, filePath)
  targetEntity = allEntities.find(e => e.id == entityMapping.code_entity_id)

  if targetEntity == null:
    throw DocAlignError(DOCALIGN_E401, "Mapped entity not found in file")

  entityCode = targetEntity.raw_code
  entityLines = [targetEntity.line_number, targetEntity.end_line_number]
  entityTokenEstimate = Math.ceil(entityCode.length / config.chars_per_token)

  // STEP 2: Extract imports (first N non-import-ending lines, max 30)
  // Imports are approximated from entities with low line numbers,
  // or from raw_code of the first entity if it starts at line 1.
  // In practice, imports are extracted by reading lines from
  // the file content cached in L0.
  importsText = extractFileImports(allEntities, filePath, config.path1_max_import_lines)
  importsTokenEstimate = Math.ceil(importsText.length / config.chars_per_token)

  // STEP 3: Extract same-file type signatures (up to 3 types, 100 lines)
  // Find type/interface entities in the same file that are referenced
  // by the target entity's signature or raw_code
  typeEntities = allEntities
    .filter(e => e.entity_type == 'type' && e.id != targetEntity.id)
    .filter(e => targetEntity.raw_code.includes(e.name) || targetEntity.signature.includes(e.name))
    .slice(0, config.path1_max_type_signatures)

  typeSignaturesText = typeEntities
    .map(e => e.signature)
    .join('\n')

  // Enforce total line cap for type signatures
  typeSignaturesText = truncateToLines(typeSignaturesText, config.path1_max_type_lines)

  // STEP 4: Format evidence
  formatted = formatEvidenceString(filePath, importsText, entityCode, typeSignaturesText, entityLines)
  totalTokenEstimate = entityTokenEstimate + importsTokenEstimate +
    Math.ceil(typeSignaturesText.length / config.chars_per_token)

  return {
    formatted_evidence: formatted,
    metadata: {
      path: 1,
      file_path: filePath,
      entity_name: targetEntity.name,
      entity_lines: entityLines,
      entity_token_estimate: entityTokenEstimate,
      imports_token_estimate: importsTokenEstimate,
      total_token_estimate: totalTokenEstimate
    }
  }
```

#### Input/Output Example 1

```
Input:
  claim: {
    id: "claim-uuid-020",
    claim_type: "behavior",
    claim_text: "The createOrder function validates input and publishes order.created event.",
    ...
  }
  mappings: [{
    code_file: "src/services/order-service.ts",
    code_entity_id: "entity-uuid-300",
    confidence: 0.95,
    ...
  }]

Output: {
  formatted_evidence: "--- File: src/services/order-service.ts ---\n\n// Imports\nimport { OrderRepository } from '../repositories/order-repository';\nimport { EventPublisher } from '../queue/publisher';\nimport { Order, CreateOrderDto } from '../types/order';\nimport { ValidationError } from '../errors';\n\n// Entity: createOrder (lines 24-42)\nasync createOrder(dto: CreateOrderDto): Promise<Order> {\n  if (!dto.items || dto.items.length === 0) {\n    throw new ValidationError('Order must have at least one item');\n  }\n  const order = await this.repo.create({ ... });\n  await this.publisher.publish('order.created', { orderId: order.id });\n  return order;\n}\n",
  metadata: {
    path: 1,
    file_path: "src/services/order-service.ts",
    entity_name: "createOrder",
    entity_lines: [24, 42],
    entity_token_estimate: 180,
    imports_token_estimate: 42,
    total_token_estimate: 222
  }
}
```

#### Input/Output Example 2

```
Input:
  claim: {
    id: "claim-uuid-011",
    claim_type: "api_route",
    claim_text: "GET /api/v2/users/:id - Get user by ID",
    ...
  }
  mappings: [
    { code_file: "src/routes/users.ts", code_entity_id: "entity-uuid-201", confidence: 0.95, ... },
    { code_file: "src/routes/users.ts", code_entity_id: "entity-uuid-200", confidence: 0.80, ... }
  ]

Output: {
  formatted_evidence: "--- File: src/routes/users.ts ---\n\n// Imports\nimport { Router } from 'express';\nimport { UserService } from '../services/user-service';\n\n// Entity: listUsers (lines 15-45)\nasync function listUsers(req: Request, res: Response): Promise<void> {\n  ...\n}\n",
  metadata: {
    path: 1,
    file_path: "src/routes/users.ts",
    entity_name: "listUsers",
    entity_lines: [15, 45],
    entity_token_estimate: 300,
    imports_token_estimate: 25,
    total_token_estimate: 325
  }
}
// Uses the highest-confidence entity mapping (entity-uuid-201 at 0.95).
```

#### Negative Example

Calling `buildPath1Evidence` with zero entity-level mappings (all whole-file) throws an error, NOT a graceful fallback. The caller (L4) must call `routeClaim` first, which routes file-only mappings to Path 2:

```
Input:
  claim: { id: "claim-uuid-040", ... }
  mappings: [{ code_file: "src/config.ts", code_entity_id: null, ... }]

Output: throws DocAlignError(DOCALIGN_E401, "buildPath1Evidence called without entity mapping")
// Caller must route to Path 2 instead.
```

#### Edge Cases

- **Entity's `raw_code` is empty (parse error on last index update):** Return evidence with empty entity section. The LLM will return `uncertain` due to missing code.
- **File has no import statements:** `importsText` is empty string. `imports_token_estimate` is 0.
- **No type signatures referenced:** `typeSignaturesText` is empty. Only imports + entity code are included.
- **Multiple entity mappings in same file:** Use highest confidence entity for the primary evidence. Other entities are not included (they contribute to token estimate during routing but evidence uses one entity per call).
- **Entity code exceeds the evidence token cap:** This should not occur because `routeClaim` already verified the total is within cap. If it does (race condition with entity update), truncate entity code at the cap minus import tokens, append `// ... truncated`.

#### Error Handling

- **L0.getEntityByFile failure (DOCALIGN_E301):** Per-call retry. On exhaustion, throw `DocAlignError`. L4 Worker falls back to creating a Path 2 task.
- **Entity not found in file (DOCALIGN_E401):** Entity was deleted between routing and evidence assembly. Throw error. L4 falls back to Path 2.
- **Formatted evidence exceeds expected size:** Log warning, proceed. The LLM handles large contexts.

---

### 4.4 storeResult

#### Signature

```typescript
storeResult(result: VerificationResult): Promise<void>
```

#### Algorithm (pseudocode)

```
function storeResult(result):
  // Decision 3C-005: downgrade drifted with empty evidence
  if result.verdict == 'drifted' AND result.evidence_files.length == 0:
    result.verdict = 'uncertain'
    result.reasoning = (result.reasoning || '') +
      ' [Downgraded: drift reported with no supporting evidence (3C-005)]'

  // Reduce confidence for verified with no evidence
  if result.verdict == 'verified' AND result.evidence_files.length == 0:
    result.confidence = Math.max(result.confidence - 0.3, 0.0)

  INSERT INTO verification_results (
    id, claim_id, repo_id, scan_run_id,
    verdict, confidence, tier, severity,
    reasoning, specific_mismatch, suggested_fix,
    evidence_files, token_cost, duration_ms,
    post_check_result, verification_path, created_at
  ) VALUES (
    result.id, result.claim_id, result.repo_id, result.scan_run_id,
    result.verdict, result.confidence, result.tier, result.severity,
    result.reasoning, result.specific_mismatch, result.suggested_fix,
    result.evidence_files, result.token_cost, result.duration_ms,
    result.post_check_result, result.verification_path, NOW()
  )

  // Update claim verification status
  UPDATE claims
    SET verification_status = result.verdict,
        last_verified_at = NOW(),
        last_verification_result_id = result.id,
        updated_at = NOW()
    WHERE id = result.claim_id
```

#### Input/Output Example 1

```
Input:
  result: {
    id: "result-uuid-001",
    claim_id: "claim-uuid-001",
    repo_id: "repo-uuid-001",
    scan_run_id: "scan-uuid-001",
    verdict: "verified",
    confidence: 1.0,
    tier: 1,
    severity: null,
    reasoning: "File 'src/auth/handler.ts' exists in the repository.",
    specific_mismatch: null,
    suggested_fix: null,
    evidence_files: ["src/auth/handler.ts"],
    token_cost: null,
    duration_ms: 3,
    post_check_result: null,
    verification_path: null,
    created_at: "2026-02-11T14:00:00Z"
  }

Output: void (result stored, claim status updated)
```

#### Input/Output Example 2

```
Input:
  result: {
    id: "result-uuid-002",
    claim_id: "claim-uuid-010",
    repo_id: "repo-uuid-001",
    scan_run_id: "scan-uuid-001",
    verdict: "drifted",
    confidence: 0.85,
    tier: 4,
    severity: "high",
    reasoning: "Code uses argon2, not bcrypt.",
    evidence_files: ["src/auth/password.ts"],
    token_cost: 450,
    duration_ms: 2500,
    verification_path: 1,
    ...
  }

Output: void (result stored, claim status set to 'drifted')
```

#### Negative Example

A drifted verdict with empty evidence_files is NOT stored as-is. It is downgraded to uncertain per 3C-005:

```
Input:
  result: {
    verdict: "drifted",
    confidence: 0.90,
    evidence_files: [],
    reasoning: "The function no longer exists.",
    ...
  }

Stored as:
  {
    verdict: "uncertain",   // downgraded from drifted
    confidence: 0.90,
    evidence_files: [],
    reasoning: "The function no longer exists. [Downgraded: drift reported with no supporting evidence (3C-005)]",
    ...
  }
```

#### Edge Cases

- **Duplicate `result.id` (idempotent retry):** PostgreSQL primary key constraint prevents double-insert. Catch constraint violation, log, and treat as success (idempotent).
- **`claim_id` does not exist (claim was deleted during scan):** Foreign key violation. Log `DOCALIGN_E303`, skip this result. Scan continues.
- **`scan_run_id` is null (standalone verification outside a scan):** Allowed by schema (`scan_run_id UUID REFERENCES scan_runs(id)` allows null).
- **Very long `reasoning` string (>5000 chars from agent):** Truncate to 5000 chars at storage time (per XREF-007 Zod limits).

#### Error Handling

- **Database INSERT failure (DOCALIGN_E301):** Throw `DocAlignError`, retryable. L4 Worker retries the batch.
- **Foreign key violation on claim_id (DOCALIGN_E303):** Claim was deleted. Log warning, skip this result. Do not crash.
- **Database UPDATE failure on claims table:** Log warning. Result is stored even if claim status update fails. Eventual consistency: next scan will update status.

---

### 4.5 mergeResults

#### Signature

```typescript
mergeResults(scanRunId: string): Promise<VerificationResult[]>
```

#### Algorithm (pseudocode)

```
function mergeResults(scanRunId):
  // Fetch all results for this scan run
  results = SELECT * FROM verification_results
    WHERE scan_run_id = $scanRunId
    ORDER BY claim_id, created_at DESC

  // Deduplicate: keep only the latest result per claim_id
  // (a claim may have both a Tier 1 result and a Tier 4 result
  //  if the deterministic check was inconclusive and the agent
  //  provided a follow-up. In practice, L4 creates only one
  //  result per claim per scan, but this handles edge cases.)
  latestPerClaim = Map<string, VerificationResult>
  for result in results:
    if not latestPerClaim.has(result.claim_id):
      latestPerClaim.set(result.claim_id, result)
    else:
      existing = latestPerClaim.get(result.claim_id)
      // Prefer higher-tier results (Tier 4 over Tier 1)
      // because they represent deeper analysis
      if result.tier > existing.tier:
        latestPerClaim.set(result.claim_id, result)

  return Array.from(latestPerClaim.values())
```

#### Input/Output Example 1

```
Input:
  scanRunId: "scan-uuid-001"
  // Database contains:
  //   result-001: claim-uuid-001, tier 1, verdict: verified
  //   result-002: claim-uuid-010, tier 4, verdict: drifted
  //   result-003: claim-uuid-020, tier 4, verdict: verified
  //   result-004: claim-uuid-030, tier 1, verdict: drifted

Output: [
  { id: "result-001", claim_id: "claim-uuid-001", tier: 1, verdict: "verified", ... },
  { id: "result-002", claim_id: "claim-uuid-010", tier: 4, verdict: "drifted", ... },
  { id: "result-003", claim_id: "claim-uuid-020", tier: 4, verdict: "verified", ... },
  { id: "result-004", claim_id: "claim-uuid-030", tier: 1, verdict: "drifted", ... }
]
// One result per claim, all from the same scan run.
```

#### Input/Output Example 2

```
Input:
  scanRunId: "scan-uuid-nonexistent"

Output: []
// No results exist for this scan run.
```

#### Negative Example

This function does NOT merge results across different scan runs. Each call returns results from exactly one `scan_run_id`. Cross-scan comparison is the responsibility of L5 (health score) and L7 (confidence decay):

```
Input:
  scanRunId: "scan-uuid-001"
  // Database contains results from scan-uuid-001 AND scan-uuid-002

Output: [... only results where scan_run_id = "scan-uuid-001" ...]
// Results from scan-uuid-002 are excluded.
```

#### Edge Cases

- **Scan with zero results (all claims suppressed or untestable):** Returns `[]`.
- **Same claim has two results in same scan (Tier 1 + Tier 4):** Keep the higher-tier result. The Tier 4 result represents deeper analysis.
- **Very large scan (200+ results):** Query uses the `idx_results_scan` index. Performance acceptable.

#### Error Handling

- **Database query failure (DOCALIGN_E301):** Throw `DocAlignError`, retryable.
- **Database query timeout (DOCALIGN_E302):** Throw `DocAlignError`, retryable.

---

### 4.6 getLatestResult

#### Signature

```typescript
getLatestResult(claimId: string): Promise<VerificationResult | null>
```

#### Algorithm (pseudocode)

```
function getLatestResult(claimId):
  result = SELECT * FROM verification_results
    WHERE claim_id = $claimId
    ORDER BY created_at DESC
    LIMIT 1

  if result == null:
    return null

  return toVerificationResultModel(result)
```

#### Input/Output Example 1

```
Input:  getLatestResult("claim-uuid-001")
Output: {
  id: "result-uuid-050",
  claim_id: "claim-uuid-001",
  verdict: "verified",
  confidence: 1.0,
  tier: 1,
  created_at: "2026-02-11T14:00:00Z",
  ...
}
// Most recent result for this claim.
```

#### Input/Output Example 2

```
Input:  getLatestResult("claim-uuid-nonexistent")
Output: null
// No verification results exist for this claim.
```

#### Negative Example

Does NOT return results from a specific scan. It returns the most recent result for a claim across ALL scans. Scan-scoped queries use `mergeResults(scanRunId)`.

Does NOT apply confidence decay. Raw stored confidence is returned. L7's `getEffectiveConfidence` applies decay externally.

#### Edge Cases

- **Claim has 50+ historical results:** The `ORDER BY created_at DESC LIMIT 1` with `idx_results_claim` index returns instantly.
- **Invalid UUID format for `claimId`:** PostgreSQL rejects. Catch, return `null`.
- **Result row has `null` optional fields:** All nullable columns map to `null` in the returned model. This is expected.

#### Error Handling

- **Database error (DOCALIGN_E301):** Throw `DocAlignError`, retryable.
- **Database query timeout (DOCALIGN_E302):** Throw `DocAlignError`, retryable.

---

## 5. Performance Targets

| Operation | Target | Measured By |
|-----------|--------|-------------|
| Tier 1: path_reference check | < 10ms | `fileExists` + optional similar path search |
| Tier 1: command check | < 10ms | `scriptExists` + optional close match |
| Tier 1: dependency_version check | < 10ms | `getDependencyVersion` + version comparison |
| Tier 1: api_route check | < 15ms | `findRoute` + optional `searchRoutes` |
| Tier 1: code_example check | < 50ms | Multiple `findSymbol` calls + optional syntax validation |
| Tier 2: pattern check | < 200ms | Strategy-dependent (tsconfig read, grep, etc.) |
| `routeClaim` | < 20ms | DB lookups for entity line count |
| `buildPath1Evidence` | < 50ms | Entity retrieval + formatting |
| `storeResult` | < 10ms | Single INSERT + UPDATE |
| `mergeResults` (50 claims) | < 50ms | Index scan on `scan_run_id` |
| `getLatestResult` | < 5ms | Index scan on `claim_id` |
| Total Tier 1 batch (50 claims) | < 500ms | All syntactic claims in a PR scan |
| Total Tier 2 batch (10 claims) | < 2s | All convention claims in a PR scan |

---

## 6. Required Framework Knowledge

The implementing agent must be familiar with:

| Library/Tool | Version | Usage in L3 |
|-------------|---------|-------------|
| `pg` (node-postgres) | ^8.x | PostgreSQL queries for result CRUD, entity lookups |
| `semver` | ^7.x | Version comparison for dependency_version claims |
| `fastest-levenshtein` | Latest | Edit distance for similar path search and close match |
| `web-tree-sitter` | Latest | Syntax validation for code_example claims (Tier 1) |
| `tree-sitter-typescript` | Latest | TypeScript/JavaScript syntax validation |
| `tree-sitter-python` | Latest | Python syntax validation |
| `uuid` or `crypto.randomUUID` | Built-in | UUID generation for result IDs |
| `zod` | ^3.x | Validation of agent results before `storeResult` |

---

## 7. Open Questions

1. **Code example syntax validation depth:** Tier 1 validates syntax via tree-sitter when a language annotation is present. Should we also validate when the language is inferred from the doc file context? For MVP, validate ONLY when an explicit language annotation (e.g., ` ```typescript `) is present. Inferred language validation is deferred.

2. **Tier 2 strategy extensibility:** The initial set of Tier 2 pattern strategies (5 strategies for convention/environment claims) covers a small fraction. Should L3 accept user-defined pattern strategies via `.docalign.yml`? Deferred to v2. For MVP, the strategy set is hardcoded.

3. **Multi-entity evidence assembly:** When `routeClaim` returns `multi_entity_small` (multiple entities in the same file), `buildPath1Evidence` currently uses only the highest-confidence entity. Should it concatenate all entity code blocks? Deferred -- single entity provides sufficient context for most claims. If needed, the agent (Path 2) handles multi-entity reasoning.

4. **Post-check (Tier 5) implementation timeline:** Stubbed for v2. The `post_check_result` field in `VerificationResult` is always `null` in v1. When implementing, the post-check must run client-side (in the GitHub Action) because it executes shell commands against the client's codebase.

---

## Appendix A: Tier 1 Verification Per Claim Type

### A.1 path_reference

```
function verifyPathReference(claim):
  path = claim.extracted_value.path

  // Step 1: exact check
  exists = await L0.fileExists(claim.repo_id, path)
  if exists:
    return verified(evidence_files: [path],
      reasoning: "File '{path}' exists in the repository.")

  // Step 2: similar path search
  similar = findSimilarPaths(claim.repo_id, path, maxResults: 5)
  if similar.length > 0:
    bestMatch = similar[0]
    return drifted(
      severity: 'medium',
      evidence_files: [bestMatch.path],
      reasoning: "File '{path}' not found. Similar file: '{bestMatch.path}' (distance: {bestMatch.distance}).",
      suggested_fix: claim.claim_text.replace(path, bestMatch.path),
      specific_mismatch: "File path '{path}' does not exist. Likely renamed to '{bestMatch.path}'."
    )

  // Step 3: no file, no similar match
  return drifted(
    severity: 'high',
    evidence_files: [],
    reasoning: "File '{path}' does not exist in the repository and no similar files found.",
    suggested_fix: null,
    specific_mismatch: "File path '{path}' does not exist."
  )
```

### A.2 command

```
function verifyCommand(claim):
  { runner, script } = claim.extracted_value

  // Step 1: exact check
  exists = await L0.scriptExists(claim.repo_id, script)
  if exists:
    return verified(evidence_files: [getManifestFile(runner)],
      reasoning: "Script '{script}' exists in {runner} configuration.")

  // Step 2: close match search
  available = await L0.getAvailableScripts(claim.repo_id)
  closeMatch = findCloseMatch(script, available.map(s => s.name), maxDistance: 2)
  if closeMatch != null:
    return drifted(
      severity: 'high',
      evidence_files: [closeMatch.file_path ?? getManifestFile(runner)],
      reasoning: "Script '{script}' not found. Close match: '{closeMatch.name}'.",
      suggested_fix: claim.claim_text.replace(script, closeMatch.name),
      specific_mismatch: "Script '{script}' does not exist. Closest: '{closeMatch.name}'."
    )

  // Step 3: script not found, no close match
  return drifted(
    severity: 'high',
    evidence_files: [],
    reasoning: "Script '{script}' not found in {runner} configuration.",
    suggested_fix: null,
    specific_mismatch: "Script '{script}' not found."
  )
```

### A.3 dependency_version

```
function verifyDependencyVersion(claim):
  { package: pkgName, version: claimedVersion } = claim.extracted_value

  // Step 1: lookup actual version
  depVersion = await L0.getDependencyVersion(claim.repo_id, pkgName)
  if depVersion == null:
    return drifted(
      severity: 'high',
      evidence_files: [],
      reasoning: "Package '{pkgName}' not found in dependencies.",
      suggested_fix: null,
      specific_mismatch: "Package '{pkgName}' is not a dependency."
    )

  // Step 2: version comparison (see Appendix B)
  comparison = compareVersions(claimedVersion, depVersion.version, depVersion.source)
  if comparison.matches:
    return verified(
      evidence_files: [getManifestFileForEcosystem(pkgName)],
      reasoning: "Package '{pkgName}' version '{depVersion.version}' (from {depVersion.source}) matches documented version '{claimedVersion}' ({comparison.comparison_type})."
    )

  // Step 3: version mismatch
  return drifted(
    severity: 'medium',
    evidence_files: [getManifestFileForEcosystem(pkgName)],
    reasoning: "Documentation says '{pkgName} {claimedVersion}' but actual version is '{depVersion.version}'.",
    suggested_fix: claim.claim_text.replace(claimedVersion, depVersion.version),
    specific_mismatch: "Version mismatch: documented '{claimedVersion}', actual '{depVersion.version}'."
  )
```

### A.4 api_route

```
function verifyApiRoute(claim):
  { method, path } = claim.extracted_value

  // Step 1: exact route match
  route = await L0.findRoute(claim.repo_id, method, path)
  if route != null:
    return verified(
      evidence_files: [route.file_path],
      reasoning: "Route '{method} {path}' found in '{route.file_path}' at line {route.line_number}."
    )

  // Step 2: search for alternatives (method-independent, path similarity)
  alternatives = await L0.searchRoutes(claim.repo_id, path)
  if alternatives.length > 0:
    best = alternatives[0]
    return drifted(
      severity: 'medium',
      evidence_files: [best.file],
      reasoning: "Route '{method} {path}' not found. Similar route: '{best.method} {best.path}' in '{best.file}' (similarity: {best.similarity}).",
      suggested_fix: claim.claim_text.replace(method + ' ' + path, best.method + ' ' + best.path),
      specific_mismatch: "Route '{method} {path}' does not exist. Closest: '{best.method} {best.path}'."
    )

  // Step 3: no route found
  return drifted(
    severity: 'high',
    evidence_files: [],
    reasoning: "Route '{method} {path}' not found in the codebase and no similar routes exist.",
    suggested_fix: null,
    specific_mismatch: "Route '{method} {path}' not found."
  )
```

### A.5 code_example

```
function verifyCodeExample(claim):
  { language, imports, symbols, commands } = claim.extracted_value
  issues = []
  checkedFiles = []

  // Sub-check 1: Import resolution
  for importPath in imports:
    // Extract last segment as symbol name
    symbolName = extractSymbolFromImport(importPath)
    entities = await L0.findSymbol(claim.repo_id, symbolName)
    if entities.length == 0:
      issues.push("Import '{importPath}' does not resolve to any known symbol.")
    else:
      checkedFiles.push(entities[0].file_path)

  // Sub-check 2: Symbol existence
  for symbolName in symbols:
    entities = await L0.findSymbol(claim.repo_id, symbolName)
    if entities.length == 0:
      issues.push("Symbol '{symbolName}' not found in codebase.")
    else:
      checkedFiles.push(entities[0].file_path)

  // Sub-check 3: Syntax validation (if language annotation present)
  if language != null:
    isValid = validateSyntax(claim.claim_text, language)
    if not isValid:
      issues.push("Code block has syntax errors for language '{language}'.")

  // Sub-check 4: Commands (delegated to verifyCommand if commands present)
  // Handled separately by L1 extraction; commands in code blocks become
  // separate command claims. Skip here.

  if issues.length == 0:
    return verified(
      evidence_files: unique(checkedFiles),
      reasoning: "All imports and symbols in the code example resolve correctly."
    )

  // Partial issues
  return drifted(
    severity: issues.length > (imports.length + symbols.length) / 2 ? 'high' : 'medium',
    evidence_files: unique(checkedFiles),
    reasoning: "Code example has issues: " + issues.join('; '),
    suggested_fix: null,  // auto-fix for code examples is too complex
    specific_mismatch: issues.join('; ')
  )
```

---

## Appendix B: Version Comparison Logic

Version comparison uses the documented version format to determine comparison semantics. This applies to Tier 1 `dependency_version` claims only.

```
function compareVersions(documented: string, actual: string, source: string): VersionComparison:
  // Strip common prefixes: v, ^, ~, >=, <=, =
  cleanDocumented = stripVersionPrefix(documented)
  cleanActual = stripVersionPrefix(actual)

  // Determine comparison type based on documented version format
  parts = cleanDocumented.split('.')

  if parts.length == 1:
    // "18" -> major-only. Match any version starting with this major.
    comparison_type = 'major_only'
    matches = cleanActual.startsWith(cleanDocumented + '.') OR
              cleanActual == cleanDocumented

  elif parts.length == 2:
    // "18.2" -> major.minor. Match any version starting with this prefix.
    comparison_type = 'major_minor'
    matches = cleanActual.startsWith(cleanDocumented + '.') OR
              cleanActual == cleanDocumented

  else:
    // "18.2.0" -> exact match required.
    comparison_type = 'exact'
    matches = cleanActual == cleanDocumented

  // Special case: source is 'manifest' and actual is a range specifier (^, ~)
  // When actual is "^4.18.0" from manifest, extract the base version.
  // "^4.18.0" base = "4.18.0". Compare documented against base.
  if source == 'manifest' AND hasRangePrefix(actual):
    baseActual = stripVersionPrefix(actual)
    matches = compareAgainstBase(cleanDocumented, baseActual, comparison_type)

  return { matches, comparison_type, documented_version: documented, actual_version: actual, source }

function stripVersionPrefix(version: string): string:
  return version.replace(/^[v^~>=<!]+/, '').trim()

  // Handle "+" suffix: "18+" means major 18 or higher
  // For MVP: treat "18+" as "18" (major-only prefix match).
  // Strict "or higher" semantics deferred to v2.
```

**Examples:**

| Documented | Actual | Source | Comparison | Matches? |
|-----------|--------|--------|------------|----------|
| `18` | `18.2.0` | lockfile | major_only | Yes |
| `18.2` | `18.2.7` | lockfile | major_minor | Yes |
| `18.2.0` | `18.2.0` | lockfile | exact | Yes |
| `18.2.0` | `18.3.0` | lockfile | exact | No |
| `18` | `19.0.0` | lockfile | major_only | No |
| `4` | `^4.18.0` | manifest | major_only | Yes (base=4.18.0) |
| `18+` | `20.1.0` | lockfile | major_only | No (treated as "18") |

---

## Appendix C: Similar Path Algorithm

Used by Tier 1 `path_reference` verification to find likely renames.

```
function findSimilarPaths(repoId: string, targetPath: string, maxResults: number): SimilarPathResult[]:
  fileTree = await L0.getFileTree(repoId)
  targetBasename = path.basename(targetPath)
  results: SimilarPathResult[] = []

  // Pass 1: Basename Levenshtein (threshold <= 2)
  for filePath in fileTree:
    basename = path.basename(filePath)
    distance = levenshtein(targetBasename, basename)
    if distance > 0 AND distance <= 2:
      results.push({ path: filePath, distance, match_type: 'basename' })

  // Pass 2: Full path Levenshtein (threshold <= 3) -- only if Pass 1 found nothing
  if results.length == 0:
    for filePath in fileTree:
      distance = levenshtein(targetPath, filePath)
      if distance > 0 AND distance <= 3:
        results.push({ path: filePath, distance, match_type: 'full_path' })

  // Sort by distance ascending, then alphabetically
  results.sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))

  return results.slice(0, maxResults)
```

**Performance note:** For repos with >10,000 files, computing Levenshtein against all paths is O(n * m) where m is the path length. In practice, file trees are cached (L0.getFileTree) and basename comparison is fast. If this becomes a bottleneck, pre-compute a trigram index for approximate matching. For MVP, brute-force is acceptable.

**Thresholds:**
- Basename distance <= 2: catches renames like `handler.ts` -> `controller.ts` (distance 4 -- does NOT match), `handler.ts` -> `handlers.ts` (distance 1 -- matches), `config.yaml` -> `config.toml` (distance 2 -- matches on basename if extension changes are within 2 chars).
- Full path distance <= 3: catches directory moves like `src/auth/handler.ts` -> `src/authentication/handler.ts` (distance > 3 -- does NOT match). Primarily catches minor directory renames.

---

## Appendix D: Tier 2 Pattern Strategies

Five hardcoded strategies for convention and environment claims.

### D.1 Strict Mode Check

**Applies to:** Convention claims containing "strict mode", "strict: true", "strict typescript"

```
function strictModeStrategy(claim, L0):
  // Check tsconfig.json for strict: true
  entities = await L0.getEntityByFile(claim.repo_id, "tsconfig.json")
  tsconfigExists = await L0.fileExists(claim.repo_id, "tsconfig.json")

  if not tsconfigExists:
    return null  // cannot determine, fall through

  // For MVP: check if tsconfig.json exists and contains "strict"
  // Full parsing of tsconfig is not in L0 scope; use fileExists as proxy
  // True verification requires reading file content -- deferred to Path 2
  return null  // conservative: fall through to Tier 4
```

### D.2 Framework Import Check

**Applies to:** Convention claims containing "uses [framework]", "built with [framework]"

```
function frameworkImportStrategy(claim, L0):
  // Extract framework name from claim
  frameworkName = extractFrameworkName(claim.claim_text)
  if frameworkName == null:
    return null

  // Check if any entity imports this framework
  entities = await L0.findSymbol(claim.repo_id, frameworkName)
  if entities.length > 0:
    return verified(
      tier: 2, confidence: 0.9,
      evidence_files: [entities[0].file_path],
      reasoning: "Framework '{frameworkName}' found via symbol search."
    )

  return null  // cannot confirm, fall through
```

### D.3 Counter-Example Search

**Applies to:** Convention claims containing "all X use Y", "every X follows Y"

```
function counterExampleStrategy(claim, L0):
  // This strategy attempts to find counter-examples
  // For MVP: fall through to Tier 4 (requires file content search
  // which is not available via L0 API)
  return null
```

### D.4 Environment Variable Check

**Applies to:** Environment claims containing "environment variable", "env var", "ENV_"

```
function envVarStrategy(claim, L0):
  // Check .env.example or similar config files
  envExampleExists = await L0.fileExists(claim.repo_id, ".env.example")
  envExists = await L0.fileExists(claim.repo_id, ".env")
  dotenvExists = await L0.fileExists(claim.repo_id, ".env.local")

  if not (envExampleExists OR envExists OR dotenvExists):
    return null  // no env files to check

  // Cannot read file contents via L0 API in this tier.
  // Fall through to Tier 4 for content-based verification.
  return null
```

### D.5 Tool Version Check

**Applies to:** Environment claims containing "Node.js", "Python", "Ruby" version references

```
function toolVersionStrategy(claim, L0):
  // Check version files: .nvmrc, .node-version, .python-version, .ruby-version, .tool-versions
  versionFiles = [".nvmrc", ".node-version", ".python-version", ".ruby-version", ".tool-versions"]

  for vf in versionFiles:
    exists = await L0.fileExists(claim.repo_id, vf)
    if exists:
      // File exists but we cannot read its content via L0 API.
      // Fall through to Tier 4 for content comparison.
      return null

  // No version files found -- cannot verify
  return null
```

**Note:** Most Tier 2 strategies in MVP conservatively fall through to Tier 4. L0's API provides existence checks and entity lookups but does NOT provide raw file content reading for arbitrary files (only `raw_code` on entities). When Tier 2 needs to read file content (tsconfig values, .env contents, version file values), it falls through. This is acceptable because Tier 4 is all-client-side (client pays LLM cost), and the routing infrastructure already handles the fallthrough gracefully. Tier 2 becomes more useful when L0 gains a `readFile` API (v2).

---

## Appendix E: Evidence Formatting Template

The formatted evidence string sent to the LLM (via Path 1 agent tasks) uses this template:

```
--- File: {file_path} ---

// Imports (lines 1-{import_end_line})
{imports_text}

// Type Signatures
{type_signatures_text}

// Entity: {entity_name} (lines {start_line}-{end_line})
{entity_code}
```

**Rules:**
1. Imports section is omitted if empty.
2. Type Signatures section is omitted if no referenced types found.
3. Entity code is always present (this is Path 1).
4. Line numbers reference the original file, not the formatted output.
5. Total formatted string must not exceed `path1_max_evidence_tokens * chars_per_token` characters. If it does, truncate type signatures first, then imports, preserving entity code intact.

**Example output:**

```
--- File: src/services/order-service.ts ---

// Imports (lines 1-4)
import { OrderRepository } from '../repositories/order-repository';
import { EventPublisher } from '../queue/publisher';
import { Order, CreateOrderDto } from '../types/order';
import { ValidationError } from '../errors';

// Entity: createOrder (lines 24-42)
async createOrder(dto: CreateOrderDto): Promise<Order> {
  if (!dto.items || dto.items.length === 0) {
    throw new ValidationError('Order must have at least one item');
  }
  if (!dto.customerId) {
    throw new ValidationError('Customer ID is required');
  }
  const order = await this.repo.create({
    customerId: dto.customerId,
    items: dto.items,
    status: 'pending',
    created_at: new Date(),
  });
  await this.publisher.publish('order.created', {
    orderId: order.id,
    customerId: order.customerId,
    itemCount: order.items.length,
  });
  return order;
}
```

---

## Appendix F: Routing Decision Tree

Visual representation of the `routeClaim` decision flow.

```
routeClaim(claim, mappings)
  |
  +-- mappings.length == 0?
  |     YES -> Path 2, reason: no_mapping
  |
  +-- distinct files > 1?
  |     YES -> Path 2, reason: multi_file
  |
  +-- any entity-level mapping?
  |     NO  -> Path 2, reason: file_only_mapping
  |
  +-- compute total token estimate (entity lines + imports)
  |
  +-- total > path1_max_evidence_tokens (default 4000)?
  |     YES -> Path 2, reason: evidence_too_large
  |
  +-- entity count == 1?
  |     YES -> Path 1, reason: single_entity_mapped
  |     NO  -> Path 1, reason: multi_entity_small
```

**Expected distribution (from Spike B analysis):**

| Route | Reason | % of Claims | Path |
|-------|--------|-------------|------|
| single_entity_mapped | 1 entity, tokens < cap | 55-65% | 1 |
| multi_entity_small | N entities same file, tokens < cap | 5-10% | 1 |
| evidence_too_large | Entity tokens > cap | 5-8% | 2 |
| multi_file | Mappings span >1 file | 8-12% | 2 |
| no_mapping | Zero mappings | 2-5% | 2 |
| file_only_mapping | File mapped, no entity | 10-15% | 2 |

---

## Appendix G: Error Code Reference (L3-specific)

| Code | Scenario | Severity | Recovery |
|------|----------|----------|----------|
| DOCALIGN_E301 | Database connection/query failure | high | Retry per per-call profile |
| DOCALIGN_E302 | Database query timeout | high | Retry per per-call profile |
| DOCALIGN_E303 | Database constraint violation (FK, unique) | medium | Log, skip individual result, continue |
| DOCALIGN_E401 | Internal logic error (entity not found, bad routing input) | medium | Return null / fallback to Path 2 |
| DOCALIGN_E501 | Config load failure | low | Use hardcoded defaults |

All error codes conform to the schema in phase3-error-handling.md Section 1.1.
