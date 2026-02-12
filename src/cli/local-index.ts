/**
 * In-memory CodebaseIndexService for CLI.
 * Walks the local filesystem, parses code with tree-sitter,
 * and provides all lookup APIs without a database.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type {
  CodeEntity,
  DependencyVersion,
  RouteEntity,
  ScriptInfo,
  FileChange,
  IndexUpdateResult,
  ParsedEntity,
  ParsedManifest,
} from '../shared/types';
import type { CodebaseIndexService } from '../layers/L0-codebase-index';
import {
  initParser,
  parseFile,
  isSupportedCodeFile,
  isManifestFile,
} from '../layers/L0-codebase-index';
import { parseManifest } from '../layers/L0-codebase-index/manifest-parser';

// === Path helpers (replicated from index-store.ts) ===

function normalizePath(p: string): string | null {
  if (p.includes('..')) return null;
  let result = p;
  if (result.startsWith('./')) result = result.slice(2);
  if (result.endsWith('/')) return null;
  return result;
}

function normalizeRoutePath(p: string): string {
  let result = p;
  if (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

function isParam(segment: string): boolean {
  return segment.startsWith(':') || segment.startsWith('{') || segment.startsWith('<');
}

function pathMatchesParameterized(claimedPath: string, routePath: string): boolean {
  const claimedSegments = claimedPath.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);

  if (claimedSegments.length !== routeSegments.length) return false;

  for (let i = 0; i < claimedSegments.length; i++) {
    const claimed = claimedSegments[i];
    const route = routeSegments[i];

    if (claimed === route) continue;

    const isParamClaimed = claimed.startsWith(':') || claimed.startsWith('{') || claimed.startsWith('<');
    const isParamRoute = route.startsWith(':') || route.startsWith('{') || route.startsWith('<');

    if (isParamClaimed || isParamRoute) continue;

    return false;
  }

  return true;
}

function computePathSimilarity(claimedPath: string, routePath: string): number {
  const claimedNorm = normalizeRoutePath(claimedPath);
  const routeNorm = normalizeRoutePath(routePath);

  if (claimedNorm === routeNorm) return 1.0;

  const claimedSegments = claimedNorm.split('/').filter(Boolean);
  const routeSegments = routeNorm.split('/').filter(Boolean);

  if (routeNorm.startsWith(claimedNorm + '/') || claimedNorm.startsWith(routeNorm + '/')) {
    return 0.9;
  }

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

function findPackageVersion(deps: Record<string, string>, packageName: string): string | null {
  if (deps[packageName]) return deps[packageName];
  const lowerName = packageName.toLowerCase();
  for (const [name, version] of Object.entries(deps)) {
    if (name.toLowerCase() === lowerName) return version;
  }
  return null;
}

// === InMemoryIndex ===

export class InMemoryIndex implements CodebaseIndexService {
  private files = new Set<string>();
  private entitiesById = new Map<string, CodeEntity>();
  private entitiesByFile = new Map<string, CodeEntity[]>();
  private entitiesByNameExact = new Map<string, CodeEntity[]>();
  private entitiesByNameLower = new Map<string, CodeEntity[]>();
  private routeEntities: CodeEntity[] = [];
  private manifests: ParsedManifest[] = [];
  private repoId = 'local';

  constructor(private repoRoot: string) {}

  /**
   * Build the index by scanning the filesystem.
   * Must be called before any lookups.
   */
  async build(onProgress?: (phase: string, current: number, total: number) => void): Promise<void> {
    const fileList = this.getFileList();

    for (const f of fileList) {
      this.files.add(f);
    }

    // Parse manifests first (needed for knownPackages)
    const manifestFiles = fileList.filter((f) => isManifestFile(f));
    for (const filePath of manifestFiles) {
      try {
        const absPath = path.join(this.repoRoot, filePath);
        const content = fs.readFileSync(absPath, 'utf-8');
        const manifest = parseManifest(filePath, content);
        if (manifest) this.manifests.push(manifest);
      } catch { /* skip unreadable */ }
    }

    // Parse code files with tree-sitter
    const codeFiles = fileList.filter((f) => isSupportedCodeFile(f));
    if (codeFiles.length > 0) {
      await initParser();
    }

    for (let i = 0; i < codeFiles.length; i++) {
      const filePath = codeFiles[i];
      if (onProgress) onProgress('Indexing code', i + 1, codeFiles.length);

      try {
        const absPath = path.join(this.repoRoot, filePath);
        const content = fs.readFileSync(absPath, 'utf-8');
        // Skip very large files (>500KB)
        if (content.length > 500 * 1024) continue;
        const result = await parseFile(filePath, content);
        if (result) {
          for (const pe of result.entities) {
            this.addEntity(this.toCodeEntity(filePath, pe));
          }
        }
      } catch { /* skip unreadable or parse errors */ }
    }
  }

  /** Get all known package names from manifests. */
  getKnownPackages(): Set<string> {
    const pkgs = new Set<string>();
    for (const m of this.manifests) {
      for (const pkg of Object.keys(m.dependencies)) pkgs.add(pkg);
      for (const pkg of Object.keys(m.dev_dependencies)) pkgs.add(pkg);
    }
    return pkgs;
  }

  // === CodebaseIndexService implementation ===

  async fileExists(_repoId: string, filePath: string): Promise<boolean> {
    if (!filePath || filePath.endsWith('/')) return false;
    const normalized = normalizePath(filePath);
    if (!normalized) return false;

    if (this.files.has(normalized)) return true;
    // Also check entity file paths
    return this.entitiesByFile.has(normalized);
  }

  async getFileTree(_repoId: string): Promise<string[]> {
    const allPaths = new Set<string>(this.files);
    for (const filePath of this.entitiesByFile.keys()) {
      allPaths.add(filePath);
    }
    return [...allPaths].sort();
  }

  async findSymbol(_repoId: string, name: string): Promise<CodeEntity[]> {
    if (!name) return [];

    // Exact match first
    const exact = this.entitiesByNameExact.get(name);
    if (exact && exact.length > 0) {
      return [...exact].sort((a, b) =>
        a.file_path.localeCompare(b.file_path) || a.line_number - b.line_number,
      );
    }

    // Case-insensitive fallback
    const lower = this.entitiesByNameLower.get(name.toLowerCase());
    if (lower && lower.length > 0) {
      return [...lower].sort((a, b) =>
        a.file_path.localeCompare(b.file_path) || a.line_number - b.line_number,
      );
    }

    return [];
  }

  async getEntityByFile(_repoId: string, filePath: string): Promise<CodeEntity[]> {
    const entities = this.entitiesByFile.get(filePath) ?? [];
    return [...entities].sort((a, b) => a.line_number - b.line_number);
  }

  async getEntityById(entityId: string): Promise<CodeEntity | null> {
    return this.entitiesById.get(entityId) ?? null;
  }

  async findRoute(_repoId: string, method: string, routePath: string): Promise<RouteEntity | null> {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = normalizeRoutePath(routePath);
    const routeName = `${normalizedMethod} ${normalizedPath}`;

    // Exact match
    for (const entity of this.routeEntities) {
      if (entity.name === routeName) {
        return this.entityToRoute(entity);
      }
    }

    // Parameterized match
    for (const entity of this.routeEntities) {
      const [rowMethod, ...rowPathParts] = entity.name.split(' ');
      const rowPath = rowPathParts.join(' ');
      if (rowMethod !== normalizedMethod && rowMethod !== 'ALL') continue;

      if (pathMatchesParameterized(normalizedPath, rowPath)) {
        return this.entityToRoute(entity);
      }
    }

    return null;
  }

  async searchRoutes(
    _repoId: string,
    searchPath: string,
  ): Promise<Array<{ method: string; path: string; file: string; line: number; similarity: number }>> {
    const results: Array<{ method: string; path: string; file: string; line: number; similarity: number }> = [];

    for (const entity of this.routeEntities) {
      const [method, ...pathParts] = entity.name.split(' ');
      const routePath = pathParts.join(' ');
      const similarity = computePathSimilarity(searchPath, routePath);

      if (similarity > 0.3) {
        results.push({
          method,
          path: routePath,
          file: entity.file_path,
          line: entity.line_number,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, 10);
  }

  async getDependencyVersion(_repoId: string, packageName: string): Promise<DependencyVersion | null> {
    // Check lockfiles first
    for (const m of this.manifests) {
      if (m.source !== 'lockfile') continue;
      const version = findPackageVersion(m.dependencies, packageName) ??
        findPackageVersion(m.dev_dependencies, packageName);
      if (version) return { version, source: 'lockfile' };
    }

    // Check manifests
    for (const m of this.manifests) {
      if (m.source !== 'manifest') continue;
      const version = findPackageVersion(m.dependencies, packageName) ??
        findPackageVersion(m.dev_dependencies, packageName);
      if (version) return { version, source: 'manifest' };
    }

    return null;
  }

  async scriptExists(_repoId: string, scriptName: string): Promise<boolean> {
    for (const m of this.manifests) {
      if (scriptName in m.scripts) return true;
    }
    return false;
  }

  async getAvailableScripts(_repoId: string): Promise<ScriptInfo[]> {
    const scripts: ScriptInfo[] = [];
    for (const m of this.manifests) {
      for (const [name, command] of Object.entries(m.scripts)) {
        scripts.push({ name, command, file_path: m.file_path });
      }
    }
    scripts.sort((a, b) =>
      a.file_path.localeCompare(b.file_path) || a.name.localeCompare(b.name),
    );
    return scripts;
  }

  async searchSemantic(_repoId: string, query: string, topK: number = 5): Promise<Array<CodeEntity & { similarity: number }>> {
    const k = Math.min(Math.max(topK, 1), 50);
    const keywords = query.split(/\s+/).filter((w) => w.length > 2);
    if (keywords.length === 0) return [];

    const results: Array<CodeEntity & { similarity: number }> = [];
    for (const keyword of keywords) {
      const entities = await this.findSymbol('local', keyword);
      for (const entity of entities) {
        if (!results.find((r) => r.id === entity.id)) {
          results.push({ ...entity, similarity: 0.5 });
        }
      }
      if (results.length >= k) break;
    }

    return results.slice(0, k);
  }

  async updateFromDiff(
    _repoId: string,
    _changedFiles: FileChange[],
    _fetchContent: (filePath: string) => Promise<string | null>,
  ): Promise<IndexUpdateResult> {
    // Not needed for CLI — single scan, no incremental updates
    return { entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] };
  }

  async readFileContent(_repoId: string, filePath: string, maxBytes: number = 100 * 1024): Promise<string | null> {
    if (!filePath || filePath.includes('..')) return null;
    const normalized = filePath.startsWith('./') ? filePath.slice(2) : filePath;
    const absPath = path.join(this.repoRoot, normalized);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > maxBytes) return null;
      return fs.readFileSync(absPath, 'utf-8');
    } catch {
      return null;
    }
  }

  // === Private helpers ===

  private getFileList(): string[] {
    try {
      const output = execSync('git ls-files', {
        cwd: this.repoRoot,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return this.walkDir('');
    }
  }

  private walkDir(dir: string): string[] {
    const results: string[] = [];
    const absDir = path.join(this.repoRoot, dir);

    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue;
        const relPath = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push(...this.walkDir(relPath));
        } else {
          results.push(relPath);
        }
      }
    } catch { /* skip unreadable directories */ }

    return results;
  }

  private toCodeEntity(filePath: string, pe: ParsedEntity): CodeEntity {
    return {
      id: randomUUID(),
      repo_id: this.repoId,
      file_path: filePath,
      line_number: pe.line_number,
      end_line_number: pe.end_line_number,
      entity_type: pe.entity_type,
      name: pe.name,
      signature: pe.signature,
      embedding: null,
      raw_code: pe.raw_code,
      last_commit_sha: '',
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  private addEntity(entity: CodeEntity): void {
    this.entitiesById.set(entity.id, entity);

    const byFile = this.entitiesByFile.get(entity.file_path) ?? [];
    byFile.push(entity);
    this.entitiesByFile.set(entity.file_path, byFile);

    const byNameExact = this.entitiesByNameExact.get(entity.name) ?? [];
    byNameExact.push(entity);
    this.entitiesByNameExact.set(entity.name, byNameExact);

    const lowerName = entity.name.toLowerCase();
    const byNameLower = this.entitiesByNameLower.get(lowerName) ?? [];
    byNameLower.push(entity);
    this.entitiesByNameLower.set(lowerName, byNameLower);

    if (entity.entity_type === 'route') {
      this.routeEntities.push(entity);
    }
  }

  private entityToRoute(entity: CodeEntity): RouteEntity {
    const [method, ...pathParts] = entity.name.split(' ');
    return {
      id: entity.id,
      file_path: entity.file_path,
      line_number: entity.line_number,
      method,
      path: pathParts.join(' '),
    };
  }
}
