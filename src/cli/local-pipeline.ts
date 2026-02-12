/**
 * Local pipeline interface for CLI commands.
 * Abstracts the L0-L3 pipeline for testability.
 */

import type { Claim, VerificationResult } from '../shared/types';

export interface DocFix {
  file: string;
  line_start: number;
  line_end: number;
  old_text: string;
  new_text: string;
  reason: string;
  claim_id: string;
  confidence: number;
}

export interface CheckResult {
  claims: Claim[];
  results: VerificationResult[];
  fixes: DocFix[];
  durationMs: number;
}

export interface ScanFileResult {
  file: string;
  claims: Claim[];
  results: VerificationResult[];
  fixes: DocFix[];
}

export interface ScanResult {
  files: ScanFileResult[];
  totalClaims: number;
  totalVerified: number;
  totalDrifted: number;
  totalUncertain: number;
  durationMs: number;
}

/**
 * Pipeline interface used by CLI commands.
 * Real implementation wires L0-L3 layers against local filesystem.
 * Mock implementation used in tests.
 */
export interface CliPipeline {
  /**
   * Check a single doc file: extract claims, map, verify Tiers 1-2.
   */
  checkFile(filePath: string, verbose?: boolean): Promise<CheckResult>;

  /**
   * Scan all doc files in the repository.
   * @param onProgress - called with (current, total) during verification
   * @param exclude - file names/patterns to exclude from scanning
   */
  scanRepo(onProgress?: (current: number, total: number) => void, exclude?: string[]): Promise<ScanResult>;

  /**
   * Get stored fixes from a previous check/scan.
   * @param targetFile - optional, filter to a single file
   */
  getStoredFixes(targetFile?: string): Promise<DocFix[]>;

  /**
   * Mark fixes as applied in storage.
   */
  markFixesApplied(fixIds: string[]): Promise<void>;
}

/**
 * Filter results to exclude uncertain claims (GATE42-021).
 */
export function filterUncertain(results: VerificationResult[]): VerificationResult[] {
  return results.filter((r) => r.verdict !== 'uncertain');
}

/**
 * Count verdicts in a set of results.
 */
export function countVerdicts(results: VerificationResult[]): {
  verified: number;
  drifted: number;
  uncertain: number;
} {
  let verified = 0;
  let drifted = 0;
  let uncertain = 0;
  for (const r of results) {
    if (r.verdict === 'verified') verified++;
    else if (r.verdict === 'drifted') drifted++;
    else uncertain++;
  }
  return { verified, drifted, uncertain };
}

/**
 * Build hotspots from scan results, sorted by drifted count descending.
 */
export function buildHotspots(
  files: ScanFileResult[],
): Array<{ file: string; driftedCount: number }> {
  const hotspots: Array<{ file: string; driftedCount: number }> = [];
  for (const f of files) {
    const drifted = f.results.filter(
      (r) => r.verdict === 'drifted',
    ).length;
    if (drifted > 0) {
      hotspots.push({ file: f.file, driftedCount: drifted });
    }
  }
  return hotspots.sort((a, b) => b.driftedCount - a.driftedCount);
}
