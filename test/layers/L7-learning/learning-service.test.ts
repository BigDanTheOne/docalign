import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import {
  createLearningService,
  recordFeedback,
  getSilentDismissalCount,
  getSilentDismissalPRs,
  checkPositiveFeedbackRevocation,
  isValidQuickPickReason,
} from '../../../src/layers/L7-learning';
import { processQuickPick } from '../../../src/layers/L7-learning/quick-pick';
import { checkCountBasedExclusion } from '../../../src/layers/L7-learning/count-exclusion';
import { isClaimSuppressed, getActiveRules } from '../../../src/layers/L7-learning/suppression';
import { recordCoChanges, getCoChangeBoost } from '../../../src/layers/L7-learning/co-change';
import { getEffectiveConfidence } from '../../../src/layers/L7-learning/confidence';
import type { Claim, VerificationResult } from '../../../src/shared/types';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

const makeClaim = (overrides?: Partial<Claim>): Claim => ({
  id: randomUUID(),
  repo_id: 'temp', // will be overridden
  source_file: 'README.md',
  line_number: 1,
  claim_text: 'test claim',
  claim_type: 'path_reference',
  testability: 'syntactic',
  extracted_value: {},
  keywords: [],
  extraction_confidence: 1.0,
  extraction_method: 'regex',
  verification_status: 'pending',
  last_verified_at: null,
  embedding: null,
  last_verification_result_id: null,
  parent_claim_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

// ================================================================
// E6-5: Confidence Decay (pure function, no DB needed)
// ================================================================

describe('getEffectiveConfidence', () => {
  it('returns raw confidence for fresh result', () => {
    const result = {
      confidence: 0.95,
      created_at: new Date(),
    } as VerificationResult;
    const effective = getEffectiveConfidence(result);
    expect(effective).toBeCloseTo(0.95, 1);
  });

  it('returns ~50% confidence at half-life (180 days)', () => {
    const halfLifeAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const result = {
      confidence: 0.90,
      created_at: halfLifeAgo,
    } as VerificationResult;
    const effective = getEffectiveConfidence(result);
    expect(effective).toBeCloseTo(0.45, 1);
  });

  it('returns near-zero for very old result', () => {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const result = {
      confidence: 0.90,
      created_at: yearAgo,
    } as VerificationResult;
    const effective = getEffectiveConfidence(result);
    expect(effective).toBeLessThan(0.3);
    expect(effective).toBeGreaterThan(0);
  });

  it('never returns negative', () => {
    const veryOld = new Date(Date.now() - 3650 * 24 * 60 * 60 * 1000);
    const result = {
      confidence: 0.5,
      created_at: veryOld,
    } as VerificationResult;
    const effective = getEffectiveConfidence(result);
    expect(effective).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for zero confidence', () => {
    const result = {
      confidence: 0.0,
      created_at: new Date(),
    } as VerificationResult;
    expect(getEffectiveConfidence(result)).toBe(0);
  });
});

describe('isValidQuickPickReason', () => {
  it('validates known reasons', () => {
    expect(isValidQuickPickReason('will_fix_later')).toBe(true);
    expect(isValidQuickPickReason('docs_are_aspirational')).toBe(true);
    expect(isValidQuickPickReason('this_is_correct')).toBe(true);
    expect(isValidQuickPickReason('not_relevant_to_this_file')).toBe(true);
    expect(isValidQuickPickReason('intentionally_different')).toBe(true);
  });

  it('rejects unknown reasons', () => {
    expect(isValidQuickPickReason('unknown')).toBe(false);
    expect(isValidQuickPickReason('')).toBe(false);
  });
});

// ================================================================
// DB-backed tests: E6-1 through E6-3
// ================================================================

const describeDbBacked = process.env.CI && !process.env.DATABASE_URL ? describe.skip : describe;

describeDbBacked('L7 Learning Service (DB-backed)', () => {
  let pool: Pool;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'l7-test', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM co_changes WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM feedback WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM suppression_rules WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM co_changes WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM feedback WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM suppression_rules WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
  });

  async function insertClaim(overrides?: Partial<Claim>): Promise<Claim> {
    const claim = makeClaim({ repo_id: repoId, ...overrides });
    const result = await pool.query(
      `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type,
         testability, extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
       RETURNING *`,
      [
        claim.id, repoId, claim.source_file, claim.line_number, claim.claim_text,
        claim.claim_type, claim.testability, JSON.stringify(claim.extracted_value),
        claim.keywords, claim.extraction_confidence, claim.extraction_method,
      ],
    );
    return { ...result.rows[0], extracted_value: result.rows[0].extracted_value } as Claim;
  }

  // ================================================================
  // E6-1: Feedback Recording
  // ================================================================

  describe('recordFeedback', () => {
    it('records thumbs_up feedback', async () => {
      const record = await recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'thumbs_up',
        quick_pick_reason: null,
        free_text: null,
        github_user: 'dev-alice',
        pr_number: 42,
      });
      expect(record.id).toBeDefined();
      expect(record.feedback_type).toBe('thumbs_up');
      expect(record.pr_number).toBe(42);
    });

    it('records thumbs_down feedback', async () => {
      const record = await recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'thumbs_down',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: null,
      });
      expect(record.feedback_type).toBe('thumbs_down');
    });

    it('records thumbs_down with quick_pick_reason', async () => {
      const record = await recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'thumbs_down',
        quick_pick_reason: 'will_fix_later',
        free_text: null,
        github_user: null,
        pr_number: null,
      });
      expect(record.quick_pick_reason).toBe('will_fix_later');
    });

    it('records all_dismissed feedback', async () => {
      const record = await recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'all_dismissed',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: null,
      });
      expect(record.feedback_type).toBe('all_dismissed');
    });

    it('records fix_accepted feedback', async () => {
      const record = await recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'fix_accepted',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: null,
      });
      expect(record.feedback_type).toBe('fix_accepted');
    });

    it('records fix_dismissed feedback', async () => {
      const record = await recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'fix_dismissed',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: null,
      });
      expect(record.feedback_type).toBe('fix_dismissed');
    });

    it('throws on missing repo_id', async () => {
      await expect(recordFeedback(pool, {
        repo_id: '',
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'thumbs_up',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: null,
      })).rejects.toThrow('repo_id and claim_id are required');
    });

    it('throws on invalid feedback_type', async () => {
      await expect(recordFeedback(pool, {
        repo_id: repoId,
        claim_id: randomUUID(),
        verification_result_id: null,
        feedback_type: 'maybe' as never,
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: null,
      })).rejects.toThrow('Invalid feedback_type');
    });
  });

  describe('getSilentDismissalCount', () => {
    it('counts silent thumbs_down', async () => {
      const claimId = randomUUID();
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 1 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 2 });
      expect(await getSilentDismissalCount(pool, claimId)).toBe(2);
    });

    it('excludes thumbs_down with quick_pick_reason', async () => {
      const claimId = randomUUID();
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: 'will_fix_later', free_text: null, github_user: null, pr_number: 1 });
      expect(await getSilentDismissalCount(pool, claimId)).toBe(0);
    });

    it('excludes all_dismissed (0x weight)', async () => {
      const claimId = randomUUID();
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'all_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 1 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'all_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 2 });
      expect(await getSilentDismissalCount(pool, claimId)).toBe(0);
    });

    it('counts fix_dismissed', async () => {
      const claimId = randomUUID();
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'fix_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 1 });
      expect(await getSilentDismissalCount(pool, claimId)).toBe(1);
    });
  });

  describe('getSilentDismissalPRs', () => {
    it('returns distinct PR numbers', async () => {
      const claimId = randomUUID();
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 112 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claimId, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 118 });
      const prs = await getSilentDismissalPRs(pool, claimId);
      expect(prs).toEqual([112, 118]);
    });
  });

  // ================================================================
  // E6-1: Quick-Pick Processing
  // ================================================================

  describe('processQuickPick', () => {
    it('creates claim-level rule for will_fix_later', async () => {
      const claim = await insertClaim();
      const rule = await processQuickPick(pool, claim.id, 'will_fix_later', repoId);
      expect(rule).not.toBeNull();
      expect(rule!.scope).toBe('claim');
      expect(rule!.target_claim_id).toBe(claim.id);
      expect(rule!.reason).toBe('Known issue, will fix later');
      expect(rule!.source).toBe('quick_pick');
      expect(rule!.expires_at).not.toBeNull();
    });

    it('creates claim-level rule for not_relevant_to_this_file (180d)', async () => {
      const claim = await insertClaim();
      const rule = await processQuickPick(pool, claim.id, 'not_relevant_to_this_file', repoId);
      expect(rule).not.toBeNull();
      expect(rule!.scope).toBe('claim');
      expect(rule!.reason).toBe('Not relevant to this file');
    });

    it('creates claim-level rule for intentionally_different (90d)', async () => {
      const claim = await insertClaim();
      const rule = await processQuickPick(pool, claim.id, 'intentionally_different', repoId);
      expect(rule).not.toBeNull();
      expect(rule!.scope).toBe('claim');
      expect(rule!.reason).toBe('Intentionally different from docs');
    });

    it('creates file-level rule for docs_are_aspirational', async () => {
      const claim = await insertClaim({ source_file: 'docs/future-api.md' });
      const rule = await processQuickPick(pool, claim.id, 'docs_are_aspirational', repoId);
      expect(rule).not.toBeNull();
      expect(rule!.scope).toBe('file');
      expect(rule!.target_file).toBe('docs/future-api.md');
      expect(rule!.reason).toBe('Doc file is aspirational (not current reality)');
    });

    it('creates claim-level rule for this_is_correct (180d)', async () => {
      const claim = await insertClaim();
      const rule = await processQuickPick(pool, claim.id, 'this_is_correct', repoId);
      expect(rule).not.toBeNull();
      expect(rule!.scope).toBe('claim');
      expect(rule!.reason).toBe('False positive -- docs are correct');
    });

    it('returns null for deleted claim', async () => {
      const rule = await processQuickPick(pool, randomUUID(), 'will_fix_later', repoId);
      expect(rule).toBeNull();
    });

    it('extends expiry for duplicate quick-pick', async () => {
      const claim = await insertClaim();
      const rule1 = await processQuickPick(pool, claim.id, 'will_fix_later', repoId);
      expect(rule1).not.toBeNull();

      // Second quick-pick should extend the expiry
      const rule2 = await processQuickPick(pool, claim.id, 'will_fix_later', repoId);
      expect(rule2).not.toBeNull();
      expect(rule2!.id).toBe(rule1!.id); // same rule, extended
    });
  });

  // ================================================================
  // E6-2: Count-Based Exclusion
  // ================================================================

  describe('checkCountBasedExclusion', () => {
    it('creates permanent suppression at threshold 2', async () => {
      const claim = await insertClaim();

      // Two silent thumbs_down
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 112 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 118 });

      const excluded = await checkCountBasedExclusion(pool, claim.id);
      expect(excluded).toBe(true);

      // Check the rule is permanent (no expiry)
      const rules = await getActiveRules(pool, repoId);
      const countRule = rules.find(r => r.source === 'count_based' && r.target_claim_id === claim.id);
      expect(countRule).toBeDefined();
      expect(countRule!.expires_at).toBeNull();
      expect(countRule!.reason).toContain('Silently dismissed 2 times');
      expect(countRule!.reason).toContain('112');
      expect(countRule!.reason).toContain('118');
    });

    it('returns false if threshold not met (1 dismissal)', async () => {
      const claim = await insertClaim();

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 115 });

      const excluded = await checkCountBasedExclusion(pool, claim.id);
      expect(excluded).toBe(false);
    });

    it('all_dismissed does not count toward threshold', async () => {
      const claim = await insertClaim();

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'all_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 100 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'all_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 105 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 110 });

      const excluded = await checkCountBasedExclusion(pool, claim.id);
      expect(excluded).toBe(false); // only 1 silent dismissal
    });

    it('thumbs_down with quick_pick does not count', async () => {
      const claim = await insertClaim();

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: 'will_fix_later', free_text: null, github_user: null, pr_number: 100 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: 'this_is_correct', free_text: null, github_user: null, pr_number: 105 });

      const excluded = await checkCountBasedExclusion(pool, claim.id);
      expect(excluded).toBe(false); // 0 silent dismissals
    });

    it('fix_dismissed counts toward threshold', async () => {
      const claim = await insertClaim();

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'fix_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 100 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'fix_dismissed', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 105 });

      const excluded = await checkCountBasedExclusion(pool, claim.id);
      expect(excluded).toBe(true);
    });

    it('already excluded returns true without duplicate rule', async () => {
      const claim = await insertClaim();

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 112 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 118 });

      const first = await checkCountBasedExclusion(pool, claim.id);
      expect(first).toBe(true);

      const second = await checkCountBasedExclusion(pool, claim.id);
      expect(second).toBe(true);

      // Should only have 1 rule
      const rules = await pool.query(
        `SELECT * FROM suppression_rules
         WHERE target_claim_id = $1 AND source = 'count_based' AND revoked = false`,
        [claim.id],
      );
      expect(rules.rows.length).toBe(1);
    });

    it('returns false for deleted claim', async () => {
      const excluded = await checkCountBasedExclusion(pool, randomUUID());
      expect(excluded).toBe(false);
    });

    it('updates claim verification_status to pending', async () => {
      const claim = await insertClaim();

      // Set it to verified first
      await pool.query("UPDATE claims SET verification_status = 'verified' WHERE id = $1", [claim.id]);

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 1 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_down', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 2 });

      await checkCountBasedExclusion(pool, claim.id);

      const updated = await pool.query('SELECT verification_status FROM claims WHERE id = $1', [claim.id]);
      expect(updated.rows[0].verification_status).toBe('pending');
    });
  });

  // ================================================================
  // E6-3: Suppression Evaluation
  // ================================================================

  describe('isClaimSuppressed', () => {
    it('returns true for claim-level suppression', async () => {
      const claim = await insertClaim();

      // Create claim-level suppression rule
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at)
         VALUES ($1, 'claim', $2, 'Test suppression', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId, claim.id],
      );

      expect(await isClaimSuppressed(pool, claim)).toBe(true);
    });

    it('returns true for file-level suppression', async () => {
      const claim = await insertClaim({ source_file: 'docs/future.md' });

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_file, reason, source, expires_at)
         VALUES ($1, 'file', 'docs/future.md', 'Aspirational doc', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId],
      );

      expect(await isClaimSuppressed(pool, claim)).toBe(true);
    });

    it('returns true for claim_type-level suppression', async () => {
      const claim = await insertClaim({ claim_type: 'convention' });

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_type, reason, source, expires_at)
         VALUES ($1, 'claim_type', 'convention', 'Suppress all conventions', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId],
      );

      expect(await isClaimSuppressed(pool, claim)).toBe(true);
    });

    it('returns false when no rules match', async () => {
      const claim = await insertClaim();
      expect(await isClaimSuppressed(pool, claim)).toBe(false);
    });

    it('returns false for expired rule', async () => {
      const claim = await insertClaim();

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at)
         VALUES ($1, 'claim', $2, 'Expired rule', 'quick_pick', NOW() - INTERVAL '1 day')`,
        [repoId, claim.id],
      );

      expect(await isClaimSuppressed(pool, claim)).toBe(false);
    });

    it('returns false for revoked rule', async () => {
      const claim = await insertClaim();

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at, revoked)
         VALUES ($1, 'claim', $2, 'Revoked rule', 'quick_pick', NOW() + INTERVAL '30 days', true)`,
        [repoId, claim.id],
      );

      expect(await isClaimSuppressed(pool, claim)).toBe(false);
    });

    it('claim-level wins over file-level (narrowest scope)', async () => {
      const claim = await insertClaim({ source_file: 'docs/api.md' });

      // File-level rule
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_file, reason, source, expires_at)
         VALUES ($1, 'file', 'docs/api.md', 'File level', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId],
      );

      // Claim-level rule
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at)
         VALUES ($1, 'claim', $2, 'Claim level', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId, claim.id],
      );

      // Both should suppress, but claim-level is checked first
      expect(await isClaimSuppressed(pool, claim)).toBe(true);
    });

    it('permanent rule (null expires_at) suppresses', async () => {
      const claim = await insertClaim();

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at)
         VALUES ($1, 'claim', $2, 'Permanent', 'count_based', NULL)`,
        [repoId, claim.id],
      );

      expect(await isClaimSuppressed(pool, claim)).toBe(true);
    });
  });

  describe('getActiveRules', () => {
    it('returns active rules sorted by scope', async () => {
      const claim = await insertClaim();

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at)
         VALUES ($1, 'claim', $2, 'Claim rule', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId, claim.id],
      );
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_file, reason, source, expires_at)
         VALUES ($1, 'file', 'docs/api.md', 'File rule', 'quick_pick', NOW() + INTERVAL '30 days')`,
        [repoId],
      );

      const rules = await getActiveRules(pool, repoId);
      expect(rules.length).toBeGreaterThanOrEqual(2);
      // claim comes before file alphabetically
      expect(rules[0].scope).toBe('claim');
    });

    it('excludes revoked and expired rules', async () => {
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_file, reason, source, expires_at, revoked)
         VALUES ($1, 'file', 'a.md', 'Revoked', 'quick_pick', NOW() + INTERVAL '30 days', true)`,
        [repoId],
      );
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_file, reason, source, expires_at)
         VALUES ($1, 'file', 'b.md', 'Expired', 'quick_pick', NOW() - INTERVAL '1 day')`,
        [repoId],
      );

      const rules = await getActiveRules(pool, repoId);
      expect(rules.length).toBe(0);
    });

    it('returns empty array for unknown repo', async () => {
      const rules = await getActiveRules(pool, randomUUID());
      expect(rules).toEqual([]);
    });
  });

  // ================================================================
  // E6-1: Positive Feedback Revocation
  // ================================================================

  describe('checkPositiveFeedbackRevocation', () => {
    it('revokes rule after 2 thumbs_up', async () => {
      const claim = await insertClaim();

      // Create a suppression rule
      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at, created_at)
         VALUES ($1, 'claim', $2, 'Test', 'quick_pick', NOW() + INTERVAL '30 days', NOW() - INTERVAL '1 hour')`,
        [repoId, claim.id],
      );

      // 2 thumbs_up after rule creation
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_up', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 1 });
      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_up', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 2 });

      await checkPositiveFeedbackRevocation(pool, claim.id, repoId);

      // Rule should be revoked
      const rules = await getActiveRules(pool, repoId);
      const claimRules = rules.filter(r => r.target_claim_id === claim.id);
      expect(claimRules.length).toBe(0); // revoked, so not in active rules
    });

    it('does not revoke with only 1 thumbs_up', async () => {
      const claim = await insertClaim();

      await pool.query(
        `INSERT INTO suppression_rules (repo_id, scope, target_claim_id, reason, source, expires_at, created_at)
         VALUES ($1, 'claim', $2, 'Test', 'quick_pick', NOW() + INTERVAL '30 days', NOW() - INTERVAL '1 hour')`,
        [repoId, claim.id],
      );

      await recordFeedback(pool, { repo_id: repoId, claim_id: claim.id, verification_result_id: null, feedback_type: 'thumbs_up', quick_pick_reason: null, free_text: null, github_user: null, pr_number: 1 });

      await checkPositiveFeedbackRevocation(pool, claim.id, repoId);

      const rules = await getActiveRules(pool, repoId);
      const claimRules = rules.filter(r => r.target_claim_id === claim.id);
      expect(claimRules.length).toBe(1); // still active
    });
  });

  // ================================================================
  // E6-5: Co-Change Recording & Boost
  // ================================================================

  describe('recordCoChanges', () => {
    it('records co-changes for code x doc cross-product', async () => {
      await recordCoChanges(pool, repoId, ['src/auth.ts', 'src/types.ts'], ['docs/auth.md'], 'abc123');

      const result = await pool.query(
        'SELECT * FROM co_changes WHERE repo_id = $1 ORDER BY code_file',
        [repoId],
      );
      expect(result.rows.length).toBe(2);
      expect(result.rows[0].code_file).toBe('src/auth.ts');
      expect(result.rows[1].code_file).toBe('src/types.ts');
    });

    it('no-ops when code files are empty', async () => {
      await recordCoChanges(pool, repoId, [], ['docs/a.md'], 'abc123');
      const result = await pool.query('SELECT * FROM co_changes WHERE repo_id = $1', [repoId]);
      expect(result.rows.length).toBe(0);
    });

    it('no-ops when doc files are empty', async () => {
      await recordCoChanges(pool, repoId, ['src/a.ts'], [], 'abc123');
      const result = await pool.query('SELECT * FROM co_changes WHERE repo_id = $1', [repoId]);
      expect(result.rows.length).toBe(0);
    });

    it('handles duplicate commit SHA (ON CONFLICT DO NOTHING)', async () => {
      await recordCoChanges(pool, repoId, ['src/a.ts'], ['docs/a.md'], 'abc123');
      await recordCoChanges(pool, repoId, ['src/a.ts'], ['docs/a.md'], 'abc123');

      const result = await pool.query('SELECT * FROM co_changes WHERE repo_id = $1', [repoId]);
      expect(result.rows.length).toBe(1);
    });
  });

  describe('getCoChangeBoost', () => {
    it('returns 0.0 for no co-changes', async () => {
      const boost = await getCoChangeBoost(pool, repoId, 'src/unknown.ts', 'docs/unknown.md');
      expect(boost).toBe(0.0);
    });

    it('returns 0.06 for 3 co-changes', async () => {
      await recordCoChanges(pool, repoId, ['src/a.ts'], ['docs/a.md'], 'sha1');
      await recordCoChanges(pool, repoId, ['src/a.ts'], ['docs/a.md'], 'sha2');
      await recordCoChanges(pool, repoId, ['src/a.ts'], ['docs/a.md'], 'sha3');

      const boost = await getCoChangeBoost(pool, repoId, 'src/a.ts', 'docs/a.md');
      expect(boost).toBeCloseTo(0.06, 2);
    });

    it('caps at 0.1 for 5+ co-changes', async () => {
      for (let i = 0; i < 7; i++) {
        await recordCoChanges(pool, repoId, ['src/b.ts'], ['docs/b.md'], `sha-${i}`);
      }

      const boost = await getCoChangeBoost(pool, repoId, 'src/b.ts', 'docs/b.md');
      expect(boost).toBe(0.1);
    });
  });

  // ================================================================
  // Full LearningService integration
  // ================================================================

  describe('createLearningService (DB-backed)', () => {
    it('satisfies full interface with pool', async () => {
      const service = createLearningService(pool);
      expect(service.recordFeedback).toBeDefined();
      expect(service.processQuickPick).toBeDefined();
      expect(service.checkCountBasedExclusion).toBeDefined();
      expect(service.isClaimSuppressed).toBeDefined();
      expect(service.getActiveRules).toBeDefined();
      expect(service.recordCoChanges).toBeDefined();
      expect(service.getCoChangeBoost).toBeDefined();
      expect(service.getEffectiveConfidence).toBeDefined();
    });

    it('recordFeedback triggers count-based exclusion on 2nd silent thumbs_down', async () => {
      const claim = await insertClaim();
      const service = createLearningService(pool);

      // First silent thumbs_down
      await service.recordFeedback({
        repo_id: repoId,
        claim_id: claim.id,
        verification_result_id: null,
        feedback_type: 'thumbs_down',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: 1,
      });

      // Second silent thumbs_down - should trigger count-based exclusion
      await service.recordFeedback({
        repo_id: repoId,
        claim_id: claim.id,
        verification_result_id: null,
        feedback_type: 'thumbs_down',
        quick_pick_reason: null,
        free_text: null,
        github_user: null,
        pr_number: 2,
      });

      // Claim should now be suppressed
      expect(await service.isClaimSuppressed(claim)).toBe(true);
    });
  });
});
