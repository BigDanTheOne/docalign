import type { Pool } from 'pg';
import type { VerificationResult, VerificationResultRow, Verdict, PostCheckOutcome, VerificationPath } from '../../shared/types';

/**
 * ResultStore: Database operations for verification_results.
 * TDD-3 Sections 4.4-4.6.
 */
export class ResultStore {
  constructor(private pool: Pool) {}

  /**
   * 4.4: Store a verification result.
   * Decision 3C-005: downgrade drifted with empty evidence to uncertain.
   */
  async storeResult(result: VerificationResult): Promise<void> {
    // 3C-005: downgrade drifted with empty evidence
    let verdict = result.verdict;
    let reasoning = result.reasoning;
    let confidence = result.confidence;

    if (verdict === 'drifted' && result.evidence_files.length === 0) {
      verdict = 'uncertain';
      reasoning = (reasoning || '') +
        ' [Downgraded: drift reported with no supporting evidence (3C-005)]';
    }

    // Reduce confidence for verified with no evidence
    if (verdict === 'verified' && result.evidence_files.length === 0) {
      confidence = Math.max(confidence - 0.3, 0.0);
    }

    try {
      await this.pool.query(
        `INSERT INTO verification_results (
          id, claim_id, repo_id, scan_run_id,
          verdict, confidence, tier, severity,
          reasoning, specific_mismatch, suggested_fix,
          evidence_files, token_cost, duration_ms,
          post_check_result, verification_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          result.id, result.claim_id, result.repo_id, result.scan_run_id,
          verdict, confidence, result.tier, result.severity,
          reasoning, result.specific_mismatch, result.suggested_fix,
          result.evidence_files, result.token_cost, result.duration_ms,
          result.post_check_result, result.verification_path,
        ],
      );

      // Update claim verification status
      await this.pool.query(
        `UPDATE claims SET
          verification_status = $2,
          last_verified_at = NOW(),
          last_verification_result_id = $3,
          updated_at = NOW()
         WHERE id = $1`,
        [result.claim_id, verdict, result.id],
      );
    } catch (error: unknown) {
      // Idempotent: duplicate result.id is OK
      if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
        return; // Unique violation — treat as success
      }
      throw error;
    }
  }

  /**
   * 4.5: Merge results for a scan run.
   * Keep the latest result per claim, prefer higher-tier results.
   */
  async mergeResults(scanRunId: string): Promise<VerificationResult[]> {
    const result = await this.pool.query(
      `SELECT * FROM verification_results
       WHERE scan_run_id = $1
       ORDER BY claim_id, created_at DESC`,
      [scanRunId],
    );

    const latestPerClaim = new Map<string, VerificationResult>();
    for (const row of result.rows) {
      const vr = rowToResult(row);
      const existing = latestPerClaim.get(vr.claim_id);
      if (!existing) {
        latestPerClaim.set(vr.claim_id, vr);
      } else if (vr.tier > existing.tier) {
        // Prefer higher-tier results
        latestPerClaim.set(vr.claim_id, vr);
      }
    }

    return Array.from(latestPerClaim.values());
  }

  /**
   * 4.6: Get the latest verification result for a claim.
   */
  async getLatestResult(claimId: string): Promise<VerificationResult | null> {
    const result = await this.pool.query(
      `SELECT * FROM verification_results
       WHERE claim_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [claimId],
    );
    if (result.rowCount === 0) return null;
    return rowToResult(result.rows[0]);
  }
}

function rowToResult(row: VerificationResultRow): VerificationResult {
  return {
    id: row.id,
    claim_id: row.claim_id,
    repo_id: row.repo_id,
    scan_run_id: row.scan_run_id,
    verdict: row.verdict as Verdict,
    confidence: row.confidence,
    tier: row.tier,
    severity: row.severity,
    reasoning: row.reasoning,
    specific_mismatch: row.specific_mismatch,
    suggested_fix: row.suggested_fix,
    evidence_files: row.evidence_files ?? [],
    token_cost: row.token_cost,
    duration_ms: row.duration_ms,
    post_check_result: row.post_check_result as PostCheckOutcome | null,
    verification_path: row.verification_path as VerificationPath | null,
    created_at: row.created_at,
  };
}
