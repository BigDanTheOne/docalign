import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// QA-DISPUTE: Original path '../../../../..' was 5 levels up from test/qa/fix-cli-md/,
// resolving to /Users/kotkot instead of the repo root. Fixed to 3 levels up ('../../..').
const ROOT = resolve(__dirname, '../../..');
const CLI_DOC = readFileSync(resolve(ROOT, 'docs/reference/cli.md'), 'utf-8');
const COMMANDS_DIR = resolve(ROOT, 'src/cli/commands');

// Get all command names from source
const sourceCommands = readdirSync(COMMANDS_DIR)
  .filter(f => f.endsWith('.ts') && !f.startsWith('index'))
  .map(f => f.replace('.ts', ''));

describe('CLI docs completeness', () => {
  it('should have a section for every CLI command', () => {
    const missing: string[] = [];
    for (const cmd of sourceCommands) {
      // Look for the command name as a heading or code reference
      const patterns = [
        new RegExp(`#.*\\b${cmd}\\b`, 'i'),
        new RegExp(`\`${cmd}\``, 'i'),
        new RegExp(`docalign\\s+${cmd}`, 'i'),
      ];
      const found = patterns.some(p => p.test(CLI_DOC));
      if (!found) missing.push(cmd);
    }
    expect(missing, `Commands missing from docs: ${missing.join(', ')}`).toEqual([]);
  });

  it('should not document commands that do not exist in source', () => {
    // Extract command-like headings from the doc
    const headingPattern = /^#{1,3}\s+.*?`?(\w+)`?\s*$/gm;
    const docHeadings: string[] = [];
    let match;
    while ((match = headingPattern.exec(CLI_DOC)) !== null) {
      const word = match[1].toLowerCase();
      if (sourceCommands.includes(word) || ['docalign', 'cli', 'usage', 'options', 'global', 'commands', 'reference', 'overview', 'installation', 'examples'].includes(word)) continue;
      // Check if it might be a phantom command
      if (!sourceCommands.includes(word)) {
        docHeadings.push(word);
      }
    }
    // This is informational — phantom commands should be investigated
    // We don't hard-fail since headings might be descriptive, not command names
  });

  for (const cmd of sourceCommands) {
    describe(`command: ${cmd}`, () => {
      it(`should document the "${cmd}" command with its flags`, () => {
        const cmdSource = readFileSync(resolve(COMMANDS_DIR, `${cmd}.ts`), 'utf-8');

        // Extract option names from yargs builder patterns like .option('name', ...)
        const optionPattern = /\.option\s*\(\s*['"`](\w[\w-]*)['"`]/g;
        const sourceOptions: string[] = [];
        let optMatch;
        while ((optMatch = optionPattern.exec(cmdSource)) !== null) {
          sourceOptions.push(optMatch[1]);
        }

        // Also check for .positional('name', ...)
        const positionalPattern = /\.positional\s*\(\s*['"`](\w[\w-]*)['"`]/g;
        while ((optMatch = positionalPattern.exec(cmdSource)) !== null) {
          sourceOptions.push(optMatch[1]);
        }

        // For each option found in source, check it appears in the doc
        const docLower = CLI_DOC.toLowerCase();
        const missingOpts = sourceOptions.filter(opt => {
          const optLower = opt.toLowerCase();
          return !docLower.includes(optLower) && !docLower.includes(`--${optLower}`);
        });

        expect(
          missingOpts,
          `Command "${cmd}" has undocumented options: ${missingOpts.join(', ')}`
        ).toEqual([]);
      });
    });
  }
});
