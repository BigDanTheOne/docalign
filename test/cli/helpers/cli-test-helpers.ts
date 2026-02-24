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
 *
 * @throws if the resolved path escapes the fixtures directory (path traversal protection)
 */
export function loadFixture(relativePath: string): string {
  const fixturesDir = path.resolve(__dirname, '../../fixtures');
  const fullPath = path.resolve(fixturesDir, relativePath);
  if (!fullPath.startsWith(fixturesDir + path.sep) && fullPath !== fixturesDir) {
    throw new Error(`Path traversal detected: "${relativePath}" resolves outside fixtures directory`);
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Runs the DocAlign CLI as a child process and captures output.
 * @param args - CLI arguments (e.g., ['check', 'README.md'])
 * @param options - Optional cwd override and timeout
 */
export function runCli(
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<CliResult> {
  const cliEntry = path.resolve(__dirname, '../../../src/cli/main.ts');
  const tsxPath = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
  const timeout = options?.timeout ?? 30_000;

  return new Promise((resolve) => {
    execFile(
      tsxPath,
      [cliEntry, ...args],
      {
        cwd: options?.cwd ?? process.cwd(),
        timeout,
        env: { ...process.env, NODE_ENV: 'test' },
      },
      (error, stdout, stderr) => {
        const timedOut = error !== null && 'killed' in error && error.killed === true;
        let exitCode: number | null = 0;
        if (error !== null) {
          // error.status holds the child process exit code (numeric)
          // error.code is the error code string (e.g. 'ETIMEDOUT')
          exitCode =
            typeof (error as NodeJS.ErrnoException & { status?: number }).status === 'number'
              ? (error as NodeJS.ErrnoException & { status?: number }).status!
              : 1;
        }
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode,
          timedOut,
        });
      },
    );
  });
}
