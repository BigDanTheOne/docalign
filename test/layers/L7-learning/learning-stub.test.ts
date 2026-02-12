import { describe, it, expect } from 'vitest';
import { LearningServiceStub, createLearningService } from '../../../src/layers/L7-learning';
import type { LearningService } from '../../../src/shared/types';

describe('LearningServiceStub', () => {
  const stub = new LearningServiceStub();

  it('getCoChangeBoost returns 0.0', async () => {
    const boost = await stub.getCoChangeBoost('repo-1', 'src/app.ts', 'README.md');
    expect(boost).toBe(0.0);
  });

  it('isClaimSuppressed returns false', async () => {
    const suppressed = await stub.isClaimSuppressed('repo-1', 'claim-1');
    expect(suppressed).toBe(false);
  });

  it('satisfies LearningService interface', () => {
    const service: LearningService = stub;
    expect(service.getCoChangeBoost).toBeDefined();
    expect(service.isClaimSuppressed).toBeDefined();
  });

  it('createLearningService returns a LearningService', () => {
    const service = createLearningService();
    expect(service.getCoChangeBoost).toBeDefined();
    expect(service.isClaimSuppressed).toBeDefined();
  });
});
