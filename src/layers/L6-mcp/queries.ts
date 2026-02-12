import type { Pool } from 'pg';

/**
 * SQL queries for MCP tools.
 * TDD-6 Appendix F.
 */

export interface ClaimSearchResult {
  claim_id: string;
  claim_text: string;
  claim_type: string;
  source_file: string;
  line_number: number;
  verification_status: string;
  last_verified_at: string | null;
  rank?: number;
}

export interface HealthAggRow {
  source_file: string;
  claim_type: string;
  verification_status: string;
  count: string; // PG returns bigint as string
}

export interface StaleDocRow {
  file: string;
  drifted_claims: string;
  uncertain_claims: string;
  last_verified: string | null;
}

export interface ClaimForFileRow {
  claim_id: string;
  doc_file: string;
  line_number: number;
  claim_text: string;
  claim_type: string;
  verification_status: string;
  last_verified_at: string | null;
  mapping_confidence: number;
}

/**
 * Full-text search with ts_rank ordering.
 * TDD-6 Appendix F.1.
 */
export async function searchClaimsFullText(
  pool: Pool,
  repoId: string,
  query: string,
  limit: number,
  verifiedOnly: boolean,
): Promise<ClaimSearchResult[]> {
  const verifiedFilter = verifiedOnly
    ? ` AND c.verification_status = 'verified'`
    : '';

  const result = await pool.query<ClaimSearchResult>(
    `SELECT
       c.id AS claim_id,
       c.claim_text,
       c.claim_type,
       c.source_file,
       c.line_number,
       c.verification_status,
       c.last_verified_at,
       ts_rank(to_tsvector('english', c.claim_text), plainto_tsquery('english', $2)) AS rank
     FROM claims c
     WHERE c.repo_id = $1
       AND to_tsvector('english', c.claim_text) @@ plainto_tsquery('english', $2)
       ${verifiedFilter}
     ORDER BY rank DESC
     LIMIT $3`,
    [repoId, query, limit],
  );
  return result.rows;
}

/**
 * ILIKE fallback search.
 * TDD-6 Appendix F.1.
 */
export async function searchClaimsIlike(
  pool: Pool,
  repoId: string,
  query: string,
  limit: number,
  verifiedOnly: boolean,
): Promise<ClaimSearchResult[]> {
  const verifiedFilter = verifiedOnly
    ? ` AND c.verification_status = 'verified'`
    : '';

  const result = await pool.query<ClaimSearchResult>(
    `SELECT
       c.id AS claim_id,
       c.claim_text,
       c.claim_type,
       c.source_file,
       c.line_number,
       c.verification_status,
       c.last_verified_at
     FROM claims c
     WHERE c.repo_id = $1
       AND (c.claim_text ILIKE '%' || $2 || '%' OR $2 = ANY(c.keywords))
       ${verifiedFilter}
     ORDER BY c.last_verified_at DESC NULLS LAST
     LIMIT $3`,
    [repoId, query, limit],
  );
  return result.rows;
}

/**
 * Health aggregation query.
 * TDD-6 Appendix F.2.
 */
export async function queryHealthAgg(
  pool: Pool,
  repoId: string,
  pathFilter: string | null,
): Promise<HealthAggRow[]> {
  const result = await pool.query<HealthAggRow>(
    `SELECT
       c.source_file,
       c.claim_type,
       c.verification_status,
       COUNT(*) AS count
     FROM claims c
     WHERE c.repo_id = $1
       AND ($2::text IS NULL OR c.source_file = $2 OR c.source_file LIKE $2 || '/%')
     GROUP BY c.source_file, c.claim_type, c.verification_status`,
    [repoId, pathFilter],
  );
  return result.rows;
}

/**
 * Stale docs query.
 * TDD-6 Appendix F.3.
 */
export async function queryStaleFiles(
  pool: Pool,
  repoId: string,
  staleThresholdDays: number,
  maxResults: number,
): Promise<StaleDocRow[]> {
  const result = await pool.query<StaleDocRow>(
    `SELECT
       c.source_file AS file,
       COUNT(*) FILTER (WHERE c.verification_status = 'drifted') AS drifted_claims,
       COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') AS uncertain_claims,
       MAX(c.last_verified_at) AS last_verified
     FROM claims c
     WHERE c.repo_id = $1
     GROUP BY c.source_file
     HAVING
       COUNT(*) FILTER (WHERE c.verification_status = 'drifted') > 0
       OR COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') > 0
       OR MAX(c.last_verified_at) < NOW() - INTERVAL '1 day' * $2
       OR MAX(c.last_verified_at) IS NULL
     ORDER BY
       COUNT(*) FILTER (WHERE c.verification_status = 'drifted') DESC,
       COUNT(*) FILTER (WHERE c.verification_status = 'uncertain') DESC,
       MAX(c.last_verified_at) ASC NULLS FIRST
     LIMIT $3`,
    [repoId, staleThresholdDays, maxResults],
  );
  return result.rows;
}

/**
 * Reverse lookup: find claims mapped to a specific code file.
 * TDD-6 Section 4.1 (get_docs_for_file).
 */
export async function queryClaimsForFile(
  pool: Pool,
  repoId: string,
  filePath: string,
  includeVerified: boolean,
): Promise<ClaimForFileRow[]> {
  const verifiedFilter = includeVerified
    ? ''
    : ` AND c.verification_status != 'verified'`;

  const result = await pool.query<ClaimForFileRow>(
    `SELECT
       c.id AS claim_id,
       c.source_file AS doc_file,
       c.line_number,
       c.claim_text,
       c.claim_type,
       c.verification_status,
       c.last_verified_at,
       cm.confidence AS mapping_confidence
     FROM claim_mappings cm
     JOIN claims c ON c.id = cm.claim_id
     WHERE cm.repo_id = $1
       AND cm.code_file = $2
       ${verifiedFilter}
     ORDER BY cm.confidence DESC, c.line_number ASC`,
    [repoId, filePath],
  );
  return result.rows;
}
