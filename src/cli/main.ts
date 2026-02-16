#!/usr/bin/env node
/**
 * DocAlign CLI binary entry point.
 * Creates a real LocalPipeline wired to L0-L3 layers
 * and dispatches to the CLI command router.
 *
 * Special commands that bypass the pipeline:
 *   init  — Set up Claude Code integration (no scanning needed)
 *   mcp   — Start MCP server (has its own pipeline lifecycle)
 */

import { run, parseArgs } from './index';
import { LocalPipeline } from './real-pipeline';
import { runInit } from './commands/init';
import { startMcpServer } from './commands/mcp';
import { runExtract } from './commands/extract';
import { resolveRepoRoot } from '../lib/repo-root-resolver';

async function main(): Promise<void> {
  // Detect command before creating pipeline (some commands don't need one)
  const rawCommand = process.argv[2] ?? '';

  if (rawCommand === 'init') {
    const exitCode = await runInit();
    process.exit(exitCode);
  }

  if (rawCommand === 'mcp') {
    await startMcpServer(process.argv.slice(3));
    return; // MCP server runs until killed
  }

  const repoRoot = resolveRepoRoot({ cwd: process.cwd() }).root;
  const pipeline = new LocalPipeline(repoRoot);

  if (rawCommand === 'extract') {
    const { args, flags } = parseArgs(process.argv);
    const exitCode = await runExtract(pipeline, {
      dryRun: !!flags['dry-run'],
      force: !!flags.force,
      files: args.length > 0 ? args : undefined,
    });
    process.exit(exitCode);
  }

  const exitCode = await run(pipeline);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
