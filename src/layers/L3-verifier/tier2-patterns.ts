import type { Claim, ClaimMapping, VerificationResult, Severity } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import { findCloseMatch } from './close-match';
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
  mappings?: ClaimMapping[],
): Promise<VerificationResult | null> {
  if (claim.claim_type !== 'convention' && claim.claim_type !== 'environment' && claim.claim_type !== 'config'
    && claim.claim_type !== 'dependency_version') {
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

  // D.6: License consistency check (convention)
  if (claim.claim_type === 'convention') {
    const licenseResult = await licenseCheck(claim, index);
    if (licenseResult) return licenseResult;
  }

  // D.7: Changelog-to-version consistency (dependency_version in CHANGELOG files)
  if (claim.claim_type === 'dependency_version' && claim.source_file &&
      /changelog/i.test(claim.source_file)) {
    const changelogResult = await changelogVersionCheck(claim, index);
    if (changelogResult) return changelogResult;
  }

  // D.8: Deprecation awareness (any claim type with entity mappings)
  if (mappings && mappings.length > 0) {
    const deprecationResult = await deprecationCheck(claim, index, mappings);
    if (deprecationResult) return deprecationResult;
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
    const allEnvVarNames: string[] = [];
    for (const f of ENV_FILES) {
      if (await index.fileExists(claim.repo_id, f)) {
        existingEnvFiles.push(f);
        const content = await index.readFileContent(claim.repo_id, f);
        if (content) {
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) continue;
            const eqIdx = trimmed.indexOf('=');
            const name = eqIdx > 0 ? trimmed.slice(0, eqIdx).trim() : trimmed;
            if (name && /^[A-Z][A-Z0-9_]+$/.test(name)) {
              allEnvVarNames.push(name);
            }
          }
        }
      }
    }
    const close = findCloseMatch(envVar, [...new Set(allEnvVarNames)], 3);
    const suggestion = close ? ` Did you mean '${close.name}'?` : '';
    return makeTier2Result(claim, {
      verdict: 'drifted',
      severity: 'medium' as Severity,
      evidence_files: existingEnvFiles,
      reasoning: `Environment variable '${envVar}' not found in any .env file.${suggestion}`,
      specific_mismatch: `'${envVar}' is documented but not present in env configuration files.${suggestion}`,
    });
  }

  return null; // No env files to check
}

function extractEnvVarFromText(text: string): string | null {
  const match = text.match(ENV_VAR_PATTERN);
  if (!match) return null;
  const candidate = match[1];
  // Filter out common false positives — domain/tech acronyms that appear naturally
  // in docs but are never environment variable names.
  if ([
    'README', 'TODO', 'NOTE', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON', 'HTML', 'CSS',
    'SLA', 'SLO', 'SLI', 'TBD', 'MCP', 'CLI', 'SDK', 'JWT', 'TLS', 'SSL',
    'DNS', 'SQL', 'ORM', 'AWS', 'GCP', 'LLM', 'AST',
  ].includes(candidate)) {
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
    extractVersion: (_content) => null, // handled specially below
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

  // Check manifest engines field for any runtime
  const manifest = await index.getManifestMetadata(claim.repo_id);
  if (manifest?.engines) {
    // Map runtime name to engine key
    const engineKeyMap: Record<string, string[]> = {
      'node.js': ['node'],
      'nodejs': ['node'],
      'python': ['python', 'requires-python'],
      'go': ['go'],
      'rust': ['rust-edition'],
    };

    const runtimeLower = claimedRuntime.toLowerCase().replace(/\s+/g, '');
    const engineKeys = engineKeyMap[runtimeLower] ?? [runtimeLower];

    for (const key of engineKeys) {
      const engineVersion = manifest.engines[key];
      if (engineVersion && claimedVersion) {
        const cleanEngineVersion = engineVersion.replace(/[>=<^~\s]/g, '');
        if (versionSatisfies(claimedVersion, cleanEngineVersion)) {
          return makeTier2Result(claim, {
            verdict: 'verified',
            evidence_files: [manifest.file_path],
            reasoning: `${claimedRuntime} engine constraint '${engineVersion}' in ${manifest.file_path} is consistent with documented '${claimedVersion}'.`,
          });
        }
      }
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

// === D.6: License Consistency Check ===

const LICENSE_KEYWORDS: Record<string, string[]> = {
  'MIT': ['mit'],
  'Apache-2.0': ['apache-2', 'apache 2', 'apache2', 'apache-2.0', 'apache 2.0'],
  'GPL-3.0': ['gpl-3', 'gpl 3', 'gplv3', 'gpl-3.0'],
  'GPL-2.0': ['gpl-2', 'gpl 2', 'gplv2', 'gpl-2.0'],
  'BSD-2-Clause': ['bsd-2', 'bsd 2-clause', 'bsd2'],
  'BSD-3-Clause': ['bsd-3', 'bsd 3-clause', 'bsd3'],
  'ISC': ['isc'],
  'LGPL-3.0': ['lgpl-3', 'lgpl 3', 'lgplv3'],
  'MPL-2.0': ['mpl-2', 'mpl 2', 'mpl-2.0'],
  'AGPL-3.0': ['agpl-3', 'agpl 3', 'agplv3'],
  'Unlicense': ['unlicense'],
};

function detectLicenseInText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [spdx, keywords] of Object.entries(LICENSE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return spdx;
    }
  }
  return null;
}

async function licenseCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const docLicense = detectLicenseInText(claim.claim_text);
  if (!docLicense) return null;

  const manifest = await index.getManifestMetadata(claim.repo_id);
  if (!manifest?.license) return null;

  const manifestLicense = manifest.license;
  // Normalize both to SPDX for comparison
  const normalizedManifest = detectLicenseInText(manifestLicense) ?? manifestLicense;

  if (normalizedManifest === docLicense) {
    return makeTier2Result(claim, {
      verdict: 'verified',
      evidence_files: [manifest.file_path],
      reasoning: `License '${docLicense}' matches '${manifestLicense}' in ${manifest.file_path}.`,
    });
  }

  return makeTier2Result(claim, {
    verdict: 'drifted',
    severity: 'medium' as Severity,
    evidence_files: [manifest.file_path],
    reasoning: `Documentation says '${docLicense}' but ${manifest.file_path} has license '${manifestLicense}'.`,
    specific_mismatch: `License mismatch: documented '${docLicense}', manifest '${manifestLicense}'.`,
  });
}

// === D.7: Changelog-to-Version Consistency Check ===

const CHANGELOG_VERSION_PATTERN = /^##\s+\[?v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\]?/m;

async function changelogVersionCheck(
  claim: Claim,
  index: CodebaseIndexService,
): Promise<VerificationResult | null> {
  const manifest = await index.getManifestMetadata(claim.repo_id);
  if (!manifest?.version) return null;

  // Read the changelog file to find the latest version heading
  const changelogContent = await index.readFileContent(claim.repo_id, claim.source_file!);
  if (!changelogContent) return null;

  const match = changelogContent.match(CHANGELOG_VERSION_PATTERN);
  if (!match) return null;

  const changelogVersion = match[1];
  const manifestVersion = manifest.version;

  if (changelogVersion === manifestVersion) {
    return makeTier2Result(claim, {
      verdict: 'verified',
      evidence_files: [claim.source_file!, manifest.file_path],
      reasoning: `CHANGELOG latest version '${changelogVersion}' matches ${manifest.file_path} version '${manifestVersion}'.`,
    });
  }

  return makeTier2Result(claim, {
    verdict: 'drifted',
    severity: 'medium' as Severity,
    evidence_files: [claim.source_file!, manifest.file_path],
    reasoning: `CHANGELOG latest entry is '${changelogVersion}' but ${manifest.file_path} version is '${manifestVersion}'.`,
    specific_mismatch: `Version mismatch: CHANGELOG '${changelogVersion}', manifest '${manifestVersion}'.`,
  });
}

// === D.8: Deprecation Awareness Check ===

const DEPRECATION_MARKERS = /(?:@deprecated|@obsolete|\/\/\s*DEPRECATED|#\s*DEPRECATED)/i;

async function deprecationCheck(
  claim: Claim,
  index: CodebaseIndexService,
  mappings: ClaimMapping[],
): Promise<VerificationResult | null> {
  // Only check mappings that have entity IDs
  const entityMappings = mappings.filter((m) => m.code_entity_id);
  if (entityMappings.length === 0) return null;

  for (const mapping of entityMappings) {
    const entity = await index.getEntityById(mapping.code_entity_id!);
    if (!entity?.raw_code) continue;

    if (DEPRECATION_MARKERS.test(entity.raw_code)) {
      // Check if the doc already mentions deprecation
      const docMentionsDeprecation = /\bdeprecated?\b/i.test(claim.claim_text);
      if (docMentionsDeprecation) continue;

      return makeTier2Result(claim, {
        verdict: 'drifted',
        severity: 'low' as Severity,
        evidence_files: [entity.file_path],
        reasoning: `Symbol '${entity.name}' is marked @deprecated in '${entity.file_path}' but documentation references it without noting deprecation.`,
        specific_mismatch: `'${entity.name}' is deprecated in code but not in documentation.`,
      });
    }
  }

  return null;
}
