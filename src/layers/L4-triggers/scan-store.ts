import type { Pool } from 'pg';
import type { ScanRunRow, ScanStatus, TriggerType } from '../../shared/types';

/**
 * Create a new scan run record.
 * TDD-4 Section 4.1.
 */
export async function createScanRun(
  pool: Pool,
  opts: {
    repoId: string;
    triggerType: TriggerType;
    triggerRef: string | null;
    commitSha: string;
  },
): Promise<ScanRunRow> {
  const result = await pool.query(
    `INSERT INTO scan_runs (repo_id, trigger_type, trigger_ref, commit_sha, status,
       claims_checked, claims_drifted, claims_verified, claims_uncertain,
       total_token_cost, total_duration_ms, comment_posted)
     VALUES ($1, $2, $3, $4, 'queued', 0, 0, 0, 0, 0, 0, false)
     RETURNING *`,
    [opts.repoId, opts.triggerType, opts.triggerRef, opts.commitSha],
  );
  return result.rows[0] as ScanRunRow;
}

/**
 * Update scan run status.
 * TDD-4 Section 4.6.
 */
export async function updateScanStatus(
  pool: Pool,
  scanRunId: string,
  status: ScanStatus,
  stats?: {
    claims_checked?: number;
    claims_drifted?: number;
    claims_verified?: number;
    claims_uncertain?: number;
    total_token_cost?: number;
    total_duration_ms?: number;
    comment_posted?: boolean;
    check_run_id?: number;
  },
): Promise<void> {
  const setClauses = ['status = $2'];
  const values: unknown[] = [scanRunId, status];
  let idx = 3;

  if (status === 'running') {
    setClauses.push(`started_at = NOW()`);
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    setClauses.push(`completed_at = NOW()`);
  }

  if (stats) {
    if (stats.claims_checked !== undefined) {
      setClauses.push(`claims_checked = $${idx}`);
      values.push(stats.claims_checked);
      idx++;
    }
    if (stats.claims_drifted !== undefined) {
      setClauses.push(`claims_drifted = $${idx}`);
      values.push(stats.claims_drifted);
      idx++;
    }
    if (stats.claims_verified !== undefined) {
      setClauses.push(`claims_verified = $${idx}`);
      values.push(stats.claims_verified);
      idx++;
    }
    if (stats.claims_uncertain !== undefined) {
      setClauses.push(`claims_uncertain = $${idx}`);
      values.push(stats.claims_uncertain);
      idx++;
    }
    if (stats.total_token_cost !== undefined) {
      setClauses.push(`total_token_cost = $${idx}`);
      values.push(stats.total_token_cost);
      idx++;
    }
    if (stats.total_duration_ms !== undefined) {
      setClauses.push(`total_duration_ms = $${idx}`);
      values.push(stats.total_duration_ms);
      idx++;
    }
    if (stats.comment_posted !== undefined) {
      setClauses.push(`comment_posted = $${idx}`);
      values.push(stats.comment_posted);
      idx++;
    }
    if (stats.check_run_id !== undefined) {
      setClauses.push(`check_run_id = $${idx}`);
      values.push(stats.check_run_id);
      idx++;
    }
  }

  await pool.query(
    `UPDATE scan_runs SET ${setClauses.join(', ')} WHERE id = $1`,
    values,
  );
}

/**
 * Get a scan run by ID.
 */
export async function getScanRun(pool: Pool, scanRunId: string): Promise<ScanRunRow | null> {
  const result = await pool.query('SELECT * FROM scan_runs WHERE id = $1', [scanRunId]);
  return result.rows.length > 0 ? (result.rows[0] as ScanRunRow) : null;
}

/**
 * Get active (queued or running) scan runs for a repo.
 */
export async function getActiveScanRuns(pool: Pool, repoId: string): Promise<ScanRunRow[]> {
  const result = await pool.query(
    `SELECT * FROM scan_runs WHERE repo_id = $1 AND status IN ('queued', 'running')
     ORDER BY created_at DESC`,
    [repoId],
  );
  return result.rows as ScanRunRow[];
}
