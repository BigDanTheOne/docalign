import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { SimpleCache } from '../../../src/layers/L6-mcp/cache';
import type { HandlerConfig } from '../../../src/layers/L6-mcp/handlers';
import {
  handleGetDocs,
  handleGetDocsForFile,
  handleGetDocHealth,
  handleListStaleDocs,
} from '../../../src/layers/L6-mcp/handlers';

// ─── Test helpers ───

function createMockPool(queryResults: Record<string, unknown[]> = {}): Pool {
  const pool = {
    query: vi.fn(async (sql: string) => {
      // Return different results based on query content
      if (sql.includes('ts_rank')) {
        return { rows: queryResults.fulltext ?? [] };
      }
      if (sql.includes('ILIKE')) {
        return { rows: queryResults.ilike ?? [] };
      }
      if (sql.includes('GROUP BY') && sql.includes('claim_type')) {
        return { rows: queryResults.health ?? [] };
      }
      if (sql.includes('HAVING')) {
        return { rows: queryResults.stale ?? [] };
      }
      if (sql.includes('claim_mappings')) {
        return { rows: queryResults.forFile ?? [] };
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
  return pool;
}

const defaultConfig: HandlerConfig = {
  repoId: 'repo-123',
  cacheTtlSeconds: 60,
  maxSearchResults: 20,
  staleThresholdDays: 30,
};

// ─── get_docs ───

describe('handleGetDocs', () => {
  let cache: SimpleCache;

  beforeEach(() => {
    cache = new SimpleCache();
  });

  it('returns sections from full-text search', async () => {
    const pool = createMockPool({
      fulltext: [
        {
          claim_id: 'c1',
          claim_text: 'The API uses REST endpoints',
          claim_type: 'api_behavior',
          source_file: 'docs/api.md',
          line_number: 10,
          verification_status: 'verified',
          last_verified_at: '2026-01-15T00:00:00Z',
          rank: 0.8,
        },
        {
          claim_id: 'c2',
          claim_text: 'POST /users creates a new user',
          claim_type: 'api_behavior',
          source_file: 'docs/api.md',
          line_number: 20,
          verification_status: 'drifted',
          last_verified_at: '2026-01-10T00:00:00Z',
          rank: 0.5,
        },
      ],
    });

    const result = await handleGetDocs({ query: 'API' }, pool, defaultConfig, cache);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].file).toBe('docs/api.md');
    expect(result.sections[0].claims_in_section).toBe(2);
    expect(result.sections[0].verified_claims).toBe(1);
    expect(result.sections[0].verification_status).toBe('drifted'); // worst-case
    expect(result.sections[0].health_score).toBe(0.5); // 1/2
    expect(result.sections[0].last_verified).toBe('2026-01-15T00:00:00Z');
  });

  it('falls back to ILIKE when full-text returns empty', async () => {
    const pool = createMockPool({
      fulltext: [],
      ilike: [
        {
          claim_id: 'c3',
          claim_text: 'Config uses YAML format',
          claim_type: 'config',
          source_file: 'docs/config.md',
          line_number: 5,
          verification_status: 'verified',
          last_verified_at: '2026-01-20T00:00:00Z',
        },
      ],
    });

    const result = await handleGetDocs({ query: 'YAML' }, pool, defaultConfig, cache);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].file).toBe('docs/config.md');
    // Pool should be called twice (fulltext then ilike)
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('returns empty sections when no results', async () => {
    const pool = createMockPool({});

    const result = await handleGetDocs({ query: 'nonexistent' }, pool, defaultConfig, cache);

    expect(result.sections).toEqual([]);
  });

  it('groups results by file', async () => {
    const pool = createMockPool({
      fulltext: [
        {
          claim_id: 'c1',
          claim_text: 'Claim in file A',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 1,
          verification_status: 'verified',
          last_verified_at: '2026-01-15T00:00:00Z',
          rank: 0.9,
        },
        {
          claim_id: 'c2',
          claim_text: 'Claim in file B',
          claim_type: 'behavior',
          source_file: 'docs/b.md',
          line_number: 1,
          verification_status: 'pending',
          last_verified_at: null,
          rank: 0.7,
        },
      ],
    });

    const result = await handleGetDocs({ query: 'claim' }, pool, defaultConfig, cache);

    expect(result.sections).toHaveLength(2);
    const files = result.sections.map((s) => s.file);
    expect(files).toContain('docs/a.md');
    expect(files).toContain('docs/b.md');
  });

  it('returns cached result on second call', async () => {
    const pool = createMockPool({
      fulltext: [
        {
          claim_id: 'c1',
          claim_text: 'cached claim',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 1,
          verification_status: 'verified',
          last_verified_at: '2026-01-01T00:00:00Z',
          rank: 1.0,
        },
      ],
    });

    const r1 = await handleGetDocs({ query: 'cache test' }, pool, defaultConfig, cache);
    const r2 = await handleGetDocs({ query: 'cache test' }, pool, defaultConfig, cache);

    expect(r1).toEqual(r2);
    // Only one DB call for fulltext (first call), second is from cache
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('applies verified_only filter', async () => {
    const pool = createMockPool({
      fulltext: [
        {
          claim_id: 'c1',
          claim_text: 'verified claim',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 1,
          verification_status: 'verified',
          last_verified_at: '2026-01-01T00:00:00Z',
          rank: 1.0,
        },
      ],
    });

    await handleGetDocs({ query: 'test', verified_only: true }, pool, defaultConfig, cache);

    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("verification_status = 'verified'");
  });

  it('uses worst-case status from claims in a section', async () => {
    const pool = createMockPool({
      fulltext: [
        {
          claim_id: 'c1',
          claim_text: 'claim 1',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 1,
          verification_status: 'verified',
          last_verified_at: '2026-01-01T00:00:00Z',
          rank: 1.0,
        },
        {
          claim_id: 'c2',
          claim_text: 'claim 2',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 5,
          verification_status: 'uncertain',
          last_verified_at: null,
          rank: 0.8,
        },
      ],
    });

    const result = await handleGetDocs({ query: 'claims' }, pool, defaultConfig, cache);

    expect(result.sections[0].verification_status).toBe('uncertain');
  });

  it('concatenates claim texts as content', async () => {
    const pool = createMockPool({
      fulltext: [
        {
          claim_id: 'c1',
          claim_text: 'First claim',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 1,
          verification_status: 'verified',
          last_verified_at: null,
          rank: 1.0,
        },
        {
          claim_id: 'c2',
          claim_text: 'Second claim',
          claim_type: 'behavior',
          source_file: 'docs/a.md',
          line_number: 5,
          verification_status: 'verified',
          last_verified_at: null,
          rank: 0.8,
        },
      ],
    });

    const result = await handleGetDocs({ query: 'claims' }, pool, defaultConfig, cache);

    expect(result.sections[0].content).toBe('First claim\nSecond claim');
  });
});

// ─── get_docs_for_file ───

describe('handleGetDocsForFile', () => {
  let cache: SimpleCache;

  beforeEach(() => {
    cache = new SimpleCache();
  });

  it('returns claims mapped to a code file', async () => {
    const pool = createMockPool({
      forFile: [
        {
          claim_id: 'c1',
          doc_file: 'docs/api.md',
          line_number: 10,
          claim_text: 'The API uses REST',
          claim_type: 'api_behavior',
          verification_status: 'verified',
          last_verified_at: '2026-01-15T00:00:00Z',
          mapping_confidence: 0.9,
        },
      ],
    });

    const result = await handleGetDocsForFile(
      { file_path: 'src/api/handler.ts' },
      pool,
      defaultConfig,
      cache,
    );

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].doc_file).toBe('docs/api.md');
    expect(result.claims[0].mapping_confidence).toBe(0.9);
    expect(result.claims[0].verification_status).toBe('verified');
  });

  it('returns empty claims for nonexistent file', async () => {
    const pool = createMockPool({});

    const result = await handleGetDocsForFile(
      { file_path: 'src/nonexistent.ts' },
      pool,
      defaultConfig,
      cache,
    );

    expect(result.claims).toEqual([]);
  });

  it('caches results', async () => {
    const pool = createMockPool({
      forFile: [
        {
          claim_id: 'c1',
          doc_file: 'docs/a.md',
          line_number: 1,
          claim_text: 'test',
          claim_type: 'behavior',
          verification_status: 'verified',
          last_verified_at: null,
          mapping_confidence: 0.8,
        },
      ],
    });

    await handleGetDocsForFile({ file_path: 'src/a.ts' }, pool, defaultConfig, cache);
    await handleGetDocsForFile({ file_path: 'src/a.ts' }, pool, defaultConfig, cache);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('passes include_verified=false to exclude verified claims', async () => {
    const pool = createMockPool({});

    await handleGetDocsForFile(
      { file_path: 'src/a.ts', include_verified: false },
      pool,
      defaultConfig,
      cache,
    );

    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("verification_status != 'verified'");
  });
});

// ─── get_doc_health ───

describe('handleGetDocHealth', () => {
  let cache: SimpleCache;

  beforeEach(() => {
    cache = new SimpleCache();
  });

  it('returns repo-wide health with no path', async () => {
    const pool = createMockPool({
      health: [
        { source_file: 'docs/api.md', claim_type: 'behavior', verification_status: 'verified', count: '5' },
        { source_file: 'docs/api.md', claim_type: 'behavior', verification_status: 'drifted', count: '2' },
        { source_file: 'docs/config.md', claim_type: 'config', verification_status: 'pending', count: '3' },
      ],
    });

    const result = await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(result.health.total_claims).toBe(10);
    expect(result.health.verified).toBe(5);
    expect(result.health.drifted).toBe(2);
    expect(result.health.pending).toBe(3);
    expect(result.health.score).toBeCloseTo(5 / 7); // verified / (verified + drifted)
  });

  it('returns per-file breakdown', async () => {
    const pool = createMockPool({
      health: [
        { source_file: 'docs/a.md', claim_type: 'behavior', verification_status: 'verified', count: '3' },
        { source_file: 'docs/a.md', claim_type: 'behavior', verification_status: 'drifted', count: '1' },
        { source_file: 'docs/b.md', claim_type: 'config', verification_status: 'uncertain', count: '2' },
      ],
    });

    const result = await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(result.health.by_file['docs/a.md']).toEqual({
      total: 4,
      verified: 3,
      drifted: 1,
      uncertain: 0,
    });
    expect(result.health.by_file['docs/b.md']).toEqual({
      total: 2,
      verified: 0,
      drifted: 0,
      uncertain: 2,
    });
  });

  it('returns by_type distribution', async () => {
    const pool = createMockPool({
      health: [
        { source_file: 'docs/a.md', claim_type: 'behavior', verification_status: 'verified', count: '3' },
        { source_file: 'docs/a.md', claim_type: 'config', verification_status: 'verified', count: '2' },
      ],
    });

    const result = await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(result.health.by_type).toEqual({ behavior: 3, config: 2 });
  });

  it('returns hotspots (top 5 drifted files)', async () => {
    const pool = createMockPool({
      health: [
        { source_file: 'docs/a.md', claim_type: 'behavior', verification_status: 'drifted', count: '10' },
        { source_file: 'docs/b.md', claim_type: 'behavior', verification_status: 'drifted', count: '8' },
        { source_file: 'docs/c.md', claim_type: 'behavior', verification_status: 'drifted', count: '6' },
        { source_file: 'docs/d.md', claim_type: 'behavior', verification_status: 'drifted', count: '4' },
        { source_file: 'docs/e.md', claim_type: 'behavior', verification_status: 'drifted', count: '2' },
        { source_file: 'docs/f.md', claim_type: 'behavior', verification_status: 'drifted', count: '1' },
      ],
    });

    const result = await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(result.health.hotspots).toHaveLength(5);
    expect(result.health.hotspots[0]).toBe('docs/a.md');
    expect(result.health.hotspots[4]).toBe('docs/e.md');
    expect(result.health.hotspots).not.toContain('docs/f.md');
  });

  it('returns score=null when all claims are pending', async () => {
    const pool = createMockPool({
      health: [
        { source_file: 'docs/a.md', claim_type: 'behavior', verification_status: 'pending', count: '5' },
      ],
    });

    const result = await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(result.health.score).toBeNull();
  });

  it('passes path filter to query', async () => {
    const pool = createMockPool({});

    await handleGetDocHealth({ path: 'docs/api.md' }, pool, defaultConfig, cache);

    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toContain('docs/api.md');
  });

  it('rejects path traversal', async () => {
    const pool = createMockPool({});

    await expect(
      handleGetDocHealth({ path: '../../../etc/passwd' }, pool, defaultConfig, cache),
    ).rejects.toThrow('Path must not contain ".."');
  });

  it('caches results', async () => {
    const pool = createMockPool({
      health: [
        { source_file: 'docs/a.md', claim_type: 'behavior', verification_status: 'verified', count: '1' },
      ],
    });

    await handleGetDocHealth({}, pool, defaultConfig, cache);
    await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('handles empty results (no claims)', async () => {
    const pool = createMockPool({});

    const result = await handleGetDocHealth({}, pool, defaultConfig, cache);

    expect(result.health.total_claims).toBe(0);
    expect(result.health.score).toBeNull();
    expect(result.health.hotspots).toEqual([]);
  });
});

// ─── list_stale_docs ───

describe('handleListStaleDocs', () => {
  let cache: SimpleCache;

  beforeEach(() => {
    cache = new SimpleCache();
  });

  it('returns stale documents ordered by severity', async () => {
    const pool = createMockPool({
      stale: [
        {
          file: 'docs/api.md',
          drifted_claims: '5',
          uncertain_claims: '2',
          last_verified: '2026-01-01T00:00:00Z',
        },
        {
          file: 'docs/config.md',
          drifted_claims: '1',
          uncertain_claims: '0',
          last_verified: null,
        },
      ],
    });

    const result = await handleListStaleDocs({}, pool, defaultConfig, cache);

    expect(result.stale_docs).toHaveLength(2);
    expect(result.stale_docs[0].file).toBe('docs/api.md');
    expect(result.stale_docs[0].drifted_claims).toBe(5);
    expect(result.stale_docs[0].uncertain_claims).toBe(2);
    expect(result.stale_docs[1].last_verified).toBeNull();
  });

  it('defaults to max_results=10', async () => {
    const pool = createMockPool({});

    await handleListStaleDocs({}, pool, defaultConfig, cache);

    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toContain(10); // maxResults
  });

  it('clamps max_results to 1-100 range', async () => {
    const pool = createMockPool({});

    await handleListStaleDocs({ max_results: 0 }, pool, defaultConfig, cache);
    let call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1][2]).toBe(1); // clamped to 1

    cache.clear();
    await handleListStaleDocs({ max_results: 200 }, pool, defaultConfig, cache);
    call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(call[1][2]).toBe(100); // clamped to 100
  });

  it('returns empty when no stale docs', async () => {
    const pool = createMockPool({});

    const result = await handleListStaleDocs({}, pool, defaultConfig, cache);

    expect(result.stale_docs).toEqual([]);
  });

  it('caches results', async () => {
    const pool = createMockPool({
      stale: [
        { file: 'docs/a.md', drifted_claims: '1', uncertain_claims: '0', last_verified: null },
      ],
    });

    await handleListStaleDocs({}, pool, defaultConfig, cache);
    await handleListStaleDocs({}, pool, defaultConfig, cache);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('parses string counts to numbers', async () => {
    const pool = createMockPool({
      stale: [
        { file: 'docs/a.md', drifted_claims: '42', uncertain_claims: '7', last_verified: null },
      ],
    });

    const result = await handleListStaleDocs({}, pool, defaultConfig, cache);

    expect(result.stale_docs[0].drifted_claims).toBe(42);
    expect(result.stale_docs[0].uncertain_claims).toBe(7);
  });
});

