import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { findCloseMatch } from './close-match';
import { makeResult } from './result-helpers';

/**
 * Tier 1: Verify command claims.
 * TDD-3 Appendix A.2.
 */
// Runners whose scripts can be verified against manifest files
const VERIFIABLE_RUNNERS = new Set([
  'npm', 'yarn', 'pnpm', 'bun', 'pip', 'pip3', 'poetry', 'cargo',
]);

export async function verifyCommand(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const runner = claim.extracted_value.runner as string | undefined;
  const script = claim.extracted_value.script as string;
  if (!script) return null;

  // Skip verification for non-package-manager runners (docker, make, kubectl, etc.)
  // These commands can't be verified against manifest files
  if (runner && !VERIFIABLE_RUNNERS.has(runner)) return null;

  // Step 1: Exact check
  const exists = await index.scriptExists(claim.repo_id, script);
  if (exists) {
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: [getManifestFile(runner)],
      reasoning: `Script '${script}' exists in ${runner ?? 'package manager'}.`,
    });
  }

  // Step 2: Close match search
  const available = await index.getAvailableScripts(claim.repo_id);
  const closeMatch = findCloseMatch(script, available.map((s) => s.name), 2);
  if (closeMatch) {
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'high' as Severity,
      evidence_files: [getManifestFile(runner)],
      reasoning: `Script '${script}' not found. Close match: '${closeMatch.name}'.`,
      suggested_fix: claim.claim_text.replace(script, closeMatch.name),
      specific_mismatch: `Script '${script}' not found.`,
    });
  }

  // Step 3: Script not found
  return makeResult(claim, {
    verdict: 'drifted',
    severity: 'high' as Severity,
    evidence_files: [],
    reasoning: `Script '${script}' not found.`,
    specific_mismatch: `Script '${script}' not found.`,
  });
}

function getManifestFile(runner?: string): string {
  switch (runner) {
    case 'npm':
    case 'yarn':
    case 'pnpm':
    case 'npx':
    case 'bun':
      return 'package.json';
    case 'pip':
    case 'pip3':
      return 'requirements.txt';
    case 'poetry':
      return 'pyproject.toml';
    case 'cargo':
      return 'Cargo.toml';
    default:
      return 'package.json';
  }
}
