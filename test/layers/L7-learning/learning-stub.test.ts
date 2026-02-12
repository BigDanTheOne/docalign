import { describe, it, expect } from 'vitest';
import { LearningServiceStub, createLearningService } from '../../../src/layers/L7-learning';
import type { Claim, LearningService, VerificationResult } from '../../../src/shared/types';

const makeClaim = (overrides?: Partial<Claim>): Claim => ({
  id: 'claim-1',
  repo_id: 'repo-1',
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

describe('LearningServiceStub', () => {
  const stub = new LearningServiceStub();

  it('getCoChangeBoost returns 0.0', async () => {
    const boost = await stub.getCoChangeBoost('repo-1', 'src/app.ts', 'README.md');
    expect(boost).toBe(0.0);
  });

  it('isClaimSuppressed returns false', async () => {
    const suppressed = await stub.isClaimSuppressed(makeClaim());
    expect(suppressed).toBe(false);
  });

  it('recordFeedback returns a stub record', async () => {
    const record = await stub.recordFeedback({
      repo_id: 'repo-1',
      claim_id: 'claim-1',
      verification_result_id: null,
      feedback_type: 'thumbs_up',
      quick_pick_reason: null,
      free_text: null,
      github_user: null,
      pr_number: null,
    });
    expect(record.id).toBe('stub');
  });

  it('processQuickPick returns null', async () => {
    const result = await stub.processQuickPick('claim-1', 'will_fix_later', 'repo-1');
    expect(result).toBeNull();
  });

  it('checkCountBasedExclusion returns false', async () => {
    const result = await stub.checkCountBasedExclusion('claim-1');
    expect(result).toBe(false);
  });

  it('getActiveRules returns empty array', async () => {
    const rules = await stub.getActiveRules('repo-1');
    expect(rules).toEqual([]);
  });

  it('recordCoChanges is a no-op', async () => {
    await stub.recordCoChanges('repo-1', ['src/a.ts'], ['docs/a.md'], 'abc123');
    // no error
  });

  it('getEffectiveConfidence returns raw confidence', () => {
    const result = { confidence: 0.95, created_at: new Date() } as VerificationResult;
    expect(stub.getEffectiveConfidence(result)).toBe(0.95);
  });

  it('satisfies LearningService interface', () => {
    const service: LearningService = stub;
    expect(service.getCoChangeBoost).toBeDefined();
    expect(service.isClaimSuppressed).toBeDefined();
    expect(service.recordFeedback).toBeDefined();
    expect(service.processQuickPick).toBeDefined();
    expect(service.checkCountBasedExclusion).toBeDefined();
    expect(service.getActiveRules).toBeDefined();
    expect(service.recordCoChanges).toBeDefined();
    expect(service.getEffectiveConfidence).toBeDefined();
  });

  it('createLearningService without pool returns stub', () => {
    const service = createLearningService();
    expect(service.getCoChangeBoost).toBeDefined();
    expect(service.isClaimSuppressed).toBeDefined();
    expect(service.recordFeedback).toBeDefined();
  });
});
