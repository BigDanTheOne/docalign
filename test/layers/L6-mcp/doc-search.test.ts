import { describe, it, expect } from 'vitest';
import { splitIntoSections, reciprocalRankFusion, DocSearchIndex } from '../../../src/layers/L6-mcp/doc-search';

describe('splitIntoSections', () => {
  it('splits markdown by headings', () => {
    const content = `# Title

Some intro text.

## Installation

Install with npm.

## Usage

Use the CLI.
`;
    const sections = splitIntoSections('README.md', content);

    expect(sections).toHaveLength(3);
    expect(sections[0].heading).toBe('Title');
    expect(sections[0].id).toBe('README.md#Title');
    expect(sections[0].startLine).toBe(1);
    expect(sections[1].heading).toBe('Installation');
    expect(sections[1].content).toContain('Install with npm');
    expect(sections[2].heading).toBe('Usage');
    expect(sections[2].content).toContain('Use the CLI');
  });

  it('returns full document section when no headings', () => {
    const content = 'Just some text without headings.\nMore text.';
    const sections = splitIntoSections('NOTES.md', content);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Full Document');
    expect(sections[0].id).toBe('NOTES.md#_full');
    expect(sections[0].startLine).toBe(1);
    expect(sections[0].endLine).toBe(2);
  });

  it('handles nested headings correctly', () => {
    const content = `# Top

## Sub1

### Nested

## Sub2
`;
    const sections = splitIntoSections('doc.md', content);

    expect(sections).toHaveLength(4);
    expect(sections[0].heading).toBe('Top');
    expect(sections[1].heading).toBe('Sub1');
    expect(sections[2].heading).toBe('Nested');
    expect(sections[3].heading).toBe('Sub2');
  });

  it('truncates long content to 5000 chars', () => {
    const longContent = '# Big\n\n' + 'x'.repeat(10000);
    const sections = splitIntoSections('big.md', longContent);

    expect(sections[0].content.length).toBeLessThanOrEqual(5000);
  });

  it('handles duplicate headings with unique IDs', () => {
    const content = `# Title

## Examples

First example.

## Examples

Second example.
`;
    const sections = splitIntoSections('doc.md', content);

    const ids = sections.map((s) => s.id);
    // All IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
    // First "Examples" gets normal ID, second gets line-number suffix
    expect(ids).toContain('doc.md#Examples');
    expect(ids.some((id) => id.startsWith('doc.md#Examples:L'))).toBe(true);
  });
});

describe('reciprocalRankFusion', () => {
  it('combines multiple signal sets', () => {
    const signal1 = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
    ];
    const signal2 = [
      { id: 'b', rank: 1 },
      { id: 'c', rank: 2 },
    ];

    const scores = reciprocalRankFusion([signal1, signal2]);

    // 'b' appears in both signals, should have highest score
    const scoreA = scores.get('a')!;
    const scoreB = scores.get('b')!;
    const scoreC = scores.get('c')!;

    expect(scoreB).toBeGreaterThan(scoreA);
    expect(scoreB).toBeGreaterThan(scoreC);
  });

  it('uses k=60 by default', () => {
    const signal = [{ id: 'a', rank: 1 }];
    const scores = reciprocalRankFusion([signal]);

    // Score should be 1 / (60 + 1) = 0.01639...
    expect(scores.get('a')!).toBeCloseTo(1 / 61, 5);
  });

  it('allows custom k parameter', () => {
    const signal = [{ id: 'a', rank: 1 }];
    const scores = reciprocalRankFusion([signal], 10);

    // Score should be 1 / (10 + 1) = 0.0909...
    expect(scores.get('a')!).toBeCloseTo(1 / 11, 5);
  });

  it('handles empty signal sets', () => {
    const scores = reciprocalRankFusion([]);
    expect(scores.size).toBe(0);
  });

  it('handles single item correctly', () => {
    const signal = [{ id: 'only', rank: 1 }];
    const scores = reciprocalRankFusion([signal]);
    expect(scores.has('only')).toBe(true);
  });
});

describe('DocSearchIndex', () => {
  it('can be created without errors', () => {
    const index = new DocSearchIndex();
    expect(index).toBeDefined();
  });

  it('returns empty results when not built', () => {
    const index = new DocSearchIndex();
    const result = index.search('test');
    expect(result.sections).toEqual([]);
    expect(result.total_matches).toBe(0);
    expect(result.signals_used).toEqual([]);
  });
});

describe('Error handling', () => {
  describe('splitIntoSections', () => {
    it('handles invalid markdown gracefully', () => {
      const invalidContent = '\x00\x01\x02'; // Binary data
      const sections = splitIntoSections('binary.md', invalidContent);
      // Should return full document section instead of throwing
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe('Full Document');
    });

    it('handles empty content', () => {
      const sections = splitIntoSections('empty.md', '');
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe('Full Document');
      expect(sections[0].content).toBe('');
    });

    it('handles extremely long content without errors', () => {
      const longContent = '# Title\n\n' + 'x'.repeat(100000);
      expect(() => splitIntoSections('huge.md', longContent)).not.toThrow();
    });
  });

  describe('reciprocalRankFusion', () => {
    it('handles invalid rank values gracefully', () => {
      const signal = [{ id: 'a', rank: -1 }]; // Negative rank
      expect(() => reciprocalRankFusion([signal])).not.toThrow();
    });

    it('handles duplicate IDs across signals', () => {
      const signal1 = [{ id: 'a', rank: 1 }];
      const signal2 = [{ id: 'a', rank: 1 }];
      const scores = reciprocalRankFusion([signal1, signal2]);
      expect(scores.has('a')).toBe(true);
    });
  });
});
