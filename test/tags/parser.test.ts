import { describe, it, expect } from 'vitest';
import { parseTags, parseTag } from '../../src/tags/parser';

describe('parseTag', () => {
  it('parses a valid tag with id and status', () => {
    const line = '<!-- docalign:semantic id="sem-a3f291bc7e041d82" status="verified" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.id).toBe('sem-a3f291bc7e041d82');
    expect(tag!.status).toBe('verified');
  });

  it('parses a tag with id only (no status — freshly written)', () => {
    const line = '<!-- docalign:semantic id="sem-a3f291bc7e041d82" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.id).toBe('sem-a3f291bc7e041d82');
    expect(tag!.status).toBeNull();
  });

  it('parses a tag with leading whitespace', () => {
    const line = '  <!-- docalign:semantic id="sem-x1y2z3a4b5c6d7e8" status="drifted" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.id).toBe('sem-x1y2z3a4b5c6d7e8');
    expect(tag!.status).toBe('drifted');
  });

  it('returns null for regular HTML comment', () => {
    const result = parseTag('<!-- This is a regular comment -->');
    expect(result).toBeNull();
  });

  it('returns null for plain text', () => {
    const result = parseTag('This is just regular text');
    expect(result).toBeNull();
  });

  it('returns null for tag missing id', () => {
    const result = parseTag('<!-- docalign:semantic status="verified" -->');
    expect(result).toBeNull();
  });

  it('returns null for old docalign:claim format', () => {
    const result = parseTag('<!-- docalign:claim id="abc-123" type="path_reference" status="verified" -->');
    expect(result).toBeNull();
  });

  it('status is null when missing', () => {
    const tag = parseTag('<!-- docalign:semantic id="sem-0011223344556677" -->');
    expect(tag).not.toBeNull();
    expect(tag!.status).toBeNull();
  });

  it('uses provided line number', () => {
    const tag = parseTag('<!-- docalign:semantic id="sem-aabbccddeeff0011" status="verified" -->', 42);
    expect(tag).not.toBeNull();
    expect(tag!.line).toBe(42);
  });

  it('preserves raw line', () => {
    const line = '<!-- docalign:semantic id="sem-aabbccddeeff0011" status="drifted" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.raw).toBe(line);
  });

  it('parses status="uncertain"', () => {
    const tag = parseTag('<!-- docalign:semantic id="sem-aabbccddeeff0011" status="uncertain" -->');
    expect(tag).not.toBeNull();
    expect(tag!.status).toBe('uncertain');
  });
});

describe('parseTags', () => {
  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('returns empty array for document with no tags', () => {
    const doc = '# Hello\n\nSome content here.\n';
    expect(parseTags(doc)).toEqual([]);
  });

  it('parses single tag', () => {
    const doc = '<!-- docalign:semantic id="sem-aabb0011aabb0011" status="verified" -->';
    const tags = parseTags(doc);
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe('sem-aabb0011aabb0011');
    expect(tags[0].line).toBe(1);
  });

  it('parses single tag without status', () => {
    const doc = '<!-- docalign:semantic id="sem-aabb0011aabb0011" -->';
    const tags = parseTags(doc);
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe('sem-aabb0011aabb0011');
    expect(tags[0].status).toBeNull();
  });

  it('parses multiple tags in mixed content', () => {
    const doc = [
      '# My Document',
      '',
      '<!-- docalign:semantic id="sem-claim00000001" -->',
      'The authentication middleware validates JWT tokens.',
      '',
      'More content.',
      '<!-- docalign:semantic id="sem-claim00000002" status="verified" -->',
      'Default timeout is 30 seconds.',
      '',
      'End of doc.',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe('sem-claim00000001');
    expect(tags[0].line).toBe(3);
    expect(tags[0].status).toBeNull();
    expect(tags[1].id).toBe('sem-claim00000002');
    expect(tags[1].line).toBe(7);
    expect(tags[1].status).toBe('verified');
  });

  it('skips malformed tags and parses valid ones', () => {
    const doc = [
      '<!-- docalign:semantic id="sem-valid0000000001" status="verified" -->',
      '<!-- docalign:semantic status="verified" -->', // missing id
      '<!-- docalign:semantic id="sem-valid0000000002" status="drifted" -->',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe('sem-valid0000000001');
    expect(tags[1].id).toBe('sem-valid0000000002');
  });

  it('handles unicode content around tags', () => {
    const doc = [
      '# Documentation \u{1F4DA}',
      '<!-- docalign:semantic id="sem-aabb0011aabb0011" status="verified" -->',
      'Content with \u00E9m\u00F8j\u00EFs and speci\u00E4l chars.',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe('sem-aabb0011aabb0011');
  });

  it('handles adjacent tags on consecutive lines', () => {
    const doc = [
      '<!-- docalign:semantic id="sem-aaaa0000aaaa0001" status="verified" -->',
      '<!-- docalign:semantic id="sem-aaaa0000aaaa0002" status="drifted" -->',
      '<!-- docalign:semantic id="sem-aaaa0000aaaa0003" status="uncertain" -->',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(3);
    expect(tags[0].id).toBe('sem-aaaa0000aaaa0001');
    expect(tags[1].id).toBe('sem-aaaa0000aaaa0002');
    expect(tags[2].id).toBe('sem-aaaa0000aaaa0003');
  });
});
