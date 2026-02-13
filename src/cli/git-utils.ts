/**
 * Git diff helpers for code-change detection.
 * Uses execSync with timeout, returns string[] or null, never throws.
 */

import { execSync } from 'child_process';

const GIT_TIMEOUT_MS = 10_000;

/** Get files changed between a commit and HEAD. */
export function getChangedFilesSince(repoRoot: string, commitSha: string): string[] | null {
  try {
    const output = execSync(`git diff --name-only ${commitSha} HEAD`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/** Get current HEAD commit SHA. */
export function getCurrentCommitSha(repoRoot: string): string | null {
  try {
    const output = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
    });
    return output.trim();
  } catch {
    return null;
  }
}

/** Get files with uncommitted changes (working tree + staged). */
export function getWorkingTreeChanges(repoRoot: string): string[] | null {
  try {
    const output = execSync('git diff --name-only HEAD', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
}
