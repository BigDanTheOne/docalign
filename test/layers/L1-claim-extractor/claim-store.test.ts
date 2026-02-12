import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { ClaimStore, rawToClaim } from '../../../src/layers/L1-claim-extractor/claim-store';
import type { RawExtraction } from '../../../src/shared/types';
import { randomUUID } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe('ClaimStore', () => {
  let pool: Pool;
  let store: ClaimStore;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new ClaimStore(pool);

    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'claim-store-test', 1, 'main', 'active')`,
      [repoId],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
  });

  async function insertTestClaim(sourceFile: string, lineNumber: number, claimType: string, extractedValue: Record<string, unknown>) {
    const result = await pool.query(
      `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
        extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
       VALUES ($1, $2, $3, $4, $5, 'syntactic', $6, $7, 1.0, 'regex', 'pending')
       RETURNING id`,
      [repoId, sourceFile, lineNumber, `test claim at line ${lineNumber}`, claimType,
       JSON.stringify(extractedValue), ['test']],
    );
    return result.rows[0].id as string;
  }

  // === 4.2 getClaimsByFile ===
  describe('getClaimsByFile', () => {
    it('returns claims for a file ordered by line_number', async () => {
      await insertTestClaim('README.md', 10, 'path_reference', { path: 'src/a.ts' });
      await insertTestClaim('README.md', 5, 'command', { runner: 'npm', script: 'test' });
      await insertTestClaim('OTHER.md', 1, 'path_reference', { path: 'src/b.ts' });

      const claims = await store.getClaimsByFile(repoId, 'README.md');
      expect(claims).toHaveLength(2);
      expect(claims[0].line_number).toBe(5);
      expect(claims[1].line_number).toBe(10);
    });

    it('returns empty for no claims', async () => {
      const claims = await store.getClaimsByFile(repoId, 'nonexistent.md');
      expect(claims).toHaveLength(0);
    });
  });

  // === 4.3 getClaimsByRepo ===
  describe('getClaimsByRepo', () => {
    it('returns all claims for a repo', async () => {
      await insertTestClaim('README.md', 5, 'path_reference', { path: 'src/a.ts' });
      await insertTestClaim('docs/api.md', 1, 'api_route', { method: 'GET', path: '/users' });

      const claims = await store.getClaimsByRepo(repoId);
      expect(claims).toHaveLength(2);
      const files = claims.map((c) => c.source_file);
      expect(files).toContain('README.md');
      expect(files).toContain('docs/api.md');
    });
  });

  // === 4.4 getClaimById ===
  describe('getClaimById', () => {
    it('returns claim by id', async () => {
      const id = await insertTestClaim('README.md', 1, 'path_reference', { path: 'src/a.ts' });
      const claim = await store.getClaimById(id);
      expect(claim).not.toBeNull();
      expect(claim!.source_file).toBe('README.md');
    });

    it('returns null for non-existent id', async () => {
      const claim = await store.getClaimById(randomUUID());
      expect(claim).toBeNull();
    });

    it('returns null for invalid UUID', async () => {
      const claim = await store.getClaimById('not-a-uuid');
      expect(claim).toBeNull();
    });
  });

  // === 4.7 updateVerificationStatus ===
  describe('updateVerificationStatus', () => {
    it('updates status to verified', async () => {
      const id = await insertTestClaim('README.md', 1, 'path_reference', { path: 'src/a.ts' });
      await store.updateVerificationStatus(id, 'verified');
      const claim = await store.getClaimById(id);
      expect(claim!.verification_status).toBe('verified');
      expect(claim!.last_verified_at).not.toBeNull();
    });

    it('updates status to drifted', async () => {
      const id = await insertTestClaim('README.md', 1, 'path_reference', { path: 'src/a.ts' });
      await store.updateVerificationStatus(id, 'drifted');
      const claim = await store.getClaimById(id);
      expect(claim!.verification_status).toBe('drifted');
    });

    it('resets to pending without updating last_verified_at', async () => {
      const id = await insertTestClaim('README.md', 1, 'path_reference', { path: 'src/a.ts' });
      await store.updateVerificationStatus(id, 'verified');
      const afterVerify = await store.getClaimById(id);
      const verifiedAt = afterVerify!.last_verified_at;

      await store.updateVerificationStatus(id, 'pending');
      const afterReset = await store.getClaimById(id);
      expect(afterReset!.verification_status).toBe('pending');
      // last_verified_at preserved from previous verification
      expect(afterReset!.last_verified_at?.getTime()).toBe(verifiedAt?.getTime());
    });
  });

  // === Batch insert ===
  describe('batchInsertClaims', () => {
    it('inserts multiple claims', async () => {
      const inserts = [
        rawToClaim(repoId, 'README.md', {
          claim_text: 'See src/a.ts',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 1,
          pattern_name: 'backtick_path',
        }),
        rawToClaim(repoId, 'README.md', {
          claim_text: 'npm test',
          claim_type: 'command',
          extracted_value: { type: 'command', runner: 'npm', script: 'test' },
          line_number: 5,
          pattern_name: 'code_block_command',
        }),
      ];

      const claims = await store.batchInsertClaims(inserts);
      expect(claims).toHaveLength(2);
      expect(claims[0].claim_type).toBe('path_reference');
      expect(claims[1].claim_type).toBe('command');
    });

    it('returns empty for empty input', async () => {
      const claims = await store.batchInsertClaims([]);
      expect(claims).toHaveLength(0);
    });
  });

  // === 4.5 reExtract ===
  describe('reExtract', () => {
    it('detects added claims', async () => {
      const newExtractions: RawExtraction[] = [
        {
          claim_text: 'See src/a.ts',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 1,
          pattern_name: 'backtick_path',
        },
      ];

      const result = await store.reExtract(repoId, 'README.md', newExtractions);
      expect(result.added).toHaveLength(1);
      expect(result.updated).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('detects removed claims', async () => {
      await insertTestClaim('README.md', 1, 'path_reference', { type: 'path_reference', path: 'src/old.ts' });

      const result = await store.reExtract(repoId, 'README.md', []);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(1);
    });

    it('detects updated claims (line changed)', async () => {
      await insertTestClaim('README.md', 1, 'path_reference', { type: 'path_reference', path: 'src/a.ts' });

      const newExtractions: RawExtraction[] = [
        {
          claim_text: 'See src/a.ts moved',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 5, // different line
          pattern_name: 'backtick_path',
        },
      ];

      const result = await store.reExtract(repoId, 'README.md', newExtractions);
      expect(result.added).toHaveLength(0);
      expect(result.updated).toHaveLength(1);
      expect(result.removed).toHaveLength(0);
      // ID preserved
      expect(result.updated[0].line_number).toBe(5);
    });

    it('excludes LLM-sourced claims from diff', async () => {
      // Insert an LLM-sourced claim
      await pool.query(
        `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
          extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
         VALUES ($1, 'README.md', 1, 'LLM claim', 'behavior', 'semantic', '{}', '{}', 0.8, 'llm', 'pending')`,
        [repoId],
      );

      // reExtract with no syntactic claims should not remove the LLM claim
      const result = await store.reExtract(repoId, 'README.md', []);
      expect(result.removed).toHaveLength(0); // LLM claim not touched
    });
  });

  // === 4.6 deleteClaimsForFile ===
  describe('deleteClaimsForFile', () => {
    it('deletes all claims for a file and returns count', async () => {
      await insertTestClaim('README.md', 1, 'path_reference', { path: 'src/a.ts' });
      await insertTestClaim('README.md', 5, 'command', { runner: 'npm', script: 'test' });
      await insertTestClaim('OTHER.md', 1, 'path_reference', { path: 'src/b.ts' });

      const count = await store.deleteClaimsForFile(repoId, 'README.md');
      expect(count).toBe(2);

      // Other file untouched
      const remaining = await store.getClaimsByFile(repoId, 'OTHER.md');
      expect(remaining).toHaveLength(1);
    });

    it('returns 0 for file with no claims', async () => {
      const count = await store.deleteClaimsForFile(repoId, 'nonexistent.md');
      expect(count).toBe(0);
    });
  });

  // === rawToClaim helper ===
  describe('rawToClaim', () => {
    it('converts RawExtraction to ClaimInsert with keywords', () => {
      const extraction: RawExtraction = {
        claim_text: 'See src/auth/handler.ts',
        claim_type: 'path_reference',
        extracted_value: { type: 'path_reference', path: 'src/auth/handler.ts' },
        line_number: 5,
        pattern_name: 'backtick_path',
      };
      const claim = rawToClaim('repo-1', 'README.md', extraction);
      expect(claim.repo_id).toBe('repo-1');
      expect(claim.source_file).toBe('README.md');
      expect(claim.extraction_method).toBe('regex');
      expect(claim.extraction_confidence).toBe(1.0);
      expect(claim.keywords.length).toBeGreaterThan(0);
    });
  });
});
