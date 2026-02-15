import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGraphData, buildHtml, runViz } from '../../../src/cli/commands/viz';
import type { CytoscapeGraphData } from '../../../src/cli/commands/viz';
import type { CliPipeline, ScanResult } from '../../../src/cli/local-pipeline';
import type { Claim, VerificationResult } from '../../../src/shared/types';
import * as fs from 'fs';
import * as path from 'path';

// Helper to create a minimal claim
function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    repo_id: 'local',
    source_file: 'README.md',
    line_number: 10,
    claim_text: 'The server runs on port 3000',
    claim_type: 'path_reference',
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
  };
}

// Helper to create a minimal verification result
function makeResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    id: 'vr-1',
    claim_id: 'claim-1',
    repo_id: 'local',
    scan_run_id: null,
    verdict: 'verified',
    confidence: 1,
    tier: 1,
    severity: null,
    reasoning: null,
    specific_mismatch: null,
    suggested_fix: null,
    evidence_files: ['src/server.ts'],
    token_cost: null,
    duration_ms: null,
    post_check_result: null,
    verification_path: 1,
    created_at: new Date(),
    ...overrides,
  };
}

function emptyScanResult(): ScanResult {
  return {
    files: [],
    totalClaims: 0,
    totalVerified: 0,
    totalDrifted: 0,
    totalUncertain: 0,
    durationMs: 0,
  };
}

describe('buildGraphData', () => {
  it('returns empty graph with 100% health for empty scan', () => {
    const data = buildGraphData(emptyScanResult());
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(data.stats.healthPercent).toBe(100);
    expect(data.stats.totalDocs).toBe(0);
    expect(data.stats.totalCodeFiles).toBe(0);
    expect(data.stats.totalClaims).toBe(0);
  });

  it('creates doc + code node and green edge for verified path_reference', () => {
    const claim = makeClaim({ extracted_value: { path: 'src/server.ts' } });
    const result = makeResult({ evidence_files: ['src/server.ts'] });

    const scan: ScanResult = {
      files: [{ file: 'README.md', claims: [claim], results: [result], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 100,
    };

    const data = buildGraphData(scan);

    // 1 doc node + 1 code node
    expect(data.nodes).toHaveLength(2);
    const docNode = data.nodes.find((n) => n.data.type === 'doc');
    const codeNode = data.nodes.find((n) => n.data.type === 'code');
    expect(docNode).toBeDefined();
    expect(codeNode).toBeDefined();
    expect(docNode!.data.label).toBe('README.md');
    expect(codeNode!.data.label).toBe('src/server.ts');

    // 1 edge, verified
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].data.worstVerdict).toBe('verified');
    expect(data.edges[0].data.claimCount).toBe(1);
  });

  it('marks edge red when claim is drifted', () => {
    const claim = makeClaim();
    const result = makeResult({ verdict: 'drifted', severity: 'high' });

    const scan: ScanResult = {
      files: [{ file: 'README.md', claims: [claim], results: [result], fixes: [] }],
      totalClaims: 1,
      totalVerified: 0,
      totalDrifted: 1,
      totalUncertain: 0,
      durationMs: 50,
    };

    const data = buildGraphData(scan);
    expect(data.edges[0].data.worstVerdict).toBe('drifted');

    const docNode = data.nodes.find((n) => n.data.type === 'doc')!;
    expect(docNode.data.driftedCount).toBe(1);
  });

  it('deduplicates code nodes from multiple docs', () => {
    const claim1 = makeClaim({ id: 'c1', source_file: 'README.md' });
    const claim2 = makeClaim({ id: 'c2', source_file: 'docs/api.md' });
    const result1 = makeResult({ claim_id: 'c1', evidence_files: ['src/server.ts'] });
    const result2 = makeResult({ claim_id: 'c2', evidence_files: ['src/server.ts'] });

    const scan: ScanResult = {
      files: [
        { file: 'README.md', claims: [claim1], results: [result1], fixes: [] },
        { file: 'docs/api.md', claims: [claim2], results: [result2], fixes: [] },
      ],
      totalClaims: 2,
      totalVerified: 2,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 100,
    };

    const data = buildGraphData(scan);

    // 2 doc nodes + 1 code node (deduplicated)
    const docNodes = data.nodes.filter((n) => n.data.type === 'doc');
    const codeNodes = data.nodes.filter((n) => n.data.type === 'code');
    expect(docNodes).toHaveLength(2);
    expect(codeNodes).toHaveLength(1);

    // 2 edges (one per doc-code pair)
    expect(data.edges).toHaveLength(2);
  });

  it('creates doc node but no edge when claim has no evidence files', () => {
    const claim = makeClaim({ extracted_value: {} });
    const result = makeResult({ evidence_files: [] });

    const scan: ScanResult = {
      files: [{ file: 'README.md', claims: [claim], results: [result], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 50,
    };

    const data = buildGraphData(scan);
    expect(data.nodes).toHaveLength(1); // doc node only
    expect(data.nodes[0].data.type).toBe('doc');
    expect(data.edges).toHaveLength(0);
  });

  it('picks worst verdict when edge has mixed claims', () => {
    const c1 = makeClaim({ id: 'c1' });
    const c2 = makeClaim({ id: 'c2' });
    const r1 = makeResult({ claim_id: 'c1', verdict: 'verified', evidence_files: ['src/a.ts'] });
    const r2 = makeResult({ claim_id: 'c2', verdict: 'drifted', evidence_files: ['src/a.ts'], severity: 'high' });

    const scan: ScanResult = {
      files: [{ file: 'README.md', claims: [c1, c2], results: [r1, r2], fixes: [] }],
      totalClaims: 2,
      totalVerified: 1,
      totalDrifted: 1,
      totalUncertain: 0,
      durationMs: 50,
    };

    const data = buildGraphData(scan);
    // Both claims map to same code file → single edge
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].data.worstVerdict).toBe('drifted');
    expect(data.edges[0].data.claimCount).toBe(2);
  });

  it('creates code node from extracted_value.path for semantic claims', () => {
    const claim = makeClaim({
      claim_type: 'behavior',
      extracted_value: { path: 'src/auth.ts' },
    });
    const result = makeResult({ evidence_files: [] });

    const scan: ScanResult = {
      files: [{ file: 'docs/auth.md', claims: [claim], results: [result], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 50,
    };

    const data = buildGraphData(scan);
    const codeNode = data.nodes.find((n) => n.data.type === 'code');
    expect(codeNode).toBeDefined();
    expect(codeNode!.data.label).toBe('src/auth.ts');
    expect(data.edges).toHaveLength(1);
  });
});

describe('buildHtml', () => {
  it('produces valid HTML with graph data', () => {
    const data: CytoscapeGraphData = {
      nodes: [],
      edges: [],
      stats: { healthPercent: 100, totalDocs: 0, totalCodeFiles: 0, totalClaims: 0, totalDrifted: 0, totalVerified: 0 },
    };
    const html = buildHtml(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('window.__GRAPH_DATA__');
    expect(html).toContain('cytoscape');
    expect(html).toContain('DocAlign');
  });

  it('injects graph data as JSON', () => {
    const data: CytoscapeGraphData = {
      nodes: [{ data: { id: 'doc:test.md', label: 'test.md', type: 'doc', claimCount: 1, driftedCount: 0, verifiedCount: 1, uncertainCount: 0 } }],
      edges: [],
      stats: { healthPercent: 100, totalDocs: 1, totalCodeFiles: 0, totalClaims: 1, totalDrifted: 0, totalVerified: 1 },
    };
    const html = buildHtml(data);
    expect(html).toContain('"doc:test.md"');
    expect(html).toContain('"test.md"');
  });
});

describe('runViz', () => {
  let mockPipeline: { scanRepo: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPipeline = {
      scanRepo: vi.fn(),
    };
    // Clean up any previous output
    const vizPath = path.join('.docalign', 'viz.html');
    if (fs.existsSync(vizPath)) {
      fs.unlinkSync(vizPath);
    }
  });

  it('writes HTML to .docalign/viz.html', async () => {
    const claim = makeClaim();
    const result = makeResult();
    mockPipeline.scanRepo.mockResolvedValue({
      files: [{ file: 'README.md', claims: [claim], results: [result], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 50,
    } satisfies ScanResult);

    const output: string[] = [];
    const code = await runViz(
      mockPipeline as unknown as CliPipeline,
      { noOpen: true },
      (msg) => output.push(msg),
    );

    expect(code).toBe(0);
    const vizPath = path.join('.docalign', 'viz.html');
    expect(fs.existsSync(vizPath)).toBe(true);

    const content = fs.readFileSync(vizPath, 'utf-8');
    expect(content).toContain('window.__GRAPH_DATA__');
    expect(content).toContain('<!DOCTYPE html>');
  });

  it('reports stats in output', async () => {
    const claim = makeClaim();
    const result = makeResult();
    mockPipeline.scanRepo.mockResolvedValue({
      files: [{ file: 'README.md', claims: [claim], results: [result], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 50,
    } satisfies ScanResult);

    const output: string[] = [];
    await runViz(
      mockPipeline as unknown as CliPipeline,
      { noOpen: true },
      (msg) => output.push(msg),
    );

    const joined = output.join('\n');
    expect(joined).toContain('1 doc files');
    expect(joined).toContain('1 code files');
    expect(joined).toContain('1 claims');
    expect(joined).toContain('100%');
  });

  it('handles empty scan gracefully', async () => {
    mockPipeline.scanRepo.mockResolvedValue(emptyScanResult());

    const output: string[] = [];
    const code = await runViz(
      mockPipeline as unknown as CliPipeline,
      { noOpen: true },
      (msg) => output.push(msg),
    );

    expect(code).toBe(0);
    const joined = output.join('\n');
    expect(joined).toContain('No documentation files found');
  });

  it('respects --no-open', async () => {
    mockPipeline.scanRepo.mockResolvedValue({
      files: [{ file: 'README.md', claims: [makeClaim()], results: [makeResult()], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 50,
    } satisfies ScanResult);

    const output: string[] = [];
    await runViz(
      mockPipeline as unknown as CliPipeline,
      { noOpen: true },
      (msg) => output.push(msg),
    );

    const joined = output.join('\n');
    expect(joined).not.toContain('Opened in browser');
  });

  it('creates output dir if needed', async () => {
    const customPath = path.join('.docalign', 'sub', 'viz-test.html');
    const customDir = path.dirname(customPath);

    // Clean up
    if (fs.existsSync(customPath)) fs.unlinkSync(customPath);
    if (fs.existsSync(customDir)) fs.rmdirSync(customDir);

    mockPipeline.scanRepo.mockResolvedValue({
      files: [{ file: 'README.md', claims: [makeClaim()], results: [makeResult()], fixes: [] }],
      totalClaims: 1,
      totalVerified: 1,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 50,
    } satisfies ScanResult);

    const output: string[] = [];
    await runViz(
      mockPipeline as unknown as CliPipeline,
      { output: customPath, noOpen: true },
      (msg) => output.push(msg),
    );

    expect(fs.existsSync(customPath)).toBe(true);

    // Clean up
    fs.unlinkSync(customPath);
    fs.rmdirSync(customDir);
  });

  it('returns exit code 2 on error', async () => {
    mockPipeline.scanRepo.mockRejectedValue(new Error('scan failed'));

    const output: string[] = [];
    const code = await runViz(
      mockPipeline as unknown as CliPipeline,
      { noOpen: true },
      (msg) => output.push(msg),
    );

    expect(code).toBe(2);
    const joined = output.join('\n');
    expect(joined).toContain('scan failed');
  });
});
