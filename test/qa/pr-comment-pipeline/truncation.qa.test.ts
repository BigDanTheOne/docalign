/**
 * QA: Comment truncation at 65K chars.
 */
import { describe, it, expect } from 'vitest';
import { buildSummaryComment } from '../../../src/layers/L5-reporter/comment-formatter';
import type { Finding, PRCommentPayload, Claim, VerificationResult, HealthScore } from '../../../src/shared/types';

function makeHealthScore(overrides: Partial<HealthScore> = {}): HealthScore {
  return { total_claims: 10, verified: 0, drifted: 10, uncertain: 0, pending: 0, score: 0.0, by_file: [], by_type: {}, hotspots: [], ...overrides };
}
function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return { id: 'c', repo_id: 'r', source_file: 'README.md', line_number: 1, claim_text: 'x', claim_type: 'dependency_version', testability: 'syntactic', extracted_value: {}, keywords: [], extraction_confidence: 1, extraction_method: 'regex', verification_status: 'drifted', last_verified_at: null, embedding: null, last_verification_result_id: null, parent_claim_id: null, created_at: new Date(), updated_at: new Date(), ...overrides };
}
function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return { id: 'r', claim_id: 'c', repo_id: 'r', scan_run_id: 's', verdict: 'drifted', confidence: 0.9, tier: 1, severity: 'high', reasoning: 'R'.repeat(300), specific_mismatch: 'Mismatch', suggested_fix: null, evidence_files: ['a.ts'], token_cost: null, duration_ms: null, post_check_result: null, verification_path: 1, created_at: new Date(), ...overrides };
}

const MAX_COMMENT_LENGTH = 65_000;

describe('QA: Truncation at 65K chars', () => {
  it('truncates comment body when many findings exceed 65K', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 300; i++) {
      findings.push({
        claim: makeClaim({ id: `claim-${i}`, claim_text: 'Long claim: ' + 'X'.repeat(200) }),
        result: makeResult({ reasoning: 'Reason: ' + 'Y'.repeat(500) }),
        fix: null,
        suppressed: false,
      });
    }
    const payload: PRCommentPayload = { findings, health_score: makeHealthScore(), scan_run_id: 'scan-trunc', agent_unavailable_pct: 0 };
    const result = buildSummaryComment(payload, 'scan-trunc');

    expect(result.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
  });

  it('preserves the comment marker after truncation', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 300; i++) {
      findings.push({
        claim: makeClaim({ id: `c-${i}`, claim_text: 'Z'.repeat(200) }),
        result: makeResult({ reasoning: 'W'.repeat(500) }),
        fix: null,
        suppressed: false,
      });
    }
    const payload: PRCommentPayload = { findings, health_score: makeHealthScore(), scan_run_id: 'scan-marker', agent_unavailable_pct: 0 };
    const result = buildSummaryComment(payload, 'scan-marker');

    expect(result).toContain('<!-- docalign-summary scan-run-id=scan-marker -->');
  });

  it('includes truncation warning when truncated', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 300; i++) {
      findings.push({
        claim: makeClaim({ id: `c-${i}`, claim_text: 'A'.repeat(200) }),
        result: makeResult({ reasoning: 'B'.repeat(500) }),
        fix: null,
        suppressed: false,
      });
    }
    const payload: PRCommentPayload = { findings, health_score: makeHealthScore(), scan_run_id: 'scan-warn', agent_unavailable_pct: 0 };
    const result = buildSummaryComment(payload, 'scan-warn');

    expect(result).toContain('truncated');
  });

  it('does not truncate small comments', () => {
    const payload: PRCommentPayload = {
      findings: [{
        claim: makeClaim(), result: makeResult(), fix: null, suppressed: false,
      }],
      health_score: makeHealthScore(),
      scan_run_id: 'scan-small',
      agent_unavailable_pct: 0,
    };
    const result = buildSummaryComment(payload, 'scan-small');

    expect(result).not.toContain('truncated');
    expect(result.length).toBeLessThan(MAX_COMMENT_LENGTH);
  });
});
