/**
 * Tag parser for inline DocAlign semantic tags in markdown documents.
 *
 * Tag syntax: <!-- docalign:semantic id="<16-char-hex>" -->
 * After verification: <!-- docalign:semantic id="<16-char-hex>" status="verified|drifted|uncertain" -->
 *
 * Tags are HTML comments, invisible in rendered markdown.
 */

export interface DocTag {
  /** 16-char hex ID of the tagged semantic claim. */
  id: string;
  /** Last known verification status. Null if not yet verified. */
  status: string | null;
  /** 1-based line number in the source document. */
  line: number;
  /** Original raw tag string for round-trip preservation. */
  raw: string;
}

/**
 * Regex to match a docalign semantic tag.
 * Captures the inner content between `docalign:semantic` and `-->`.
 */
const TAG_PATTERN = /^(\s*)<!--\s*docalign:semantic\s+(.*?)\s*-->\s*$/;

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
 * Parse a single line for a docalign semantic tag.
 * Returns a DocTag if the line contains a valid tag, or null otherwise.
 */
export function parseTag(line: string, lineNumber = 1): DocTag | null {
  const match = line.match(TAG_PATTERN);
  if (!match) return null;

  const kvContent = match[2];
  const kv = parseKeyValues(kvContent);

  // Require at minimum id
  if (!kv.id) return null;

  return {
    id: kv.id,
    status: kv.status ?? null,
    line: lineNumber,
    raw: line,
  };
}

/**
 * Parse all docalign semantic tags from a document string.
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
