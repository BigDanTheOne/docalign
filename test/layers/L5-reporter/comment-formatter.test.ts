import { describe, it, expect } from 'vitest';
import {
  formatFinding,
  buildSummaryComment,
  determineCheckConclusion,
} from '../../../src/layers/L5-reporter/comment-formatter';
import type {
  Finding,
  PRCommentPayload,
  Claim,
  VerificationResult,
  HealthScore,
} from '../../../src/shared/types';

function makeHealthScore(overrides: Partial<HealthScore> = {}): HealthScore {
  return {
    total_claims: 10,
    verified: 8,
    drifted: 2,
    uncertain: 0,
    pending: 0,
    score: 0.8,
    by_file: [],
    by_type: {},
    hotspots: [],
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 10,
    claim_text: 'Uses express 4.x',
    claim_type: 'dependency_version',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'drifted',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    id: 'result-1',
    claim_id: 'claim-1',
    repo_id: 'repo-1',
    scan_run_id: 'scan-1',
    verdict: 'drifted',
    confidence: 0.95,
    tier: 1,
    severity: 'high',
    reasoning: 'Version mismatch detected',
    specific_mismatch: 'Expected express 4.x but found 5.0.0',
    suggested_fix: null,
    evidence_files: ['package.json'],
    token_cost: null,
    duration_ms: null,
    post_check_result: null,
    verification_path: 1,
    created_at: new Date(),
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    claim: makeClaim(),
    result: makeResult(),
    fix: null,
    suppressed: false,
    ...overrides,
  };
}

function makePayload(overrides: Partial<PRCommentPayload> = {}): PRCommentPayload {
  return {
    findings: [],
    health_score: makeHealthScore(),
    scan_run_id: 'scan-run-abc',
    agent_unavailable_pct: 0,
    ...overrides,
  };
}

describe('formatFinding', () => {
  it('formats a drifted finding with severity badge', () => {
    const finding = makeFinding();
    const result = formatFinding(finding);

    expect(result).toContain('🔴 HIGH');
    expect(result).toContain('README.md');
    expect(result).toContain('line 10');
    expect(result).toContain('Uses express 4.x');
    expect(result).toContain('package.json');
  });

  it('includes diff block when fix is available', () => {
    const finding = makeFinding({
      fix: {
        file: 'README.md',
        line_start: 10,
        line_end: 10,
        old_text: 'express 4.x',
        new_text: 'express 5.0.0',
        reason: 'Version updated',
        claim_id: 'claim-1',
        confidence: 0.9,
      },
    });
    const result = formatFinding(finding);

    expect(result).toContain('```diff');
    expect(result).toContain('- express 4.x');
    expect(result).toContain('+ express 5.0.0');
  });

  it('truncates long mismatch text', () => {
    const finding = makeFinding({
      result: makeResult({
        specific_mismatch: 'A'.repeat(200),
      }),
    });
    const result = formatFinding(finding);
    // Header should be truncated to 80 chars
    const headerLine = result.split('\n')[0];
    // The 80 char limit is on the mismatch text, not the whole line
    expect(headerLine.length).toBeLessThan(200);
  });

  it('uses medium badge as default', () => {
    const finding = makeFinding({
      result: makeResult({ severity: 'medium' }),
    });
    const result = formatFinding(finding);
    expect(result).toContain('🟡 MEDIUM');
  });

  it('uses low badge', () => {
    const finding = makeFinding({
      result: makeResult({ severity: 'low' }),
    });
    const result = formatFinding(finding);
    expect(result).toContain('🔵 LOW');
  });
});

describe('buildSummaryComment', () => {
  it('generates no-claims template', () => {
    const payload = makePayload({ findings: [] });
    const result = buildSummaryComment(payload, 'scan-123');

    expect(result).toContain('<!-- docalign-summary scan-run-id=scan-123 -->');
    expect(result).toContain('No documentation claims were affected');
    expect(result).toContain('Health score');
  });

  it('generates all-verified template', () => {
    const payload = makePayload({
      findings: [
        makeFinding({
          result: makeResult({ verdict: 'verified' }),
        }),
      ],
    });
    const result = buildSummaryComment(payload, 'scan-456');

    expect(result).toContain('✅ All documentation claims verified');
    expect(result).toContain('Claims checked');
    expect(result).not.toContain('Drifted');
  });

  it('generates findings template with drifted count', () => {
    const payload = makePayload({
      findings: [makeFinding(), makeFinding({ claim: makeClaim({ id: 'claim-2' }) })],
    });
    const result = buildSummaryComment(payload, 'scan-789');

    expect(result).toContain('Found **2** documentation drifts');
    expect(result).toContain('Drifted');
  });

  it('singular drift text for one finding', () => {
    const payload = makePayload({
      findings: [makeFinding()],
    });
    const result = buildSummaryComment(payload, 'scan-789');
    expect(result).toContain('Found **1** documentation drift:');
  });

  it('includes force push banner', () => {
    const payload = makePayload({
      findings: [makeFinding()],
    });
    const result = buildSummaryComment(payload, 'scan-fp', { forcePush: true });

    expect(result).toContain('Force push detected');
  });

  it('includes agent unavailable banner when > 20%', () => {
    const payload = makePayload({
      findings: [makeFinding()],
      agent_unavailable_pct: 35,
    });
    const result = buildSummaryComment(payload, 'scan-agent');

    expect(result).toContain('Agent unavailable');
    expect(result).toContain('35%');
  });

  it('omits agent banner when <= 20%', () => {
    const payload = makePayload({
      findings: [makeFinding()],
      agent_unavailable_pct: 15,
    });
    const result = buildSummaryComment(payload, 'scan-no-agent');

    expect(result).not.toContain('Agent unavailable');
  });

  it('includes uncertain section in collapsible', () => {
    const payload = makePayload({
      findings: [
        makeFinding(),
        makeFinding({
          claim: makeClaim({ id: 'claim-unc' }),
          result: makeResult({ verdict: 'uncertain', severity: null }),
          suppressed: false,
        }),
      ],
    });
    const result = buildSummaryComment(payload, 'scan-unc');

    expect(result).toContain('<details><summary>Uncertain claims</summary>');
  });

  it('suppressed findings are excluded from outcome', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ suppressed: true }),
      ],
    });
    const result = buildSummaryComment(payload, 'scan-suppressed');

    // With only suppressed findings and 0 total, it's no_claims_in_scope
    // Actually the findings array has 1 item but it's suppressed, unsuppressed length is 0
    // and findings.length is 1, so it will be all_verified (unsuppressed.length === 0 && findings.length > 0)
    expect(result).not.toContain('documentation drift');
  });

  it('truncates at 65K chars', () => {
    // Create many findings to exceed 65K
    const findings: Finding[] = [];
    for (let i = 0; i < 200; i++) {
      findings.push(
        makeFinding({
          claim: makeClaim({ id: `claim-${i}`, claim_text: 'A'.repeat(200) }),
          result: makeResult({ reasoning: 'B'.repeat(300) }),
        }),
      );
    }
    const payload = makePayload({ findings });
    const result = buildSummaryComment(payload, 'scan-long');

    expect(result.length).toBeLessThanOrEqual(65_000);
  });

  it('includes scan run ID in footer', () => {
    const payload = makePayload({ findings: [] });
    const result = buildSummaryComment(payload, 'scan-run-abcdef12-1234');

    expect(result).toContain('scan `scan-run');
  });

  it('sorts findings by severity (high first)', () => {
    const payload = makePayload({
      findings: [
        makeFinding({
          claim: makeClaim({ id: 'low-claim' }),
          result: makeResult({ severity: 'low', specific_mismatch: 'Low severity issue' }),
        }),
        makeFinding({
          claim: makeClaim({ id: 'high-claim' }),
          result: makeResult({ severity: 'high', specific_mismatch: 'High severity issue' }),
        }),
      ],
    });
    const result = buildSummaryComment(payload, 'scan-sort');

    const highIdx = result.indexOf('🔴 HIGH');
    const lowIdx = result.indexOf('🔵 LOW');
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

describe('determineCheckConclusion', () => {
  it('returns success when no drifted findings', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ result: makeResult({ verdict: 'verified' }) }),
      ],
    });
    expect(determineCheckConclusion(payload)).toBe('success');
  });

  it('returns success for empty findings', () => {
    const payload = makePayload({ findings: [] });
    expect(determineCheckConclusion(payload)).toBe('success');
  });

  it('returns action_required for high severity drifted (default threshold)', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ result: makeResult({ verdict: 'drifted', severity: 'high' }) }),
      ],
    });
    expect(determineCheckConclusion(payload)).toBe('action_required');
  });

  it('returns neutral for medium severity when threshold is high', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ result: makeResult({ verdict: 'drifted', severity: 'medium' }) }),
      ],
    });
    expect(determineCheckConclusion(payload, 'high')).toBe('neutral');
  });

  it('returns action_required for medium severity when threshold is medium', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ result: makeResult({ verdict: 'drifted', severity: 'medium' }) }),
      ],
    });
    expect(determineCheckConclusion(payload, 'medium')).toBe('action_required');
  });

  it('returns action_required for low severity when threshold is low', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ result: makeResult({ verdict: 'drifted', severity: 'low' }) }),
      ],
    });
    expect(determineCheckConclusion(payload, 'low')).toBe('action_required');
  });

  it('ignores suppressed findings', () => {
    const payload = makePayload({
      findings: [
        makeFinding({
          result: makeResult({ verdict: 'drifted', severity: 'high' }),
          suppressed: true,
        }),
      ],
    });
    expect(determineCheckConclusion(payload)).toBe('success');
  });

  it('ignores uncertain findings', () => {
    const payload = makePayload({
      findings: [
        makeFinding({ result: makeResult({ verdict: 'uncertain' }) }),
      ],
    });
    expect(determineCheckConclusion(payload)).toBe('success');
  });
});
