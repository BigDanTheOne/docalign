import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { compareVersions } from './version-comparison';
import { findCloseMatch } from './close-match';
import { makeResult } from './result-helpers';

/**
 * Known Node.js builtins and runtime modules that won't appear in package.json.
 * Data-driven: each entry has explicit test coverage.
 */
export const RUNTIME_ALLOWLIST = new Set([
  // Node.js builtins
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads',
  'zlib',
  // Node.js prefixed builtins
  'node:assert', 'node:buffer', 'node:child_process', 'node:crypto',
  'node:events', 'node:fs', 'node:http', 'node:https', 'node:net',
  'node:os', 'node:path', 'node:process', 'node:stream', 'node:url',
  'node:util', 'node:worker_threads', 'node:zlib',
  'node:test',
  // Runtime platform names — version mentions (e.g., "Node.js 18") are documentation,
  // not package dependencies. Accept all case variants produced by extractor patterns.
  'Node.js', 'Nodejs', 'node.js', 'nodejs', 'node',
  'Python', 'python',
  'Ruby', 'ruby',
  'Go', 'go',
  'Rust', 'rust',
  'Java', 'java',
  'Deno', 'deno',
  'Bun', 'bun',
]);

/**
 * Tier 1: Verify dependency_version claims.
 * TDD-3 Appendix A.3.
 */
export async function verifyDependencyVersion(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const pkgName = claim.extracted_value.package as string;
  const claimedVersion = claim.extracted_value.version as string;
  if (!pkgName) return null;

  // Step 1: Lookup actual version
  const dep = await index.getDependencyVersion(claim.repo_id, pkgName);
  if (!dep) {
    // Check if this is a known runtime/builtin that won't appear in package.json
    if (RUNTIME_ALLOWLIST.has(pkgName)) {
      return makeResult(claim, {
        verdict: 'verified',
        evidence_files: [],
        reasoning: `Package '${pkgName}' is a known Node.js builtin/runtime module.`,
      });
    }

    // Fuzzy suggestion: find similar package names from manifests
    const manifest = await index.getManifestMetadata(claim.repo_id);
    const allDeps = manifest
      ? [...Object.keys(manifest.dependencies), ...Object.keys(manifest.dev_dependencies)]
      : [];
    const close = findCloseMatch(pkgName, allDeps, 3);
    const suggestion = close ? ` Did you mean '${close.name}'?` : '';
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'high' as Severity,
      evidence_files: [],
      reasoning: `Package '${pkgName}' not found.${suggestion}`,
      specific_mismatch: `Package is not a dependency.${suggestion}`,
    });
  }

  // Step 2: Version comparison
  if (!claimedVersion) {
    // No version claimed, package exists — verified
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: ['package.json'],
      reasoning: `Package '${pkgName}' is a dependency.`,
    });
  }

  const comparison = compareVersions(claimedVersion, dep.version, dep.source);
  if (comparison.matches) {
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: ['package.json'],
      reasoning: `Package '${pkgName}' version '${dep.version}' matches documented '${claimedVersion}'.`,
    });
  }

  // Step 3: Version mismatch
  return makeResult(claim, {
    verdict: 'drifted',
    severity: 'medium' as Severity,
    evidence_files: ['package.json'],
    reasoning: `Doc says '${pkgName} ${claimedVersion}' but actual is '${dep.version}'.`,
    suggested_fix: claim.claim_text.replace(claimedVersion, dep.version),
    specific_mismatch: `Version mismatch: documented '${claimedVersion}', actual '${dep.version}'.`,
  });
}
