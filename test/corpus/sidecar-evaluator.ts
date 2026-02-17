import type { SidecarFile, Finding } from './types';

/**
 * Evaluates sidecar assertions against in-memory file content.
 * Returns findings only for claims that are 'drifted' (some assertion failed).
 * Verified claims are not included in the returned array.
 */
export function evaluateSidecar(
  sidecarFile: SidecarFile,
  files: Map<string, string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const claim of sidecarFile.claims) {
    let allAssertionsPass = true;

    for (const assertion of claim.evidence_assertions) {
      const fileContent = files.get(assertion.scope);

      if (fileContent === undefined) {
        // File is missing — treat as drifted
        allAssertionsPass = false;
        break;
      }

      const patternFound = fileContent.includes(assertion.pattern);

      if (assertion.expect === 'exists' && !patternFound) {
        allAssertionsPass = false;
        break;
      }

      if (assertion.expect === 'not_exists' && patternFound) {
        allAssertionsPass = false;
        break;
      }
    }

    if (!allAssertionsPass) {
      findings.push({
        claim_id: claim.id,
        claim_type: 'semantic',
        claim_text: claim.claim_text,
        source_file: '',
        verdict: 'drifted',
        severity: null,
        tier: 0,
        is_semantic: true,
      });
    }
  }

  return findings;
}
