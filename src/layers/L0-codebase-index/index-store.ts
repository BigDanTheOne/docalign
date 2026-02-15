import type { Pool, PoolClient } from 'pg';
import type {
  CodeEntity,
  DependencyVersion,
  ParsedManifest,
  RouteEntity,
  ScriptInfo,
  CodeEntityRow,
  FileChange,
  IndexUpdateResult,
  ParsedEntity,
} from '../../shared/types';
import { parseFile, detectLanguage, isSupportedCodeFile, isManifestFile } from './ast-parser';
import { parseManifest } from './manifest-parser';

/**
 * L0 Codebase Index Store.
 * Provides lookup APIs for code entities, files, routes, dependencies, and scripts.
 * TDD-0 Sections 4.1 through 4.11.
 */
export class IndexStore {
  constructor(private pool: Pool) {}

  // === 4.1 fileExists ===

  async fileExists(repoId: string, path: string): Promise<boolean> {
    if (!path || path.endsWith('/')) return false;
    const normalized = normalizePath(path);
    if (!normalized) return false;

    // Check code_entities
    const entityResult = await this.pool.query(
      'SELECT 1 FROM code_entities WHERE repo_id = $1 AND file_path = $2 LIMIT 1',
      [repoId, normalized],
    );
    if (entityResult.rowCount && entityResult.rowCount > 0) return true;

    // Check repo_files
    const fileResult = await this.pool.query(
      'SELECT 1 FROM repo_files WHERE repo_id = $1 AND path = $2 LIMIT 1',
      [repoId, normalized],
    );
    return (fileResult.rowCount ?? 0) > 0;
  }

  // === 4.2 getFileTree ===

  async getFileTree(repoId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT path FROM (
        SELECT file_path AS path FROM code_entities WHERE repo_id = $1
        UNION
        SELECT path FROM repo_files WHERE repo_id = $1
      ) AS all_files
      ORDER BY path`,
      [repoId],
    );
    return result.rows.map((r: { path: string }) => r.path);
  }

  // === 4.3 findSymbol ===

  async findSymbol(repoId: string, name: string): Promise<CodeEntity[]> {
    if (!name) return [];

    // Exact match first
    let result = await this.pool.query(
      'SELECT * FROM code_entities WHERE repo_id = $1 AND name = $2 ORDER BY file_path, line_number',
      [repoId, name],
    );

    // Fall back to case-insensitive
    if (result.rowCount === 0) {
      result = await this.pool.query(
        'SELECT * FROM code_entities WHERE repo_id = $1 AND LOWER(name) = LOWER($2) ORDER BY file_path, line_number',
        [repoId, name],
      );
    }

    return result.rows.map(rowToCodeEntity);
  }

  // === 4.4 getEntityByFile ===

  async getEntityByFile(repoId: string, filePath: string): Promise<CodeEntity[]> {
    const result = await this.pool.query(
      'SELECT * FROM code_entities WHERE repo_id = $1 AND file_path = $2 ORDER BY line_number',
      [repoId, filePath],
    );
    return result.rows.map(rowToCodeEntity);
  }

  // === 4.5 getEntityById ===

  async getEntityById(entityId: string): Promise<CodeEntity | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM code_entities WHERE id = $1',
        [entityId],
      );
      if (result.rowCount === 0) return null;
      return rowToCodeEntity(result.rows[0]);
    } catch {
      // Invalid UUID format
      return null;
    }
  }

  // === 4.6 findRoute ===

  async findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null> {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = normalizeRoutePath(path);
    const routeName = `${normalizedMethod} ${normalizedPath}`;

    // Exact match
    const result = await this.pool.query(
      `SELECT * FROM code_entities WHERE repo_id = $1 AND entity_type = 'route' AND name = $2 LIMIT 1`,
      [repoId, routeName],
    );

    if (result.rowCount && result.rowCount > 0) {
      return entityToRoute(result.rows[0]);
    }

    // Try parameterized match
    const allRoutes = await this.pool.query(
      `SELECT * FROM code_entities WHERE repo_id = $1 AND entity_type = 'route'`,
      [repoId],
    );

    for (const row of allRoutes.rows) {
      const [rowMethod, ...rowPathParts] = (row.name as string).split(' ');
      const rowPath = rowPathParts.join(' ');
      if (rowMethod !== normalizedMethod && rowMethod !== 'ALL') continue;

      if (pathMatchesParameterized(normalizedPath, rowPath)) {
        return entityToRoute(row);
      }
    }

    return null;
  }

  // === 4.7 searchRoutes ===

  async searchRoutes(
    repoId: string,
    path: string,
  ): Promise<Array<{ method: string; path: string; file: string; line: number; similarity: number }>> {
    const allRoutes = await this.pool.query(
      `SELECT * FROM code_entities WHERE repo_id = $1 AND entity_type = 'route'`,
      [repoId],
    );

    const results: Array<{ method: string; path: string; file: string; line: number; similarity: number }> = [];

    for (const row of allRoutes.rows) {
      const [method, ...pathParts] = (row.name as string).split(' ');
      const routePath = pathParts.join(' ');
      const similarity = computePathSimilarity(path, routePath);

      if (similarity > 0.3) {
        results.push({
          method,
          path: routePath,
          file: row.file_path as string,
          line: row.line_number as number,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, 10);
  }

  // === 4.8 getDependencyVersion ===

  async getDependencyVersion(
    repoId: string,
    packageName: string,
  ): Promise<DependencyVersion | null> {
    // Check lockfiles first
    const lockfileResult = await this.pool.query(
      `SELECT dependencies, dev_dependencies FROM repo_manifests
       WHERE repo_id = $1 AND source = 'lockfile'
       ORDER BY file_path`,
      [repoId],
    );

    for (const row of lockfileResult.rows) {
      const deps = row.dependencies as Record<string, string>;
      const devDeps = row.dev_dependencies as Record<string, string>;
      const version = findPackageVersion(deps, packageName) ?? findPackageVersion(devDeps, packageName);
      if (version) return { version, source: 'lockfile' };
    }

    // Check manifests
    const manifestResult = await this.pool.query(
      `SELECT dependencies, dev_dependencies FROM repo_manifests
       WHERE repo_id = $1 AND source = 'manifest'
       ORDER BY file_path`,
      [repoId],
    );

    for (const row of manifestResult.rows) {
      const deps = row.dependencies as Record<string, string>;
      const devDeps = row.dev_dependencies as Record<string, string>;
      const version = findPackageVersion(deps, packageName) ?? findPackageVersion(devDeps, packageName);
      if (version) return { version, source: 'manifest' };
    }

    return null;
  }

  // === 4.9 scriptExists ===

  async scriptExists(repoId: string, scriptName: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT scripts FROM repo_manifests WHERE repo_id = $1`,
      [repoId],
    );

    for (const row of result.rows) {
      const scripts = row.scripts as Record<string, string>;
      if (scriptName in scripts) return true;
    }
    return false;
  }

  // === 4.10 getAvailableScripts ===

  async getAvailableScripts(repoId: string): Promise<ScriptInfo[]> {
    const result = await this.pool.query(
      `SELECT file_path, scripts FROM repo_manifests WHERE repo_id = $1 ORDER BY file_path`,
      [repoId],
    );

    const scripts: ScriptInfo[] = [];
    for (const row of result.rows) {
      const rowScripts = row.scripts as Record<string, string>;
      for (const [name, command] of Object.entries(rowScripts)) {
        scripts.push({
          name,
          command,
          file_path: row.file_path as string,
        });
      }
    }

    scripts.sort((a, b) =>
      a.file_path.localeCompare(b.file_path) || a.name.localeCompare(b.name),
    );
    return scripts;
  }

  // === 4.11 searchSemantic (MVP fallback) ===

  async searchSemantic(
    repoId: string,
    query: string,
    topK: number = 5,
  ): Promise<Array<CodeEntity & { similarity: number }>> {
    const k = Math.min(Math.max(topK, 1), 50);

    // MVP: no embedding API on server side. Fall back to findSymbol with extracted keywords.
    const keywords = query.split(/\s+/).filter((w) => w.length > 2);
    if (keywords.length === 0) return [];

    const results: Array<CodeEntity & { similarity: number }> = [];
    for (const keyword of keywords) {
      const entities = await this.findSymbol(repoId, keyword);
      for (const entity of entities) {
        if (!results.find((r) => r.id === entity.id)) {
          results.push({ ...entity, similarity: 0.5 });
        }
      }
      if (results.length >= k) break;
    }

    return results.slice(0, k);
  }

  // === Manifest storage helpers ===

  async storeManifest(
    repoId: string,
    filePath: string,
    dependencies: Record<string, string>,
    devDependencies: Record<string, string>,
    scripts: Record<string, string>,
    source: 'lockfile' | 'manifest',
    metadata?: { name?: string; version?: string; engines?: Record<string, string>; license?: string },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO repo_manifests (repo_id, file_path, dependencies, dev_dependencies, scripts, source, name, version, engines, license)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (repo_id, file_path) DO UPDATE SET
         dependencies = $3,
         dev_dependencies = $4,
         scripts = $5,
         source = $6,
         name = $7,
         version = $8,
         engines = $9,
         license = $10,
         updated_at = NOW()`,
      [
        repoId, filePath,
        JSON.stringify(dependencies), JSON.stringify(devDependencies), JSON.stringify(scripts),
        source,
        metadata?.name ?? null,
        metadata?.version ?? null,
        metadata?.engines ? JSON.stringify(metadata.engines) : null,
        metadata?.license ?? null,
      ],
    );
  }

  async deleteManifest(repoId: string, filePath: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM repo_manifests WHERE repo_id = $1 AND file_path = $2',
      [repoId, filePath],
    );
  }

  // === 4.12 updateFromDiff ===

  async updateFromDiff(
    repoId: string,
    changedFiles: FileChange[],
    fetchContent: (filePath: string) => Promise<string | null>,
  ): Promise<IndexUpdateResult> {
    const result: IndexUpdateResult = {
      entities_added: 0,
      entities_updated: 0,
      entities_removed: 0,
      files_skipped: [],
    };

    if (changedFiles.length === 0) return result;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update file tree
      for (const file of changedFiles) {
        if (file.status === 'added') {
          await client.query(
            `INSERT INTO repo_files (repo_id, path) VALUES ($1, $2)
             ON CONFLICT (repo_id, path) DO NOTHING`,
            [repoId, file.filename],
          );
        } else if (file.status === 'removed') {
          await client.query(
            'DELETE FROM repo_files WHERE repo_id = $1 AND path = $2',
            [repoId, file.filename],
          );
        } else if (file.status === 'renamed' && file.previous_filename) {
          await client.query(
            'UPDATE repo_files SET path = $3 WHERE repo_id = $1 AND path = $2',
            [repoId, file.previous_filename, file.filename],
          );
        }
      }

      // 2. Process renamed code files
      for (const file of changedFiles) {
        if (file.status === 'renamed' && file.previous_filename && isSupportedCodeFile(file.filename)) {
          await client.query(
            'UPDATE code_entities SET file_path = $3 WHERE repo_id = $1 AND file_path = $2',
            [repoId, file.previous_filename, file.filename],
          );
        }
      }

      // 3. Process removed code files
      for (const file of changedFiles) {
        if (file.status === 'removed' && isSupportedCodeFile(file.filename)) {
          const deleteResult = await client.query(
            'DELETE FROM code_entities WHERE repo_id = $1 AND file_path = $2',
            [repoId, file.filename],
          );
          result.entities_removed += deleteResult.rowCount ?? 0;
        }
      }

      // 4. Process added/modified/renamed code files
      for (const file of changedFiles) {
        if (file.status === 'removed') continue;
        if (!isSupportedCodeFile(file.filename)) {
          if (!isManifestFile(file.filename)) {
            result.files_skipped.push(file.filename);
          }
          continue;
        }

        const content = await fetchContent(file.filename);
        if (content === null) {
          result.files_skipped.push(file.filename);
          continue;
        }

        // Skip large files
        if (content.length > 1_000_000) {
          result.files_skipped.push(file.filename);
          continue;
        }

        const language = detectLanguage(file.filename);
        if (!language) {
          result.files_skipped.push(file.filename);
          continue;
        }

        const parseResult = await parseFile(file.filename, content);
        if (!parseResult) {
          result.files_skipped.push(file.filename);
          continue;
        }

        if (parseResult.has_errors) {
          // Remove stale entities for files with parse errors
          const deleteResult = await client.query(
            'DELETE FROM code_entities WHERE repo_id = $1 AND file_path = $2',
            [repoId, file.filename],
          );
          result.entities_removed += deleteResult.rowCount ?? 0;
          result.files_skipped.push(file.filename);
          continue;
        }

        // Get existing entities
        const existingResult = await client.query(
          'SELECT * FROM code_entities WHERE repo_id = $1 AND file_path = $2',
          [repoId, file.filename],
        );
        const existing = existingResult.rows.map(rowToCodeEntity);

        // Compute diff
        const diff = computeEntityDiff(existing, parseResult.entities);

        // Apply added
        for (const entity of diff.added) {
          await client.query(
            `INSERT INTO code_entities (repo_id, file_path, line_number, end_line_number, entity_type, name, signature, raw_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [repoId, file.filename, entity.line_number, entity.end_line_number, entity.entity_type, entity.name, entity.signature, entity.raw_code],
          );
          result.entities_added++;
        }

        // Apply updated
        for (const update of diff.updated) {
          const embeddingClause = update.signature_changed ? ', embedding = NULL' : '';
          await client.query(
            `UPDATE code_entities SET
              name = $2, signature = $3, raw_code = $4,
              line_number = $5, end_line_number = $6,
              updated_at = NOW()${embeddingClause}
             WHERE id = $1`,
            [update.old_id, update.new_entity.name, update.new_entity.signature, update.new_entity.raw_code, update.new_entity.line_number, update.new_entity.end_line_number],
          );
          result.entities_updated++;
        }

        // Apply removed
        for (const entityId of diff.removed) {
          await client.query('DELETE FROM code_entities WHERE id = $1', [entityId]);
          result.entities_removed++;
        }
      }

      // 5. Process manifest files
      for (const file of changedFiles) {
        if (!isManifestFile(file.filename)) continue;

        if (file.status === 'removed') {
          await this.deleteManifestInTx(client, repoId, file.filename);
          continue;
        }

        const content = await fetchContent(file.filename);
        if (!content) continue;

        const manifest = parseManifest(file.filename, content);
        if (!manifest) continue;

        await this.storeManifestInTx(
          client,
          repoId,
          manifest.file_path,
          manifest.dependencies,
          manifest.dev_dependencies,
          manifest.scripts,
          manifest.source,
          {
            name: manifest.name,
            version: manifest.version,
            engines: manifest.engines,
            license: manifest.license,
          },
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return result;
  }

  private async storeManifestInTx(
    client: PoolClient,
    repoId: string,
    filePath: string,
    dependencies: Record<string, string>,
    devDependencies: Record<string, string>,
    scripts: Record<string, string>,
    source: 'lockfile' | 'manifest',
    metadata?: { name?: string; version?: string; engines?: Record<string, string>; license?: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO repo_manifests (repo_id, file_path, dependencies, dev_dependencies, scripts, source, name, version, engines, license)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (repo_id, file_path) DO UPDATE SET
         dependencies = $3, dev_dependencies = $4, scripts = $5, source = $6,
         name = $7, version = $8, engines = $9, license = $10, updated_at = NOW()`,
      [
        repoId, filePath,
        JSON.stringify(dependencies), JSON.stringify(devDependencies), JSON.stringify(scripts),
        source,
        metadata?.name ?? null,
        metadata?.version ?? null,
        metadata?.engines ? JSON.stringify(metadata.engines) : null,
        metadata?.license ?? null,
      ],
    );
  }

  private async deleteManifestInTx(client: PoolClient, repoId: string, filePath: string): Promise<void> {
    await client.query(
      'DELETE FROM repo_manifests WHERE repo_id = $1 AND file_path = $2',
      [repoId, filePath],
    );
  }

  // === getManifestMetadata ===

  async getManifestMetadata(repoId: string): Promise<ParsedManifest | null> {
    const result = await this.pool.query(
      `SELECT file_path, dependencies, dev_dependencies, scripts, source, name, version, engines, license
       FROM repo_manifests
       WHERE repo_id = $1 AND source = 'manifest'
       ORDER BY file_path
       LIMIT 1`,
      [repoId],
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    const manifest: ParsedManifest = {
      file_path: row.file_path as string,
      dependencies: (row.dependencies as Record<string, string>) ?? {},
      dev_dependencies: (row.dev_dependencies as Record<string, string>) ?? {},
      scripts: (row.scripts as Record<string, string>) ?? {},
      source: row.source as 'lockfile' | 'manifest',
    };
    if (row.name) manifest.name = row.name as string;
    if (row.version) manifest.version = row.version as string;
    if (row.engines) manifest.engines = row.engines as Record<string, string>;
    if (row.license) manifest.license = row.license as string;
    return manifest;
  }

  // === getHeadings ===

  async getHeadings(
    repoId: string,
    filePath: string,
  ): Promise<Array<{ text: string; level: number; slug: string }>> {
    const content = await this.readFileContent(repoId, filePath);
    if (!content) return [];
    return parseMarkdownHeadings(content);
  }

  async readFileContent(_repoId: string, _filePath: string, _maxBytes?: number): Promise<string | null> {
    // Server-side IndexStore does not have filesystem access.
    // File content reading is available in CLI mode (InMemoryIndex).
    return null;
  }
}

// === Helper functions ===

function normalizePath(path: string): string | null {
  if (path.includes('..')) return null;
  let p = path;
  if (p.startsWith('./')) p = p.slice(2);
  if (p.endsWith('/')) return null;
  return p;
}

function normalizeRoutePath(path: string): string {
  let p = path;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function rowToCodeEntity(row: CodeEntityRow): CodeEntity {
  return {
    id: row.id,
    repo_id: row.repo_id,
    file_path: row.file_path,
    line_number: row.line_number,
    end_line_number: row.end_line_number,
    entity_type: row.entity_type,
    name: row.name,
    signature: row.signature ?? '',
    embedding: row.embedding,
    raw_code: row.raw_code ?? '',
    last_commit_sha: row.last_commit_sha ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function entityToRoute(row: CodeEntityRow): RouteEntity {
  const [method, ...pathParts] = (row.name as string).split(' ');
  return {
    id: row.id,
    file_path: row.file_path,
    line_number: row.line_number,
    method,
    path: pathParts.join(' '),
  };
}

/**
 * Check if a claimed path matches a parameterized route.
 * E.g., /users/:id matches /users/{id} or /users/<int:id>
 */
function pathMatchesParameterized(claimedPath: string, routePath: string): boolean {
  const claimedSegments = claimedPath.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);

  if (claimedSegments.length !== routeSegments.length) return false;

  for (let i = 0; i < claimedSegments.length; i++) {
    const claimed = claimedSegments[i];
    const route = routeSegments[i];

    if (claimed === route) continue;

    // Parameterized segments
    const isParamClaimed = claimed.startsWith(':') || claimed.startsWith('{') || claimed.startsWith('<');
    const isParamRoute = route.startsWith(':') || route.startsWith('{') || route.startsWith('<');

    if (isParamClaimed || isParamRoute) continue;

    return false;
  }

  return true;
}

/**
 * Compute path similarity for route search (TDD-0 Section 4.7).
 */
function computePathSimilarity(claimedPath: string, routePath: string): number {
  const claimedNorm = normalizeRoutePath(claimedPath);
  const routeNorm = normalizeRoutePath(routePath);

  // Exact match
  if (claimedNorm === routeNorm) return 1.0;

  const claimedSegments = claimedNorm.split('/').filter(Boolean);
  const routeSegments = routeNorm.split('/').filter(Boolean);

  // Prefix match
  if (routeNorm.startsWith(claimedNorm + '/') || claimedNorm.startsWith(routeNorm + '/')) {
    return 0.9;
  }

  // Segment overlap
  const maxLen = Math.max(claimedSegments.length, routeSegments.length);
  if (maxLen === 0) return 0.0;

  let matching = 0;
  const minLen = Math.min(claimedSegments.length, routeSegments.length);
  for (let i = 0; i < minLen; i++) {
    if (claimedSegments[i] === routeSegments[i]) matching++;
    else if (isParam(claimedSegments[i]) || isParam(routeSegments[i])) matching += 0.5;
  }

  const overlapRatio = matching / maxLen;
  if (overlapRatio === 0) return 0.0;
  return 0.5 + 0.4 * overlapRatio;
}

function isParam(segment: string): boolean {
  return segment.startsWith(':') || segment.startsWith('{') || segment.startsWith('<');
}

/**
 * Find a package version in a dependency map.
 * Python packages use case-insensitive lookup.
 */
function findPackageVersion(deps: Record<string, string>, packageName: string): string | null {
  // Direct lookup
  if (deps[packageName]) return deps[packageName];

  // Case-insensitive fallback (for Python)
  const lowerName = packageName.toLowerCase();
  for (const [name, version] of Object.entries(deps)) {
    if (name.toLowerCase() === lowerName) return version;
  }
  return null;
}

// === Appendix A: Entity Diff ===

interface EntityDiff {
  added: ParsedEntity[];
  updated: Array<{ old_id: string; new_entity: ParsedEntity; signature_changed: boolean }>;
  removed: string[];
}

function getEntityKey(name: string, entityType: string, signature: string): string {
  const paramCount = countParams(signature);
  return `${name}:${entityType}:${paramCount}`;
}

function countParams(signature: string): number {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match || !match[1].trim()) return 0;
  return match[1].split(',').length;
}

export function computeEntityDiff(existing: CodeEntity[], parsed: ParsedEntity[]): EntityDiff {
  const diff: EntityDiff = { added: [], updated: [], removed: [] };

  const existingMap = new Map<string, CodeEntity>();
  for (const e of existing) {
    const key = getEntityKey(e.name, e.entity_type, e.signature);
    existingMap.set(key, e);
  }

  const parsedSet = new Set<string>();
  for (const p of parsed) {
    const key = getEntityKey(p.name, p.entity_type, p.signature);
    parsedSet.add(key);

    const existingEntity = existingMap.get(key);
    if (existingEntity) {
      const signatureChanged = existingEntity.signature !== p.signature;
      const codeChanged = existingEntity.raw_code !== p.raw_code;
      const lineChanged = existingEntity.line_number !== p.line_number;

      if (signatureChanged || codeChanged || lineChanged) {
        diff.updated.push({
          old_id: existingEntity.id,
          new_entity: p,
          signature_changed: signatureChanged,
        });
      }
    } else {
      diff.added.push(p);
    }
  }

  for (const [key, entity] of existingMap) {
    if (!parsedSet.has(key)) {
      diff.removed.push(entity.id);
    }
  }

  return diff;
}

/**
 * Parse markdown content and extract headings with GitHub-style slugs.
 */
export function parseMarkdownHeadings(
  content: string,
): Array<{ text: string; level: number; slug: string }> {
  const headings: Array<{ text: string; level: number; slug: string }> = [];
  const slugCounts = new Map<string, number>();

  for (const line of content.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;

    const level = match[1].length;
    // Strip inline markdown: bold, italic, code, links
    let text = match[2].trim();
    text = text.replace(/\*\*(.+?)\*\*/g, '$1'); // bold
    text = text.replace(/\*(.+?)\*/g, '$1'); // italic
    text = text.replace(/`(.+?)`/g, '$1'); // inline code
    text = text.replace(/\[(.+?)\]\([^)]*\)/g, '$1'); // links

    // GitHub-style slug: lowercase, replace non-alphanumeric with hyphens, collapse
    let slug = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Handle duplicate slugs (GitHub appends -1, -2, etc.)
    const count = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, count + 1);
    if (count > 0) {
      slug = `${slug}-${count}`;
    }

    headings.push({ text, level, slug });
  }

  return headings;
}
