import { Pool } from 'pg';
import { createCodebaseIndex } from './src/layers/L0-codebase-index/index.js';
import { initParser } from './src/layers/L0-codebase-index/ast-parser.js';
import { createClaimExtractor } from './src/layers/L1-claim-extractor/index.js';
import { createMapper } from './src/layers/L2-mapper/index.js';
import { createVerifier } from './src/layers/L3-verifier/index.js';
import { LearningServiceStub } from './src/layers/L7-learning/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const SKIP_REGION_RE = /<!--\s*docalign:skip[^>]*-->[\s\S]*?<!--\s*\/docalign:skip\s*-->/g;
const SEMANTIC_REGION_RE = /<!--\s*docalign:semantic[^>]*-->[\s\S]*?<!--\s*\/docalign:semantic\s*-->/g;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

function loadDir(dir, files = new Map()) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) loadDir(full, files);
    else {
      const rel = path.relative(dir, full);
      files.set(rel, fs.readFileSync(full, 'utf8'));
    }
  }
  return files;
}

async function main() {
  await initParser();
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repoId = randomUUID();

  try {
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status) VALUES ($1, 'test', 'debug-det-004', 1, 'main', 'active')`,
      [repoId]
    );

    // Load files
    const corpusDir = 'test/fixtures/corpora/synthetic-node/tagged';
    const files = loadDir(corpusDir);

    // Apply det-004 mutation (rename_file)
    const content = files.get('src/config/index.ts');
    files.delete('src/config/index.ts');
    files.set('src/config/config.ts', content);

    console.log('files has src/config/index.ts:', files.has('src/config/index.ts'));
    console.log('files has src/config/config.ts:', files.has('src/config/config.ts'));

    const index = createCodebaseIndex(pool);
    const learning = new LearningServiceStub();
    const extractor = createClaimExtractor(pool);
    const mapper = createMapper(pool, index, learning);
    const verifier = createVerifier(pool, index, mapper);

    const allFileChanges = Array.from(files.keys())
      .filter(p => !p.startsWith('.docalign/'))
      .map(p => ({ filename: p, status: 'added', additions: 1, deletions: 0 }));

    await index.updateFromDiff(repoId, allFileChanges, async (fp) => files.get(fp) ?? null);

    // Check fileExists
    const exists = await index.fileExists(repoId, 'src/config/index.ts');
    console.log('fileExists(src/config/index.ts):', exists);

    // Check repo_files
    const rf = await pool.query('SELECT path FROM repo_files WHERE repo_id = $1 AND path LIKE $2', [repoId, 'src/config%']);
    console.log('repo_files src/config/*:', rf.rows.map(r => r.path));

    // Extract claims from configuration.md
    const configDoc = files.get('docs/guides/configuration.md');
    if (configDoc) {
      const stripped = configDoc
        .replace(SKIP_REGION_RE, '')
        .replace(SEMANTIC_REGION_RE, '');

      const manifest = await index.getManifestMetadata(repoId);
      const knownPackages = new Set();
      if (manifest) {
        for (const pkg of Object.keys(manifest.dependencies ?? {})) knownPackages.add(pkg);
        for (const pkg of Object.keys(manifest.dev_dependencies ?? {})) knownPackages.add(pkg);
      }

      const claims = await extractor.extractSyntactic(repoId, 'docs/guides/configuration.md', stripped, undefined, knownPackages);
      const pathClaims = claims.filter(c => c.claim_type === 'path_reference');
      console.log('\npath_reference claims from configuration.md:');
      for (const c of pathClaims) {
        console.log(' -', c.claim_text, '|', c.extracted_value.path);
      }
    }

    // Run L1 for all doc files
    for (const [docPath, rawContent] of files) {
      if (!docPath.endsWith('.md')) continue;
      const stripped = rawContent
        .replace(SKIP_REGION_RE, '')
        .replace(SEMANTIC_REGION_RE, '');
      const manifest = await index.getManifestMetadata(repoId);
      const knownPackages = new Set();
      if (manifest) {
        for (const pkg of Object.keys(manifest.dependencies ?? {})) knownPackages.add(pkg);
        for (const pkg of Object.keys(manifest.dev_dependencies ?? {})) knownPackages.add(pkg);
      }
      await extractor.extractSyntactic(repoId, docPath, stripped, undefined, knownPackages);
    }

    // Get all claims
    const allClaims = await extractor.getClaimsByRepo(repoId);
    const pathRefClaims = allClaims.filter(c => c.claim_type === 'path_reference' && c.extracted_value.path === 'src/config/index.ts');
    console.log('\npath_reference claims for src/config/index.ts:', pathRefClaims.length);

    // Verify each
    for (const claim of pathRefClaims) {
      const mappings = await mapper.mapClaim(repoId, claim);
      const result = await verifier.verifyDeterministic(claim, mappings);
      console.log(' - claim_text:', claim.claim_text.substring(0, 60));
      console.log('   result:', result ? result.verdict + ' (' + (result.severity ?? 'no severity') + ')' : 'null');
    }

  } finally {
    await pool.query('DELETE FROM verification_results WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claim_mappings WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_manifests WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM code_entities WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repo_files WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
