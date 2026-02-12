import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { IndexStore, computeEntityDiff } from '../../../src/layers/L0-codebase-index/index-store';
import { initParser } from '../../../src/layers/L0-codebase-index/ast-parser';
import type { CodeEntity, FileChange, ParsedEntity } from '../../../src/shared/types';
import { randomUUID } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe('computeEntityDiff', () => {
  it('detects added entities', () => {
    const existing: CodeEntity[] = [];
    const parsed: ParsedEntity[] = [
      { name: 'hello', entity_type: 'function', line_number: 1, end_line_number: 5, signature: 'function hello()', raw_code: 'function hello() {}' },
    ];
    const diff = computeEntityDiff(existing, parsed);
    expect(diff.added).toHaveLength(1);
    expect(diff.updated).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('detects removed entities', () => {
    const existing: CodeEntity[] = [
      { id: 'e1', repo_id: 'r1', file_path: 'a.ts', line_number: 1, end_line_number: 5, entity_type: 'function', name: 'old', signature: 'function old()', embedding: null, raw_code: '', last_commit_sha: '', created_at: new Date(), updated_at: new Date() },
    ];
    const parsed: ParsedEntity[] = [];
    const diff = computeEntityDiff(existing, parsed);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toEqual(['e1']);
  });

  it('detects updated entities (signature changed)', () => {
    const existing: CodeEntity[] = [
      { id: 'e1', repo_id: 'r1', file_path: 'a.ts', line_number: 1, end_line_number: 5, entity_type: 'function', name: 'hello', signature: 'function hello(a: string)', embedding: null, raw_code: 'function hello(a: string) {}', last_commit_sha: '', created_at: new Date(), updated_at: new Date() },
    ];
    const parsed: ParsedEntity[] = [
      { name: 'hello', entity_type: 'function', line_number: 1, end_line_number: 5, signature: 'function hello(a: string, b: number)', raw_code: 'function hello(a: string, b: number) {}' },
    ];
    const diff = computeEntityDiff(existing, parsed);
    // Different param count = different key, so treated as add + remove
    expect(diff.added.length + diff.removed.length).toBeGreaterThan(0);
  });

  it('detects updated entities (line changed)', () => {
    const existing: CodeEntity[] = [
      { id: 'e1', repo_id: 'r1', file_path: 'a.ts', line_number: 1, end_line_number: 5, entity_type: 'function', name: 'hello', signature: 'function hello()', embedding: null, raw_code: 'function hello() {}', last_commit_sha: '', created_at: new Date(), updated_at: new Date() },
    ];
    const parsed: ParsedEntity[] = [
      { name: 'hello', entity_type: 'function', line_number: 10, end_line_number: 15, signature: 'function hello()', raw_code: 'function hello() {}' },
    ];
    const diff = computeEntityDiff(existing, parsed);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].old_id).toBe('e1');
    expect(diff.updated[0].signature_changed).toBe(false);
  });

  it('detects no changes when entities match', () => {
    const existing: CodeEntity[] = [
      { id: 'e1', repo_id: 'r1', file_path: 'a.ts', line_number: 1, end_line_number: 5, entity_type: 'function', name: 'hello', signature: 'function hello()', embedding: null, raw_code: 'function hello() {}', last_commit_sha: '', created_at: new Date(), updated_at: new Date() },
    ];
    const parsed: ParsedEntity[] = [
      { name: 'hello', entity_type: 'function', line_number: 1, end_line_number: 5, signature: 'function hello()', raw_code: 'function hello() {}' },
    ];
    const diff = computeEntityDiff(existing, parsed);
    expect(diff.added).toHaveLength(0);
    expect(diff.updated).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });
});

describe('IndexStore.updateFromDiff', () => {
  let pool: Pool;
  let store: IndexStore;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new IndexStore(pool);
    await initParser();

    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'diff-test', 1, 'main', 'active')`,
      [repoId],
    );
  }, 30_000);

  afterAll(async () => {
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
  });

  it('handles empty changedFiles', async () => {
    const result = await store.updateFromDiff(repoId, [], async () => null);
    expect(result.entities_added).toBe(0);
    expect(result.entities_updated).toBe(0);
    expect(result.entities_removed).toBe(0);
    expect(result.files_skipped).toHaveLength(0);
  });

  it('adds entities for new code files', async () => {
    const changes: FileChange[] = [
      { filename: 'src/app.ts', status: 'added', additions: 3, deletions: 0 },
    ];

    const fetchContent = async (filePath: string) => {
      if (filePath === 'src/app.ts') {
        return 'export function main() {}\nexport class App {}\n';
      }
      return null;
    };

    const result = await store.updateFromDiff(repoId, changes, fetchContent);
    expect(result.entities_added).toBeGreaterThanOrEqual(2);

    // File should appear in file tree
    const tree = await store.getFileTree(repoId);
    expect(tree).toContain('src/app.ts');
  });

  it('removes entities for deleted code files', async () => {
    // Pre-insert entities
    await pool.query(
      `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
       VALUES ($1, 'src/old.ts', 1, 5, 'function', 'old', 'function old()')`,
      [repoId],
    );
    await pool.query(
      `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'src/old.ts')`,
      [repoId],
    );

    const changes: FileChange[] = [
      { filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 5 },
    ];

    const result = await store.updateFromDiff(repoId, changes, async () => null);
    expect(result.entities_removed).toBe(1);

    const tree = await store.getFileTree(repoId);
    expect(tree).not.toContain('src/old.ts');
  });

  it('skips non-code files', async () => {
    const changes: FileChange[] = [
      { filename: 'README.md', status: 'added', additions: 10, deletions: 0 },
    ];

    const result = await store.updateFromDiff(repoId, changes, async () => '# README\n');
    expect(result.files_skipped).toContain('README.md');
  });

  it('processes manifest files', async () => {
    const changes: FileChange[] = [
      { filename: 'package.json', status: 'added', additions: 5, deletions: 0 },
    ];

    const fetchContent = async (filePath: string) => {
      if (filePath === 'package.json') {
        return JSON.stringify({
          name: 'test-pkg',
          dependencies: { express: '^4.18.0' },
          scripts: { test: 'vitest run' },
        });
      }
      return null;
    };

    await store.updateFromDiff(repoId, changes, fetchContent);

    // Should be able to look up the dependency
    const dep = await store.getDependencyVersion(repoId, 'express');
    expect(dep).not.toBeNull();
    expect(dep!.version).toBe('^4.18.0');
  });

  it('handles file renames', async () => {
    // Pre-insert entity
    await pool.query(
      `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
       VALUES ($1, 'src/old-name.ts', 1, 5, 'function', 'hello', 'function hello()')`,
      [repoId],
    );
    await pool.query(
      `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'src/old-name.ts')`,
      [repoId],
    );

    const changes: FileChange[] = [
      { filename: 'src/new-name.ts', status: 'renamed', previous_filename: 'src/old-name.ts', additions: 0, deletions: 0 },
    ];

    const fetchContent = async (filePath: string) => {
      if (filePath === 'src/new-name.ts') {
        return 'export function hello() {}\n';
      }
      return null;
    };

    const result = await store.updateFromDiff(repoId, changes, fetchContent);

    // Entity should be at new path
    const entities = await store.getEntityByFile(repoId, 'src/new-name.ts');
    expect(entities.length).toBeGreaterThanOrEqual(1);

    // Old path should be empty
    const oldEntities = await store.getEntityByFile(repoId, 'src/old-name.ts');
    expect(oldEntities).toHaveLength(0);
  });

  it('handles large file skip', async () => {
    const changes: FileChange[] = [
      { filename: 'src/big.ts', status: 'added', additions: 50000, deletions: 0 },
    ];

    const fetchContent = async (filePath: string) => {
      if (filePath === 'src/big.ts') {
        return 'export function a() {}\n'.repeat(100000); // >1MB
      }
      return null;
    };

    const result = await store.updateFromDiff(repoId, changes, fetchContent);
    expect(result.files_skipped).toContain('src/big.ts');
  });
});
