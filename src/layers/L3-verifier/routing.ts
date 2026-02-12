import type { Claim, ClaimMapping, RoutingDecision, VerificationPath } from '../../shared/types';
import type { MapperService } from '../L2-mapper';

/**
 * Default verifier config values.
 */
const DEFAULT_PATH1_MAX_EVIDENCE_TOKENS = 4000;
const DEFAULT_CHARS_PER_TOKEN = 4;
const AVG_CHARS_PER_LINE = 60;

export interface VerifierConfig {
  path1_max_evidence_tokens: number;
  path1_max_import_lines: number;
  path1_max_type_signatures: number;
  path1_max_type_lines: number;
  chars_per_token: number;
}

export const DEFAULT_VERIFIER_CONFIG: VerifierConfig = {
  path1_max_evidence_tokens: DEFAULT_PATH1_MAX_EVIDENCE_TOKENS,
  path1_max_import_lines: 30,
  path1_max_type_signatures: 3,
  path1_max_type_lines: 100,
  chars_per_token: DEFAULT_CHARS_PER_TOKEN,
};

/**
 * Route a claim to Path 1 or Path 2.
 * TDD-3 Section 4.2, Appendix F.
 */
export async function routeClaim(
  claim: Claim,
  mappings: ClaimMapping[],
  mapper: MapperService,
  config: VerifierConfig = DEFAULT_VERIFIER_CONFIG,
): Promise<RoutingDecision> {
  // No mappings -> Path 2
  if (mappings.length === 0) {
    return { claim_id: claim.id, path: 2 as VerificationPath, reason: 'no_mapping', entity_token_estimate: null };
  }

  // Partition mappings by file
  const fileGroups = new Set(mappings.map((m) => m.code_file));

  // Multi-file -> Path 2
  if (fileGroups.size > 1) {
    return { claim_id: claim.id, path: 2 as VerificationPath, reason: 'multi_file', entity_token_estimate: null };
  }

  // Single file — check entity mappings
  const entityMappings = mappings.filter((m) => m.code_entity_id != null);

  // No entity-level mappings (file-only) -> Path 2
  if (entityMappings.length === 0) {
    return { claim_id: claim.id, path: 2 as VerificationPath, reason: 'file_only_mapping', entity_token_estimate: null };
  }

  // Single or multiple entities in same file — estimate tokens
  let totalTokenEstimate = 0;

  for (const mapping of entityMappings) {
    const lineCount = await mapper.getEntityLineCount(mapping.id);
    if (lineCount == null) {
      return { claim_id: claim.id, path: 2 as VerificationPath, reason: 'file_only_mapping', entity_token_estimate: null };
    }
    const entityTokens = estimateTokens(lineCount, config.chars_per_token);
    totalTokenEstimate += entityTokens;
  }

  // Add estimated import tokens (30 lines max)
  const importTokenEstimate = config.path1_max_import_lines * config.chars_per_token;
  totalTokenEstimate += importTokenEstimate;

  // Enforce cap
  if (totalTokenEstimate > config.path1_max_evidence_tokens) {
    return {
      claim_id: claim.id,
      path: 2 as VerificationPath,
      reason: 'evidence_too_large',
      entity_token_estimate: totalTokenEstimate,
    };
  }

  // Fits in Path 1
  const reason = entityMappings.length === 1 ? 'single_entity_mapped' : 'multi_entity_small';
  return {
    claim_id: claim.id,
    path: 1 as VerificationPath,
    reason,
    entity_token_estimate: totalTokenEstimate,
  };
}

function estimateTokens(lineCount: number, charsPerToken: number): number {
  return Math.ceil((lineCount * AVG_CHARS_PER_LINE) / charsPerToken);
}
