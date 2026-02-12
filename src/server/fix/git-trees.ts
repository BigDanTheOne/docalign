/**
 * Git Trees API operations for creating commits via GitHub API.
 * GATE42-023.
 *
 * Uses the Git Data API (trees/blobs/commits/refs) for atomic commits.
 */

export interface GitHubClient {
  createBlob(owner: string, repo: string, content: string, encoding: 'utf-8' | 'base64'): Promise<{ sha: string }>;
  createTree(owner: string, repo: string, baseTree: string, tree: TreeEntry[]): Promise<{ sha: string }>;
  createCommit(owner: string, repo: string, message: string, treeSha: string, parents: string[], author: CommitAuthor): Promise<{ sha: string }>;
  updateRef(owner: string, repo: string, ref: string, sha: string, force: boolean): Promise<void>;
  getRef(owner: string, repo: string, ref: string): Promise<{ sha: string }>;
}

export interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
  date: string;
}

const DOCALIGN_AUTHOR: CommitAuthor = {
  name: 'docalign[bot]',
  email: 'docalign[bot]@users.noreply.github.com',
  date: new Date().toISOString(),
};

/**
 * Create a commit with modified files using the Git Trees API.
 *
 * Steps:
 * 1. Create blobs for each modified file
 * 2. Create a tree with the new blobs (using base_tree from current commit)
 * 3. Create a commit pointing to the new tree
 * 4. Update the branch ref (force: false to detect concurrent pushes)
 *
 * @returns Commit SHA on success, or null if fast-forward failed (422).
 */
export async function createFixCommit(
  client: GitHubClient,
  owner: string,
  repo: string,
  branch: string,
  modifiedFiles: Map<string, string>,
  commitMessage: string,
): Promise<{ sha: string } | { error: 'fast_forward_failed' }> {
  // Get current branch head
  const ref = await client.getRef(owner, repo, `heads/${branch}`);
  const baseCommitSha = ref.sha;

  // Create blobs for each file
  const treeEntries: TreeEntry[] = [];
  for (const [filePath, content] of modifiedFiles) {
    const blob = await client.createBlob(
      owner,
      repo,
      Buffer.from(content, 'utf-8').toString('base64'),
      'base64',
    );
    treeEntries.push({
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  // Create tree
  const tree = await client.createTree(owner, repo, baseCommitSha, treeEntries);

  // Create commit
  const commit = await client.createCommit(
    owner,
    repo,
    commitMessage,
    tree.sha,
    [baseCommitSha],
    { ...DOCALIGN_AUTHOR, date: new Date().toISOString() },
  );

  // Update ref (force: false)
  try {
    await client.updateRef(owner, repo, `heads/${branch}`, commit.sha, false);
  } catch (err: unknown) {
    // 422 = not a fast-forward update
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 422) {
      return { error: 'fast_forward_failed' };
    }
    throw err;
  }

  return { sha: commit.sha };
}
