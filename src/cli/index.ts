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
  options: Record<string, string>;
}

export function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const flags: Record<string, boolean> = {};
  const options: Record<string, string> = {};

  // Skip node and script path
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value
        options[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        // --key value (peek ahead — if next arg isn't a flag, treat as value)
        const key = arg.slice(2);
        // Known boolean flags don't consume the next arg
        if (['verbose', 'help'].includes(key)) {
          flags[key] = true;
        } else {
          options[key] = args[++i];
        }
      } else {
        flags[arg.slice(2)] = true;
      }
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
    options,
  };
}

export async function run(
  pipeline: CliPipeline,
  argv: string[] = process.argv,
  write: (msg: string) => void = console.log,
): Promise<number> {
  const { command, args, flags, options } = parseArgs(argv);
  const exclude = options.exclude ? options.exclude.split(',').map((s) => s.trim()) : [];

  switch (command) {
    case 'check':
      return runCheck(pipeline, args[0], { verbose: !!flags.verbose }, write);

    case 'scan':
      return runScan(pipeline, write, undefined, exclude);

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
      write('  --verbose               Show additional detail (check command)');
      write('  --exclude=FILE[,FILE]   Exclude files from scan (comma-separated)');
      write('  --help                  Show this help message');
      return 0;

    default:
      write(`Unknown command: ${command}. Run \`docalign help\` for usage.`);
      return 2;
  }
}
