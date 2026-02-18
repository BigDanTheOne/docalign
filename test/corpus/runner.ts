import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { Pool } from 'pg';
import { createCodebaseIndex } from '../../src/layers/L0-codebase-index';
import { createClaimExtractor } from '../../src/layers/L1-claim-extractor';
import { createMapper } from '../../src/layers/L2-mapper';
import { createVerifier } from '../../src/layers/L3-verifier';
import { LearningServiceStub } from '../../src/layers/L7-learning';
import type { FileChange } from '../../src/shared/types';
import type { RunOptions, RunResult, Finding, MutationChange, SidecarFile } from './types';
import { evaluateSidecar } from './sidecar-evaluator';

// Regex for stripping docalign:skip regions
const SKIP_REGION_RE =
  /<!--\s*docalign:skip[^>]*-->[\s\S]*?<!--\s*\/docalign:skip\s*-->/g;

// Regex for stripping docalign:semantic regions (content evaluated by sidecar, not L1)
const SEMANTIC_REGION_RE =
  /<!--\s*docalign:semantic[^>]*-->[\s\S]*?<!--\s*\/docalign:semantic\s*-->/g;

/**
 * Recursively load all files under a directory.
 * Returns a Map of relative-path -> content.
 */
function loadFilesFromDir(dir: string): Map<string, string> {
  const files = new Map<string, string>();

  function recurse(current: string) {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        recurse(fullPath);
      } else {
        const relPath = relative(dir, fullPath);
        const content = readFileSync(fullPath, 'utf8');
        files.set(relPath, content);
      }
    }
  }

  recurse(dir);
  return files;
}

/**
 * Determine if a file path is a doc file (.md).
 */
function isDocFile(path: string): boolean {
  return path.endsWith('.md');
}

/**
 * Determine if a file path is a code file (non-md, non-.docalign JSON).
 * Code files are all non-markdown, non-JSON-in-.docalign files in src/, .claude/.
 */
function isCodeFile(path: string): boolean {
  if (isDocFile(path)) return false;
  // Skip sidecar and other .docalign files
  if (path.startsWith('.docalign/')) return false;
  // Include source dirs and config files
  return (
    path.startsWith('src/') ||
    path.startsWith('.claude/') ||
    path === 'package.json' ||
    path === 'tsconfig.json' ||
    path === 'docker-compose.yml' ||
    path === '.env.example'
  );
}

/**
 * Apply a single mutation change to the in-memory file map.
 */
function applyMutationChange(
  files: Map<string, string>,
  change: MutationChange,
): void {
  switch (change.operation) {
    case 'delete_line_matching': {
      const content = files.get(change.file);
      if (content === undefined) return;
      const lines = content.split('\n');
      const idx = lines.findIndex(
        (line) => change.pattern !== undefined && line.includes(change.pattern),
      );
      if (idx !== -1) {
        lines.splice(idx, 1);
        files.set(change.file, lines.join('\n'));
      }
      break;
    }

    case 'replace_line_matching': {
      const content = files.get(change.file);
      if (content === undefined) return;
      const lines = content.split('\n');
      const idx = lines.findIndex(
        (line) => change.find !== undefined && line.includes(change.find),
      );
      if (idx !== -1 && change.replace !== undefined) {
        lines[idx] = change.replace;
        files.set(change.file, lines.join('\n'));
      }
      break;
    }

    case 'rename_file': {
      if (change.from === undefined || change.to === undefined) return;
      const content = files.get(change.from);
      if (content === undefined) return;
      files.delete(change.from);
      files.set(change.to, content);
      break;
    }

    case 'delete_file': {
      files.delete(change.file);
      break;
    }

    case 'set_json_field': {
      const content = files.get(change.file);
      if (content === undefined) return;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(content) as Record<string, unknown>;
      } catch {
        return;
      }
      if (change.path === undefined) return;
      const parts = change.path.split('.');
      let current: Record<string, unknown> = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (
          current[part] === undefined ||
          typeof current[part] !== 'object' ||
          current[part] === null
        ) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = change.value;
      files.set(change.file, JSON.stringify(obj, null, 2));
      break;
    }
  }
}

/**
 * The core corpus runner.
 * Takes pool and repoId as parameters (callers manage DB lifecycle).
 * Loads files from corpus, applies mutations, runs L0→L1→L2→L3 pipeline.
 */
export async function runCorpus(
  corpusPath: string,
  opts: RunOptions & { pool: Pool; repoId: string },
): Promise<RunResult> {
  const { pool, repoId, preTags, mutations, llmFixtures } = opts;

  // Determine which subdirectory to load
  const subDir = preTags ? 'tagged' : 'untagged';
  const corpusSubDir = join(corpusPath, subDir);

  if (!existsSync(corpusSubDir)) {
    throw new Error(
      `Corpus directory does not exist: ${corpusSubDir}. ` +
        `Run bootstrap workflow (Section 9 of CORPUS-DESIGN.md) first.`,
    );
  }

  // Load all files from the corpus directory
  const files = loadFilesFromDir(corpusSubDir);

  // Apply mutations (in-memory patches, no disk writes)
  if (mutations) {
    for (const mutation of mutations) {
      for (const change of mutation.changes) {
        applyMutationChange(files, change);
      }
    }
  }

  // Warn if llmFixtures path is provided but file doesn't exist
  if (llmFixtures !== undefined && !existsSync(llmFixtures)) {
    console.warn(
      `[corpus runner] Warning: llmFixtures path provided but file does not exist: ${llmFixtures}`,
    );
  }

  // Separate code files and doc files
  const codeFiles = new Map<string, string>();
  const docFiles = new Map<string, string>();

  for (const [path, content] of files) {
    if (isCodeFile(path)) {
      codeFiles.set(path, content);
    } else if (isDocFile(path)) {
      docFiles.set(path, content);
    }
  }

  // Create services
  const index = createCodebaseIndex(pool);
  const learning = new LearningServiceStub();
  const extractor = createClaimExtractor(pool);
  const mapper = createMapper(pool, index, learning);
  const verifier = createVerifier(pool, index, mapper);

  // Run L0: index ALL repo files for repo_files tracking.
  // updateFromDiff will AST-parse supported code files; non-code files are only tracked in repo_files.
  const allFileChanges: FileChange[] = Array.from(files.keys())
    .filter((path) => !path.startsWith('.docalign/'))
    .map((path) => ({
      filename: path,
      status: 'added' as const,
      additions: (files.get(path) ?? '').split('\n').length,
      deletions: 0,
    }));

  if (allFileChanges.length > 0) {
    await index.updateFromDiff(repoId, allFileChanges, async (filePath) => {
      return files.get(filePath) ?? null;
    });
  }

  // Run L1: extract claims from doc files
  let claimsExtracted = 0;

  // Build knownPackages from manifest for accurate dep_version extraction
  const manifest = await index.getManifestMetadata(repoId);
  const knownPackages = new Set<string>();
  if (manifest) {
    for (const pkg of Object.keys(manifest.dependencies ?? {})) knownPackages.add(pkg);
    for (const pkg of Object.keys(manifest.dev_dependencies ?? {})) knownPackages.add(pkg);
  }

  if (preTags) {
    // Use pre-tagged content with skip and semantic region stripping
    for (const [docPath, rawContent] of docFiles) {
      // Strip docalign:skip and docalign:semantic regions before passing to extractor
      const content = rawContent
        .replace(SKIP_REGION_RE, '')
        .replace(SEMANTIC_REGION_RE, '');
      const claims = await extractor.extractSyntactic(repoId, docPath, content, undefined, knownPackages);
      claimsExtracted += claims.length;
    }
  } else {
    // For untagged state: run extractSyntactic on untagged content
    // llmFixtures mechanism can be added later when P-EXTRACT prompt API is available
    for (const [docPath, content] of docFiles) {
      const claims = await extractor.extractSyntactic(repoId, docPath, content, undefined, knownPackages);
      claimsExtracted += claims.length;
    }
  }

  // Get all claims for this repo
  const allClaims = await extractor.getClaimsByRepo(repoId);

  // Run L2 + L3: map and verify each claim
  let claimsVerified = 0;

  for (const claim of allClaims) {
    const mappings = await mapper.mapClaim(repoId, claim);
    const result = await verifier.verifyDeterministic(claim, mappings);

    if (result !== null) {
      await verifier.storeResult(result);
      claimsVerified++;
    }
  }

  // Collect L3 findings from DB
  const dbResult = await pool.query<{
    id: string;
    claim_id: string;
    repo_id: string;
    verdict: string;
    severity: string | null;
    tier: number;
    claim_type: string;
    claim_text: string;
    source_file: string;
  }>(
    `SELECT vr.id, vr.claim_id, vr.repo_id, vr.verdict, vr.severity, vr.tier,
            c.claim_type, c.claim_text, c.source_file
     FROM verification_results vr
     JOIN claims c ON vr.claim_id = c.id
     WHERE vr.repo_id = $1`,
    [repoId],
  );

  const findings: Finding[] = dbResult.rows.map((row) => ({
    claim_id: row.claim_id,
    claim_type: row.claim_type,
    claim_text: row.claim_text,
    source_file: row.source_file,
    verdict: row.verdict as 'drifted' | 'verified' | 'uncertain',
    severity: row.severity,
    tier: row.tier,
    is_semantic: false,
  }));

  // Evaluate sidecar (semantic claims) if preTags: true and sidecar exists
  if (preTags) {
    const sidecarPath = join(corpusPath, 'tagged', '.docalign', 'semantic', 'claims.json');
    if (existsSync(sidecarPath)) {
      const sidecarContent = readFileSync(sidecarPath, 'utf8');
      const sidecarFile = JSON.parse(sidecarContent) as SidecarFile;

      // Build file map relative to tagged/ for sidecar scope matching
      const sidecarFindings = evaluateSidecar(sidecarFile, files);
      findings.push(...sidecarFindings);
    }
  }

  return {
    findings,
    claimsExtracted,
    claimsVerified,
  };
}
