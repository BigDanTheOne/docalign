import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { findCloseMatch } from './close-match';
import { makeResult } from './result-helpers';

const KNOWN_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'ruby', 'bash', 'sh',
  'shell', 'json', 'yaml', 'toml', 'html', 'css', 'sql', 'graphql', 'dockerfile',
  'makefile', 'c', 'cpp', 'csharp', 'kotlin', 'swift', 'scala', 'php', 'r', 'lua',
  'perl', 'haskell', 'elixir', 'dart', 'zig', 'tsx', 'jsx', 'mjs', 'vue', 'svelte',
  'xml', 'markdown', 'plaintext', 'text', 'diff', 'csv', 'ini', 'protobuf', 'proto',
]);

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
  // Handle prose signatures first (Task 17)
  if (claim.extracted_value.prose_signature) {
    return verifyProseSignature(claim, index);
  }

  // Language tag validation (Task 14)
  const language = claim.extracted_value.language as string | null;
  if (language && !KNOWN_LANGUAGES.has(language.toLowerCase())) {
    const close = findCloseMatch(language.toLowerCase(), [...KNOWN_LANGUAGES], 2);
    if (close) {
      return makeResult(claim, {
        verdict: 'drifted',
        severity: 'low' as Severity,
        evidence_files: [],
        reasoning: `Code block language tag '${language}' is not recognized. Did you mean '${close.name}'?`,
        suggested_fix: claim.claim_text.replace(language, close.name),
        specific_mismatch: `Unknown language tag '${language}'.`,
      });
    }
  }

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

  const totalChecks = imports.length + symbols.length;

  // If NONE of the symbols/imports resolve, this is likely tutorial/example code
  // or references an external library — not verifiable against this codebase.
  if (uniqueFiles.length === 0) {
    return null;
  }

  // Partial issues — severity by ratio
  const severity: Severity = issues.length > totalChecks / 2 ? 'high' : 'medium';

  return makeResult(claim, {
    verdict: 'drifted',
    severity,
    evidence_files: uniqueFiles,
    reasoning: `Code example has issues: ${issues.join('; ')}`,
    specific_mismatch: issues.join('; '),
  });
}

async function verifyProseSignature(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const functionName = claim.extracted_value.function_name as string;
  if (!functionName) return null;

  const entities = await index.findSymbol(claim.repo_id, functionName);
  if (entities.length === 0) {
    return null; // Can't verify — function might be in external library
  }

  const entity = entities[0];
  return makeResult(claim, {
    verdict: 'verified',
    evidence_files: [entity.file_path],
    reasoning: `Function '${functionName}' found in '${entity.file_path}'.`,
  });
}

function extractSymbolFromImport(importPath: string): string | null {
  if (!importPath) return null;
  const segments = importPath.replace(/['"]/g, '').split('/');
  const last = segments[segments.length - 1];
  if (!last || last === '.' || last === '..') return null;
  return last.replace(/\.(ts|js|tsx|jsx|py|rs|go)$/, '') || null;
}
