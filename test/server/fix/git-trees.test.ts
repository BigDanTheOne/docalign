import { describe, it, expect, vi } from 'vitest';
import { createFixCommit, type GitHubClient } from '../../../src/server/fix/git-trees';

function mockGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    createBlob: vi.fn().mockResolvedValue({ sha: 'blob-sha-1' }),
    createTree: vi.fn().mockResolvedValue({ sha: 'tree-sha-1' }),
    createCommit: vi.fn().mockResolvedValue({ sha: 'commit-sha-1' }),
    updateRef: vi.fn().mockResolvedValue(undefined),
    getRef: vi.fn().mockResolvedValue({ sha: 'base-commit-sha' }),
    ...overrides,
  };
}

describe('createFixCommit', () => {
  it('creates a commit with modified files', async () => {
    const client = mockGitHubClient();
    const files = new Map([['README.md', 'updated content']]);

    const result = await createFixCommit(client, 'owner', 'repo', 'feature-branch', files, 'docs: fix drift');

    expect(result).toEqual({ sha: 'commit-sha-1' });
    expect(client.getRef).toHaveBeenCalledWith('owner', 'repo', 'heads/feature-branch');
    expect(client.createBlob).toHaveBeenCalledTimes(1);
    expect(client.createTree).toHaveBeenCalledWith(
      'owner', 'repo', 'base-commit-sha',
      [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'blob-sha-1' }],
    );
    expect(client.createCommit).toHaveBeenCalledWith(
      'owner', 'repo', 'docs: fix drift', 'tree-sha-1',
      ['base-commit-sha'],
      expect.objectContaining({ name: 'docalign[bot]' }),
    );
    expect(client.updateRef).toHaveBeenCalledWith('owner', 'repo', 'heads/feature-branch', 'commit-sha-1', false);
  });

  it('creates blobs for multiple files', async () => {
    const client = mockGitHubClient({
      createBlob: vi.fn()
        .mockResolvedValueOnce({ sha: 'blob-1' })
        .mockResolvedValueOnce({ sha: 'blob-2' }),
    });
    const files = new Map([
      ['README.md', 'content 1'],
      ['docs/api.md', 'content 2'],
    ]);

    const result = await createFixCommit(client, 'owner', 'repo', 'main', files, 'docs: fix');

    expect('sha' in result).toBe(true);
    expect(client.createBlob).toHaveBeenCalledTimes(2);
    expect(client.createTree).toHaveBeenCalledWith(
      'owner', 'repo', 'base-commit-sha',
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', sha: 'blob-1' }),
        expect.objectContaining({ path: 'docs/api.md', sha: 'blob-2' }),
      ]),
    );
  });

  it('returns error on fast-forward failure (422)', async () => {
    const client = mockGitHubClient({
      updateRef: vi.fn().mockRejectedValue(Object.assign(new Error('Not fast-forward'), { status: 422 })),
    });
    const files = new Map([['README.md', 'content']]);

    const result = await createFixCommit(client, 'owner', 'repo', 'main', files, 'docs: fix');

    expect(result).toEqual({ error: 'fast_forward_failed' });
  });

  it('rethrows non-422 errors', async () => {
    const client = mockGitHubClient({
      updateRef: vi.fn().mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 })),
    });
    const files = new Map([['README.md', 'content']]);

    await expect(createFixCommit(client, 'owner', 'repo', 'main', files, 'docs: fix'))
      .rejects.toThrow('Server error');
  });

  it('encodes file content as base64 for blob creation', async () => {
    const client = mockGitHubClient();
    const content = 'Hello, world!';
    const files = new Map([['test.md', content]]);

    await createFixCommit(client, 'owner', 'repo', 'main', files, 'docs: fix');

    expect(client.createBlob).toHaveBeenCalledWith(
      'owner', 'repo',
      Buffer.from(content, 'utf-8').toString('base64'),
      'base64',
    );
  });

  it('uses force: false when updating ref', async () => {
    const client = mockGitHubClient();
    const files = new Map([['README.md', 'content']]);

    await createFixCommit(client, 'owner', 'repo', 'main', files, 'fix');

    expect(client.updateRef).toHaveBeenCalledWith(
      'owner', 'repo', 'heads/main', 'commit-sha-1', false,
    );
  });
});
