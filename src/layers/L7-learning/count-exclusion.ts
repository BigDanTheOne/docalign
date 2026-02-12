import type { Pool } from 'pg';
import type { SuppressionRule } from '../../shared/types';
import { getSilentDismissalCount, getSilentDismissalPRs } from './feedback';

const DEFAULT_THRESHOLD = 2;

/**
 * Check if a claim should be permanently excluded based on silent dismissal count.
 * TDD-7 Section 4.3.
 *
 * Threshold: 2 silent thumbs_down (or fix_dismissed) without quick_pick_reason.
 * all_dismissed has 0x weight and does not count.
 *
 * Returns true if exclusion was created (or already exists).
 */
export async function checkCountBasedExclusion(
  pool: Pool,
  claimId: string,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<boolean> {
  const count = await getSilentDismissalCount(pool, claimId);

  if (count < threshold) {
    return false;
  }

  // Check if already excluded
  const existingResult = await pool.query(
    `SELECT id FROM suppression_rules
     WHERE target_claim_id = $1
     AND scope = 'claim'
     AND source = 'count_based'
     AND revoked = false`,
    [claimId],
  );

  if (existingResult.rows.length > 0) {
    return true; // already excluded
  }

  // Get claim's repo_id
  const claimResult = await pool.query(
    'SELECT repo_id FROM claims WHERE id = $1',
    [claimId],
  );

  if (claimResult.rows.length === 0) {
    return false; // claim deleted
  }

  const repoId = claimResult.rows[0].repo_id;

  // Gather PR numbers for the reason string
  const prNumbers = await getSilentDismissalPRs(pool, claimId);
  const prListStr = prNumbers.length > 0 ? prNumbers.join(', ') : 'unknown';

  // Create permanent suppression rule (no expiry)
  await pool.query(
    `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at)
     VALUES ($1, 'claim', $2, $3, 'count_based', NULL)`,
    [repoId, claimId, `Silently dismissed ${count} times (PRs: ${prListStr})`],
  );

  // Notify L1 to mark claim status - for now just update directly
  // In full integration, L1.updateVerificationStatus would be called
  await pool.query(
    "UPDATE claims SET verification_status = 'pending' WHERE id = $1",
    [claimId],
  ).catch(() => {
    // Log warning, continue. Rule is still created.
  });

  return true;
}

/**
 * Get the count-based exclusion rule for a claim, if any.
 */
export async function getCountBasedRule(
  pool: Pool,
  claimId: string,
): Promise<SuppressionRule | null> {
  const result = await pool.query(
    `SELECT * FROM suppression_rules
     WHERE target_claim_id = $1
     AND scope = 'claim'
     AND source = 'count_based'
     AND revoked = false
     LIMIT 1`,
    [claimId],
  );
  return result.rows.length > 0 ? (result.rows[0] as SuppressionRule) : null;
}
