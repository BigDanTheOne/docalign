import type { MappingCandidate } from './step1-direct';

/**
 * Deduplicate mapping candidates by (code_file, code_entity_id).
 * Keeps the candidate with the highest confidence.
 * TDD-2 Appendix D.
 */
export function deduplicateMappings(candidates: MappingCandidate[]): MappingCandidate[] {
  const seen = new Map<string, MappingCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.code_file}:${candidate.code_entity_id ?? 'null'}`;
    const existing = seen.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(key, candidate);
    }
  }

  return Array.from(seen.values());
}
