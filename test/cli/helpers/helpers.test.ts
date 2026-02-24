import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTempDir, loadFixture, runCli } from './cli-test-helpers';

describe('CLI test helpers smoke tests', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('createTempDir returns a path to an existing directory', () => {
    const dir = createTempDir();
    tempDirs.push(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('createTempDir returns unique directories', () => {
    const dir1 = createTempDir();
    const dir2 = createTempDir();
    tempDirs.push(dir1, dir2);
    expect(dir1).not.toBe(dir2);
  });

  it('createTempDir path starts with docalign-test- prefix', () => {
    const dir = createTempDir();
    tempDirs.push(dir);
    expect(path.basename(dir)).toMatch(/^docalign-test-/);
  });
});

describe('loadFixture', () => {
  it('loads an existing fixture file and returns its content', () => {
    // The synthetic-node corpus has a README.md fixture we can load
    const content = loadFixture('corpora/synthetic-node/tagged/README.md');
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });

  it('throws on non-existent fixture file', () => {
    expect(() => loadFixture('does-not-exist.txt')).toThrow();
  });

  it('throws on path traversal with ../', () => {
    expect(() => loadFixture('../../../package.json')).toThrow(/path traversal/i);
  });

  it('throws on path traversal with absolute path component', () => {
    expect(() => loadFixture('/etc/passwd')).toThrow(/path traversal/i);
  });
});

describe('runCli', () => {
  it('runs the CLI help command and captures stdout', async () => {
    const result = await runCli(['help']);
    expect(result.stdout).toContain('Usage: docalign');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  }, 15_000);

  it('returns non-zero exit code for unknown commands', async () => {
    const result = await runCli(['nonexistent-command']);
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
  }, 15_000);

  it('respects cwd option without crashing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-test-'));
    try {
      // Running from a temp dir (no repo root) should still return a result
      // without hanging — we just verify it completes and returns a CliResult
      const result = await runCli(['help'], { cwd: dir });
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('timedOut');
      expect(result.timedOut).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('includes timedOut field in result', async () => {
    const result = await runCli(['help']);
    expect(result).toHaveProperty('timedOut');
    expect(typeof result.timedOut).toBe('boolean');
  }, 15_000);
});
