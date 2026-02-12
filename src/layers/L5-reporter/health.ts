import type { Pool } from 'pg';
import type { ClaimType, HealthScore, FileHealth } from '../../shared/types';

/**
 * Calculate documentation health score for a repository.
 * TDD-5 Section 4.3, Appendix D.
 *
 * Formula: score = verified / (verified + drifted)
 * If denominator = 0, score = 0.
 *
 * Also computes per-file breakdown, per-type breakdown, and hotspots (top 10).
 */
export async function calculateHealthScore(pool: Pool, repoId: string): Promise<HealthScore> {
  const result = await pool.query(
    `SELECT verification_status, source_file, claim_type, COUNT(*)::int AS cnt
     FROM claims
     WHERE repo_id = $1
     GROUP BY verification_status, source_file, claim_type`,
    [repoId],
  );

  let verified = 0;
  let drifted = 0;
  let uncertain = 0;
  let pending = 0;

  const fileMap = new Map<string, FileHealth>();
  const typeMap = new Map<string, { verified: number; drifted: number; uncertain: number; pending: number }>();

  for (const row of result.rows) {
    const status = row.verification_status as string;
    const file = row.source_file as string;
    const claimType = row.claim_type as ClaimType;
    const count = row.cnt as number;

    // Aggregate totals
    if (status === 'verified') verified += count;
    else if (status === 'drifted') drifted += count;
    else if (status === 'uncertain') uncertain += count;
    else pending += count;

    // Per-file
    if (!fileMap.has(file)) {
      fileMap.set(file, { file, total: 0, verified: 0, drifted: 0, uncertain: 0 });
    }
    const fh = fileMap.get(file)!;
    fh.total += count;
    if (status === 'verified') fh.verified += count;
    else if (status === 'drifted') fh.drifted += count;
    else if (status === 'uncertain') fh.uncertain += count;

    // Per-type
    if (!typeMap.has(claimType)) {
      typeMap.set(claimType, { verified: 0, drifted: 0, uncertain: 0, pending: 0 });
    }
    const th = typeMap.get(claimType)!;
    if (status === 'verified') th.verified += count;
    else if (status === 'drifted') th.drifted += count;
    else if (status === 'uncertain') th.uncertain += count;
    else th.pending += count;
  }

  const total_claims = verified + drifted + uncertain + pending;
  const denominator = verified + drifted;
  const score = denominator > 0 ? verified / denominator : 0;

  // Hotspots: top 10 files by drifted count
  const hotspots = Array.from(fileMap.values())
    .filter((f) => f.drifted > 0)
    .sort((a, b) => b.drifted - a.drifted)
    .slice(0, 10);

  return {
    score,
    total_claims,
    verified,
    drifted,
    uncertain,
    pending,
    by_file: Array.from(fileMap.values()),
    by_type: Object.fromEntries(typeMap),
    hotspots,
  };
}

/**
 * Update the cached health score in the repos table.
 * GATE42-032.
 */
export async function updateCachedHealthScore(pool: Pool, repoId: string): Promise<HealthScore> {
  const health = await calculateHealthScore(pool, repoId);
  await pool.query(
    `UPDATE repos SET health_score = $1, verified_claims = $2, total_claims = $3, updated_at = NOW()
     WHERE id = $4`,
    [health.score, health.verified, health.total_claims, repoId],
  );
  return health;
}
