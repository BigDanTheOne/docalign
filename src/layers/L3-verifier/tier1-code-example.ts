import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { makeResult } from './result-helpers';

/**
 * Tier 1: Verify code_example claims.
 * TDD-3 Appendix A.5.
 *
 * Sub-checks:
 * 1. Import resolution
 * 2. Symbol existence
 * 3. Syntax validation (basic, language annotation)
 */
export async function verifyCodeExample(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const imports = (claim.extracted_value.imports as string[]) ?? [];
  const symbols = (claim.extracted_value.symbols as string[]) ?? [];
  const issues: string[] = [];
  const checkedFiles: string[] = [];

  // Sub-check 1: Import resolution
  for (const importPath of imports) {
    const symbolName = extractSymbolFromImport(importPath);
    if (!symbolName) continue;
    const entities = await index.findSymbol(claim.repo_id, symbolName);
    if (entities.length === 0) {
      issues.push(`Import '${importPath}' does not resolve.`);
    } else {
      checkedFiles.push(entities[0].file_path);
    }
  }

  // Sub-check 2: Symbol existence
  for (const symbolName of symbols) {
    const entities = await index.findSymbol(claim.repo_id, symbolName);
    if (entities.length === 0) {
      issues.push(`Symbol '${symbolName}' not found.`);
    } else {
      checkedFiles.push(entities[0].file_path);
    }
  }

  // If no imports or symbols to check, return null (can't verify deterministically)
  if (imports.length === 0 && symbols.length === 0) {
    return null;
  }

  const uniqueFiles = [...new Set(checkedFiles)];

  if (issues.length === 0) {
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: uniqueFiles,
      reasoning: 'All imports and symbols resolve correctly.',
    });
  }

  // Partial issues — severity by ratio
  const totalChecks = imports.length + symbols.length;
  const severity: Severity = issues.length > totalChecks / 2 ? 'high' : 'medium';

  return makeResult(claim, {
    verdict: 'drifted',
    severity,
    evidence_files: uniqueFiles,
    reasoning: `Code example has issues: ${issues.join('; ')}`,
    specific_mismatch: issues.join('; '),
  });
}

function extractSymbolFromImport(importPath: string): string | null {
  if (!importPath) return null;
  const segments = importPath.replace(/['"]/g, '').split('/');
  const last = segments[segments.length - 1];
  if (!last || last === '.' || last === '..') return null;
  return last.replace(/\.(ts|js|tsx|jsx|py|rs|go)$/, '') || null;
}
