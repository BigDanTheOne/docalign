import { describe, it, expect } from 'vitest';
import { writeTags, writeSkipTags } from '../../src/tags/writer';
import { parseTags } from '../../src/tags/parser';
import type { TaggableClaim, SkipRegion } from '../../src/tags/writer';

describe('writeTags', () => {
  it('returns unchanged content with no claims', () => {
    const content = '# Hello\nWorld\n';
    const result = writeTags(content, []);
    expect(result.content).toBe(content);
    expect(result.tagsWritten).toBe(0);
    expect(result.tagsUpdated).toBe(0);
    expect(result.tagsPreserved).toBe(0);
  });

  it('writes new tags after source lines', () => {
    const content = '# Title\nSome path reference here.\nAnother line.';
    const claims: TaggableClaim[] = [
      { id: 'new-1', type: 'path_reference', status: 'verified', source_line: 2 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsWritten).toBe(1);
    expect(result.content).toContain('<!-- docalign:claim id="new-1" type="path_reference" status="verified" -->');
    // Tag should be after line 2
    const lines = result.content.split('\n');
    expect(lines[2]).toContain('docalign:claim');
  });

  it('updates existing tag with different status', () => {
    const content = [
      '# Title',
      '<!-- docalign:claim id="existing-1" type="path_reference" status="drifted" -->',
      'Some content.',
    ].join('\n');
    const claims: TaggableClaim[] = [
      { id: 'existing-1', type: 'path_reference', status: 'verified', source_line: 1 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsUpdated).toBe(1);
    expect(result.tagsWritten).toBe(0);
    expect(result.content).toContain('status="verified"');
    expect(result.content).not.toContain('status="drifted"');
  });

  it('preserves existing tag with same status', () => {
    const content = [
      '# Title',
      '<!-- docalign:claim id="same-1" type="command" status="verified" -->',
      'Some content.',
    ].join('\n');
    const claims: TaggableClaim[] = [
      { id: 'same-1', type: 'command', status: 'verified', source_line: 1 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsPreserved).toBe(1);
    expect(result.tagsUpdated).toBe(0);
    expect(result.tagsWritten).toBe(0);
  });

  it('is idempotent: writing same claims twice produces identical output', () => {
    const original = '# Test\nSome path reference here.';
    const claims: TaggableClaim[] = [
      { id: 'idem-1', type: 'path_reference', status: 'verified', source_line: 2 },
    ];
    const result1 = writeTags(original, claims);
    const result2 = writeTags(result1.content, claims);
    expect(result1.content).toBe(result2.content);
  });

  it('round-trip: parse -> write -> parse = identity', () => {
    const docWithTags = [
      '# Test Doc',
      '<!-- docalign:claim id="rt-1" type="path_reference" status="verified" -->',
      'Some content',
      '<!-- docalign:claim id="rt-2" type="command" status="drifted" -->',
    ].join('\n');
    const tags1 = parseTags(docWithTags);
    const claims = tags1.map(t => ({
      id: t.id,
      type: t.type,
      status: t.status,
      source_line: t.line,
    }));
    const result = writeTags(docWithTags, claims);
    const tags2 = parseTags(result.content);
    expect(tags1.length).toBe(tags2.length);
    for (let i = 0; i < tags1.length; i++) {
      expect(tags1[i].id).toBe(tags2[i].id);
      expect(tags1[i].type).toBe(tags2[i].type);
      expect(tags1[i].status).toBe(tags2[i].status);
    }
  });

  it('handles adversarial markdown: tables', () => {
    const content = [
      '| Column | Data |',
      '| ------ | ---- |',
      '| `src/file.ts` | exists |',
    ].join('\n');
    const claims: TaggableClaim[] = [
      { id: 'table-1', type: 'path_reference', status: 'verified', source_line: 3 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsWritten).toBe(1);
    // Table content should be preserved
    expect(result.content).toContain('| Column | Data |');
  });

  it('handles adversarial markdown: nested code blocks', () => {
    const content = [
      '```typescript',
      'const x = "hello";',
      '```',
      'After code block.',
    ].join('\n');
    const claims: TaggableClaim[] = [
      { id: 'code-1', type: 'code_example', status: 'verified', source_line: 4 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsWritten).toBe(1);
    expect(result.content).toContain('```typescript');
  });

  it('preserves unmatched existing tags', () => {
    const content = [
      '# Title',
      '<!-- docalign:claim id="unmatched-1" type="path_reference" status="verified" -->',
      'Content.',
    ].join('\n');
    const claims: TaggableClaim[] = [
      { id: 'new-tag', type: 'command', status: 'verified', source_line: 3 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsWritten).toBe(1);
    expect(result.tagsPreserved).toBe(1);
    expect(result.content).toContain('id="unmatched-1"');
    expect(result.content).toContain('id="new-tag"');
  });

  it('handles multiple new tags at different positions', () => {
    const content = '# Title\nLine 1\nLine 2\nLine 3';
    const claims: TaggableClaim[] = [
      { id: 'multi-1', type: 'path_reference', status: 'verified', source_line: 2 },
      { id: 'multi-2', type: 'command', status: 'drifted', source_line: 4 },
    ];
    const result = writeTags(content, claims);
    expect(result.tagsWritten).toBe(2);
    expect(result.content).toContain('id="multi-1"');
    expect(result.content).toContain('id="multi-2"');
  });
});

describe('writeSkipTags', () => {
  it('returns unchanged content with no skip regions', () => {
    const content = '# Hello\nWorld\n';
    const result = writeSkipTags(content, []);
    expect(result.content).toBe(content);
    expect(result.tagsWritten).toBe(0);
    expect(result.tagsPreserved).toBe(0);
  });

  it('wraps a region with skip block tags', () => {
    const content = '# Title\nLine 1\nLine 2\nLine 3\nLine 4';
    const regions: SkipRegion[] = [
      { start_line: 2, end_line: 3, reason: 'example_table', description: 'An example table' },
    ];
    const result = writeSkipTags(content, regions);
    expect(result.tagsWritten).toBe(1);
    const lines = result.content.split('\n');
    // Open tag before line 2 (now at index 1)
    expect(lines[1]).toContain('docalign:skip reason="example_table"');
    expect(lines[1]).toContain('description="An example table"');
    // Original line 2 is now at index 2
    expect(lines[2]).toBe('Line 1');
    // Original line 3 is at index 3
    expect(lines[3]).toBe('Line 2');
    // Close tag after original line 3 (now at index 4)
    expect(lines[4]).toBe('<!-- /docalign:skip -->');
    // Original line 4 is preserved after close tag
    expect(lines[5]).toBe('Line 3');
  });

  it('is idempotent: wrapping an already-tagged region does nothing', () => {
    const content = [
      '# Title',
      '<!-- docalign:skip reason="example_table" -->',
      'Example content',
      '<!-- /docalign:skip -->',
      'After.',
    ].join('\n');
    const regions: SkipRegion[] = [
      { start_line: 2, end_line: 4, reason: 'example_table' },
    ];
    const result = writeSkipTags(content, regions);
    expect(result.tagsWritten).toBe(0);
    expect(result.tagsPreserved).toBe(1);
    expect(result.content).toBe(content);
  });

  it('handles multiple non-overlapping regions (bottom-to-top)', () => {
    const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6';
    const regions: SkipRegion[] = [
      { start_line: 2, end_line: 2, reason: 'sample_output' },
      { start_line: 5, end_line: 6, reason: 'example_table' },
    ];
    const result = writeSkipTags(content, regions);
    expect(result.tagsWritten).toBe(2);
    // Both regions should be tagged
    expect(result.content).toContain('reason="sample_output"');
    expect(result.content).toContain('reason="example_table"');
    // Original content is preserved
    expect(result.content).toContain('Line 1');
    expect(result.content).toContain('Line 6');
  });

  it('omits description attribute when not provided', () => {
    const content = '# Title\nSome content\nEnd';
    const regions: SkipRegion[] = [
      { start_line: 2, end_line: 2, reason: 'user_instruction' },
    ];
    const result = writeSkipTags(content, regions);
    const openTag = result.content.split('\n').find((l) => l.includes('docalign:skip'));
    expect(openTag).toBeDefined();
    expect(openTag).not.toContain('description=');
  });
});
