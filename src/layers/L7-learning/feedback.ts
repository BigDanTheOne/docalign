import type { Pool } from 'pg';
import type { FeedbackRecord, FeedbackType, QuickPickReason } from '../../shared/types';
import { DocAlignError } from '../../shared/types';

const VALID_FEEDBACK_TYPES: FeedbackType[] = [
  'thumbs_up',
  'thumbs_down',
  'fix_accepted',
  'fix_dismissed',
  'all_dismissed',
];

/**
 * Record developer feedback on a verification finding.
 * TDD-7 Section 4.1.
 */
export async function recordFeedback(
  pool: Pool,
  feedback: Omit<FeedbackRecord, 'id' | 'created_at'>,
): Promise<FeedbackRecord> {
  if (!feedback.repo_id || !feedback.claim_id) {
    throw new DocAlignError({
      code: 'DOCALIGN_E401',
      severity: 'medium',
      message: 'repo_id and claim_id are required',
      retryable: false,
    });
  }

  if (!feedback.feedback_type || !VALID_FEEDBACK_TYPES.includes(feedback.feedback_type)) {
    throw new DocAlignError({
      code: 'DOCALIGN_E401',
      severity: 'medium',
      message: `Invalid feedback_type: '${feedback.feedback_type}'. Expected one of: ${VALID_FEEDBACK_TYPES.join(', ')}`,
      retryable: false,
    });
  }

  const result = await pool.query(
    `INSERT INTO feedback (repo_id, claim_id, verification_result_id, feedback_type,
       quick_pick_reason, free_text, github_user, pr_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      feedback.repo_id,
      feedback.claim_id,
      feedback.verification_result_id ?? null,
      feedback.feedback_type,
      feedback.quick_pick_reason ?? null,
      feedback.free_text ?? null,
      feedback.github_user ?? null,
      feedback.pr_number ?? null,
    ],
  );

  return result.rows[0] as FeedbackRecord;
}

/**
 * Count silent dismissals for a claim.
 * Silent = thumbs_down or fix_dismissed without quick_pick_reason.
 * TDD-7 Section 4.1 (incrementDismissalCount helper).
 */
export async function getSilentDismissalCount(pool: Pool, claimId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM feedback
     WHERE claim_id = $1
     AND feedback_type IN ('thumbs_down', 'fix_dismissed')
     AND quick_pick_reason IS NULL`,
    [claimId],
  );
  return result.rows[0].cnt;
}

/**
 * Get distinct PR numbers for silent dismissals.
 * TDD-7 Section 4.3 (gather PR numbers for reason string).
 */
export async function getSilentDismissalPRs(pool: Pool, claimId: string): Promise<number[]> {
  const result = await pool.query(
    `SELECT DISTINCT pr_number FROM feedback
     WHERE claim_id = $1
     AND feedback_type IN ('thumbs_down', 'fix_dismissed')
     AND quick_pick_reason IS NULL
     AND pr_number IS NOT NULL
     ORDER BY pr_number`,
    [claimId],
  );
  return result.rows.map((r: { pr_number: number }) => r.pr_number);
}

/**
 * Check if positive feedback should revoke suppression rules.
 * TDD-7 Section 4.1 (checkPositiveFeedbackRevocation helper).
 * If 2+ thumbs_up since rule creation, revoke the rule.
 */
export async function checkPositiveFeedbackRevocation(
  pool: Pool,
  claimId: string,
  repoId: string,
): Promise<void> {
  // Find active claim-level suppression rules for this claim
  const rulesResult = await pool.query(
    `SELECT id, created_at FROM suppression_rules
     WHERE repo_id = $1
     AND scope = 'claim'
     AND target_claim_id = $2
     AND revoked = false
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [repoId, claimId],
  );

  for (const rule of rulesResult.rows) {
    // Count positive feedback since rule creation
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM feedback
       WHERE claim_id = $1
       AND feedback_type = 'thumbs_up'
       AND created_at >= $2`,
      [claimId, rule.created_at],
    );

    if (countResult.rows[0].cnt >= 2) {
      await pool.query(
        `UPDATE suppression_rules SET revoked = true WHERE id = $1`,
        [rule.id],
      );
    }
  }
}

/**
 * Validate a quick-pick reason is valid.
 */
const VALID_QUICK_PICK_REASONS: QuickPickReason[] = [
  'not_relevant_to_this_file',
  'intentionally_different',
  'will_fix_later',
  'docs_are_aspirational',
  'this_is_correct',
];

export function isValidQuickPickReason(reason: string): reason is QuickPickReason {
  return VALID_QUICK_PICK_REASONS.includes(reason as QuickPickReason);
}
