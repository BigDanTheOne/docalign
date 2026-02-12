/**
 * DocAlign CLI entry point.
 *
 * Usage:
 *   docalign check <file>    Check a single doc file
 *   docalign scan             Full repository scan
 *   docalign fix [file]       Apply fixes from prior scan
 *
 * Implements: GATE42-012 (CLI is MVP), GATE42-015 (zero-config first run)
 */

import { runCheck } from './commands/check';
import { runScan } from './commands/scan';
import { runFix } from './commands/fix';
import type { CliPipeline } from './local-pipeline';

export interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, boolean>;
}

export function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const flags: Record<string, boolean> = {};

  // Skip node and script path
  const args = argv.slice(2);

  for (const arg of args) {
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = true;
    } else if (arg.startsWith('-')) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] ?? '',
    args: positional.slice(1),
    flags,
  };
}

export async function run(
  pipeline: CliPipeline,
  argv: string[] = process.argv,
  write: (msg: string) => void = console.log,
): Promise<number> {
  const { command, args, flags } = parseArgs(argv);

  switch (command) {
    case 'check':
      return runCheck(pipeline, args[0], { verbose: !!flags.verbose }, write);

    case 'scan':
      return runScan(pipeline, write);

    case 'fix':
      return runFix(pipeline, args[0], process.cwd(), write);

    case 'help':
    case '':
      write('Usage: docalign <command> [options]');
      write('');
      write('Commands:');
      write('  check <file>    Check a single documentation file');
      write('  scan            Scan entire repository');
      write('  fix [file]      Apply fixes from prior scan');
      write('');
      write('Options:');
      write('  --verbose       Show additional detail (check command)');
      write('  --help          Show this help message');
      return 0;

    default:
      write(`Unknown command: ${command}. Run \`docalign help\` for usage.`);
      return 2;
  }
}
