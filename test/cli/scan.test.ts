import { describe, it, expect, vi } from 'vitest';
import { runScan } from '../../src/cli/commands/scan';
import type { CliPipeline, ScanResult, ScanFileResult } from '../../src/cli/local-pipeline';
import type { VerificationResult } from '../../src/shared/types';

function makeVR(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    id: 'vr-1',
    claim_id: 'c-1',
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

function makeFileResult(file: string, results: VerificationResult[]): ScanFileResult {
  return {
    file,
    claims: results.map((r) => ({
      id: r.claim_id,
      repo_id: 'repo-1',
      source_file: file,
      line_number: 1,
      claim_text: 'test claim',
      claim_type: 'behavior' as const,
      testability: 'syntactic' as const,
      extracted_value: {},
      keywords: [],
      extraction_confidence: 0.9,
      extraction_method: 'regex' as const,
      verification_status: 'pending',
      last_verified_at: null,
      embedding: null,
      last_verification_result_id: null,
      parent_claim_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    })),
    results,
    fixes: [],
  };
}

function makePipeline(result: ScanResult): CliPipeline {
  return {
    checkFile: vi.fn(),
    scanRepo: vi.fn().mockResolvedValue(result),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn(),
  };
}

describe('CLI scan command', () => {
  it('exits 0 when no drift found', async () => {
    const pipeline = makePipeline({
      files: [
        makeFileResult('README.md', [
          makeVR({ claim_id: 'c1', verdict: 'verified' }),
          makeVR({ claim_id: 'c2', verdict: 'verified' }),
        ]),
      ],
      totalClaims: 2,
      totalVerified: 2,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 5000,
    });
    const output: string[] = [];

    const code = await runScan(pipeline, (msg) => output.push(msg), () => {});

    expect(code).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('2 verified');
    expect(text).toContain('0 drifted');
  });

  it('exits 1 when drift found', async () => {
    const pipeline = makePipeline({
      files: [
        makeFileResult('README.md', [
          makeVR({ claim_id: 'c1', verdict: 'verified' }),
          makeVR({ claim_id: 'c2', verdict: 'drifted', severity: 'high' }),
        ]),
        makeFileResult('docs/api.md', [
          makeVR({ claim_id: 'c3', verdict: 'drifted', severity: 'medium' }),
        ]),
      ],
      totalClaims: 3,
      totalVerified: 1,
      totalDrifted: 2,
      totalUncertain: 0,
      durationMs: 10000,
    });
    const output: string[] = [];

    const code = await runScan(pipeline, (msg) => output.push(msg), () => {});

    expect(code).toBe(1);
    const text = output.join('\n');
    expect(text).toContain('1 verified');
    expect(text).toContain('2 drifted');
  });

  it('exits 2 on error', async () => {
    const pipeline: CliPipeline = {
      checkFile: vi.fn(),
      scanRepo: vi.fn().mockRejectedValue(new Error('No doc files found')),
      getStoredFixes: vi.fn().mockResolvedValue([]),
      markFixesApplied: vi.fn(),
    };
    const output: string[] = [];

    const code = await runScan(pipeline, (msg) => output.push(msg), () => {});

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('No doc files found');
  });

  it('shows hotspots in descending drifted-count order', async () => {
    const pipeline = makePipeline({
      files: [
        makeFileResult('CONTRIBUTING.md', [makeVR({ claim_id: 'c1', verdict: 'drifted' })]),
        makeFileResult('docs/api.md', [
          makeVR({ claim_id: 'c2', verdict: 'drifted' }),
          makeVR({ claim_id: 'c3', verdict: 'drifted' }),
          makeVR({ claim_id: 'c4', verdict: 'drifted' }),
        ]),
        makeFileResult('README.md', [
          makeVR({ claim_id: 'c5', verdict: 'drifted' }),
          makeVR({ claim_id: 'c6', verdict: 'drifted' }),
        ]),
      ],
      totalClaims: 6,
      totalVerified: 0,
      totalDrifted: 6,
      totalUncertain: 0,
      durationMs: 5000,
    });
    const output: string[] = [];

    await runScan(pipeline, (msg) => output.push(msg), () => {});

    const text = output.join('\n');
    expect(text).toContain('Hotspots:');
    const apiIdx = text.indexOf('docs/api.md');
    const readmeIdx = text.indexOf('README.md');
    const contribIdx = text.indexOf('CONTRIBUTING.md');
    expect(apiIdx).toBeLessThan(readmeIdx);
    expect(readmeIdx).toBeLessThan(contribIdx);
  });

  it('excludes uncertain claims from output and counts (GATE42-021)', async () => {
    const pipeline = makePipeline({
      files: [
        makeFileResult('README.md', [
          makeVR({ claim_id: 'c1', verdict: 'verified' }),
          makeVR({ claim_id: 'c2', verdict: 'uncertain' }),
          makeVR({ claim_id: 'c3', verdict: 'drifted' }),
        ]),
      ],
      totalClaims: 3,
      totalVerified: 1,
      totalDrifted: 1,
      totalUncertain: 1,
      durationMs: 5000,
    });
    const output: string[] = [];

    await runScan(pipeline, (msg) => output.push(msg), () => {});

    const text = output.join('\n');
    // Should show 1 verified, 1 drifted (uncertain excluded)
    expect(text).toContain('1 verified');
    expect(text).toContain('1 drifted');
    // Health score = 1/2 = 50%
    expect(text).toContain('50%');
  });

  it('shows health score and summary (Section 6.3)', async () => {
    const pipeline = makePipeline({
      files: [
        makeFileResult('README.md', [
          ...Array.from({ length: 9 }, (_, i) => makeVR({ claim_id: `v${i}`, verdict: 'verified' })),
          makeVR({ claim_id: 'c1', verdict: 'drifted' }),
        ]),
      ],
      totalClaims: 10,
      totalVerified: 9,
      totalDrifted: 1,
      totalUncertain: 0,
      durationMs: 5000,
    });
    const output: string[] = [];

    await runScan(pipeline, (msg) => output.push(msg), () => {});

    const text = output.join('\n');
    expect(text).toContain('Repository Health:');
    expect(text).toContain('90%');
    expect(text).toContain('9/10');
    expect(text).toContain('Summary:');
    expect(text).toContain('9 verified');
    expect(text).toContain('1 drifted');
  });

  it('handles repo with zero doc files gracefully', async () => {
    const pipeline = makePipeline({
      files: [],
      totalClaims: 0,
      totalVerified: 0,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 1000,
    });
    const output: string[] = [];

    const code = await runScan(pipeline, (msg) => output.push(msg), () => {});

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('No documentation files found');
  });

  it('calls onProgress callback during verification', async () => {
    const pipeline: CliPipeline = {
      checkFile: vi.fn(),
      scanRepo: vi.fn().mockImplementation(async (onProgress) => {
        if (onProgress) {
          onProgress(1, 10);
          onProgress(5, 10);
          onProgress(10, 10);
        }
        return {
          files: [makeFileResult('README.md', [makeVR()])],
          totalClaims: 1,
          totalVerified: 1,
          totalDrifted: 0,
          totalUncertain: 0,
          durationMs: 1000,
        };
      }),
      getStoredFixes: vi.fn().mockResolvedValue([]),
      markFixesApplied: vi.fn(),
    };

    await runScan(
      pipeline,
      () => {},
      () => {},
    );

    expect(pipeline.scanRepo).toHaveBeenCalled();
  });

  it('suggests docalign check when drift found', async () => {
    const pipeline = makePipeline({
      files: [
        makeFileResult('README.md', [makeVR({ verdict: 'drifted' })]),
      ],
      totalClaims: 1,
      totalVerified: 0,
      totalDrifted: 1,
      totalUncertain: 0,
      durationMs: 5000,
    });
    const output: string[] = [];

    await runScan(pipeline, (msg) => output.push(msg), () => {});

    expect(output.join('\n')).toContain('Run `docalign check <file>` for details');
  });
});
