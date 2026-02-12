import type { LearningService } from '../../shared/types';

/**
 * L7 Learning Service Stub.
 * Returns neutral values so L2 and L3 can run without full learning implementation.
 * Implements LearningService interface from phase4-api-contracts.md.
 */
export class LearningServiceStub implements LearningService {
  async getCoChangeBoost(
    _repoId: string,
    _codeFile: string,
    _docFile: string,
  ): Promise<number> {
    return 0.0;
  }

  async isClaimSuppressed(
    _repoId: string,
    _claimId: string,
  ): Promise<boolean> {
    return false;
  }
}

export function createLearningService(): LearningService {
  return new LearningServiceStub();
}
