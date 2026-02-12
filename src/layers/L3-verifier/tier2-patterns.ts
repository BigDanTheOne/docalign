import type { Claim, VerificationResult } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { makeTier2Result } from './result-helpers';

/**
 * Tier 2: Pattern-based verification strategies.
 * TDD-3 Appendix D.
 *
 * Most strategies conservatively fall through to Tier 4 (LLM).
 * Only D.2 (Framework Import Check) can produce a result.
 */
export async function verifyTier2(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  // Only applies to convention/environment claim types
  if (claim.claim_type !== 'convention' && claim.claim_type !== 'environment') {
    return null;
  }

  // D.2: Framework Import Check
  const result = await frameworkImportCheck(claim, index);
  if (result) return result;

  // D.1, D.3, D.4, D.5: Fall through to Tier 4
  return null;
}

/**
 * D.2: Framework Import Check.
 * Extract framework name from claim, call L0.findSymbol, return verified if found.
 */
async function frameworkImportCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const framework = claim.extracted_value.framework as string | undefined;
  if (!framework) return null;

  const entities = await index.findSymbol(claim.repo_id, framework);
  if (entities.length > 0) {
    return makeTier2Result(claim, {
      verdict: 'verified',
      evidence_files: [entities[0].file_path],
      reasoning: `Framework '${framework}' found in codebase via import.`,
    });
  }

  return null;
}
