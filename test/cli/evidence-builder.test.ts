import { describe, it, expect, vi } from 'vitest';
import { buildEvidence } from '../../src/cli/evidence-builder';
import type { Claim, CodeEntity } from '../../src/shared/types';
import type { CodebaseIndexService } from '../../src/layers/L0-codebase-index';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    repo_id: 'local',
    source_file: 'README.md',
    line_number: 10,
    claim_text: 'Uses Express for routing',
    claim_type: 'behavior',
    extracted_value: {},
    testability: 'semantic',
    keywords: ['Express', 'routing'],
    identity_key: 'test',
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

function makeEntity(overrides: Partial<CodeEntity> = {}): CodeEntity {
  return {
    id: 'entity-1',
    repo_id: 'local',
    file_path: 'src/app.ts',
    line_number: 5,
    end_line_number: 20,
    entity_type: 'function',
    name: 'createApp',
    signature: 'function createApp(): Express',
    embedding: null,
    raw_code: 'function createApp() { return express(); }',
    last_commit_sha: '',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function mockIndex(entities: CodeEntity[] = [], fileContent?: string): CodebaseIndexService {
  return {
    fileExists: vi.fn().mockResolvedValue(false),
    getFileTree: vi.fn().mockResolvedValue([]),
    findSymbol: vi.fn().mockImplementation(async (_repoId: string, name: string) => {
      return entities.filter(
        (e) => e.name.toLowerCase().includes(name.toLowerCase()),
      );
    }),
    getEntityByFile: vi.fn().mockResolvedValue([]),
    getEntityById: vi.fn().mockResolvedValue(null),
    findRoute: vi.fn().mockResolvedValue(null),
    searchRoutes: vi.fn().mockResolvedValue([]),
    getDependencyVersion: vi.fn().mockResolvedValue(null),
    scriptExists: vi.fn().mockResolvedValue(false),
    getAvailableScripts: vi.fn().mockResolvedValue([]),
    searchSemantic: vi.fn().mockResolvedValue([]),
    updateFromDiff: vi.fn().mockResolvedValue({
      entities_added: 0,
      entities_updated: 0,
      entities_removed: 0,
      files_skipped: [],
    }),
    readFileContent: vi.fn().mockResolvedValue(fileContent ?? null),
    getManifestMetadata: vi.fn().mockResolvedValue(null),
    getHeadings: vi.fn().mockResolvedValue([]),
  };
}

describe('buildEvidence', () => {
  it('returns empty evidence when no entities match', async () => {
    const index = mockIndex();
    const claim = makeClaim();
    const result = await buildEvidence(claim, index);

    expect(result.formattedEvidence).toBe('');
    expect(result.evidenceFiles).toEqual([]);
  });

  it('formats evidence from matching entities', async () => {
    const entity = makeEntity();
    const index = mockIndex([entity]);
    const claim = makeClaim({ keywords: ['createApp'] });
    const result = await buildEvidence(claim, index);

    expect(result.formattedEvidence).toContain('src/app.ts');
    expect(result.formattedEvidence).toContain('createApp');
    expect(result.formattedEvidence).toContain('function createApp()');
    expect(result.evidenceFiles).toContain('src/app.ts');
  });

  it('groups multiple entities from same file', async () => {
    const entities = [
      makeEntity({ name: 'createApp', line_number: 5 }),
      makeEntity({ id: 'entity-2', name: 'setupRoutes', line_number: 25, signature: 'function setupRoutes()' }),
    ];
    const index = mockIndex(entities);
    // findSymbol returns all entities for any keyword matching
    (index.findSymbol as ReturnType<typeof vi.fn>).mockResolvedValue(entities);

    const claim = makeClaim({ keywords: ['createApp'] });
    const result = await buildEvidence(claim, index);

    expect(result.evidenceFiles).toHaveLength(1);
    expect(result.formattedEvidence).toContain('createApp');
    expect(result.formattedEvidence).toContain('setupRoutes');
  });

  it('limits to MAX_FILES (5) files', async () => {
    const entities = Array.from({ length: 10 }, (_, i) =>
      makeEntity({
        id: `entity-${i}`,
        name: `func${i}`,
        file_path: `src/file${i}.ts`,
        raw_code: `function func${i}() {}`,
      }),
    );
    const index = mockIndex(entities);
    (index.findSymbol as ReturnType<typeof vi.fn>).mockResolvedValue(entities);

    const claim = makeClaim({ keywords: ['func'] });
    const result = await buildEvidence(claim, index);

    expect(result.evidenceFiles.length).toBeLessThanOrEqual(5);
  });

  it('falls back to semantic search when no keyword matches', async () => {
    const entity = makeEntity({ name: 'router' });
    const index = mockIndex([]);
    (index.searchSemantic as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...entity, similarity: 0.5 },
    ]);

    const claim = makeClaim({ keywords: [] });
    const result = await buildEvidence(claim, index);

    expect(index.searchSemantic).toHaveBeenCalled();
    expect(result.formattedEvidence).toContain('router');
  });

  it('includes entity signatures and raw code', async () => {
    const entity = makeEntity({
      name: 'handleRequest',
      signature: 'async function handleRequest(req: Request): Promise<Response>',
      raw_code: 'async function handleRequest(req) {\n  return new Response();\n}',
    });
    const index = mockIndex([entity]);
    const claim = makeClaim({ keywords: ['handleRequest'] });
    const result = await buildEvidence(claim, index);

    expect(result.formattedEvidence).toContain('async function handleRequest');
    expect(result.formattedEvidence).toContain('return new Response()');
  });

  it('reads file content as last resort for path claims', async () => {
    const index = mockIndex([], 'const x = 42;');
    const claim = makeClaim({
      keywords: [],
      extracted_value: { path: 'src/config.ts' },
    });
    const result = await buildEvidence(claim, index);

    expect(index.readFileContent).toHaveBeenCalledWith('local', 'src/config.ts');
    expect(result.formattedEvidence).toContain('const x = 42');
    expect(result.evidenceFiles).toContain('src/config.ts');
  });
});
