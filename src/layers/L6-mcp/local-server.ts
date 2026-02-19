#!/usr/bin/env node
/**
 * DocAlign Local MCP Server — runs entirely in-memory against a local repo.
 * No database required. Designed for use with Cursor, Claude Code, etc.
 *
 * Usage:
 *   node dist/layers/L6-mcp/local-server.js --repo /path/to/repo
 *
 * Or via the docalign CLI:
 *   docalign mcp --repo /path/to/repo
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import fs from 'fs';
import { LocalPipeline } from '../../cli/real-pipeline';
import { registerLocalTools } from './tool-handlers';
import { resolveRepoRoot } from '../../lib/repo-root-resolver';

function log(msg: string): void {
  process.stderr.write(`[docalign-mcp] ${msg}\n`);
}

function parseArgs(argv: string[]): { repoPath: string; verbose: boolean } {
  let repoPath = '';
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--repo':
        repoPath = argv[++i] ?? '';
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--version':
        process.stderr.write('docalign-mcp (local) v0.1.0\n');
        process.exit(0);
        break;
      case '--help':
        process.stderr.write(
          'Usage: docalign-mcp --repo <path> [--verbose]\n' +
          '\nLocal MCP server for documentation verification.\n' +
          'No database required — runs entirely in-memory.\n',
        );
        process.exit(0);
        break;
    }
  }

  return { repoPath, verbose };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Default to cwd if no --repo specified
  const repoPath = args.repoPath
    ? resolveRepoRoot({ cwd: path.resolve(args.repoPath) }).root
    : resolveRepoRoot({ cwd: process.cwd() }).root;

  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    log(`Error: ${repoPath} is not a git repository (no .git directory)`);
    process.exit(1);
  }

  log(`Starting local MCP server for: ${repoPath}`);

  const pipeline = new LocalPipeline(repoPath);

  // Pre-warm the index (non-fatal — server still starts if this fails)
  log('Building codebase index...');
  const warmupStart = Date.now();
  try {
    await pipeline.scanRepo();
    log(`Index built in ${((Date.now() - warmupStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    log(`Warmup scan skipped (${err instanceof Error ? err.message : String(err)}); index will build on first request.`);
  }

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

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
