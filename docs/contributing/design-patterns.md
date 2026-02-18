---
title: "Design Patterns"
description: "Use when you need to understand recurring code patterns and conventions used throughout DocAlign."
category: "contributing"
related:
  - docs/contributing/architecture.md
  - docs/contributing/adding-a-check.md
---

# Design Patterns

These patterns are used consistently throughout the codebase.

## Extractor Pattern

Each claim type has an extractor function in `src/layers/L1-claim-extractor/extractors.ts`. Every extractor follows the same signature:

```typescript
function extractPathReferences(line: string, lineNumber: number, context: ExtractionContext): RawExtraction[]
```

**Contract:**
- Takes a single line, its number, and extraction context
- Returns an array of `RawExtraction` objects (may be empty)
- Uses regex matching with named groups
- Never throws -- returns empty array on no match

The syntactic pipeline in `src/layers/L1-claim-extractor/syntactic.ts` calls all extractors in sequence: preprocess → extract → filter → dedup → convert to `Claim[]`.

## Verifier Pattern

Each claim type has a verifier function in `src/layers/L3-verifier/`. The main router in `src/layers/L3-verifier/index.ts` switches on `claim.claim_type` and dispatches to the appropriate verifier.

```typescript
function verifyPathReference(claim: Claim, index: CodebaseIndex): VerificationResult | null
```

**Contract:**
- Takes a claim and the codebase index
- Returns a `VerificationResult` or `null` (null means "can't determine, pass to next tier")
- Uses `makeResult()` helper to construct results

## makeResult() Helper

All verification results are built using `makeResult()` from `src/layers/L3-verifier/result-helpers.ts`:

```typescript
makeResult(verdict, {
  reasoning: 'File not found in repository',
  severity: 'high',
  evidence_files: ['src/auth.ts'],
  suggestion: 'Did you mean src/auth/index.ts?',
})
```

This ensures consistent result structure. Sets `tier: 1` and `confidence: 1.0` by default (deterministic checks).

## Close Match / Fuzzy Suggestions

When a claim references something that doesn't exist, `findCloseMatch()` from `src/layers/L3-verifier/close-match.ts` finds the nearest alternative using Levenshtein distance:

```typescript
const match = findCloseMatch('expresss', packageNames);
// { match: 'express', distance: 1 }
```

Used for:
- Package names not found in `package.json`
- File paths not found in the file tree
- npm scripts not found in `scripts`

## Config Schema with Zod

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

Error codes follow a numbering convention: E5xx for config errors, E4xx for pipeline errors.

## Test Fixture Patterns

### makeClaim()

Tests use `makeClaim()` to create test claim objects:

```typescript
const claim = makeClaim({
  claim_type: 'path_reference',
  value: 'src/auth.ts',
  source_file: 'README.md',
  line_number: 15,
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
```

This pattern keeps tests focused on the verifier logic without needing real file systems.

## Error Handling

- Verifiers never throw. They return `null` (can't determine) or a result with appropriate verdict.
- Config parsing logs warnings and uses defaults for invalid fields.
- URL checks handle timeouts and network errors by returning `uncertain` verdict.
- The CLI catches top-level errors and exits with appropriate codes (0, 1, or 2).
