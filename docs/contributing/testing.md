# Testing

DocAlign uses Vitest for all testing. Tests mirror the source structure.

## Running Tests

```bash
npm run test           # Run all tests once
npm run test:watch     # Watch mode (re-run on changes)
npm run typecheck      # TypeScript type checking (run before tests)
```

**Rule:** `npm run typecheck && npm run test` must pass after every change.

## Test Structure
Tests mirror the `src/` directory:

```
test/
  layers/
    L0-codebase-index/    # Index building, AST parsing
    L1-claim-extractor/   # Extraction tests per claim type
    L2-mapper/            # Mapping tests
    L3-verifier/          # Verification tests per claim type
    L4-triggers/          # Pipeline orchestration
    L5-reporter/          # Output formatting
    L6-mcp/               # MCP tool handler tests
    L7-learning/          # Feedback loop tests
  cli/                    # CLI command tests
  config/                 # Config loading and validation tests
  shared/                 # Utility tests
```

## Test Fixtures
### makeClaim()

Creates a test `Claim` object with sensible defaults. Override only what matters for your test:

```typescript
import { makeClaim } from '../fixtures';

const claim = makeClaim({
  claim_type: 'path_reference',
  value: 'src/auth.ts',
  source_file: 'README.md',
  line_number: 15,
});
```

### makeMockIndex()
Creates a mock `CodebaseIndex` that verifiers use to check claims:

```typescript
import { makeMockIndex } from '../fixtures';

const index = makeMockIndex({
  files: ['src/auth.ts', 'src/index.ts'],
  packages: { express: '^4.18.0', react: '^18.2.0' },
  scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .' },
  engines: { node: '>=18.0.0' },
  license: 'MIT',
});
```

**Available fields:**
- `files`: Array of file paths that "exist" in the mock repo
- `packages`: Object of package name → version string
- `scripts`: Object of script name → command
- `engines`: Object of engine → version constraint
- `license`: License string
- `headings`: Object of file → heading slugs
- `envVars`: Array of known environment variables
- `exports`: Object of file → exported symbols
### makeResult()

Not a test fixture -- this is the production helper used to build `VerificationResult` objects. Tests use it to verify that verifiers produce expected outputs.

## Writing Extraction Tests

Extraction tests verify that regex patterns correctly identify claims in documentation lines:

```typescript
describe('extractPathReferences', () => {
it('extracts inline file paths', () => {
    const results = extractPathReferences('See `src/auth.ts` for details', 1, ctx);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      claim_type: 'path_reference',
      value: 'src/auth.ts',
      line_number: 1,
    });
  });

  it('ignores non-path text', () => {
    const results = extractPathReferences('This is plain text', 1, ctx);
    expect(results).toHaveLength(0);
  });

  it('extracts multiple paths from one line', () => {
    const results = extractPathReferences('Copy `a.ts` to `b.ts`', 1, ctx);
    expect(results).toHaveLength(2);
  });
});
```

**Testing principles for extractors:**
- Test positive cases (lines that should match)
- Test negative cases (lines that should not match)
- Test edge cases (multiple matches, unusual formatting, embedded in markdown)
- Test that claim_type, value, and line_number are correct

## Writing Verification Tests

Verification tests check that claims are correctly verified against the codebase:

```typescript
describe('verifyPathReference', () => {
  it('verifies existing file', () => {
    const claim = makeClaim({ claim_type: 'path_reference', value: 'src/auth.ts' });
    const index = makeMockIndex({ files: ['src/auth.ts'] });

    const result = verifyPathReference(claim, index);
    expect(result?.verdict).toBe('verified');
});
it('drifts for missing file', () => {
    const claim = makeClaim({ claim_type: 'path_reference', value: 'src/missing.ts' });
    const index = makeMockIndex({ files: ['src/auth.ts'] });

    const result = verifyPathReference(claim, index);
    expect(result?.verdict).toBe('drifted');
    expect(result?.severity).toBe('high');
  });

  it('suggests close matches', () => {
    const claim = makeClaim({ claim_type: 'path_reference', value: 'src/auht.ts' });
    const index = makeMockIndex({ files: ['src/auth.ts'] });

    const result = verifyPathReference(claim, index);
    expect(result?.suggestion).toContain('auth.ts');
  });
});
```

**Testing principles for verifiers:**
- Test the `verified` path (claim matches code)
- Test the `drifted` path (claim contradicts code)
- Test fuzzy suggestions (close but not exact)
- Test that severity is set appropriately
- Test edge cases (empty index, null values)

## Config Tests

Config tests verify YAML parsing, default merging, and validation:

```typescript
describe('parseConfig', () => {
  it('returns defaults for empty config', () => {
    const config = parseConfig('');
    expect(config.verification.min_severity).toBe('low');
  });

  it('validates numeric ranges', () => {
    const config = parseConfig('verification:\n  max_claims_per_pr: 999');
// Should clamp to 200 or warn
});
});
```

## Test Coverage

Coverage targets vary by layer:
- **L1 extractors**: High coverage (each regex pattern tested with positive + negative cases)
- **L3 verifiers**: High coverage (verified + drifted + edge cases per claim type)
- **Config**: Full coverage of parsing, defaults, and error paths
- **CLI**: Integration-level tests for command dispatch

Run coverage report:

```bash
npm run test -- --coverage
```
