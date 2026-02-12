/**
 * `docalign fix [file]` — Apply fixes from prior scan.
 *
 * Implements: phase4c-ux-specs.md Section 6.4
 * Gates: GATE42-030 (CLI fix in MVP)
 * Security: path traversal protection per phase3-security.md
 */

import fs from 'fs';
import path from 'path';
import type { CliPipeline, DocFix } from '../local-pipeline';
import { formatFixResults, color } from '../output';

/**
 * Validate that a file path is safe to write (no path traversal, within repo root).
 * Returns the resolved absolute path or null if rejected.
 */
export function validateLocalPath(filePath: string, repoRoot: string): string | null {
  if (!filePath || filePath.includes('\0')) return null;
  if (path.isAbsolute(filePath)) return null;
  if (filePath.includes('..')) return null;

  const resolved = path.resolve(repoRoot, filePath);

  // Ensure resolved path is within repo root
  const normalizedRoot = path.resolve(repoRoot) + path.sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(repoRoot)) {
    return null;
  }

  return resolved;
}

export async function runFix(
  pipeline: CliPipeline,
  targetFile: string | undefined,
  repoRoot: string = process.cwd(),
  write: (msg: string) => void = console.log,
): Promise<number> {
  try {
    const fixes = await pipeline.getStoredFixes(targetFile);

    if (fixes.length === 0) {
      if (targetFile) {
        write(`DocAlign: No fixes available for ${color.cyan(targetFile)}. All claims are verified.`);
      } else {
        write('No scan results found. Run `docalign check <file>` or `docalign scan` first.');
      }
      return 1;
    }

    const applied: Array<{ file: string; line: number; description: string }> = [];
    const failed: Array<{ file: string; line: number; reason: string }> = [];
    const modifiedFileSet = new Set<string>();

    // Group fixes by file
    const fixesByFile = new Map<string, DocFix[]>();
    for (const fix of fixes) {
      if (!fixesByFile.has(fix.file)) {
        fixesByFile.set(fix.file, []);
      }
      fixesByFile.get(fix.file)!.push(fix);
    }

    for (const [filePath, fileFixes] of fixesByFile) {
      // Validate path safety
      const resolvedPath = validateLocalPath(filePath, repoRoot);
      if (!resolvedPath) {
        for (const fix of fileFixes) {
          failed.push({
            file: filePath,
            line: fix.line_start,
            reason: 'Rejected: path traversal or absolute path',
          });
        }
        continue;
      }

      // Read current file content
      let content: string;
      try {
        content = fs.readFileSync(resolvedPath, 'utf-8');
      } catch {
        for (const fix of fileFixes) {
          failed.push({
            file: filePath,
            line: fix.line_start,
            reason: 'File not found',
          });
        }
        continue;
      }

      // Apply fixes sequentially
      let modified = false;
      for (const fix of fileFixes) {
        if (!content.includes(fix.old_text)) {
          failed.push({
            file: filePath,
            line: fix.line_start,
            reason: 'Target text has changed since the scan. Run `docalign check` to rescan.',
          });
          continue;
        }

        // Use replacer function for $-pattern safety
        content = content.replace(fix.old_text, () => fix.new_text);
        applied.push({
          file: filePath,
          line: fix.line_start,
          description: fix.reason,
        });
        modified = true;
      }

      // Write modified file
      if (modified) {
        fs.writeFileSync(resolvedPath, content, 'utf-8');
        modifiedFileSet.add(filePath);
      }
    }

    const filesModified = Array.from(modifiedFileSet);

    if (applied.length === 0 && failed.length === 0) {
      write('No scan results found. Run `docalign check <file>` or `docalign scan` first.');
      return 1;
    }

    const output = formatFixResults(applied, failed, filesModified, targetFile);
    write(output);

    if (applied.length > 0) return 0;
    return 2; // all fixes failed
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write(`Error: ${message}`);
    return 2;
  }
}
