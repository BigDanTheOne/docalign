/**
 * QA acceptance tests: repo-resolver error paths.
 */
import { describe, it, expect } from 'vitest';
import { resolveRepo } from '../../../../src/layers/L6-mcp/repo-resolver';

describe('repo-resolver error paths', () => {
  it('throws for non-git directory', async () => {
    await expect(resolveRepo('/tmp')).rejects.toThrow('Not a git repository');
  });

  it('throws for nonexistent path', async () => {
    await expect(resolveRepo('/nonexistent/path/xyz')).rejects.toThrow();
  });
});
