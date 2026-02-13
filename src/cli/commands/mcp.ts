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
    ? path.resolve(args.repoPath)
    : process.cwd();

  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    log(`Error: ${repoPath} is not a git repository (no .git directory)`);
    process.exit(1);
  }

  log(`Starting local MCP server for: ${repoPath}`);

  const pipeline = new LocalPipeline(repoPath);

  log('Building codebase index...');
  const warmupStart = Date.now();
  await pipeline.scanRepo();
  log(`Index built in ${((Date.now() - warmupStart) / 1000).toFixed(1)}s`);

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
