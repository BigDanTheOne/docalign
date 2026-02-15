import { describe, it, expect } from 'vitest';
import { checkFrontmatterConsistency } from '../../../src/layers/L5-reporter/frontmatter-consistency';
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

describe('checkFrontmatterConsistency', () => {
  it('returns empty when file has no frontmatter', async () => {
    const index = makeMockIndex({
      readFileContent: async () => '# My Doc\n\nHello world.',
    });
    const findings = await checkFrontmatterConsistency('repo-1', 'docs/guide.md', index);
    expect(findings).toEqual([]);
  });

  it('returns empty when frontmatter title matches H1', async () => {
    const content = `---
title: Getting Started
---

# Getting Started

Welcome to the guide.`;
    const index = makeMockIndex({
      readFileContent: async () => content,
    });
    const findings = await checkFrontmatterConsistency('repo-1', 'docs/guide.md', index);
    expect(findings).toEqual([]);
  });

  it('detects title mismatch between frontmatter and H1', async () => {
    const content = `---
title: Getting Started
---

# Quick Start Guide

Welcome to the guide.`;
    const index = makeMockIndex({
      readFileContent: async () => content,
    });
    const findings = await checkFrontmatterConsistency('repo-1', 'docs/guide.md', index);
    expect(findings.length).toBe(1);
    expect(findings[0].result.verdict).toBe('drifted');
    expect(findings[0].result.reasoning).toContain('Getting Started');
    expect(findings[0].result.reasoning).toContain('Quick Start Guide');
  });

  it('returns empty when file does not exist', async () => {
    const index = makeMockIndex();
    const findings = await checkFrontmatterConsistency('repo-1', 'docs/missing.md', index);
    expect(findings).toEqual([]);
  });

  it('handles frontmatter with quoted title', async () => {
    const content = `---
title: "My Project"
---

# My Project

Content here.`;
    const index = makeMockIndex({
      readFileContent: async () => content,
    });
    const findings = await checkFrontmatterConsistency('repo-1', 'docs/guide.md', index);
    expect(findings).toEqual([]);
  });
});
