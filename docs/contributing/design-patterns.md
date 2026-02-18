---
title: "Design Patterns"
summary: "Documents the core design patterns used throughout the DocAlign codebase: extractor, verifier, makeResult, fuzzy matching, config schema, logging, and test fixtures."
description: "Covers the extractor pattern (function signature, contract: never throws, returns RawExtraction[]), verifier pattern (function signature, contract: returns VerificationResult|null, uses makeResult()), makeResult() helper from result-helpers.ts, findCloseMatch() for fuzzy suggestions, Zod config schema conventions, Pino structured logging with error codes, and makeClaim()/makeMockIndex() test fixture patterns."
category: reference
read_when:
  - You are writing a new extractor or verifier
  - You want to understand the code conventions
  - You need to know how error handling works
related:
  - docs/contributing/adding-a-check.md
  - docs/contributing/architecture.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Design Patterns

These patterns are used consistently throughout the codebase.

## Extractor Pattern

Each claim type has an extractor function in `src/layers/L1-claim-extractor/extractors.ts`. Every extractor follows the same signature:
<!-- docalign:skip reason="illustrative_example" description="extractPathReferences generic pattern signature showing the extractor function shape, not the actual function" -->
```typescript
function extractPathReferences(line: string, lineNumber: number, context: ExtractionContext): RawExtraction[]
```
<!-- /docalign:skip -->

**Contract:**
- Takes a single line, its number, and extraction context
- Returns an array of `RawExtraction` objects (may be empty)
- Uses regex matching with named groups
- Never throws -- returns empty array on no match

<!-- docalign:semantic id="ac59a1d9e104ce65" claim="The syntactic pipeline calls all extractors in sequence: preprocess → extract → filter → dedup → convert to Claim[]." -->
The syntactic pipeline in `src/layers/L1-claim-extractor/syntactic.ts` calls all extractors in sequence: preprocess → extract → filter → dedup → convert to `Claim[]`.

## Verifier Pattern

<!-- docalign:semantic id="650a50fab044a80a" claim="The main router in src/layers/L3-verifier/index.ts switches on claim.claim_type and dispatches to the appropriate verifier." -->
Each claim type has a verifier function in `src/layers/L3-verifier/`. The main router in `src/layers/L3-verifier/index.ts` switches on `claim.claim_type` and dispatches to the appropriate verifier.

<!-- docalign:skip reason="illustrative_example" description="verifyPathReference generic pattern signature showing the verifier function shape" -->
```typescript
function verifyPathReference(claim: Claim, index: CodebaseIndex): VerificationResult | null
```
<!-- /docalign:skip -->

**Contract:**
- Takes a claim and the codebase index
- Returns a `VerificationResult` or `null` (null means "can't determine, pass to next tier")
- Uses `makeResult()` helper to construct results

## makeResult() Helper

All verification results are built using `makeResult()` from `src/layers/L3-verifier/result-helpers.ts`:

<!-- docalign:skip reason="illustrative_example" description="makeResult() call example with invented reasoning and file path arguments" -->
```typescript
makeResult(verdict, {
reasoning: 'File not found in repository',
  severity: 'high',
  evidence_files: ['src/auth.ts'],
  suggestion: 'Did you mean src/auth/index.ts?',
})
```
<!-- /docalign:skip -->

<!-- docalign:semantic id="b7017b39ce99e507" claim="makeResult() sets tier: 1 and confidence: 1.0 by default." -->
This ensures consistent result structure. Sets `tier: 1` and `confidence: 1.0` by default (deterministic checks).

## Close Match / Fuzzy Suggestions
<!-- docalign:semantic id="70a2c700f42f0196" claim="findCloseMatch() finds the nearest alternative using Levenshtein distance." -->
When a claim references something that doesn't exist, `findCloseMatch()` from `src/layers/L3-verifier/close-match.ts` finds the nearest alternative using Levenshtein distance:

<!-- docalign:skip reason="illustrative_example" description="findCloseMatch() usage with invented typo 'expresss' and package name" -->
```typescript
const match = findCloseMatch('expresss', packageNames);
// { name: 'express', distance: 1 }
```
<!-- /docalign:skip -->

Used for:
- Package names not found in `package.json`
- File paths not found in the file tree
- npm scripts not found in `scripts`
## Config Schema with Zod

<!-- docalign:semantic id="67e239cfebd42868" claim="The configuration schema uses Zod with typed enums, numeric constraints, and default values on every field." -->
The configuration schema in `src/config/schema.ts` uses Zod with:
- Typed enums for claim types, severity levels
- Numeric constraints (`z.number().min(1).max(200)`)
- Default values on every field
- The schema is the single source of truth for validation

## Structured Logging with Pino

All logging uses Pino (`src/shared/logger.ts`):

```typescript
import { logger } from '../shared/logger';
logger.info({ claimType, file }, 'Verifying claim');
logger.warn({ code: 'E502', field }, 'Invalid config field');
```
<!-- docalign:semantic id="9ed8a53697fe3e2b" claim="Error codes follow a numbering convention: E5xx for config errors, E4xx for pipeline errors." -->
Error codes follow a numbering convention: E5xx for config errors, E4xx for pipeline errors.

## Test Fixture Patterns

### makeClaim()

Tests use `makeClaim()` to create test claim objects:
<!-- docalign:skip reason="tutorial_example" description="makeClaim() usage block with illustrative invented claim values and file names" -->
```typescript
const claim = makeClaim({
  claim_type: 'path_reference',
  value: 'src/auth.ts',
  source_file: 'README.md',
  line_number: 15,
});
```
<!-- /docalign:skip -->

### makeMockIndex()

Tests use `makeMockIndex()` to create mock codebase indexes:

<!-- docalign:skip reason="tutorial_example" description="makeMockIndex() usage block with illustrative invented file names and package versions" -->
```typescript
const index = makeMockIndex({
  files: ['src/auth.ts', 'src/index.ts'],
  packages: { express: '^4.18.0' },
  scripts: { build: 'tsc', test: 'vitest' },
});
```
<!-- /docalign:skip -->
This pattern keeps tests focused on the verifier logic without needing real file systems.

## Error Handling

<!-- docalign:semantic id="1d1f42c03e698297" claim="Verifiers never throw. They return null (can't determine) or a result with appropriate verdict." -->
- Verifiers never throw. They return `null` (can't determine) or a result with appropriate verdict.
<!-- docalign:semantic id="f9c90e92877a8d88" claim="Config parsing logs warnings and uses defaults for invalid fields." -->
- Config parsing logs warnings and uses defaults for invalid fields.
<!-- docalign:semantic id="c61bcff2400b129d" claim="URL checks handle timeouts and network errors by returning uncertain verdict." -->
- URL checks handle timeouts and network errors by returning `uncertain` verdict.
<!-- docalign:semantic id="970d58fb4fa0b977" claim="The CLI catches top-level errors and exits with appropriate codes (0, 1, or 2)." -->
- The CLI catches top-level errors and exits with appropriate codes (0, 1, or 2).
