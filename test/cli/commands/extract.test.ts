import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runExtract } from '../../../src/cli/commands/extract';
import type { LocalPipeline } from '../../../src/cli/real-pipeline';
import type { ExtractSemanticResult } from '../../../src/cli/real-pipeline';

describe('runExtract', () => {
  let mockPipeline: { extractSemantic: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPipeline = {
      extractSemantic: vi.fn(),
    };
  });

  it('reports extraction results', async () => {
    mockPipeline.extractSemantic.mockResolvedValue({
      totalFiles: 3,
      totalExtracted: 5,
      totalSkipped: 1,
      errors: [],
    } satisfies ExtractSemanticResult);

    const output: string[] = [];
    const code = await runExtract(
      mockPipeline as unknown as LocalPipeline,
      {},
      (msg) => output.push(msg),
    );

    expect(code).toBe(0);
    const joined = output.join('\n');
    expect(joined).toContain('Files analyzed: 3');
    expect(joined).toContain('Claims extracted: 5');
    expect(joined).toContain('Files skipped (unchanged): 1');
    expect(joined).toContain('.docalign/semantic/');
  });

  it('returns exit code 1 on errors', async () => {
    mockPipeline.extractSemantic.mockResolvedValue({
      totalFiles: 2,
      totalExtracted: 1,
      totalSkipped: 0,
      errors: [{ file: 'README.md', message: 'Claude CLI timeout' }],
    } satisfies ExtractSemanticResult);

    const output: string[] = [];
    const code = await runExtract(
      mockPipeline as unknown as LocalPipeline,
      {},
      (msg) => output.push(msg),
    );

    expect(code).toBe(1);
    const joined = output.join('\n');
    expect(joined).toContain('Error (README.md): Claude CLI timeout');
    expect(joined).toContain('Errors: 1');
  });

  it('passes dry-run option', async () => {
    mockPipeline.extractSemantic.mockResolvedValue({
      totalFiles: 0,
      totalExtracted: 0,
      totalSkipped: 0,
      errors: [],
    } satisfies ExtractSemanticResult);

    const output: string[] = [];
    await runExtract(
      mockPipeline as unknown as LocalPipeline,
      { dryRun: true },
      (msg) => output.push(msg),
    );

    const joined = output.join('\n');
    expect(joined).toContain('dry-run');
  });

  it('passes force option', async () => {
    mockPipeline.extractSemantic.mockResolvedValue({
      totalFiles: 1,
      totalExtracted: 3,
      totalSkipped: 0,
      errors: [],
    } satisfies ExtractSemanticResult);

    const output: string[] = [];
    await runExtract(
      mockPipeline as unknown as LocalPipeline,
      { force: true },
      (msg) => output.push(msg),
    );

    expect(mockPipeline.extractSemantic).toHaveBeenCalledWith(
      expect.any(Function),
      { force: true, files: undefined },
    );

    const joined = output.join('\n');
    expect(joined).toContain('force');
  });

  it('passes file list option', async () => {
    mockPipeline.extractSemantic.mockResolvedValue({
      totalFiles: 1,
      totalExtracted: 2,
      totalSkipped: 0,
      errors: [],
    } satisfies ExtractSemanticResult);

    await runExtract(
      mockPipeline as unknown as LocalPipeline,
      { files: ['README.md'] },
      () => {},
    );

    expect(mockPipeline.extractSemantic).toHaveBeenCalledWith(
      expect.any(Function),
      { force: undefined, files: ['README.md'] },
    );
  });

  it('calls onProgress callback', async () => {
    mockPipeline.extractSemantic.mockImplementation(
      async (onProgress: (current: number, total: number, file: string, status: string) => void) => {
        onProgress(1, 2, 'README.md', 'analyzing');
        onProgress(1, 2, 'README.md', 'extracting');
        onProgress(1, 2, 'README.md', 'done');
        onProgress(2, 2, 'docs/api.md', 'skipped');
        return {
          totalFiles: 2,
          totalExtracted: 3,
          totalSkipped: 1,
          errors: [],
        };
      },
    );

    const output: string[] = [];
    await runExtract(
      mockPipeline as unknown as LocalPipeline,
      {},
      (msg) => output.push(msg),
    );

    const joined = output.join('\n');
    expect(joined).toContain('[1/2] README.md — analyzing');
    expect(joined).toContain('[1/2] README.md — extracting');
    expect(joined).toContain('[2/2] docs/api.md — skipped');
  });

  it('suggests --force when all files skipped', async () => {
    mockPipeline.extractSemantic.mockResolvedValue({
      totalFiles: 3,
      totalExtracted: 0,
      totalSkipped: 3,
      errors: [],
    } satisfies ExtractSemanticResult);

    const output: string[] = [];
    await runExtract(
      mockPipeline as unknown as LocalPipeline,
      {},
      (msg) => output.push(msg),
    );

    const joined = output.join('\n');
    expect(joined).toContain('--force');
    expect(joined).toContain('unchanged');
  });
});
