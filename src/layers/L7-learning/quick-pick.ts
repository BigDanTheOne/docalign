import type { Pool } from 'pg';
import type { Claim, ClaimType, QuickPickReason, SuppressionRule, SuppressionScope } from '../../shared/types';

interface QuickPickAction {
  scope: SuppressionScope;
  target_claim_id: string | null;
  target_file: string | null;
  target_claim_type: ClaimType | null;
  target_pattern: string | null;
  reason: string;
  duration_days: number;
}

/**
 * Deterministic quick-pick action mapping.
 * TDD-7 Appendix A.
 */
function quickPickActionMap(reason: QuickPickReason, claim: Claim): QuickPickAction {
  switch (reason) {
    case 'not_relevant_to_this_file':
      return {
        scope: 'claim',
        target_claim_id: claim.id,
        target_file: null,
        target_claim_type: null,
        target_pattern: null,
        reason: 'Not relevant to this file',
        duration_days: 180,
      };
    case 'intentionally_different':
      return {
        scope: 'claim',
        target_claim_id: claim.id,
        target_file: null,
        target_claim_type: null,
        target_pattern: null,
        reason: 'Intentionally different from docs',
        duration_days: 90,
      };
    case 'will_fix_later':
      return {
        scope: 'claim',
        target_claim_id: claim.id,
        target_file: null,
        target_claim_type: null,
        target_pattern: null,
        reason: 'Known issue, will fix later',
        duration_days: 90,
      };
    case 'docs_are_aspirational':
      return {
        scope: 'file',
        target_claim_id: null,
        target_file: claim.source_file,
        target_claim_type: null,
        target_pattern: null,
        reason: 'Doc file is aspirational (not current reality)',
        duration_days: 90,
      };
    case 'this_is_correct':
      return {
        scope: 'claim',
        target_claim_id: claim.id,
        target_file: null,
        target_claim_type: null,
        target_pattern: null,
        reason: 'False positive -- docs are correct',
        duration_days: 180,
      };
  }
}

/**
 * Process a quick-pick dismissal reason.
 * Creates or extends a suppression rule.
 * TDD-7 Section 4.2.
 */
export async function processQuickPick(
  pool: Pool,
  claimId: string,
  reason: QuickPickReason,
  repoId: string,
): Promise<SuppressionRule | null> {
  // Look up the claim for context
  const claimResult = await pool.query('SELECT * FROM claims WHERE id = $1', [claimId]);
  if (claimResult.rows.length === 0) {
    return null; // claim was deleted
  }
  const claim = claimResult.rows[0] as Claim;

  const action = quickPickActionMap(reason, claim);

  // Check for existing active rule with same scope and target
  let whereClause: string;
  const params: unknown[] = [repoId, action.scope];
  if (action.scope === 'claim') {
    whereClause = 'AND target_claim_id = $3';
    params.push(action.target_claim_id);
  } else if (action.scope === 'file') {
    whereClause = 'AND target_file = $3';
    params.push(action.target_file);
  } else if (action.scope === 'claim_type') {
    whereClause = 'AND target_claim_type = $3';
    params.push(action.target_claim_type);
  } else {
    whereClause = 'AND target_pattern = $3';
    params.push(action.target_pattern);
  }

  const existingResult = await pool.query(
    `SELECT * FROM suppression_rules
     WHERE repo_id = $1
     AND scope = $2
     AND revoked = false
     AND (expires_at IS NULL OR expires_at > NOW())
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 1`,
    params,
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0] as SuppressionRule;
    // Extend expiry if the new one would expire later
    const newExpiry = new Date(Date.now() + action.duration_days * 24 * 60 * 60 * 1000);
    if (!existing.expires_at || newExpiry > existing.expires_at) {
      await pool.query(
        'UPDATE suppression_rules SET expires_at = $1 WHERE id = $2',
        [newExpiry, existing.id],
      );
      existing.expires_at = newExpiry;
    }
    return existing;
  }

  // Create new suppression rule
  const expiresAt = new Date(Date.now() + action.duration_days * 24 * 60 * 60 * 1000);
  const insertResult = await pool.query(
    `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, target_file,
       target_claim_type, target_pattern, reason, source, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'quick_pick', $8)
     RETURNING *`,
    [
      repoId,
      action.scope,
      action.target_claim_id,
      action.target_file,
      action.target_claim_type,
      action.target_pattern,
      action.reason,
      expiresAt,
    ],
  );

  return insertResult.rows[0] as SuppressionRule;
}
