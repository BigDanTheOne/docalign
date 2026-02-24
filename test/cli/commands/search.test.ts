import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSearch } from '../../../src/cli/commands/search';
import type { CliPipeline, ScanResult } from '../../../src/cli/local-pipeline';
import type { Claim, VerificationResult } from '../../../src/shared/types';

// Mock DocSearchIndex at module level — must match the real async build() + sync search() signatures
vi.mock('../../../src/layers/L6-mcp/doc-search', () => {
  const mockBuild = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
  const mockSearch = vi.fn().mockReturnValue({
    total_matches: 0,
    sections: [],
    signals_used: [],
  });
  return {
    DocSearchIndex: vi.fn().mockImplementation(() => ({
      build: mockBuild,
      search: mockSearch,
    })),
    __mockBuild: mockBuild,
    __mockSearch: mockSearch,
  };
});

// Retrieve mock handles for per-test control
 
const { __mockBuild: mockBuild, __mockSearch: mockSearch } = await import(
  '../../../src/layers/L6-mcp/doc-search'
) as unknown as {
  __mockBuild: ReturnType<typeof vi.fn>;
  __mockSearch: ReturnType<typeof vi.fn>;
};

// === Helpers ===

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

function makeScanResult(files: ScanResult['files']): ScanResult {
  return {
    files,
    totalClaims: files.reduce((sum, f) => sum + f.claims.length, 0),
    totalVerified: 0,
    totalDrifted: 0,
    totalUncertain: 0,
    durationMs: 42,
  };
}

/**
 * Build a mock CliPipeline with proper types — no unsafe cast needed.
 * Only `scanRepo` is used by the search command.
 */
function makeMockPipeline(scanResult: ScanResult = emptyScanResult()): CliPipeline {
  return {
    checkFile: vi.fn(),
    checkSection: vi.fn(),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn<[], Promise<ScanResult>>().mockResolvedValue(scanResult),
  } satisfies Record<keyof CliPipeline, unknown> as unknown as CliPipeline;
}

function collectOutput(): { output: string[]; write: (msg: string) => void } {
  const output: string[] = [];
  return { output, write: (msg: string) => output.push(msg) };
}

// === Tests ===

describe('search command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('argument validation', () => {
    it('returns exit 2 and prints usage when no query and no --code-file', async () => {
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, undefined, {}, write);

      expect(exitCode).toBe(2);
      expect(output.some((line) => line.includes('Usage'))).toBe(true);
    });

    it('does not call scanRepo or build index when args are missing', async () => {
      const { write } = collectOutput();
      const pipeline = makeMockPipeline();

      await runSearch(pipeline, undefined, {}, write);

      expect(pipeline.scanRepo).not.toHaveBeenCalled();
      expect(mockBuild).not.toHaveBeenCalled();
    });
  });

  describe('topic search', () => {
    it('returns exit 0 with matching results', async () => {
      mockSearch.mockReturnValue({
        total_matches: 2,
        sections: [
          {
            file: 'docs/auth.md',
            heading: 'Auth',
            verification_status: 'verified',
            content_preview: 'Uses bcrypt',
          },
          {
            file: 'docs/api.md',
            heading: 'API',
            verification_status: 'drifted',
            content_preview: 'REST endpoints',
          },
        ],
        signals_used: ['text'],
      });
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'authentication', {}, write, '/tmp/repo');

      expect(exitCode).toBe(0);
      expect(output.some((line) => line.includes('2 match(es) found'))).toBe(true);
      expect(output.some((line) => line.includes('docs/auth.md'))).toBe(true);
      expect(output.some((line) => line.includes('[DRIFTED]'))).toBe(true);
    });

    it('returns exit 0 with zero results and informative message', async () => {
      mockSearch.mockReturnValue({
        total_matches: 0,
        sections: [],
        signals_used: [],
      });
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'nonexistent-topic', {}, write, '/tmp/repo');

      expect(exitCode).toBe(0);
      expect(output.some((line) => line.includes('0 match(es) found'))).toBe(true);
      expect(output.some((line) => line.includes('No documentation found'))).toBe(true);
    });

    it('passes the query to DocSearchIndex.search()', async () => {
      mockSearch.mockReturnValue({ total_matches: 0, sections: [], signals_used: [] });
      const { write } = collectOutput();
      const pipeline = makeMockPipeline();

      await runSearch(pipeline, 'database migrations', {}, write, '/tmp/repo');

      expect(mockSearch).toHaveBeenCalledWith('database migrations', expect.objectContaining({
        verified_only: false,
      }));
    });

    it('forwards verified_only option to search', async () => {
      mockSearch.mockReturnValue({ total_matches: 0, sections: [], signals_used: [] });
      const { write } = collectOutput();
      const pipeline = makeMockPipeline();

      await runSearch(pipeline, 'auth', { verifiedOnly: true }, write, '/tmp/repo');

      expect(mockSearch).toHaveBeenCalledWith('auth', expect.objectContaining({
        verified_only: true,
      }));
    });
  });

  describe('code-file reverse lookup', () => {
    it('returns matching doc references for a code file', async () => {
      const scanResult = makeScanResult([
        {
          file: 'docs/auth.md',
          claims: [
            makeClaim({
              id: 'c1',
              source_file: 'docs/auth.md',
              line_number: 10,
              claim_text: 'Password hashing uses bcrypt',
              claim_type: 'behavior',
            }),
          ],
          results: [
            makeResult({
              claim_id: 'c1',
              verdict: 'verified',
              severity: null,
              evidence_files: ['src/auth/password.ts'],
            }),
          ],
        },
      ]);
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline(scanResult);

      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'src/auth/password.ts' }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(0);
      expect(output.some((line) => line.includes('1 doc reference(s)'))).toBe(true);
      expect(output.some((line) => line.includes('docs/auth.md'))).toBe(true);
    });

    it('returns exit 0 with zero references when no docs reference the code file', async () => {
      const scanResult = makeScanResult([
        {
          file: 'docs/auth.md',
          claims: [makeClaim({ id: 'c1' })],
          results: [makeResult({ claim_id: 'c1', evidence_files: ['src/other.ts'] })],
        },
      ]);
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline(scanResult);

      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'src/nonexistent.ts' }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(0);
      expect(output.some((line) => line.includes('0 doc reference(s)'))).toBe(true);
      expect(output.some((line) => line.includes('No docs reference'))).toBe(true);
    });

    it('returns exit 0 with zero references when scan result has no files', async () => {
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline(emptyScanResult());

      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'src/foo.ts' }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(0);
      expect(output.some((line) => line.includes('0 doc reference(s)'))).toBe(true);
    });

    it('matches code files by suffix (partial path)', async () => {
      const scanResult = makeScanResult([
        {
          file: 'docs/routes.md',
          claims: [makeClaim({ id: 'c1', source_file: 'docs/routes.md' })],
          results: [
            makeResult({
              claim_id: 'c1',
              evidence_files: ['src/deep/nested/handler.ts'],
            }),
          ],
        },
      ]);
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline(scanResult);

      // The search command matches `e === options.codeFile || e.endsWith('/' + options.codeFile)`
      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'nested/handler.ts' }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(0);
      expect(output.some((line) => line.includes('1 doc reference(s)'))).toBe(true);
    });
  });

  describe('JSON output', () => {
    it('outputs valid JSON for topic search', async () => {
      mockSearch.mockReturnValue({
        total_matches: 1,
        sections: [
          {
            file: 'docs/auth.md',
            heading: 'Auth',
            verification_status: 'verified',
            content_preview: 'Uses bcrypt',
          },
        ],
        signals_used: ['text'],
      });
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'auth', { json: true }, write, '/tmp/repo');

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(output.join(''));
      expect(parsed).toHaveProperty('query', 'auth');
      expect(parsed).toHaveProperty('search_results');
    });

    it('outputs valid JSON for --code-file lookup', async () => {
      const scanResult = makeScanResult([
        {
          file: 'docs/auth.md',
          claims: [
            makeClaim({
              id: 'c1',
              source_file: 'docs/auth.md',
              claim_text: 'bcrypt hashing',
            }),
          ],
          results: [
            makeResult({
              claim_id: 'c1',
              evidence_files: ['src/auth/password.ts'],
            }),
          ],
        },
      ]);
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline(scanResult);

      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'src/auth/password.ts', json: true }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(output.join(''));
      expect(parsed).toHaveProperty('code_file', 'src/auth/password.ts');
      expect(parsed).toHaveProperty('referencing_docs');
      expect(parsed.referencing_docs).toHaveLength(1);
    });

    it('outputs JSON with zero results for no-match topic', async () => {
      mockSearch.mockReturnValue({ total_matches: 0, sections: [], signals_used: [] });
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'zzz', { json: true }, write, '/tmp/repo');

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(output.join(''));
      expect(parsed.query).toBe('zzz');
      expect(parsed.search_results.sections).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('returns exit 2 and error message when scanRepo throws', async () => {
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();
      vi.mocked(pipeline.scanRepo).mockRejectedValue(new Error('Permission denied'));

      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'src/foo.ts' }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(2);
      expect(output.some((line) => line.includes('Permission denied'))).toBe(true);
    });

    it('returns exit 2 and error JSON when scanRepo throws with --json', async () => {
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();
      vi.mocked(pipeline.scanRepo).mockRejectedValue(new Error('OOM'));

      const exitCode = await runSearch(
        pipeline, undefined, { codeFile: 'src/foo.ts', json: true }, write, '/tmp/repo',
      );

      expect(exitCode).toBe(2);
      const parsed = JSON.parse(output.join(''));
      expect(parsed).toHaveProperty('error', 'OOM');
    });

    it('returns exit 2 when DocSearchIndex.build() throws', async () => {
      mockBuild.mockRejectedValue(new Error('Index build failed'));
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'auth', {}, write, '/tmp/repo');

      expect(exitCode).toBe(2);
      expect(output.some((line) => line.includes('Index build failed'))).toBe(true);
    });

    it('returns JSON error when DocSearchIndex.build() throws with --json', async () => {
      mockBuild.mockRejectedValue(new Error('ENOMEM'));
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'auth', { json: true }, write, '/tmp/repo');

      expect(exitCode).toBe(2);
      const parsed = JSON.parse(output.join(''));
      expect(parsed).toHaveProperty('error', 'ENOMEM');
    });

    it('handles non-Error thrown values gracefully', async () => {
      mockBuild.mockRejectedValue('string error');
      const { output, write } = collectOutput();
      const pipeline = makeMockPipeline();

      const exitCode = await runSearch(pipeline, 'auth', {}, write, '/tmp/repo');

      expect(exitCode).toBe(2);
      expect(output.some((line) => line.includes('string error'))).toBe(true);
    });
  });
});
