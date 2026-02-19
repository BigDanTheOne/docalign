import type { Pool } from 'pg';
import crypto from 'crypto';
import { SimpleCache } from './cache';
import {
  searchClaimsFullText,
  searchClaimsIlike,
  queryHealthAgg,
  queryStaleFiles,
  queryClaimsForFile,
} from './queries';
import type { ClaimSearchResult } from './queries';

/**
 * MCP tool handler configuration.
 */
export interface HandlerConfig {
  repoId: string;
  cacheTtlSeconds: number;
  maxSearchResults: number;
  staleThresholdDays: number;
}

// === get_docs ===

export interface GetDocsParams {
  query: string;
  verified_only?: boolean;
}

interface DocSection {
  file: string;
  section: string;
  content: string;
  verification_status: string;
  last_verified: string | null;
  claims_in_section: number;
  verified_claims: number;
  health_score: number;
}

export interface GetDocsResponse {
  sections: DocSection[];
}

/**
 * Handle get_docs: full-text search with ILIKE fallback.
 * TDD-6 Section 4.1.
 */
export async function handleGetDocs(
  params: GetDocsParams,
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): Promise<GetDocsResponse> {
  const cacheKey = `get_docs:${crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex')}`;
  const cached = cache.get<GetDocsResponse>(cacheKey);
  if (cached) return cached;

  const limit = config.maxSearchResults;
  const verifiedOnly = params.verified_only ?? false;

  // Try full-text search first
  let results: ClaimSearchResult[] = await searchClaimsFullText(
    pool, config.repoId, params.query, limit, verifiedOnly,
  );

  // Fallback to ILIKE if zero results
  if (results.length === 0) {
    results = await searchClaimsIlike(
      pool, config.repoId, params.query, limit, verifiedOnly,
    );
  }

  // Group by file (v2: section = filename)
  const byFile = new Map<string, ClaimSearchResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.source_file) ?? [];
    existing.push(r);
    byFile.set(r.source_file, existing);
  }

  const sections: DocSection[] = [];
  for (const [file, claims] of byFile) {
    const verifiedCount = claims.filter((c) => c.verification_status === 'verified').length;
    const worstStatus = getWorstStatus(claims.map((c) => c.verification_status));
    const lastVerified = claims
      .map((c) => c.last_verified_at)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    sections.push({
      file,
      section: file, // v2: section = filename
      content: claims.map((c) => c.claim_text).join('\n'),
      verification_status: worstStatus,
      last_verified: lastVerified,
      claims_in_section: claims.length,
      verified_claims: verifiedCount,
      health_score: claims.length > 0 ? verifiedCount / claims.length : 0,
    });
  }

  const response: GetDocsResponse = { sections };
  cache.set(cacheKey, response, config.cacheTtlSeconds);
  return response;
}

// === get_docs_for_file ===

export interface GetDocsForFileParams {
  file_path: string;
  include_verified?: boolean;
}

export interface GetDocsForFileResponse {
  claims: Array<{
    doc_file: string;
    line_number: number;
    claim_text: string;
    claim_type: string;
    verification_status: string;
    last_verified: string | null;
    mapping_confidence: number;
  }>;
}

/**
 * Handle get_docs_for_file: reverse lookup by code file path.
 * TDD-6 Section 4.1.
 */
export async function handleGetDocsForFile(
  params: GetDocsForFileParams,
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): Promise<GetDocsForFileResponse> {
  // Sanitize path traversal
  if (params.file_path.includes('..')) {
    throw new Error('Path must not contain ".."');
  }

  const cacheKey = `get_docs_for_file:${crypto.createHash('sha256').update(params.file_path).digest('hex')}`;
  const cached = cache.get<GetDocsForFileResponse>(cacheKey);
  if (cached) return cached;

  const rows = await queryClaimsForFile(
    pool, config.repoId, params.file_path, params.include_verified ?? true,
  );

  const response: GetDocsForFileResponse = {
    claims: rows.map((r) => ({
      doc_file: r.doc_file,
      line_number: r.line_number,
      claim_text: r.claim_text,
      claim_type: r.claim_type,
      verification_status: r.verification_status,
      last_verified: r.last_verified_at,
      mapping_confidence: r.mapping_confidence,
    })),
  };

  cache.set(cacheKey, response, config.cacheTtlSeconds);
  return response;
}

// === get_doc_health ===

export interface GetDocHealthParams {
  path?: string;
}

export interface GetDocHealthResponse {
  health: {
    total_claims: number;
    verified: number;
    drifted: number;
    uncertain: number;
    pending: number;
    score: number | null;
    by_file: Record<string, { total: number; verified: number; drifted: number; uncertain: number }>;
    by_type: Record<string, number>;
    hotspots: string[];
  };
}

/**
 * Handle get_doc_health: aggregate claim verification statuses.
 * TDD-6 Section 4.2.
 */
// Overload: no params (for testing/simple usage) - must be first for TypeScript to match correctly
export async function handleGetDocHealth(
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): Promise<GetDocHealthResponse>;
// Overload: params provided
export async function handleGetDocHealth(
  params: GetDocHealthParams,
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): Promise<GetDocHealthResponse>;
// Implementation
export async function handleGetDocHealth(
  paramsOrPool: GetDocHealthParams | Pool,
  poolOrConfig: Pool | HandlerConfig,
  configOrCache: HandlerConfig | SimpleCache,
  cache?: SimpleCache,
): Promise<GetDocHealthResponse> {
  // Determine which overload was called by checking if first arg is a Pool
  // Pool has a 'query' method that's a function
  let params: GetDocHealthParams;
  let pool: Pool;
  let config: HandlerConfig;
  let cacheObj: SimpleCache;

  if (typeof (paramsOrPool as Pool).query === 'function') {
    // First overload: (pool, config, cache)
    params = {};
    pool = paramsOrPool as Pool;
    config = poolOrConfig as HandlerConfig;
    cacheObj = configOrCache as SimpleCache;
  } else {
    // Second overload: (params, pool, config, cache)
    params = paramsOrPool as GetDocHealthParams;
    pool = poolOrConfig as Pool;
    config = configOrCache as HandlerConfig;
    cacheObj = cache!;
  }

  const pathFilter = params.path ?? null;

  // Sanitize path traversal
  if (pathFilter && pathFilter.includes('..')) {
    throw new Error('Path must not contain ".."');
  }

  const cacheKey = `health:${pathFilter ?? 'repo'}`;
  const cached = cacheObj.get<GetDocHealthResponse>(cacheKey);
  if (cached) return cached;

  const rows = await queryHealthAgg(pool, config.repoId, pathFilter);

  let verified = 0;
  let drifted = 0;
  let uncertain = 0;
  let pending = 0;
  const byFile: Record<string, { total: number; verified: number; drifted: number; uncertain: number }> = {};
  const byType: Record<string, number> = {};
  const driftedByFile: Record<string, number> = {};

  for (const row of rows) {
    const count = parseInt(row.count, 10);
    const file = row.source_file;

    if (!byFile[file]) {
      byFile[file] = { total: 0, verified: 0, drifted: 0, uncertain: 0 };
    }
    byFile[file].total += count;

    byType[row.claim_type] = (byType[row.claim_type] ?? 0) + count;

    switch (row.verification_status) {
      case 'verified':
        verified += count;
        byFile[file].verified += count;
        break;
      case 'drifted':
        drifted += count;
        byFile[file].drifted += count;
        driftedByFile[file] = (driftedByFile[file] ?? 0) + count;
        break;
      case 'uncertain':
        uncertain += count;
        byFile[file].uncertain += count;
        break;
      default:
        pending += count;
        break;
    }
  }

  const total = verified + drifted + uncertain + pending;
  const denominator = verified + drifted;
  const score = denominator > 0 ? verified / denominator : null;

  // Hotspots: top 5 files by drifted count
  const hotspots = Object.entries(driftedByFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file]) => file);

  const response: GetDocHealthResponse = {
    health: {
      total_claims: total,
      verified,
      drifted,
      uncertain,
      pending,
      score,
      by_file: byFile,
      by_type: byType,
      hotspots,
    },
  };

  cacheObj.set(cacheKey, response, config.cacheTtlSeconds);
  return response;
}

// === list_stale_docs ===

export interface ListStaleDocsParams {
  max_results?: number;
}

export interface ListStaleDocsResponse {
  stale_docs: Array<{
    file: string;
    drifted_claims: number;
    uncertain_claims: number;
    last_verified: string | null;
  }>;
}

/**
 * Handle list_stale_docs: find files with stale or drifted claims.
 * TDD-6 Section 4.4.
 */
// Overload: no params (for testing/simple usage) - must be first for TypeScript to match correctly
export async function handleListStaleDocs(
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): Promise<ListStaleDocsResponse>;
// Overload: params provided
export async function handleListStaleDocs(
  params: ListStaleDocsParams,
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): Promise<ListStaleDocsResponse>;
// Implementation
export async function handleListStaleDocs(
  paramsOrPool: ListStaleDocsParams | Pool,
  poolOrConfig: Pool | HandlerConfig,
  configOrCache: HandlerConfig | SimpleCache,
  cache?: SimpleCache,
): Promise<ListStaleDocsResponse> {
  // Determine which overload was called by checking if first arg is a Pool
  // Pool has a 'query' method that's a function
  let params: ListStaleDocsParams;
  let pool: Pool;
  let config: HandlerConfig;
  let cacheObj: SimpleCache;

  if (typeof (paramsOrPool as Pool).query === 'function') {
    // Second overload: (pool, config, cache)
    params = {};
    pool = paramsOrPool as Pool;
    config = poolOrConfig as HandlerConfig;
    cacheObj = configOrCache as SimpleCache;
  } else {
    // First overload: (params, pool, config, cache)
    params = paramsOrPool as ListStaleDocsParams;
    pool = poolOrConfig as Pool;
    config = configOrCache as HandlerConfig;
    cacheObj = cache!;
  }

  const maxResults = Math.min(Math.max(params.max_results ?? 10, 1), 100);

  const cacheKey = `stale_docs:${maxResults}`;
  const cached = cacheObj.get<ListStaleDocsResponse>(cacheKey);
  if (cached) return cached;

  const rows = await queryStaleFiles(
    pool, config.repoId, config.staleThresholdDays, maxResults,
  );

  const response: ListStaleDocsResponse = {
    stale_docs: rows.map((r) => ({
      file: r.file,
      drifted_claims: parseInt(r.drifted_claims, 10),
      uncertain_claims: parseInt(r.uncertain_claims, 10),
      last_verified: r.last_verified,
    })),
  };

  cacheObj.set(cacheKey, response, config.cacheTtlSeconds);
  return response;
}

// === Helpers ===

const STATUS_PRIORITY: Record<string, number> = {
  drifted: 0,
  uncertain: 1,
  pending: 2,
  verified: 3,
};

function getWorstStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'pending';
  return statuses.reduce((worst, s) =>
    (STATUS_PRIORITY[s] ?? 2) < (STATUS_PRIORITY[worst] ?? 2) ? s : worst,
  );
}
