import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { compareVersions } from './version-comparison';
import { makeResult } from './result-helpers';

/**
 * Tier 1: Verify dependency_version claims.
 * TDD-3 Appendix A.3.
 */
export async function verifyDependencyVersion(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const pkgName = claim.extracted_value.package as string;
  const claimedVersion = claim.extracted_value.version as string;
  if (!pkgName) return null;

  // Step 1: Lookup actual version
  const dep = await index.getDependencyVersion(claim.repo_id, pkgName);
  if (!dep) {
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'high' as Severity,
      evidence_files: [],
      reasoning: `Package '${pkgName}' not found.`,
      specific_mismatch: 'Package is not a dependency.',
    });
  }

  // Step 2: Version comparison
  if (!claimedVersion) {
    // No version claimed, package exists — verified
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: ['package.json'],
      reasoning: `Package '${pkgName}' is a dependency.`,
    });
  }

  const comparison = compareVersions(claimedVersion, dep.version, dep.source);
  if (comparison.matches) {
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: ['package.json'],
      reasoning: `Package '${pkgName}' version '${dep.version}' matches documented '${claimedVersion}'.`,
    });
  }

  // Step 3: Version mismatch
  return makeResult(claim, {
    verdict: 'drifted',
    severity: 'medium' as Severity,
    evidence_files: ['package.json'],
    reasoning: `Doc says '${pkgName} ${claimedVersion}' but actual is '${dep.version}'.`,
    suggested_fix: claim.claim_text.replace(claimedVersion, dep.version),
    specific_mismatch: `Version mismatch: documented '${claimedVersion}', actual '${dep.version}'.`,
  });
}
