import type { Pool } from 'pg';
import type {
  Claim,
  ClaimMapping,
  FormattedEvidence,
  RoutingDecision,
  VerificationResult,
} from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import type { MapperService } from '../L2-mapper';
import { verifyPathReference } from './tier1-path-reference';
import { verifyApiRoute } from './tier1-api-route';
import { verifyDependencyVersion } from './tier1-dependency-version';
import { verifyCommand } from './tier1-command';
import { verifyCodeExample } from './tier1-code-example';
import { verifyTier2 } from './tier2-patterns';
import { routeClaim } from './routing';
import { buildPath1Evidence } from './evidence-builder';
import { ResultStore } from './result-store';

export { ResultStore } from './result-store';
export { verifyPathReference } from './tier1-path-reference';
export { verifyApiRoute } from './tier1-api-route';
export { verifyDependencyVersion } from './tier1-dependency-version';
export { verifyCommand } from './tier1-command';
export { verifyCodeExample } from './tier1-code-example';
export { verifyTier2 } from './tier2-patterns';
export { routeClaim, DEFAULT_VERIFIER_CONFIG } from './routing';
export type { VerifierConfig } from './routing';
export { buildPath1Evidence } from './evidence-builder';
export { findSimilarPaths, levenshtein } from './similar-path';
export { findCloseMatch } from './close-match';
export { compareVersions, stripVersionPrefix } from './version-comparison';
export { makeResult, makeTier2Result } from './result-helpers';

/**
 * VerifierService interface.
 * TDD-3 Section 2.3.
 */
export interface VerifierService {
  verifyDeterministic(claim: Claim, mappings: ClaimMapping[]): Promise<VerificationResult | null>;
  routeClaim(claim: Claim, mappings: ClaimMapping[]): Promise<RoutingDecision>;
  buildPath1Evidence(claim: Claim, mappings: ClaimMapping[]): Promise<FormattedEvidence>;
  storeResult(result: VerificationResult): Promise<void>;
  mergeResults(scanRunId: string): Promise<VerificationResult[]>;
  getLatestResult(claimId: string): Promise<VerificationResult | null>;
}

/**
 * Create a VerifierService backed by PostgreSQL.
 */
export function createVerifier(
  pool: Pool,
  index: CodebaseIndexService,
  mapper: MapperService,
): VerifierService {
  const resultStore = new ResultStore(pool);

  return {
    async verifyDeterministic(claim: Claim, _mappings: ClaimMapping[]): Promise<VerificationResult | null> {
      const startTime = Date.now();

      // === TIER 1: Syntactic Verification ===
      if (claim.testability === 'syntactic') {
        let result: VerificationResult | null = null;

        switch (claim.claim_type) {
          case 'path_reference':
            result = await verifyPathReference(claim, index);
            break;
          case 'command':
            result = await verifyCommand(claim, index);
            break;
          case 'dependency_version':
            result = await verifyDependencyVersion(claim, index);
            break;
          case 'api_route':
            result = await verifyApiRoute(claim, index);
            break;
          case 'code_example':
            result = await verifyCodeExample(claim, index);
            break;
        }

        if (result) {
          result.duration_ms = Date.now() - startTime;
          result.tier = 1;
          result.confidence = 1.0;
          result.token_cost = null;
          result.verification_path = null;
          result.post_check_result = null;
          return result;
        }
      }

      // === TIER 2: Pattern Verification ===
      if (claim.claim_type === 'convention' || claim.claim_type === 'environment') {
        const result = await verifyTier2(claim, index);
        if (result) {
          result.duration_ms = Date.now() - startTime;
          result.tier = 2;
          result.token_cost = null;
          result.verification_path = null;
          result.post_check_result = null;
          return result;
        }
      }

      // Neither Tier 1 nor Tier 2 produced a result. Return null for Tier 4 (LLM).
      return null;
    },

    async routeClaim(claim: Claim, mappings: ClaimMapping[]): Promise<RoutingDecision> {
      return routeClaim(claim, mappings, mapper);
    },

    async buildPath1Evidence(claim: Claim, mappings: ClaimMapping[]): Promise<FormattedEvidence> {
      return buildPath1Evidence(claim, mappings, index);
    },

    async storeResult(result: VerificationResult): Promise<void> {
      return resultStore.storeResult(result);
    },

    async mergeResults(scanRunId: string): Promise<VerificationResult[]> {
      return resultStore.mergeResults(scanRunId);
    },

    async getLatestResult(claimId: string): Promise<VerificationResult | null> {
      return resultStore.getLatestResult(claimId);
    },
  };
}
