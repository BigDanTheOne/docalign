import { describe, it, expect } from 'vitest';
import { compareVersions, stripVersionPrefix } from '../../../src/layers/L3-verifier/version-comparison';

describe('compareVersions — semver range handling', () => {
  // === Caret (^) ranges ===
  describe('caret (^) ranges', () => {
    it('^4.18.0: doc "4.18.0" matches (exact base)', () => {
      expect(compareVersions('4.18.0', '^4.18.0', 'manifest').matches).toBe(true);
    });

    it('^4.18.0: doc "4.19.0" matches (higher minor)', () => {
      expect(compareVersions('4.19.0', '^4.18.0', 'manifest').matches).toBe(true);
    });

    it('^4.18.0: doc "4.18.2" matches (higher patch)', () => {
      expect(compareVersions('4.18.2', '^4.18.0', 'manifest').matches).toBe(true);
    });

    it('^4.18.0: doc "5.0.0" does NOT match (different major)', () => {
      expect(compareVersions('5.0.0', '^4.18.0', 'manifest').matches).toBe(false);
    });

    it('^4.18.0: doc "4.17.0" does NOT match (below range)', () => {
      expect(compareVersions('4.17.0', '^4.18.0', 'manifest').matches).toBe(false);
    });

    it('^0.2.3: doc "0.2.5" matches (same minor for 0.x)', () => {
      expect(compareVersions('0.2.5', '^0.2.3', 'manifest').matches).toBe(true);
    });

    it('^0.2.3: doc "0.3.0" does NOT match (different minor for 0.x)', () => {
      expect(compareVersions('0.3.0', '^0.2.3', 'manifest').matches).toBe(false);
    });
  });

  // === Tilde (~) ranges ===
  describe('tilde (~) ranges', () => {
    it('~1.2.3: doc "1.2.5" matches (higher patch)', () => {
      expect(compareVersions('1.2.5', '~1.2.3', 'manifest').matches).toBe(true);
    });

    it('~1.2.3: doc "1.3.0" does NOT match (different minor)', () => {
      expect(compareVersions('1.3.0', '~1.2.3', 'manifest').matches).toBe(false);
    });

    it('~1.2.3: doc "1.2.3" matches (exact)', () => {
      expect(compareVersions('1.2.3', '~1.2.3', 'manifest').matches).toBe(true);
    });
  });

  // === Comparison operators ===
  describe('comparison operators', () => {
    it('>=18.0.0: doc "18.0.0" matches', () => {
      expect(compareVersions('18.0.0', '>=18.0.0', 'manifest').matches).toBe(true);
    });

    it('>=18.0.0: doc "20.0.0" matches', () => {
      expect(compareVersions('20.0.0', '>=18.0.0', 'manifest').matches).toBe(true);
    });

    it('>=18.0.0: doc "17.0.0" does NOT match', () => {
      expect(compareVersions('17.0.0', '>=18.0.0', 'manifest').matches).toBe(false);
    });

    it('>2.0.0: doc "2.0.0" does NOT match (not strictly greater)', () => {
      expect(compareVersions('2.0.0', '>2.0.0', 'manifest').matches).toBe(false);
    });

    it('>2.0.0: doc "2.0.1" matches', () => {
      expect(compareVersions('2.0.1', '>2.0.0', 'manifest').matches).toBe(true);
    });
  });

  // === Partial version matching with ranges ===
  describe('partial version with range', () => {
    it('^4.18.0: doc "4" matches (major-only = any 4.x)', () => {
      expect(compareVersions('4', '^4.18.0', 'manifest').matches).toBe(true);
    });

    it('^4.18.0: doc "4.18" matches (major.minor)', () => {
      expect(compareVersions('4.18', '^4.18.0', 'manifest').matches).toBe(true);
    });

    it('~4.18.0: doc "4" matches (major-only)', () => {
      expect(compareVersions('4', '~4.18.0', 'manifest').matches).toBe(true);
    });

    it('^5.0.0: doc "4" does NOT match', () => {
      expect(compareVersions('4', '^5.0.0', 'manifest').matches).toBe(false);
    });
  });

  // === Non-manifest source (lockfile) ===
  describe('lockfile source (exact comparison)', () => {
    it('exact match: "4.18.0" vs "4.18.0"', () => {
      expect(compareVersions('4.18.0', '4.18.0', 'lockfile').matches).toBe(true);
    });

    it('major-only: "4" vs "4.18.0"', () => {
      expect(compareVersions('4', '4.18.0', 'lockfile').matches).toBe(true);
    });

    it('major.minor: "4.18" vs "4.18.2"', () => {
      expect(compareVersions('4.18', '4.18.2', 'lockfile').matches).toBe(true);
    });

    it('mismatch: "5" vs "4.18.0"', () => {
      expect(compareVersions('5', '4.18.0', 'lockfile').matches).toBe(false);
    });
  });

  // === comparison_type field ===
  describe('comparison_type', () => {
    it('returns "range" for manifest with prefix', () => {
      expect(compareVersions('4.18.0', '^4.18.0', 'manifest').comparison_type).toBe('range');
    });

    it('returns "major_only" for single-segment version', () => {
      expect(compareVersions('4', '4.18.0', 'lockfile').comparison_type).toBe('major_only');
    });

    it('returns "exact" for 3-segment version', () => {
      expect(compareVersions('4.18.0', '4.18.0', 'lockfile').comparison_type).toBe('exact');
    });
  });
});

describe('stripVersionPrefix', () => {
  it('strips v prefix', () => {
    expect(stripVersionPrefix('v4.18.0')).toBe('4.18.0');
  });

  it('strips caret', () => {
    expect(stripVersionPrefix('^4.18.0')).toBe('4.18.0');
  });

  it('strips tilde', () => {
    expect(stripVersionPrefix('~1.2.3')).toBe('1.2.3');
  });

  it('strips >=', () => {
    expect(stripVersionPrefix('>=18.0.0')).toBe('18.0.0');
  });

  it('handles plain version', () => {
    expect(stripVersionPrefix('4.18.0')).toBe('4.18.0');
  });
});
