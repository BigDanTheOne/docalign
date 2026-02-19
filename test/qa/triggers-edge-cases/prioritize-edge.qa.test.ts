import { describe, it, expect } from 'vitest';
import { prioritizeClaims } from '../../../src/layers/L4-triggers/prioritize';
import type { Claim } from '../../../src/shared/types';

function makeClaim(overrides: Partial<Claim> & { id: string }): Claim {
  return {
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: 'test claim',
    claim_type: 'path_reference',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'pending',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    severity: 'medium',
    ...overrides,
  } as Claim;
}

describe('prioritizeClaims – edge cases', () => {
  it('returns empty array for empty input', () => {
    const result = prioritizeClaims([]);
    expect(result).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const claim = makeClaim({ id: 'c1' });
    const result = prioritizeClaims([claim]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(claim);
  });

  it('handles all same priority without errors', () => {
    const claims = [
      makeClaim({ id: 'c1', severity: 'medium', source_file: 'b.md' }),
      makeClaim({ id: 'c2', severity: 'medium', source_file: 'a.md' }),
      makeClaim({ id: 'c3', severity: 'medium', source_file: 'c.md' }),
    ];
    const result = prioritizeClaims(claims);
    expect(result).toHaveLength(3);
    // Tiebreaker is file path alphabetical
    expect(result[0].source_file).toBe('a.md');
  });
});
