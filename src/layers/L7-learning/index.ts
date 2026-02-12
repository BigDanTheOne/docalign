import type { Pool } from 'pg';
import type {
  Claim,
  FeedbackRecord,
  LearningService,
  QuickPickReason,
  SuppressionRule,
  VerificationResult,
} from '../../shared/types';
import { recordFeedback as recordFeedbackImpl, checkPositiveFeedbackRevocation } from './feedback';
import { processQuickPick as processQuickPickImpl } from './quick-pick';
import { checkCountBasedExclusion as checkCountBasedExclusionImpl } from './count-exclusion';
import { isClaimSuppressed as isClaimSuppressedImpl, getActiveRules as getActiveRulesImpl } from './suppression';
import { recordCoChanges as recordCoChangesImpl, getCoChangeBoost as getCoChangeBoostImpl } from './co-change';
import { getEffectiveConfidence as getEffectiveConfidenceImpl } from './confidence';
import { getSilentDismissalCount } from './feedback';

export { recordFeedback, getSilentDismissalCount, getSilentDismissalPRs, checkPositiveFeedbackRevocation, isValidQuickPickReason } from './feedback';
export { processQuickPick } from './quick-pick';
export { checkCountBasedExclusion, getCountBasedRule } from './count-exclusion';
export { isClaimSuppressed, getActiveRules } from './suppression';
export { recordCoChanges, getCoChangeBoost } from './co-change';
export { getEffectiveConfidence } from './confidence';

/**
 * L7 Learning Service Stub.
 * Returns neutral values so L2 and L3 can run without DB-backed learning.
 * Implements LearningService interface from phase4-api-contracts.md.
 */
export class LearningServiceStub implements LearningService {
  async recordFeedback(_feedback: Omit<FeedbackRecord, 'id' | 'created_at'>): Promise<FeedbackRecord> {
    return {
      id: 'stub',
      ..._feedback,
      created_at: new Date(),
    } as FeedbackRecord;
  }

  async processQuickPick(_claimId: string, _reason: QuickPickReason, _repoId: string): Promise<SuppressionRule | null> {
    return null;
  }

  async checkCountBasedExclusion(_claimId: string): Promise<boolean> {
    return false;
  }

  async isClaimSuppressed(_claim: Claim): Promise<boolean> {
    return false;
  }

  async getActiveRules(_repoId: string): Promise<SuppressionRule[]> {
    return [];
  }

  async recordCoChanges(
    _repoId: string,
    _codeFiles: string[],
    _docFiles: string[],
    _commitSha: string,
  ): Promise<void> {
    // no-op
  }

  async getCoChangeBoost(
    _repoId: string,
    _codeFile: string,
    _docFile: string,
  ): Promise<number> {
    return 0.0;
  }

  getEffectiveConfidence(result: VerificationResult): number {
    return result.confidence;
  }
}

/**
 * Create a LearningService backed by PostgreSQL.
 * TDD-7 Section 9.2.
 */
export function createLearningService(pool?: Pool): LearningService {
  if (!pool) {
    return new LearningServiceStub();
  }

  return {
    async recordFeedback(feedback) {
      const record = await recordFeedbackImpl(pool, feedback);

      // Side effects based on feedback type
      if (feedback.feedback_type === 'thumbs_down' && !feedback.quick_pick_reason) {
        // Silent dismissal - check count-based exclusion
        const count = await getSilentDismissalCount(pool, feedback.claim_id);
        if (count >= 2) {
          await checkCountBasedExclusionImpl(pool, feedback.claim_id);
        }
      } else if (feedback.feedback_type === 'fix_dismissed') {
        // fix_dismissed counts as silent dismissal
        const count = await getSilentDismissalCount(pool, feedback.claim_id);
        if (count >= 2) {
          await checkCountBasedExclusionImpl(pool, feedback.claim_id);
        }
      } else if (feedback.feedback_type === 'thumbs_up') {
        await checkPositiveFeedbackRevocation(pool, feedback.claim_id, feedback.repo_id);
      }

      return record;
    },

    async processQuickPick(claimId, reason, repoId) {
      return processQuickPickImpl(pool, claimId, reason, repoId);
    },

    async checkCountBasedExclusion(claimId) {
      return checkCountBasedExclusionImpl(pool, claimId);
    },

    async isClaimSuppressed(claim) {
      return isClaimSuppressedImpl(pool, claim);
    },

    async getActiveRules(repoId) {
      return getActiveRulesImpl(pool, repoId);
    },

    async recordCoChanges(repoId, codeFiles, docFiles, commitSha) {
      return recordCoChangesImpl(pool, repoId, codeFiles, docFiles, commitSha);
    },

    async getCoChangeBoost(repoId, codeFile, docFile) {
      return getCoChangeBoostImpl(pool, repoId, codeFile, docFile);
    },

    getEffectiveConfidence(result) {
      return getEffectiveConfidenceImpl(result);
    },
  };
}
