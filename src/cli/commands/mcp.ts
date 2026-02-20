/**
 * `docalign mcp` — Start the MCP server for Claude Code / Cursor.
 *
 * Delegates to shared tool handlers in L6-mcp/tool-handlers.ts.
 * This wrapper allows `npx docalign mcp --repo .` to work as a single entry point.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import fs from 'fs';
import { LocalPipeline } from '../real-pipeline';
import { registerLocalTools } from '../../layers/L6-mcp/tool-handlers';
import { resolveRepoRoot } from '../../lib/repo-root-resolver';

function log(msg: string): void {
  process.stderr.write(`[docalign-mcp] ${msg}\n`);
}

function parseMcpArgs(argv: string[]): { repoPath: string } {
  let repoPath = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') {
      repoPath = argv[++i] ?? '';
    }
  }
  return { repoPath };
}

export async function startMcpServer(argv: string[]): Promise<void> {
  const args = parseMcpArgs(argv);

  const repoPath = args.repoPath
    ? resolveRepoRoot({ cwd: path.resolve(args.repoPath) }).root
    : resolveRepoRoot({ cwd: process.cwd() }).root;

  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    log(`Error: ${repoPath} is not a git repository (no .git directory)`);
    process.exit(1);
  }

  log(`Starting local MCP server for: ${repoPath}`);

  const pipeline = new LocalPipeline(repoPath);

  // Index is built lazily on first tool call, not on startup
  // This ensures fast MCP server startup and prevents Claude Code timeout
  // The first tool invocation will trigger index building if needed

  const server = new McpServer({
    name: 'docalign',
    version: '0.1.0',
  });

  registerLocalTools(server, pipeline, repoPath);

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio. Ready for requests.');
}
