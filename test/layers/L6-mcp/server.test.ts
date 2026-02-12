import { describe, it, expect, afterEach } from 'vitest';
import {
  parseCliArgs,
  resolveDatabaseUrl,
} from '../../../src/layers/L6-mcp/server';

describe('parseCliArgs', () => {
  it('parses --repo flag', () => {
    const args = parseCliArgs(['--repo', '/path/to/repo']);
    expect(args.repoPath).toBe('/path/to/repo');
  });

  it('parses --database-url flag', () => {
    const args = parseCliArgs(['--repo', '/path', '--database-url', 'postgres://localhost/db']);
    expect(args.databaseUrl).toBe('postgres://localhost/db');
  });

  it('parses --verbose flag', () => {
    const args = parseCliArgs(['--repo', '/path', '--verbose']);
    expect(args.verbose).toBe(true);
  });

  it('defaults to empty repoPath', () => {
    const args = parseCliArgs([]);
    expect(args.repoPath).toBe('');
  });

  it('handles combined flags', () => {
    const args = parseCliArgs([
      '--repo', '/my/repo',
      '--database-url', 'postgres://host/db',
      '--verbose',
    ]);
    expect(args.repoPath).toBe('/my/repo');
    expect(args.databaseUrl).toBe('postgres://host/db');
    expect(args.verbose).toBe(true);
  });
});

describe('resolveDatabaseUrl', () => {
  const originalEnv = process.env.DOCALIGN_DATABASE_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DOCALIGN_DATABASE_URL = originalEnv;
    } else {
      delete process.env.DOCALIGN_DATABASE_URL;
    }
  });

  it('uses CLI arg when provided', () => {
    expect(resolveDatabaseUrl('postgres://cli/db')).toBe('postgres://cli/db');
  });

  it('falls back to env var', () => {
    process.env.DOCALIGN_DATABASE_URL = 'postgres://env/db';
    expect(resolveDatabaseUrl()).toBe('postgres://env/db');
  });

  it('prefers CLI arg over env var', () => {
    process.env.DOCALIGN_DATABASE_URL = 'postgres://env/db';
    expect(resolveDatabaseUrl('postgres://cli/db')).toBe('postgres://cli/db');
  });

  it('throws when no database URL available', () => {
    delete process.env.DOCALIGN_DATABASE_URL;
    expect(() => resolveDatabaseUrl()).toThrow('No database URL configured');
  });
});
