/**
 * QA Acceptance Tests — T4: MCP Server Lifecycle Tests
 *
 * Tests the startServer() lifecycle in src/layers/L6-mcp/server.ts
 * All external dependencies are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock modules before imports
const mockPoolInstance = {
  on: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};
vi.mock('pg', () => ({
  Pool: vi.fn(() => mockPoolInstance),
}));

const mockServerInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(() => mockServerInstance),
}));

const mockTransportInstance = {};
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(() => mockTransportInstance),
}));

vi.mock('../../../src/layers/L6-mcp/repo-resolver', () => ({
  resolveRepo: vi.fn().mockResolvedValue({
    repo_id: 42,
    github_owner: 'test-org',
    github_repo: 'test-repo',
  }),
}));

vi.mock('../../../src/layers/L6-mcp/tools', () => ({
  registerTools: vi.fn(),
}));

import { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveRepo } from '../../../src/layers/L6-mcp/repo-resolver';
import { registerTools } from '../../../src/layers/L6-mcp/tools';
import { startServer } from '../../../src/layers/L6-mcp/server';

describe('T4: MCP server lifecycle — startServer()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  // AC-1: Startup test — startServer initializes McpServer, resolves repo, registers tools, connects transport
  it('AC-1: successful startup initializes all components in correct order', async () => {
    process.env.DOCALIGN_DATABASE_URL = 'postgres://test/db';

    await startServer({ repoPath: '/test/repo' });

    // Pool created with correct config
    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://test/db',
        max: 2,
        statement_timeout: 5000,
        connectionTimeoutMillis: 5000,
        application_name: 'docalign-mcp',
      }),
    );

    // Repo resolved
    expect(resolveRepo).toHaveBeenCalledWith('/test/repo', mockPoolInstance);

    // McpServer created with correct name/version
    expect(McpServer).toHaveBeenCalledWith({ name: 'docalign', version: '0.1.0' });

    // Tools registered
    expect(registerTools).toHaveBeenCalledWith(
      mockServerInstance,
      mockPoolInstance,
      expect.objectContaining({
        repoId: 42,
        cacheTtlSeconds: 60,
        maxSearchResults: 20,
        staleThresholdDays: 30,
      }),
      expect.anything(), // cache instance
    );

    // Transport created and connected
    expect(StdioServerTransport).toHaveBeenCalled();
    expect(mockServerInstance.connect).toHaveBeenCalledWith(mockTransportInstance);

    delete process.env.DOCALIGN_DATABASE_URL;
  });

  // AC-2: Missing --repo exits with error
  it('AC-2: exits with code 1 when repoPath is empty', async () => {
    await expect(startServer({ repoPath: '' })).rejects.toThrow('process.exit called');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--repo'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // AC-3: Database connection failure — logs error, ends pool, exits
  it('AC-3: handles resolveRepo failure gracefully', async () => {
    process.env.DOCALIGN_DATABASE_URL = 'postgres://test/db';
    vi.mocked(resolveRepo).mockRejectedValueOnce(new Error('connection refused'));

    await expect(startServer({ repoPath: '/test/repo' })).rejects.toThrow('process.exit called');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    expect(mockPoolInstance.end).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    delete process.env.DOCALIGN_DATABASE_URL;
  });

  // AC-4: Pool read-only mode — connect handler sets read-only
  it('AC-4: registers pool connect handler that sets read-only mode', async () => {
    process.env.DOCALIGN_DATABASE_URL = 'postgres://test/db';

    await startServer({ repoPath: '/test/repo' });

    // Verify pool.on('connect') was registered
    expect(mockPoolInstance.on).toHaveBeenCalledWith('connect', expect.any(Function));

    // Extract the callback and test it
    const connectCallback = mockPoolInstance.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'connect',
    )?.[1] as (client: { query: ReturnType<typeof vi.fn> }) => Promise<void>;
    expect(connectCallback).toBeDefined();

    const mockClient = { query: vi.fn().mockResolvedValue(undefined) };
    await connectCallback(mockClient);
    expect(mockClient.query).toHaveBeenCalledWith('SET default_transaction_read_only = ON');

    delete process.env.DOCALIGN_DATABASE_URL;
  });

  // AC-5: Server configuration defaults
  it('AC-5: uses expected HandlerConfig defaults', async () => {
    process.env.DOCALIGN_DATABASE_URL = 'postgres://test/db';

    await startServer({ repoPath: '/test/repo' });

    expect(registerTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        repoId: 42,
        cacheTtlSeconds: 60,
        maxSearchResults: 20,
        staleThresholdDays: 30,
      },
      expect.anything(),
    );

    delete process.env.DOCALIGN_DATABASE_URL;
  });
});
