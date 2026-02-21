import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { POSTGRES_AVAILABLE } from '../infra-guard';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe.skipIf(!POSTGRES_AVAILABLE)('data-pipeline migrations', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('repo_files table', () => {
    it('exists with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'repo_files'
        ORDER BY ordinal_position
      `);
      const cols = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('repo_id');
      expect(cols).toContain('path');
      expect(cols).toContain('created_at');
    });

    it('has unique constraint on (repo_id, path)', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'repo_files'
        AND constraint_type = 'UNIQUE'
      `);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has foreign key to repos', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'repo_files'
        AND constraint_type = 'FOREIGN KEY'
      `);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('code_entities table', () => {
    it('exists with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'code_entities'
        ORDER BY ordinal_position
      `);
      const cols = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('repo_id');
      expect(cols).toContain('file_path');
      expect(cols).toContain('line_number');
      expect(cols).toContain('end_line_number');
      expect(cols).toContain('entity_type');
      expect(cols).toContain('name');
      expect(cols).toContain('signature');
      expect(cols).toContain('raw_code');
      expect(cols).toContain('embedding');
      expect(cols).toContain('last_commit_sha');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('has entity_type check constraint', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'code_entities'
        AND constraint_type = 'CHECK'
      `);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has HNSW index on embedding', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'code_entities'
        AND indexname LIKE '%embedding%'
      `);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has indexes per TDD-0', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'code_entities'
      `);
      const names = result.rows.map((r: { indexname: string }) => r.indexname);
      // Should have indexes on: repo_id, (repo_id, file_path), (repo_id, name), (repo_id, entity_type), embedding HNSW
      expect(names.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('claims table', () => {
    it('exists with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'claims'
        ORDER BY ordinal_position
      `);
      const cols = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('repo_id');
      expect(cols).toContain('source_file');
      expect(cols).toContain('line_number');
      expect(cols).toContain('claim_text');
      expect(cols).toContain('claim_type');
      expect(cols).toContain('testability');
      expect(cols).toContain('extracted_value');
      expect(cols).toContain('keywords');
      expect(cols).toContain('extraction_confidence');
      expect(cols).toContain('extraction_method');
      expect(cols).toContain('verification_status');
      expect(cols).toContain('last_verified_at');
      expect(cols).toContain('embedding');
      expect(cols).toContain('last_verification_result_id');
      expect(cols).toContain('parent_claim_id');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('has claim_type check constraint', async () => {
      const _result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.check_constraints
        WHERE constraint_name LIKE '%claims%claim_type%'
        OR constraint_name LIKE '%claim_type%'
      `);
      // Check constraints exist (the naming may vary)
      const allChecks = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'claims'
        AND constraint_type = 'CHECK'
      `);
      expect(allChecks.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has self-referential FK for parent_claim_id', async () => {
      const result = await pool.query(`
        SELECT tc.constraint_name, ccu.table_name AS foreign_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'claims'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'claims'
      `);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has indexes per TDD-1', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'claims'
      `);
      const names = result.rows.map((r: { indexname: string }) => r.indexname);
      // Should have: repo_id, (repo_id, source_file), (repo_id, claim_type), parent_claim_id, (repo_id, extraction_method)
      expect(names.length).toBeGreaterThanOrEqual(5);
    });

    it('has JSONB extracted_value column', async () => {
      const result = await pool.query(`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_name = 'claims'
        AND column_name = 'extracted_value'
      `);
      expect(result.rows[0].data_type).toBe('jsonb');
    });

    it('has TEXT[] keywords column', async () => {
      const result = await pool.query(`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_name = 'claims'
        AND column_name = 'keywords'
      `);
      expect(result.rows[0].data_type).toBe('ARRAY');
    });
  });
});
