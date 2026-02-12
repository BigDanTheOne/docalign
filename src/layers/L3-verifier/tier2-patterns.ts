import type { Claim, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { makeTier2Result } from './result-helpers';

/**
 * Tier 2: Pattern-based verification strategies.
 * TDD-3 Appendix D.
 *
 * D.1: Strict mode check — verify tsconfig strict mode
 * D.2: Framework import check — verify framework usage via symbol search
 * D.3: Counter-example search — not implementable without file content search (v2 stub)
 * D.4: Environment variable check — verify env vars in .env files
 * D.5: Tool version check — verify runtime versions in version files
 */
export async function verifyTier2(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  if (claim.claim_type !== 'convention' && claim.claim_type !== 'environment' && claim.claim_type !== 'config') {
    return null;
  }

  // D.1: Strict mode check (convention)
  if (claim.claim_type === 'convention') {
    const strict = await strictModeCheck(claim, index);
    if (strict) return strict;
  }

  // D.2: Framework Import Check (convention)
  if (claim.claim_type === 'convention') {
    const framework = await frameworkImportCheck(claim, index);
    if (framework) return framework;
  }

  // D.4: Environment Variable Check (environment/config)
  if (claim.claim_type === 'environment' || claim.claim_type === 'config') {
    const envResult = await envVarCheck(claim, index);
    if (envResult) return envResult;
  }

  // D.5: Tool Version Check (environment)
  if (claim.claim_type === 'environment') {
    const versionResult = await toolVersionCheck(claim, index);
    if (versionResult) return versionResult;
  }

  return null;
}

// === D.1: Strict Mode Check ===

const STRICT_PATTERNS = /\bstrict\s*(?:mode|:\s*true|typescript)\b/i;

async function strictModeCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  if (!STRICT_PATTERNS.test(claim.claim_text)) return null;

  const content = await index.readFileContent(claim.repo_id, 'tsconfig.json');
  if (content === null) return null;

  try {
    // Parse tsconfig, handling JSON with comments (strip them first)
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(stripped);
    const compilerOptions = parsed?.compilerOptions ?? {};

    if (compilerOptions.strict === true) {
      return makeTier2Result(claim, {
        verdict: 'verified',
        evidence_files: ['tsconfig.json'],
        reasoning: 'tsconfig.json has "strict": true in compilerOptions.',
      });
    }

    return makeTier2Result(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: ['tsconfig.json'],
      reasoning: 'tsconfig.json does not have "strict": true.',
      specific_mismatch: 'strict mode is not enabled in tsconfig.json.',
      suggested_fix: claim.claim_text,
    });
  } catch {
    return null; // Unparseable tsconfig, fall through
  }
}

// === D.2: Framework Import Check ===

async function frameworkImportCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const framework = claim.extracted_value.framework as string | undefined;
  if (!framework) return null;

  const entities = await index.findSymbol(claim.repo_id, framework);
  if (entities.length > 0) {
    return makeTier2Result(claim, {
      verdict: 'verified',
      evidence_files: [entities[0].file_path],
      reasoning: `Framework '${framework}' found in codebase via import.`,
    });
  }

  return null;
}

// === D.4: Environment Variable Check ===

const ENV_VAR_PATTERN = /\b([A-Z][A-Z0-9_]{2,})\b/;

const ENV_FILES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
];

async function envVarCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  // Extract env var name from the claim
  const envVar = (claim.extracted_value.env_var as string) ??
    extractEnvVarFromText(claim.claim_text);
  if (!envVar) return null;

  // Search through env files for the variable
  for (const envFile of ENV_FILES) {
    const content = await index.readFileContent(claim.repo_id, envFile);
    if (content === null) continue;

    // Check if the env var is defined (KEY=value or KEY= or just KEY on a line)
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      // Match KEY=... or KEY on its own line
      if (trimmed.startsWith(envVar + '=') || trimmed === envVar) {
        return makeTier2Result(claim, {
          verdict: 'verified',
          evidence_files: [envFile],
          reasoning: `Environment variable '${envVar}' found in ${envFile}.`,
        });
      }
    }
  }

  // Check if any env files exist at all
  let anyEnvFileExists = false;
  for (const envFile of ENV_FILES) {
    if (await index.fileExists(claim.repo_id, envFile)) {
      anyEnvFileExists = true;
      break;
    }
  }

  if (anyEnvFileExists) {
    const existingEnvFiles: string[] = [];
    for (const f of ENV_FILES) {
      if (await index.fileExists(claim.repo_id, f)) existingEnvFiles.push(f);
    }
    return makeTier2Result(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: existingEnvFiles,
      reasoning: `Environment variable '${envVar}' not found in any .env file.`,
      specific_mismatch: `'${envVar}' is documented but not present in env configuration files.`,
    });
  }

  return null; // No env files to check
}

function extractEnvVarFromText(text: string): string | null {
  const match = text.match(ENV_VAR_PATTERN);
  if (!match) return null;
  const candidate = match[1];
  // Filter out common false positives
  if (['README', 'TODO', 'NOTE', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON', 'HTML', 'CSS'].includes(candidate)) {
    return null;
  }
  return candidate;
}

// === D.5: Tool Version Check ===

interface VersionFileSpec {
  file: string;
  tool: RegExp;
  extractVersion: (content: string) => string | null;
}

const VERSION_FILES: VersionFileSpec[] = [
  {
    file: '.nvmrc',
    tool: /\bNode\.?js\b/i,
    extractVersion: (content) => content.trim().replace(/^v/i, '') || null,
  },
  {
    file: '.node-version',
    tool: /\bNode\.?js\b/i,
    extractVersion: (content) => content.trim().replace(/^v/i, '') || null,
  },
  {
    file: '.python-version',
    tool: /\bPython\b/i,
    extractVersion: (content) => content.trim() || null,
  },
  {
    file: '.ruby-version',
    tool: /\bRuby\b/i,
    extractVersion: (content) => content.trim() || null,
  },
  {
    file: '.tool-versions',
    tool: /\b(?:Node\.?js|Python|Ruby|Go|Rust|Java)\b/i,
    extractVersion: (content) => null, // handled specially below
  },
];

async function toolVersionCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  // Extract runtime and claimed version from the claim
  const claimedRuntime = extractRuntime(claim.claim_text);
  if (!claimedRuntime) return null;

  const claimedVersion = extractClaimedVersion(claim);

  // Check dedicated version files
  for (const spec of VERSION_FILES) {
    if (!spec.tool.test(claim.claim_text)) continue;

    const content = await index.readFileContent(claim.repo_id, spec.file);
    if (content === null) continue;

    let actualVersion: string | null;

    if (spec.file === '.tool-versions') {
      actualVersion = extractFromToolVersions(content, claimedRuntime.toLowerCase());
    } else {
      actualVersion = spec.extractVersion(content);
    }

    if (!actualVersion) continue;

    if (!claimedVersion) {
      // No version claimed, just checking the runtime is configured
      return makeTier2Result(claim, {
        verdict: 'verified',
        evidence_files: [spec.file],
        reasoning: `${claimedRuntime} version ${actualVersion} configured in ${spec.file}.`,
      });
    }

    // Compare versions
    if (versionSatisfies(claimedVersion, actualVersion)) {
      return makeTier2Result(claim, {
        verdict: 'verified',
        evidence_files: [spec.file],
        reasoning: `${claimedRuntime} version ${actualVersion} in ${spec.file} satisfies documented '${claimedVersion}'.`,
      });
    }

    return makeTier2Result(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: [spec.file],
      reasoning: `${claimedRuntime} version mismatch: docs say '${claimedVersion}', ${spec.file} has '${actualVersion}'.`,
      specific_mismatch: `Documented version '${claimedVersion}' doesn't match configured '${actualVersion}'.`,
      suggested_fix: claim.claim_text.replace(claimedVersion, actualVersion),
    });
  }

  // Check package.json engines field for Node.js
  if (/\bNode\.?js\b/i.test(claim.claim_text)) {
    const pkgContent = await index.readFileContent(claim.repo_id, 'package.json');
    if (pkgContent) {
      try {
        const pkg = JSON.parse(pkgContent);
        const engineVersion = pkg?.engines?.node;
        if (engineVersion && claimedVersion) {
          if (versionSatisfies(claimedVersion, engineVersion.replace(/[>=<^~\s]/g, ''))) {
            return makeTier2Result(claim, {
              verdict: 'verified',
              evidence_files: ['package.json'],
              reasoning: `Node.js engine constraint '${engineVersion}' in package.json is consistent with documented '${claimedVersion}'.`,
            });
          }
        }
      } catch { /* skip unparseable */ }
    }
  }

  return null;
}

function extractRuntime(text: string): string | null {
  const match = text.match(/\b(Node\.?js|Python|Ruby|Go|Rust|Java|Deno|Bun)\b/i);
  return match ? match[1] : null;
}

function extractClaimedVersion(claim: Claim): string | null {
  const ver = claim.extracted_value.version as string | undefined;
  if (ver) return ver; // preserve "18+" suffix for versionSatisfies

  // Try extracting from claim text (include + suffix if present)
  const match = claim.claim_text.match(/\b(\d+(?:\.\d+)*\+?)\b/);
  return match ? match[1] : null;
}

function extractFromToolVersions(content: string, tool: string): string | null {
  const toolAliases: Record<string, string[]> = {
    'node.js': ['nodejs', 'node'],
    'nodejs': ['nodejs', 'node'],
    'python': ['python'],
    'ruby': ['ruby'],
    'go': ['golang', 'go'],
    'rust': ['rust'],
    'java': ['java'],
  };

  const aliases = toolAliases[tool] ?? [tool];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && aliases.includes(parts[0].toLowerCase())) {
      return parts[1];
    }
  }

  return null;
}

/** Check if a claimed version satisfies the actual version. Handles "18+", "18.x", ">=18". */
function versionSatisfies(claimed: string, actual: string): boolean {
  const cleanClaimed = claimed.replace(/[+x*]/g, '').replace(/^[v>=<^~]+/, '');
  const cleanActual = actual.replace(/^[v>=<^~]+/, '');

  if (!cleanClaimed || !cleanActual) return false;

  const claimedParts = cleanClaimed.split('.').map(Number);
  const actualParts = cleanActual.split('.').map(Number);

  // Compare only as many segments as the claimed version specifies
  for (let i = 0; i < claimedParts.length; i++) {
    if (isNaN(claimedParts[i]) || isNaN(actualParts[i])) return false;
    if (claimedParts[i] !== actualParts[i]) {
      // If claimed has + suffix, actual can be higher
      if (claimed.endsWith('+') && i === claimedParts.length - 1) {
        return actualParts[i] >= claimedParts[i];
      }
      return false;
    }
  }

  return true;
}
