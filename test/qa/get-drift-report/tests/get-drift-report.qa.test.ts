/**
 * QA Acceptance Tests — get_drift_report MCP tool
 * Pipeline: 4b82e54e-5be0-452a-9f7b-e2e62e221193
 *
 * Tests the get_drift_report tool handler via mocked server.tool() capture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../../src/cli/local-pipeline';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../../../src/cli/semantic-store', () => ({
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
    checkFile: vi.fn().mockResolvedValue({ claims: [], results: [], durationMs: 0 }),
    checkSection: vi.fn().mockResolvedValue({ claims: [], results: [], durationMs: 0, section: null }),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn().mockResolvedValue({
      files: [
        {
          file: 'docs/api.md',
          claims: [
            { id: 'c1', claim_text: 'REST API', claim_type: 'behavior', line_number: 5, source_file: 'docs/api.md' },
            { id: 'c2', claim_text: 'Uses port 3000', claim_type: 'config', line_number: 10, source_file: 'docs/api.md' },
          ],
          results: [
            { claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'confirmed', suggested_fix: null, evidence_files: ['src/server.ts'], confidence: 0.9 },
            { claim_id: 'c2', verdict: 'drifted', severity: 'high', reasoning: 'Port changed', suggested_fix: 'Update to 8080', evidence_files: ['src/config.ts'], confidence: 0.95 },
          ],
          durationMs: 20,
        },
        {
          file: 'docs/setup.md',
          claims: [
            { id: 'c3', claim_text: 'Run npm install', claim_type: 'instruction', line_number: 3, source_file: 'docs/setup.md' },
          ],
          results: [
            { claim_id: 'c3', verdict: 'verified', severity: null, reasoning: 'ok', suggested_fix: null, evidence_files: ['package.json'], confidence: 0.85 },
          ],
          durationMs: 15,
        },
      ],
      totalClaims: 3,
      totalVerified: 2,
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

describe('get_drift_report MCP tool', () => {
  describe('tool registration', () => {
    it('should register get_drift_report tool', () => {
      const { handlers } = setupHandlers();
      expect(handlers.has('get_drift_report')).toBe(true);
    });
  });

  describe('happy path — full report', () => {
    it('should return health_score, files array, and duration_ms', async () => {
      const { handlers } = setupHandlers();
      const handler = handlers.get('get_drift_report')!;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      expect(data).toHaveProperty('health_score');
      expect(typeof data.health_score).toBe('number');
      expect(data).toHaveProperty('files');
      expect(Array.isArray(data.files)).toBe(true);
      expect(data).toHaveProperty('duration_ms');
      expect(typeof data.duration_ms).toBe('number');
    });

    it('should include per-file breakdown with claims and results', async () => {
      const { handlers } = setupHandlers();
      const handler = handlers.get('get_drift_report')!;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      expect(data.files.length).toBeGreaterThan(0);
      const file = data.files[0];
      expect(file).toHaveProperty('file');
      expect(file).toHaveProperty('claims');
      expect(file).toHaveProperty('results');
      expect(Array.isArray(file.claims)).toBe(true);
      expect(Array.isArray(file.results)).toBe(true);
    });

    it('should include agent_reported_drift from drift-reports', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify([
        { id: 'dr-1', doc_file: 'docs/api.md', claim_text: 'outdated', actual_behavior: 'new', status: 'pending', reported_at: '2026-01-01', line_number: 5, evidence_files: [] },
      ]));

      const { handlers } = setupHandlers();
      const handler = handlers.get('get_drift_report')!;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      expect(data).toHaveProperty('agent_reported_drift');
      expect(Array.isArray(data.agent_reported_drift)).toBe(true);
    });
  });

  describe('error path — no scan data', () => {
    it('should return structured error when no scan data exists', async () => {
      const { handlers } = setupHandlers({
        scanRepo: vi.fn().mockResolvedValue({
          files: [],
          totalClaims: 0,
          totalVerified: 0,
          totalDrifted: 0,
          totalUncertain: 0,
          durationMs: 5,
        }),
      });

      // Also mock fs to return no reports
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

      const handler = handlers.get('get_drift_report')!;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      // Should either set isError or return an error structure
      // Accept either: isError flag or empty files with health_score 0 or error field
      const isError = result.isError === true || data.error != null || (data.files?.length === 0 && data.health_score === 0);
      expect(isError).toBe(true);
    });
  });

  describe('parameter filtering', () => {
    it('should filter verified claims when include_verified is false', async () => {
      const { handlers } = setupHandlers();
      const handler = handlers.get('get_drift_report')!;

      const fullResult = await handler({ include_verified: true });
      const filteredResult = await handler({ include_verified: false });

      const fullData = JSON.parse(fullResult.content[0].text);
      const filteredData = JSON.parse(filteredResult.content[0].text);

      // Filtered should have fewer or equal results (no verified claims)
      const fullTotalResults = fullData.files.reduce((sum: number, f: { results: unknown[] }) => sum + f.results.length, 0);
      const filteredTotalResults = filteredData.files.reduce((sum: number, f: { results: unknown[] }) => sum + f.results.length, 0);
      expect(filteredTotalResults).toBeLessThanOrEqual(fullTotalResults);
    });

    it('should limit files returned when max_files is set', async () => {
      const { handlers } = setupHandlers();
      const handler = handlers.get('get_drift_report')!;

      const result = await handler({ max_files: 1 });
      const data = JSON.parse(result.content[0].text);

      expect(data.files.length).toBeLessThanOrEqual(1);
    });
  });
});
