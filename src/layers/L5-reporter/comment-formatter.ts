import type { Finding, PRCommentPayload, CheckConclusion, Severity } from '../../shared/types';
import { sanitizeForMarkdown, sanitizeForCodeBlock } from './sanitize';

const MAX_COMMENT_LENGTH = 65_000;
const MAX_FINDINGS_IN_TABLE = 25;
const MAX_MISMATCH_LENGTH = 80;
const MAX_CLAIM_LENGTH = 200;

export type CommentOutcome = 'no_claims_in_scope' | 'all_verified' | 'findings_found';

const SEVERITY_BADGE: Record<string, string> = {
  high: '🔴 HIGH',
  medium: '🟡 MEDIUM',
  low: '🔵 LOW',
};

const SEVERITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Determine the outcome of a scan from the payload.
 * TDD-5 Section 4.1.
 */
export function determineOutcome(payload: PRCommentPayload): CommentOutcome {
  const unsuppressed = payload.findings.filter((f) => !f.suppressed);
  if (unsuppressed.length === 0 && payload.findings.length === 0) {
    return 'no_claims_in_scope';
  }
  const drifted = unsuppressed.filter((f) => f.result.verdict === 'drifted');
  if (drifted.length === 0) {
    return 'all_verified';
  }
  return 'findings_found';
}

/**
 * Format a single finding for the PR comment.
 * TDD-5 Section 4.4.
 */
export function formatFinding(finding: Finding): string {
  const severity = finding.result.severity || 'medium';
  const badge = SEVERITY_BADGE[severity] || SEVERITY_BADGE.medium;

  const mismatch = truncate(
    sanitizeForMarkdown(finding.result.specific_mismatch || finding.result.reasoning || 'Documentation drift detected'),
    MAX_MISMATCH_LENGTH,
  );
  const claimText = truncate(sanitizeForMarkdown(finding.claim.claim_text), MAX_CLAIM_LENGTH);

  const lines: string[] = [];
  lines.push(`### ${badge}: ${mismatch}`);
  lines.push('');
  lines.push(`**docs:** \`${sanitizeForMarkdown(finding.claim.source_file)}\` line ${finding.claim.line_number}`);
  lines.push(`**claim:** "${claimText}"`);

  if (finding.result.evidence_files && finding.result.evidence_files.length > 0) {
    const files = finding.result.evidence_files.map((f) => `\`${sanitizeForMarkdown(f)}\``).join(', ');
    lines.push(`**evidence:** ${files}`);
  }

  if (finding.result.reasoning) {
    lines.push('');
    lines.push(sanitizeForMarkdown(finding.result.reasoning));
  }

  if (finding.fix) {
    lines.push('');
    lines.push('```diff');
    lines.push(`- ${sanitizeForCodeBlock(finding.fix.old_text)}`);
    lines.push(`+ ${sanitizeForCodeBlock(finding.fix.new_text)}`);
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Build the full summary comment body.
 * TDD-5 Section 4.1, Appendix A, G.
 */
export function buildSummaryComment(
  payload: PRCommentPayload,
  scanRunId: string,
  opts?: { forcePush?: boolean },
): string {
  const outcome = determineOutcome(payload);
  const unsuppressed = payload.findings.filter((f) => !f.suppressed);
  const drifted = unsuppressed.filter((f) => f.result.verdict === 'drifted');
  const uncertain = unsuppressed.filter((f) => f.result.verdict === 'uncertain');

  const lines: string[] = [];

  // Marker (for idempotent comment detection)
  lines.push(`<!-- docalign-summary scan-run-id=${scanRunId} -->`);
  lines.push('');

  // Header
  lines.push('## DocAlign Scan Results');
  lines.push('');

  // Banners
  if (opts?.forcePush) {
    lines.push('> ⚠️ **Force push detected:** Results may not reflect latest changes.');
    lines.push('');
  }

  if (payload.agent_unavailable_pct > 20) {
    lines.push(`> ⚠️ **Agent unavailable:** ${payload.agent_unavailable_pct.toFixed(0)}% of claims could not be verified by the agent. Results are based on deterministic checks only.`);
    lines.push('');
  }

  // Outcome-specific content
  if (outcome === 'no_claims_in_scope') {
    lines.push('No documentation claims were affected by this PR.');
    lines.push('');
    lines.push(`Health score: **${formatPercent(payload.health_score.score)}**`);
  } else if (outcome === 'all_verified') {
    lines.push('✅ All documentation claims verified — no drift detected!');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Claims checked | ${unsuppressed.length} |`);
    lines.push(`| Verified | ${unsuppressed.length} |`);
    lines.push(`| Health score | ${formatPercent(payload.health_score.score)} |`);
  } else {
    // findings_found
    lines.push(`Found **${drifted.length}** documentation drift${drifted.length !== 1 ? 's' : ''}:`);
    lines.push('');

    // Summary table
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Claims checked | ${unsuppressed.length} |`);
    lines.push(`| Drifted | ${drifted.length} |`);
    lines.push(`| Verified | ${unsuppressed.filter((f) => f.result.verdict === 'verified').length} |`);
    if (uncertain.length > 0) {
      lines.push(`| Uncertain | ${uncertain.length} |`);
    }
    lines.push(`| Health score | ${formatPercent(payload.health_score.score)} |`);
    lines.push('');

    // Drifted findings (sorted by severity)
    const sortedDrifted = [...drifted].sort((a, b) => {
      const aOrder = SEVERITY_ORDER[a.result.severity || 'medium'] ?? 1;
      const bOrder = SEVERITY_ORDER[b.result.severity || 'medium'] ?? 1;
      return aOrder - bOrder;
    });

    const shown = sortedDrifted.slice(0, MAX_FINDINGS_IN_TABLE);
    for (const finding of shown) {
      lines.push(formatFinding(finding));
      lines.push('');
    }

    if (sortedDrifted.length > MAX_FINDINGS_IN_TABLE) {
      lines.push(`<details><summary>${sortedDrifted.length - MAX_FINDINGS_IN_TABLE} more findings not shown</summary>`);
      lines.push('');
      for (const finding of sortedDrifted.slice(MAX_FINDINGS_IN_TABLE)) {
        lines.push(formatFinding(finding));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }

    // Uncertain section (collapsible)
    if (uncertain.length > 0) {
      lines.push('<details><summary>Uncertain claims</summary>');
      lines.push('');
      for (const finding of uncertain) {
        lines.push(`- \`${sanitizeForMarkdown(finding.claim.source_file)}\` line ${finding.claim.line_number}: ${truncate(sanitizeForMarkdown(finding.claim.claim_text), 100)}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  // Footer
  lines.push('');
  lines.push('---');
  lines.push(`*Generated by [DocAlign](https://github.com/docalign) • scan \`${scanRunId.slice(0, 8)}\`*`);

  let result = lines.join('\n');

  // Truncate if exceeds limit
  if (result.length > MAX_COMMENT_LENGTH) {
    result = truncateComment(result, scanRunId);
  }

  return result;
}

/**
 * Determine Check Run conclusion from payload.
 * TDD-5 Appendix F.
 *
 * - Zero drifted unsuppressed: 'success'
 * - Any severity >= min_severity_to_block (default 'high'): 'action_required'
 * - Otherwise: 'neutral'
 */
export function determineCheckConclusion(
  payload: PRCommentPayload,
  minSeverityToBlock: Severity = 'high',
): CheckConclusion {
  const drifted = payload.findings.filter((f) => !f.suppressed && f.result.verdict === 'drifted');

  if (drifted.length === 0) return 'success';

  const threshold = SEVERITY_ORDER[minSeverityToBlock] ?? 0;
  const hasBlocking = drifted.some((f) => {
    const order = SEVERITY_ORDER[f.result.severity || 'medium'] ?? 1;
    return order <= threshold;
  });

  return hasBlocking ? 'action_required' : 'neutral';
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatPercent(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}

function truncateComment(comment: string, scanRunId: string): string {
  // Keep marker and header, truncate the rest
  const marker = `<!-- docalign-summary scan-run-id=${scanRunId} -->`;
  const truncationNote = '\n\n> ⚠️ This comment was truncated due to length limits. View the full report in the Check Run.';
  const maxContent = MAX_COMMENT_LENGTH - marker.length - truncationNote.length - 100;
  return comment.slice(0, maxContent) + truncationNote;
}
