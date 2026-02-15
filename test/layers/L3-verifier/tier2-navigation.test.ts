import { describe, it, expect } from 'vitest';
import { verifyNavigationConfig } from '../../../src/layers/L3-verifier/tier2-navigation';
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

describe('verifyNavigationConfig', () => {
  it('returns empty when no nav config files exist', async () => {
    const index = makeMockIndex();
    const results = await verifyNavigationConfig('repo-1', index);
    expect(results).toEqual([]);
  });

  it('detects broken links in markdown sidebar', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'docs/_sidebar.md') {
          return '- [Home](index.md)\n- [Guide](guide.md)\n- [API](api/reference.md)';
        }
        return null;
      },
      fileExists: async (_r, path) => {
        return path === 'index.md'; // Only index.md exists
      },
    });

    const results = await verifyNavigationConfig('repo-1', index);
    expect(results.length).toBe(2); // guide.md and api/reference.md broken
    expect(results[0].verdict).toBe('drifted');
    expect(results[0].severity).toBe('high');
  });

  it('returns empty when all sidebar links resolve', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'docs/_sidebar.md') {
          return '- [Home](index.md)\n- [Guide](guide.md)';
        }
        return null;
      },
      fileExists: async () => true,
    });

    const results = await verifyNavigationConfig('repo-1', index);
    expect(results).toEqual([]);
  });

  it('detects broken paths in JSON nav config', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'mint.json') {
          return JSON.stringify({
            navigation: [
              { group: 'Guide', pages: ['intro.md', 'setup.md'] },
            ],
          });
        }
        return null;
      },
      fileExists: async (_r, path) => path === 'intro.md',
    });

    const results = await verifyNavigationConfig('repo-1', index);
    expect(results.length).toBe(1);
    expect(results[0].reasoning).toContain('setup.md');
  });

  it('detects broken paths in YAML nav config', async () => {
    const index = makeMockIndex({
      readFileContent: async (_r, path) => {
        if (path === 'mkdocs.yml') {
          return 'nav:\n  - Home: index.md\n  - Guide: guide/start.md\n  - Missing: gone.md';
        }
        return null;
      },
      fileExists: async (_r, path) => {
        return path === 'index.md' || path === 'guide/start.md';
      },
    });

    const results = await verifyNavigationConfig('repo-1', index);
    expect(results.length).toBe(1);
    expect(results[0].reasoning).toContain('gone.md');
  });
});
