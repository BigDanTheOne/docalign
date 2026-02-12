/**
 * Sanitization utilities for PR comment output.
 * TDD-5 Section 4.5, Appendix E.
 *
 * Both functions are pure, synchronous, and never throw.
 */

const MAX_MARKDOWN_LENGTH = 5000;
const MAX_CODE_BLOCK_LENGTH = 2000;

// Dangerous protocol patterns
const PROTOCOL_PATTERNS = [
  /javascript:/gi,
  /data:/gi,
  /vbscript:/gi,
];

// HTML injection patterns
const HTML_PATTERNS: Array<[RegExp, string]> = [
  [/<script/gi, '&lt;script'],
  [/<\/script>/gi, '&lt;/script&gt;'],
  [/<iframe/gi, '&lt;iframe'],
  [/<object/gi, '&lt;object'],
  [/<embed/gi, '&lt;embed'],
  [/<form/gi, '&lt;form'],
];

// Marker injection patterns (prevent hidden HTML comments)
const MARKER_PATTERNS: Array<[RegExp, string]> = [
  [/<!--/g, '&lt;!--'],
  [/-->/g, '--&gt;'],
];

/**
 * Sanitize text for use in markdown context (PR comments, finding descriptions).
 * TDD-5 Section 4.5.
 *
 * Removes XSS vectors, escapes HTML injection, prevents marker injection.
 * Truncates to 5000 chars if too long.
 */
export function sanitizeForMarkdown(text: string | null | undefined): string {
  if (!text) return '';

  let result = text;

  // Remove dangerous protocols
  for (const pattern of PROTOCOL_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Escape HTML injection
  for (const [pattern, replacement] of HTML_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  // Escape marker injection
  for (const [pattern, replacement] of MARKER_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  // Truncate
  if (result.length > MAX_MARKDOWN_LENGTH) {
    result = result.slice(0, MAX_MARKDOWN_LENGTH - 3) + '...';
  }

  return result;
}

/**
 * Sanitize text for use inside markdown code blocks.
 * TDD-5 Section 4.5.
 *
 * Prevents premature code block closure by escaping triple backticks.
 * Truncates to 2000 chars if too long.
 */
export function sanitizeForCodeBlock(text: string | null | undefined): string {
  if (!text) return '';

  let result = text;

  // Prevent code block closure
  result = result.replace(/```/g, '` ` `');

  // Truncate
  if (result.length > MAX_CODE_BLOCK_LENGTH) {
    result = result.slice(0, MAX_CODE_BLOCK_LENGTH - 3) + '...';
  }

  return result;
}
