import type { Claim } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import type { MappingCandidate } from './step1-direct';

/**
 * Step 3: Semantic Search mapping.
 * TDD-2 Section 4.1, Appendix A.7.
 *
 * Applies to: behavior, architecture (when Step 2 produced < 2 candidates).
 * Uses L0.searchSemantic with claim description as query.
 */
export async function mapSemanticSearch(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
  topK: number = 5,
): Promise<MappingCandidate[]> {
  const query = claim.claim_text;
  if (!query) return [];

  const results = await index.searchSemantic(repoId, query, topK);
  const candidates: MappingCandidate[] = [];

  for (const result of results) {
    candidates.push({
      code_file: result.file_path,
      code_entity_id: result.id,
      confidence: result.similarity * 0.8,
      co_change_boost: 0.0,
      mapping_method: 'semantic_search',
    });
  }

  return candidates;
}
