import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Pool } from 'pg';
import { SimpleCache } from '../../../src/layers/L6-mcp/cache';
import type { HandlerConfig } from '../../../src/layers/L6-mcp/handlers';
import { registerTools } from '../../../src/layers/L6-mcp/tools';

describe('registerTools', () => {
  let server: McpServer;
  let pool: Pool;
  let config: HandlerConfig;
  let cache: SimpleCache;
  const registeredTools: string[] = [];

  beforeEach(() => {
    registeredTools.length = 0;

    // Mock McpServer.tool to capture registrations
    server = {
      tool: vi.fn((name: string) => {
        registeredTools.push(name);
      }),
    } as unknown as McpServer;

    pool = {} as Pool;

    config = {
      repoId: 'repo-123',
      cacheTtlSeconds: 60,
      maxSearchResults: 20,
      staleThresholdDays: 30,
    };

    cache = new SimpleCache();
  });

  it('registers all 5 tools', () => {
    registerTools(server, pool, config, cache);

    expect(server.tool).toHaveBeenCalledTimes(5);
    expect(registeredTools).toContain('get_docs');
    expect(registeredTools).toContain('get_docs_for_file');
    expect(registeredTools).toContain('get_doc_health');
    expect(registeredTools).toContain('list_stale_docs');
    expect(registeredTools).toContain('report_drift');
  });

  it('registers get_docs with correct description', () => {
    registerTools(server, pool, config, cache);

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'get_docs',
    );
    expect(call).toBeDefined();
    expect(call![1]).toContain('Search documentation claims');
  });

  it('registers report_drift as v2 stub', () => {
    registerTools(server, pool, config, cache);

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'report_drift',
    );
    expect(call).toBeDefined();
    expect(call![1]).toContain('Not available');
  });

  it('report_drift handler returns error', async () => {
    registerTools(server, pool, config, cache);

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'report_drift',
    );
    // call[3] is the handler function (name, description, schema, handler)
    const handler = call![3] as (params: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    }>;

    const result = await handler({
      doc_file: 'test.md',
      claim_text: 'test claim',
      actual_behavior: 'actual',
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('not available');
  });
});
