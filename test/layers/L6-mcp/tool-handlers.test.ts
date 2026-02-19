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
      durationMs: 10,
    }),
    checkSection: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
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
    expect(registeredTools).toContain('deep_check');
    expect(registeredTools).toContain('register_claims');
  });

  it('get_docs has correct description', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'get_docs',
    );
    expect(call).toBeDefined();
    expect(call![1]).toContain('Search project documentation');
  });

});

