import type { Pool } from 'pg';
import type { Claim, ExtractionConfig, Verdict, RawExtraction } from '../../shared/types';
import { ClaimStore } from './claim-store';
import { extractSyntactic, discoverDocFiles } from './syntactic';

export { ClaimStore } from './claim-store';
export { extractSyntactic, discoverDocFiles } from './syntactic';
export {
  extractPaths,
  extractApiRoutes,
  extractCommands,
  extractDependencyVersions,
  extractCodeExamples,
  deduplicateWithinFile,
  getIdentityKey,
  generateKeywords,
  isValidPath,
} from './extractors';
export { preProcess, detectFormat, isBinaryContent } from './preprocessing';

/**
 * ClaimExtractorService interface.
 * TDD-1 Section 2.2.
 */
export interface ClaimExtractorService {
  extractSyntactic(
    repoId: string,
    docFile: string,
    content: string,
    config?: Partial<ExtractionConfig>,
    knownPackages?: Set<string>,
  ): Promise<Claim[]>;
  getClaimsByFile(repoId: string, sourceFile: string): Promise<Claim[]>;
  getClaimsByRepo(repoId: string): Promise<Claim[]>;
  getClaimById(claimId: string): Promise<Claim | null>;
  reExtract(
    repoId: string,
    docFile: string,
    content: string,
    config?: Partial<ExtractionConfig>,
    knownPackages?: Set<string>,
  ): Promise<{ added: Claim[]; updated: Claim[]; removed: string[] }>;
  deleteClaimsForFile(repoId: string, docFile: string): Promise<number>;
  updateVerificationStatus(claimId: string, status: Verdict | 'pending'): Promise<void>;
  discoverDocFiles(fileTree: string[]): string[];
}

/**
 * Create a ClaimExtractorService backed by PostgreSQL.
 */
export function createClaimExtractor(pool: Pool): ClaimExtractorService {
  const store = new ClaimStore(pool);

  return {
    async extractSyntactic(
      repoId: string,
      docFile: string,
      content: string,
      config?: Partial<ExtractionConfig>,
      knownPackages?: Set<string>,
    ): Promise<Claim[]> {
      return extractSyntactic(repoId, docFile, content, store, config, knownPackages);
    },

    getClaimsByFile: (repoId, sourceFile) => store.getClaimsByFile(repoId, sourceFile),
    getClaimsByRepo: (repoId) => store.getClaimsByRepo(repoId),
    getClaimById: (claimId) => store.getClaimById(claimId),

    async reExtract(
      repoId: string,
      docFile: string,
      content: string,
      config?: Partial<ExtractionConfig>,
      knownPackages?: Set<string>,
    ): Promise<{ added: Claim[]; updated: Claim[]; removed: string[] }> {
      // Run extraction pipeline (without DB insert)
      const format = (await import('./preprocessing')).detectFormat(docFile);
      if (format === 'rst') return { added: [], updated: [], removed: [] };
      const { isBinaryContent } = await import('./preprocessing');
      if (isBinaryContent(content)) return { added: [], updated: [], removed: [] };
      if (content.length === 0 || content.length > 100 * 1024)
        return { added: [], updated: [], removed: [] };

      const { preProcess } = await import('./preprocessing');
      const preprocessed = preProcess(content, format);
      const enabledTypes = config?.enabled_claim_types ?? new Set([
        'path_reference', 'command', 'dependency_version', 'api_route', 'code_example',
      ] as const);

      const { extractPaths, extractCommands, extractDependencyVersions, extractApiRoutes, extractCodeExamples, deduplicateWithinFile, isValidPath } = await import('./extractors');

      const rawExtractions: RawExtraction[] = [];
      if (enabledTypes.has('path_reference')) rawExtractions.push(...extractPaths(preprocessed, docFile));
      if (enabledTypes.has('command')) rawExtractions.push(...extractCommands(preprocessed));
      if (enabledTypes.has('dependency_version')) rawExtractions.push(...extractDependencyVersions(preprocessed, knownPackages ?? new Set()));
      if (enabledTypes.has('api_route')) rawExtractions.push(...extractApiRoutes(preprocessed));
      if (enabledTypes.has('code_example')) rawExtractions.push(...extractCodeExamples(preprocessed));

      const filtered = rawExtractions.filter((e) => {
        if (e.claim_type !== 'path_reference') return true;
        return isValidPath(e.extracted_value.path as string);
      });
      const deduped = deduplicateWithinFile(filtered);

      return store.reExtract(repoId, docFile, deduped);
    },

    deleteClaimsForFile: (repoId, docFile) => store.deleteClaimsForFile(repoId, docFile),
    updateVerificationStatus: (claimId, status) => store.updateVerificationStatus(claimId, status),
    discoverDocFiles: (fileTree) => discoverDocFiles(fileTree),
  };
}
