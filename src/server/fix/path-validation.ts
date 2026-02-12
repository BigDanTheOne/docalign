import path from 'path';

/**
 * Validate that a file path is safe for fix application.
 * Rejects: absolute paths, path traversal (..), null bytes.
 *
 * Returns normalized path or null if invalid.
 */
export function validateFixPath(filePath: string): string | null {
  // Reject empty paths
  if (!filePath || filePath.trim() === '') return null;

  // Reject null bytes
  if (filePath.includes('\0')) return null;

  // Reject absolute paths
  if (path.isAbsolute(filePath)) return null;

  // Normalize and check for traversal
  const normalized = path.normalize(filePath);

  // Reject if normalization produces absolute path
  if (path.isAbsolute(normalized)) return null;

  // Reject if path escapes (starts with ..)
  if (normalized.startsWith('..')) return null;

  // Reject any remaining .. segments
  const segments = normalized.split(path.sep);
  if (segments.some((s) => s === '..')) return null;

  return normalized;
}
