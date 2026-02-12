import type { Pool } from 'pg';

/**
 * Record co-change observations when code and doc files are modified together.
 * TDD-7 Section 4.6.
 *
 * MVP: Skeleton that records co-changes to the database.
 */
export async function recordCoChanges(
  pool: Pool,
  repoId: string,
  codeFiles: string[],
  docFiles: string[],
  commitSha: string,
): Promise<void> {
  if (codeFiles.length === 0 || docFiles.length === 0) {
    return; // no co-change to record
  }

  // Build batch insert values
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const codeFile of codeFiles) {
    for (const docFile of docFiles) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      values.push(repoId, codeFile, docFile, commitSha);
      idx += 4;
    }
  }

  if (placeholders.length === 0) return;

  try {
    await pool.query(
      `INSERT INTO co_changes (repo_id, code_file, doc_file, commit_sha)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (repo_id, code_file, doc_file, commit_sha) DO NOTHING`,
      values,
    );
  } catch {
    // Co-change recording is non-critical; log warning and continue
  }
}

/**
 * Get the co-change boost for a code-doc file pair.
 * TDD-7 Section 4.7.
 *
 * Formula: boost = min(count * 0.02, 0.1)
 * Where count = number of co-change commits within 180-day retention window.
 */
export async function getCoChangeBoost(
  pool: Pool,
  repoId: string,
  codeFile: string,
  docFile: string,
): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM co_changes
       WHERE repo_id = $1
       AND code_file = $2
       AND doc_file = $3
       AND committed_at > NOW() - INTERVAL '180 days'`,
      [repoId, codeFile, docFile],
    );

    const count = result.rows[0].cnt;
    return Math.min(count * 0.02, 0.1);
  } catch {
    return 0.0; // safe default: no boost
  }
}
