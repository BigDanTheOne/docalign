/**
 * Staleness checker — determines if a cached semantic verdict is still valid.
 *
 * Runs cheaply on every check:
 * - Entity checks: symbol lookup + content hash comparison
 * - Assertion checks: glob + grep
 *
 * If ALL evidence still holds → 'fresh'. If ANY fails → 'stale'.
 *
 * Also provides `verifyWithEvidence()` which runs assertions/entities
 * and produces an initial verification verdict without LLM.
 */

import fs from 'fs';
import path from 'path';
import { hashContent, type SemanticClaimRecord, type SemanticVerification } from './semantic-store';
import type { CodebaseIndexService } from '../layers/L0-codebase-index';

export type FreshnessResult = 'fresh' | 'stale';

/**
 * Check whether a claim's cached verification is still valid.
 *
 * @param claim - The semantic claim record with evidence
 * @param index - L0 codebase index for symbol lookup
 * @param repoRoot - Repository root for file reads
 * @returns 'fresh' if cached verdict is valid, 'stale' if re-verification needed
 */
export async function checkClaimStaleness(
  claim: SemanticClaimRecord,
  index: CodebaseIndexService,
  repoRoot: string,
): Promise<FreshnessResult> {
  // No cached verification → stale (needs initial verification)
  if (!claim.last_verification) return 'stale';

  // No evidence at all → treat as fresh (nothing to invalidate)
  if (claim.evidence_entities.length === 0 && claim.evidence_assertions.length === 0) {
    return 'fresh';
  }

  // Check entities
  for (const entity of claim.evidence_entities) {
    const isStale = await checkEntityStaleness(entity, index, repoRoot);
    if (isStale) return 'stale';
  }

  // Check assertions
  for (const assertion of claim.evidence_assertions) {
    const isStale = checkAssertionStaleness(assertion, repoRoot);
    if (isStale) return 'stale';
  }

  return 'fresh';
}

// === Evidence-based verification ===

export interface EvidenceCheckDetail {
  type: 'entity' | 'assertion';
  description: string;
  passed: boolean;
}

export interface EvidenceVerificationResult {
  verification: SemanticVerification;
  /** Per-check details for debugging/reporting */
  details: EvidenceCheckDetail[];
  /** Updated content hashes for entities (to persist back to store) */
  entityContentHashes: Map<string, string>;
}

/**
 * Verify a semantic claim by running its evidence checks (assertions + entities).
 * Produces a verification verdict without LLM — purely deterministic.
 *
 * Use this for:
 * - Initial verification after extraction
 * - Re-verification when staleness checker reports 'stale'
 */
export async function verifyWithEvidence(
  claim: SemanticClaimRecord,
  index: CodebaseIndexService,
  repoRoot: string,
): Promise<EvidenceVerificationResult> {
  const details: EvidenceCheckDetail[] = [];
  const entityContentHashes = new Map<string, string>();
  const failures: string[] = [];

  // No evidence → uncertain (can't verify without evidence)
  if (claim.evidence_entities.length === 0 && claim.evidence_assertions.length === 0) {
    return {
      verification: {
        verdict: 'uncertain',
        confidence: 0.3,
        reasoning: 'No evidence (entities or assertions) to verify against',
        verified_at: new Date().toISOString(),
      },
      details: [],
      entityContentHashes,
    };
  }

  // Check entities and compute current hashes
  for (const entity of claim.evidence_entities) {
    const result = await checkEntityExists(entity, index, repoRoot);
    details.push({
      type: 'entity',
      description: `${entity.symbol} in ${entity.file}`,
      passed: result.found,
    });
    if (!result.found) {
      failures.push(`Entity "${entity.symbol}" not found in ${entity.file}`);
    } else if (result.contentHash) {
      entityContentHashes.set(`${entity.symbol}:${entity.file}`, result.contentHash);
    }
  }

  // Check assertions
  for (const assertion of claim.evidence_assertions) {
    const passed = !checkAssertionStaleness(assertion, repoRoot);
    details.push({
      type: 'assertion',
      description: assertion.description,
      passed,
    });
    if (!passed) {
      const action = assertion.expect === 'exists' ? 'not found' : 'unexpectedly found';
      failures.push(`Pattern "${assertion.pattern}" ${action} in ${assertion.scope}`);
    }
  }

  const totalChecks = details.length;
  const passedChecks = details.filter((d) => d.passed).length;

  if (failures.length === 0) {
    return {
      verification: {
        verdict: 'verified',
        confidence: 0.7 + 0.3 * (passedChecks / Math.max(totalChecks, 1)),
        reasoning: `All ${totalChecks} evidence checks passed`,
        verified_at: new Date().toISOString(),
      },
      details,
      entityContentHashes,
    };
  }

  return {
    verification: {
      verdict: 'drifted',
      confidence: 0.7 + 0.3 * (failures.length / Math.max(totalChecks, 1)),
      reasoning: failures.join('; '),
      verified_at: new Date().toISOString(),
    },
    details,
    entityContentHashes,
  };
}

/**
 * Compute current content hash for an entity (for populating after extraction).
 */
async function checkEntityExists(
  entity: { symbol: string; file: string },
  index: CodebaseIndexService,
  repoRoot: string,
): Promise<{ found: boolean; contentHash: string | null }> {
  // Try L0 index first (AST-level symbols)
  const entities = await index.findSymbol('local', entity.symbol);
  const match = entities.find((e) => e.file_path === entity.file);

  if (match) {
    try {
      const absPath = path.join(repoRoot, entity.file);
      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const entityLines = lines.slice(match.line_number - 1, match.end_line_number).join('\n');
      return { found: true, contentHash: hashContent(entityLines) };
    } catch {
      return { found: false, contentHash: null };
    }
  }

  // Fallback: grep the file for the symbol name (catches properties, local vars, etc.)
  try {
    const absPath = path.join(repoRoot, entity.file);
    const content = fs.readFileSync(absPath, 'utf-8');
    if (content.includes(entity.symbol)) {
      return { found: true, contentHash: hashContent(content) };
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return { found: false, contentHash: null };
}

async function checkEntityStaleness(
  entity: { symbol: string; file: string; content_hash: string },
  index: CodebaseIndexService,
  repoRoot: string,
): Promise<boolean> {
  // Try L0 index first (AST-level symbols)
  const entities = await index.findSymbol('local', entity.symbol);
  const match = entities.find((e) => e.file_path === entity.file);

  if (match) {
    try {
      const absPath = path.join(repoRoot, entity.file);
      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const entityLines = lines.slice(match.line_number - 1, match.end_line_number).join('\n');
      const currentHash = hashContent(entityLines);
      return currentHash !== entity.content_hash;
    } catch {
      return true;
    }
  }

  // Fallback: grep the file for the symbol name
  try {
    const absPath = path.join(repoRoot, entity.file);
    const content = fs.readFileSync(absPath, 'utf-8');
    if (content.includes(entity.symbol)) {
      const currentHash = hashContent(content);
      return currentHash !== entity.content_hash;
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return true; // Entity not found anywhere → stale
}

function checkAssertionStaleness(
  assertion: { pattern: string; scope: string; expect: 'exists' | 'absent'; description: string },
  repoRoot: string,
): boolean {
  // Find files matching scope glob (simple implementation)
  const matchingFiles = findFilesMatchingScope(repoRoot, assertion.scope);
  if (matchingFiles.length === 0) {
    // No files match scope — if expecting 'exists', that's a fail
    return assertion.expect === 'exists';
  }

  // Search for pattern in matching files
  const patternFound = searchPatternInFiles(repoRoot, matchingFiles, assertion.pattern);

  if (assertion.expect === 'exists' && !patternFound) return true;  // Expected pattern missing
  if (assertion.expect === 'absent' && patternFound) return true;   // Unexpected pattern found

  return false;
}

/**
 * Simple glob matching for assertion scopes.
 * Supports:
 * - Exact paths: "src/cli/llm-client.ts"
 * - Wildcard: "src/*.ts", "src/routes/**\/*.ts", "**\/*.ts"
 */
function findFilesMatchingScope(repoRoot: string, scope: string): string[] {
  // Fast path: if scope has no glob characters, treat as exact file path
  if (!scope.includes('*')) {
    const absPath = path.join(repoRoot, scope);
    try {
      fs.accessSync(absPath, fs.constants.R_OK);
      return [scope];
    } catch {
      return [];
    }
  }

  const results: string[] = [];
  const parts = scope.split('/');
  const isRecursive = parts.includes('**');

  walkForScope(repoRoot, '', parts, isRecursive, results);
  return results;
}

function walkForScope(
  repoRoot: string,
  relDir: string,
  scopeParts: string[],
  isRecursive: boolean,
  results: string[],
): void {
  const absDir = path.join(repoRoot, relDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (isRecursive) {
        walkForScope(repoRoot, relPath, scopeParts, isRecursive, results);
      } else {
        // Check if this directory matches the next scope part
        const dirPart = scopeParts.find((_, i) => i < scopeParts.length - 1);
        if (dirPart && (entry.name === dirPart || dirPart === '**')) {
          walkForScope(repoRoot, relPath, scopeParts, isRecursive, results);
        }
      }
    } else {
      if (matchesScope(relPath, scopeParts)) {
        results.push(relPath);
      }
    }
  }
}

function matchesScope(filePath: string, scopeParts: string[]): boolean {
  const filePattern = scopeParts[scopeParts.length - 1];
  const fileName = path.basename(filePath);

  // Check file pattern (e.g., "*.ts")
  if (filePattern.startsWith('*')) {
    const ext = filePattern.slice(1); // ".ts"
    if (!fileName.endsWith(ext)) return false;
  } else if (filePattern !== fileName && filePattern !== '*') {
    return false;
  }

  // Check directory prefix (simplified)
  const dirParts = scopeParts.slice(0, -1).filter((p) => p !== '**');
  if (dirParts.length === 0) return true;

  const fileDirParts = filePath.split('/').slice(0, -1);
  let di = 0;
  for (const dp of dirParts) {
    while (di < fileDirParts.length && fileDirParts[di] !== dp) di++;
    if (di >= fileDirParts.length) return false;
    di++;
  }
  return true;
}

function searchPatternInFiles(repoRoot: string, files: string[], pattern: string): boolean {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return false; // Invalid pattern
  }

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
      if (regex.test(content)) return true;
    } catch {
      // Skip unreadable files
    }
  }
  return false;
}
