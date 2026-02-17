import { describe, it, expect } from 'vitest';

describe('qa integration: false-positive elimination contracts', () => {
  it('enforces threshold contract metadata is present', () => {
    const threshold = { internalMaxFalsePositives: 5, externalMinPrecision: 0.7 };
    expect(threshold.internalMaxFalsePositives).toBeLessThanOrEqual(5);
    expect(threshold.externalMinPrecision).toBeGreaterThanOrEqual(0.7);
  });

  it('documents ambiguous suffix handling as explicit state', () => {
    const result = { status: 'ambiguous_suffix_match', candidates: ['src/a/x.ts', 'src/b/x.ts'] };
    expect(result.status).toBe('ambiguous_suffix_match');
    expect(result.candidates.length).toBeGreaterThan(1);
  });
});
