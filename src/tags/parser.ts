/**
 * Tag parser for inline DocAlign claim tags in markdown documents.
 *
 * Tag syntax: <!-- docalign:claim id="<uuid>" type="<claim_type>" status="<status>" -->
 *
 * Tags are HTML comments, invisible in rendered markdown.
 */

import type { ClaimType } from '../shared/types';

export interface DocTag {
  /** UUID of the tagged claim. */
  id: string;
  /** Claim type (path_reference, dependency_version, etc.). */
  type: ClaimType;
  /** Last known verification status. */
  status: string;
  /** 1-based line number in the source document. */
  line: number;
  /** Original raw tag string for round-trip preservation. */
  raw: string;
}

/**
 * Regex to match a docalign claim tag.
 * Captures the inner content between `docalign:claim` and `-->`.
 */
const TAG_PATTERN = /^(\s*)<!--\s*docalign:claim\s+(.*?)\s*-->\s*$/;

/**
 * Parse key="value" pairs from tag content.
 */
function parseKeyValues(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const kvPattern = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = kvPattern.exec(content)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

/**
 * Parse a single line for a docalign tag.
 * Returns a DocTag if the line contains a valid tag, or null otherwise.
 */
export function parseTag(line: string, lineNumber = 1): DocTag | null {
  const match = line.match(TAG_PATTERN);
  if (!match) return null;

  const kvContent = match[2];
  const kv = parseKeyValues(kvContent);

  // Require at minimum id and type
  if (!kv.id || !kv.type) return null;

  return {
    id: kv.id,
    type: kv.type as ClaimType,
    status: kv.status || 'pending',
    line: lineNumber,
    raw: line,
  };
}

/**
 * Parse all docalign tags from a document string.
 * Returns an array of DocTag objects for all valid tags found.
 * Malformed tags (missing required fields) are silently skipped.
 */
export function parseTags(content: string): DocTag[] {
  if (!content) return [];

  const lines = content.split('\n');
  const tags: DocTag[] = [];

  for (let i = 0; i < lines.length; i++) {
    const tag = parseTag(lines[i], i + 1); // 1-based line numbers
    if (tag) {
      tags.push(tag);
    }
  }

  return tags;
}
