/**
 * QA acceptance tests for the `docalign mcp` command.
 * Tests tool registration and handler dispatch via mocked McpServer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CliPipeline } from '../../../../src/cli/local-pipeline';
import { registerLocalTools } from '../../../../src/layers/L6-mcp/tool-handlers';

function createMockPipeline(): CliPipeline {
  return {
    checkFile: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 100,
    }),
    scanRepo: vi.fn().mockResolvedValue([]),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn(),
  };
}

interface ToolRegistration {
  name: string;
  description: string;
  schema: unknown;
  handler: (...args: unknown[]) => Promise<unknown>;
}

function createMockMcpServer() {
  const tools: ToolRegistration[] = [];
  return {
    tool: vi.fn((name: string, description: string, schema: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
      tools.push({ name, description, schema, handler });
    }),
    registeredTools: tools,
  };
}

describe('MCP command — tool registration', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  let mockPipeline: CliPipeline;

  beforeEach(() => {
    mockServer = createMockMcpServer();
    mockPipeline = createMockPipeline();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerLocalTools(mockServer as any, mockPipeline, '/tmp/fake-repo');
  });

  it('registers all expected tools', () => {
    const toolNames = mockServer.registeredTools.map(t => t.name);
    expect(toolNames).toContain('check_doc');
    expect(toolNames).toContain('scan_docs');
    expect(toolNames).toContain('get_docs');
    expect(toolNames).toContain('register_claims');
    expect(toolNames.length).toBe(4);
  });

  it('each tool has a non-empty description', () => {
    for (const tool of mockServer.registeredTools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('check_doc handler returns expected response shape with empty results', async () => {
    const checkTool = mockServer.registeredTools.find(t => t.name === 'check_doc');
    expect(checkTool).toBeDefined();

    const result = await checkTool!.handler({ file: 'README.md' });
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    // Handler should have called pipeline.checkFile
    expect(mockPipeline.checkFile).toHaveBeenCalledWith('README.md', true);
  });

  it('scan_docs handler invokes pipeline.scanRepo', async () => {
    const scanTool = mockServer.registeredTools.find(t => t.name === 'scan_docs');
    expect(scanTool).toBeDefined();

    await scanTool!.handler({});
    expect(mockPipeline.scanRepo).toHaveBeenCalled();
  });
});
