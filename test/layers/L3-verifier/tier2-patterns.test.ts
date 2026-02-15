import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { verifyTier2 } from '../../../src/layers/L3-verifier/tier2-patterns';
import type { Claim } from '../../../src/shared/types';
import type { CodebaseIndexService } from '../../../src/layers/L0-codebase-index';

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
    claim_type: 'convention',
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

// === D.1: Strict Mode Check ===
describe('D.1: Strict Mode Check', () => {
  it('verifies when tsconfig has strict: true', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'tsconfig.json') return '{ "compilerOptions": { "strict": true } }';
        return null;
      },
    });
    const claim = makeClaim({ claim_text: 'TypeScript strict mode is enabled' });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('tsconfig.json');
  });

  it('reports drifted when strict is false', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'tsconfig.json') return '{ "compilerOptions": { "strict": false } }';
        return null;
      },
    });
    const claim = makeClaim({ claim_text: 'TypeScript uses strict mode' });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  it('reports drifted when strict is absent', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'tsconfig.json') return '{ "compilerOptions": { "target": "es2020" } }';
        return null;
      },
    });
    const claim = makeClaim({ claim_text: 'Uses strict: true for TypeScript' });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  it('returns null when no tsconfig.json exists', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_text: 'TypeScript strict mode' });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });

  it('handles tsconfig with comments', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'tsconfig.json') return `{
          // This is a comment
          "compilerOptions": {
            /* another comment */
            "strict": true
          }
        }`;
        return null;
      },
    });
    const claim = makeClaim({ claim_text: 'strict typescript mode' });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('ignores non-strict convention claims', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_text: 'All tests use .spec.ts naming' });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });
});

// === D.4: Environment Variable Check ===
describe('D.4: Environment Variable Check', () => {
  it('verifies env var found in .env.example', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.env.example') return 'DATABASE_URL=postgresql://localhost:5432/mydb\nREDIS_URL=redis://localhost:6379';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Set DATABASE_URL to configure the database',
      extracted_value: { env_var: 'DATABASE_URL' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('.env.example');
  });

  it('extracts env var from claim text when not in extracted_value', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.env.example') return 'API_KEY=your-key-here\nSECRET_TOKEN=xxx';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'config',
      claim_text: 'Set the API_KEY environment variable',
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('reports drifted when env var not found', async () => {
    const index = makeMockIndex({
      fileExists: async (_r, path) => path === '.env.example',
      readFileContent: async (_r, path) => {
        if (path === '.env.example') return 'OTHER_VAR=value';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Requires MISSING_VAR environment variable',
      extracted_value: { env_var: 'MISSING_VAR' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  it('skips commented lines in .env files', async () => {
    const index = makeMockIndex({
      fileExists: async (_r, path) => path === '.env.example',
      readFileContent: async (_r, path) => {
        if (path === '.env.example') return '# DATABASE_URL=old\nOTHER=val';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Set DATABASE_URL',
      extracted_value: { env_var: 'DATABASE_URL' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
  });

  it('returns null when no env files exist', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Set MY_VAR',
      extracted_value: { env_var: 'MY_VAR' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });
});

// === D.5: Tool Version Check ===
describe('D.5: Tool Version Check', () => {
  it('verifies Node.js version from .nvmrc', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.nvmrc') return '20.11.0\n';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Requires Node.js 20',
      extracted_value: { version: '20' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('.nvmrc');
  });

  it('detects Node.js version drift', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.nvmrc') return 'v18.17.0';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Requires Node.js 20',
      extracted_value: { version: '20' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
    expect(result!.reasoning).toContain('18.17.0');
  });

  it('verifies Python version from .python-version', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.python-version') return '3.11.5';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Python 3.11 is required',
      extracted_value: { version: '3.11' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('verifies from .tool-versions', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.tool-versions') return 'nodejs 20.10.0\npython 3.12.0';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Node.js 20 or later',
      extracted_value: { version: '20' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('verifies from package.json engines', async () => {
    const index = makeMockIndex({
      getManifestMetadata: async () => ({
        file_path: 'package.json',
        dependencies: {},
        dev_dependencies: {},
        scripts: {},
        source: 'manifest' as const,
        engines: { node: '>=18.0.0' },
      }),
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Requires Node.js 18',
      extracted_value: { version: '18' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(result!.evidence_files).toContain('package.json');
  });

  it('returns null for non-runtime claims', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Requires Docker installed',
    });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });

  it('handles version+ suffix', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.nvmrc') return '20.11.0';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'environment',
      claim_text: 'Requires Node.js 18+',
      extracted_value: { version: '18+' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });
});

// === D.2: Framework Import Check (existing) ===
describe('D.2: Framework Import Check', () => {
  it('verifies framework found via symbol search', async () => {
    const entity = {
      id: 'e1', repo_id: 'repo-1', file_path: 'src/app.ts', line_number: 1,
      end_line_number: 10, entity_type: 'function' as const, name: 'express',
      signature: 'function express()', embedding: null, raw_code: '',
      last_commit_sha: '', created_at: new Date(), updated_at: new Date(),
    };
    const index = makeMockIndex({
      findSymbol: async (_r, name) => name === 'express' ? [entity] : [],
    });
    const claim = makeClaim({
      claim_text: 'Built with Express',
      extracted_value: { framework: 'express' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });
});

// === Edge cases ===
describe('verifyTier2 edge cases', () => {
  it('returns null for non-convention/environment/config types', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_type: 'path_reference' });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });

  it('returns null for behavior claim type', async () => {
    const index = makeMockIndex();
    const claim = makeClaim({ claim_type: 'behavior' });
    const result = await verifyTier2(claim, index);
    expect(result).toBeNull();
  });

  it('handles config claim type for env var check', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === '.env.example') return 'MY_CONFIG=value';
        return null;
      },
    });
    const claim = makeClaim({
      claim_type: 'config',
      claim_text: 'Set MY_CONFIG in environment',
      extracted_value: { env_var: 'MY_CONFIG' },
    });
    const result = await verifyTier2(claim, index);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });
});
