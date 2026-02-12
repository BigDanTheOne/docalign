#!/usr/bin/env node
/**
 * DocAlign CLI binary entry point.
 * Creates a real LocalPipeline wired to L0-L3 layers
 * and dispatches to the CLI command router.
 */

import { run } from './index';
import { LocalPipeline } from './real-pipeline';

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const pipeline = new LocalPipeline(repoRoot);

  const exitCode = await run(pipeline);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
