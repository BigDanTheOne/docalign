/**
 * QA Acceptance Tests — Task 4: CLI --help Improvement
 * Pipeline: 1beb4997-0de1-4e80-95d9-e2fd493f7e03
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(__dirname, '../../../../dist/cli/main.js');

function runHelp(...args: string[]): string {
  try {
    return execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (e: any) {
    // --help may exit 0 or 1 depending on impl; capture stdout either way
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

const COMMANDS = [
  'check',
  'scan',
  'search',
  'extract',
  'init',
  'status',
  'configure',
  'viz',
  'mcp',
] as const;

// AC-1: Global --help prints enhanced descriptions for every command
describe('Global --help', () => {
  const output = runHelp('--help');

  it('lists all commands', () => {
    for (const cmd of COMMANDS) {
      expect(output.toLowerCase()).toContain(cmd);
    }
  });

  it('includes more than one-liner descriptions (enhanced)', () => {
    // At minimum the output should be substantial (>300 chars) indicating richer descriptions
    expect(output.length).toBeGreaterThan(300);
  });
});

// AC-2 & AC-3: Per-command --help with consistent structure
describe.each(COMMANDS)('%s --help', (cmd) => {
  const output = runHelp(cmd, '--help');

  it('produces output', () => {
    expect(output.trim().length).toBeGreaterThan(0);
  });

  it('contains Synopsis section', () => {
    expect(output.toLowerCase()).toMatch(/synopsis|usage/);
  });

  it('contains Description section', () => {
    expect(output.toLowerCase()).toContain('description');
  });

  it('contains Flags section', () => {
    expect(output.toLowerCase()).toMatch(/flags|options/);
  });

  it('contains Examples section', () => {
    expect(output.toLowerCase()).toContain('example');
  });
});

// AC-4: No new dependencies (checked via package.json diff — lightweight smoke)
describe('No new dependencies', () => {
  it('package.json does not reference help framework libs', () => {
    const pkg = require('../../../../package.json');
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    const helpLibs = ['commander', 'yargs', 'oclif', 'clipanion', 'meow'];
    for (const lib of helpLibs) {
      expect(allDeps).not.toHaveProperty(lib);
    }
  });
});
