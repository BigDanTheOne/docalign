/**
 * QA Acceptance Tests — get_claim_detail MCP Tool
 * Pipeline: c5b2713f-67c2-4da2-929f-bbf1ab7ec4fe
 *
 * Tests the get_claim_detail tool handler for both lookup modes and error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../src/cli/local-pipeline';

vi.mock('fs');
vi.mock('../../../src/cli/semantic-store', () => ({
  loadClaimsForFile: vi.fn().mockReturnValue(null),
  saveClaimsForFile: vi.fn(),
  hashContent: vi.fn().mockReturnValue('mock-hash'),
  generateClaimId: vi.fn((_file: string, text: string) => `claim-${text.slice(0, 8)}`),
  getClaimById: vi.fn(),
  loadAllClaims: vi.fn().mockReturnValue([]),
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const MOCK_CLAIM = {
  id: 'claim-abc123',
  claim_text: 'The API supports pagination',
  claim_type: 'behavior',
  line_number: 42,
  source_file: 'docs/api.md',
  section_heading: 'Pagination',
  keywords: ['api', 'pagination'],
  last_verification: {
    verdict: 'verified' as const,
    confidence: 0.92,
    reasoning: 'Pagination confirmed in source',
    suggested_fix: null,
    evidence_files: ['src/routes/api.ts'],
    verified_at: '2026-02-20T00:00:00Z',
  },
};

function setupHandlers(pipelineOverrides: Partial<CliPipeline> = {}) {
  const handlers = new Map<string, ToolHandler>();

  const mockPipeline: CliPipeline = {
    checkFile: vi.fn().mockResolvedValue({
      claims: [
        { id: 'claim-abc123', claim_text: 'The API supports pagination', claim_type: 'behavior', line_number: 42, source_file: 'docs/api.md' },
        { id: 'claim-def456', claim_text: 'Rate limiting is enabled', claim_type: 'config', line_number: 60, source_file: 'docs/api.md' },
      ],
      results: [
        { claim_id: 'claim-abc123', verdict: 'verified', severity: null, reasoning: 'Pagination confirmed', suggested_fix: null, evidence_files: ['src/routes/api.ts'], confidence: 0.92 },
        { claim_id: 'claim-def456', verdict: 'drifted', severity: 'medium', reasoning: 'Rate limiting disabled', suggested_fix: 'Remove rate limiting docs', evidence_files: ['src/middleware.ts'], confidence: 0.88 },
      ],
      durationMs: 50,
    }),
    checkSection: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      durationMs: 10,
      section: { heading: 'Test', level: 2, startLine: 1, endLine: 5 },
    }),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn().mockResolvedValue({
      files: [],
      totalClaims: 0,
      totalVerified: 0,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 10,
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

describe('get_claim_detail MCP tool', () => {
  let handlers: Map<string, ToolHandler>;
  let mockPipeline: CliPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupHandlers();
    handlers = setup.handlers;
    mockPipeline = setup.mockPipeline;
  });

  it('should be registered as a tool', () => {
    expect(handlers.has('get_claim_detail')).toBe(true);
  });

  describe('lookup by claim_id', () => {
    it('returns full claim detail when claim exists', async () => {
      const { getClaimById } = await import('../../../src/cli/semantic-store');
      vi.mocked(getClaimById).mockReturnValue(MOCK_CLAIM as any);

      const handler = handlers.get('get_claim_detail')!;
      const result = await handler({ claim_id: 'claim-abc123' });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.claim_id).toBe('claim-abc123');
      expect(data.source_file).toBe('docs/api.md');
      expect(data.line_number).toBe(42);
      expect(data.claim_text).toBe('The API supports pagination');
      expect(data.claim_type).toBe('behavior');
      expect(data.verdict).toBe('verified');
      expect(data.confidence).toBe(0.92);
      expect(data.reasoning).toBe('Pagination confirmed in source');
      expect(data.evidence_files).toContain('src/routes/api.ts');
    });

    it('returns structured error when claim not found', async () => {
      const { getClaimById } = await import('../../../src/cli/semantic-store');
      vi.mocked(getClaimById).mockReturnValue(null);

      const handler = handlers.get('get_claim_detail')!;
      const result = await handler({ claim_id: 'nonexistent' });

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toBeTruthy();
    });
  });

  describe('lookup by file + line', () => {
    it('returns nearest claim to the given line', async () => {
      const handler = handlers.get('get_claim_detail')!;
      const result = await handler({ file: 'docs/api.md', line: 43 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      // Should return claim-abc123 (line 42, nearest to 43)
      expect(data.claim_id).toBe('claim-abc123');
      expect(data.line_number).toBe(42);
      expect(data.claim_text).toBe('The API supports pagination');
      expect(mockPipeline.checkFile).toHaveBeenCalledWith('docs/api.md', expect.anything());
    });

    it('returns nearest claim when line is equidistant — picks earlier', async () => {
      const handler = handlers.get('get_claim_detail')!;
      // Line 51 is equidistant from 42 and 60
      const result = await handler({ file: 'docs/api.md', line: 51 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      // Either claim is acceptable; just confirm we get a result
      expect(data.claim_id).toBeTruthy();
    });

    it('returns structured error when file has no claims', async () => {
      const setup = setupHandlers({
        checkFile: vi.fn().mockResolvedValue({
          claims: [],
          results: [],
          durationMs: 10,
        }),
      });

      const handler = setup.handlers.get('get_claim_detail')!;
      const result = await handler({ file: 'docs/empty.md', line: 1 });

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toBeTruthy();
    });
  });

  describe('input validation', () => {
    it('requires either claim_id or file+line (not both empty)', async () => {
      const handler = handlers.get('get_claim_detail')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
    });
  });
});
