/**
 * QA acceptance tests for local-pipeline pure functions.
 * Pipeline: bee87ae1-d817-4176-9930-4c430bc9dd88
 */
import { describe, it, expect } from 'vitest';
import {
  filterUncertain,
  countVerdicts,
  buildHotspots,
  findSection,
  listHeadings,
  parseHeadings,
} from '../../../src/cli/local-pipeline';
import type { VerificationResult } from '../../../src/shared/types';
import type { ScanFileResult } from '../../../src/cli/local-pipeline';

/** Minimal VR factory — only fields used by the functions under test. */
function makeVR(verdict: 'verified' | 'drifted' | 'uncertain'): VerificationResult {
  return {
    id: `vr-${Math.random().toString(36).slice(2, 8)}`,
    claim_id: 'claim-1',
    repo_id: 'repo-1',
    scan_run_id: null,
    verdict,
    confidence: verdict === 'verified' ? 0.95 : verdict === 'drifted' ? 0.8 : 0.3,
    tier: 1,
    severity: null,
    reasoning: null,
    specific_mismatch: null,
    suggested_fix: null,
    evidence_files: [],
    token_cost: null,
    duration_ms: null,
    post_check_result: null,
    verification_path: null,
    created_at: new Date(),
  } as VerificationResult;
}

// ---------------------------------------------------------------------------
// filterUncertain
// ---------------------------------------------------------------------------
describe('filterUncertain', () => {
  it('removes uncertain results and keeps verified/drifted', () => {
    const results = [makeVR('verified'), makeVR('uncertain'), makeVR('drifted'), makeVR('uncertain')];
    const filtered = filterUncertain(results);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.verdict !== 'uncertain')).toBe(true);
  });

  it('returns empty array when all are uncertain', () => {
    const results = [makeVR('uncertain'), makeVR('uncertain')];
    expect(filterUncertain(results)).toHaveLength(0);
  });

  it('returns all when none are uncertain', () => {
    const results = [makeVR('verified'), makeVR('drifted')];
    expect(filterUncertain(results)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// countVerdicts
// ---------------------------------------------------------------------------
describe('countVerdicts', () => {
  it('tallies mixed verdicts correctly', () => {
    const results = [
      makeVR('verified'), makeVR('verified'), makeVR('drifted'),
      makeVR('uncertain'), makeVR('drifted'),
    ];
    const counts = countVerdicts(results);
    expect(counts).toEqual({ verified: 2, drifted: 2, uncertain: 1 });
  });

  it('returns zeros for empty input', () => {
    expect(countVerdicts([])).toEqual({ verified: 0, drifted: 0, uncertain: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildHotspots
// ---------------------------------------------------------------------------
describe('buildHotspots', () => {
  it('returns files with drifted results sorted by count descending', () => {
    const files: ScanFileResult[] = [
      { file: 'a.md', claims: [], results: [makeVR('drifted')] },
      { file: 'b.md', claims: [], results: [makeVR('drifted'), makeVR('drifted'), makeVR('verified')] },
      { file: 'c.md', claims: [], results: [makeVR('verified')] },
    ];
    const hotspots = buildHotspots(files);
    expect(hotspots).toHaveLength(2); // c.md excluded (no drift)
    expect(hotspots[0]).toEqual({ file: 'b.md', driftedCount: 2 });
    expect(hotspots[1]).toEqual({ file: 'a.md', driftedCount: 1 });
  });

  it('returns empty array when no files have drift', () => {
    const files: ScanFileResult[] = [
      { file: 'a.md', claims: [], results: [makeVR('verified')] },
    ];
    expect(buildHotspots(files)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findSection
// ---------------------------------------------------------------------------
describe('findSection', () => {
  const markdown = [
    '# Title',
    'Intro text',
    '## Installation',
    'Install steps...',
    'More install...',
    '## Usage',
    'Usage text...',
    '### Advanced Usage',
    'Advanced...',
    '## FAQ',
    'Questions...',
  ].join('\n');

  it('finds a section with correct line range', () => {
    const section = findSection(markdown, 'Installation');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Installation');
    expect(section!.level).toBe(2);
    expect(section!.startLine).toBe(3);
    expect(section!.endLine).toBe(5); // ends before "## Usage" on line 6
  });

  it('returns null for non-existent heading', () => {
    expect(findSection(markdown, 'Nonexistent')).toBeNull();
  });

  it('searches case-insensitively', () => {
    const section = findSection(markdown, 'installation');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Installation');
  });

  it('includes subsections in parent section range', () => {
    const section = findSection(markdown, 'Usage');
    expect(section).not.toBeNull();
    // "## Usage" starts at line 6, "### Advanced Usage" is a child (level 3 > 2),
    // section ends before "## FAQ" at line 10 → endLine = 9
    expect(section!.startLine).toBe(6);
    expect(section!.endLine).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// listHeadings / parseHeadings
// ---------------------------------------------------------------------------
describe('listHeadings', () => {
  it('parses multi-level markdown headings', () => {
    const content = '# H1\ntext\n## H2\n### H3\n#### H4\n';
    const headings = listHeadings(content);
    expect(headings).toEqual([
      { text: 'H1', level: 1, line: 1 },
      { text: 'H2', level: 2, line: 3 },
      { text: 'H3', level: 3, line: 4 },
      { text: 'H4', level: 4, line: 5 },
    ]);
  });

  it('returns empty array for content with no headings', () => {
    expect(listHeadings('just some text\nno headings here')).toEqual([]);
  });
});

describe('parseHeadings', () => {
  it('ignores lines that look like headings but have no space after #', () => {
    const lines = ['#NoSpace', '# Valid Heading', '##Also no space'];
    const headings = parseHeadings(lines);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe('Valid Heading');
  });
});
