import { describe, it, expect, vi } from 'vitest';
import { runSearch } from '../../../../src/cli/commands/search';
import type { CliPipeline } from '../../../../src/cli/local-pipeline';

// Mock DocSearchIndex
vi.mock('../../../../src/layers/L6-mcp/doc-search', () => ({
  DocSearchIndex: vi.fn().mockImplementation(() => ({
    build: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockReturnValue({
      total_matches: 2,
      sections: [
        {
          file: 'docs/auth.md',
          heading: 'Authentication',
          verification_status: 'verified',
          content_preview: 'Uses bcrypt with 12 salt rounds',
        },
        {
          file: 'docs/api.md',
          heading: 'API Reference',
          verification_status: 'drifted',
          content_preview: 'REST endpoints for user management',
        },
      ],
    }),
  })),
}));

function makeMockPipeline(overrides: Partial<CliPipeline> = {}): CliPipeline {
  return {
    scanRepo: vi.fn().mockResolvedValue({
      files: [
        {
          file: 'docs/auth.md',
          claims: [
            {
              id: 'c1',
              source_file: 'docs/auth.md',
              line_number: 10,
              claim_text: 'Password hashing uses bcrypt',
              claim_type: 'behavior',
            },
          ],
          results: [
            {
              claim_id: 'c1',
              verdict: 'verified',
              severity: null,
              evidence_files: ['src/auth/password.ts'],
            },
          ],
        },
        {
          file: 'docs/api.md',
          claims: [
            {
              id: 'c2',
              source_file: 'docs/api.md',
              line_number: 20,
              claim_text: 'GET /users returns a list',
              claim_type: 'behavior',
            },
          ],
          results: [
            {
              claim_id: 'c2',
              verdict: 'drifted',
              severity: 'high',
              evidence_files: ['src/routes/users.ts'],
            },
          ],
        },
      ],
    }),
    ...overrides,
  } as unknown as CliPipeline;
}

describe('search command', () => {
  it('returns exit code 2 and prints usage when no query and no --code-file', async () => {
    const output: string[] = [];
    const write = (msg: string) => output.push(msg);
    const pipeline = makeMockPipeline();

    const exitCode = await runSearch(pipeline, undefined, {}, write);

    expect(exitCode).toBe(2);
    expect(output.some((line) => line.includes('Usage'))).toBe(true);
  });

  it('performs topic search and returns results with exit code 0', async () => {
    const output: string[] = [];
    const write = (msg: string) => output.push(msg);
    const pipeline = makeMockPipeline();

    const exitCode = await runSearch(pipeline, 'authentication', {}, write, '/tmp/repo');

    expect(exitCode).toBe(0);
    expect(output.some((line) => line.includes('2 match(es) found'))).toBe(true);
    expect(output.some((line) => line.includes('docs/auth.md'))).toBe(true);
    expect(output.some((line) => line.includes('[DRIFTED]'))).toBe(true);
  });

  it('performs --code-file reverse lookup and returns matching claims', async () => {
    const output: string[] = [];
    const write = (msg: string) => output.push(msg);
    const pipeline = makeMockPipeline();

    const exitCode = await runSearch(pipeline, undefined, { codeFile: 'src/auth/password.ts' }, write, '/tmp/repo');

    expect(exitCode).toBe(0);
    expect(output.some((line) => line.includes('1 doc reference(s)'))).toBe(true);
    expect(output.some((line) => line.includes('docs/auth.md'))).toBe(true);
  });

  it('outputs valid JSON when --json flag is set for topic search', async () => {
    const output: string[] = [];
    const write = (msg: string) => output.push(msg);
    const pipeline = makeMockPipeline();

    const exitCode = await runSearch(pipeline, 'auth', { json: true }, write, '/tmp/repo');

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output.join(''));
    expect(parsed).toHaveProperty('query', 'auth');
    expect(parsed).toHaveProperty('search_results');
    expect(parsed.search_results.sections).toHaveLength(2);
  });

  it('outputs valid JSON for --code-file with --json flag', async () => {
    const output: string[] = [];
    const write = (msg: string) => output.push(msg);
    const pipeline = makeMockPipeline();

    const exitCode = await runSearch(pipeline, undefined, { codeFile: 'src/auth/password.ts', json: true }, write, '/tmp/repo');

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output.join(''));
    expect(parsed).toHaveProperty('code_file', 'src/auth/password.ts');
    expect(parsed).toHaveProperty('referencing_docs');
    expect(parsed.referencing_docs).toHaveLength(1);
  });
});
