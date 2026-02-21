/**
 * E3-11: Cross-Layer Integration Test (L0 → L2 → L3)
 *
 * 7 scenarios exercising the full mapping + verification pipeline
 * with real services (no mocks between layers). L7 stubs injected.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { initParser } from '../../src/layers/L0-codebase-index/ast-parser';
import { IndexStore } from '../../src/layers/L0-codebase-index/index-store';
import { createCodebaseIndex } from '../../src/layers/L0-codebase-index';
import { createMapper } from '../../src/layers/L2-mapper';
import { createVerifier, ResultStore } from '../../src/layers/L3-verifier';
import { LearningServiceStub } from '../../src/layers/L7-learning';
import type { Claim, FileChange } from '../../src/shared/types';
import { POSTGRES_AVAILABLE } from '../infra-guard';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe.skipIf(!POSTGRES_AVAILABLE)('E3 Cross-Layer Integration (L0 → L2 → L3)', () => {
  let pool: Pool;
  let repoId: string;

  // Real services
  let indexStore: IndexStore;
  let index: ReturnType<typeof createCodebaseIndex>;
  let mapper: ReturnType<typeof createMapper>;
  let verifier: ReturnType<typeof createVerifier>;
  let resultStore: ResultStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await initParser();

    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'e3-integration', 1, 'main', 'active')`,
      [repoId],
    );

    indexStore = new IndexStore(pool);
    index = createCodebaseIndex(pool);
    const learning = new LearningServiceStub();
    mapper = createMapper(pool, index, learning);
    verifier = createVerifier(pool, index, mapper);
    resultStore = new ResultStore(pool);
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
  });

  function insertClaim(overrides: Partial<Claim> & { claim_text: string; claim_type: string }): Promise<Claim> {
    return pool.query(
      `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
        extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING *`,
      [
        repoId,
        overrides.source_file ?? 'README.md',
        overrides.line_number ?? 1,
        overrides.claim_text,
        overrides.claim_type,
        overrides.testability ?? 'syntactic',
        JSON.stringify(overrides.extracted_value ?? {}),
        overrides.keywords ?? [],
        1.0,
        'regex',
      ],
    ).then((r) => ({
      ...r.rows[0],
      extracted_value: r.rows[0].extracted_value,
    }));
  }

  async function seedCodeFiles(files: Record<string, string>) {
    const changes: FileChange[] = Object.keys(files).map((f) => ({
      filename: f,
      status: 'added' as const,
      additions: 10,
      deletions: 0,
    }));
    await indexStore.updateFromDiff(repoId, changes, async (path) => files[path] ?? null);
  }

  // === Scenario 1: path_reference verified ===
  it('S1: path_reference → verified (file exists)', async () => {
    // Seed a code file
    await seedCodeFiles({ 'src/app.ts': 'export function main() {}\n' });

    // Create a claim referencing it
    const claim = await insertClaim({
      claim_text: 'See `src/app.ts`',
      claim_type: 'path_reference',
      extracted_value: { path: 'src/app.ts' },
    });

    // Map it
    const mappings = await mapper.mapClaim(repoId, claim);
    expect(mappings.length).toBeGreaterThanOrEqual(1);
    expect(mappings[0].code_file).toBe('src/app.ts');

    // Verify it
    const result = await verifier.verifyDeterministic(claim, mappings);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('src/app.ts');
    expect(result!.tier).toBe(1);
  });

  // === Scenario 2: path_reference drifted ===
  it('S2: path_reference → drifted (file missing)', async () => {
    // Seed a different file
    await seedCodeFiles({ 'src/other.ts': 'export function other() {}\n' });

    const claim = await insertClaim({
      claim_text: 'See `src/app.ts`',
      claim_type: 'path_reference',
      extracted_value: { path: 'src/app.ts' },
    });

    // Map: no direct reference found
    const mappings = await mapper.mapClaim(repoId, claim);
    expect(mappings).toHaveLength(0);

    // Verify: file doesn't exist → drifted
    const result = await verifier.verifyDeterministic(claim, mappings);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  // === Scenario 3: dependency_version mismatch ===
  it('S3: dependency_version → drifted (version mismatch)', async () => {
    // Seed package.json with express 5.0.0
    await seedCodeFiles({
      'package.json': JSON.stringify({
        name: 'test',
        dependencies: { express: '5.0.0' },
      }),
    });

    const claim = await insertClaim({
      claim_text: 'express 4.x',
      claim_type: 'dependency_version',
      extracted_value: { package: 'express', version: '4' },
    });

    // Map
    const mappings = await mapper.mapClaim(repoId, claim);
    expect(mappings.length).toBeGreaterThanOrEqual(1);

    // Verify: documented 4, actual 5.0.0 → drifted
    const result = await verifier.verifyDeterministic(claim, mappings);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
    expect(result!.reasoning).toContain('5.0.0');
  });

  // === Scenario 4: command drifted ===
  it('S4: command → drifted (script not found)', async () => {
    await seedCodeFiles({
      'package.json': JSON.stringify({
        name: 'test',
        scripts: { build: 'tsc' },
      }),
    });

    const claim = await insertClaim({
      claim_text: 'npm run test',
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'test' },
    });

    // Map: script 'test' doesn't exist in scripts
    const mappings = await mapper.mapClaim(repoId, claim);
    // Might be empty since script doesn't exist

    // Verify: script not found → drifted
    const result = await verifier.verifyDeterministic(claim, mappings);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  // === Scenario 5: command verified ===
  it('S5: command → verified (script exists)', async () => {
    await seedCodeFiles({
      'package.json': JSON.stringify({
        name: 'test',
        scripts: { test: 'vitest run' },
      }),
    });

    const claim = await insertClaim({
      claim_text: 'npm run test',
      claim_type: 'command',
      extracted_value: { runner: 'npm', script: 'test' },
    });

    const mappings = await mapper.mapClaim(repoId, claim);
    expect(mappings.length).toBeGreaterThanOrEqual(1);

    const result = await verifier.verifyDeterministic(claim, mappings);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  // === Scenario 6: Store + retrieve result ===
  it('S6: storeResult persists and getLatestResult retrieves', async () => {
    await seedCodeFiles({ 'src/app.ts': 'export function main() {}\n' });

    const claim = await insertClaim({
      claim_text: 'See `src/app.ts`',
      claim_type: 'path_reference',
      extracted_value: { path: 'src/app.ts' },
    });

    const mappings = await mapper.mapClaim(repoId, claim);
    const result = await verifier.verifyDeterministic(claim, mappings);
    expect(result).not.toBeNull();

    // Store
    await verifier.storeResult(result!);

    // Retrieve
    const latest = await resultStore.getLatestResult(claim.id);
    expect(latest).not.toBeNull();
    expect(latest!.verdict).toBe('verified');
    expect(latest!.claim_id).toBe(claim.id);

    // Claim should be updated
    const updatedClaim = await pool.query('SELECT verification_status FROM claims WHERE id = $1', [claim.id]);
    expect(updatedClaim.rows[0].verification_status).toBe('verified');
  });

  // === Scenario 7: Reverse index lookup ===
  it('S7: findClaimsByCodeFiles returns mapped claims', async () => {
    await seedCodeFiles({ 'src/app.ts': 'export function main() {}\n' });

    const claim = await insertClaim({
      claim_text: 'See `src/app.ts`',
      claim_type: 'path_reference',
      extracted_value: { path: 'src/app.ts' },
    });

    await mapper.mapClaim(repoId, claim);

    // Reverse lookup
    const affectedMappings = await mapper.findClaimsByCodeFiles(repoId, ['src/app.ts']);
    expect(affectedMappings.length).toBeGreaterThanOrEqual(1);
    expect(affectedMappings[0].claim_id).toBe(claim.id);
  });
});
