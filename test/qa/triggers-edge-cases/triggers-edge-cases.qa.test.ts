/**
 * QA Acceptance Tests: T6 — Triggers Edge Cases
 *
 * These tests verify that each L4-triggers module handles edge cases correctly:
 * malformed input, empty data, invalid transitions, and error conditions.
 */
import { describe, it, expect } from 'vitest';
import { classifyFiles, isDocFile } from '../../../src/layers/L4-triggers/classify-files';
import { prioritizeClaims, deduplicateClaims } from '../../../src/layers/L4-triggers/prioritize';
import type { FileChange, Claim } from '../../../src/shared/types';

// --- Helpers ---

function makeChange(filename: string, status: FileChange['status'] = 'modified'): FileChange {
  return { filename, status, additions: 1, deletions: 0 };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: `claim-${Math.random().toString(36).slice(2, 8)}`,
    source_file: 'docs/README.md',
    line_number: 1,
    claim_text: 'test claim',
    claim_type: 'path_reference',
    testability: 'syntactic',
    extraction_confidence: 0.9,
    ...overrides,
  } as Claim;
}

// ============================================================
// classify-files edge cases
// ============================================================
describe('classifyFiles — edge cases', () => {
  it('returns empty arrays when given empty input', () => {
    const result = classifyFiles([]);
    expect(result.code_files).toEqual([]);
    expect(result.doc_files).toEqual([]);
    expect(result.renames).toEqual([]);
    expect(result.deletions).toEqual([]);
  });

  it('classifies files with no extension as code', () => {
    const result = classifyFiles([makeChange('Makefile'), makeChange('Dockerfile')]);
    expect(result.code_files).toHaveLength(2);
    expect(result.doc_files).toHaveLength(0);
  });

  it('classifies files with unknown extensions as code', () => {
    const result = classifyFiles([
      makeChange('data.xyz'),
      makeChange('config.toml'),
      makeChange('image.png'),
    ]);
    expect(result.code_files).toHaveLength(3);
    expect(result.doc_files).toHaveLength(0);
  });

  it('isDocFile returns false for extensionless files', () => {
    expect(isDocFile('Makefile')).toBe(false);
  });
});

// ============================================================
// prioritize edge cases
// ============================================================
describe('prioritizeClaims — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(prioritizeClaims([])).toEqual([]);
  });

  it('returns the single claim when given one item', () => {
    const claim = makeClaim();
    const result = prioritizeClaims([claim]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(claim.id);
  });

  it('returns stable order when all claims have same priority', () => {
    const claims = Array.from({ length: 5 }, (_, i) =>
      makeClaim({
        id: `claim-${i}`,
        source_file: 'same-file.md',
        line_number: i + 1,
        testability: 'syntactic',
        extraction_confidence: 0.9,
      }),
    );
    const result = prioritizeClaims(claims);
    expect(result).toHaveLength(5);
    // Same weight, same file → sorted by line number ascending
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].line_number).toBeLessThanOrEqual(result[i + 1].line_number);
    }
  });
});

describe('deduplicateClaims — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateClaims([])).toEqual([]);
  });

  it('removes exact duplicate IDs keeping first occurrence', () => {
    const c1 = makeClaim({ id: 'dup' });
    const c2 = makeClaim({ id: 'dup', line_number: 999 });
    const result = deduplicateClaims([c1, c2]);
    expect(result).toHaveLength(1);
    expect(result[0].line_number).toBe(c1.line_number);
  });
});
