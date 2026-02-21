/**
 * Unit tests for the doc-map Step 0 utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadDocMap,
  saveDocMap,
  getDocMapEntry,
  buildDocFileSnippets,
  renderDocFileSnippets,
  docMapPath,
  type DocMap,
} from '../../src/cli/doc-map';

// === Helpers ===

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-doc-map-test-'));
}

function makeDocMap(overrides?: Partial<DocMap>): DocMap {
  return {
    generated_at: '2026-01-01T00:00:00.000Z',
    repo_path: '/fake/repo',
    entries: [],
    ...overrides,
  };
}

// === Tests ===

describe('docMapPath', () => {
  it('returns path inside .docalign directory', () => {
    const p = docMapPath('/repo');
    expect(p).toBe(path.join('/repo', '.docalign', 'doc-map.json'));
  });
});

describe('loadDocMap / saveDocMap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when doc-map file does not exist', () => {
    const result = loadDocMap(tmpDir);
    expect(result).toBeNull();
  });

  it('round-trips a doc-map through save and load', () => {
    const docMap = makeDocMap({
      repo_path: tmpDir,
      entries: [
        {
          file: 'docs/getting-started.md',
          doc_type: 'getting_started',
          audience: 'user',
          skip_hint: 'Tutorial with code examples',
        },
      ],
    });

    saveDocMap(tmpDir, docMap);
    const loaded = loadDocMap(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.entries).toHaveLength(1);
    expect(loaded!.entries[0].file).toBe('docs/getting-started.md');
    expect(loaded!.entries[0].doc_type).toBe('getting_started');
    expect(loaded!.entries[0].skip_hint).toBe('Tutorial with code examples');
  });

  it('creates .docalign directory if it does not exist', () => {
    const docMap = makeDocMap({ repo_path: tmpDir });
    const docalignDir = path.join(tmpDir, '.docalign');

    expect(fs.existsSync(docalignDir)).toBe(false);
    saveDocMap(tmpDir, docMap);
    expect(fs.existsSync(docalignDir)).toBe(true);
    expect(fs.existsSync(docMapPath(tmpDir))).toBe(true);
  });

  it('overwrites an existing doc-map on re-save', () => {
    const first = makeDocMap({ entries: [] });
    const second = makeDocMap({
      generated_at: '2026-02-01T00:00:00.000Z',
      entries: [{ file: 'docs/ref.md', doc_type: 'reference', audience: 'user' }],
    });

    saveDocMap(tmpDir, first);
    saveDocMap(tmpDir, second);
    const loaded = loadDocMap(tmpDir);

    expect(loaded!.generated_at).toBe('2026-02-01T00:00:00.000Z');
    expect(loaded!.entries).toHaveLength(1);
  });
});

describe('getDocMapEntry', () => {
  it('returns the matching entry by file path', () => {
    const docMap = makeDocMap({
      entries: [
        { file: 'docs/reference/cli.md', doc_type: 'reference', audience: 'user' },
        { file: 'docs/contributing/adding-a-check.md', doc_type: 'contributing', audience: 'contributor' },
      ],
    });

    const entry = getDocMapEntry(docMap, 'docs/reference/cli.md');
    expect(entry).not.toBeUndefined();
    expect(entry!.doc_type).toBe('reference');
  });

  it('returns undefined for an unknown file', () => {
    const docMap = makeDocMap({ entries: [] });
    expect(getDocMapEntry(docMap, 'docs/nonexistent.md')).toBeUndefined();
  });
});

describe('buildDocFileSnippets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts frontmatter and headings from a markdown file', () => {
    const content = [
      '---',
      'title: "Getting Started"',
      'description: "Quick intro"',
      'category: "user-guide"',
      '---',
      '',
      '# Getting Started',
      '',
      'Some text.',
      '',
      '## Prerequisites',
      '',
      '### Node.js',
    ].join('\n');

    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'getting-started.md'), content);

    const snippets = buildDocFileSnippets(tmpDir, ['docs/getting-started.md']);
    expect(snippets).toHaveLength(1);

    const s = snippets[0];
    expect(s.file).toBe('docs/getting-started.md');
    expect(s.frontmatter['title']).toBe('Getting Started');
    expect(s.frontmatter['description']).toBe('Quick intro');
    expect(s.headings).toContain('- Getting Started');
    expect(s.headings).toContain('  - Prerequisites');
    expect(s.headings).toContain('    - Node.js');
  });

  it('extracts read_when as a string array', () => {
    const content = [
      '---',
      'title: "CLI Reference"',
      'summary: "All commands and flags"',
      'read_when:',
      '  - Looking up a specific command',
      '  - Scripting DocAlign',
      '---',
      '',
      '# CLI Reference',
    ].join('\n');

    fs.writeFileSync(path.join(tmpDir, 'cli.md'), content);

    const snippets = buildDocFileSnippets(tmpDir, ['cli.md']);
    const s = snippets[0];
    expect(s.frontmatter['title']).toBe('CLI Reference');
    expect(s.frontmatter['summary']).toBe('All commands and flags');
    const readWhen = s.frontmatter['read_when'];
    expect(Array.isArray(readWhen)).toBe(true);
    expect(readWhen).toEqual(['Looking up a specific command', 'Scripting DocAlign']);
  });

  it('returns empty frontmatter and headings for a file without them', () => {
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'empty.md'), 'Just prose, no headings.');

    const snippets = buildDocFileSnippets(tmpDir, ['docs/empty.md']);
    expect(snippets[0].frontmatter).toEqual({});
    expect(snippets[0].headings).toEqual([]);
  });

  it('returns empty snippet for a non-existent file', () => {
    const snippets = buildDocFileSnippets(tmpDir, ['docs/missing.md']);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].file).toBe('docs/missing.md');
    expect(snippets[0].frontmatter).toEqual({});
    expect(snippets[0].headings).toEqual([]);
  });

  it('only extracts H1–H3 headings (ignores H4+)', () => {
    const content = '# H1\n## H2\n### H3\n#### H4\n##### H5\n';
    fs.writeFileSync(path.join(tmpDir, 'test.md'), content);

    const snippets = buildDocFileSnippets(tmpDir, ['test.md']);
    const h = snippets[0].headings;
    expect(h).toContain('- H1');
    expect(h).toContain('  - H2');
    expect(h).toContain('    - H3');
    // H4 and H5 should not be present
    expect(h.some((line) => line.includes('H4') || line.includes('H5'))).toBe(false);
  });
});

describe('renderDocFileSnippets', () => {
  it('renders a snippet with frontmatter and headings', () => {
    const entry: DocFileSnippet = {
      file: 'docs/reference/cli.md',
      frontmatter: { title: 'CLI Reference', category: 'reference' },
      headings: ['- CLI Reference', '  - Commands', '    - scan'],
    };
    const rendered = renderDocFileSnippets([entry]);

    expect(rendered).toContain('## docs/reference/cli.md');
    expect(rendered).toContain('title: CLI Reference');
    expect(rendered).toContain('- Commands');
  });

  it('renders read_when as indented list items', () => {
    const entry: DocFileSnippet = {
      file: 'docs/reference/cli.md',
      frontmatter: {
        title: 'CLI Reference',
        read_when: ['Looking up a command', 'Scripting DocAlign'],
      },
      headings: [],
    };
    const rendered = renderDocFileSnippets([entry]);

    expect(rendered).toContain('  read_when:');
    expect(rendered).toContain('    - Looking up a command');
    expect(rendered).toContain('    - Scripting DocAlign');
  });

  it('excludes the related field from rendered output', () => {
    const entry: DocFileSnippet = {
      file: 'docs/test.md',
      frontmatter: {
        title: 'Test',
        related: ['docs/other.md', 'docs/another.md'],
      },
      headings: [],
    };
    const rendered = renderDocFileSnippets([entry]);
    expect(rendered).not.toContain('related');
    expect(rendered).not.toContain('docs/other.md');
  });

  it('renders a snippet with no frontmatter', () => {
    const entry: DocFileSnippet = {
      file: 'AGENTS.md',
      frontmatter: {},
      headings: ['- DocAlign MCP'],
    };
    const rendered = renderDocFileSnippets([entry]);
    expect(rendered).toContain('## AGENTS.md');
    expect(rendered).toContain('- DocAlign MCP');
    // No frontmatter lines
    expect(rendered).not.toContain('title:');
  });

  it('renders multiple snippets separated by blank lines', () => {
    const snippets: DocFileSnippet[] = [
      { file: 'a.md', frontmatter: {}, headings: ['- A'] },
      { file: 'b.md', frontmatter: {}, headings: ['- B'] },
    ];
    const rendered = renderDocFileSnippets(snippets);
    expect(rendered).toContain('## a.md');
    expect(rendered).toContain('## b.md');
  });
});

// Import the type needed for the test above
import type { DocFileSnippet } from '../../src/cli/doc-map';
import { writeFrontmatterFields } from '../../src/cli/doc-map';

describe('writeFrontmatterFields', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts summary and read_when after title line', () => {
    const content = [
      '---',
      'title: "CLI Reference"',
      'description: "All commands."',
      '---',
      '',
      '# CLI Reference',
    ].join('\n');
    const file = path.join(tmpDir, 'cli.md');
    fs.writeFileSync(file, content);

    writeFrontmatterFields(file, {
      summary: 'All commands and flags',
      read_when: ['Looking up flags', 'Scripting DocAlign'],
    });

    const result = fs.readFileSync(file, 'utf-8');
    expect(result).toContain('summary: "All commands and flags"');
    expect(result).toContain('read_when:');
    expect(result).toContain('  - Looking up flags');
    expect(result).toContain('  - Scripting DocAlign');
    // title must still be there
    expect(result).toContain('title: "CLI Reference"');
    // summary should come right after title
    const titleIdx = result.indexOf('title:');
    const summaryIdx = result.indexOf('summary:');
    expect(summaryIdx).toBeGreaterThan(titleIdx);
  });

  it('does not duplicate summary if already present', () => {
    const content = [
      '---',
      'title: "CLI Reference"',
      'summary: "Existing summary"',
      '---',
      '',
    ].join('\n');
    const file = path.join(tmpDir, 'cli.md');
    fs.writeFileSync(file, content);

    writeFrontmatterFields(file, { summary: 'New summary' });

    const result = fs.readFileSync(file, 'utf-8');
    // Should still have only one summary line
    const summaryMatches = result.match(/^summary:/gm);
    expect(summaryMatches).toHaveLength(1);
    expect(result).toContain('summary: "Existing summary"');
  });

  it('does not duplicate read_when if already present', () => {
    const content = [
      '---',
      'title: "CLI Reference"',
      'read_when:',
      '  - Existing scenario',
      '---',
      '',
    ].join('\n');
    const file = path.join(tmpDir, 'cli.md');
    fs.writeFileSync(file, content);

    writeFrontmatterFields(file, { read_when: ['New scenario'] });

    const result = fs.readFileSync(file, 'utf-8');
    const rwMatches = result.match(/^read_when:/gm);
    expect(rwMatches).toHaveLength(1);
    expect(result).toContain('  - Existing scenario');
    expect(result).not.toContain('  - New scenario');
  });

  it('is a no-op if both fields are already present', () => {
    const content = [
      '---',
      'title: "CLI Reference"',
      'summary: "Existing"',
      'read_when:',
      '  - Existing',
      '---',
      '',
    ].join('\n');
    const file = path.join(tmpDir, 'cli.md');
    fs.writeFileSync(file, content);

    writeFrontmatterFields(file, { summary: 'New', read_when: ['New'] });

    const result = fs.readFileSync(file, 'utf-8');
    expect(result).toBe(content);
  });

  it('is a no-op for a file without frontmatter', () => {
    const content = '# No frontmatter\n\nJust prose.\n';
    const file = path.join(tmpDir, 'bare.md');
    fs.writeFileSync(file, content);

    writeFrontmatterFields(file, { summary: 'A summary' });

    const result = fs.readFileSync(file, 'utf-8');
    expect(result).toBe(content);
  });
});
