import { describe, it, expect, vi } from 'vitest';
import { runStatus, getStatusData } from '../../src/cli/commands/status';
import type { CliPipeline, ScanResult, ScanFileResult } from '../../src/cli/local-pipeline';
import type { VerificationResult, Claim } from '../../src/shared/types';

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
    verification_path: null,
    created_at: new Date(),
    ...overrides,
  } as VerificationResult;
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c-1',
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: 'Test claim',
    claim_type: 'tech_stack',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1,
    extraction_method: 'regex',
    verification_status: 'verified',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as Claim;
}

function makeScanResult(
  files: ScanFileResult[] = [],
): ScanResult {
  let totalVerified = 0;
  let totalDrifted = 0;
  let totalUncertain = 0;
  let totalClaims = 0;
  for (const f of files) {
    totalClaims += f.claims.length;
    for (const r of f.results) {
      if (r.verdict === 'verified') totalVerified++;
      else if (r.verdict === 'drifted') totalDrifted++;
      else totalUncertain++;
    }
  }
  return {
    files,
    totalClaims,
    totalVerified,
    totalDrifted,
    totalUncertain,
    durationMs: 100,
  };
}

function makePipeline(result: ScanResult | null): CliPipeline {
  return {
    checkFile: vi.fn(),
    checkSection: vi.fn(),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn().mockResolvedValue(result),
  } as unknown as CliPipeline;
}

describe('runStatus', () => {
  it('displays drift health with scan data', async () => {
    const files: ScanFileResult[] = [
      {
        file: 'README.md',
        claims: [makeClaim({ id: 'c-1' }), makeClaim({ id: 'c-2' })],
        results: [
          makeVR({ claim_id: 'c-1', verdict: 'verified' }),
          makeVR({ claim_id: 'c-2', verdict: 'drifted' }),
        ],
      },
    ];
    const pipeline = makePipeline(makeScanResult(files));
    const output: string[] = [];
    const code = await runStatus(pipeline, (msg) => output.push(msg));
    const text = output.join('\n');
    expect(code).toBe(0);
    expect(text).toContain('Drift Health');
    expect(text).toMatch(/Health score:\s+50/);
    expect(text).toMatch(/Verified:\s+1/);
    expect(text).toMatch(/Drifted:\s+1/);
  });

  it('returns exit code 1 when no scan data', async () => {
    const pipeline = makePipeline(null);
    const output: string[] = [];
    const code = await runStatus(pipeline, (msg) => output.push(msg));
    expect(code).toBe(1);
    const text = output.join('\n');
    expect(text).toMatch(/no scan data/i);
  });

  it('outputs JSON when json flag is true', async () => {
    const files: ScanFileResult[] = [
      {
        file: 'docs/api.md',
        claims: [makeClaim()],
        results: [makeVR({ verdict: 'verified' })],
      },
    ];
    const pipeline = makePipeline(makeScanResult(files));
    const output: string[] = [];
    const code = await runStatus(pipeline, (msg) => output.push(msg), true);
    expect(code).toBe(0);
    const json = JSON.parse(output.join(''));
    expect(json.health_score).toBe(100);
    expect(json.verified).toBe(1);
    expect(json.drifted).toBe(0);
    expect(json.hotspots).toEqual([]);
  });

  it('outputs JSON error when no scan data and json is true', async () => {
    const pipeline = makePipeline(null);
    const output: string[] = [];
    const code = await runStatus(pipeline, (msg) => output.push(msg), true);
    expect(code).toBe(1);
    const json = JSON.parse(output.join(''));
    expect(json.error).toMatch(/no scan data/i);
  });

  it('shows hotspot files', async () => {
    const files: ScanFileResult[] = [
      {
        file: 'README.md',
        claims: [makeClaim({ id: 'c-1' }), makeClaim({ id: 'c-2' })],
        results: [
          makeVR({ claim_id: 'c-1', verdict: 'drifted' }),
          makeVR({ claim_id: 'c-2', verdict: 'drifted' }),
        ],
      },
    ];
    const pipeline = makePipeline(makeScanResult(files));
    const output: string[] = [];
    await runStatus(pipeline, (msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('hotspot');
    expect(text).toContain('README.md');
  });

  it('limits hotspots to 5', async () => {
    const files = Array.from({ length: 7 }, (_, i) => ({
      file: `doc-${i}.md`,
      claims: [makeClaim({ id: `c-${i}` })],
      results: [makeVR({ claim_id: `c-${i}`, verdict: 'drifted' as const })],
    }));
    const pipeline = makePipeline(makeScanResult(files));
    const output: string[] = [];
    await runStatus(pipeline, (msg) => output.push(msg));
    // Should only show 5 hotspot entries
    const hotspotLines = output.filter((l) => l.includes('drifted') && l.includes('doc-'));
    expect(hotspotLines.length).toBe(5);
  });
});

describe('getStatusData', () => {
  it('returns structured data from scan', async () => {
    const files: ScanFileResult[] = [
      {
        file: 'README.md',
        claims: [makeClaim({ id: 'c-1' }), makeClaim({ id: 'c-2' }), makeClaim({ id: 'c-3' })],
        results: [
          makeVR({ claim_id: 'c-1', verdict: 'verified' }),
          makeVR({ claim_id: 'c-2', verdict: 'verified' }),
          makeVR({ claim_id: 'c-3', verdict: 'drifted' }),
        ],
      },
    ];
    const pipeline = makePipeline(makeScanResult(files));
    const data = await getStatusData(pipeline);
    expect(data).not.toBeNull();
    expect(data!.health_score).toBe(67);
    expect(data!.verified).toBe(2);
    expect(data!.drifted).toBe(1);
    expect(data!.hotspots).toHaveLength(1);
    expect(data!.hotspots[0].file).toBe('README.md');
  });

  it('returns null when no scan data', async () => {
    const pipeline = makePipeline(null);
    const data = await getStatusData(pipeline);
    expect(data).toBeNull();
  });

  it('filters uncertain results', async () => {
    const files: ScanFileResult[] = [
      {
        file: 'README.md',
        claims: [makeClaim({ id: 'c-1' }), makeClaim({ id: 'c-2' })],
        results: [
          makeVR({ claim_id: 'c-1', verdict: 'verified' }),
          makeVR({ claim_id: 'c-2', verdict: 'uncertain' }),
        ],
      },
    ];
    const pipeline = makePipeline(makeScanResult(files));
    const data = await getStatusData(pipeline);
    expect(data!.health_score).toBe(100);
    expect(data!.verified).toBe(1);
    expect(data!.drifted).toBe(0);
  });
});
