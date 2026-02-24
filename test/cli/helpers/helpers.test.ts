import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
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

  it('loadFixture is a function', () => {
    expect(typeof loadFixture).toBe('function');
  });

  it('runCli is a function', () => {
    expect(typeof runCli).toBe('function');
  });
});
