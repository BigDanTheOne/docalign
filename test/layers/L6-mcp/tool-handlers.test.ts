import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../src/cli/local-pipeline';

describe('registerLocalTools', () => {
  let server: McpServer;
  const registeredTools: string[] = [];

  const mockPipeline: CliPipeline = {
    checkFile: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 10,
    }),
    checkSection: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 10,
      section: { heading: 'Test', level: 1, startLine: 1, endLine: 10 },
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
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    registeredTools.length = 0;
    server = {
      tool: vi.fn((name: string) => {
        registeredTools.push(name);
      }),
    } as unknown as McpServer;
  });

  it('registers all 8 tools', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    expect(server.tool).toHaveBeenCalledTimes(8);
    expect(registeredTools).toContain('check_doc');
    expect(registeredTools).toContain('check_section');
    expect(registeredTools).toContain('get_doc_health');
    expect(registeredTools).toContain('list_drift');
    expect(registeredTools).toContain('get_docs_for_file');
    expect(registeredTools).toContain('get_docs');
    expect(registeredTools).toContain('fix_doc');
    expect(registeredTools).toContain('report_drift');
  });

  it('get_docs has correct description', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'get_docs',
    );
    expect(call).toBeDefined();
    expect(call![1]).toContain('Search project documentation');
  });

  it('fix_doc has correct description', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'fix_doc',
    );
    expect(call).toBeDefined();
    expect(call![1]).toContain('fix suggestions');
  });

  it('report_drift has correct description', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'report_drift',
    );
    expect(call).toBeDefined();
    expect(call![1]).toContain('Report a documentation inaccuracy');
  });

  it('fix_doc handler returns empty fixes for no drift', async () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'fix_doc',
    );
    const handler = call![3] as (params: { file: string }) => Promise<{
      content: Array<{ type: string; text: string }>;
    }>;

    const result = await handler({ file: 'README.md' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_drifted).toBe(0);
    expect(parsed.fixes).toEqual([]);
  });

  it('report_drift handler stores report and returns ID', async () => {
    // Use a temp directory for repoRoot to avoid polluting the real repo
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-mcp-'));

    try {
      registerLocalTools(server, mockPipeline, tmpDir);

      const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'report_drift',
      );
      const handler = call![3] as (params: {
        doc_file: string;
        claim_text: string;
        actual_behavior: string;
        line_number?: number;
        evidence_files?: string[];
      }) => Promise<{
        content: Array<{ type: string; text: string }>;
      }>;

      const result = await handler({
        doc_file: 'README.md',
        claim_text: 'Run npm start',
        actual_behavior: 'npm run dev is the correct command',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.acknowledged).toBe(true);
      expect(parsed.report_id).toBeTruthy();

      // Verify file was created
      const reportsPath = path.join(tmpDir, '.docalign', 'reports.json');
      expect(fs.existsSync(reportsPath)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
