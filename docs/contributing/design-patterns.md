---
title: "Design Patterns"
summary: "Core code patterns used throughout DocAlign: extractor pattern, verifier pattern, makeResult() helper, findCloseMatch(), Zod config schema, Pino structured logging, and test fixture helpers."
description: "Extractor pattern: function(line, lineNumber, context) → RawExtraction[], registered in syntactic.ts, never throws. Verifier pattern: function(claim, index) → VerificationResult|null, dispatched by router in L3-verifier/index.ts, uses makeResult(). makeResult() from src/layers/L3-verifier/result-helpers.ts for consistent structure (sets tier: 1, confidence: 1.0 by default). findCloseMatch() from src/layers/L3-verifier/close-match.ts using Levenshtein distance for package names, file paths, npm scripts. Config schema in src/config/schema.ts using Zod with typed enums, numeric constraints, and default values. Pino logging from src/shared/logger.ts (E5xx config errors, E4xx pipeline errors). Test fixtures: makeClaim() and makeMockIndex() with available fields, makeResult() is the production helper used in tests."
category: reference
read_when:
  - You are writing a new extractor or verifier and need to follow existing patterns
  - You need to know how to log errors or construct verification results
  - You are writing tests and need to use the fixture helpers correctly
related:
  - docs/contributing/architecture.md
  - docs/contributing/adding-a-check.md
  - docs/contributing/testing.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Design Patterns

These patterns are used consistently throughout the codebase.

## Extractor Pattern

Each claim type has an extractor function in `src/layers/L1-claim-extractor/extractors.ts`. Every extractor follows the same signature:
<!-- docalign:skip reason="illustrative_example" description="Code block showing the extractor function signature — already marked with docalign:skip in source" -->

```typescript
function extractPathReferences(line: string, lineNumber: number, context: ExtractionContext): RawExtraction[]
```

**Contract:**
- Takes a single line, its number, and extraction context
<!-- /docalign:skip -->
- Returns an array of `RawExtraction` objects (may be empty)
- Uses regex matching with named groups
- Never throws -- returns empty array on no match

<!-- docalign:semantic id="semantic-dp-syntactic-pipeline" claim="The syntactic pipeline in src/layers/L1-claim-extractor/syntactic.ts calls all extractors in sequence: preprocess, extract, filter, dedup, convert to Claim[]" -->
The syntactic pipeline in `src/layers/L1-claim-extractor/syntactic.ts` calls all extractors in sequence: preprocess → extract → filter → dedup → convert to `Claim[]`.

## Verifier Pattern

<!-- docalign:semantic id="semantic-dp-verifier-router" claim="The main router in src/layers/L3-verifier/index.ts switches on claim.claim_type and dispatches to the appropriate verifier" -->
Each claim type has a verifier function in `src/layers/L3-verifier/`. The main router in `src/layers/L3-verifier/index.ts` switches on `claim.claim_type` and dispatches to the appropriate verifier.

```typescript
function verifyPathReference(claim: Claim, index: CodebaseIndex): VerificationResult | null
```

<!-- docalign:skip reason="illustrative_example" description="Code block showing the verifier function signature as a convention pattern illustration — already marked with docalign:skip" -->
**Contract:**
- Takes a claim and the codebase index
- Returns a `VerificationResult` or `null` (null means "can't determine, pass to next tier")
- Uses `makeResult()` helper to construct results

<!-- /docalign:skip -->
## makeResult() Helper

<!-- docalign:semantic id="semantic-dp-makeresult" claim="All verification results are built using makeResult() from src/layers/L3-verifier/result-helpers.ts" -->
All verification results are built using `makeResult()` from `src/layers/L3-verifier/result-helpers.ts`:

```typescript
makeResult(verdict, {
<!-- docalign:skip reason="illustrative_example" description="Code block showing example makeResult() call with hypothetical arguments — already marked with docalign:skip" -->
  reasoning: 'File not found in repository',
  severity: 'high',
  evidence_files: ['src/auth.ts'],
  suggestion: 'Did you mean src/auth/index.ts?',
})
```

This ensures consistent result structure. Sets `tier: 1` and `confidence: 1.0` by default (deterministic checks).

## Close Match / Fuzzy Suggestions
<!-- /docalign:skip -->

<!-- docalign:semantic id="semantic-dp-findclosematch" claim="findCloseMatch() from src/layers/L3-verifier/close-match.ts finds the nearest alternative using Levenshtein distance" -->
When a claim references something that doesn't exist, `findCloseMatch()` from `src/layers/L3-verifier/close-match.ts` finds the nearest alternative using Levenshtein distance:

```typescript
const match = findCloseMatch('expresss', packageNames);
// { name: 'express', distance: 1 }
```

<!-- docalign:skip reason="illustrative_example" description="Code block showing example findCloseMatch() call with hypothetical input/output — already marked with docalign:skip" -->
Used for:
- Package names not found in `package.json`
- File paths not found in the file tree
- npm scripts not found in `scripts`
<!-- /docalign:skip -->

## Config Schema with Zod

<!-- docalign:semantic id="semantic-dp-config-schema" claim="Config schema in src/config/schema.ts uses Zod with typed enums, numeric constraints, and default values" -->
The configuration schema in `src/config/schema.ts` uses Zod with:
- Typed enums for claim types, severity levels
- Numeric constraints (`z.number().min(1).max(200)`)
- Default values on every field
- The schema is the single source of truth for validation

## Structured Logging with Pino

<!-- docalign:semantic id="semantic-dp-pino-logger" claim="All logging uses Pino from src/shared/logger.ts" -->
All logging uses Pino (`src/shared/logger.ts`):

```typescript
import { logger } from '../shared/logger';
logger.info({ claimType, file }, 'Verifying claim');
logger.warn({ code: 'E502', field }, 'Invalid config field');
```
<!-- docalign:skip reason="illustrative_example" description="Code block showing example Pino logger usage with hypothetical log calls — already marked with docalign:skip" -->

Error codes follow a numbering convention: E5xx for config errors, E4xx for pipeline errors.

## Test Fixture Patterns

### makeClaim()

Tests use `makeClaim()` to create test claim objects:
<!-- /docalign:skip -->

```typescript
const claim = makeClaim({
  claim_type: 'path_reference',
  value: 'src/auth.ts',
  source_file: 'README.md',
  line_number: 15,
<!-- docalign:skip reason="illustrative_example" description="makeClaim() test fixture helper — skip guidance confirms these are fixture helpers, not factual implementation claims" -->
});
```

### makeMockIndex()

Tests use `makeMockIndex()` to create mock codebase indexes:

```typescript
const index = makeMockIndex({
  files: ['src/auth.ts', 'src/index.ts'],
  packages: { express: '^4.18.0' },
  scripts: { build: 'tsc', test: 'vitest' },
});
<!-- /docalign:skip -->
```
<!-- docalign:skip reason="illustrative_example" description="makeMockIndex() test fixture helper — skip guidance confirms these are fixture helpers, not factual implementation claims" -->

This pattern keeps tests focused on the verifier logic without needing real file systems.

## Error Handling

<!-- docalign:semantic id="semantic-dp-verifiers-no-throw" claim="Verifiers never throw; they return null or a result with appropriate verdict" -->
- Verifiers never throw. They return `null` (can't determine) or a result with appropriate verdict.
- Config parsing logs warnings and uses defaults for invalid fields.
<!-- docalign:semantic id="semantic-dp-url-uncertain" claim="URL checks handle timeouts and network errors by returning uncertain verdict" -->
- URL checks handle timeouts and network errors by returning `uncertain` verdict.
- The CLI catches top-level errors and exits with appropriate codes (0, 1, or 2).

<!-- /docalign:skip -->