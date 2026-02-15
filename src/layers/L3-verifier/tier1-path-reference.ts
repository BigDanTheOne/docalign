import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { findSimilarPaths } from './similar-path';
import { makeResult } from './result-helpers';

/**
 * Tier 1: Verify path_reference claims.
 * TDD-3 Appendix A.1.
 */
export async function verifyPathReference(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const path = claim.extracted_value.path as string;
  const anchor = claim.extracted_value.anchor as string | undefined;
  if (!path) return null;

  // Handle self-reference anchors (#heading in same doc)
  if (path === '<self>' && anchor) {
    const selfFile = claim.source_file;
    if (!selfFile) return null;
    const headings = await index.getHeadings(claim.repo_id, selfFile);
    const match = headings.find((h) => h.slug === anchor);
    if (match) {
      return makeResult(claim, {
        verdict: 'verified',
        evidence_files: [selfFile],
        reasoning: `Anchor '#${anchor}' matches heading '${match.text}' in '${selfFile}'.`,
      });
    }
    // Suggest closest heading
    const closest = headings.reduce<{ slug: string; dist: number } | null>((best, h) => {
      const dist = levenshteinDist(anchor, h.slug);
      return !best || dist < best.dist ? { slug: h.slug, dist } : best;
    }, null);
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: [selfFile],
      reasoning: `Anchor '#${anchor}' not found in '${selfFile}'.${closest && closest.dist <= 3 ? ` Did you mean '#${closest.slug}'?` : ''}`,
      specific_mismatch: `Anchor '#${anchor}' does not match any heading.`,
    });
  }

  // Step 1: Exact check
  const exists = await index.fileExists(claim.repo_id, path);
  if (exists) {
    // If there's an anchor, validate it against headings
    if (anchor) {
      const headings = await index.getHeadings(claim.repo_id, path);
      const match = headings.find((h) => h.slug === anchor);
      if (match) {
        return makeResult(claim, {
          verdict: 'verified',
          evidence_files: [path],
          reasoning: `File '${path}' exists and anchor '#${anchor}' matches heading '${match.text}'.`,
        });
      }
      const closest = headings.reduce<{ slug: string; dist: number } | null>((best, h) => {
        const dist = levenshteinDist(anchor, h.slug);
        return !best || dist < best.dist ? { slug: h.slug, dist } : best;
      }, null);
      return makeResult(claim, {
        verdict: 'drifted',
        severity: 'medium' as Severity,
        evidence_files: [path],
        reasoning: `File '${path}' exists but anchor '#${anchor}' not found.${closest && closest.dist <= 3 ? ` Did you mean '#${closest.slug}'?` : ''}`,
        specific_mismatch: `Anchor '#${anchor}' does not match any heading in '${path}'.`,
      });
    }
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: [path],
      reasoning: `File '${path}' exists in the repository.`,
    });
  }

  // Step 1b: Resolve relative to doc file's directory
  // e.g., doc at "phases/foo.md" referencing "bar.md" → try "phases/bar.md"
  if (claim.source_file && !path.includes('/')) {
    const docDir = claim.source_file.split('/').slice(0, -1).join('/');
    if (docDir) {
      const resolvedPath = `${docDir}/${path}`;
      const resolvedExists = await index.fileExists(claim.repo_id, resolvedPath);
      if (resolvedExists) {
        return makeResult(claim, {
          verdict: 'verified',
          evidence_files: [resolvedPath],
          reasoning: `File '${path}' resolves to '${resolvedPath}' relative to doc file directory.`,
        });
      }
    }
  }

  // Step 1c: Basename search for bare filenames (no directory component).
  // If docs say "containing HOOK.md and handler.ts", the file likely exists
  // somewhere in the repo even if not at the doc-relative path.
  if (!path.includes('/')) {
    const fileTree = await index.getFileTree(claim.repo_id);
    const basename = path;
    const matches = fileTree.filter(
      (f) => f === basename || f.endsWith('/' + basename),
    );
    if (matches.length > 0) {
      return makeResult(claim, {
        verdict: 'verified',
        evidence_files: [matches[0]],
        reasoning: `File '${path}' found at '${matches[0]}' (basename match).`,
      });
    }
  }

  // Step 2: Similar path search
  const similar = await findSimilarPaths(claim.repo_id, path, index, 5);
  if (similar.length > 0) {
    const best = similar[0];
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: [best.path],
      reasoning: `File '${path}' not found. Similar: '${best.path}'.`,
      suggested_fix: claim.claim_text.replace(path, best.path),
      specific_mismatch: `File path '${path}' does not exist. Likely renamed.`,
    });
  }

  // Step 3: No file, no similar match
  return makeResult(claim, {
    verdict: 'drifted',
    severity: 'high' as Severity,
    evidence_files: [],
    reasoning: `File '${path}' not found.`,
    specific_mismatch: `File path '${path}' does not exist.`,
  });
}

function levenshteinDist(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
