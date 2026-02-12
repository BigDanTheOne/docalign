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
  if (!path) return null;

  // Step 1: Exact check
  const exists = await index.fileExists(claim.repo_id, path);
  if (exists) {
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
