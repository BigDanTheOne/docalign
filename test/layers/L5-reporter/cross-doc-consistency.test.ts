import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { findCrossDocInconsistencies } from '../../../src/layers/L5-reporter/cross-doc-consistency';
import type { Claim } from '../../../src/shared/types';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: randomUUID(),
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: 'test claim',
    claim_type: 'dependency_version',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'pending',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('findCrossDocInconsistencies', () => {
  it('detects version inconsistencies across docs', () => {
    const claims: Claim[] = [
      makeClaim({
        source_file: 'docs/setup.md',
        claim_type: 'dependency_version',
        extracted_value: { package: 'express', version: '4.18.0' },
      }),
      makeClaim({
        source_file: 'docs/deploy.md',
        claim_type: 'dependency_version',
        extracted_value: { package: 'express', version: '4.17.0' },
      }),
    ];

    const findings = findCrossDocInconsistencies(claims, []);
    expect(findings.length).toBe(1);
    expect(findings[0].result.verdict).toBe('drifted');
    expect(findings[0].result.reasoning).toContain('Cross-doc inconsistency');
  });

  it('returns no findings for consistent values', () => {
    const claims: Claim[] = [
      makeClaim({
        source_file: 'docs/setup.md',
        claim_type: 'dependency_version',
        extracted_value: { package: 'express', version: '4.18.0' },
      }),
      makeClaim({
        source_file: 'docs/deploy.md',
        claim_type: 'dependency_version',
        extracted_value: { package: 'express', version: '4.18.0' },
      }),
    ];

    const findings = findCrossDocInconsistencies(claims, []);
    expect(findings.length).toBe(0);
  });

  it('ignores claims from the same file', () => {
    const claims: Claim[] = [
      makeClaim({
        source_file: 'README.md',
        claim_type: 'config',
        extracted_value: { key: 'port', value: '3000' },
      }),
      makeClaim({
        source_file: 'README.md',
        claim_type: 'config',
        extracted_value: { key: 'port', value: '8080' },
      }),
    ];

    const findings = findCrossDocInconsistencies(claims, []);
    expect(findings.length).toBe(0);
  });

  it('detects config value inconsistencies', () => {
    const claims: Claim[] = [
      makeClaim({
        source_file: 'docs/setup.md',
        claim_type: 'config',
        extracted_value: { key: 'port', value: '3000' },
      }),
      makeClaim({
        source_file: 'docs/deploy.md',
        claim_type: 'config',
        extracted_value: { key: 'port', value: '8080' },
      }),
    ];

    const findings = findCrossDocInconsistencies(claims, []);
    expect(findings.length).toBe(1);
    expect(findings[0].result.reasoning).toContain('3000');
    expect(findings[0].result.reasoning).toContain('8080');
  });

  it('returns empty for claims without comparable values', () => {
    const claims: Claim[] = [
      makeClaim({
        source_file: 'docs/a.md',
        claim_type: 'path_reference',
        extracted_value: { path: 'src/foo.ts' },
      }),
      makeClaim({
        source_file: 'docs/b.md',
        claim_type: 'path_reference',
        extracted_value: { path: 'src/bar.ts' },
      }),
    ];

    const findings = findCrossDocInconsistencies(claims, []);
    expect(findings.length).toBe(0);
  });
});
