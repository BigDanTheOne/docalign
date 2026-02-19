/**
 * Tag writer for inline DocAlign claim tags in markdown documents.
 *
 * Writes tags as HTML comments after the claim's source line.
 * Idempotent: running the writer twice produces identical output.
 * Atomic file writes via temp file + rename.
 */

import fs from 'fs';
import { parseTags } from './parser';

// ============================================================
// Skip region tags
// ============================================================

/** A region to wrap with <!-- docalign:skip --> block tags. */
export interface SkipRegion {
  /** 1-based line number of the first line in the region (inclusive). */
  start_line: number;
  /** 1-based line number of the last line in the region (inclusive). */
  end_line: number;
  /** Short machine-readable reason: e.g. "example_table", "sample_output". */
  reason: string;
  /** Human-readable description of why the region is skipped. */
  description?: string;
}

export interface SkipWriteResult {
  /** Updated document content. */
  content: string;
  /** Number of new skip-tag pairs inserted. */
  tagsWritten: number;
  /** Number of regions already tagged (preserved). */
  tagsPreserved: number;
}

const CLOSE_SKIP_TAG = '<!-- /docalign:skip -->';
const SKIP_OPEN_RE = /^\s*<!--\s*docalign:skip\b/;
const SKIP_CLOSE_RE = /^\s*<!--\s*\/docalign:skip\s*-->\s*$/;

function formatSkipOpenTag(region: SkipRegion): string {
  const parts: string[] = [`<!-- docalign:skip reason="${region.reason}"`];
  if (region.description) parts.push(`description="${region.description}"`);
  parts.push('-->');
  return parts.join(' ');
}

/**
 * Strip all docalign:skip block tags from a content string.
 * Returns the cleaned content (no skip open/close tags).
 * Use this before sending content to Claude so line numbers are always
 * relative to clean (untagged) content.
 */
export function stripSkipTags(content: string): string {
  const lines = content.split('\n');
  stripExistingSkipTags(lines);
  return lines.join('\n');
}

/**
 * Blank out content inside docalign:skip regions, preserving line count.
 *
 * The tag lines themselves are kept (they're HTML comments, harmless to
 * syntactic extractors). The content between open and close tags is replaced
 * with empty strings so that regex-based L1 extractors do not pick up
 * illustrative/template code from skip-tagged blocks.
 *
 * Use this before running L1 syntactic extraction on a file that already
 * has skip tags written to it.
 */
export function blankSkipRegionContent(content: string): string {
  const lines = content.split('\n');
  let inSkip = false;
  const result = lines.map((line) => {
    if (SKIP_OPEN_RE.test(line)) {
      inSkip = true;
      return line; // Keep the opening tag
    }
    if (SKIP_CLOSE_RE.test(line)) {
      inSkip = false;
      return line; // Keep the closing tag
    }
    return inSkip ? '' : line; // Blank content inside skip regions
  });
  return result.join('\n');
}

const SEMANTIC_TAG_RE = /^\s*<!--\s*docalign:semantic\b/;

/**
 * Blank out lines immediately following docalign:semantic tag lines, preserving line count.
 *
 * The claim text line that follows each semantic tag is replaced with an empty string so that
 * L1 regex extractors do not double-extract semantic (non-deterministic) claims.
 * Tag lines themselves are kept unchanged.
 *
 * Use this after blankSkipRegionContent(), before running L1 syntactic extraction.
 */
export function blankSemanticClaimLines(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipNext = false;
  for (const line of lines) {
    if (skipNext) {
      result.push('');
      skipNext = false;
    } else {
      result.push(line);
      if (SEMANTIC_TAG_RE.test(line)) {
        skipNext = true;
      }
    }
  }
  return result.join('\n');
}

/**
 * Remove all existing docalign:skip block tags from a line array (in-place).
 * Returns the number of tag pairs removed.
 */
function stripExistingSkipTags(lines: string[]): number {
  let removed = 0;
  let i = 0;
  while (i < lines.length) {
    if (SKIP_OPEN_RE.test(lines[i]) || SKIP_CLOSE_RE.test(lines[i])) {
      lines.splice(i, 1);
      removed++;
    } else {
      i++;
    }
  }
  return removed;
}

/**
 * Wrap skip regions with <!-- docalign:skip --> block tags.
 *
 * Replaces any existing skip tags before inserting — this handles force
 * re-extraction where line numbers would have shifted from the previous write.
 * Insertions are applied bottom-to-top so indices stay stable.
 */
export function writeSkipTags(content: string, skipRegions: SkipRegion[]): SkipWriteResult {
  if (skipRegions.length === 0) {
    return { content, tagsWritten: 0, tagsPreserved: 0 };
  }

  const lines = content.split('\n');

  // Strip any existing skip tags so we rewrite from clean line numbers.
  // This avoids duplicate/malformed tags when extract is re-run (--force).
  stripExistingSkipTags(lines);

  let tagsWritten = 0;
  const tagsPreserved = 0;

  // Sort descending so we can splice bottom-to-top without shifting earlier indices
  const sorted = [...skipRegions].sort((a, b) => b.start_line - a.start_line);

  for (const region of sorted) {
    // Clamp to document bounds
    const endIdx = Math.min(region.end_line, lines.length); // splice position for close tag (after end_line)
    const startIdx = Math.max(region.start_line - 1, 0);   // splice position for open tag (before start_line)

    // Insert close tag first (higher index), then open tag (lower index)
    lines.splice(endIdx, 0, CLOSE_SKIP_TAG);
    lines.splice(startIdx, 0, formatSkipOpenTag(region));

    tagsWritten++;
  }

  return { content: lines.join('\n'), tagsWritten, tagsPreserved };
}

/**
 * Write skip tags to a file atomically.
 *
 * 1. Read file content
 * 2. Apply writeSkipTags
 * 3. Write to temp file (<path>.docalign-tmp)
 * 4. Rename temp to target
 * 5. On error: delete temp file, re-throw
 */
export async function writeSkipTagsToFile(
  filePath: string,
  skipRegions: SkipRegion[],
): Promise<SkipWriteResult> {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = writeSkipTags(content, skipRegions);

  if (result.tagsWritten === 0) {
    return result; // Nothing to write
  }

  const tmpPath = filePath + '.docalign-tmp';
  try {
    fs.writeFileSync(tmpPath, result.content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }

  return result;
}

export interface TaggableClaim {
  /** 16-char hex ID of the semantic claim. */
  id: string;
  /** Verification status (verified | drifted | uncertain). */
  status: string;
  /** 1-based line number of the tag itself in the document. */
  source_line: number;
}

export interface TagWriteResult {
  /** Updated document content. */
  content: string;
  /** Number of new tags added. */
  tagsWritten: number;
  /** Number of existing tags updated (status changed). */
  tagsUpdated: number;
  /** Number of existing tags left unchanged. */
  tagsPreserved: number;
}

/**
 * Format a claim as an inline semantic tag string.
 */
function formatTag(claim: TaggableClaim): string {
  return `<!-- docalign:semantic id="${claim.id}" status="${claim.status}" -->`;
}

/**
 * Write tags inline into a document string.
 *
 * For each claim:
 * - If a tag with the same ID already exists and has the same status: preserve (no-op).
 * - If a tag with the same ID exists but with a different status: update in-place.
 * - If no tag exists: insert a new tag after the claim's source line.
 *
 * Unmatched existing tags are preserved verbatim.
 */
export function writeTags(content: string, claims: TaggableClaim[]): TagWriteResult {
  if (claims.length === 0) {
    return { content, tagsWritten: 0, tagsUpdated: 0, tagsPreserved: 0 };
  }

  const existingTags = parseTags(content);
  const existingById = new Map(existingTags.map(t => [t.id, t]));
  const lines = content.split('\n');

  let tagsWritten = 0;
  let tagsUpdated = 0;
  let tagsPreserved = 0;

  // Phase 1: Update existing tags in-place
  const processedIds = new Set<string>();
  for (const claim of claims) {
    const existing = existingById.get(claim.id);
    if (existing) {
      processedIds.add(claim.id);
      if (existing.status === claim.status) {
        // Status unchanged, preserve
        tagsPreserved++;
      } else {
        // Status changed, update the line in-place
        const lineIdx = existing.line - 1; // Convert to 0-based
        lines[lineIdx] = formatTag(claim);
        tagsUpdated++;
      }
    }
  }

  // Count existing tags not in claims as preserved
  for (const tag of existingTags) {
    if (!processedIds.has(tag.id)) {
      tagsPreserved++;
    }
  }

  // Phase 2: Insert new tags (claims without existing tags)
  // Collect insertions as (afterLineIdx, tagString) pairs, then apply from bottom to top
  const insertions: Array<{ afterLine: number; tag: string }> = [];
  for (const claim of claims) {
    if (!existingById.has(claim.id)) {
      insertions.push({
        afterLine: claim.source_line - 1, // Convert to 0-based
        tag: formatTag(claim),
      });
      tagsWritten++;
    }
  }

  // Sort insertions by line descending so indices don't shift
  insertions.sort((a, b) => b.afterLine - a.afterLine);

  for (const ins of insertions) {
    const idx = Math.min(ins.afterLine, lines.length - 1);
    lines.splice(idx + 1, 0, ins.tag);
  }

  return {
    content: lines.join('\n'),
    tagsWritten,
    tagsUpdated,
    tagsPreserved,
  };
}

/**
 * Write tags to a file atomically.
 *
 * 1. Read file content
 * 2. Apply writeTags
 * 3. Write to temp file (<path>.docalign-tmp)
 * 4. Rename temp to target
 * 5. On error: delete temp file, re-throw
 */
export async function writeTagsToFile(
  filePath: string,
  claims: TaggableClaim[],
): Promise<TagWriteResult> {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = writeTags(content, claims);

  const tmpPath = filePath + '.docalign-tmp';
  try {
    fs.writeFileSync(tmpPath, result.content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Cleanup temp file on error
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }

  return result;
}
