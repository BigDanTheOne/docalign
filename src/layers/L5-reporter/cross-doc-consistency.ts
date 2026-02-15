import { randomUUID } from 'crypto';
import type { Claim, Finding, VerificationResult } from '../../shared/types';

/**
 * Find cross-document inconsistencies: when the same entity is documented
 * differently across multiple doc files.
 *
 * Groups claims by semantic identity (same entity name, same config key,
 * same dependency name). For each group with claims from 2+ different
 * source files, compares extracted values. If values differ, generates
 * a Finding with a synthetic VerificationResult.
 */
export function findCrossDocInconsistencies(
  claims: Claim[],
  _results: VerificationResult[],
): Finding[] {
  const findings: Finding[] = [];

  // Group claims by semantic identity
  const groups = groupByIdentity(claims);

  for (const [_key, group] of groups) {
    // Only check groups with claims from 2+ different source files
    const uniqueFiles = new Set(group.map((c) => c.source_file));
    if (uniqueFiles.size < 2) continue;

    const inconsistencies = findValueInconsistencies(group);
    for (const inconsistency of inconsistencies) {
      const syntheticResult: VerificationResult = {
        id: randomUUID(),
        claim_id: inconsistency.claim.id,
        repo_id: inconsistency.claim.repo_id,
        scan_run_id: null,
        verdict: 'drifted',
        confidence: 0.8,
        tier: 2,
        severity: 'medium',
        reasoning: inconsistency.reasoning,
        specific_mismatch: inconsistency.mismatch,
        suggested_fix: null,
        evidence_files: inconsistency.evidence_files,
        token_cost: null,
        duration_ms: null,
        post_check_result: null,
        verification_path: null,
        created_at: new Date(),
      };

      findings.push({
        claim: inconsistency.claim,
        result: syntheticResult,
        fix: null,
        suppressed: false,
      });
    }
  }

  return findings;
}

interface Inconsistency {
  claim: Claim;
  reasoning: string;
  mismatch: string;
  evidence_files: string[];
}

function groupByIdentity(claims: Claim[]): Map<string, Claim[]> {
  const groups = new Map<string, Claim[]>();

  for (const claim of claims) {
    const key = getGroupKey(claim);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(claim);
  }

  return groups;
}

function getGroupKey(claim: Claim): string | null {
  switch (claim.claim_type) {
    case 'dependency_version': {
      const pkg = claim.extracted_value.package as string | undefined;
      return pkg ? `dep:${pkg}` : null;
    }
    case 'config': {
      const configKey = claim.extracted_value.key as string | undefined;
      return configKey ? `config:${configKey}` : null;
    }
    case 'environment': {
      const envVar = claim.extracted_value.env_var as string | undefined;
      return envVar ? `env:${envVar}` : null;
    }
    case 'command': {
      const script = claim.extracted_value.script as string | undefined;
      return script ? `cmd:${script}` : null;
    }
    default:
      return null;
  }
}

function findValueInconsistencies(group: Claim[]): Inconsistency[] {
  const inconsistencies: Inconsistency[] = [];

  // Compare values pairwise — report the first divergence found
  const valueMap = new Map<string, Claim>();

  for (const claim of group) {
    const value = extractComparableValue(claim);
    if (!value) continue;

    for (const [existingValue, existingClaim] of valueMap) {
      if (existingValue !== value) {
        inconsistencies.push({
          claim,
          reasoning: `Cross-doc inconsistency: '${claim.source_file}' says '${value}' but '${existingClaim.source_file}' says '${existingValue}'.`,
          mismatch: `Conflicting values across documents: '${value}' vs '${existingValue}'.`,
          evidence_files: [claim.source_file, existingClaim.source_file],
        });
        break; // One inconsistency per claim is enough
      }
    }

    valueMap.set(value, claim);
  }

  return inconsistencies;
}

function extractComparableValue(claim: Claim): string | null {
  switch (claim.claim_type) {
    case 'dependency_version':
      return (claim.extracted_value.version as string) ?? null;
    case 'config':
      return (claim.extracted_value.value as string)?.toString() ?? null;
    case 'environment':
      return (claim.extracted_value.value as string) ?? null;
    case 'command':
      return (claim.extracted_value.script as string) ?? null;
    default:
      return null;
  }
}
