import { describe, it, expect } from 'vitest';
import { sanitizeForMarkdown, sanitizeForCodeBlock } from '../../../src/layers/L5-reporter/sanitize';

describe('sanitizeForMarkdown', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeForMarkdown(null)).toBe('');
    expect(sanitizeForMarkdown(undefined)).toBe('');
    expect(sanitizeForMarkdown('')).toBe('');
  });

  it('passes through safe text', () => {
    expect(sanitizeForMarkdown('Hello world')).toBe('Hello world');
    expect(sanitizeForMarkdown('Uses **express** 4.x')).toBe('Uses **express** 4.x');
  });

  // XSS injection
  it('removes javascript: protocol', () => {
    expect(sanitizeForMarkdown('click [here](javascript:alert(1))')).toBe('click [here](alert(1))');
  });

  it('removes data: protocol', () => {
    expect(sanitizeForMarkdown('![img](data:image/svg+xml,...)')).toBe('![img](image/svg+xml,...)');
  });

  it('removes vbscript: protocol', () => {
    expect(sanitizeForMarkdown('vbscript:MsgBox')).toBe('MsgBox');
  });

  it('removes JavaScript: (case insensitive)', () => {
    expect(sanitizeForMarkdown('JavaScript:alert(1)')).toBe('alert(1)');
  });

  // HTML injection
  it('escapes <script tags', () => {
    expect(sanitizeForMarkdown('<script>alert(1)</script>')).toBe('&lt;script>alert(1)&lt;/script&gt;');
  });

  it('escapes <iframe tags', () => {
    expect(sanitizeForMarkdown('<iframe src="evil">')).toBe('&lt;iframe src="evil">');
  });

  it('escapes <object tags', () => {
    expect(sanitizeForMarkdown('<object data="evil">')).toBe('&lt;object data="evil">');
  });

  it('escapes <embed tags', () => {
    expect(sanitizeForMarkdown('<embed src="evil">')).toBe('&lt;embed src="evil">');
  });

  it('escapes <form tags', () => {
    expect(sanitizeForMarkdown('<form action="evil">')).toBe('&lt;form action="evil">');
  });

  // Marker injection
  it('escapes HTML comments (<!-- -->)', () => {
    expect(sanitizeForMarkdown('<!-- docalign-summary -->')).toBe('&lt;!-- docalign-summary --&gt;');
  });

  // Truncation
  it('truncates text longer than 5000 chars', () => {
    const longText = 'A'.repeat(6000);
    const result = sanitizeForMarkdown(longText);
    expect(result.length).toBe(5000);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not truncate text under 5000 chars', () => {
    const text = 'A'.repeat(4999);
    expect(sanitizeForMarkdown(text)).toBe(text);
  });

  // Combined
  it('handles multiple injection types in one string', () => {
    const input = '<script>javascript:alert(1)</script> <!-- marker -->';
    const result = sanitizeForMarkdown(input);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('<!--');
  });
});

describe('sanitizeForCodeBlock', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeForCodeBlock(null)).toBe('');
    expect(sanitizeForCodeBlock(undefined)).toBe('');
    expect(sanitizeForCodeBlock('')).toBe('');
  });

  it('passes through safe code', () => {
    expect(sanitizeForCodeBlock('function hello() {}')).toBe('function hello() {}');
  });

  it('prevents code block closure with triple backticks', () => {
    const input = 'code ```injected``` more';
    const result = sanitizeForCodeBlock(input);
    expect(result).not.toContain('```');
    expect(result).toContain('` ` `');
  });

  it('truncates at 2000 chars', () => {
    const longCode = 'x'.repeat(3000);
    const result = sanitizeForCodeBlock(longCode);
    expect(result.length).toBe(2000);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not truncate code under 2000 chars', () => {
    const code = 'x'.repeat(1999);
    expect(sanitizeForCodeBlock(code)).toBe(code);
  });
});
