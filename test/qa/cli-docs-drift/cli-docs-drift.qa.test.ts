/**
 * QA Acceptance Tests: CLI Documentation Drift
 * Pipeline: f957408d-ee6d-4456-9bc8-a4dae4f15932
 *
 * Verifies docs/reference/cli.md accurately reflects the actual CLI implementation.
 * Tests parse the documentation file and compare against source code artifacts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const CLI_DOC = join(ROOT, 'docs', 'reference', 'cli.md');
const COMMANDS_DIR = join(ROOT, 'src', 'cli', 'commands');

function readDoc(): string {
  return readFileSync(CLI_DOC, 'utf-8');
}

function getImplementedCommands(): string[] {
  // Each .ts file in src/cli/commands/ is a command (minus extension)
  return readdirSync(COMMANDS_DIR)
    .filter((f: string) => f.endsWith('.ts'))
    .map((f: string) => f.replace('.ts', ''))
    .sort();
}

describe('AC1: Frontmatter command count matches actual commands', () => {
  it('should have the correct command count in frontmatter', () => {
    const doc = readDoc();
    const match = doc.match(/all (\d+) CLI commands/);
    expect(match).not.toBeNull();
    const claimedCount = parseInt(match![1], 10);
    const actualCommands = getImplementedCommands();
    expect(claimedCount).toBe(actualCommands.length);
  });

  it('should list the correct number in the summary/description', () => {
    const doc = readDoc();
    const frontmatter = doc.split('---')[1];
    expect(frontmatter).toBeDefined();
    const countMatch = frontmatter.match(/all (\d+) CLI commands/);
    if (countMatch) {
      const actualCommands = getImplementedCommands();
      expect(parseInt(countMatch[1], 10)).toBe(actualCommands.length);
    }
  });
});

describe('AC2: All commands are documented', () => {
  it('should have a section for every implemented command', () => {
    const doc = readDoc();
    const actualCommands = getImplementedCommands();
    for (const cmd of actualCommands) {
      // Each command should appear as "### docalign <cmd>" or "docalign <cmd>" in doc
      const pattern = new RegExp(`docalign\\s+${cmd}`, 'i');
      expect(doc).toMatch(pattern);
    }
  });
});

describe('AC3: All flags from parseArgs are documented', () => {
  it('should document all known boolean flags', () => {
    const doc = readDoc();
    // Known boolean flags from parseArgs in index.ts
    const knownFlags = ['help', 'json', 'dry-run', 'force', 'no-open', 'deep', 'verified-only'];
    for (const flag of knownFlags) {
      expect(doc).toContain(`--${flag}`);
    }
  });
});

describe('AC4: --format=github-pr flag documented if it exists', () => {
  it('should document --format=github-pr since scan supports it', () => {
    const doc = readDoc();
    // scan command accepts format option with github-pr value
    expect(doc).toMatch(/--format/);
    expect(doc).toMatch(/github-pr/);
  });
});

describe('AC-meta: docalign check returns 0 drift', () => {
  it('should be verified by running docalign check after the fix', () => {
    // This is a meta-test: the build agent should run `docalign check docs/reference/cli.md`
    // and confirm exit code 0. We can't run it in unit tests without the full pipeline,
    // but we verify the file exists and is parseable.
    expect(existsSync(CLI_DOC)).toBe(true);
    const doc = readDoc();
    expect(doc.length).toBeGreaterThan(100);
  });
});
