import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { makeResult } from './result-helpers';

/**
 * Tier 1: Verify api_route claims.
 * TDD-3 Appendix A.4.
 */
export async function verifyApiRoute(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const method = claim.extracted_value.method as string;
  const routePath = claim.extracted_value.path as string;
  if (!method || !routePath) return null;

  // Step 1: Exact route match
  const route = await index.findRoute(claim.repo_id, method, routePath);
  if (route) {
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: [route.file_path],
      reasoning: `Route '${method} ${routePath}' found in '${route.file_path}'.`,
    });
  }

  // Step 2: Search for alternatives
  const alternatives = await index.searchRoutes(claim.repo_id, routePath);
  if (alternatives.length > 0) {
    const best = alternatives[0];
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: [best.file],
      reasoning: `Route '${method} ${routePath}' not found. Similar: '${best.method} ${best.path}'.`,
      suggested_fix: claim.claim_text.replace(`${method} ${routePath}`, `${best.method} ${best.path}`),
      specific_mismatch: `Route does not exist. Closest: '${best.method} ${best.path}'.`,
    });
  }

  // Step 3: No route found
  return makeResult(claim, {
    verdict: 'drifted',
    severity: 'high' as Severity,
    evidence_files: [],
    reasoning: `Route '${method} ${routePath}' not found.`,
    specific_mismatch: 'Route not found.',
  });
}
