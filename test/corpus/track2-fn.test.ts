/**
 * Track 2 — Mutation Gate (False Negative detection)
 *
 * For each mutation file in the mutations/ directory:
 * - Apply the mutation to the tagged corpus in-memory
 * - Run the full pipeline
 * - Assert exactly the expected findings appear (no more, no fewer drifted)
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { initParser } from '../../src/layers/L0-codebase-index/ast-parser';
import { runCorpus } from './runner';
import { corpusExpect } from './matchers';
import type { MutationDef } from './types';
import { POSTGRES_AVAILABLE } from '../infra-guard';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const MUTATIONS_DIR = 'test/fixtures/corpora/synthetic-node/mutations';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

// Load all mutation files
function loadMutations(): MutationDef[] {
  try {
    return readdirSync(MUTATIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(MUTATIONS_DIR, f), 'utf8')) as MutationDef);
  } catch {
    // Mutations dir doesn't exist yet — return empty array so tests are skipped gracefully
    return [];
  }
}

const mutations = loadMutations();

/**
 * Insert a fresh repo row, run fn, then clean up the repo row.
 */
async function withFreshRepo(pool: Pool, fn: (repoId: string) => Promise<void>): Promise<void> {
  const repoId = randomUUID();
  await pool.query(
    `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
     VALUES ($1, 'corpus-test', $2, 1, 'main', 'active')`,
    [repoId, `synthetic-node-mut-${repoId.substring(0, 8)}`],
  );
  try {
    await fn(repoId);
  } finally {
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM scan_runs WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
  }
}

describe.skipIf(!POSTGRES_AVAILABLE)('Track 2 — FN gate: synthetic-node mutations', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await initParser();
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  if (mutations.length === 0) {
    it('skips: no mutation files found in mutations/ directory', () => {
      console.log(
        `[Track 2] No mutation files found in ${MUTATIONS_DIR}. ` +
          'Run bootstrap workflow (Section 9 of CORPUS-DESIGN.md) to generate mutations.',
      );
    });
    return;
  }

  describe.each(mutations)('mutation: $id', (mutation) => {
    it(
      mutation.description,
      async () => {
        await withFreshRepo(pool, async (repoId) => {
          const result = await runCorpus(CORPUS_PATH, {
            preTags: true,
            pool,
            repoId,
            mutations: [mutation],
          });

          corpusExpect(result.findings).toMatchExpectedFindings(mutation.expected_findings);
        });
      },
      60_000,
    );
  });
});
