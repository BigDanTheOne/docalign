import { levenshtein } from './similar-path';

export interface CloseMatchResult {
  name: string;
  distance: number;
}

/**
 * Find the closest match for a string among candidates using Levenshtein distance.
 * TDD-3 Appendix A.2.
 */
export function findCloseMatch(
  target: string,
  candidates: string[],
  maxDistance: number,
): CloseMatchResult | null {
  let best: CloseMatchResult | null = null;

  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    if (distance > 0 && distance <= maxDistance) {
      if (!best || distance < best.distance) {
        best = { name: candidate, distance };
      }
    }
  }

  return best;
}
