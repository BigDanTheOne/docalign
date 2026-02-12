import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { ClaimStore } from '../../../src/layers/L1-claim-extractor/claim-store';
import { extractSyntactic, discoverDocFiles } from '../../../src/layers/L1-claim-extractor/syntactic';
import { randomUUID } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://docalign:docalign@localhost:5432/docalign_dev';

describe('extractSyntactic', () => {
  let pool: Pool;
  let claimStore: ClaimStore;
  let repoId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    claimStore = new ClaimStore(pool);

    repoId = randomUUID();
    await pool.query(
      `INSERT INTO repos (id, github_owner, github_repo, github_installation_id, default_branch, status)
       VALUES ($1, 'test-owner', 'syntactic-test', 1, 'main', 'active')`,
      [repoId],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
    await pool.query('DELETE FROM repos WHERE id = $1', [repoId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM claims WHERE repo_id = $1', [repoId]);
  });

  it('extracts path claims from markdown', async () => {
    const content = '# My Project\nCheck `src/auth/handler.ts` for auth.\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    const pathClaim = claims.find((c) => c.claim_type === 'path_reference');
    expect(pathClaim).toBeDefined();
    expect(pathClaim!.extracted_value.path).toBe('src/auth/handler.ts');
  });

  it('extracts command claims', async () => {
    const content = '```bash\nnpm install express\n```\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    const cmdClaim = claims.find((c) => c.claim_type === 'command');
    expect(cmdClaim).toBeDefined();
  });

  it('extracts API route claims', async () => {
    const content = 'Send a GET /api/v2/users request.\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore);
    const routeClaim = claims.find((c) => c.claim_type === 'api_route');
    expect(routeClaim).toBeDefined();
    expect(routeClaim!.extracted_value.method).toBe('GET');
  });

  it('extracts code example claims', async () => {
    const content = '```typescript\nimport express from "express";\nconst app = express();\n```\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore);
    const codeClaim = claims.find((c) => c.claim_type === 'code_example');
    expect(codeClaim).toBeDefined();
  });

  it('returns empty for empty content', async () => {
    const claims = await extractSyntactic(repoId, 'README.md', '', claimStore);
    expect(claims).toHaveLength(0);
  });

  it('returns empty for binary content', async () => {
    const claims = await extractSyntactic(repoId, 'README.md', 'binary\0content', claimStore);
    expect(claims).toHaveLength(0);
  });

  it('returns empty for RST files', async () => {
    const claims = await extractSyntactic(repoId, 'readme.rst', '`src/a.ts`', claimStore);
    expect(claims).toHaveLength(0);
  });

  it('returns empty for files over 100KB', async () => {
    const bigContent = 'a'.repeat(101 * 1024);
    const claims = await extractSyntactic(repoId, 'README.md', bigContent, claimStore);
    expect(claims).toHaveLength(0);
  });

  it('respects enabled_claim_types config', async () => {
    const content = 'Check `src/a.ts`.\nGET /api/users\n```bash\nnpm test\n```\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore, {
      enabled_claim_types: new Set(['path_reference'] as const),
    });
    // Only path_reference should be extracted
    for (const claim of claims) {
      expect(claim.claim_type).toBe('path_reference');
    }
  });

  it('deduplicates within file', async () => {
    const content = 'Check `src/a.ts` first.\nAlso check `src/a.ts` again.\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore);
    const pathClaims = claims.filter((c) =>
      c.claim_type === 'path_reference' && c.extracted_value.path === 'src/a.ts',
    );
    // After dedup, only 1
    expect(pathClaims).toHaveLength(1);
  });

  it('stores claims in database', async () => {
    const content = 'Check `src/a.ts`.\n';
    await extractSyntactic(repoId, 'README.md', content, claimStore);

    const dbClaims = await claimStore.getClaimsByFile(repoId, 'README.md');
    expect(dbClaims.length).toBeGreaterThanOrEqual(1);
  });

  it('sets correct claim fields', async () => {
    const content = 'Check `src/a.ts`.\n';
    const claims = await extractSyntactic(repoId, 'README.md', content, claimStore);
    const claim = claims.find((c) => c.claim_type === 'path_reference');
    expect(claim).toBeDefined();
    expect(claim!.repo_id).toBe(repoId);
    expect(claim!.source_file).toBe('README.md');
    expect(claim!.extraction_method).toBe('regex');
    expect(claim!.extraction_confidence).toBe(1.0);
    expect(claim!.testability).toBe('syntactic');
    expect(claim!.verification_status).toBe('pending');
    expect(claim!.keywords.length).toBeGreaterThan(0);
  });
});

describe('discoverDocFiles', () => {
  it('discovers README.md', () => {
    const files = discoverDocFiles(['README.md', 'src/app.ts']);
    expect(files).toContain('README.md');
  });

  it('discovers docs directory files', () => {
    const files = discoverDocFiles(['docs/api.md', 'docs/setup.mdx', 'src/app.ts']);
    expect(files).toContain('docs/api.md');
    expect(files).toContain('docs/setup.mdx');
  });

  it('discovers CONTRIBUTING.md and ARCHITECTURE.md', () => {
    const files = discoverDocFiles(['CONTRIBUTING.md', 'ARCHITECTURE.md']);
    expect(files).toContain('CONTRIBUTING.md');
    expect(files).toContain('ARCHITECTURE.md');
  });

  it('discovers CLAUDE.md and AGENTS.md', () => {
    const files = discoverDocFiles(['CLAUDE.md', 'AGENTS.md', 'subdir/CLAUDE.md']);
    expect(files).toContain('CLAUDE.md');
    expect(files).toContain('AGENTS.md');
    expect(files).toContain('subdir/CLAUDE.md');
  });

  it('discovers root-level .md files via heuristic', () => {
    const files = discoverDocFiles(['INSTALL.md', 'guides/setup.md', 'src/deep/nested.md']);
    expect(files).toContain('INSTALL.md');
    // Subdirectory .md files only matched via DOC_PATTERNS (docs/, doc/, wiki/, etc.)
    expect(files).not.toContain('guides/setup.md');
    expect(files).not.toContain('src/deep/nested.md');
  });

  it('discovers .md files in doc-pattern directories', () => {
    const files = discoverDocFiles(['docs/setup.md', 'doc/api.md', 'wiki/home.md', 'guides/setup.md']);
    expect(files).toContain('docs/setup.md');
    expect(files).toContain('doc/api.md');
    expect(files).toContain('wiki/home.md');
    // guides/ is not in DOC_PATTERNS
    expect(files).not.toContain('guides/setup.md');
  });

  it('excludes node_modules', () => {
    const files = discoverDocFiles(['node_modules/pkg/README.md', 'README.md']);
    expect(files).not.toContain('node_modules/pkg/README.md');
    expect(files).toContain('README.md');
  });

  it('excludes CHANGELOG.md', () => {
    const files = discoverDocFiles(['CHANGELOG.md', 'README.md']);
    expect(files).not.toContain('CHANGELOG.md');
  });

  it('excludes LICENSE.md', () => {
    const files = discoverDocFiles(['LICENSE.md', 'README.md']);
    expect(files).not.toContain('LICENSE.md');
  });

  it('excludes vendor and .git', () => {
    const files = discoverDocFiles(['vendor/pkg/README.md', '.git/hooks/README.md', 'README.md']);
    expect(files).not.toContain('vendor/pkg/README.md');
    expect(files).not.toContain('.git/hooks/README.md');
  });

  it('returns sorted results', () => {
    const files = discoverDocFiles(['docs/z.md', 'docs/a.md', 'README.md']);
    expect(files).toEqual([...files].sort());
  });

  it('returns empty for no doc files', () => {
    const files = discoverDocFiles(['src/app.ts', 'package.json']);
    expect(files).toHaveLength(0);
  });
});
