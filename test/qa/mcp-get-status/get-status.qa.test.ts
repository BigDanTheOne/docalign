/**
 * QA Acceptance Tests — MCP get_status tool
 * Pipeline: c58a5446-6858-4d54-ad6b-dfbdaf1226b8
 *
 * Verifies:
 * 1. getStatusData() is extracted and returns a plain object
 * 2. MCP get_status tool is registered and calls getStatusData()
 * 3. Graceful degradation: drift is null when unavailable
 * 4. Output parity: MCP result matches CLI --json shape
 */
import { describe, it, expect, vi } from 'vitest';

// --- AC1: getStatusData() extraction ---

describe('getStatusData() extraction', () => {
  it('should export getStatusData from status module', async () => {
    const statusModule = await import('../../../src/cli/commands/status');
    expect(statusModule.getStatusData).toBeDefined();
    expect(typeof statusModule.getStatusData).toBe('function');
  });

  it('should return a plain object with expected keys', async () => {
    const { getStatusData } = await import('../../../src/cli/commands/status');
    const result = await getStatusData();
    expect(result).toBeTypeOf('object');
    // Must have these keys (values may vary by environment)
    expect(result).toHaveProperty('git');
    expect(result).toHaveProperty('config');
    expect(result).toHaveProperty('mcp_configured');
    expect(result).toHaveProperty('skill_installed');
    expect(result).toHaveProperty('llm_available');
    expect(result).toHaveProperty('doc_files');
    // drift can be present or null
    expect('drift' in result).toBe(true);
  });
});

// --- AC2: MCP tool registration ---

describe('MCP get_status tool registration', () => {
  it('should register a get_status tool with no required params', async () => {
    const { registerLocalTools } = await import('../../../src/layers/L6-mcp/tool-handlers');

    const registeredTools = new Map<string, { schema: unknown; handler: unknown }>();

    const mockServer = {
      tool: vi.fn((name: string, schema: unknown, handler: unknown) => {
        registeredTools.set(name, { schema, handler });
      }),
      resource: vi.fn(),
    } as unknown as Record<string, unknown>;

    // Provide minimal pipeline mock
    const mockPipeline = {} as Record<string, unknown>;
    registerLocalTools(mockServer as never, mockPipeline as never, '/tmp/fake-repo');

    expect(registeredTools.has('get_status')).toBe(true);
    const tool = registeredTools.get('get_status')!;
    // Schema should have no required fields (empty object or no required array)
    const schema = tool.schema as Record<string, unknown>;
    if (schema && typeof schema === 'object') {
      const required = (schema as Record<string, unknown>).required;
      expect(!required || (Array.isArray(required) && required.length === 0)).toBe(true);
    }
  });

  it('should return getStatusData() result as JSON content', async () => {
    const { registerLocalTools } = await import('../../../src/layers/L6-mcp/tool-handlers');

    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const mockServer = {
      tool: vi.fn((name: string, _schema: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(name, handler);
      }),
      resource: vi.fn(),
    } as unknown as Record<string, unknown>;

    registerLocalTools(mockServer as never, {} as never, '/tmp/fake-repo');

    const handler = handlers.get('get_status')!;
    const result = await handler({});
    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    // Should be valid JSON
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('git');
    expect(parsed).toHaveProperty('doc_files');
  });
});

// --- AC3: Graceful degradation ---

describe('graceful degradation', () => {
  it('should return drift as null when pipeline data is unavailable', async () => {
    const { getStatusData } = await import('../../../src/cli/commands/status');
    // In a test environment without a running pipeline, drift should be null
    const result = await getStatusData();
    // drift must be null, not undefined, and must not throw
    expect(result.drift).toBeNull();
  });
});

// --- AC4: Output parity ---

describe('output parity with CLI', () => {
  it('should have the same shape as docalign status --json', async () => {
    const { getStatusData } = await import('../../../src/cli/commands/status');
    const data = await getStatusData();

    // All expected top-level keys
    const expectedKeys = ['git', 'config', 'mcp_configured', 'skill_installed', 'llm_available', 'doc_files', 'drift'];
    for (const key of expectedKeys) {
      expect(data).toHaveProperty(key);
    }

    // Type checks
    expect(typeof data.git).toBe('object');
    expect(typeof data.mcp_configured).toBe('boolean');
    expect(typeof data.skill_installed).toBe('boolean');
    expect(typeof data.llm_available).toBe('boolean');
    expect(Array.isArray(data.doc_files) || typeof data.doc_files === 'number').toBe(true);
  });
});
