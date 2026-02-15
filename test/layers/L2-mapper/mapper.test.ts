import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createMapper } from '../../../src/layers/L2-mapper';
import { MapperStore } from '../../../src/layers/L2-mapper/mapper-store';
import { mapDirectReference, RUNNER_MANIFEST_MAP } from '../../../src/layers/L2-mapper/step1-direct';
import { mapSymbolSearch, extractSymbolFromImport } from '../../../src/layers/L2-mapper/step2-symbol';
import { mapSemanticSearch } from '../../../src/layers/L2-mapper/step3-semantic';
import { deduplicateMappings } from '../../../src/layers/L2-mapper/dedup';
import { LearningServiceStub } from '../../../src/layers/L7-learning';
import type { Claim, CodeEntity, DependencyVersion, RouteEntity } from '../../../src/shared/types';
import type { CodebaseIndexService } from '../../../src/layers/L0-codebase-index';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

// === Mock L0 index ===
function makeMockIndex(overrides: Partial<CodebaseIndexService> = {}): CodebaseIndexService {
  return {
    fileExists: async () => false,
    getFileTree: async () => [],
    findSymbol: async () => [],
    getEntityByFile: async () => [],
    getEntityById: async () => null,
    findRoute: async () => null,
    searchRoutes: async () => [],
    getDependencyVersion: async () => null,
    scriptExists: async () => false,
    getAvailableScripts: async () => [],
    searchSemantic: async () => [],
    updateFromDiff: async () => ({ entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] }),
    readFileContent: async () => null,
    getManifestMetadata: async () => null,
    getHeadings: async () => [],
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: randomUUID(),
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: 'test claim',
    claim_type: 'path_reference',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'pending',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// === Step 1 Direct Reference Tests ===
describe('mapDirectReference', () => {
  it('maps path_reference when file exists', async () => {
    const index = makeMockIndex({ fileExists: async () => true });
    const claim = makeClaim({ extracted_value: { path: 'src/app.ts' } });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].code_file).toBe('src/app.ts');
    expect(candidates[0].confidence).toBe(1.0);
    expect(candidates[0].mapping_method).toBe('direct_reference');
  });

  it('returns empty when path does not exist', async () => {
    const index = makeMockIndex({ fileExists: async () => false });
    const claim = makeClaim({ extracted_value: { path: 'src/missing.ts' } });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(0);
  });

  it('maps command when script exists', async () => {
    const index = makeMockIndex({ scriptExists: async () => true });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'test' },
    });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].code_file).toBe('package.json');
  });

  it('maps dependency_version when package exists', async () => {
    const dep: DependencyVersion = { version: '^4.18.0', source: 'manifest' };
    const index = makeMockIndex({ getDependencyVersion: async () => dep });
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'express', version: '4' },
    });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].code_file).toBe('package.json');
  });

  it('maps api_route with exact route match', async () => {
    const route: RouteEntity = { id: 'e1', file_path: 'src/routes.ts', line_number: 10, method: 'GET', path: '/api/users' };
    const index = makeMockIndex({ findRoute: async () => route });
    const claim = makeClaim({
      claim_type: 'api_route',
      extracted_value: { method: 'GET', path: '/api/users' },
    });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].code_file).toBe('src/routes.ts');
    expect(candidates[0].confidence).toBe(1.0);
  });

  it('maps api_route with fuzzy match >= 0.7', async () => {
    const index = makeMockIndex({
      findRoute: async () => null,
      searchRoutes: async () => [{ method: 'GET', path: '/api/v2/users', file: 'src/routes.ts', line: 10, similarity: 0.8 }],
    });
    const claim = makeClaim({
      claim_type: 'api_route',
      extracted_value: { method: 'GET', path: '/api/users' },
    });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.8);
  });

  it('returns empty for api_route below fuzzy threshold', async () => {
    const index = makeMockIndex({
      findRoute: async () => null,
      searchRoutes: async () => [{ method: 'GET', path: '/api/v3/items', file: 'src/routes.ts', line: 10, similarity: 0.5 }],
    });
    const claim = makeClaim({
      claim_type: 'api_route',
      extracted_value: { method: 'GET', path: '/api/users' },
    });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(0);
  });

  it('returns empty for types without Step 1', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_type: 'behavior', extracted_value: {} });
    const candidates = await mapDirectReference('repo-1', claim, index);
    expect(candidates).toHaveLength(0);
  });
});

// === Runner Manifest Map ===
describe('RUNNER_MANIFEST_MAP', () => {
  it('maps npm to package.json', () => {
    expect(RUNNER_MANIFEST_MAP.npm).toContain('package.json');
  });

  it('maps pip to requirements.txt', () => {
    expect(RUNNER_MANIFEST_MAP.pip).toContain('requirements.txt');
  });

  it('maps cargo to Cargo.toml', () => {
    expect(RUNNER_MANIFEST_MAP.cargo).toContain('Cargo.toml');
  });
});

// === Step 2 Symbol Search ===
describe('mapSymbolSearch', () => {
  it('searches keywords for behavior claims', async () => {
    const entity: CodeEntity = {
      id: 'e1', repo_id: 'r1', file_path: 'src/auth.ts', line_number: 1, end_line_number: 10,
      entity_type: 'function', name: 'authenticate', signature: 'function authenticate()',
      embedding: null, raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
    };
    const index = makeMockIndex({ findSymbol: async () => [entity] });
    const claim = makeClaim({ claim_type: 'behavior', keywords: ['authenticate'] });
    const candidates = await mapSymbolSearch('repo-1', claim, index);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].mapping_method).toBe('symbol_search');
    expect(candidates[0].confidence).toBe(0.85);
  });

  it('extracts symbols from code_example imports', async () => {
    const entity: CodeEntity = {
      id: 'e1', repo_id: 'r1', file_path: 'src/express.ts', line_number: 1, end_line_number: 10,
      entity_type: 'function', name: 'express', signature: '',
      embedding: null, raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
    };
    const index = makeMockIndex({ findSymbol: async (_, name) => name === 'express' ? [entity] : [] });
    const claim = makeClaim({
      claim_type: 'code_example',
      extracted_value: { imports: ['express'], symbols: [] },
    });
    const candidates = await mapSymbolSearch('repo-1', claim, index);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });
});

describe('extractSymbolFromImport', () => {
  it('extracts last segment', () => {
    expect(extractSymbolFromImport('express')).toBe('express');
    expect(extractSymbolFromImport('@auth/handler')).toBe('handler');
    expect(extractSymbolFromImport('../utils/helper')).toBe('helper');
  });

  it('strips file extensions', () => {
    expect(extractSymbolFromImport('src/app.ts')).toBe('app');
    expect(extractSymbolFromImport('utils/helper.js')).toBe('helper');
  });

  it('returns null for empty/invalid', () => {
    expect(extractSymbolFromImport('')).toBeNull();
    expect(extractSymbolFromImport('..')).toBeNull();
  });
});

// === Step 3 Semantic Search ===
describe('mapSemanticSearch', () => {
  it('uses L0 semantic search', async () => {
    const entity = {
      id: 'e1', repo_id: 'r1', file_path: 'src/auth.ts', line_number: 1, end_line_number: 10,
      entity_type: 'function' as const, name: 'auth', signature: '', embedding: null,
      raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
      similarity: 0.9,
    };
    const index = makeMockIndex({ searchSemantic: async () => [entity] });
    const claim = makeClaim({ claim_type: 'behavior', claim_text: 'authentication logic' });
    const candidates = await mapSemanticSearch('repo-1', claim, index);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBeCloseTo(0.72); // 0.9 * 0.8
    expect(candidates[0].mapping_method).toBe('semantic_search');
  });
});

// === Deduplication ===
describe('deduplicateMappings', () => {
  it('keeps highest confidence for same file+entity', () => {
    const candidates = [
      { code_file: 'src/a.ts', code_entity_id: 'e1', confidence: 0.7, co_change_boost: 0, mapping_method: 'symbol_search' as const },
      { code_file: 'src/a.ts', code_entity_id: 'e1', confidence: 0.9, co_change_boost: 0, mapping_method: 'direct_reference' as const },
    ];
    const result = deduplicateMappings(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it('keeps separate entries for different entities', () => {
    const candidates = [
      { code_file: 'src/a.ts', code_entity_id: 'e1', confidence: 0.9, co_change_boost: 0, mapping_method: 'direct_reference' as const },
      { code_file: 'src/a.ts', code_entity_id: 'e2', confidence: 0.8, co_change_boost: 0, mapping_method: 'symbol_search' as const },
    ];
    const result = deduplicateMappings(candidates);
    expect(result).toHaveLength(2);
  });

  it('treats null entity as distinct key', () => {
    const candidates = [
      { code_file: 'src/a.ts', code_entity_id: null, confidence: 1.0, co_change_boost: 0, mapping_method: 'direct_reference' as const },
      { code_file: 'src/a.ts', code_entity_id: 'e1', confidence: 0.8, co_change_boost: 0, mapping_method: 'symbol_search' as const },
    ];
    const result = deduplicateMappings(candidates);
    expect(result).toHaveLength(2);
  });
});

// === Database Integration Tests ===
describe('MapperStore', () => {
  let pool: Pool;
  let store: MapperStore;
  let repoId: string;
  let claimId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new MapperStore(pool);
    repoId = randomUUID();

    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'mapper-test', 1, 'main', 'active')`,
      [repoId],
    );

    // Insert a claim to reference
    const claimResult = await pool.query(
      `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
        extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, 'README.md', 1, 'test claim', 'path_reference', 'syntactic', '{}', '{}', 1.0, 'regex', 'pending')
       RETURNING id`,
      [repoId],
    );
    claimId = claimResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
  });

  it('persistMappings inserts and returns mappings', async () => {
    const candidates = [
      { code_file: 'src/app.ts', code_entity_id: null, confidence: 1.0, co_change_boost: 0, mapping_method: 'direct_reference' as const },
    ];
    const mappings = await store.persistMappings(repoId, claimId, candidates);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].code_file).toBe('src/app.ts');
    expect(mappings[0].claim_id).toBe(claimId);
  });

  it('getMappingsForClaim returns ordered by confidence', async () => {
    await store.persistMappings(repoId, claimId, [
      { code_file: 'a.ts', code_entity_id: null, confidence: 0.5, co_change_boost: 0, mapping_method: 'symbol_search' as const },
      { code_file: 'b.ts', code_entity_id: null, confidence: 0.9, co_change_boost: 0, mapping_method: 'direct_reference' as const },
    ]);
    const mappings = await store.getMappingsForClaim(claimId);
    expect(mappings).toHaveLength(2);
    expect(mappings[0].confidence).toBe(0.9);
  });

  it('findClaimsByCodeFiles returns reverse index', async () => {
    await store.persistMappings(repoId, claimId, [
      { code_file: 'src/app.ts', code_entity_id: null, confidence: 1.0, co_change_boost: 0, mapping_method: 'direct_reference' as const },
    ]);
    const mappings = await store.findClaimsByCodeFiles(repoId, ['src/app.ts']);
    expect(mappings.length).toBeGreaterThanOrEqual(1);
    expect(mappings[0].claim_id).toBe(claimId);
  });

  it('findClaimsByCodeFiles returns empty for unrelated files', async () => {
    const mappings = await store.findClaimsByCodeFiles(repoId, ['src/unrelated.ts']);
    expect(mappings).toHaveLength(0);
  });

  it('updateCodeFilePaths renames mapping paths', async () => {
    await store.persistMappings(repoId, claimId, [
      { code_file: 'src/old.ts', code_entity_id: null, confidence: 1.0, co_change_boost: 0, mapping_method: 'direct_reference' as const },
    ]);
    const updated = await store.updateCodeFilePaths(repoId, [{ old_path: 'src/old.ts', new_path: 'src/new.ts' }]);
    expect(updated).toBe(1);

    const mappings = await store.getMappingsForClaim(claimId);
    expect(mappings[0].code_file).toBe('src/new.ts');
  });

  it('removeMappingsForFiles deletes by code file', async () => {
    await store.persistMappings(repoId, claimId, [
      { code_file: 'src/delete-me.ts', code_entity_id: null, confidence: 1.0, co_change_boost: 0, mapping_method: 'direct_reference' as const },
    ]);
    const count = await store.removeMappingsForFiles(repoId, ['src/delete-me.ts']);
    expect(count).toBe(1);
  });

  it('deleteMappingsForClaim removes all for a claim', async () => {
    await store.persistMappings(repoId, claimId, [
      { code_file: 'a.ts', code_entity_id: null, confidence: 1.0, co_change_boost: 0, mapping_method: 'direct_reference' as const },
      { code_file: 'b.ts', code_entity_id: null, confidence: 0.8, co_change_boost: 0, mapping_method: 'symbol_search' as const },
    ]);
    await store.deleteMappingsForClaim(claimId);
    const mappings = await store.getMappingsForClaim(claimId);
    expect(mappings).toHaveLength(0);
  });

  it('persistMappings returns empty for empty input', async () => {
    const mappings = await store.persistMappings(repoId, claimId, []);
    expect(mappings).toHaveLength(0);
  });
});

// === Full Pipeline (with DB) ===
describe('createMapper (pipeline)', () => {
  let pool: Pool;
  let repoId: string;
  let claimId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repoId = randomUUID();

    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'mapper-pipeline-test', 1, 'main', 'active')`,
      [repoId],
    );

    const claimResult = await pool.query(
      `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
        extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, 'README.md', 1, 'Check src/app.ts', 'path_reference', 'syntactic',
        '{"path":"src/app.ts"}', '{"app"}', 1.0, 'regex', 'pending')
       RETURNING id`,
      [repoId],
    );
    claimId = claimResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
  });

  it('mapClaim runs pipeline and persists', async () => {
    const index = makeMockIndex({ fileExists: async () => true });
    const learning = new LearningServiceStub();
    const mapper = createMapper(pool, index, learning);

    const claim = makeClaim({
      id: claimId,
      repo_id: repoId,
      extracted_value: { path: 'src/app.ts' },
    });
    const mappings = await mapper.mapClaim(repoId, claim);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].code_file).toBe('src/app.ts');

    // Verify persisted in DB
    const dbMappings = await mapper.getMappingsForClaim(claimId);
    expect(dbMappings).toHaveLength(1);
  });

  it('refreshMapping deletes old and re-maps', async () => {
    const index = makeMockIndex({ fileExists: async () => true });
    const learning = new LearningServiceStub();
    const mapper = createMapper(pool, index, learning);

    const claim = makeClaim({
      id: claimId,
      repo_id: repoId,
      extracted_value: { path: 'src/app.ts' },
    });

    await mapper.mapClaim(repoId, claim);
    const refreshed = await mapper.refreshMapping(claimId, claim);
    expect(refreshed).toHaveLength(1);

    // Only 1 mapping should exist (old deleted)
    const dbMappings = await mapper.getMappingsForClaim(claimId);
    expect(dbMappings).toHaveLength(1);
  });

  it('co-change boost is applied and capped at 1.0', async () => {
    const learning = new LearningServiceStub();
    learning.getCoChangeBoost = async () => 0.5;
    const index = makeMockIndex({ fileExists: async () => true });
    const mapper = createMapper(pool, index, learning);

    const claim = makeClaim({
      id: claimId,
      repo_id: repoId,
      extracted_value: { path: 'src/app.ts' },
    });
    const mappings = await mapper.mapClaim(repoId, claim);
    expect(mappings[0].confidence).toBe(1.0); // 1.0 + 0.5 = 1.5, capped to 1.0
    expect(mappings[0].co_change_boost).toBe(0.5);
  });
});
