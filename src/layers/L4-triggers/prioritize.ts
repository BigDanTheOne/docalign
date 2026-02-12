import type { Claim } from '../../shared/types';

const SEVERITY_WEIGHTS: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const DEFAULT_MAX_CLAIMS = 50;

/**
 * Prioritize and cap claims for PR verification.
 * TDD-4 Section 4.7 step 8.
 *
 * Sort by severity_weight * extraction_confidence descending.
 * Tiebreaker: file path alpha, then line number asc.
 * Cap at max_claims_per_pr (default 50).
 */
export function prioritizeClaims(
  claims: Claim[],
  maxClaims: number = DEFAULT_MAX_CLAIMS,
): Claim[] {
  const sorted = [...claims].sort((a, b) => {
    const aWeight = getWeight(a);
    const bWeight = getWeight(b);

    if (bWeight !== aWeight) return bWeight - aWeight;

    // Tiebreaker: file path alpha
    const fileCompare = a.source_file.localeCompare(b.source_file);
    if (fileCompare !== 0) return fileCompare;

    // Tiebreaker: line number asc
    return a.line_number - b.line_number;
  });

  return sorted.slice(0, maxClaims);
}

function getWeight(claim: Claim): number {
  // Use the claim_type to infer a severity weight
  // Syntactic claims (path_reference, dependency_version, command) get higher base weight
  const typeWeight = getSeverityWeight(claim);
  return typeWeight * claim.extraction_confidence;
}

function getSeverityWeight(claim: Claim): number {
  // For now, use testability as proxy for severity:
  // syntactic = high (3), semantic = medium (2), untestable = low (1)
  if (claim.testability === 'syntactic') return SEVERITY_WEIGHTS.high;
  if (claim.testability === 'semantic') return SEVERITY_WEIGHTS.medium;
  return SEVERITY_WEIGHTS.low;
}

/**
 * Deduplicate claims by ID.
 */
export function deduplicateClaims(claims: Claim[]): Claim[] {
  const seen = new Set<string>();
  return claims.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
