import { expect } from 'vitest';
import type { ExpectedFinding, Finding } from './types';

/**
 * Check if a finding matches an expected finding (partial match).
 * Only checks fields present in expected.
 */
function findingMatches(finding: Finding, expected: ExpectedFinding): boolean {
  if (expected.claim_id !== undefined && finding.claim_id !== expected.claim_id) {
    return false;
  }
  if (expected.claim_type !== undefined && finding.claim_type !== expected.claim_type) {
    return false;
  }
  if (finding.verdict !== expected.verdict) {
    return false;
  }
  if (expected.severity !== undefined && finding.severity !== expected.severity) {
    return false;
  }
  if (
    expected.claim_text_contains !== undefined &&
    !finding.claim_text.includes(expected.claim_text_contains)
  ) {
    return false;
  }
  return true;
}

/**
 * toContainFinding: assert that findings array contains at least one finding matching expected.
 * Partial match: only checks fields present in expected.
 */
function toContainFinding(
  this: { isNot: boolean },
  received: Finding[],
  expected: ExpectedFinding,
) {
  const pass = received.some((f) => findingMatches(f, expected));

  if (pass) {
    return {
      pass: true,
      message: () =>
        `Expected findings NOT to contain a finding matching ${JSON.stringify(expected)}, but it did.`,
    };
  } else {
    const drifted = received.filter((f) => f.verdict === 'drifted');
    return {
      pass: false,
      message: () =>
        `Expected findings to contain a finding matching ${JSON.stringify(expected)}.\n` +
        `Actual drifted findings (${drifted.length}):\n` +
        drifted.map((f) => `  - ${JSON.stringify({ claim_id: f.claim_id, claim_type: f.claim_type, verdict: f.verdict, claim_text: f.claim_text.substring(0, 80) })}`).join('\n'),
    };
  }
}

/**
 * toMatchExpectedFindings: asserts all expected findings present, and no extra drifted findings.
 */
function toMatchExpectedFindings(
  this: { isNot: boolean },
  received: Finding[],
  expected: ExpectedFinding[],
) {
  const driftedFindings = received.filter((f) => f.verdict === 'drifted');
  const expectedDrifted = expected.filter((e) => e.verdict === 'drifted');

  // Check all expected findings are present
  const missingExpected: ExpectedFinding[] = [];
  for (const exp of expected) {
    if (!received.some((f) => findingMatches(f, exp))) {
      missingExpected.push(exp);
    }
  }

  // Check no unexpected drifted findings
  const unexpectedDrifted: Finding[] = [];
  for (const finding of driftedFindings) {
    const isExpected = expectedDrifted.some((exp) => findingMatches(finding, exp));
    if (!isExpected) {
      unexpectedDrifted.push(finding);
    }
  }

  const pass = missingExpected.length === 0 && unexpectedDrifted.length === 0;

  if (pass) {
    return {
      pass: true,
      message: () =>
        `Expected findings NOT to exactly match expected findings, but they did.`,
    };
  } else {
    const lines: string[] = [];
    if (missingExpected.length > 0) {
      lines.push(
        `Missing expected findings (${missingExpected.length}):\n` +
          missingExpected
            .map((e) => `  - ${JSON.stringify(e)}`)
            .join('\n'),
      );
    }
    if (unexpectedDrifted.length > 0) {
      lines.push(
        `Unexpected drifted findings (${unexpectedDrifted.length}):\n` +
          unexpectedDrifted
            .map(
              (f) =>
                `  - ${JSON.stringify({ claim_id: f.claim_id, claim_type: f.claim_type, verdict: f.verdict, claim_text: f.claim_text.substring(0, 80) })}`,
            )
            .join('\n'),
      );
    }
    return {
      pass: false,
      message: () => lines.join('\n\n'),
    };
  }
}

// Extend Vitest's expect with custom matchers
export const corpusExpect = expect.extend({
  toContainFinding,
  toMatchExpectedFindings,
});
