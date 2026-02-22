/**
 * Track 1 — Zero-Finding Gate
 *
 * Run the full pipeline on the synthetic-node tagged corpus.
 * Assert zero drifted findings (false positive gate).
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { initParser } from '../../src/layers/L0-codebase-index/ast-parser';
import { runCorpus } from './runner';
import { corpusExpect } from './matchers';
import { POSTGRES_AVAILABLE } from '../infra-guard';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe.skipIf(!POSTGRES_AVAILABLE)('Track 1 — FP gate: synthetic-node', () => {
  let pool: Pool;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await initParser();
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'corpus-test', 'synthetic-node', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    // Cleanup in dependency order
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

  it('produces zero drifted findings on clean tagged corpus', async () => {
    const result = await runCorpus(CORPUS_PATH, { preTags: true, pool, repoId });
    const drifted = result.findings.filter((f) => f.verdict === 'drifted');
    corpusExpect(drifted).toHaveLength(0);
  }, 60_000);
});
