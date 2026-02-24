/**
 * Shared CLI test helpers for DocAlign CLI tests.
 *
 * Provides:
 * - Temp directory creation/cleanup
 * - Fixture file loading
 * - CLI process invocation
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';

/**
 * Creates a temporary directory prefixed with "docalign-test-".
 * Caller is responsible for cleanup (use `fs.rmSync(dir, { recursive: true })`).
 */
export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-test-'));
}

/**
 * Loads a fixture file from `test/fixtures/` relative to the repo root.
 * Returns the file contents as a UTF-8 string.
 */
export function loadFixture(relativePath: string): string {
  const fixturesDir = path.resolve(__dirname, '../../fixtures');
  const fullPath = path.join(fixturesDir, relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Runs the DocAlign CLI as a child process and captures output.
 * @param args - CLI arguments (e.g., ['check', 'README.md'])
 * @param options - Optional cwd override
 */
export function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<CliResult> {
  const cliEntry = path.resolve(__dirname, '../../../src/cli/main.ts');
  const tsxPath = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

  return new Promise((resolve) => {
    execFile(
      tsxPath,
      [cliEntry, ...args],
      {
        cwd: options?.cwd ?? process.cwd(),
        timeout: 30_000,
        env: { ...process.env, NODE_ENV: 'test' },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error?.code !== undefined ? (typeof error.code === 'number' ? error.code : 1) : 0,
        });
      },
    );
  });
}
