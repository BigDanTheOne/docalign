import type { VerificationResult } from '../../shared/types';

const DEFAULT_HALF_LIFE_DAYS = 180;

/**
 * Calculate effective confidence with exponential decay.
 * TDD-7 Section 4.8.
 *
 * Formula: effective = confidence * e^(-days * ln(2) / half_life)
 *
 * At 0 days: factor = 1.0 (no decay)
 * At half_life days: factor = 0.5
 * At 2*half_life days: factor = 0.25
 */
export function getEffectiveConfidence(
  result: VerificationResult,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  const daysSince = (Date.now() - result.created_at.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince <= 0) {
    return result.confidence;
  }

  const decayFactor = Math.exp(-daysSince * Math.LN2 / halfLifeDays);
  return Math.max(result.confidence * decayFactor, 0.0);
}
