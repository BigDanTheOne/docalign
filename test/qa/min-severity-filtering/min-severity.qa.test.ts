/**
 * QA Acceptance Tests — T2: Min-Severity Filtering in PR Comment Formatter
 *
 * Tests that min-severity filtering works end-to-end:
 * 1. buildSummaryComment respects minSeverity filter
 * 2. determineCheckConclusion respects the same threshold
 * 3. Default behavior includes all findings
 * 4. action.yml passes min-severity input to scan command
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSummaryComment,
  determineCheckConclusion,
} from '../../../../src/layers/L5-reporter/comment-formatter';
import type { PRCommentPayload, Finding, Severity } from '../../../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(severity: Severity, verdict: 'drifted' | 'verified' = 'drifted'): Finding {
  return {
    claim: {
      claim_id: `claim-${severity}`,
      claim_text: `A ${severity} severity claim`,
      source_file: 'docs/README.md',
      line_number: 10,
      category: 'api',
    },
    result: {
      verdict,
      severity,
      reasoning: `This is a ${severity} finding`,
      specific_mismatch: `Mismatch at ${severity} level`,
      evidence_files: ['src/index.ts'],
    },
    suppressed: false,
  } as Finding;
}

function makePayload(findings: Finding[]): PRCommentPayload {
  return {
    findings,
    health_score: { score: 0.85, total_claims: 10, verified_claims: 8 },
    agent_unavailable_pct: 0,
    scan_metadata: { commit_sha: 'abc123', base_sha: 'def456' },
  } as PRCommentPayload;
}

// ---------------------------------------------------------------------------
// T2-AC1: buildSummaryComment filters findings by minSeverity
// ---------------------------------------------------------------------------
describe('T2: buildSummaryComment with minSeverity filter', () => {
  const highFinding = makeFinding('high');
  const mediumFinding = makeFinding('medium');
  const lowFinding = makeFinding('low');
  const payload = makePayload([highFinding, mediumFinding, lowFinding]);

  it('includes all findings when no minSeverity is specified (default)', () => {
    const comment = buildSummaryComment(payload, 'run-1');
    expect(comment).toContain('HIGH');
    expect(comment).toContain('MEDIUM');
    expect(comment).toContain('LOW');
  });

  it('excludes low findings when minSeverity=medium', () => {
    const comment = buildSummaryComment(payload, 'run-1', { minSeverity: 'medium' });
    expect(comment).toContain('HIGH');
    expect(comment).toContain('MEDIUM');
    expect(comment).not.toContain('LOW');
  });

  it('excludes medium and low findings when minSeverity=high', () => {
    const comment = buildSummaryComment(payload, 'run-1', { minSeverity: 'high' });
    expect(comment).toContain('HIGH');
    expect(comment).not.toContain('MEDIUM');
    expect(comment).not.toContain('LOW');
  });

  it('shows "no findings" state when all findings are below threshold', () => {
    const lowOnly = makePayload([lowFinding]);
    const comment = buildSummaryComment(lowOnly, 'run-1', { minSeverity: 'high' });
    // Should not show any finding rows
    expect(comment).not.toContain('LOW');
  });
});

// ---------------------------------------------------------------------------
// T2-AC2: determineCheckConclusion uses same threshold
// ---------------------------------------------------------------------------
describe('T2: determineCheckConclusion respects minSeverityToBlock', () => {
  it('returns action_required when high finding present and threshold=high', () => {
    const payload = makePayload([makeFinding('high')]);
    expect(determineCheckConclusion(payload, 'high')).toBe('action_required');
  });

  it('returns neutral when only medium findings and threshold=high', () => {
    const payload = makePayload([makeFinding('medium')]);
    expect(determineCheckConclusion(payload, 'high')).toBe('neutral');
  });

  it('returns action_required when medium finding present and threshold=medium', () => {
    const payload = makePayload([makeFinding('medium')]);
    expect(determineCheckConclusion(payload, 'medium')).toBe('action_required');
  });

  it('returns success when no drifted findings', () => {
    const payload = makePayload([makeFinding('high', 'verified')]);
    expect(determineCheckConclusion(payload)).toBe('success');
  });

  it('returns action_required for low findings when threshold=low', () => {
    const payload = makePayload([makeFinding('low')]);
    expect(determineCheckConclusion(payload, 'low')).toBe('action_required');
  });
});

// ---------------------------------------------------------------------------
// T2-AC3: action.yml passes min-severity to scan command
// ---------------------------------------------------------------------------
describe('T2: action.yml wires min-severity input', () => {
  const actionYml = readFileSync(resolve(__dirname, '../../../../action/action.yml'), 'utf-8');

  it('declares min-severity as an input', () => {
    expect(actionYml).toMatch(/min-severity:/);
  });

  it('passes min-severity to the scan command', () => {
    // The action should reference inputs.min-severity in a run step
    expect(actionYml).toMatch(/\$\{\{\s*inputs\.min-severity\s*\}\}/);
  });

  it('passes --min-severity flag to docalign scan', () => {
    expect(actionYml).toMatch(/--min-severity/);
  });
});
