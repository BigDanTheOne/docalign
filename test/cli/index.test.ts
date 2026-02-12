import { describe, it, expect, vi } from 'vitest';
import { parseArgs, run } from '../../src/cli/index';
import type { CliPipeline } from '../../src/cli/local-pipeline';

function makePipeline(): CliPipeline {
  return {
    checkFile: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 0,
    }),
    scanRepo: vi.fn().mockResolvedValue({
      files: [],
      totalClaims: 0,
      totalVerified: 0,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 0,
    }),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn(),
  };
}

describe('parseArgs', () => {
  it('parses command and arguments', () => {
    const result = parseArgs(['node', 'docalign', 'check', 'README.md']);
    expect(result.command).toBe('check');
    expect(result.args).toEqual(['README.md']);
  });

  it('parses flags', () => {
    const result = parseArgs(['node', 'docalign', 'check', 'README.md', '--verbose']);
    expect(result.command).toBe('check');
    expect(result.args).toEqual(['README.md']);
    expect(result.flags.verbose).toBe(true);
  });

  it('returns empty command when no args', () => {
    const result = parseArgs(['node', 'docalign']);
    expect(result.command).toBe('');
    expect(result.args).toEqual([]);
  });

  it('parses scan command without arguments', () => {
    const result = parseArgs(['node', 'docalign', 'scan']);
    expect(result.command).toBe('scan');
    expect(result.args).toEqual([]);
  });

  it('parses fix command with optional file', () => {
    const result = parseArgs(['node', 'docalign', 'fix', 'README.md']);
    expect(result.command).toBe('fix');
    expect(result.args).toEqual(['README.md']);
  });

  it('parses fix command without file', () => {
    const result = parseArgs(['node', 'docalign', 'fix']);
    expect(result.command).toBe('fix');
    expect(result.args).toEqual([]);
  });
});

describe('run', () => {
  it('routes to check command', async () => {
    const pipeline = makePipeline();
    await run(pipeline, ['node', 'docalign', 'check', 'README.md'], () => {});

    expect(pipeline.checkFile).toHaveBeenCalledWith('README.md', false);
  });

  it('routes to scan command', async () => {
    const pipeline = makePipeline();
    await run(pipeline, ['node', 'docalign', 'scan'], () => {});

    expect(pipeline.scanRepo).toHaveBeenCalled();
  });

  it('routes to fix command', async () => {
    const pipeline = makePipeline();
    await run(pipeline, ['node', 'docalign', 'fix', 'README.md'], () => {});

    expect(pipeline.getStoredFixes).toHaveBeenCalledWith('README.md');
  });

  it('shows help for empty command', async () => {
    const pipeline = makePipeline();
    const output: string[] = [];

    const code = await run(pipeline, ['node', 'docalign'], (msg) => output.push(msg));

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Usage:');
    expect(output.join('\n')).toContain('check');
    expect(output.join('\n')).toContain('scan');
    expect(output.join('\n')).toContain('fix');
  });

  it('returns 2 for unknown command', async () => {
    const pipeline = makePipeline();
    const output: string[] = [];

    const code = await run(pipeline, ['node', 'docalign', 'bogus'], (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('Unknown command: bogus');
  });

  it('passes verbose flag to check', async () => {
    const pipeline = makePipeline();
    await run(pipeline, ['node', 'docalign', 'check', 'README.md', '--verbose'], () => {});

    expect(pipeline.checkFile).toHaveBeenCalledWith('README.md', true);
  });
});
