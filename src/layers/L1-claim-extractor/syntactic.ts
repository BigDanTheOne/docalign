import type { Claim, ClaimType, ExtractionConfig, RawExtraction } from '../../shared/types';
import { preProcess, detectFormat, isBinaryContent } from './preprocessing';
import {
  extractPaths,
  extractApiRoutes,
  extractCommands,
  extractDependencyVersions,
  extractCodeExamples,
  deduplicateWithinFile,
  isValidPath,
} from './extractors';
import type { ClaimStore } from './claim-store';
import { rawToClaim } from './claim-store';

const MAX_FILE_SIZE = 100 * 1024; // 100KB

const DEFAULT_CLAIM_TYPES: Set<ClaimType> = new Set([
  'path_reference',
  'command',
  'dependency_version',
  'api_route',
  'code_example',
]);

/**
 * extractSyntactic: Full 7-step pipeline.
 * TDD-1 Section 4.1.
 */
export async function extractSyntactic(
  repoId: string,
  docFile: string,
  content: string,
  claimStore: ClaimStore,
  config?: Partial<ExtractionConfig>,
  knownPackages?: Set<string>,
): Promise<Claim[]> {
  // Step 0: Binary check
  if (isBinaryContent(content)) return [];

  // Step 1: Size check
  if (content.length > MAX_FILE_SIZE) return [];
  if (content.length === 0) return [];

  // Step 2: Format detection
  const format = detectFormat(docFile);
  if (format === 'rst') return []; // RST uses LLM-only

  // Step 3: Pre-process
  const preprocessed = preProcess(content, format);

  // Step 4: Determine enabled claim types
  const enabledTypes = config?.enabled_claim_types ?? DEFAULT_CLAIM_TYPES;

  // Step 5: Run extractors
  const rawExtractions: RawExtraction[] = [];

  if (enabledTypes.has('path_reference')) {
    rawExtractions.push(...extractPaths(preprocessed, docFile));
  }
  if (enabledTypes.has('command')) {
    rawExtractions.push(...extractCommands(preprocessed));
  }
  if (enabledTypes.has('dependency_version')) {
    rawExtractions.push(...extractDependencyVersions(preprocessed, knownPackages ?? new Set()));
  }
  if (enabledTypes.has('api_route')) {
    rawExtractions.push(...extractApiRoutes(preprocessed));
  }
  if (enabledTypes.has('code_example')) {
    rawExtractions.push(...extractCodeExamples(preprocessed));
  }

  // Step 6: Path validation filter
  const filtered = rawExtractions.filter((e) => {
    if (e.claim_type !== 'path_reference') return true;
    return isValidPath(e.extracted_value.path as string);
  });

  // Step 7: Deduplicate within file
  const deduped = deduplicateWithinFile(filtered);

  // Step 8: Convert to claims and batch insert
  const claimInserts = deduped.map((extraction) => rawToClaim(repoId, docFile, extraction));
  return claimStore.batchInsertClaims(claimInserts);
}

// === Appendix H: Document File Discovery ===

const DOC_PATTERNS = [
  /^README\.md$/i,
  /^README\.mdx$/i,
  /^README\.rst$/i,
  /^CONTRIBUTING\.md$/i,
  /^ARCHITECTURE\.md$/i,
  /^CLAUDE\.md$/i,
  /^AGENTS\.md$/i,
  /^COPILOT-INSTRUCTIONS\.md$/i,
  /^\.cursorrules$/,
  /^docs\/.*\.mdx?$/,
  /^doc\/.*\.mdx?$/,
  /^wiki\/.*\.md$/,
  /^adr\/.*\.md$/,
  /^ADR-.*\.md$/,
  /^api\/.*\.md$/,
  /\/CLAUDE\.md$/,
  /\/AGENTS\.md$/,
];

const DOC_EXCLUDE = [
  /^node_modules\//,
  /^vendor\//,
  /^\.git\//,
  /(?:^|\/)CHANGELOG\.md$/i,
  /(?:^|\/)LICENSE\.md$/i,
];

export function discoverDocFiles(fileTree: string[]): string[] {
  const patternMatches = fileTree.filter((f) => DOC_PATTERNS.some((p) => p.test(f)));

  // Heuristic: .md files at root + first 2 directory levels
  const heuristicMatches = fileTree.filter((f) => {
    if (!f.endsWith('.md')) return false;
    return f.split('/').length <= 3;
  });

  const all = new Set([...patternMatches, ...heuristicMatches]);

  // Apply exclusions
  const result = [...all].filter((f) => !DOC_EXCLUDE.some((p) => p.test(f)));

  return result.sort();
}
