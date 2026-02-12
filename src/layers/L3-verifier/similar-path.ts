import type { CodebaseIndexService } from '../L0-codebase-index';

export interface SimilarPathResult {
  path: string;
  distance: number;
  match_type: 'basename' | 'full_path';
}

/**
 * Find files with similar paths using Levenshtein distance.
 * TDD-3 Appendix C.
 */
export async function findSimilarPaths(
  repoId: string,
  targetPath: string,
  index: CodebaseIndexService,
  maxResults: number,
): Promise<SimilarPathResult[]> {
  const fileTree = await index.getFileTree(repoId);
  const targetBasename = basename(targetPath);
  const results: SimilarPathResult[] = [];

  // Pass 1: Basename Levenshtein (threshold <= 2)
  for (const filePath of fileTree) {
    const fileBasename = basename(filePath);
    const distance = levenshtein(targetBasename, fileBasename);
    if (distance > 0 && distance <= 2) {
      results.push({ path: filePath, distance, match_type: 'basename' });
    }
  }

  // Pass 2: Full path Levenshtein (threshold <= 3) — only if Pass 1 found nothing
  if (results.length === 0) {
    for (const filePath of fileTree) {
      const distance = levenshtein(targetPath, filePath);
      if (distance > 0 && distance <= 3) {
        results.push({ path: filePath, distance, match_type: 'full_path' });
      }
    }
  }

  // Sort by distance ascending, then alphabetically
  results.sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path));

  return results.slice(0, maxResults);
}

function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
}

/**
 * Levenshtein edit distance.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}
