/**
 * Semantic extraction prompt — public API.
 *
 * Logic lives here; all prompt text lives in semantic-extract-prompt.ts.
 * To tune what Claude extracts or how it structures evidence, edit
 * semantic-extract-prompt.ts — no TypeScript changes needed.
 */

import type { DocMapEntry } from '../doc-map';
import {
  SEMANTIC_EXTRACT_SYSTEM_PROMPT,
  buildSemanticExtractUserPrompt,
  buildDocContextBlock,
} from './semantic-extract-prompt';

export { SEMANTIC_EXTRACT_SYSTEM_PROMPT };

/**
 * Build the extraction prompt for one doc file's changed sections.
 *
 * @param sectionText - Pre-formatted section content (heading + lines + body)
 * @param repoPath - Absolute path to the repository root
 * @param docContext - Optional doc-map entry for this file (from Step 0)
 */
export function buildSemanticExtractPrompt(
  sectionText: string,
  repoPath: string,
  docContext?: DocMapEntry,
): string {
  return buildSemanticExtractUserPrompt({
    repoPath,
    contextBlock: docContext ? buildDocContextBlock(docContext) : '',
    sectionText,
  });
}
