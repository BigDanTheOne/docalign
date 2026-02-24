/**
 * QA Acceptance Tests: Shared CLI Test Helpers (Task 1)
 *
 * Validates that the shared CLI test helpers exist, export expected utilities,
 * and function correctly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The helpers module must exist and be importable
// Path is relative from test/qa/cli-test-helpers/ → test/cli/helpers/
const HELPERS_PATH = path.resolve(__dirname, '../../cli/helpers/cli-test-helpers.ts');

describe('QA: CLI Test Helpers — existence and exports', () => {
  it('cli-test-helpers.ts file exists', () => {
    expect(fs.existsSync(HELPERS_PATH), `Expected ${HELPERS_PATH} to exist`).toBe(true);
  });

  it('exports a temp directory helper', async () => {
    const mod = await import('../../cli/helpers/cli-test-helpers');
    // Should export some form of temp dir utility (function or object)
    const hasTempDir =
      typeof mod.createTempDir === 'function' ||
      typeof mod.makeTempDir === 'function' ||
      typeof mod.tmpDir === 'function' ||
      typeof mod.withTempDir === 'function' ||
      typeof mod.setupTempDir === 'function';
    expect(hasTempDir, 'Should export a temp directory helper function').toBe(true);
  });

  it('exports a fixture loading utility', async () => {
    const mod = await import('../../cli/helpers/cli-test-helpers');
    const hasFixture =
      typeof mod.loadFixture === 'function' ||
      typeof mod.readFixture === 'function' ||
      typeof mod.fixture === 'function' ||
      typeof mod.getFixture === 'function';
    expect(hasFixture, 'Should export a fixture loading function').toBe(true);
  });

  it('exports a CLI invocation helper', async () => {
    const mod = await import('../../cli/helpers/cli-test-helpers');
    const hasCli =
      typeof mod.runCli === 'function' ||
      typeof mod.invokeCli === 'function' ||
      typeof mod.execCli === 'function' ||
      typeof mod.cli === 'function' ||
      typeof mod.runCommand === 'function';
    expect(hasCli, 'Should export a CLI invocation helper function').toBe(true);
  });
});

describe('QA: CLI Test Helpers — temp dir functionality', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    // Clean up any temp dirs created during tests
    for (const d of tempDirs) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
    tempDirs = [];
  });

  it('temp dir helper creates a real directory that exists', async () => {
    const mod = await import('../../cli/helpers/cli-test-helpers');
    const createFn = mod.createTempDir || mod.makeTempDir || mod.tmpDir || mod.withTempDir || mod.setupTempDir;
    if (!createFn) return; // covered by export test above

    const result = await Promise.resolve(createFn());
    // Result could be a string path or an object with a path property
    const dirPath = typeof result === 'string' ? result : result?.path || result?.dir;
    if (typeof dirPath === 'string') {
      tempDirs.push(dirPath);
      expect(fs.existsSync(dirPath), 'Temp directory should exist after creation').toBe(true);
      expect(fs.statSync(dirPath).isDirectory(), 'Should be a directory').toBe(true);
    }
  });
});

describe('QA: Smoke test exists', () => {
  it('a smoke test file exists in test/cli/', () => {
    const testDir = path.resolve(__dirname, '../../cli');
    const files = fs.readdirSync(testDir, { recursive: true }) as string[];
    const smokeTest = files.some(
      (f) =>
        typeof f === 'string' &&
        (f.includes('smoke') || f.includes('helpers')) &&
        f.endsWith('.test.ts'),
    );
    expect(smokeTest, 'Should have a smoke or helpers test file in test/cli/').toBe(true);
  });
});
