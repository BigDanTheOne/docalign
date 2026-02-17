import { describe, it, expect } from 'vitest';
import { parseTags, parseTag } from '../../src/tags/parser';

describe('parseTag', () => {
  it('parses a valid tag with all fields', () => {
    const line = '<!-- docalign:claim id="abc-123" type="path_reference" status="verified" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.id).toBe('abc-123');
    expect(tag!.type).toBe('path_reference');
    expect(tag!.status).toBe('verified');
  });

  it('parses a tag with leading whitespace', () => {
    const line = '  <!-- docalign:claim id="x-1" type="command" status="drifted" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.id).toBe('x-1');
    expect(tag!.type).toBe('command');
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
    const result = parseTag('<!-- docalign:claim type="path_reference" status="verified" -->');
    expect(result).toBeNull();
  });

  it('returns null for tag missing type', () => {
    const result = parseTag('<!-- docalign:claim id="abc-123" status="verified" -->');
    expect(result).toBeNull();
  });

  it('defaults status to pending when missing', () => {
    const tag = parseTag('<!-- docalign:claim id="abc-123" type="path_reference" -->');
    expect(tag).not.toBeNull();
    expect(tag!.status).toBe('pending');
  });

  it('uses provided line number', () => {
    const tag = parseTag('<!-- docalign:claim id="x" type="command" status="verified" -->', 42);
    expect(tag).not.toBeNull();
    expect(tag!.line).toBe(42);
  });

  it('preserves raw line', () => {
    const line = '<!-- docalign:claim id="raw-test" type="config" status="drifted" -->';
    const tag = parseTag(line);
    expect(tag).not.toBeNull();
    expect(tag!.raw).toBe(line);
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
    const doc = '<!-- docalign:claim id="single" type="path_reference" status="verified" -->';
    const tags = parseTags(doc);
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe('single');
    expect(tags[0].line).toBe(1);
  });

  it('parses multiple tags in mixed content', () => {
    const doc = [
      '# My Document',
      '',
      'Some content here.',
      '<!-- docalign:claim id="claim-1" type="path_reference" status="verified" -->',
      '',
      'More content.',
      '<!-- docalign:claim id="claim-2" type="dependency_version" status="drifted" -->',
      '',
      'End of doc.',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe('claim-1');
    expect(tags[0].line).toBe(4);
    expect(tags[1].id).toBe('claim-2');
    expect(tags[1].line).toBe(7);
  });

  it('skips malformed tags and parses valid ones', () => {
    const doc = [
      '<!-- docalign:claim id="valid" type="command" status="verified" -->',
      '<!-- docalign:claim type="command" status="verified" -->', // missing id
      '<!-- docalign:claim id="also-valid" type="path_reference" status="drifted" -->',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe('valid');
    expect(tags[1].id).toBe('also-valid');
  });

  it('handles unicode content around tags', () => {
    const doc = [
      '# Documentation \u{1F4DA}',
      '<!-- docalign:claim id="unicode-test" type="path_reference" status="verified" -->',
      'Content with \u00E9m\u00F8j\u00EFs and speci\u00E4l chars.',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe('unicode-test');
  });

  it('handles adjacent tags on consecutive lines', () => {
    const doc = [
      '<!-- docalign:claim id="a" type="path_reference" status="verified" -->',
      '<!-- docalign:claim id="b" type="command" status="drifted" -->',
      '<!-- docalign:claim id="c" type="dependency_version" status="uncertain" -->',
    ].join('\n');
    const tags = parseTags(doc);
    expect(tags).toHaveLength(3);
    expect(tags[0].id).toBe('a');
    expect(tags[1].id).toBe('b');
    expect(tags[2].id).toBe('c');
  });
});
