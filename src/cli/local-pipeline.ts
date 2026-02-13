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
export interface SectionInfo {
  heading: string;
  level: number;
  startLine: number; // 1-based, inclusive
  endLine: number;   // 1-based, inclusive
}

export interface CliPipeline {
  /**
   * Check a single doc file: extract claims, map, verify Tiers 1-2.
   */
  checkFile(filePath: string, verbose?: boolean): Promise<CheckResult>;

  /**
   * Check a specific section of a doc file by heading.
   * Returns only claims within the section's line range.
   */
  checkSection(filePath: string, heading: string): Promise<CheckResult & { section: SectionInfo }>;

  /**
   * List all section headings in a doc file.
   */
  listSections(filePath: string): string[];

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

/**
 * Find a section in markdown content by heading text.
 * Searches case-insensitively and ignores leading '#' characters.
 */
export function findSection(content: string, heading: string): SectionInfo | null {
  const lines = content.split('\n');
  const headings = parseHeadings(lines);

  const normalizedTarget = heading.toLowerCase().trim();
  const targetIdx = headings.findIndex(
    (h) => h.text.toLowerCase() === normalizedTarget,
  );
  if (targetIdx === -1) return null;

  const target = headings[targetIdx];
  // Section ends at the next heading of same or higher level, or end of file
  const nextIdx = headings.findIndex(
    (h, idx) => idx > targetIdx && h.level <= target.level,
  );
  const endLine = nextIdx >= 0 ? headings[nextIdx].line - 1 : lines.length;

  return {
    heading: target.text,
    level: target.level,
    startLine: target.line,
    endLine: Math.max(endLine, target.line),
  };
}

/**
 * List all markdown headings in content.
 */
export function listHeadings(content: string): Array<{ text: string; level: number; line: number }> {
  return parseHeadings(content.split('\n'));
}

export function parseHeadings(lines: string[]): Array<{ text: string; level: number; line: number }> {
  const headings: Array<{ text: string; level: number; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ text: match[2].trim(), level: match[1].length, line: i + 1 });
    }
  }
  return headings;
}
