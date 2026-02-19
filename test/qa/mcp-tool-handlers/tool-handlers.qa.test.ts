/**
 * QA Acceptance Tests: MCP Tool Handler Unit Tests
 * Pipeline: d75b0e5a-fbec-4e4b-b97b-f19dcae888a0
 *
 * These tests verify that each MCP tool handler produces correct output
 * for happy-path and basic error scenarios. They exercise the actual
 * handler callbacks (not just registration).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerLocalTools, formatHealthResponse } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline, ScanResult } from '../../../src/cli/local-pipeline';
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

    it('returns deep audit with semantic claims and coverage when deep:true', async () => {
      // Mock filesystem for semantic claims
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('# Test Doc\n\n## Installation\n\nSome content\n\n## Usage\n\nMore content\n');

      const handler = getToolHandler(tools, 'check_doc');
      const result = await handler({ file: 'README.md', deep: true });

      const data = parseResult(result);
      expect(data.file).toBe('README.md');
      expect(data.semantic).toBeDefined();
      expect(data.semantic.total_claims).toBeDefined();
      expect(data.semantic.findings).toBeInstanceOf(Array);
      expect(data.unchecked_sections).toBeInstanceOf(Array);
      expect(data.coverage).toBeDefined();
      expect(data.coverage.total_sections).toBeDefined();
      expect(data.coverage.checked_sections).toBeDefined();
      expect(data.coverage.coverage_pct).toBeDefined();
      expect(data.warnings).toBeInstanceOf(Array);
    });

    it('returns error response on pipeline failure', async () => {
      (mockPipeline.checkFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('File not found'));
      const handler = getToolHandler(tools, 'check_doc');
      const result = await handler({ file: 'nonexistent.md' });

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toBe('File not found');
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

    it('returns search results for query parameter', async () => {
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({ query: 'authentication' });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.query).toBe('authentication');
      expect(data.search_results).toBeDefined();
    });

    it('returns combined results for query + code_file', async () => {
      const handler = getToolHandler(tools, 'get_docs');
      const result = await handler({ query: 'authentication', code_file: 'src/main.ts' });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.query).toBe('authentication');
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
      // Mock fs for register_claims - need to mock all file operations
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const pathStr = String(filePath);
        if (pathStr.includes('.docalign/semantic')) {
          // Return null for loadClaimsForFile (file doesn't exist yet)
          throw new Error('ENOENT');
        }
        // Return doc content for the actual README.md
        return '# Test Doc\n\nSome content\n';
      });
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

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
    });

    it('silently skips claims when source file does not exist', async () => {
      // First file exists, second doesn't
      vi.spyOn(fs, 'existsSync').mockImplementation((filePath: fs.PathLike) => {
        const pathStr = String(filePath);
        // README.md exists, NONEXISTENT.md doesn't
        return pathStr.includes('README.md');
      });
      vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const pathStr = String(filePath);
        if (pathStr.includes('.docalign/semantic')) {
          throw new Error('ENOENT');
        }
        return '# Test Doc\n\nSome content\n';
      });
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

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
          {
            source_file: 'NONEXISTENT.md',
            line_number: 1,
            claim_text: 'This file does not exist',
            claim_type: 'behavior',
            keywords: ['nonexistent'],
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      // Should only register the first claim (file exists)
      expect(data.registered).toBe(2); // Total claims attempted
      expect(data.claim_ids).toHaveLength(1); // Only one actually registered
    });

    it('returns error on failure', async () => {
      vi.spyOn(fs, 'existsSync').mockImplementation(() => { throw new Error('Permission denied'); });

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

describe('QA: formatHealthResponse utility function', () => {
  it('correctly formats scan result into health response', () => {
    const mockScanResult: ScanResult = {
      files: [
        {
          file: 'README.md',
          claims: [
            { id: 'c1', claim_text: 'test1', claim_type: 'behavior', line_number: 1, source_file: 'README.md' },
            { id: 'c2', claim_text: 'test2', claim_type: 'behavior', line_number: 2, source_file: 'README.md' },
          ],
          results: [
            { claim_id: 'c1', verdict: 'verified', severity: null, reasoning: 'OK', suggested_fix: null, evidence_files: [], confidence: 0.9 },
            { claim_id: 'c2', verdict: 'drifted', severity: 'medium', reasoning: 'Outdated', suggested_fix: null, evidence_files: [], confidence: 0.8 },
          ],
          durationMs: 10,
        },
        {
          file: 'INSTALL.md',
          claims: [
            { id: 'c3', claim_text: 'test3', claim_type: 'behavior', line_number: 1, source_file: 'INSTALL.md' },
          ],
          results: [
            { claim_id: 'c3', verdict: 'drifted', severity: 'high', reasoning: 'Changed', suggested_fix: null, evidence_files: [], confidence: 0.95 },
          ],
          durationMs: 5,
        },
      ],
      totalClaims: 3,
      totalVerified: 1,
      totalDrifted: 2,
      totalUncertain: 0,
      durationMs: 15,
    };

    const response = formatHealthResponse(mockScanResult);
    const data = JSON.parse(response.content[0].text);

    expect(data.health_score).toBe(33); // 1 verified / 3 total = 33%
    expect(data.total_scored).toBe(3);
    expect(data.verified).toBe(1);
    expect(data.drifted).toBe(2);
    expect(data.doc_files_scanned).toBe(2);
    expect(data.duration_ms).toBe(15);
    expect(data.hotspots).toBeInstanceOf(Array);
    expect(data.hotspots.length).toBeLessThanOrEqual(10);
  });
});
