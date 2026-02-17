import { describe, it, expect } from 'vitest';
import type { PreProcessedDoc } from '../../../src/shared/types';
import { extractPaths, extractCommands } from '../../../src/layers/L1-claim-extractor/extractors';
import { preProcess, detectFormat } from '../../../src/layers/L1-claim-extractor/preprocessing';

function makeDoc(content: string): PreProcessedDoc {
  const lines = content.split('\n');
  const tagLines = new Set<number>();
  const TAG_LINE_PATTERN = /^\s*<!--\s*docalign:\w+\s+.*?-->\s*$/;
  for (let i = 0; i < lines.length; i++) {
    if (TAG_LINE_PATTERN.test(lines[i])) {
      tagLines.add(i);
    }
  }
  return {
    cleaned_content: content,
    original_line_map: lines.map((_, i) => i + 1),
    format: 'markdown',
    file_size_bytes: content.length,
    code_fence_lines: new Set<number>(),
    tag_lines: tagLines,
  };
}

describe('tag-aware extraction integration', () => {
  it('tag lines are not extracted as path references', () => {
    const doc = makeDoc([
      'Real path: `src/index.ts`',
      '<!-- docalign:claim id="tagged-1" type="path_reference" status="verified" -->',
      'Another real path: `src/app.ts`',
    ].join('\n'));
    const results = extractPaths(doc, 'README.md');
    // Should only extract the real paths, not the tag line
    const paths = results.map(r => (r.extracted_value as Record<string, unknown>).path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/app.ts');
    // Tag line should not produce any extraction
    expect(results.every(r => !r.claim_text.includes('docalign:claim'))).toBe(true);
  });

  it('tag lines in code blocks are not treated as real tags', () => {
    const content = [
      '```markdown',
      '<!-- docalign:claim id="in-code" type="path_reference" status="verified" -->',
      '```',
      'Real path: `src/utils.ts`',
    ].join('\n');
    // Use the real preprocessing pipeline
    const format = detectFormat('test.md');
    const preprocessed = preProcess(content, format);
    // The tag in the code block should be in code_fence_lines, not tag_lines
    // because preprocessing detects code fences first
    expect(preprocessed.code_fence_lines.has(1)).toBe(true);
  });

  it('backward compatibility: untagged docs produce same extractions as before', () => {
    const doc = makeDoc([
      '# My Project',
      '',
      'See `src/config.ts` for configuration.',
      'Run `npm run build` to compile.',
    ].join('\n'));
    const pathResults = extractPaths(doc, 'README.md');
    const cmdResults = extractCommands(doc);
    expect(pathResults.length).toBeGreaterThan(0);
    expect(cmdResults.length).toBeGreaterThan(0);
  });

  it('mixed tagged and untagged content handled correctly', () => {
    const doc = makeDoc([
      'Path 1: `src/a.ts`',
      '<!-- docalign:claim id="tag-a" type="path_reference" status="verified" -->',
      'Path 2: `src/b.ts`',
      '<!-- docalign:claim id="tag-b" type="path_reference" status="drifted" -->',
      'Path 3: `src/c.ts`',
    ].join('\n'));
    const results = extractPaths(doc, 'README.md');
    const paths = results.map(r => (r.extracted_value as Record<string, unknown>).path);
    // All 3 real paths should be extracted
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths).toContain('src/c.ts');
    // No extractions from tag lines
    expect(results.length).toBe(3);
  });

  it('preprocessing preserves docalign tags from HTML stripping', () => {
    const content = [
      '# Title',
      '<p>HTML paragraph</p>',
      '<!-- docalign:claim id="preserved" type="path_reference" status="verified" -->',
      '<div>More HTML</div>',
    ].join('\n');
    const format = detectFormat('test.md');
    const preprocessed = preProcess(content, format);
    // The docalign tag should be preserved
    expect(preprocessed.cleaned_content).toContain('docalign:claim');
    // But other HTML should be stripped
    expect(preprocessed.cleaned_content).not.toContain('<p>');
    expect(preprocessed.cleaned_content).not.toContain('<div>');
    // The tag line should be detected
    expect(preprocessed.tag_lines.has(2)).toBe(true);
  });

  it('preprocessing detects tag lines correctly', () => {
    const content = [
      '# Title',
      '<!-- docalign:claim id="t1" type="path_reference" status="verified" -->',
      'Content',
      '<!-- docalign:claim id="t2" type="command" status="drifted" -->',
    ].join('\n');
    const format = detectFormat('test.md');
    const preprocessed = preProcess(content, format);
    expect(preprocessed.tag_lines.has(1)).toBe(true); // line index 1
    expect(preprocessed.tag_lines.has(3)).toBe(true); // line index 3
    expect(preprocessed.tag_lines.has(0)).toBe(false); // # Title
    expect(preprocessed.tag_lines.has(2)).toBe(false); // Content
  });
});
