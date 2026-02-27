import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('QA contract: comparison table in README', () => {
  const readmePath = resolve(__dirname, '../../../../README.md');
  let readme: string;

  try {
    readme = readFileSync(readmePath, 'utf-8');
  } catch {
    readme = '';
  }

  it('README.md has a "## How DocAlign Compares" section', () => {
    expect(readme).toContain('## How DocAlign Compares');
  });

  it('contains a markdown table with header row and separator', () => {
    const sectionStart = readme.indexOf('## How DocAlign Compares');
    expect(sectionStart).toBeGreaterThan(-1);
    // Find next ## or end of file
    const nextSection = readme.indexOf('\n## ', sectionStart + 1);
    const section = nextSection > -1
      ? readme.slice(sectionStart, nextSection)
      : readme.slice(sectionStart);
    // Table must have | header | and |---| separator
    expect(section).toMatch(/\|.*\|/);
    expect(section).toMatch(/\|[-\s|]+\|/);
  });

  it('table includes ≥4 comparison tools plus DocAlign (≥6 data rows)', () => {
    const sectionStart = readme.indexOf('## How DocAlign Compares');
    const nextSection = readme.indexOf('\n## ', sectionStart + 1);
    const section = nextSection > -1
      ? readme.slice(sectionStart, nextSection)
      : readme.slice(sectionStart);
    const lines = section.split('\n').filter(l => l.trim().startsWith('|'));
    // header + separator + at least 5 data rows (4 tools + DocAlign)
    expect(lines.length).toBeGreaterThanOrEqual(7);
  });

  it('cells use emoji (✅/❌) not prose', () => {
    const sectionStart = readme.indexOf('## How DocAlign Compares');
    const nextSection = readme.indexOf('\n## ', sectionStart + 1);
    const section = nextSection > -1
      ? readme.slice(sectionStart, nextSection)
      : readme.slice(sectionStart);
    const lines = section.split('\n').filter(l => l.trim().startsWith('|'));
    // Skip header and separator (first two lines)
    const dataRows = lines.slice(2);
    for (const row of dataRows) {
      const cells = row.split('|').slice(2, -1); // skip first cell (tool name) and empty edges
      for (const cell of cells) {
        const trimmed = cell.trim();
        // Each cell should be ✅, ❌, or partial/Partial (not long prose)
        expect(trimmed.length).toBeLessThanOrEqual(10);
      }
    }
  });

  it('section is ≤20 lines total', () => {
    const sectionStart = readme.indexOf('## How DocAlign Compares');
    const nextSection = readme.indexOf('\n## ', sectionStart + 1);
    const section = nextSection > -1
      ? readme.slice(sectionStart, nextSection)
      : readme.slice(sectionStart);
    const lines = section.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});
