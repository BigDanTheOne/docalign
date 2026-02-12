import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import {
  verifyPathReference,
  verifyApiRoute,
  verifyDependencyVersion,
  verifyCommand,
  verifyCodeExample,
  verifyTier2,
  compareVersions,
  stripVersionPrefix,
  levenshtein,
  findCloseMatch,
  findSimilarPaths,
  ResultStore,
} from '../../../src/layers/L3-verifier';
import type { Claim, CodeEntity, DependencyVersion, RouteEntity, VerificationResult } from '../../../src/shared/types';
import type { CodebaseIndexService } from '../../../src/layers/L0-codebase-index';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

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

// === Tier 1: path_reference ===
describe('verifyPathReference', () => {
  it('returns verified when file exists', async () => {
    const index = makeMockIndex({ fileExists: async () => true });
    const claim = makeClaim({ extracted_value: { path: 'src/app.ts' } });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('src/app.ts');
  });

  it('returns drifted with similar path suggestion', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => ['src/app.tsx'],
    });
    const claim = makeClaim({ extracted_value: { path: 'src/app.ts' } });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('medium');
    expect(result!.suggested_fix).toBeDefined();
  });

  it('returns high severity drifted when no similar paths', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => ['totally/different.rs'],
    });
    const claim = makeClaim({ extracted_value: { path: 'src/app.ts' } });
    const result = await verifyPathReference(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('high');
  });

  it('verifies bare filename via basename search', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => ['src/hooks/bundled/boot-md/HOOK.md', 'src/other.ts'],
    });
    const claim = makeClaim({
      source_file: 'docs/automation/hooks.md',
      extracted_value: { path: 'HOOK.md' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('src/hooks/bundled/boot-md/HOOK.md');
  });
});

// === Tier 1: api_route ===
describe('verifyApiRoute', () => {
  it('returns verified when route exists', async () => {
    const route: RouteEntity = { id: 'r1', file_path: 'src/routes.ts', line_number: 10, method: 'GET', path: '/api/users' };
    const index = makeMockIndex({ findRoute: async () => route });
    const claim = makeClaim({
      claim_type: 'api_route',
      extracted_value: { method: 'GET', path: '/api/users' },
    });
    const result = await verifyApiRoute(claim, index);
    expect(result!.verdict).toBe('verified');
  });

  it('returns drifted with alternative', async () => {
    const index = makeMockIndex({
      findRoute: async () => null,
      searchRoutes: async () => [{ method: 'GET', path: '/api/v2/users', file: 'src/routes.ts', line: 10, similarity: 0.8 }],
    });
    const claim = makeClaim({
      claim_type: 'api_route',
      extracted_value: { method: 'GET', path: '/api/users' },
    });
    const result = await verifyApiRoute(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('medium');
  });

  it('returns drifted with high severity when no routes', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'api_route',
      extracted_value: { method: 'GET', path: '/api/users' },
    });
    const result = await verifyApiRoute(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('high');
  });
});

// === Tier 1: dependency_version ===
describe('verifyDependencyVersion', () => {
  it('returns verified when version matches', async () => {
    const dep: DependencyVersion = { version: '4.18.0', source: 'lockfile' };
    const index = makeMockIndex({ getDependencyVersion: async () => dep });
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'express', version: '4' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result!.verdict).toBe('verified');
  });

  it('returns drifted when version mismatches', async () => {
    const dep: DependencyVersion = { version: '5.0.0', source: 'lockfile' };
    const index = makeMockIndex({ getDependencyVersion: async () => dep });
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'express', version: '4' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('medium');
  });

  it('returns drifted when package not found', async () => {
    const index = makeMockIndex({ getDependencyVersion: async () => null });
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'missing-pkg' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('high');
  });
});

// === Tier 1: command ===
describe('verifyCommand', () => {
  it('returns verified when script exists', async () => {
    const index = makeMockIndex({ scriptExists: async () => true });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'test' },
    });
    const result = await verifyCommand(claim, index);
    expect(result!.verdict).toBe('verified');
  });

  it('returns drifted with close match', async () => {
    const index = makeMockIndex({
      scriptExists: async () => false,
      getAvailableScripts: async () => [{ name: 'tests', command: 'vitest', file_path: 'package.json' }],
    });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'test' },
    });
    const result = await verifyCommand(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.suggested_fix).toBeDefined();
  });

  it('returns drifted with no match', async () => {
    const index = makeMockIndex({
      scriptExists: async () => false,
      getAvailableScripts: async () => [],
    });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'nonexistent' },
    });
    const result = await verifyCommand(claim, index);
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('high');
  });

  it('skips npm built-in subcommands like install', async () => {
    const index = makeMockIndex({ scriptExists: async () => false });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'install --omit=dev' },
    });
    const result = await verifyCommand(claim, index);
    expect(result).toBeNull();
  });

  it('skips pnpm built-in subcommands like publish', async () => {
    const index = makeMockIndex({ scriptExists: async () => false });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'pnpm', script: 'publish' },
    });
    const result = await verifyCommand(claim, index);
    expect(result).toBeNull();
  });

  it('skips yarn add as built-in', async () => {
    const index = makeMockIndex({ scriptExists: async () => false });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'yarn', script: 'add react' },
    });
    const result = await verifyCommand(claim, index);
    expect(result).toBeNull();
  });

  it('still verifies user-defined scripts like test/build', async () => {
    const index = makeMockIndex({ scriptExists: async () => true });
    const claim = makeClaim({
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'test' },
    });
    const result = await verifyCommand(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });
});

// === Tier 1: code_example ===
describe('verifyCodeExample', () => {
  it('returns verified when all imports and symbols found', async () => {
    const entity: CodeEntity = {
      id: 'e1', repo_id: 'r1', file_path: 'src/express.ts', line_number: 1, end_line_number: 10,
      entity_type: 'function', name: 'express', signature: '',
      embedding: null, raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
    };
    const index = makeMockIndex({ findSymbol: async () => [entity] });
    const claim = makeClaim({
      claim_type: 'code_example',
      extracted_value: { imports: ['express'], symbols: ['app'] },
    });
    const result = await verifyCodeExample(claim, index);
    expect(result!.verdict).toBe('verified');
  });

  it('returns drifted when some imports missing but some found', async () => {
    const entity: CodeEntity = {
      id: 'e1', repo_id: 'r1', file_path: 'src/express.ts', line_number: 1, end_line_number: 10,
      entity_type: 'function', name: 'express', signature: '',
      embedding: null, raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
    };
    const index = makeMockIndex({
      findSymbol: async (_, name) => name === 'express' ? [entity] : [],
    });
    const claim = makeClaim({
      claim_type: 'code_example',
      extracted_value: { imports: ['express', 'missing-pkg'], symbols: [] },
    });
    const result = await verifyCodeExample(claim, index);
    expect(result!.verdict).toBe('drifted');
  });

  it('returns null when all symbols missing (likely tutorial code)', async () => {
    const index = makeMockIndex({ findSymbol: async () => [] });
    const claim = makeClaim({
      claim_type: 'code_example',
      extracted_value: { imports: ['fake-lib'], symbols: ['FakeClass'] },
    });
    const result = await verifyCodeExample(claim, index);
    expect(result).toBeNull();
  });

  it('returns null when no imports or symbols', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'code_example',
      extracted_value: { imports: [], symbols: [] },
    });
    const result = await verifyCodeExample(claim, index);
    expect(result).toBeNull();
  });
});

// === Tier 2 ===
describe('verifyTier2', () => {
  it('returns null for non-convention/environment claims', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_type: 'path_reference' });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });

  it('returns verified for framework import check', async () => {
    const entity: CodeEntity = {
      id: 'e1', repo_id: 'r1', file_path: 'src/app.ts', line_number: 1, end_line_number: 10,
      entity_type: 'function', name: 'react', signature: '',
      embedding: null, raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
    };
    const index = makeMockIndex({ findSymbol: async () => [entity] });
    const claim = makeClaim({
      claim_type: 'convention',
      extracted_value: { framework: 'react' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.tier).toBe(2);
  });

  it('returns null when no framework specified', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_type: 'convention', extracted_value: {} });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });
});

// === Version Comparison ===
describe('compareVersions', () => {
  it('handles major-only match', () => {
    expect(compareVersions('18', '18.2.0', 'lockfile').matches).toBe(true);
    expect(compareVersions('18', '19.0.0', 'lockfile').matches).toBe(false);
  });

  it('handles major.minor match', () => {
    expect(compareVersions('18.2', '18.2.7', 'lockfile').matches).toBe(true);
    expect(compareVersions('18.2', '18.3.0', 'lockfile').matches).toBe(false);
  });

  it('handles exact match', () => {
    expect(compareVersions('18.2.0', '18.2.0', 'lockfile').matches).toBe(true);
    expect(compareVersions('18.2.0', '18.3.0', 'lockfile').matches).toBe(false);
  });

  it('handles manifest range prefixes', () => {
    expect(compareVersions('4', '^4.18.0', 'manifest').matches).toBe(true);
    expect(compareVersions('4', '~4.18.0', 'manifest').matches).toBe(true);
  });
});

describe('stripVersionPrefix', () => {
  it('strips v prefix', () => {
    expect(stripVersionPrefix('v18.2.0')).toBe('18.2.0');
  });

  it('strips caret and tilde', () => {
    expect(stripVersionPrefix('^4.18.0')).toBe('4.18.0');
    expect(stripVersionPrefix('~4.18.0')).toBe('4.18.0');
  });

  it('strips comparison prefixes', () => {
    expect(stripVersionPrefix('>=4.0.0')).toBe('4.0.0');
  });
});

// === Levenshtein ===
describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns correct distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('app.ts', 'app.tsx')).toBe(1);
  });
});

// === Close Match ===
describe('findCloseMatch', () => {
  it('finds close match within threshold', () => {
    const result = findCloseMatch('test', ['tests', 'build', 'start'], 2);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('tests');
    expect(result!.distance).toBe(1);
  });

  it('returns null when no close match', () => {
    const result = findCloseMatch('test', ['build', 'deploy', 'format'], 2);
    expect(result).toBeNull();
  });
});

// === Similar Paths ===
describe('findSimilarPaths', () => {
  it('finds basename matches', async () => {
    const index = makeMockIndex({ getFileTree: async () => ['src/app.tsx', 'lib/app.ts', 'src/other.ts'] });
    const results = await findSimilarPaths('repo-1', 'src/app.ts', index, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // app.tsx should be found (basename distance 1)
    expect(results.some((r) => r.path === 'src/app.tsx')).toBe(true);
  });

  it('falls back to full path if no basename match', async () => {
    const index = makeMockIndex({ getFileTree: async () => ['src/apps.ts'] });
    const results = await findSimilarPaths('repo-1', 'src/app.ts', index, 5);
    // app.ts vs apps.ts has basename distance 1
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// === ResultStore (DB Integration) ===
describe('ResultStore', () => {
  let pool: Pool;
  let resultStore: ResultStore;
  let repoId: string;
  let claimId: string;
  let scanRunId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    resultStore = new ResultStore(pool);
    repoId = randomUUID();
    scanRunId = randomUUID();

    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'verifier-test', 1, 'main', 'active')`,
      [repoId],
    );

    await pool.query(
      `INSERT INTO scan_runs (id, repo_id, trigger_type, status, commit_sha, started_at)
       VALUES ($1, $2, 'manual', 'running', 'abc123', NOW())`,
      [scanRunId, repoId],
    );

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
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    // Reset claim status
    await pool.query(
      'UPDATE claims SET verification_status = $2, last_verification_result_id = NULL WHERE id = $1',
      [claimId, 'pending'],
    );
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
  });

  it('storeResult inserts and updates claim', async () => {
    const result: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'verified', confidence: 1.0, tier: 1, severity: null,
      reasoning: 'File exists', specific_mismatch: null, suggested_fix: null,
      evidence_files: ['src/app.ts'], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(result);

    // Claim should be updated
    const claimRow = await pool.query('SELECT verification_status, last_verification_result_id FROM claims WHERE id = $1', [claimId]);
    expect(claimRow.rows[0].verification_status).toBe('verified');
    expect(claimRow.rows[0].last_verification_result_id).toBe(result.id);
  });

  it('3C-005: downgrades drifted with no evidence to uncertain', async () => {
    const result: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'drifted', confidence: 1.0, tier: 1, severity: 'high',
      reasoning: 'File not found', specific_mismatch: null, suggested_fix: null,
      evidence_files: [], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(result);

    // Should be stored as 'uncertain'
    const stored = await resultStore.getLatestResult(claimId);
    expect(stored!.verdict).toBe('uncertain');
    expect(stored!.reasoning).toContain('3C-005');
  });

  it('reduces confidence for verified with no evidence', async () => {
    const result: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'verified', confidence: 1.0, tier: 1, severity: null,
      reasoning: 'Check passed', specific_mismatch: null, suggested_fix: null,
      evidence_files: [], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(result);

    const stored = await resultStore.getLatestResult(claimId);
    expect(stored!.confidence).toBeCloseTo(0.7); // 1.0 - 0.3
  });

  it('storeResult is idempotent on duplicate ID', async () => {
    const id = randomUUID();
    const result: VerificationResult = {
      id, claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'verified', confidence: 1.0, tier: 1, severity: null,
      reasoning: 'File exists', specific_mismatch: null, suggested_fix: null,
      evidence_files: ['src/app.ts'], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(result);
    // Second insert should not throw
    await resultStore.storeResult(result);
  });

  it('getLatestResult returns most recent', async () => {
    const r1: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'verified', confidence: 1.0, tier: 1, severity: null,
      reasoning: 'First', specific_mismatch: null, suggested_fix: null,
      evidence_files: ['src/app.ts'], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(r1);

    // Small delay to ensure different created_at
    await new Promise((r) => setTimeout(r, 10));

    const r2: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'drifted', confidence: 1.0, tier: 1, severity: 'high',
      reasoning: 'Second', specific_mismatch: null, suggested_fix: null,
      evidence_files: ['src/app.ts'], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(r2);

    const latest = await resultStore.getLatestResult(claimId);
    // Should be 'uncertain' due to 3C-005 (drifted stored as uncertain since evidence_files: ['src/app.ts'] — wait, this has evidence)
    // Actually r2 has evidence_files: ['src/app.ts'], so no 3C-005 downgrade
    expect(latest!.verdict).toBe('drifted');
  });

  it('getLatestResult returns null for no results', async () => {
    const result = await resultStore.getLatestResult(randomUUID());
    expect(result).toBeNull();
  });

  it('mergeResults prefers higher tier', async () => {
    const r1: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'verified', confidence: 1.0, tier: 1, severity: null,
      reasoning: 'Tier 1', specific_mismatch: null, suggested_fix: null,
      evidence_files: ['src/app.ts'], token_cost: null, duration_ms: 5,
      post_check_result: null, verification_path: null, created_at: new Date(),
    };
    await resultStore.storeResult(r1);

    await new Promise((r) => setTimeout(r, 10));

    const r2: VerificationResult = {
      id: randomUUID(), claim_id: claimId, repo_id: repoId, scan_run_id: scanRunId,
      verdict: 'drifted', confidence: 0.9, tier: 4, severity: 'medium',
      reasoning: 'Tier 4 LLM', specific_mismatch: null, suggested_fix: null,
      evidence_files: ['src/app.ts'], token_cost: 100, duration_ms: 500,
      post_check_result: null, verification_path: 2, created_at: new Date(),
    };
    await resultStore.storeResult(r2);

    const merged = await resultStore.mergeResults(scanRunId);
    expect(merged).toHaveLength(1);
    expect(merged[0].tier).toBe(4); // Higher tier preferred
  });
});
