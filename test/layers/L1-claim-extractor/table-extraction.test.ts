import { describe, it, expect } from 'vitest';
import { extractTableClaims } from '../../../src/layers/L1-claim-extractor/extractors';
import type { PreProcessedDoc } from '../../../src/shared/types';

function makeDoc(markdown: string): PreProcessedDoc {
  const lines = markdown.split('\n');
  return {
    cleaned_content: markdown,
    original_line_map: lines.map((_, i) => i + 1),
    format: 'markdown',
    file_size_bytes: Buffer.byteLength(markdown, 'utf8'),
    code_fence_lines: new Set(),
    tag_lines: new Set<number>(),
  };
}

describe('extractTableClaims', () => {
  it('extracts path references from table cells', () => {
    const md = `| File | Description |
| --- | --- |
| src/auth.ts | Authentication |
| src/db.ts | Database |`;
    const doc = makeDoc(md);
    const results = extractTableClaims(doc, 'README.md', new Set());
    const pathClaims = results.filter((r) => r.claim_type === 'path_reference');
    expect(pathClaims.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts dependency versions from table cells', () => {
    const md = `| Package | Version |
| --- | --- |
| express | 4.18.0 |
| react | 18.2.0 |`;
    const doc = makeDoc(md);
    const results = extractTableClaims(doc, 'README.md', new Set(['express', 'react']));
    const depClaims = results.filter((r) => r.claim_type === 'dependency_version');
    expect(depClaims.length).toBeGreaterThanOrEqual(1);
  });

  it('skips decorative/non-data tables', () => {
    const md = `| Feature | Yes | No |
| --- | --- | --- |
| Auth | X | |
| DB | | X |`;
    const doc = makeDoc(md);
    const results = extractTableClaims(doc, 'README.md', new Set());
    // Decorative comparison tables should produce fewer claims
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for non-table content', () => {
    const md = 'No tables here, just regular text.';
    const doc = makeDoc(md);
    const results = extractTableClaims(doc, 'README.md', new Set());
    expect(results).toEqual([]);
  });

  it('detects separator row correctly', () => {
    const md = `| Name | Path |
|------|------|
| Config | config/settings.json |`;
    const doc = makeDoc(md);
    const results = extractTableClaims(doc, 'README.md', new Set());
    const pathClaims = results.filter((r) => r.claim_type === 'path_reference');
    expect(pathClaims.length).toBeGreaterThanOrEqual(1);
  });
});
