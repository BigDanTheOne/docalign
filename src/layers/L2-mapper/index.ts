import type { Pool } from 'pg';
import type {
  Claim,
  ClaimMapping,
  LearningService,
} from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { mapDirectReference } from './step1-direct';
import { mapSymbolSearch } from './step2-symbol';
import { mapSemanticSearch } from './step3-semantic';
import { deduplicateMappings } from './dedup';
import { MapperStore } from './mapper-store';

export { MapperStore } from './mapper-store';
export { mapDirectReference, RUNNER_MANIFEST_MAP } from './step1-direct';
export { mapSymbolSearch, extractSymbolFromImport } from './step2-symbol';
export { mapSemanticSearch } from './step3-semantic';
export { deduplicateMappings } from './dedup';
export type { MappingCandidate } from './step1-direct';

// Claim types that support Step 2 (symbol search)
const SYMBOL_SEARCH_TYPES = new Set(['code_example', 'behavior', 'architecture']);
// Claim types that support Step 3 (semantic search)
const SEMANTIC_SEARCH_TYPES = new Set(['behavior', 'architecture']);

/**
 * MapperService interface.
 * TDD-2 Section 2.2.
 */
export interface MapperService {
  mapClaim(repoId: string, claim: Claim): Promise<ClaimMapping[]>;
  findClaimsByCodeFiles(repoId: string, codeFiles: string[]): Promise<ClaimMapping[]>;
  getMappingsForClaim(claimId: string): Promise<ClaimMapping[]>;
  refreshMapping(claimId: string, claim: Claim): Promise<ClaimMapping[]>;
  updateCodeFilePaths(repoId: string, renames: Array<{ old_path: string; new_path: string }>): Promise<number>;
  removeMappingsForFiles(repoId: string, codeFiles: string[]): Promise<number>;
  getEntityLineCount(mappingId: string): Promise<number | null>;
}

/**
 * Create a MapperService backed by PostgreSQL.
 */
export function createMapper(
  pool: Pool,
  index: CodebaseIndexService,
  learning: LearningService,
): MapperService {
  const store = new MapperStore(pool);

  return {
    async mapClaim(repoId: string, claim: Claim): Promise<ClaimMapping[]> {
      const candidates = await runMappingPipeline(repoId, claim, index, learning);
      const deduped = deduplicateMappings(candidates);
      return store.persistMappings(repoId, claim.id, deduped);
    },

    async findClaimsByCodeFiles(repoId, codeFiles) {
      return store.findClaimsByCodeFiles(repoId, codeFiles);
    },

    async getMappingsForClaim(claimId) {
      return store.getMappingsForClaim(claimId);
    },

    async refreshMapping(claimId, claim) {
      await store.deleteMappingsForClaim(claimId);
      const candidates = await runMappingPipeline(claim.repo_id, claim, index, learning);
      const deduped = deduplicateMappings(candidates);
      return store.persistMappings(claim.repo_id, claimId, deduped);
    },

    async updateCodeFilePaths(repoId, renames) {
      return store.updateCodeFilePaths(repoId, renames);
    },

    async removeMappingsForFiles(repoId, codeFiles) {
      return store.removeMappingsForFiles(repoId, codeFiles);
    },

    async getEntityLineCount(mappingId) {
      return store.getEntityLineCount(mappingId);
    },
  };
}

/**
 * Run the 3-step mapping pipeline.
 * TDD-2 Section 4.1.
 */
async function runMappingPipeline(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
  learning: LearningService,
) {
  const allCandidates: import('./step1-direct').MappingCandidate[] = [];

  // Step 1: Direct reference
  const step1 = await mapDirectReference(repoId, claim, index);
  allCandidates.push(...step1);

  // Step 2: Symbol search (for applicable types)
  if (SYMBOL_SEARCH_TYPES.has(claim.claim_type)) {
    const step2 = await mapSymbolSearch(repoId, claim, index);
    allCandidates.push(...step2);
  }

  // Step 3: Semantic search (for applicable types, if fewer than 2 candidates)
  if (SEMANTIC_SEARCH_TYPES.has(claim.claim_type) && allCandidates.length < 2) {
    const step3 = await mapSemanticSearch(repoId, claim, index);
    allCandidates.push(...step3);
  }

  // Apply co-change boost from L7
  for (const c of allCandidates) {
    const boost = await learning.getCoChangeBoost(repoId, c.code_file, claim.source_file);
    c.co_change_boost = boost;
    c.confidence = Math.min(c.confidence + boost, 1.0);
  }

  return allCandidates;
}
