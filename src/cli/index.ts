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
import { runSearch } from './commands/search';
import { runInit } from './commands/init';
import { runStatus } from './commands/status';
import { runConfigure } from './commands/configure';
import { runViz } from './commands/viz';
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
        if (['help', 'json', 'dry-run', 'force', 'no-open', 'deep', 'verified-only'].includes(key)) {
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
    case 'init':
      return runInit(write);

    case 'check':
      return runCheck(pipeline, args[0], {
        section: options.section,
        deep: !!flags.deep,
        json: !!flags.json,
      }, write);

    case 'scan':
      return runScan(pipeline, write, undefined, exclude, !!flags.json,
        options.max ? parseInt(options.max, 10) : undefined, options.format);

    case 'search':
      return runSearch(pipeline, args[0], {
        codeFile: options['code-file'],
        verifiedOnly: !!flags['verified-only'],
        json: !!flags.json,
        max: options.max ? parseInt(options.max, 10) : undefined,
      }, write);

    case 'status':
      return runStatus(write);

    case 'viz': {
      const vizExclude = options.exclude ? options.exclude.split(',').map((s) => s.trim()) : [];
      return runViz(pipeline, {
        output: options.output,
        noOpen: !!flags['no-open'],
        exclude: vizExclude,
      }, write);
    }

    case 'configure': {
      const excludePatterns = options.exclude ? options.exclude.split(',').map((s) => s.trim()) : undefined;
      return runConfigure({
        exclude: excludePatterns,
        minSeverity: options['min-severity'],
        reset: !!flags.reset,
      }, write);
    }

    case 'help':
    case '':
      write('Usage: docalign <command> [options]');
      write('');
      write('Commands:');
      write('  init            Set up DocAlign for Claude Code (MCP + skill)');
      write('  check <file>    Check a single documentation file');
      write('  scan            Scan entire repository');
      write('  search <query>  Search documentation by topic');
      write('  extract [file]  Extract semantic claims using Claude CLI');
      write('  status          Show configuration and integration status');
      write('  configure       Create or update .docalign.yml');
      write('  viz             Generate interactive knowledge graph');
      write('  mcp             Start MCP server (used by Claude Code)');
      write('');
      write('Options:');
      write('  --section=HEADING       Check a specific section (check command)');
      write('  --deep                  Include unchecked sections in output (check command)');
      write('  --json                  Output results as JSON');
      write('  --code-file=PATH        Reverse lookup: find docs referencing a code file (search command)');
      write('  --verified-only         Only return verified sections (search command)');
      write('  --exclude=FILE[,FILE]   Exclude files from scan (comma-separated)');
      write('  --format=github-pr      Output scan results as GitHub PR comment markdown');
      write('  --dry-run               Show what would be extracted (extract command)');
      write('  --force                 Re-extract all sections (extract command)');
      write('  --min-severity=LEVEL    Set minimum severity (configure command)');
      write('  --reset                 Reset config to defaults (configure command)');
      write('  --output=PATH           Output path for viz HTML (default: .docalign/viz.html)');
      write('  --no-open               Do not auto-open viz in browser');
      write('  --help                  Show this help message');
      write('');
      write('Environment:');
      write('  ANTHROPIC_API_KEY       Enable LLM verification (Tier 3)');
      return 0;

    default:
      write(`Unknown command: ${command}. Run \`docalign help\` for usage.`);
      return 2;
  }
}
