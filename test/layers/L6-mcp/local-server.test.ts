import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

/**
 * Tests for local-server.ts
 *
 * The local server runs entirely in-memory against a local repo.
 * Key behaviors tested:
 * - parseArgs: CLI argument parsing
 * - main: Server initialization and startup
 * - Error handling for missing .git directory
 */

// Mock dependencies
const mockConnect = vi.fn().mockResolvedValue(undefined);
const MockMcpServer = vi.fn().mockImplementation(() => ({
  connect: mockConnect,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: MockMcpServer,
}));

const MockStdioServerTransport = vi.fn().mockImplementation(() => ({}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: MockStdioServerTransport,
}));

const mockScanRepo = vi.fn().mockResolvedValue(undefined);
const MockLocalPipeline = vi.fn().mockImplementation(() => ({
  scanRepo: mockScanRepo,
}));

vi.mock('../../../src/cli/real-pipeline', () => ({
  LocalPipeline: MockLocalPipeline,
}));

const mockRegisterLocalTools = vi.fn();

vi.mock('../../../src/layers/L6-mcp/tool-handlers', () => ({
  registerLocalTools: mockRegisterLocalTools,
}));

vi.mock('../../../src/lib/repo-root-resolver', () => ({
  resolveRepoRoot: vi.fn(({ cwd }: { cwd: string }) => ({
    root: cwd,
  })),
}));

describe('local-server', () => {
  let stderrWrite: typeof process.stderr.write;
  let processExit: typeof process.exit;
  let stderrOutput: string[];

  beforeEach(() => {
    stderrOutput = [];
    stderrWrite = process.stderr.write;
    processExit = process.exit;

    // Mock stderr to capture log output
    process.stderr.write = vi.fn((chunk: unknown) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    // Mock process.exit to prevent test termination
    process.exit = vi.fn() as typeof process.exit;
  });

  afterEach(() => {
    process.stderr.write = stderrWrite;
    process.exit = processExit;
    vi.clearAllMocks();
  });

  describe('parseArgs', () => {
    it('parses --repo argument', async () => {
      const { parseArgs } = await import('../../../src/layers/L6-mcp/local-server');
      const args = parseArgs(['--repo', '/test/repo']);
      expect(args.repoPath).toBe('/test/repo');
      expect(args.verbose).toBe(false);
    });

    it('parses --verbose flag', async () => {
      const { parseArgs } = await import('../../../src/layers/L6-mcp/local-server');
      const args = parseArgs(['--verbose']);
      expect(args.verbose).toBe(true);
    });

    it('defaults to empty repo path when no args provided', async () => {
      const { parseArgs } = await import('../../../src/layers/L6-mcp/local-server');
      const args = parseArgs([]);
      expect(args.repoPath).toBe('');
      expect(args.verbose).toBe(false);
    });
  });

  describe('main initialization', () => {
    it('initializes local server with valid repo path', async () => {
      // Mock fs.existsSync to simulate .git directory exists
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockReturnValue(true);

      // Mock process.argv to simulate --repo argument
      const originalArgv = process.argv;
      process.argv = ['node', 'local-server.js', '--repo', '/test/repo'];

      try {
        const { main } = await import('../../../src/layers/L6-mcp/local-server');

        // Test that main() function can initialize the local MCP server
        // with a valid repository path
        await main();

        // Verify McpServer was created
        expect(MockMcpServer).toHaveBeenCalledWith({
          name: 'docalign',
          version: '0.1.0',
        });

        // Verify LocalPipeline was created with the repo path
        expect(MockLocalPipeline).toHaveBeenCalledWith('/test/repo');
      } finally {
        process.argv = originalArgv;
        existsSyncSpy.mockRestore();
      }
    });

    it('starts MCP server and connects stdio transport', async () => {
      // Mock fs.existsSync to simulate .git directory exists
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockReturnValue(true);

      // Mock process.argv
      const originalArgv = process.argv;
      process.argv = ['node', 'local-server.js', '--repo', '/test/repo'];

      try {
        const { main } = await import('../../../src/layers/L6-mcp/local-server');

        // Verify that the local server creates an McpServer instance
        // and connects it to the stdio transport for MCP communication
        await main();

        // Verify connect was called on the server
        expect(mockConnect).toHaveBeenCalled();

        // Verify StdioServerTransport was created
        expect(MockStdioServerTransport).toHaveBeenCalled();

        // Verify registerLocalTools was called
        expect(mockRegisterLocalTools).toHaveBeenCalled();
      } finally {
        process.argv = originalArgv;
        existsSyncSpy.mockRestore();
      }
    });
  });

  describe('error handling', () => {
    it('exits with error when repo root is not a git repository (no .git directory)', async () => {
      // Mock fs.existsSync to return false for .git directory
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockImplementation((p) => {
        if (String(p).endsWith('.git')) {
          return false;
        }
        return true;
      });

      // Mock process.argv
      const originalArgv = process.argv;
      process.argv = ['node', 'local-server.js', '--repo', '/invalid/path'];

      try {
        const { main } = await import('../../../src/layers/L6-mcp/local-server');

        // The local server should detect missing .git and exit with error
        await main();

        // Verify process.exit was called with error code
        expect(process.exit).toHaveBeenCalledWith(1);

        // Verify error message was logged
        const errorOutput = stderrOutput.join('');
        expect(errorOutput).toMatch(/\.git|not a git|repo.*root|error/i);
      } finally {
        process.argv = originalArgv;
        existsSyncSpy.mockRestore();
      }
    });

    it('logs error message when .git directory is missing', async () => {
      // Mock fs.existsSync to return false for .git directory
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockImplementation((p) => {
        if (String(p).endsWith('.git')) {
          return false;
        }
        return true;
      });

      // Mock process.argv
      const originalArgv = process.argv;
      process.argv = ['node', 'local-server.js', '--repo', '/some/path'];

      try {
        const { main } = await import('../../../src/layers/L6-mcp/local-server');

        // Verify that appropriate error messages are logged to stderr
        // when the repository root check fails
        await main();

        // Check the captured stderr output
        const errorOutput = stderrOutput.join('');
        expect(errorOutput).toMatch(/\.git|not a git|repo.*root|error/i);
      } finally {
        process.argv = originalArgv;
        existsSyncSpy.mockRestore();
      }
    });
  });

  describe('repo root resolution', () => {
    it('resolves repo root from --repo argument', async () => {
      // Mock fs.existsSync to simulate .git directory exists
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockReturnValue(true);

      // Mock process.argv with --repo flag
      const originalArgv = process.argv;
      process.argv = ['node', 'local-server.js', '--repo', '/custom/repo'];

      try {
        const { main } = await import('../../../src/layers/L6-mcp/local-server');

        // Test that repo root is correctly resolved when --repo is provided
        await main();

        // Verify LocalPipeline was created with the custom repo path
        expect(MockLocalPipeline).toHaveBeenCalledWith('/custom/repo');
      } finally {
        process.argv = originalArgv;
        existsSyncSpy.mockRestore();
      }
    });

    it('defaults to current working directory when no --repo specified', async () => {
      // Mock fs.existsSync to simulate .git directory exists
      const existsSyncSpy = vi.spyOn(fs, 'existsSync');
      existsSyncSpy.mockReturnValue(true);

      // Mock process.argv without --repo flag
      const originalArgv = process.argv;
      const originalCwd = process.cwd();
      process.argv = ['node', 'local-server.js'];

      try {
        const { main } = await import('../../../src/layers/L6-mcp/local-server');

        // Test that cwd is used as fallback when --repo is not provided
        await main();

        // Verify LocalPipeline was created with current working directory
        // (resolveRepoRoot mock returns the cwd passed to it)
        expect(MockLocalPipeline).toHaveBeenCalledWith(originalCwd);
      } finally {
        process.argv = originalArgv;
        existsSyncSpy.mockRestore();
      }
    });
  });
});
