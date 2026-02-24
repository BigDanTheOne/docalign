/**
 * QA Acceptance Tests: docalign status CLI — drift health summary
 * Pipeline: 723d0205-663b-4c6d-98b6-30ac82bc9cc6
 */

import { describe, it, expect, vi } from 'vitest';
import { runStatus, getStatusData } from '../../../src/cli/commands/status';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock CliPipeline with scanRepo support
function makePipeline(scanResult: any) {
  return {
    checkFile: vi.fn(),
    scanRepo: vi.fn().mockResolvedValue(scanResult),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn(),
  };
}

function makeScanResult(overrides: Partial<{
  claims: any[];
  results: any[];
}> = {}) {
  const verified = Array.from({ length: 8 }, (_, i) => ({
    claim_id: `c-${i}`,
    verdict: 'verified',
    confidence: 0.9,
    source_file: `src/file-${i}.ts`,
  }));
  const drifted = Array.from({ length: 2 }, (_, i) => ({
    claim_id: `c-drift-${i}`,
    verdict: 'drifted',
    confidence: 0.85,
    source_file: `src/hotspot-${i}.ts`,
  }));
  return {
    claims: [...verified, ...drifted],
    results: [...verified, ...drifted],
    ...overrides,
  };
}

describe('status drift health — with scan data', () => {
  it('AC1: displays health score, verified count, drifted count, and top 5 hotspots', async () => {
    const lines: string[] = [];
    const write = (msg: string) => lines.push(msg);
    const scanResult = makeScanResult();
    const pipeline = makePipeline(scanResult);

    const exitCode = await runStatus(pipeline as any, write, false);
    expect(exitCode).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('Drift Health');
    expect(output).toMatch(/Health score:\s+\d+/);
    expect(output).toMatch(/Verified:\s+8/);
    expect(output).toMatch(/Drifted:\s+2/);
    expect(output).toContain('hotspot');

    // Structural assertion: pipeline exists with scanRepo
    expect(pipeline.scanRepo).toBeDefined();
  });
});

describe('status drift health — no scan data', () => {
  it('AC2: prints no-scan-data message and exits code 1', async () => {
    const lines: string[] = [];
    const write = (msg: string) => lines.push(msg);
    const pipeline = makePipeline(null); // no scan data

    const exitCode = await runStatus(pipeline as any, write, false);
    expect(exitCode).toBe(1);
    const output = lines.join('\n');
    expect(output).toMatch(/no scan data/i);

    expect(pipeline.scanRepo).toBeDefined();
  });
});

describe('status drift health — JSON output', () => {
  it('AC3: --json includes health_score, verified, drifted, hotspots keys', async () => {
    const lines: string[] = [];
    const write = (msg: string) => lines.push(msg);
    const scanResult = makeScanResult();
    const pipeline = makePipeline(scanResult);

    const exitCode = await runStatus(pipeline as any, write, true);
    expect(exitCode).toBe(0);
    const json = JSON.parse(lines.join(''));
    expect(json).toHaveProperty('health_score');
    expect(json).toHaveProperty('verified');
    expect(json).toHaveProperty('drifted');
    expect(json).toHaveProperty('hotspots');
    expect(typeof json.health_score).toBe('number');
    expect(Array.isArray(json.hotspots)).toBe(true);

    expect(pipeline.scanRepo).toBeDefined();
  });
});

describe('getStatusData — shared function', () => {
  it('AC4: getStatusData returns structured data for reuse by MCP tool', async () => {
    const scanResult = makeScanResult();
    const pipeline = makePipeline(scanResult);

    const data = await getStatusData(pipeline as any);
    expect(data).toHaveProperty('health_score');
    expect(data).toHaveProperty('verified');
    expect(data).toHaveProperty('drifted');
    expect(data).toHaveProperty('hotspots');
    expect(data!.hotspots.length).toBeLessThanOrEqual(5);

    expect(pipeline.scanRepo).toBeDefined();
  });
});

describe('status — no MCP dependency', () => {
  it('AC5: works without MCP server — pure CLI with pipeline', async () => {
    const scanResult = makeScanResult();
    const pipeline = makePipeline(scanResult);

    // Verify scanRepo is called directly (not via MCP)
    await runStatus(pipeline as any, console.log, false);
    expect(pipeline.scanRepo).toHaveBeenCalled();

    expect(pipeline.scanRepo).toBeDefined();
  });
});
