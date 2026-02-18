---
title: "Testing"
summary: "DocAlign's test structure, fixture helpers, and patterns for writing extraction tests, verification tests, and config tests using Vitest."
description: "Commands: npm run test, npm run test:watch, npm run typecheck (must pass together after every change). Test structure mirrors src/ under test/layers/ (L0-L7), cli/, config/, shared/. Fixture helpers: makeClaim() (creates Claim with defaults, override specific fields), makeMockIndex() (fields: files, packages, scripts, engines, license, headings, envVars, exports). makeResult() is the production helper used in test assertions. Extraction tests: positive/negative/edge cases, verify claim_type/value/line_number. Verification tests: verified/drifted/fuzzy paths, correct severity. Config tests: defaults for empty config, numeric range validation. Coverage targets: L1 extractors (high), L3 verifiers (high), config (full), CLI (integration-level). Coverage report: npm run test -- --coverage."
category: guide
read_when:
  - You are writing tests for a new extractor or verifier
  - You need to know which fixture helper to use and its available fields
  - You want to understand the test coverage expectations per layer
related:
  - docs/contributing/design-patterns.md
  - docs/contributing/adding-a-check.md
  - CONVENTIONS.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Testing

DocAlign uses Vitest for all testing. Tests mirror the source structure.

## Running Tests

```bash
npm run test           # Run all tests once
npm run test:watch     # Watch mode (re-run on changes)
npm run typecheck      # TypeScript type checking (run before tests)
```

<!-- docalign:semantic id="semantic-test-typecheck-rule" claim="npm run typecheck && npm run test must pass after every change" -->
**Rule:** `npm run typecheck && npm run test` must pass after every change.

## Test Structure
<!-- docalign:skip reason="tutorial_example" description="Target test/ directory structure diagram — aspirational layout matching the unimplemented src/ structure, not the actual current test/ contents (pre-existing docalign:skip block)" -->

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
<!-- /docalign:skip -->

### makeClaim()

<!-- docalign:skip reason="illustrative_example" description="makeClaim() usage example with hypothetical Claim fields — shows how the fixture would be called, not a real test (pre-existing docalign:skip block)" -->
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
<!-- /docalign:skip -->

<!-- docalign:skip reason="illustrative_example" description="makeMockIndex() usage example with hypothetical CodebaseIndex fields — shows how the fixture would be called, not a real test (pre-existing docalign:skip block)" -->
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
<!-- /docalign:skip -->

### makeResult()

Not a test fixture -- this is the production helper used to build `VerificationResult` objects. Tests use it to verify that verifiers produce expected outputs.

## Writing Extraction Tests

Extraction tests verify that regex patterns correctly identify claims in documentation lines:

```typescript
describe('extractPathReferences', () => {
<!-- docalign:skip reason="illustrative_example" description="Writing Extraction Tests section with hypothetical extractPathReferences test code — shows patterns contributors should follow, not actual test implementations (pre-existing docalign:skip block)" -->
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
<!-- /docalign:skip -->
  });
<!-- docalign:skip reason="illustrative_example" description="Writing Verification Tests section with hypothetical verifyPathReference test code — shows patterns contributors should follow, not actual test implementations (pre-existing docalign:skip block)" -->

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
<!-- /docalign:skip -->
    // Should clamp to 200 or warn
<!-- docalign:skip reason="illustrative_example" description="Config Tests section with hypothetical parseConfig test code — shows patterns contributors should follow, not actual test implementations (pre-existing docalign:skip block)" -->
  });
});
```

## Test Coverage

<!-- docalign:semantic id="semantic-test-coverage-targets" claim="Coverage targets: L1 extractors high, L3 verifiers high, Config full coverage, CLI integration-level" -->
Coverage targets vary by layer:
- **L1 extractors**: High coverage (each regex pattern tested with positive + negative cases)
- **L3 verifiers**: High coverage (verified + drifted + edge cases per claim type)
- **Config**: Full coverage of parsing, defaults, and error paths
- **CLI**: Integration-level tests for command dispatch

Run coverage report:

```bash
<!-- /docalign:skip -->
npm run test -- --coverage
```
