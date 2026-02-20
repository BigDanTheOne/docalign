/**
 * QA Acceptance Tests — MCP Tool Handlers
 * Pipeline: 8639115a-daa6-446f-83ad-7d526ba64984
 *
 * Tests actual handler execution (not just registration).
 * Captures handler functions from server.tool() mock and invokes them directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../src/cli/local-pipeline';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../../src/cli/semantic-store', () => ({
  loadClaimsForFile: vi.fn().mockReturnValue(null),
  saveClaimsForFile: vi.fn(),
  hashContent: vi.fn().mockReturnValue('mock-hash'),
  generateClaimId: vi.fn((_file: string, text: string) => `claim-${text.slice(0, 8)}`),
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function setupHandlers(pipelineOverrides: Partial<CliPipeline> = {}) {
  const handlers = new Map<string, ToolHandler>();

  const mockPipeline: CliPipeline = {
    checkFile: vi.fn().mockResolvedValue({
      claims: [
        { id: 'c1', claim_text: 'API uses REST', claim_type: 'behavior', line_number: 5, source_file: 'docs/api.md' },
        { id: 'c2', claim_text: 'Port 3000', claim_type: 'config', line_number: 10, source_file: 'docs/api.md' },
      ],
      results: [
        { claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'confirmed', suggested_fix: null, evidence_files: ['src/server.ts'], confidence: 0.9 },
        { claim_id: 'c2', verdict: 'drifted', severity: 'high', reasoning: 'Port changed to 8080', suggested_fix: 'Update to 8080', evidence_files: ['src/config.ts'], confidence: 0.95 },
      ],
      durationMs: 42,
    }),
    checkSection: vi.fn().mockResolvedValue({
      claims: [{ id: 'c1', claim_text: 'API uses REST', claim_type: 'behavior', line_number: 5, source_file: 'docs/api.md' }],
      results: [{ claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'ok', suggested_fix: null, evidence_files: [], confidence: 0.9 }],
      durationMs: 15,
      section: { heading: 'Overview', level: 2, startLine: 1, endLine: 10 },
    }),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn().mockResolvedValue({
      files: [
        {
          file: 'docs/api.md',
          claims: [
            { id: 'c1', claim_text: 'REST API', claim_type: 'behavior', line_number: 5, source_file: 'docs/api.md' },
          ],
          results: [
            { claim_id: 'c1', verdict: 'drifted', severity: 'high', reasoning: 'outdated', suggested_fix: 'fix', evidence_files: ['src/server.ts'], confidence: 0.9 },
          ],
          durationMs: 20,
        },
      ],
      totalClaims: 1,
      totalVerified: 0,
      totalDrifted: 1,
      totalUncertain: 0,
      durationMs: 50,
    }),
    ...pipelineOverrides,
  };

  const server = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;

  registerLocalTools(server, mockPipeline, '/tmp/test-repo');

  return { handlers, mockPipeline, server };
}

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

// ──────────────────────────────────────────────
// check_doc
// ──────────────────────────────────────────────
describe('check_doc handler', () => {
  it('returns findings with correct structure for a file check', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('check_doc')!;
    const result = await handler({ file: 'docs/api.md' });
    const data = parseResult(result);

    expect(data.file).toBe('docs/api.md');
    expect(data.total_claims).toBe(2);
    expect(data.verified).toBe(1);
    expect(data.drifted).toBe(1);
    expect(data.duration_ms).toBe(42);
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0]).toMatchObject({
      claim_text: 'Port 3000',
      severity: 'high',
      reasoning: 'Port changed to 8080',
      suggested_fix: 'Update to 8080',
    });
  });

  it('returns section info when section param is provided', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('check_doc')!;
    const result = await handler({ file: 'docs/api.md', section: 'Overview' });
    const data = parseResult(result);

    expect(data.section).toBe('Overview');
    expect(data.section_lines).toBe('1-10');
    expect(data.verified).toBe(1);
    expect(data.drifted).toBe(0);
  });

  it('returns isError on exception', async () => {
    const { handlers } = setupHandlers({
      checkFile: vi.fn().mockRejectedValue(new Error('File not found')),
    });
    const handler = handlers.get('check_doc')!;
    const result = await handler({ file: 'nonexistent.md' });

    expect(result.isError).toBe(true);
    const data = parseResult(result);
    expect(data.error).toBe('File not found');
  });

  it('includes deep audit data when deep=true', async () => {
    const mockedFs = vi.mocked(fs);
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('# Intro\nSome text\n# API\nMore text\n');

    const { loadClaimsForFile } = await import('../../../src/cli/semantic-store');
    vi.mocked(loadClaimsForFile).mockReturnValue({
      version: 1,
      source_file: 'docs/api.md',
      last_extracted_at: '2026-01-01',
      claims: [{
        id: 'sc1',
        source_file: 'docs/api.md',
        line_number: 3,
        claim_text: 'Uses Express',
        claim_type: 'architecture',
        keywords: ['express'],
        section_content_hash: 'h1',
        section_heading: 'API',
        extracted_at: '2026-01-01',
        evidence_entities: [],
        evidence_assertions: [],
        last_verification: {
          verdict: 'verified',
          confidence: 0.9,
          reasoning: 'ok',
          verified_at: '2026-01-01',
        },
      }],
    });

    const { handlers } = setupHandlers();
    const handler = handlers.get('check_doc')!;
    const result = await handler({ file: 'docs/api.md', deep: true });
    const data = parseResult(result);

    expect(data.semantic).toBeDefined();
    expect(data.semantic.total_claims).toBe(1);
    expect(data.coverage).toBeDefined();
    expect(data.coverage.total_sections).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────
// scan_docs
// ──────────────────────────────────────────────
describe('scan_docs handler', () => {
  it('returns health score and hotspots', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('scan_docs')!;
    const result = await handler({});
    const data = parseResult(result);

    expect(data.health_score).toBeDefined();
    expect(typeof data.health_score).toBe('number');
    expect(data.hotspots).toBeDefined();
    expect(Array.isArray(data.hotspots)).toBe(true);
    expect(data.doc_files_scanned).toBe(1);
  });

  it('respects max_results parameter', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('scan_docs')!;
    const result = await handler({ max_results: 1 });
    const data = parseResult(result);

    expect(data.hotspots.length).toBeLessThanOrEqual(1);
  });

  it('returns isError on scan failure', async () => {
    const { handlers } = setupHandlers({
      scanRepo: vi.fn().mockRejectedValue(new Error('Scan failed')),
    });
    const handler = handlers.get('scan_docs')!;
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toBe('Scan failed');
  });
});

// ──────────────────────────────────────────────
// get_docs
// ──────────────────────────────────────────────
describe('get_docs handler', () => {
  it('returns error when neither query nor code_file provided', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('get_docs')!;
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toContain('Provide at least one');
  });

  it('returns referencing docs for code_file lookup', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('get_docs')!;
    const result = await handler({ code_file: 'src/server.ts' });
    const data = parseResult(result);

    expect(data.code_file).toBe('src/server.ts');
    expect(data.referencing_docs).toBeDefined();
    expect(Array.isArray(data.referencing_docs)).toBe(true);
  });

  it('handles combined query + code_file', async () => {
    const { handlers } = setupHandlers();
    const handler = handlers.get('get_docs')!;
    const result = await handler({ query: 'REST', code_file: 'src/server.ts' });
    const data = parseResult(result);

    expect(data.code_file).toBe('src/server.ts');
    expect(data.query).toBe('REST');
    expect(data.referencing_docs).toBeDefined();
    expect(data.search_results).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// register_claims
// ──────────────────────────────────────────────
describe('register_claims handler', () => {
  beforeEach(() => {
    vi.mocked(fs).existsSync.mockReturnValue(true);
    vi.mocked(fs).readFileSync.mockReturnValue('# Section\nContent here\n');
  });

  it('persists new claims and returns claim ids', async () => {
    const { saveClaimsForFile } = await import('../../../src/cli/semantic-store');

    const { handlers } = setupHandlers();
    const handler = handlers.get('register_claims')!;
    const result = await handler({
      claims: [{
        source_file: 'docs/api.md',
        line_number: 5,
        claim_text: 'Uses REST API',
        claim_type: 'behavior',
        keywords: ['rest', 'api'],
      }],
    });
    const data = parseResult(result);

    expect(data.registered).toBe(1);
    expect(data.claim_ids).toHaveLength(1);
    expect(saveClaimsForFile).toHaveBeenCalled();
  });

  it('includes verification data when provided', async () => {
    const { saveClaimsForFile } = await import('../../../src/cli/semantic-store');

    const { handlers } = setupHandlers();
    const handler = handlers.get('register_claims')!;
    await handler({
      claims: [{
        source_file: 'docs/api.md',
        line_number: 5,
        claim_text: 'Uses REST API',
        claim_type: 'behavior',
        keywords: ['rest'],
        verification: { verdict: 'verified', confidence: 0.95, reasoning: 'confirmed in code' },
      }],
    });

    const savedData = vi.mocked(saveClaimsForFile).mock.calls[0]?.[2];
    expect(savedData).toBeDefined();
    if (savedData) {
      const claim = savedData.claims.find((c: { id: string }) => c.id.startsWith('claim-'));
      expect(claim?.last_verification?.verdict).toBe('verified');
    }
  });

  it('returns isError on failure', async () => {
    vi.mocked(fs).existsSync.mockImplementation(() => { throw new Error('FS error'); });

    const { handlers } = setupHandlers();
    const handler = handlers.get('register_claims')!;
    const result = await handler({
      claims: [{
        source_file: 'docs/api.md',
        line_number: 1,
        claim_text: 'test',
        claim_type: 'behavior',
        keywords: [],
      }],
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).error).toBe('FS error');
  });
});
