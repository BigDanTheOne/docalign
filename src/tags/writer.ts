/**
 * Tag writer for inline DocAlign claim tags in markdown documents.
 *
 * Writes tags as HTML comments after the claim's source line.
 * Idempotent: running the writer twice produces identical output.
 * Atomic file writes via temp file + rename.
 */

import fs from 'fs';
import path from 'path';
import type { ClaimType } from '../shared/types';
import { parseTags } from './parser';

export interface TaggableClaim {
  /** UUID of the claim. */
  id: string;
  /** Claim type. */
  type: ClaimType | string;
  /** Verification status. */
  status: string;
  /** 1-based line number of the claim's source line in the document. */
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
 * Format a claim as an inline tag string.
 */
function formatTag(claim: TaggableClaim): string {
  return `<!-- docalign:claim id="${claim.id}" type="${claim.type}" status="${claim.status}" -->`;
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
