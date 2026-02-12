import type { DocFix } from '../../shared/types';
import { validateFixPath } from './path-validation';

export interface FixApplicationResult {
  applied: AppliedFix[];
  failed: FailedFix[];
}

export interface AppliedFix {
  file: string;
  line_start: number;
  claim_id: string;
}

export interface FailedFix {
  file: string;
  line_start: number;
  claim_id: string;
  reason: string;
}

/**
 * Apply fixes to file contents in-memory.
 *
 * Multiple fixes to the same file are applied sequentially.
 * Uses replacer function for $-pattern safety (GATE42-023).
 *
 * @param fixes - The fixes to apply
 * @param getFileContent - Callback to fetch current file content
 * @returns Applied and failed fixes, plus the modified file contents
 */
export async function applyFixes(
  fixes: DocFix[],
  getFileContent: (filePath: string) => Promise<string | null>,
): Promise<{ result: FixApplicationResult; modifiedFiles: Map<string, string> }> {
  const applied: AppliedFix[] = [];
  const failed: FailedFix[] = [];
  const modifiedFiles = new Map<string, string>();

  // Group fixes by file for sequential in-memory application
  const fixesByFile = new Map<string, DocFix[]>();
  for (const fix of fixes) {
    const safePath = validateFixPath(fix.file);
    if (!safePath) {
      failed.push({
        file: fix.file,
        line_start: fix.line_start,
        claim_id: fix.claim_id,
        reason: 'Invalid file path (path traversal or absolute path)',
      });
      continue;
    }

    if (!fixesByFile.has(safePath)) {
      fixesByFile.set(safePath, []);
    }
    fixesByFile.get(safePath)!.push({ ...fix, file: safePath });
  }

  for (const [filePath, fileFixes] of fixesByFile) {
    // Get current content (from modified map if already modified, else from source)
    let content = modifiedFiles.get(filePath);
    if (content === undefined) {
      const fetched = await getFileContent(filePath);
      if (fetched === null) {
        for (const fix of fileFixes) {
          failed.push({
            file: filePath,
            line_start: fix.line_start,
            claim_id: fix.claim_id,
            reason: 'File not found in repository',
          });
        }
        continue;
      }
      content = fetched;
    }

    // Apply each fix sequentially
    for (const fix of fileFixes) {
      if (!content.includes(fix.old_text)) {
        failed.push({
          file: filePath,
          line_start: fix.line_start,
          claim_id: fix.claim_id,
          reason: 'old_text not found in current file content',
        });
        continue;
      }

      // CRITICAL: Use replacer function to prevent $-pattern injection
      // String.replace(search, replacement) interprets $1, $&, $$, $' in replacement.
      // Using a replacer function avoids this.
      content = content.replace(fix.old_text, () => fix.new_text);
      applied.push({
        file: filePath,
        line_start: fix.line_start,
        claim_id: fix.claim_id,
      });
    }

    if (applied.some((a) => a.file === filePath)) {
      modifiedFiles.set(filePath, content);
    }
  }

  return { result: { applied, failed }, modifiedFiles };
}
