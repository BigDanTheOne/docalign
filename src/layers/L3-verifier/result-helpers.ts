import { randomUUID } from 'crypto';
import type { Claim, VerificationResult, Verdict, Severity } from '../../shared/types';

interface ResultFields {
  verdict: Verdict;
  severity?: Severity | null;
  evidence_files: string[];
  reasoning: string;
  specific_mismatch?: string | null;
  suggested_fix?: string | null;
}

/**
 * Create a Tier 1 VerificationResult from a claim and result fields.
 */
export function makeResult(claim: Claim, fields: ResultFields): VerificationResult {
  return {
    id: randomUUID(),
    claim_id: claim.id,
    repo_id: claim.repo_id,
    scan_run_id: null,
    verdict: fields.verdict,
    confidence: 1.0,
    tier: 1,
    severity: fields.severity ?? null,
    reasoning: fields.reasoning,
    specific_mismatch: fields.specific_mismatch ?? null,
    suggested_fix: fields.suggested_fix ?? null,
    evidence_files: fields.evidence_files,
    token_cost: null,
    duration_ms: null,
    post_check_result: null,
    verification_path: null,
    created_at: new Date(),
  };
}

/**
 * Create a Tier 2 VerificationResult.
 */
export function makeTier2Result(claim: Claim, fields: ResultFields): VerificationResult {
  const result = makeResult(claim, fields);
  result.tier = 2;
  return result;
}
