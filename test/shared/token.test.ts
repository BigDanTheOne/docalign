import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { generateRepoToken, validateToken } from '../../src/shared/token';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db';
import { POSTGRES_AVAILABLE } from '../infra-guard';


describe.skipIf(!POSTGRES_AVAILABLE)('(requires infra)', () => {
  const TEST_DB_URL =
    process.env.DATABASE_URL || 'postgres://docalign:docalign@localhost:5432/docalign_dev';

  let db: DatabaseClient;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);
  });

  afterAll(async () => {
    await db.end();
  });

  describe('generateRepoToken', () => {
    it('generates token with exactly 73 chars and docalign_ prefix', () => {
      const { token, hash } = generateRepoToken();
      expect(token.length).toBe(73);
      expect(token.startsWith('docalign_')).toBe(true);
      expect(hash.length).toBe(64); // SHA-256 hex
    });

    it('SHA-256 hash is deterministic for the same token', () => {
      const { token, hash } = generateRepoToken();
      const recomputed = crypto.createHash('sha256').update(token).digest('hex');
      expect(recomputed).toBe(hash);
    });

    it('generates unique tokens on each call', () => {
      const t1 = generateRepoToken();
      const t2 = generateRepoToken();
      expect(t1.token).not.toBe(t2.token);
      expect(t1.hash).not.toBe(t2.hash);
    });
  });

  describe('validateToken', () => {
    let repoId: string;
    let validToken: string;

    beforeAll(async () => {
      // Create a repo with a known token hash
      const { token, hash } = generateRepoToken();
      validToken = token;
      const result = await db.query<{ id: string }>(
        `INSERT INTO repos (github_owner, github_repo, github_installation_id, token_hash, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        ['tokentest-owner', 'tokentest-repo', 99999, hash, 'active'],
      );
      repoId = result.rows[0].id;
    });

    afterAll(async () => {
      await db.query('DELETE FROM repos WHERE github_owner = $1', ['tokentest-owner']);
    });

    it('returns true for valid token+repoId pair', async () => {
      const valid = await validateToken(validToken, repoId, db);
      expect(valid).toBe(true);
    });

    it('returns false for wrong repoId', async () => {
      const valid = await validateToken(validToken, '00000000-0000-0000-0000-000000000000', db);
      expect(valid).toBe(false);
    });

    it('returns false for malformed token (wrong prefix)', async () => {
      const valid = await validateToken('invalid_' + 'a'.repeat(64), repoId, db);
      expect(valid).toBe(false);
    });

    it('returns false for malformed token (wrong length)', async () => {
      const valid = await validateToken('docalign_tooshort', repoId, db);
      expect(valid).toBe(false);
    });
  });
});
