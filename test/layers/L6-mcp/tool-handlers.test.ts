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

  it('registers all 4 tools', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    expect(server.tool).toHaveBeenCalledTimes(4);
    expect(registeredTools).toContain('check_doc');
    expect(registeredTools).toContain('scan_docs');
    expect(registeredTools).toContain('get_docs');
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

  it('check_doc is the only check tool (no check_section or deep_check)', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    expect(registeredTools).not.toContain('check_section');
    expect(registeredTools).not.toContain('deep_check');
    expect(registeredTools).not.toContain('get_doc_health');
    expect(registeredTools).not.toContain('list_drift');
    expect(registeredTools).not.toContain('get_docs_for_file');
  });

  it('scan_docs replaces get_doc_health and list_drift', () => {
    registerLocalTools(server, mockPipeline, '/tmp/test-repo');

    expect(registeredTools).toContain('scan_docs');
    expect(registeredTools).not.toContain('get_doc_health');
    expect(registeredTools).not.toContain('list_drift');
  });

});
