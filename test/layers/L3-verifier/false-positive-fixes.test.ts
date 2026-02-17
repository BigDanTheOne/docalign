import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  verifyPathReference,
  verifyDependencyVersion,
} from '../../../src/layers/L3-verifier';
import type { Claim } from '../../../src/shared/types';
import type { CodebaseIndexService } from '../../../src/layers/L0-codebase-index';
import { RUNTIME_ALLOWLIST } from '../../../src/layers/L3-verifier/tier1-dependency-version';

function makeMockIndex(overrides: Partial<CodebaseIndexService> = {}): CodebaseIndexService {
  return {
    fileExists: async () => false,
    getFileTree: async () => [],
    findSymbol: async () => [],
    getEntityByFile: async () => [],
    getEntityById: async () => null,
    findRoute: async () => null,
    searchRoutes: async () => [],
    getDependencyVersion: async () => null,
    scriptExists: async () => false,
    getAvailableScripts: async () => [],
    searchSemantic: async () => [],
    updateFromDiff: async () => ({ entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] }),
    readFileContent: async () => null,
    getManifestMetadata: async () => null,
    getHeadings: async () => [],
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: randomUUID(),
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: 'test claim',
    claim_type: 'path_reference',
    testability: 'syntactic',
    extracted_value: {},
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'pending',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// === Change 1: Relative Path Resolution ===
describe('relative path resolution (Step 1a)', () => {
  it('resolves ../ prefixed path relative to source file', async () => {
    const index = makeMockIndex({
      fileExists: async (_repoId, path) => path === 'docs/utils/helper.ts',
    });
    const claim = makeClaim({
      source_file: 'docs/nested/doc.md',
      extracted_value: { path: '../utils/helper.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('docs/utils/helper.ts');
  });

  it('resolves ./ prefixed path relative to source file', async () => {
    const index = makeMockIndex({
      fileExists: async (_repoId, path) => path === 'src/components/local.ts',
    });
    const claim = makeClaim({
      source_file: 'src/components/Button.md',
      extracted_value: { path: './local.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('src/components/local.ts');
  });

  it('resolves ../../ path with multiple parent traversals', async () => {
    const index = makeMockIndex({
      fileExists: async (_repoId, path) => path === 'deep/root.ts',
    });
    const claim = makeClaim({
      source_file: 'deep/nested/dir/doc.md',
      extracted_value: { path: '../../root.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('deep/root.ts');
  });

  it('falls through when relative path resolves to non-existent file', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => [],
    });
    const claim = makeClaim({
      source_file: 'docs/doc.md',
      extracted_value: { path: '../nonexistent.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    // Should fall through to drifted (not verified)
    expect(result!.verdict).toBe('drifted');
  });

  it('handles excessive ../ that would escape root', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => [],
    });
    const claim = makeClaim({
      source_file: 'docs/doc.md',
      extracted_value: { path: '../../../../../../../escape.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    // Should not crash, should fall through to drifted
    expect(result!.verdict).toBe('drifted');
  });
});

// === Change 2: Ambiguous Suffix Match ===
describe('ambiguous suffix match (Step 1c)', () => {
  it('returns verified for single basename match', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => ['src/unique-file.ts'],
    });
    const claim = makeClaim({
      extracted_value: { path: 'unique-file.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('src/unique-file.ts');
  });

  it('returns uncertain for multiple basename matches', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => ['src/a/index.ts', 'src/b/index.ts', 'src/c/index.ts'],
    });
    const claim = makeClaim({
      extracted_value: { path: 'index.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('uncertain');
    expect(result!.evidence_files.length).toBeGreaterThan(1);
    expect(result!.evidence_files).toContain('src/a/index.ts');
    expect(result!.evidence_files).toContain('src/b/index.ts');
  });

  it('caps evidence files at 5 for many matches', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `dir${i}/config.ts`);
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => files,
    });
    const claim = makeClaim({
      extracted_value: { path: 'config.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('uncertain');
    expect(result!.evidence_files.length).toBeLessThanOrEqual(5);
  });

  it('falls through to similar-path search when no basename matches', async () => {
    const index = makeMockIndex({
      fileExists: async () => false,
      getFileTree: async () => ['src/different.ts'],
    });
    const claim = makeClaim({
      extracted_value: { path: 'nonexistent.ts' },
    });
    const result = await verifyPathReference(claim, index);
    expect(result).not.toBeNull();
    // Should fall through to drifted (similar-path or no match)
    expect(result!.verdict).toBe('drifted');
  });
});

// === Change 3: Runtime Allowlist ===
describe('runtime dependency allowlist', () => {
  it('returns verified for Node.js builtin "fs"', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'fs' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.reasoning).toContain('builtin');
  });

  it('returns verified for Node.js builtin "path"', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'path' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('returns verified for node:-prefixed builtin "node:crypto"', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'node:crypto' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('still returns drifted for unknown packages', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'dependency_version',
      extracted_value: { package: 'nonexistent-package-xyz' },
    });
    const result = await verifyDependencyVersion(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  it('allowlist contains all common Node.js builtins', () => {
    const builtins = ['fs', 'path', 'crypto', 'http', 'https', 'stream', 'util', 'os', 'net', 'events', 'child_process', 'url', 'zlib'];
    for (const b of builtins) {
      expect(RUNTIME_ALLOWLIST.has(b)).toBe(true);
    }
  });

  it('allowlist contains node:-prefixed variants', () => {
    const prefixed = ['node:fs', 'node:path', 'node:crypto', 'node:http', 'node:url'];
    for (const p of prefixed) {
      expect(RUNTIME_ALLOWLIST.has(p)).toBe(true);
    }
  });
});
