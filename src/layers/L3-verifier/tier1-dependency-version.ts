import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { compareVersions } from './version-comparison';
import { findCloseMatch } from './close-match';
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
    // Fuzzy suggestion: find similar package names from manifests
    const manifest = await index.getManifestMetadata(claim.repo_id);
    const allDeps = manifest
      ? [...Object.keys(manifest.dependencies), ...Object.keys(manifest.dev_dependencies)]
      : [];
    const close = findCloseMatch(pkgName, allDeps, 3);
    const suggestion = close ? ` Did you mean '${close.name}'?` : '';
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'high' as Severity,
      evidence_files: [],
      reasoning: `Package '${pkgName}' not found.${suggestion}`,
      specific_mismatch: `Package is not a dependency.${suggestion}`,
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
