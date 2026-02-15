import type { Pool } from 'pg';
import type {
  CodeEntity,
  DependencyVersion,
  FileChange,
  IndexUpdateResult,
  ParsedManifest,
  RouteEntity,
  ScriptInfo,
} from '../../shared/types';
import { IndexStore } from './index-store';
export { initParser } from './ast-parser';
export { parseFile, detectLanguage, isSupportedCodeFile, isManifestFile } from './ast-parser';
export { parseManifest } from './manifest-parser';
export { IndexStore } from './index-store';
export { computeEntityDiff } from './index-store';

/**
 * CodebaseIndexService interface.
 * TDD-0 Section 2.2.
 */
export interface CodebaseIndexService {
  fileExists(repoId: string, path: string): Promise<boolean>;
  getFileTree(repoId: string): Promise<string[]>;
  findSymbol(repoId: string, name: string): Promise<CodeEntity[]>;
  getEntityByFile(repoId: string, filePath: string): Promise<CodeEntity[]>;
  getEntityById(entityId: string): Promise<CodeEntity | null>;
  findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null>;
  searchRoutes(
    repoId: string,
    path: string,
  ): Promise<Array<{ method: string; path: string; file: string; line: number; similarity: number }>>;
  getDependencyVersion(repoId: string, packageName: string): Promise<DependencyVersion | null>;
  scriptExists(repoId: string, scriptName: string): Promise<boolean>;
  getAvailableScripts(repoId: string): Promise<ScriptInfo[]>;
  searchSemantic(
    repoId: string,
    query: string,
    topK?: number,
  ): Promise<Array<CodeEntity & { similarity: number }>>;
  updateFromDiff(
    repoId: string,
    changedFiles: FileChange[],
    fetchContent: (filePath: string) => Promise<string | null>,
  ): Promise<IndexUpdateResult>;
  /** Read raw file content. Returns null if file doesn't exist or is too large. */
  readFileContent(repoId: string, filePath: string, maxBytes?: number): Promise<string | null>;
  /** Get parsed manifest metadata (name, version, engines, license). */
  getManifestMetadata(repoId: string): Promise<ParsedManifest | null>;
  /** Get markdown headings from a file with computed GitHub-style slugs. */
  getHeadings(
    repoId: string,
    filePath: string,
  ): Promise<Array<{ text: string; level: number; slug: string }>>;
}

/**
 * Create a CodebaseIndexService backed by PostgreSQL.
 */
export function createCodebaseIndex(pool: Pool): CodebaseIndexService {
  return new IndexStore(pool);
}
