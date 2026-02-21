/**
 * CLI output formatting utilities.
 * Respects NO_COLOR and FORCE_COLOR per https://no-color.org/
 */

const NO_COLOR = !!process.env.NO_COLOR || process.env.TERM === 'dumb';
const FORCE_COLOR = !!process.env.FORCE_COLOR;

function useColor(): boolean {
  if (FORCE_COLOR) return true;
  if (NO_COLOR) return false;
  return process.stdout.isTTY ?? false;
}

const ESC = '\x1b[';

const codes = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  boldRed: `${ESC}1;31m`,
  boldWhite: `${ESC}1;37m`,
  boldGreen: `${ESC}1;32m`,
};

function wrap(code: string, text: string): string {
  return useColor() ? `${code}${text}${codes.reset}` : text;
}

export const color = {
  red: (t: string) => wrap(codes.boldRed, t),
  yellow: (t: string) => wrap(codes.yellow, t),
  green: (t: string) => wrap(codes.green, t),
  cyan: (t: string) => wrap(codes.cyan, t),
  dim: (t: string) => wrap(codes.dim, t),
  bold: (t: string) => wrap(codes.boldWhite, t),
  boldGreen: (t: string) => wrap(codes.boldGreen, t),
};

export type Severity = 'high' | 'medium' | 'low';

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'high': return color.red('HIGH');
    case 'medium': return color.yellow('MEDIUM');
    case 'low': return color.dim('LOW');
  }
}

export interface CheckFinding {
  severity: Severity;
  file: string;
  line: number;
  claimText: string;
  actual: string;
  evidenceFiles: string[];
  fix?: string;
}

export interface ScanSummary {
  verified: number;
  drifted: number;
  healthScore: number;
  totalScored: number;
  hotspots: Array<{ file: string; driftedCount: number }>;
}

/**
 * Format check results matching Section 6.2.
 */
export function formatCheckResults(
  file: string,
  claimCount: number,
  durationSec: number,
  verified: number,
  drifted: number,
  findings: CheckFinding[],
): string {
  const lines: string[] = [];

  lines.push(`DocAlign: Checking ${color.cyan(file)}`);
  lines.push(`  Extracting claims... ${claimCount} claims found`);
  lines.push(`  Verifying claims... done (${durationSec.toFixed(1)}s)`);
  lines.push('');
  lines.push(`  Results:`);
  lines.push(`    ${color.green(`${verified} verified`)}   ${drifted > 0 ? color.red(`${drifted} drifted`) : `${drifted} drifted`}`);

  for (const f of findings) {
    lines.push('');
    lines.push(`  ${severityLabel(f.severity)}  ${color.cyan(`${f.file}:${f.line}`)}`);
    lines.push(`    Claim: "${f.claimText}"`);
    lines.push(`    Actual: ${f.actual}`);
    if (f.evidenceFiles.length > 0) {
      lines.push(`    Evidence: ${f.evidenceFiles.join(', ')}`);
    }
    if (f.fix) {
      lines.push(`    Fix: ${f.fix}`);
    }
  }

  if (drifted > 0) {
    lines.push('');
    lines.push(`  ${drifted} issue${drifted !== 1 ? 's' : ''} found. Run \`docalign fix ${file}\` to apply suggested fixes.`);
  }

  return lines.join('\n');
}

/**
 * Format scan results matching Section 6.3.
 */
export function formatScanResults(summary: ScanSummary): string {
  const lines: string[] = [];

  const pct = summary.totalScored > 0
    ? Math.round((summary.verified / summary.totalScored) * 100)
    : 100;
  const scoreColor = pct > 90 ? color.boldGreen : pct > 70 ? color.yellow : color.red;

  lines.push(`  Repository Health: ${scoreColor(`${pct}%`)} (${summary.verified}/${summary.totalScored} scored claims verified)`);
  lines.push('');
  lines.push('  Summary:');
  lines.push(`    ${color.green(`${summary.verified} verified`)}   ${summary.drifted > 0 ? color.red(`${summary.drifted} drifted`) : `${summary.drifted} drifted`}`);

  if (summary.hotspots.length > 0) {
    lines.push('');
    lines.push('  Hotspots:');
    for (const hs of summary.hotspots) {
      const padded = hs.file.padEnd(20);
      lines.push(`    ${color.cyan(padded)} ${hs.driftedCount} drifted`);
    }
  }

  if (summary.drifted > 0) {
    lines.push('');
    lines.push('  Run `docalign check <file>` for details on specific files.');
  }

  return lines.join('\n');
}

/**
 * Format fix results matching Section 6.4.
 */
export function formatFixResults(
  applied: Array<{ file: string; line: number; description: string }>,
  failed: Array<{ file: string; line: number; reason: string }>,
  filesModified: string[],
  targetFile?: string,
): string {
  const lines: string[] = [];

  if (targetFile) {
    lines.push(`DocAlign: Applying fixes to ${color.cyan(targetFile)}`);
  } else {
    lines.push('DocAlign: Applying all available fixes');
  }

  if (applied.length > 0) {
    lines.push(`  ${applied.length} fix${applied.length !== 1 ? 'es' : ''} applied:`);
    for (const a of applied) {
      const prefix = targetFile ? `Line ${a.line}` : `${color.cyan(`${a.file}:${a.line}`)}`;
      lines.push(`    ${prefix}: ${a.description}`);
    }
  }

  if (failed.length > 0) {
    lines.push('');
    lines.push(`  ${failed.length} fix could not be applied:`);
    for (const f of failed) {
      const prefix = targetFile ? `Line ${f.line}` : `${color.cyan(`${f.file}:${f.line}`)}`;
      lines.push(`    ${prefix}: ${f.reason}`);
    }
  }

  if (filesModified.length > 0) {
    lines.push('');
    lines.push(`  Files modified: ${filesModified.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Simple progress bar for scan verification phase.
 */
export function progressBar(current: number, total: number, width = 40): string {
  if (NO_COLOR && !FORCE_COLOR) {
    return `  ${current}/${total} claims verified`;
  }
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `    [${color.green('='.repeat(filled))}${' '.repeat(empty)}] ${current}/${total} claims`;
}

/**
 * Interface for stale claim information in PR comments.
 */
export interface StaleClaim {
  file: string;
  line: number;
  claimText: string;
  actual: string;
  severity?: string;
}

/**
 * Format scan results as a GitHub PR comment with upsert marker.
 * Includes total claims, stale count, status indicator, and collapsible details.
 * Truncates at 65536 characters if needed.
 */
export function formatGitHubPRComment(
  totalClaims: number,
  staleClaims: StaleClaim[],
): string {
  const staleCount = staleClaims.length;
  const statusIcon = staleCount === 0 ? '✅' : '❌';

  const lines: string[] = [];

  // Upsert marker (AC3)
  lines.push('<!-- docalign-report -->');
  lines.push('');

  // Status indicator and summary (AC1, AC4)
  lines.push(`## ${statusIcon} DocAlign Report`);
  lines.push('');

  // Total claims and stale count (AC2)
  lines.push(`**Total claims checked:** ${totalClaims}`);
  lines.push(`**Stale claims found:** ${staleCount}`);
  lines.push('');

  // Collapsible details if there are stale claims (AC5)
  if (staleCount > 0) {
    lines.push('<details>');
    lines.push('<summary>View stale claims</summary>');
    lines.push('');
    lines.push('| File | Line | Claim | Issue |');
    lines.push('|------|------|-------|-------|');

    for (const claim of staleClaims) {
      const file = claim.file.replace(/\|/g, '\\|');
      const claimText = claim.claimText.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const actual = claim.actual.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${file} | ${claim.line} | ${claimText} | ${actual} |`);
    }

    lines.push('');
    lines.push('</details>');
  } else {
    lines.push('All documentation claims are verified and up to date! 🎉');
  }

  let output = lines.join('\n');

  // Truncation at 65536 characters
  const MAX_LENGTH = 65536;
  if (output.length > MAX_LENGTH) {
    // Count how many claims were included before truncation
    const truncatePoint = MAX_LENGTH - 200; // Reserve space for truncation message
    output = output.slice(0, truncatePoint);

    // Find the last complete table row
    const lastRowEnd = output.lastIndexOf('|\n');
    if (lastRowEnd !== -1) {
      output = output.slice(0, lastRowEnd + 2);
    }

    // Calculate how many claims were cut off
    const includedRows = (output.match(/\| [^|]+ \| \d+ \|/g) || []).length;
    const remainingClaims = staleCount - includedRows;

    if (remainingClaims > 0) {
      output += `\n\n_... ${remainingClaims} more items truncated due to size limits_\n`;
      output += '\n</details>';
    }
  }

  return output;
}
