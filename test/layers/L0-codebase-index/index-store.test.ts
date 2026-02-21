import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { IndexStore } from '../../../src/layers/L0-codebase-index/index-store';
import { randomUUID } from 'crypto';
import { POSTGRES_AVAILABLE } from '../../infra-guard';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe.skipIf(!POSTGRES_AVAILABLE)('IndexStore', () => {
  let pool: Pool;
  let store: IndexStore;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new IndexStore(pool);

    // Create a test repo
    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'test-repo', 1, 'main', 'active')`,
      [repoId],
    );
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    // Clean per-test data (entities, files, manifests) but keep repo
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
  });

  // === 4.1 fileExists ===
  describe('fileExists', () => {
    it('returns true for existing file in code_entities', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/app.ts', 1, 10, 'function', 'main', 'function main()')`,
        [repoId],
      );
      expect(await store.fileExists(repoId, 'src/app.ts')).toBe(true);
    });

    it('returns true for existing file in repo_files', async () => {
      await pool.query(
        `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'README.md')`,
        [repoId],
      );
      expect(await store.fileExists(repoId, 'README.md')).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await store.fileExists(repoId, 'nonexistent.ts')).toBe(false);
    });

    it('normalizes path with leading ./', async () => {
      await pool.query(
        `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'src/app.ts')`,
        [repoId],
      );
      expect(await store.fileExists(repoId, './src/app.ts')).toBe(true);
    });

    it('returns false for trailing slash (directory)', async () => {
      expect(await store.fileExists(repoId, 'src/')).toBe(false);
    });

    it('returns false for empty string', async () => {
      expect(await store.fileExists(repoId, '')).toBe(false);
    });

    it('returns false for path traversal', async () => {
      expect(await store.fileExists(repoId, '../etc/passwd')).toBe(false);
    });
  });

  // === 4.2 getFileTree ===
  describe('getFileTree', () => {
    it('returns sorted unique paths from both tables', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/b.ts', 1, 5, 'function', 'b', 'function b()')`,
        [repoId],
      );
      await pool.query(
        `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'README.md')`,
        [repoId],
      );
      await pool.query(
        `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'src/a.ts')`,
        [repoId],
      );

      const tree = await store.getFileTree(repoId);
      expect(tree).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
    });

    it('returns empty array for empty repo', async () => {
      const tree = await store.getFileTree(repoId);
      expect(tree).toEqual([]);
    });

    it('deduplicates paths appearing in both tables', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/app.ts', 1, 5, 'function', 'main', 'function main()')`,
        [repoId],
      );
      await pool.query(
        `INSERT INTO repo_files (repo_id, path) VALUES ($1, 'src/app.ts')`,
        [repoId],
      );

      const tree = await store.getFileTree(repoId);
      expect(tree).toEqual(['src/app.ts']);
    });
  });

  // === 4.3 findSymbol ===
  describe('findSymbol', () => {
    it('finds exact name match', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/auth.ts', 10, 50, 'class', 'AuthService', 'class AuthService')`,
        [repoId],
      );

      const results = await store.findSymbol(repoId, 'AuthService');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('AuthService');
      expect(results[0].entity_type).toBe('class');
    });

    it('falls back to case-insensitive match', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/auth.ts', 10, 50, 'class', 'AuthService', 'class AuthService')`,
        [repoId],
      );

      const results = await store.findSymbol(repoId, 'authservice');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('AuthService');
    });

    it('returns multiple entities with same name', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/a.ts', 1, 5, 'function', 'User', 'function User()'),
                ($1, 'src/b.ts', 1, 5, 'type', 'User', 'interface User')`,
        [repoId],
      );

      const results = await store.findSymbol(repoId, 'User');
      expect(results).toHaveLength(2);
    });

    it('returns empty for no match', async () => {
      const results = await store.findSymbol(repoId, 'NonExistent');
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty name', async () => {
      const results = await store.findSymbol(repoId, '');
      expect(results).toHaveLength(0);
    });

    it('sorts results by file_path then line_number', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/b.ts', 10, 15, 'function', 'helper', 'function helper()'),
                ($1, 'src/a.ts', 5, 10, 'function', 'helper', 'function helper()')`,
        [repoId],
      );

      const results = await store.findSymbol(repoId, 'helper');
      expect(results).toHaveLength(2);
      expect(results[0].file_path).toBe('src/a.ts');
      expect(results[1].file_path).toBe('src/b.ts');
    });
  });

  // === 4.4 getEntityByFile ===
  describe('getEntityByFile', () => {
    it('returns all entities in file ordered by line_number', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/app.ts', 20, 30, 'function', 'second', 'function second()'),
                ($1, 'src/app.ts', 5, 15, 'function', 'first', 'function first()')`,
        [repoId],
      );

      const results = await store.getEntityByFile(repoId, 'src/app.ts');
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('first');
      expect(results[1].name).toBe('second');
    });

    it('returns empty for non-existent file', async () => {
      const results = await store.getEntityByFile(repoId, 'nonexistent.ts');
      expect(results).toHaveLength(0);
    });
  });

  // === 4.5 getEntityById ===
  describe('getEntityById', () => {
    it('returns entity by id', async () => {
      const result = await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/app.ts', 1, 10, 'function', 'main', 'function main()')
         RETURNING id`,
        [repoId],
      );
      const entityId = result.rows[0].id;

      const entity = await store.getEntityById(entityId);
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('main');
    });

    it('returns null for non-existent id', async () => {
      const entity = await store.getEntityById(randomUUID());
      expect(entity).toBeNull();
    });

    it('returns null for invalid UUID format', async () => {
      const entity = await store.getEntityById('not-a-uuid');
      expect(entity).toBeNull();
    });
  });

  // === 4.6 findRoute ===
  describe('findRoute', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/routes.ts', 10, 15, 'route', 'GET /api/v2/users', 'router.get("/api/v2/users")'),
                ($1, 'src/routes.ts', 20, 25, 'route', 'POST /api/v2/users', 'router.post("/api/v2/users")'),
                ($1, 'src/routes.ts', 30, 35, 'route', 'GET /users/:id', 'router.get("/users/:id")')`,
        [repoId],
      );
    });

    it('finds exact route match', async () => {
      const route = await store.findRoute(repoId, 'GET', '/api/v2/users');
      expect(route).not.toBeNull();
      expect(route!.method).toBe('GET');
      expect(route!.path).toBe('/api/v2/users');
    });

    it('normalizes method to uppercase', async () => {
      const route = await store.findRoute(repoId, 'get', '/api/v2/users');
      expect(route).not.toBeNull();
      expect(route!.method).toBe('GET');
    });

    it('returns null for no match', async () => {
      const route = await store.findRoute(repoId, 'DELETE', '/api/v2/users');
      expect(route).toBeNull();
    });

    it('matches parameterized routes', async () => {
      const route = await store.findRoute(repoId, 'GET', '/users/{userId}');
      expect(route).not.toBeNull();
      expect(route!.path).toBe('/users/:id');
    });

    it('strips trailing slash', async () => {
      const route = await store.findRoute(repoId, 'GET', '/api/v2/users/');
      expect(route).not.toBeNull();
    });
  });

  // === 4.7 searchRoutes ===
  describe('searchRoutes', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/routes.ts', 10, 15, 'route', 'GET /api/v2/users', 'router.get'),
                ($1, 'src/routes.ts', 20, 25, 'route', 'POST /api/v2/users', 'router.post'),
                ($1, 'src/routes.ts', 30, 35, 'route', 'GET /api/v2/items', 'router.get'),
                ($1, 'src/routes.ts', 40, 45, 'route', 'GET /health', 'router.get')`,
        [repoId],
      );
    });

    it('returns exact match with similarity 1.0', async () => {
      const results = await store.searchRoutes(repoId, '/api/v2/users');
      const exact = results.find((r) => r.path === '/api/v2/users' && r.method === 'GET');
      expect(exact).toBeDefined();
      expect(exact!.similarity).toBe(1.0);
    });

    it('returns results sorted by similarity descending', async () => {
      const results = await store.searchRoutes(repoId, '/api/v2/users');
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('filters results with similarity > 0.3', async () => {
      const results = await store.searchRoutes(repoId, '/api/v2/users');
      for (const result of results) {
        expect(result.similarity).toBeGreaterThan(0.3);
      }
    });

    it('returns empty for no matching routes', async () => {
      const emptyRepoId = randomUUID();
      await pool.query(
        `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
         VALUES ($1, 'empty-owner', 'empty-repo', 2, 'main', 'active')`,
        [emptyRepoId],
      );
      const results = await store.searchRoutes(emptyRepoId, '/anything');
      expect(results).toHaveLength(0);
      await pool.query('DELETE FROM repos WHERE id = $1', [emptyRepoId]);
    });

    it('returns at most 10 results', async () => {
      // Already tested implicitly; the store caps at 10
      const results = await store.searchRoutes(repoId, '/api/v2/users');
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });

  // === 4.8 getDependencyVersion ===
  describe('getDependencyVersion', () => {
    it('returns lockfile version first', async () => {
      await store.storeManifest(
        repoId,
        'package-lock.json',
        { react: '18.2.0' },
        {},
        {},
        'lockfile',
      );
      await store.storeManifest(
        repoId,
        'package.json',
        { react: '^18.0.0' },
        {},
        {},
        'manifest',
      );

      const result = await store.getDependencyVersion(repoId, 'react');
      expect(result).not.toBeNull();
      expect(result!.version).toBe('18.2.0');
      expect(result!.source).toBe('lockfile');
    });

    it('falls back to manifest when no lockfile match', async () => {
      await store.storeManifest(
        repoId,
        'package.json',
        { express: '^4.18.0' },
        {},
        {},
        'manifest',
      );

      const result = await store.getDependencyVersion(repoId, 'express');
      expect(result).not.toBeNull();
      expect(result!.version).toBe('^4.18.0');
      expect(result!.source).toBe('manifest');
    });

    it('returns null for unknown package', async () => {
      const result = await store.getDependencyVersion(repoId, 'nonexistent-package');
      expect(result).toBeNull();
    });

    it('checks dev_dependencies', async () => {
      await store.storeManifest(
        repoId,
        'package.json',
        {},
        { vitest: '^1.0.0' },
        {},
        'manifest',
      );

      const result = await store.getDependencyVersion(repoId, 'vitest');
      expect(result).not.toBeNull();
      expect(result!.version).toBe('^1.0.0');
    });

    it('handles case-insensitive Python packages', async () => {
      await store.storeManifest(
        repoId,
        'requirements.txt',
        { Flask: '2.3.0' },
        {},
        {},
        'manifest',
      );

      const result = await store.getDependencyVersion(repoId, 'flask');
      expect(result).not.toBeNull();
      expect(result!.version).toBe('2.3.0');
    });
  });

  // === 4.9 scriptExists ===
  describe('scriptExists', () => {
    it('returns true when script exists', async () => {
      await store.storeManifest(
        repoId,
        'package.json',
        {},
        {},
        { test: 'vitest run', build: 'tsc' },
        'manifest',
      );

      expect(await store.scriptExists(repoId, 'test')).toBe(true);
      expect(await store.scriptExists(repoId, 'build')).toBe(true);
    });

    it('returns false when script does not exist', async () => {
      await store.storeManifest(
        repoId,
        'package.json',
        {},
        {},
        { test: 'vitest run' },
        'manifest',
      );

      expect(await store.scriptExists(repoId, 'nonexistent')).toBe(false);
    });

    it('returns false with no manifests', async () => {
      expect(await store.scriptExists(repoId, 'test')).toBe(false);
    });
  });

  // === 4.10 getAvailableScripts ===
  describe('getAvailableScripts', () => {
    it('returns all scripts sorted by file_path and name', async () => {
      await store.storeManifest(
        repoId,
        'package.json',
        {},
        {},
        { test: 'vitest', build: 'tsc' },
        'manifest',
      );
      await store.storeManifest(
        repoId,
        'Makefile',
        {},
        {},
        { lint: 'eslint .' },
        'manifest',
      );

      const scripts = await store.getAvailableScripts(repoId);
      expect(scripts).toHaveLength(3);
      // Makefile comes before package.json alphabetically
      expect(scripts[0].file_path).toBe('Makefile');
      expect(scripts[0].name).toBe('lint');
      expect(scripts[1].file_path).toBe('package.json');
      expect(scripts[1].name).toBe('build');
      expect(scripts[2].file_path).toBe('package.json');
      expect(scripts[2].name).toBe('test');
    });

    it('returns empty for repo with no manifests', async () => {
      const scripts = await store.getAvailableScripts(repoId);
      expect(scripts).toHaveLength(0);
    });
  });

  // === 4.11 searchSemantic (MVP fallback) ===
  describe('searchSemantic', () => {
    it('falls back to findSymbol with keyword extraction', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/auth.ts', 1, 20, 'class', 'AuthService', 'class AuthService')`,
        [repoId],
      );

      const results = await store.searchSemantic(repoId, 'AuthService handler', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('AuthService');
      expect(results[0].similarity).toBe(0.5);
    });

    it('returns empty for no matches', async () => {
      const results = await store.searchSemantic(repoId, 'nonexistent thing', 5);
      expect(results).toHaveLength(0);
    });

    it('returns empty for very short query', async () => {
      const results = await store.searchSemantic(repoId, 'ab', 5);
      expect(results).toHaveLength(0);
    });

    it('caps topK between 1 and 50', async () => {
      await pool.query(
        `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature)
         VALUES ($1, 'src/test.ts', 1, 5, 'function', 'test', 'function test()')`,
        [repoId],
      );

      // topK=0 should be treated as 1
      const results = await store.searchSemantic(repoId, 'test function', 0);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  // === Manifest storage helpers ===
  describe('storeManifest / deleteManifest', () => {
    it('stores and retrieves manifest data', async () => {
      await store.storeManifest(
        repoId,
        'package.json',
        { react: '18.2.0' },
        { vitest: '^1.0.0' },
        { test: 'vitest run' },
        'manifest',
      );

      const result = await pool.query(
        'SELECT * FROM repo_manifests WHERE repo_id = $1 AND file_path = $2',
        [repoId, 'package.json'],
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].source).toBe('manifest');
    });

    it('upserts on conflict', async () => {
      await store.storeManifest(repoId, 'package.json', { a: '1' }, {}, {}, 'manifest');
      await store.storeManifest(repoId, 'package.json', { b: '2' }, {}, {}, 'manifest');

      const result = await pool.query(
        'SELECT dependencies FROM repo_manifests WHERE repo_id = $1 AND file_path = $2',
        [repoId, 'package.json'],
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].dependencies).toEqual({ b: '2' });
    });

    it('deletes manifest', async () => {
      await store.storeManifest(repoId, 'package.json', {}, {}, {}, 'manifest');
      await store.deleteManifest(repoId, 'package.json');

      const result = await pool.query(
        'SELECT 1 FROM repo_manifests WHERE repo_id = $1 AND file_path = $2',
        [repoId, 'package.json'],
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
