import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runFix, validateLocalPath } from '../../src/cli/commands/fix';
import type { CliPipeline, DocFix } from '../../src/cli/local-pipeline';

function makeFix(overrides: Partial<DocFix> = {}): DocFix {
  return {
    file: 'README.md',
    line_start: 45,
    line_end: 45,
    old_text: 'express@4.18.2',
    new_text: 'express@4.19.0',
    reason: 'Updated express version (4.18.2 -> 4.19.0)',
    claim_id: 'c-1',
    confidence: 0.9,
    ...overrides,
  };
}

function makePipeline(fixes: DocFix[]): CliPipeline {
  return {
    checkFile: vi.fn(),
    scanRepo: vi.fn(),
    getStoredFixes: vi.fn().mockResolvedValue(fixes),
    markFixesApplied: vi.fn(),
  };
}

describe('validateLocalPath', () => {
  it('accepts simple relative path', () => {
    expect(validateLocalPath('README.md', '/repo')).toBe(path.resolve('/repo', 'README.md'));
  });

  it('accepts nested path', () => {
    expect(validateLocalPath('docs/api.md', '/repo')).toBe(path.resolve('/repo', 'docs/api.md'));
  });

  it('rejects absolute path', () => {
    expect(validateLocalPath('/etc/passwd', '/repo')).toBeNull();
  });

  it('rejects path traversal', () => {
    expect(validateLocalPath('../../../etc/passwd', '/repo')).toBeNull();
  });

  it('rejects mid-path traversal', () => {
    expect(validateLocalPath('docs/../../etc/passwd', '/repo')).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(validateLocalPath('README\0.md', '/repo')).toBeNull();
  });

  it('rejects empty path', () => {
    expect(validateLocalPath('', '/repo')).toBeNull();
  });
});

describe('CLI fix command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-fix-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('applies fixes to a single file and returns exit 0', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Uses express@4.18.2 for HTTP.\n');

    const pipeline = makePipeline([makeFix()]);
    const output: string[] = [];

    const code = await runFix(pipeline, 'README.md', tmpDir, (msg) => output.push(msg));

    expect(code).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('1 fix applied');
    expect(text).toContain('Files modified: README.md');

    // Verify actual file was modified
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('express@4.19.0');
    expect(content).not.toContain('express@4.18.2');
  });

  it('applies all fixes when no file argument given', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Uses express@4.18.2 for HTTP.\n');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'api.md'), 'Returns 20 items per page.\n');

    const pipeline = makePipeline([
      makeFix(),
      makeFix({
        file: 'docs/api.md',
        line_start: 201,
        old_text: '20 items per page',
        new_text: '25 items per page',
        reason: 'Updated default pagination limit',
        claim_id: 'c-2',
      }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    expect(code).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('2 fixes applied');
    expect(text).toContain('README.md');
    expect(text).toContain('docs/api.md');
  });

  it('returns exit 1 when no prior scan exists', async () => {
    const pipeline = makePipeline([]);
    const output: string[] = [];

    const code = await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('No scan results found');
  });

  it('returns exit 1 when no fixes available for file', async () => {
    const pipeline = makePipeline([]);
    const output: string[] = [];

    const code = await runFix(pipeline, 'README.md', tmpDir, (msg) => output.push(msg));

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('No fixes available');
  });

  it('handles partial success (some applied, some failed)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Uses express@4.18.2 for HTTP.\n');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'api.md'), 'Content has totally changed.\n');

    const pipeline = makePipeline([
      makeFix(),
      makeFix({
        file: 'docs/api.md',
        line_start: 201,
        old_text: 'Returns 20 items per page',
        new_text: 'Returns 25 items per page',
        reason: 'Update pagination',
        claim_id: 'c-2',
      }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    expect(code).toBe(0); // partial success → exit 0
    const text = output.join('\n');
    expect(text).toContain('1 fix applied');
    expect(text).toContain('1 fix could not be applied');
    expect(text).toContain('Target text has changed');
  });

  it('returns exit 2 when all fixes fail', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Totally rewritten content.\n');

    const pipeline = makePipeline([makeFix()]);
    const output: string[] = [];

    const code = await runFix(pipeline, 'README.md', tmpDir, (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('could not be applied');
  });

  it('rejects path traversal attack', async () => {
    const pipeline = makePipeline([
      makeFix({ file: '../../../etc/passwd' }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('path traversal');
  });

  it('rejects absolute path', async () => {
    const pipeline = makePipeline([
      makeFix({ file: '/etc/passwd' }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('path traversal');
  });

  it('output matches Section 6.4 format (single file)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Uses express@4.18.2 for HTTP.\n');

    const pipeline = makePipeline([makeFix()]);
    const output: string[] = [];

    await runFix(pipeline, 'README.md', tmpDir, (msg) => output.push(msg));

    const text = output.join('\n');
    expect(text).toContain('DocAlign: Applying fixes to');
    expect(text).toContain('README.md');
    expect(text).toContain('fix applied');
    expect(text).toContain('Line 45');
    expect(text).toContain('Files modified:');
  });

  it('output matches Section 6.4 format (all files)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Uses express@4.18.2 for HTTP.\n');

    const pipeline = makePipeline([makeFix()]);
    const output: string[] = [];

    await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    const text = output.join('\n');
    expect(text).toContain('DocAlign: Applying all available fixes');
    expect(text).toContain('README.md:45');
  });

  it('uses replacer function for $-pattern safety', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Costs fifty dollars\n');

    const pipeline = makePipeline([
      makeFix({
        old_text: 'fifty dollars',
        new_text: '$100 (use $& or $1 or $$)',
        reason: 'Updated price',
      }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, 'README.md', tmpDir, (msg) => output.push(msg));

    expect(code).toBe(0);
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('$100');
    expect(content).toContain('$&');
    expect(content).toContain('$1');
    expect(content).toContain('$$');
    expect(content).not.toContain('fifty dollars');
  });

  it('handles file not found gracefully', async () => {
    const pipeline = makePipeline([
      makeFix({ file: 'nonexistent.md' }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, undefined, tmpDir, (msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join('\n')).toContain('File not found');
  });

  it('applies multiple fixes to the same file sequentially', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Uses express@4.18.2.\nReturns 20 items.\n');

    const pipeline = makePipeline([
      makeFix({
        old_text: 'express@4.18.2',
        new_text: 'express@4.19.0',
        reason: 'Version update',
        claim_id: 'c-1',
        line_start: 1,
      }),
      makeFix({
        old_text: '20 items',
        new_text: '25 items',
        reason: 'Pagination update',
        claim_id: 'c-2',
        line_start: 2,
      }),
    ]);
    const output: string[] = [];

    const code = await runFix(pipeline, 'README.md', tmpDir, (msg) => output.push(msg));

    expect(code).toBe(0);
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
    expect(content).toContain('express@4.19.0');
    expect(content).toContain('25 items');
  });

  it('passes target file to getStoredFixes', async () => {
    const pipeline = makePipeline([]);
    await runFix(pipeline, 'README.md', tmpDir, () => {});

    expect(pipeline.getStoredFixes).toHaveBeenCalledWith('README.md');
  });

  it('passes undefined to getStoredFixes for all files', async () => {
    const pipeline = makePipeline([]);
    await runFix(pipeline, undefined, tmpDir, () => {});

    expect(pipeline.getStoredFixes).toHaveBeenCalledWith(undefined);
  });
});
