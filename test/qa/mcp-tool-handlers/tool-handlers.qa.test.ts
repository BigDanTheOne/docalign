/**
 * QA Acceptance Tests: MCP Tool Handler Unit Tests
 * Pipeline: d75b0e5a-fbec-4e4b-b97b-f19dcae888a0
 *
 * These tests verify that each MCP tool handler produces correct output
 * for happy-path and basic error scenarios. They exercise the actual
 * handler callbacks (not just registration).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerLocalTools } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../src/cli/local-pipeline';
import fs from 'fs';

// Capture registered tool handlers for invocation
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

interface RegisteredTool {
  name: string;
  handler: ToolHandler;
}

function captureTools(pipeline: CliPipeline, repoRoot: string): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const mockServer = {
    tool: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      // Handler is always the last argument
      const handler = args[args.length - 1] as ToolHandler;
      tools.push({ name, handler });
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerLocalTools(mockServer as any, pipeline, repoRoot);
  return tools;
}

function getToolHandler(tools: RegisteredTool[], name: string): ToolHandler {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool.handler;
}

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('QA: MCP Tool Handlers — Happy Path Coverage', () => {
  let tools: RegisteredTool[];
  let mockPipeline: CliPipeline;
  const repoRoot = '/tmp/qa-test-repo';

  beforeEach(() => {
    vi.restoreAllMocks();

    mockPipeline = {
      checkFile: vi.fn().mockResolvedValue({
        claims: [
          { id: 'c1', claim_text: 'Function foo exists', claim_type: 'behavior', line_number: 10, source_file: 'README.md' },
          { id: 'c2', claim_text: 'Config uses port 3000', claim_type: 'config', line_number: 20, source_file: 'README.md' },
        ],
        results: [
          { claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'Found', suggested_fix: null, evidence_files: ['src/foo.ts'], confidence: 0.9 },
          { claim_id: 'c2', verdict: 'drifted', severity: 'high', reasoning: 'Port changed to 8080', suggested_fix: 'Update to 8080', evidence_files: ['config.ts'], confidence: 0.95 },
        ],
        durationMs: 42,
      }),
      checkSection: vi.fn().mockResolvedValue({
        claims: [
          { id: 'c1', claim_text: 'Function foo exists', claim_type: 'behavior', line_number: 10, source_file: 'README.md' },
        ],
        results: [
          { claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'Found', suggested_fix: null, evidence_files: ['src/foo.ts'], confidence: 0.9 },
        ],
        durationMs: 15,
        section: { heading: 'Installation', startLine: 5, endLine: 20 },
      }),
      listSections: vi.fn().mockReturnValue([
        { text: 'Installation', line: 5, level: 2 },
        { text: 'Usage', line: 25, level: 2 },
      ]),
      scanRepo: vi.fn().mockResolvedValue({
        files: [
          {
            file: 'README.md',
            claims: [
              { id: 'c1', claim_text: 'test', claim_type: 'behavior', line_number: 1, source_file: 'README.md' },
            ],
            results: [
              { claim_id: 'c1', verdict: 'drifted', severity: 'medium', reasoning: 'Outdated', suggested_fix: null, evidence_files: ['src/main.ts'], confidence: 0.8 },
            ],
            durationMs: 10,
          },
        ],
        totalClaims: 1,
        totalVerified: 0,
        totalDrifted: 1,
        totalUncertain: 0,
        durationMs: 50,
      }),
    };

    tools = captureTools(mockPipeline, repoRoot);
  });

  // --- check_doc ---

  describe('check_doc', () => {
    it('returns file-level check results with findings', async () => {
      const handler = getToolHandler(tools, 'check_doc');
      const result = await handler({ file: 'README.md' });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.file).toBe('README.md');
      expect(data.total_claims).toBe(2);
      expect(data.verified).toBe(1);
      expect(data.drifted).toBe(1);
      expect(data.duration_ms).toBe(42);
      expect(data.findings).toHaveLength(1);
      expect(data.findings[0].claim_text).toBe('Config uses port 3000');
      expect(data.findings[0].severity).toBe('high');
      expect(data.findings[0].suggested_fix).toBe('Update to 8080');
    });

    it('scopes to a section when section param provided', async () => {
      const handler = getToolHandler(tools, 'check_doc');
      const result = await handler({ file: 'README.md', section: 'Installation' });

      const data = parseResult(result);
      expect(data.section).toBe('Installation');
      expect(data.section_lines).toBe('5-20');
      expect(mockPipeline.checkSection).toHaveBeenCalledWith('README.md', 'Installation');
    });

    it('returns error response on pipeline failure', async () => {
      (mockPipeline.checkFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('File not found'));
      const handler = getToolHandler(tools, 'check_doc');
      const result = await handler({ file: 'nonexistent.md' });

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toBe('File not found');
    });

    it('includes semantic claims and unchecked sections when deep=true', async () => {
      // Mock fs operations for deep mode
      const fileContent = '# README\n\n## Installation\n\nContent here\n\n## Usage\n\nMore content\n';
      const semanticData = {
        version: 1,
        source_file: 'README.md',
        last_extracted_at: '2024-01-01T00:00:00.000Z',
        claims: [
          {
            id: 'sem1',
            source_file: 'README.md',
            line_number: 3,
            claim_text: 'Installation requires Node.js',
            claim_type: 'config',
            keywords: ['installation', 'nodejs'],
            section_heading: 'Installation',
            section_content_hash: 'hash123',
            extracted_at: '2024-01-01T00:00:00.000Z',
            evidence_entities: [],
            evidence_assertions: [],
            last_verification: {
              verdict: 'verified',
              confidence: 0.95,
              reasoning: 'Confirmed in package.json',
              verified_at: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      };

      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = p.toString();
        // Mock both the actual file and the semantic store file
        return pathStr.includes('README.md');
      });

      const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('.docalign/semantic')) {
          return JSON.stringify(semanticData);
        }
        return fileContent;
      });

      const handler = getToolHandler(tools, 'check_doc');
      const result = await handler({ file: 'README.md', deep: true });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.semantic).toBeDefined();
      expect(data.semantic.total_claims).toBe(1);
      expect(data.semantic.findings).toHaveLength(1);
      expect(data.semantic.findings[0].claim_text).toBe('Installation requires Node.js');
      expect(data.unchecked_sections).toBeDefined();
      expect(data.coverage).toBeDefined();
      expect(data.coverage.total_sections).toBeGreaterThan(0);

      existsSyncSpy.mockRestore();
      readFileSyncSpy.mockRestore();
    });
  });

  // --- scan_docs ---

  describe('scan_docs', () => {
    it('returns health score and hotspots', async () => {
      const handler = getToolHandler(tools, 'scan_docs');
      const result = await handler({});

      const data = parseResult(result);
      expect(data.health_score).toBeDefined();
      expect(typeof data.health_score).toBe('number');
      expect(data.doc_files_scanned).toBe(1);
      expect(data.hotspots).toBeInstanceOf(Array);
      expect(data.duration_ms).toBe(50);
    });

    it('respects max_results parameter', async () => {
      const handler = getToolHandler(tools, 'scan_docs');
      const result = await handler({ max_results: 5 });

      const data = parseResult(result);
      expect(data.hotspots.length).toBeLessThanOrEqual(5);
    });

    it('returns error on scan failure', async () => {
      (mockPipeline.scanRepo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Scan failed'));
      const handler = getToolHandler(tools, 'scan_docs');
      const result = await handler({});

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toBe('Scan failed');
    });
  });

  // --- get_docs ---

  describe('get_docs', () => {
    it('returns error when neither query nor code_file provided', async () => {
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({});

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('query');
    });

    it('returns referencing docs for code_file', async () => {
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({ code_file: 'src/main.ts' });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.code_file).toBe('src/main.ts');
      expect(data.referencing_docs).toBeInstanceOf(Array);
    });

    it('searches by query parameter', async () => {
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({ query: 'authentication' });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.query).toBe('authentication');
      expect(data.search_results).toBeDefined();
    });

    it('combines query and code_file parameters', async () => {
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({ query: 'api', code_file: 'src/main.ts' });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.query).toBe('api');
      expect(data.code_file).toBe('src/main.ts');
      expect(data.search_results).toBeDefined();
      expect(data.referencing_docs).toBeInstanceOf(Array);
    });

    it('returns error on failure', async () => {
      (mockPipeline.scanRepo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({ code_file: 'src/main.ts' });

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toBe('DB error');
    });
  });

  // --- register_claims ---

  describe('register_claims', () => {
    it('registers claims and returns IDs', async () => {
      // Mock fs for register_claims - need to handle both source file and semantic store
      const existingSemantic = {
        version: 1,
        source_file: 'README.md',
        last_extracted_at: '2024-01-01T00:00:00.000Z',
        claims: [],
      };

      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = p.toString();
        // Return true for the source file, false for semantic store (new file)
        if (pathStr.includes('.docalign/semantic')) {
          return false; // No existing semantic file
        }
        return pathStr.includes('README.md'); // Source file exists
      });

      const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('.docalign/semantic')) {
          return JSON.stringify(existingSemantic);
        }
        return '# Test Doc\n\nSome content\n';
      });

      const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
      const renameSyncSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {});

      const handler = getToolHandler(tools, 'register_claims');
      const result = await handler({
        claims: [
          {
            source_file: 'README.md',
            line_number: 5,
            claim_text: 'Function bar is exported',
            claim_type: 'behavior',
            keywords: ['bar', 'export'],
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.registered).toBe(1);
      expect(data.claim_ids).toHaveLength(1);
      expect(typeof data.claim_ids[0]).toBe('string');

      // Cleanup
      existsSyncSpy.mockRestore();
      readFileSyncSpy.mockRestore();
      writeFileSyncSpy.mockRestore();
      mkdirSyncSpy.mockRestore();
      renameSyncSpy.mockRestore();
    });

    it('silently skips files that do not exist', async () => {
      // Mock fs - file does not exist
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const handler = getToolHandler(tools, 'register_claims');
      const result = await handler({
        claims: [
          {
            source_file: 'NONEXISTENT.md',
            line_number: 1,
            claim_text: 'test claim',
            claim_type: 'behavior',
            keywords: ['test'],
          },
        ],
      });

      // Should succeed but skip the non-existent file
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.registered).toBe(1);
      expect(data.claim_ids).toHaveLength(0); // No IDs because file was skipped

      existsSyncSpy.mockRestore();
    });

    it('returns error on failure', async () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation(() => { throw new Error('Permission denied'); });

      const handler = getToolHandler(tools, 'register_claims');
      const result = await handler({
        claims: [
          {
            source_file: 'README.md',
            line_number: 1,
            claim_text: 'test',
            claim_type: 'behavior',
            keywords: ['test'],
          },
        ],
      });

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toBe('Permission denied');

      existsSyncSpy.mockRestore();
    });
  });
});

describe('QA: All 4 tool handlers are exported and testable', () => {
  it('registerLocalTools registers exactly 4 tools', () => {
    const mockPipeline = {
      checkFile: vi.fn().mockResolvedValue({ claims: [], results: [], durationMs: 0 }),
      checkSection: vi.fn().mockResolvedValue({ claims: [], results: [], durationMs: 0 }),
      listSections: vi.fn().mockReturnValue([]),
      scanRepo: vi.fn().mockResolvedValue({ files: [], totalClaims: 0, totalVerified: 0, totalDrifted: 0, totalUncertain: 0, durationMs: 0 }),
    };

    const tools = captureTools(mockPipeline, '/tmp/test');
    expect(tools).toHaveLength(4);
    expect(tools.map(t => t.name).sort()).toEqual(['check_doc', 'get_docs', 'register_claims', 'scan_docs']);
  });
});

describe('QA: formatHealthResponse utility', () => {
  it('formats scan results correctly', async () => {
    const { formatHealthResponse } = await import('../../../src/layers/L6-mcp/tool-handlers');
    const mockScanResult = {
      files: [
        {
          file: 'README.md',
          claims: [
            { id: 'c1', claim_text: 'test1', claim_type: 'behavior', line_number: 1, source_file: 'README.md' },
            { id: 'c2', claim_text: 'test2', claim_type: 'config', line_number: 2, source_file: 'README.md' },
          ],
          results: [
            { claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'OK', suggested_fix: null, evidence_files: [], confidence: 0.9 },
            { claim_id: 'c2', verdict: 'drifted', severity: 'medium', reasoning: 'Outdated', suggested_fix: null, evidence_files: [], confidence: 0.8 },
          ],
          durationMs: 10,
        },
      ],
      totalClaims: 2,
      totalVerified: 1,
      totalDrifted: 1,
      totalUncertain: 0,
      durationMs: 50,
    };

    const response = formatHealthResponse(mockScanResult);
    const data = JSON.parse(response.content[0].text);

    expect(data.health_score).toBe(50); // 1 verified / 2 total = 50%
    expect(data.total_scored).toBe(2);
    expect(data.verified).toBe(1);
    expect(data.drifted).toBe(1);
    expect(data.doc_files_scanned).toBe(1);
    expect(data.duration_ms).toBe(50);
    expect(data.hotspots).toBeInstanceOf(Array);
  });
});
