import { describe, it, expect } from 'vitest';
import { prioritizeClaims, deduplicateClaims } from '../../../src/layers/L4-triggers/prioritize';
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
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('prioritizeClaims', () => {
  it('sorts by severity weight * confidence descending', () => {
    const claims = [
      makeClaim({ id: '1', testability: 'semantic', extraction_confidence: 0.8 }),  // weight = 2 * 0.8 = 1.6
      makeClaim({ id: '2', testability: 'syntactic', extraction_confidence: 0.9 }), // weight = 3 * 0.9 = 2.7
      makeClaim({ id: '3', testability: 'untestable', extraction_confidence: 1.0 }), // weight = 1 * 1.0 = 1.0
    ];
    const result = prioritizeClaims(claims);
    expect(result[0].id).toBe('2'); // 2.7
    expect(result[1].id).toBe('1'); // 1.6
    expect(result[2].id).toBe('3'); // 1.0
  });

  it('uses file path as tiebreaker', () => {
    const claims = [
      makeClaim({ id: '1', source_file: 'z.md', testability: 'syntactic', extraction_confidence: 1.0 }),
      makeClaim({ id: '2', source_file: 'a.md', testability: 'syntactic', extraction_confidence: 1.0 }),
    ];
    const result = prioritizeClaims(claims);
    expect(result[0].id).toBe('2'); // a.md before z.md
    expect(result[1].id).toBe('1');
  });

  it('uses line number as second tiebreaker', () => {
    const claims = [
      makeClaim({ id: '1', source_file: 'a.md', line_number: 50, testability: 'syntactic', extraction_confidence: 1.0 }),
      makeClaim({ id: '2', source_file: 'a.md', line_number: 10, testability: 'syntactic', extraction_confidence: 1.0 }),
    ];
    const result = prioritizeClaims(claims);
    expect(result[0].id).toBe('2'); // line 10 before 50
    expect(result[1].id).toBe('1');
  });

  it('caps at default 50', () => {
    const claims = Array.from({ length: 60 }, (_, i) =>
      makeClaim({ id: String(i), testability: 'syntactic', extraction_confidence: 1.0 }),
    );
    const result = prioritizeClaims(claims);
    expect(result).toHaveLength(50);
  });

  it('caps at custom max', () => {
    const claims = Array.from({ length: 20 }, (_, i) =>
      makeClaim({ id: String(i), testability: 'syntactic', extraction_confidence: 1.0 }),
    );
    const result = prioritizeClaims(claims, 5);
    expect(result).toHaveLength(5);
  });

  it('handles empty input', () => {
    expect(prioritizeClaims([])).toHaveLength(0);
  });

  it('does not mutate input array', () => {
    const claims = [
      makeClaim({ id: '1', testability: 'semantic', extraction_confidence: 0.5 }),
      makeClaim({ id: '2', testability: 'syntactic', extraction_confidence: 1.0 }),
    ];
    const original = [...claims];
    prioritizeClaims(claims);
    expect(claims[0].id).toBe(original[0].id);
    expect(claims[1].id).toBe(original[1].id);
  });
});

describe('deduplicateClaims', () => {
  it('removes duplicate claims by ID', () => {
    const claims = [
      makeClaim({ id: '1' }),
      makeClaim({ id: '2' }),
      makeClaim({ id: '1' }),
    ];
    const result = deduplicateClaims(claims);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('preserves order (first occurrence)', () => {
    const claims = [
      makeClaim({ id: '3' }),
      makeClaim({ id: '1' }),
      makeClaim({ id: '2' }),
      makeClaim({ id: '1' }),
    ];
    const result = deduplicateClaims(claims);
    expect(result.map((c) => c.id)).toEqual(['3', '1', '2']);
  });

  it('handles empty input', () => {
    expect(deduplicateClaims([])).toHaveLength(0);
  });
});
