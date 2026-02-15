import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getUndocumentedEntities } from '../../../src/layers/L5-reporter/coverage';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe('getUndocumentedEntities', () => {
  let pool: Pool;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [repoId, 'test', 'coverage-test', 12345, 'main', 'active'],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
  });

  it('returns entities without claim mappings', async () => {
    const entityId = randomUUID();
    await pool.query(
      `INSERT INTO code_entities (id, repo_id, file_path, line_number, end_line_number, entity_type, name, signature, raw_code, last_commit_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [entityId, repoId, 'src/auth.ts', 1, 10, 'function', 'authenticate', 'function authenticate()', 'function authenticate() {}', 'abc123'],
    );

    const result = await getUndocumentedEntities(pool, repoId);
    expect(result.length).toBe(1);
    expect(result[0].entity.name).toBe('authenticate');
    expect(result[0].suggested_doc_file).toBe('src/README.md');
  });

  it('excludes entities that have claim mappings', async () => {
    const entityId = randomUUID();
    const claimId = randomUUID();
    await pool.query(
      `INSERT INTO code_entities (id, repo_id, file_path, line_number, end_line_number, entity_type, name, signature, raw_code, last_commit_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [entityId, repoId, 'src/auth.ts', 1, 10, 'function', 'authenticate', 'function authenticate()', 'function authenticate() {}', 'abc123'],
    );
    await pool.query(
      `INSERT INTO claims (id, repo_id, source_file, line_number, claim_text, claim_type, testability, extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [claimId, repoId, 'README.md', 1, 'Uses authenticate()', 'code_example', 'syntactic', '{}', '{}', 1.0, 'regex', 'pending'],
    );
    await pool.query(
      `INSERT INTO claim_mappings (id, repo_id, claim_id, code_file, code_entity_id, mapping_method, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), repoId, claimId, 'src/auth.ts', entityId, 'direct_reference', 0.9],
    );

    const result = await getUndocumentedEntities(pool, repoId);
    expect(result.length).toBe(0);
  });

  it('filters out private/internal entities', async () => {
    const publicId = randomUUID();
    const privateId = randomUUID();
    await pool.query(
      `INSERT INTO code_entities (id, repo_id, file_path, line_number, end_line_number, entity_type, name, signature, raw_code, last_commit_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [publicId, repoId, 'src/api.ts', 1, 10, 'function', 'getUser', 'function getUser()', 'function getUser() {}', 'abc123'],
    );
    await pool.query(
      `INSERT INTO code_entities (id, repo_id, file_path, line_number, end_line_number, entity_type, name, signature, raw_code, last_commit_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [privateId, repoId, 'src/api.ts', 20, 30, 'function', '_internalHelper', 'function _internalHelper()', 'function _internalHelper() {}', 'abc123'],
    );

    const result = await getUndocumentedEntities(pool, repoId);
    expect(result.length).toBe(1);
    expect(result[0].entity.name).toBe('getUser');
  });

  it('returns empty array when no entities exist', async () => {
    const result = await getUndocumentedEntities(pool, repoId);
    expect(result).toEqual([]);
  });
});
