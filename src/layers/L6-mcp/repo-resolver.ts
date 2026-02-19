import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';

export interface ResolvedRepo {
  repo_id: string;
  github_owner: string;
  github_repo: string;
}

/**
 * Extract the remote "origin" URL from a git config file.
 */
export function extractRemoteUrl(gitConfig: string): string | null {
  const lines = gitConfig.split('\n');
  let inOrigin = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[remote "origin"]') {
      inOrigin = true;
      continue;
    }
    if (inOrigin && trimmed.startsWith('[')) {
      break; // Next section
    }
    if (inOrigin && trimmed.startsWith('url = ')) {
      return trimmed.slice('url = '.length).trim();
    }
  }

  return null;
}

/**
 * Parse owner/repo from a GitHub remote URL.
 * Supports: HTTPS, SSH, git@ formats.
 */
export function parseGitRemoteUrl(url: string): { owner: string; repo: string } | null {
  // git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // ssh://git@github.com/owner/repo.git
  const sshUrlMatch = url.match(/ssh:\/\/git@github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshUrlMatch) {
    return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };
  }

  return null;
}

/**
 * Resolve a local repo path to a DocAlign repo record.
 * TDD-6 Appendix B.4.
 *
 * When pool is omitted, only validates git repository status (local mode).
 * When pool is provided, also looks up repo in database (server mode).
 */
export async function resolveRepo(
  repoPath: string,
  pool?: Pool,
): Promise<ResolvedRepo> {
  // 1. Validate path exists
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Path does not exist: ${repoPath}`);
  }

  // 2. Find .git directory
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  // 3. Read git remote URL
  const gitConfigPath = path.join(gitDir, 'config');
  const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
  const remoteUrl = extractRemoteUrl(gitConfig);
  if (!remoteUrl) {
    throw new Error(`No remote "origin" found in ${gitConfigPath}`);
  }

  // 4. Parse owner/repo
  const parsed = parseGitRemoteUrl(remoteUrl);
  if (!parsed) {
    throw new Error(`Could not parse GitHub owner/repo from remote URL: ${remoteUrl}`);
  }

  // 5. If no pool provided (local mode), return parsed values without DB lookup
  if (!pool) {
    return {
      repo_id: `${parsed.owner}/${parsed.repo}`,
      github_owner: parsed.owner,
      github_repo: parsed.repo,
    };
  }

  // 6. Look up in repos table (server mode)
  const result = await pool.query(
    'SELECT id, github_owner, github_repo FROM repos WHERE github_owner = $1 AND github_repo = $2 ORDER BY updated_at DESC LIMIT 1',
    [parsed.owner, parsed.repo],
  );

  if (result.rows.length === 0) {
    throw new Error(
      `Repository ${parsed.owner}/${parsed.repo} not found in DocAlign database. ` +
      'Is the DocAlign GitHub App installed for this repo?',
    );
  }

  return {
    repo_id: result.rows[0].id,
    github_owner: result.rows[0].github_owner,
    github_repo: result.rows[0].github_repo,
  };
}
