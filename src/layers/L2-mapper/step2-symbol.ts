import type { Claim } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import type { MappingCandidate } from './step1-direct';

/**
 * Step 2: Symbol Search mapping.
 * TDD-2 Section 4.1, Appendix A.5-A.6.
 *
 * Applies to: code_example, behavior, architecture
 */
export async function mapSymbolSearch(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  const candidates: MappingCandidate[] = [];

  if (claim.claim_type === 'code_example') {
    return mapCodeExampleSymbols(repoId, claim, index);
  }

  // For behavior/architecture: search each keyword
  const keywords = claim.keywords ?? [];
  for (const keyword of keywords) {
    const entities = await index.findSymbol(repoId, keyword);
    for (const entity of entities) {
      candidates.push({
        code_file: entity.file_path,
        code_entity_id: entity.id,
        confidence: 0.85,
        co_change_boost: 0.0,
        mapping_method: 'symbol_search',
      });
    }
  }

  return candidates;
}

/**
 * Extract symbols from code_example extracted_value.
 * TDD-2 Appendix A.5.
 */
async function mapCodeExampleSymbols(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  const candidates: MappingCandidate[] = [];
  const imports = (claim.extracted_value.imports as string[]) ?? [];
  const symbols = (claim.extracted_value.symbols as string[]) ?? [];

  // Search for imported symbols
  for (const importPath of imports) {
    const symbolName = extractSymbolFromImport(importPath);
    if (symbolName) {
      const entities = await index.findSymbol(repoId, symbolName);
      for (const entity of entities) {
        candidates.push({
          code_file: entity.file_path,
          code_entity_id: entity.id,
          confidence: 0.9,
          co_change_boost: 0.0,
          mapping_method: 'symbol_search',
        });
      }
    }
  }

  // Search for referenced symbols
  for (const symbol of symbols) {
    const entities = await index.findSymbol(repoId, symbol);
    for (const entity of entities) {
      candidates.push({
        code_file: entity.file_path,
        code_entity_id: entity.id,
        confidence: 0.85,
        co_change_boost: 0.0,
        mapping_method: 'symbol_search',
      });
    }
  }

  return candidates;
}

/**
 * Extract the symbol name from an import path.
 * e.g. "express" -> "express", "@auth/handler" -> "handler",
 * "../utils/helper" -> "helper"
 */
export function extractSymbolFromImport(importPath: string): string | null {
  if (!importPath) return null;
  // Get the last segment of the path
  const segments = importPath.replace(/['"]/g, '').split('/');
  const last = segments[segments.length - 1];
  if (!last || last === '.' || last === '..') return null;
  // Remove file extension
  return last.replace(/\.(ts|js|tsx|jsx|py|rs|go)$/, '') || null;
}
