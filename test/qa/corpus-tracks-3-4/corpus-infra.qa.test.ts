/**
 * QA Acceptance Tests — Corpus Testing Infrastructure (Tracks 3 & 4)
 *
 * These tests validate the infrastructure and integration points,
 * NOT the corpus logic itself (that's tracks 3 & 4's job).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const LLM_FIXTURES_PATH = join(CORPUS_PATH, 'llm-fixtures.json');

describe('QA: Corpus Infrastructure', () => {
  // AC1: LLM Fixture types exist
  it('exports LlmFixtureEntry and LlmFixtureFile types', async () => {
    const types = await import('../../../corpus/types');
    // These should be importable without error; runtime check that the module exists
    expect(types).toBeDefined();
  });

  // AC3: LLM fixture replay mock exists and is importable
  it('llm-mock module exports a mock factory', async () => {
    const mock = await import('../../../corpus/llm-mock');
    expect(mock).toBeDefined();
    // Should export a function to create mock from fixtures
    expect(typeof mock.createLlmMock === 'function' || typeof mock.default === 'function').toBe(true);
  });

  // AC7: Fixture data committed with ≥2 entries
  it('llm-fixtures.json exists with ≥2 entries', () => {
    expect(existsSync(LLM_FIXTURES_PATH)).toBe(true);
    const fixtures = JSON.parse(readFileSync(LLM_FIXTURES_PATH, 'utf-8'));
    const entries = fixtures.entries ?? fixtures;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  // AC7: Fixture entries cover distinct doc types
  it('fixture entries cover distinct file paths', () => {
    const fixtures = JSON.parse(readFileSync(LLM_FIXTURES_PATH, 'utf-8'));
    const entries = fixtures.entries ?? fixtures;
    const paths = entries.map((e: any) => e.file_path ?? e.filePath);
    const unique = new Set(paths);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  // AC8: npm scripts exist
  it('package.json has corpus:record and corpus:tag scripts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['corpus:record']).toBeDefined();
    expect(pkg.scripts['corpus:tag']).toBeDefined();
  });

  // AC5: Track 3 test file is not a stub
  it('track3 test has non-stub implementation', () => {
    const content = readFileSync('test/corpus/track3-extract-snapshot.test.ts', 'utf-8');
    // Should have actual assertions, not just TODO comments
    expect(content).toContain('expect');
    expect(content).not.toMatch(/\/\/ TODO: implement after bootstrap/);
  });

  // AC6: Track 4 test file is not a stub
  it('track4 test has non-stub implementation', () => {
    const content = readFileSync('test/corpus/track4-cold-start.test.ts', 'utf-8');
    expect(content).toContain('expect');
    expect(content).not.toMatch(/\/\/ TODO: implement after bootstrap/);
  });

  // AC10: Track 3 has skipIf for missing fixtures
  it('track3 gracefully skips when fixtures missing', () => {
    const content = readFileSync('test/corpus/track3-extract-snapshot.test.ts', 'utf-8');
    expect(content).toContain('skipIf');
  });

  // AC10: Track 4 has skipIf for missing fixtures
  it('track4 gracefully skips when fixtures missing', () => {
    const content = readFileSync('test/corpus/track4-cold-start.test.ts', 'utf-8');
    expect(content).toContain('skipIf');
  });

  // AC3: Mock throws on missing fixture
  it('llm-mock throws descriptive error for unknown file_path', async () => {
    const mock = await import('../../../corpus/llm-mock');
    const createMock = mock.createLlmMock ?? mock.default;
    const fixtures = JSON.parse(readFileSync(LLM_FIXTURES_PATH, 'utf-8'));
    const mockFn = createMock(fixtures);
    await expect(mockFn({ filePath: 'nonexistent/file.md' })).rejects.toThrow();
  });
}, { timeout: 60_000 });
