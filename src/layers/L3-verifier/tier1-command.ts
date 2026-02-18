import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { findCloseMatch } from './close-match';
import { makeResult } from './result-helpers';

/**
 * Tier 1: Verify command claims.
 * TDD-3 Appendix A.2.
 */
// Runners whose scripts can be verified against manifest files
const VERIFIABLE_RUNNERS = new Set([
  'npm', 'yarn', 'pnpm', 'bun', 'pip', 'pip3', 'poetry', 'cargo',
]);

// Built-in subcommands of npm/yarn/pnpm that are NOT user-defined scripts.
// When docs say "npm install" or "pnpm publish", these are built-in commands
// and should not be verified against package.json scripts.
const NPM_BUILTINS = new Set([
  'install', 'i', 'ci', 'uninstall', 'remove', 'rm', 'un',
  'publish', 'pack', 'init', 'create',
  'link', 'unlink',
  'view', 'info', 'show',
  'config', 'set', 'get',
  'login', 'logout', 'adduser', 'whoami', 'token',
  'audit', 'fund', 'outdated', 'update', 'up', 'upgrade',
  'dedupe', 'prune', 'shrinkwrap',
  'cache', 'completion', 'doctor', 'ping', 'prefix', 'root',
  'exec', 'explore', 'explain', 'why',
  'help', 'search', 'star', 'stars', 'version',
  'owner', 'team', 'access', 'deprecate', 'dist-tag', 'unpublish',
  'repo', 'bugs', 'docs', 'home',
  'rebuild', 'ls', 'list', 'll',
  'bin', 'pkg',
  'add', 'dlx', 'self-update', 'setup', 'store', 'patch', 'patch-commit',
  'import', 'fetch', 'approve-builds', 'licenses',
  'run-script',
]);

export async function verifyCommand(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const runner = claim.extracted_value.runner as string | undefined;
  const script = claim.extracted_value.script as string;
  if (!script) return null;

  // Skip verification for non-package-manager runners (docker, make, kubectl, etc.)
  // These commands can't be verified against manifest files
  if (runner && !VERIFIABLE_RUNNERS.has(runner)) return null;

  // Skip built-in subcommands (e.g. "npm install", "pip install", "cargo build").
  // These are not user-defined scripts and should not be verified against manifests.
  const subcommand = script.split(/\s+/)[0].toLowerCase();
  if (runner && isBuiltinSubcommand(runner, subcommand)) {
    // Task 13: For install commands, validate the package name against manifest
    if (isInstallCommand(runner, subcommand)) {
      const installResult = await verifyInstallPackageName(claim, index, runner, script);
      if (installResult) return installResult;
    }
    return null;
  }

  // Step 1: Exact check
  const exists = await index.scriptExists(claim.repo_id, script);
  if (exists) {
    return makeResult(claim, {
      verdict: 'verified',
      evidence_files: [getManifestFile(runner)],
      reasoning: `Script '${script}' exists in ${runner ?? 'package manager'}.`,
    });
  }

  // Step 2: Close match search
  const available = await index.getAvailableScripts(claim.repo_id);
  const closeMatch = findCloseMatch(script, available.map((s) => s.name), 2);
  if (closeMatch) {
    return makeResult(claim, {
      verdict: 'drifted',
      severity: 'high' as Severity,
      evidence_files: [getManifestFile(runner)],
      reasoning: `Script '${script}' not found. Close match: '${closeMatch.name}'.`,
      suggested_fix: claim.claim_text.replace(script, closeMatch.name),
      specific_mismatch: `Script '${script}' not found.`,
    });
  }

  // Step 3: Script not found
  // Include the manifest file as evidence to avoid 3C-005 downgrade to uncertain.
  return makeResult(claim, {
    verdict: 'drifted',
    severity: 'high' as Severity,
    evidence_files: [getManifestFile(runner)],
    reasoning: `Script '${script}' not found.`,
    specific_mismatch: `Script '${script}' not found.`,
  });
}

// Built-in subcommands for pip/pip3
const PIP_BUILTINS = new Set([
  'install', 'uninstall', 'freeze', 'list', 'show', 'search',
  'download', 'wheel', 'hash', 'check', 'config', 'cache',
  'index', 'debug', 'inspect',
]);

// Built-in subcommands for cargo
const CARGO_BUILTINS = new Set([
  'build', 'check', 'clean', 'doc', 'new', 'init', 'add', 'remove',
  'run', 'test', 'bench', 'update', 'search', 'publish', 'install',
  'uninstall', 'clippy', 'fmt', 'fix', 'tree', 'vendor',
  'login', 'logout', 'owner', 'package', 'yank', 'generate-lockfile',
]);

// Built-in subcommands for poetry
const POETRY_BUILTINS = new Set([
  'new', 'init', 'install', 'update', 'add', 'remove', 'show', 'build',
  'publish', 'config', 'run', 'shell', 'check', 'search', 'lock',
  'version', 'export', 'env', 'cache', 'source', 'self',
]);

function isBuiltinSubcommand(runner: string, subcommand: string): boolean {
  switch (runner) {
    case 'npm':
    case 'yarn':
    case 'pnpm':
    case 'bun':
      return NPM_BUILTINS.has(subcommand);
    case 'pip':
    case 'pip3':
      return PIP_BUILTINS.has(subcommand);
    case 'cargo':
      return CARGO_BUILTINS.has(subcommand);
    case 'poetry':
      return POETRY_BUILTINS.has(subcommand);
    default:
      return false;
  }
}

function isInstallCommand(runner: string, subcommand: string): boolean {
  if (['npm', 'yarn', 'pnpm', 'bun'].includes(runner)) {
    return ['install', 'i', 'add'].includes(subcommand);
  }
  if (['pip', 'pip3'].includes(runner)) return subcommand === 'install';
  if (runner === 'cargo') return subcommand === 'add';
  return false;
}

async function verifyInstallPackageName(
  claim: Claim,
  index: CodebaseIndexService,
  runner: string,
  script: string,
): Promise<VerificationResult | null> {
  // Extract the package being installed
  const parts = script.split(/\s+/);
  // Skip flags and the subcommand itself
  const pkgArgs = parts.slice(1).filter((p) => !p.startsWith('-'));
  if (pkgArgs.length === 0) return null;

  const installedPkg = pkgArgs[0];
  if (!installedPkg) return null;

  // Get manifest metadata to check if package name matches
  const manifest = await index.getManifestMetadata(claim.repo_id);
  if (!manifest?.name) return null;

  // For "npm install <this-package>" style commands (install self),
  // check if the documented name matches the manifest name
  const manifestName = manifest.name;
  // Normalize: strip scope for comparison
  const normalizeForCompare = (name: string) => name.replace(/^@[^/]+\//, '').toLowerCase();

  if (normalizeForCompare(installedPkg) === normalizeForCompare(manifestName)) {
    // Names match (possibly with different scoping)
    if (installedPkg !== manifestName) {
      return makeResult(claim, {
        verdict: 'drifted',
        severity: 'medium' as Severity,
        evidence_files: [getManifestFile(runner)],
        reasoning: `Install command references '${installedPkg}' but package name is '${manifestName}'.`,
        suggested_fix: claim.claim_text.replace(installedPkg, manifestName),
        specific_mismatch: `Package name mismatch: documented '${installedPkg}', actual '${manifestName}'.`,
      });
    }
  }

  return null; // Can't verify — package could be an external dependency
}

function getManifestFile(runner?: string): string {
  switch (runner) {
    case 'npm':
    case 'yarn':
    case 'pnpm':
    case 'npx':
    case 'bun':
      return 'package.json';
    case 'pip':
    case 'pip3':
      return 'requirements.txt';
    case 'poetry':
      return 'pyproject.toml';
    case 'cargo':
      return 'Cargo.toml';
    default:
      return 'package.json';
  }
}
