import type { Claim, MappingMethod } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';

/**
 * Runner-to-manifest file map (TDD-2 Appendix F).
 */
const RUNNER_MANIFEST_MAP: Record<string, string[]> = {
  npm: ['package.json'],
  npx: ['package.json'],
  yarn: ['package.json'],
  pnpm: ['package.json'],
  bun: ['package.json'],
  pip: ['requirements.txt', 'setup.py', 'pyproject.toml'],
  pip3: ['requirements.txt', 'setup.py', 'pyproject.toml'],
  poetry: ['pyproject.toml'],
  cargo: ['Cargo.toml'],
  maven: ['pom.xml'],
  mvn: ['pom.xml'],
  gradle: ['build.gradle', 'build.gradle.kts'],
  go: ['go.mod'],
  gem: ['Gemfile'],
  bundle: ['Gemfile'],
  composer: ['composer.json'],
  dotnet: ['*.csproj', '*.fsproj'],
};

export { RUNNER_MANIFEST_MAP };

export interface MappingCandidate {
  code_file: string;
  code_entity_id: string | null;
  confidence: number;
  co_change_boost: number;
  mapping_method: MappingMethod;
}

/**
 * Step 1: Direct Reference mapping.
 * TDD-2 Section 4.1, Appendix A.1-A.4.
 */
export async function mapDirectReference(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  switch (claim.claim_type) {
    case 'path_reference':
      return mapPathReference(repoId, claim, index);
    case 'command':
      return mapCommand(repoId, claim, index);
    case 'dependency_version':
      return mapDependencyVersion(repoId, claim, index);
    case 'api_route':
      return mapApiRoute(repoId, claim, index);
    default:
      return [];
  }
}

async function mapPathReference(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  const path = claim.extracted_value.path as string;
  if (!path) return [];

  const exists = await index.fileExists(repoId, path);
  if (exists) {
    return [{
      code_file: path,
      code_entity_id: null,
      confidence: 1.0,
      co_change_boost: 0.0,
      mapping_method: 'direct_reference',
    }];
  }
  return [];
}

async function mapCommand(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  const runner = claim.extracted_value.runner as string | undefined;
  const script = claim.extracted_value.script as string | undefined;
  if (!script) return [];

  const exists = await index.scriptExists(repoId, script);
  if (exists) {
    const manifestFiles = runner ? (RUNNER_MANIFEST_MAP[runner] ?? ['package.json']) : ['package.json'];
    return [{
      code_file: manifestFiles[0],
      code_entity_id: null,
      confidence: 1.0,
      co_change_boost: 0.0,
      mapping_method: 'direct_reference',
    }];
  }
  return [];
}

async function mapDependencyVersion(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  const pkg = claim.extracted_value.package as string | undefined;
  if (!pkg) return [];

  const dep = await index.getDependencyVersion(repoId, pkg);
  if (dep) {
    return [{
      code_file: 'package.json', // Default; actual manifest file from manifest data
      code_entity_id: null,
      confidence: 1.0,
      co_change_boost: 0.0,
      mapping_method: 'direct_reference',
    }];
  }
  return [];
}

async function mapApiRoute(
  repoId: string,
  claim: Claim,
  index: CodebaseIndexService,
): Promise<MappingCandidate[]> {
  const method = claim.extracted_value.method as string | undefined;
  const routePath = claim.extracted_value.path as string | undefined;
  if (!method || !routePath) return [];

  // Step 1: Exact route match
  const route = await index.findRoute(repoId, method, routePath);
  if (route) {
    return [{
      code_file: route.file_path,
      code_entity_id: route.id,
      confidence: 1.0,
      co_change_boost: 0.0,
      mapping_method: 'direct_reference',
    }];
  }

  // Step 1b: Fuzzy route search
  const alternatives = await index.searchRoutes(repoId, routePath);
  const fuzzyMatch = alternatives.find((a) => a.similarity >= 0.7);
  if (fuzzyMatch) {
    return [{
      code_file: fuzzyMatch.file,
      code_entity_id: null,
      confidence: fuzzyMatch.similarity,
      co_change_boost: 0.0,
      mapping_method: 'direct_reference',
    }];
  }

  return [];
}
