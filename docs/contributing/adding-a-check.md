# Adding a Check

This guide walks through adding a new claim type or verification check to DocAlign.

## Overview

Adding a check involves three files:

1. **Extractor** (`src/layers/L1-claim-extractor/extractors.ts`) -- regex to find the claim
2. **Verifier** (`src/layers/L3-verifier/`) -- logic to check the claim against code
3. **Tests** (`test/`) -- covering both extraction and verification

## Step 1: Add the Claim Type

If this is a new claim type (not a new check for an existing type), add it to the type system.

In `src/shared/types.ts`, add the new type to the `ClaimType` union:

```typescript
export type ClaimType =
  | 'path_reference'
  | 'dependency_version'
  // ... existing types ...
  | 'your_new_type';
```

In `src/config/schema.ts`, add it to the `claimTypeEnum` and `claim_types` config section so it can be enabled/disabled.

## Step 2: Write the Extractor

Add a function in `src/layers/L1-claim-extractor/extractors.ts`:

```typescript
export function extractYourNewType(
  line: string,
  lineNumber: number,
  context: ExtractionContext,
): RawExtraction[] {
  const results: RawExtraction[] = [];
  const regex = /your-pattern-here/g;
  let match;

  while ((match = regex.exec(line)) !== null) {
    results.push({
      claim_type: 'your_new_type',
      value: match[1],
      raw_text: match[0],
      line_number: lineNumber,
      confidence: 0.9,
    });
  }

  return results;
}
```

Register it in the extraction pipeline in `src/layers/L1-claim-extractor/syntactic.ts`.

## Step 3: Write the Verifier

Add a verification function. Follow the verifier pattern:

```typescript
export function verifyYourNewType(
  claim: Claim,
  index: CodebaseIndex,
): VerificationResult | null {
  // Check against the codebase index
  const found = index.someCheck(claim.value);

  if (found) {
    return makeResult('verified', {
      reasoning: `Found ${claim.value} in codebase`,
      evidence_files: [found.file],
    });
  }

  // Try fuzzy match
  const close = findCloseMatch(claim.value, index.candidates);
  if (close) {
    return makeResult('drifted', {
      reasoning: `Not found. Did you mean "${close.match}"?`,
      severity: 'medium',
      suggestion: `Change "${claim.value}" to "${close.match}"`,
    });
  }

  return makeResult('drifted', {
    reasoning: `${claim.value} not found in codebase`,
    severity: 'high',
  });
}
```

Register it in the verifier router in `src/layers/L3-verifier/index.ts`:

```typescript
case 'your_new_type':
  return verifyYourNewType(claim, index);
```

## Step 4: Write Tests

### Extraction tests

In `test/layers/L1-claim-extractor/`:

```typescript
describe('extractYourNewType', () => {
  it('extracts from standard format', () => {
    const results = extractYourNewType('some input line', 1, context);
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('expected-value');
    expect(results[0].claim_type).toBe('your_new_type');
  });

  it('returns empty for non-matching lines', () => {
    const results = extractYourNewType('no match here', 1, context);
    expect(results).toHaveLength(0);
  });
});
```

### Verification tests

In `test/layers/L3-verifier/`:

```typescript
describe('verifyYourNewType', () => {
  it('verifies when found in codebase', () => {
    const claim = makeClaim({ claim_type: 'your_new_type', value: 'test-value' });
    const index = makeMockIndex({ /* relevant index data */ });

    const result = verifyYourNewType(claim, index);
    expect(result?.verdict).toBe('verified');
  });

  it('drifts when not found', () => {
    const claim = makeClaim({ claim_type: 'your_new_type', value: 'missing' });
    const index = makeMockIndex({});

    const result = verifyYourNewType(claim, index);
    expect(result?.verdict).toBe('drifted');
  });

  it('suggests close matches', () => {
    const claim = makeClaim({ claim_type: 'your_new_type', value: 'almostRight' });
    const index = makeMockIndex({ /* with similar value */ });

    const result = verifyYourNewType(claim, index);
    expect(result?.suggestion).toContain('Did you mean');
  });
});
```

## Step 5: Verify

```bash
npm run typecheck && npm run test
```

Both must pass before the change is complete.

## Checklist

- [ ] Claim type added to `ClaimType` union (if new type)
- [ ] Claim type added to config schema (if new type)
- [ ] Extractor function written and registered
- [ ] Verifier function written and registered
- [ ] Uses `makeResult()` for all verification results
- [ ] Uses `findCloseMatch()` for fuzzy suggestions where appropriate
- [ ] Extraction tests cover match and no-match cases
- [ ] Verification tests cover verified, drifted, and edge cases
- [ ] `npm run typecheck && npm run test` passes

