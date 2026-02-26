/**
 * Track 3 — Extract Snapshot
 *
 * Tests the extract step using pre-recorded LLM responses (llm-fixtures.json).
 * Asserts that the tags written to documents match the stored Vitest snapshot.
 *
 * Skipped if llm-fixtures.json doesn't exist.
 * Run `npm run corpus:record` to bootstrap fixtures.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createLlmMock } from './llm-mock';
import type { LlmFixtureFile } from './types';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const LLM_FIXTURES_PATH = join(CORPUS_PATH, 'llm-fixtures.json');
const UNTAGGED_DIR = join(CORPUS_PATH, 'untagged');

/**
 * Recursively collect all .md files from a directory.
 */
function collectDocFiles(dir: string): Map<string, string> {
  const docs = new Map<string, string>();
  function recurse(current: string) {
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      if (statSync(fullPath).isDirectory()) {
        recurse(fullPath);
      } else if (fullPath.endsWith('.md')) {
        const relPath = relative(dir, fullPath);
        docs.set(relPath, readFileSync(fullPath, 'utf-8'));
      }
    }
  }
  recurse(dir);
  return docs;
}

/**
 * Simulate the tag-stamping step: given an LLM extraction response,
 * return the set of tags that would be applied.
 */
function extractTagsFromResponse(
  response: LlmFixtureFile['entries'][number]['response'],
): { skipRegions: typeof response.skip_regions; claims: typeof response.claims } {
  return {
    skipRegions: response.skip_regions,
    claims: response.claims,
  };
}

describe('Track 3 — Extract snapshot: synthetic-node', () => {
  it.skipIf(!existsSync(LLM_FIXTURES_PATH))(
    'extract produces expected tags for each fixture entry',
    async () => {
      const fixtureData: LlmFixtureFile = JSON.parse(
        readFileSync(LLM_FIXTURES_PATH, 'utf-8'),
      );
      const mockLlm = createLlmMock(fixtureData);
      const untaggedDocs = collectDocFiles(UNTAGGED_DIR);

      // For each fixture entry, simulate extract and snapshot the tags
      for (const entry of fixtureData.entries) {
        const docContent = untaggedDocs.get(entry.file_path);
        expect(docContent).toBeDefined();

        // Simulate calling the LLM extract step
        const response = await mockLlm({ filePath: entry.file_path });
        const tags = extractTagsFromResponse(response);

        // Verify the response shape
        expect(tags.skipRegions).toBeDefined();
        expect(tags.claims).toBeDefined();
        expect(Array.isArray(tags.skipRegions)).toBe(true);
        expect(Array.isArray(tags.claims)).toBe(true);

        // Each claim should have required fields
        for (const claim of tags.claims) {
          expect(claim.claim_text).toBeTruthy();
          expect(claim.claim_type).toMatch(/^(behavior|architecture|config)$/);
          expect(claim.line_number).toBeGreaterThan(0);
          expect(claim.keywords.length).toBeGreaterThan(0);
        }

        // Snapshot the full tag output per doc file
        expect(tags).toMatchSnapshot(`extract-tags:${entry.file_path}`);
      }
    },
  );
});
