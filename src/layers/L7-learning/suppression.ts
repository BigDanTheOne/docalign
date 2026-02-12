import type { Pool } from 'pg';
import type { Claim, SuppressionRule } from '../../shared/types';

/**
 * Check if a claim is suppressed by any active suppression rule.
 * Evaluates in order of specificity: claim > file > claim_type > pattern.
 * TDD-7 Section 4.4.
 *
 * Returns false on DB error (safe default: show the finding).
 */
export async function isClaimSuppressed(pool: Pool, claim: Claim): Promise<boolean> {
  try {
    // Level 1: Claim-level suppression
    const claimRule = await pool.query(
      `SELECT id FROM suppression_rules
       WHERE repo_id = $1
       AND scope = 'claim'
       AND target_claim_id = $2
       AND revoked = false
       AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [claim.repo_id, claim.id],
    );

    if (claimRule.rows.length > 0) {
      return true;
    }

    // Level 2: File-level suppression
    const fileRule = await pool.query(
      `SELECT id FROM suppression_rules
       WHERE repo_id = $1
       AND scope = 'file'
       AND target_file = $2
       AND revoked = false
       AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [claim.repo_id, claim.source_file],
    );

    if (fileRule.rows.length > 0) {
      return true;
    }

    // Level 3: Claim-type suppression
    const typeRule = await pool.query(
      `SELECT id FROM suppression_rules
       WHERE repo_id = $1
       AND scope = 'claim_type'
       AND target_claim_type = $2
       AND revoked = false
       AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [claim.repo_id, claim.claim_type],
    );

    if (typeRule.rows.length > 0) {
      return true;
    }

    // Level 4: Pattern suppression (v2 - no pattern rules in MVP)
    // Query runs but returns zero matches
    const patternRules = await pool.query(
      `SELECT target_pattern FROM suppression_rules
       WHERE repo_id = $1
       AND scope = 'pattern'
       AND revoked = false
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [claim.repo_id],
    );

    for (const rule of patternRules.rows) {
      try {
        if (rule.target_pattern && new RegExp(rule.target_pattern).test(claim.claim_text)) {
          return true;
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }

    return false;
  } catch {
    // DB error: safe default is to not suppress (show the finding)
    return false;
  }
}

/**
 * Get all active (non-revoked, non-expired) suppression rules for a repo.
 * TDD-7 Section 4.5.
 */
export async function getActiveRules(pool: Pool, repoId: string): Promise<SuppressionRule[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM suppression_rules
       WHERE repo_id = $1
       AND revoked = false
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY scope ASC, created_at DESC`,
      [repoId],
    );
    return result.rows as SuppressionRule[];
  } catch {
    return [];
  }
}
