import type { FileChange } from '../../shared/types';

/** Document file extensions */
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);

export interface ClassifiedFiles {
  code_files: FileChange[];
  doc_files: FileChange[];
  renames: FileChange[];
  deletions: FileChange[];
}

/**
 * Classify changed files into code, doc, renames, and deletions.
 * TDD-4 Section 4.7 step 3.
 */
export function classifyFiles(
  changes: FileChange[],
  excludePatterns: string[] = [],
): ClassifiedFiles {
  const code_files: FileChange[] = [];
  const doc_files: FileChange[] = [];
  const renames: FileChange[] = [];
  const deletions: FileChange[] = [];

  for (const change of changes) {
    // Track renames separately
    if (change.status === 'renamed') {
      renames.push(change);
    }

    // Track deletions separately
    if (change.status === 'removed') {
      deletions.push(change);
    }

    // Skip deleted files from code/doc classification
    if (change.status === 'removed') continue;

    // Check if file matches exclude patterns
    if (excludePatterns.some((p) => matchPattern(change.filename, p))) {
      continue;
    }

    const ext = getExtension(change.filename);
    if (DOC_EXTENSIONS.has(ext)) {
      doc_files.push(change);
    } else {
      code_files.push(change);
    }
  }

  return { code_files, doc_files, renames, deletions };
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

function matchPattern(filename: string, pattern: string): boolean {
  // Simple glob matching: * matches any chars, ** matches any path
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  try {
    return new RegExp(`^${regexStr}$`).test(filename);
  } catch {
    return false;
  }
}

/**
 * Check if a file is a document file by extension.
 */
export function isDocFile(filename: string): boolean {
  return DOC_EXTENSIONS.has(getExtension(filename));
}
