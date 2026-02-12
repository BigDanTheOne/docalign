import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { calculateHealthScore, updateCachedHealthScore } from '../../../src/layers/L5-reporter/health';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe('calculateHealthScore', () => {
  let pool: Pool;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'health-test', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
  });

  async function insertClaims(statuses: Array<{ status: string; file: string; type: string }>) {
    for (const s of statuses) {
      await pool.query(
        `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type,
           testability, extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
         VALUES ($1, $2, 1, 'test', $3, 'syntactic', '{}', '{}', 1.0, 'regex', $4)`,
        [repoId, s.file, s.type, s.status],
      );
    }
  }

  it('returns 100% health for all verified', async () => {
    await insertClaims([
      { status: 'verified', file: 'README.md', type: 'path_reference' },
      { status: 'verified', file: 'README.md', type: 'command' },
      { status: 'verified', file: 'docs/api.md', type: 'api_route' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    expect(health.score).toBe(1);
    expect(health.verified).toBe(3);
    expect(health.drifted).toBe(0);
    expect(health.total_claims).toBe(3);
    expect(health.hotspots).toHaveLength(0);
  });

  it('returns 0% health for all drifted', async () => {
    await insertClaims([
      { status: 'drifted', file: 'README.md', type: 'path_reference' },
      { status: 'drifted', file: 'README.md', type: 'command' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    expect(health.score).toBe(0);
    expect(health.drifted).toBe(2);
    expect(health.verified).toBe(0);
  });

  it('returns correct ratio for mixed statuses', async () => {
    await insertClaims([
      { status: 'verified', file: 'README.md', type: 'path_reference' },
      { status: 'verified', file: 'README.md', type: 'command' },
      { status: 'verified', file: 'docs/api.md', type: 'api_route' },
      { status: 'drifted', file: 'docs/api.md', type: 'dependency_version' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    expect(health.score).toBe(0.75); // 3 / (3 + 1)
    expect(health.verified).toBe(3);
    expect(health.drifted).toBe(1);
  });

  it('returns 0 for empty repo (no claims)', async () => {
    const health = await calculateHealthScore(pool, repoId);
    expect(health.score).toBe(0);
    expect(health.total_claims).toBe(0);
    expect(health.by_file).toHaveLength(0);
    expect(health.hotspots).toHaveLength(0);
  });

  it('ignores uncertain and pending from score formula', async () => {
    await insertClaims([
      { status: 'verified', file: 'README.md', type: 'path_reference' },
      { status: 'uncertain', file: 'README.md', type: 'command' },
      { status: 'pending', file: 'README.md', type: 'api_route' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    // score = 1 / (1 + 0) = 1
    expect(health.score).toBe(1);
    expect(health.uncertain).toBe(1);
    expect(health.pending).toBe(1);
  });

  it('computes per-file breakdown', async () => {
    await insertClaims([
      { status: 'verified', file: 'README.md', type: 'path_reference' },
      { status: 'drifted', file: 'README.md', type: 'command' },
      { status: 'verified', file: 'docs/api.md', type: 'api_route' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    expect(health.by_file.length).toBe(2);

    const readme = health.by_file.find((f) => f.file === 'README.md');
    expect(readme).toBeDefined();
    expect(readme!.verified).toBe(1);
    expect(readme!.drifted).toBe(1);
  });

  it('computes per-type breakdown', async () => {
    await insertClaims([
      { status: 'verified', file: 'README.md', type: 'path_reference' },
      { status: 'drifted', file: 'README.md', type: 'path_reference' },
      { status: 'verified', file: 'README.md', type: 'command' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    expect(health.by_type['path_reference']).toBeDefined();
    expect(health.by_type['path_reference'].verified).toBe(1);
    expect(health.by_type['path_reference'].drifted).toBe(1);
    expect(health.by_type['command']).toBeDefined();
    expect(health.by_type['command'].verified).toBe(1);
  });

  it('computes hotspots (top 10 files by drifted)', async () => {
    await insertClaims([
      { status: 'drifted', file: 'a.md', type: 'path_reference' },
      { status: 'drifted', file: 'a.md', type: 'command' },
      { status: 'drifted', file: 'a.md', type: 'api_route' },
      { status: 'drifted', file: 'b.md', type: 'path_reference' },
      { status: 'drifted', file: 'b.md', type: 'command' },
      { status: 'drifted', file: 'c.md', type: 'path_reference' },
      { status: 'verified', file: 'd.md', type: 'path_reference' },
    ]);

    const health = await calculateHealthScore(pool, repoId);
    expect(health.hotspots.length).toBe(3); // a, b, c have drifted
    expect(health.hotspots[0].file).toBe('a.md'); // most drifted
    expect(health.hotspots[0].drifted).toBe(3);
    expect(health.hotspots[1].file).toBe('b.md');
    expect(health.hotspots[1].drifted).toBe(2);
  });

  it('updateCachedHealthScore persists to repos table', async () => {
    await insertClaims([
      { status: 'verified', file: 'README.md', type: 'path_reference' },
      { status: 'verified', file: 'README.md', type: 'command' },
      { status: 'drifted', file: 'README.md', type: 'api_route' },
    ]);

    const health = await updateCachedHealthScore(pool, repoId);
    expect(health.score).toBeCloseTo(2 / 3, 2);

    const repo = await pool.query('SELECT health_score, verified_claims, total_claims FROM repos WHERE id = $1', [repoId]);
    expect(repo.rows[0].health_score).toBeCloseTo(2 / 3, 2);
    expect(repo.rows[0].verified_claims).toBe(2);
    expect(repo.rows[0].total_claims).toBe(3);
  });
});
