import { describe, it, expect, vi } from 'vitest';
import { runCheck } from '../../src/cli/commands/check';
import type { CliPipeline, CheckResult } from '../../src/cli/local-pipeline';
import type { Claim, VerificationResult } from '../../src/shared/types';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 45,
    claim_text: 'Authentication uses bcrypt with 12 salt rounds',
    claim_type: 'behavior',
    testability: 'syntactic',
    extracted_value: {},
    keywords: ['bcrypt'],
    extraction_confidence: 0.9,
    extraction_method: 'regex',
    verification_status: 'pending',
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
    id: 'vr-1',
    claim_id: 'claim-1',
    repo_id: 'repo-1',
    scan_run_id: null,
    verdict: 'verified',
    confidence: 0.95,
    tier: 1,
    severity: null,
    reasoning: null,
    specific_mismatch: null,
    suggested_fix: null,
    evidence_files: [],
    token_cost: null,
    duration_ms: null,
    post_check_result: null,
    verification_path: 1,
    created_at: new Date(),
    ...overrides,
  };
}

function makePipeline(result: CheckResult): CliPipeline {
  return {
    checkFile: vi.fn().mockResolvedValue(result),
    scanRepo: vi.fn(),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn(),
  };
}

describe('CLI check command', () => {
  it('exits 0 when all claims are verified', async () => {
    const pipeline = makePipeline({
      claims: [makeClaim()],
      results: [makeResult({ verdict: 'verified' })],
      fixes: [],
      durationMs: 3200,
    });
    const output: string[] = [];

    const code = await runCheck(pipeline, 'README.md', {}, (msg) => output.push(msg));

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('1 verified');
    expect(output.join('\n')).toContain('0 drifted');
  });

  it('exits 1 when drifted findings present', async () => {
    const pipeline = makePipeline({
      claims: [makeClaim()],
      results: [makeResult({
        verdict: 'drifted',
        severity: 'high',
        specific_mismatch: 'Code uses argon2id, not bcrypt',
        evidence_files: ['src/auth/password.ts'],
      })],
      fixes: [{ file: 'README.md', line_start: 45, line_end: 45, old_text: 'old', new_text: 'new', reason: 'drift', claim_id: 'claim-1', confidence: 0.9 }],
      durationMs: 3200,
    });
    const output: string[] = [];

    const code = await runCheck(pipeline, 'README.md', {}, (msg) => output.push(msg));

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('1 drifted');
    expect(output.join('\n')).toContain('HIGH');
    expect(output.join('\n')).toContain('README.md:45');
    expect(output.join('\n')).toContain('Code uses argon2id, not bcrypt');
    expect(output.join('\n')).toContain('src/auth/password.ts');
  });

  it('exits 2 on error', async () => {
    const pipeline: CliPipeline = {
      checkFile: vi.fn().mockRejectedValue(new Error('File not found: bad.md')),
      scanRepo: vi.fn(),
      getStoredFixes: vi.fn().mockResolvedValue([]),
      markFixesApplied: vi.fn(),
    };
    const output: string[] = [];

    const code = await runCheck(pipeline, 'bad.md', {}, (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('File not found: bad.md');
  });

  it('exits 2 when no file specified', async () => {
    const pipeline = makePipeline({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 0,
    });
    const output: string[] = [];

    const code = await runCheck(pipeline, '', {}, (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('No file specified');
  });

  it('hides uncertain claims from output (GATE42-021)', async () => {
    const pipeline = makePipeline({
      claims: [
        makeClaim({ id: 'c1' }),
        makeClaim({ id: 'c2' }),
        makeClaim({ id: 'c3' }),
      ],
      results: [
        makeResult({ claim_id: 'c1', verdict: 'verified' }),
        makeResult({ claim_id: 'c2', verdict: 'drifted', severity: 'medium', specific_mismatch: 'wrong' }),
        makeResult({ claim_id: 'c3', verdict: 'uncertain' }),
      ],
      fixes: [],
      durationMs: 1000,
    });
    const output: string[] = [];

    const code = await runCheck(pipeline, 'README.md', {}, (msg) => output.push(msg));

    expect(code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('1 verified');
    expect(text).toContain('1 drifted');
    // Uncertain claim should not appear in counts
    expect(text).not.toContain('uncertain');
  });

  it('output matches Section 6.2 format', async () => {
    const pipeline = makePipeline({
      claims: [
        makeClaim({ id: 'c1', claim_text: 'Auth uses bcrypt' }),
        makeClaim({ id: 'c2', line_number: 112, claim_text: 'Run tests with npm test' }),
      ],
      results: [
        makeResult({
          claim_id: 'c1',
          verdict: 'drifted',
          severity: 'high',
          specific_mismatch: 'Code uses argon2id',
          evidence_files: ['src/auth/password.ts'],
        }),
        makeResult({
          claim_id: 'c2',
          verdict: 'drifted',
          severity: 'medium',
          specific_mismatch: 'scripts.test is "vitest run"',
          evidence_files: ['package.json'],
        }),
      ],
      fixes: [
        { file: 'README.md', line_start: 45, line_end: 45, old_text: 'bcrypt', new_text: 'argon2id', reason: 'Update auth', claim_id: 'c1', confidence: 0.9 },
      ],
      durationMs: 3200,
    });
    const output: string[] = [];

    await runCheck(pipeline, 'README.md', {}, (msg) => output.push(msg));

    const text = output.join('\n');
    expect(text).toContain('DocAlign: Checking');
    expect(text).toContain('README.md');
    expect(text).toContain('Extracting claims...');
    expect(text).toContain('Verifying claims... done');
    expect(text).toContain('Results:');
    expect(text).toContain('HIGH');
    expect(text).toContain('MEDIUM');
    expect(text).toContain('Claim:');
    expect(text).toContain('Actual:');
    expect(text).toContain('Evidence:');
  });

  it('suggests docalign fix when fixes available', async () => {
    const pipeline = makePipeline({
      claims: [makeClaim()],
      results: [makeResult({ verdict: 'drifted', severity: 'high', specific_mismatch: 'wrong' })],
      fixes: [{ file: 'README.md', line_start: 45, line_end: 45, old_text: 'old', new_text: 'new', reason: 'fix', claim_id: 'claim-1', confidence: 0.9 }],
      durationMs: 1000,
    });
    const output: string[] = [];

    await runCheck(pipeline, 'README.md', {}, (msg) => output.push(msg));

    expect(output.join('\n')).toContain('Run `docalign fix README.md` to apply suggested fixes');
  });

  it('sorts findings by severity (HIGH first)', async () => {
    const pipeline = makePipeline({
      claims: [
        makeClaim({ id: 'c1', line_number: 10 }),
        makeClaim({ id: 'c2', line_number: 20 }),
        makeClaim({ id: 'c3', line_number: 30 }),
      ],
      results: [
        makeResult({ claim_id: 'c1', verdict: 'drifted', severity: 'low', specific_mismatch: 'low issue' }),
        makeResult({ claim_id: 'c2', verdict: 'drifted', severity: 'high', specific_mismatch: 'high issue' }),
        makeResult({ claim_id: 'c3', verdict: 'drifted', severity: 'medium', specific_mismatch: 'med issue' }),
      ],
      fixes: [],
      durationMs: 1000,
    });
    const output: string[] = [];

    await runCheck(pipeline, 'README.md', {}, (msg) => output.push(msg));

    const text = output.join('\n');
    const highIdx = text.indexOf('HIGH');
    const medIdx = text.indexOf('MEDIUM');
    const lowIdx = text.indexOf('LOW');
    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(lowIdx);
  });

  it('passes verbose flag to pipeline', async () => {
    const pipeline = makePipeline({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 0,
    });

    await runCheck(pipeline, 'README.md', { verbose: true }, () => {});

    expect(pipeline.checkFile).toHaveBeenCalledWith('README.md', true);
  });
});
