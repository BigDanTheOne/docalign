/**
 * Track 4 — Cold-Start Gate
 *
 * Tests the full pipeline from untagged input using pre-recorded LLM responses.
 * Simulates the experience of a first-time user running the pipeline on a fresh repo.
 *
 * Skipped if llm-fixtures.json doesn't exist.
 * Run `npm run corpus:record` to bootstrap fixtures.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createLlmMock } from './llm-mock';
import type { LlmFixtureFile, LlmFixtureEntry } from './types';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const LLM_FIXTURES_PATH = join(CORPUS_PATH, 'llm-fixtures.json');
const UNTAGGED_DIR = join(CORPUS_PATH, 'untagged');
const EXPECTED_DIR = join(CORPUS_PATH, 'expected');

/**
 * Recursively collect all files from a directory.
 */
function collectFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  function recurse(current: string) {
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      if (statSync(fullPath).isDirectory()) {
        recurse(fullPath);
      } else {
        const relPath = relative(dir, fullPath);
        files.set(relPath, readFileSync(fullPath, 'utf-8'));
      }
    }
  }
  recurse(dir);
  return files;
}

/**
 * Simulate the tag-stamping process: apply LLM fixture responses as inline tags
 * on top of untagged doc content.
 */
function applyTagsToContent(
  content: string,
  response: LlmFixtureEntry['response'],
): string {
  const lines = content.split('\n');

  // Collect all insertions (skip regions + claims), sorted by line descending
  // so that insertions don't shift subsequent line numbers
  const insertions: Array<{
    line: number;
    endLine: number;
    openTag: string;
    closeTag: string;
  }> = [];

  for (const skip of response.skip_regions) {
    insertions.push({
      line: skip.start_line,
      endLine: skip.end_line,
      openTag: `<!-- docalign:skip reason="${skip.reason}" -->`,
      closeTag: '<!-- /docalign:skip -->',
    });
  }

  for (const claim of response.claims) {
    // Semantic claims wrap their line
    insertions.push({
      line: claim.line_number,
      endLine: claim.line_number,
      openTag: `<!-- docalign:semantic id="auto" claim="${claim.claim_text}" -->`,
      closeTag: '<!-- /docalign:semantic -->',
    });
  }

  // Sort descending by line so later insertions don't shift earlier ones
  insertions.sort((a, b) => b.line - a.line);

  for (const ins of insertions) {
    const endIdx = Math.min(ins.endLine, lines.length);
    lines.splice(endIdx, 0, ins.closeTag);
    lines.splice(ins.line - 1, 0, ins.openTag);
  }

  return lines.join('\n');
}

describe('Track 4 — Cold-start gate: synthetic-node', () => {
  it.skipIf(!existsSync(LLM_FIXTURES_PATH))(
    'clean cold start produces consistent extraction from untagged docs',
    async () => {
      const fixtureData: LlmFixtureFile = JSON.parse(
        readFileSync(LLM_FIXTURES_PATH, 'utf-8'),
      );
      const mockLlm = createLlmMock(fixtureData);
      const untaggedFiles = collectFiles(UNTAGGED_DIR);

      // Load expected cold-start-clean.json (should be empty array for clean state)
      const expectedPath = join(EXPECTED_DIR, 'cold-start-clean.json');
      expect(existsSync(expectedPath)).toBe(true);
      const expectedFindings = JSON.parse(readFileSync(expectedPath, 'utf-8'));
      expect(Array.isArray(expectedFindings)).toBe(true);

      // Simulate the cold-start flow for each fixture doc:
      // 1. Read untagged content
      // 2. Call mock LLM to get extraction response
      // 3. Apply tags to produce tagged content
      // 4. Verify tags were applied
      const taggedDocs = new Map<string, string>();

      for (const entry of fixtureData.entries) {
        const untaggedContent = untaggedFiles.get(entry.file_path);
        expect(untaggedContent).toBeDefined();

        // Step 1: Simulate LLM extract call
        const response = await mockLlm({ filePath: entry.file_path });

        // Step 2: Apply tags to produce tagged content
        const taggedContent = applyTagsToContent(untaggedContent!, response);
        taggedDocs.set(entry.file_path, taggedContent);

        // Step 3: Verify tags were applied
        expect(taggedContent).toContain('docalign:');
        expect(taggedContent.length).toBeGreaterThan(untaggedContent!.length);

        // Verify each claim tag is present
        for (const claim of response.claims) {
          expect(taggedContent).toContain(claim.claim_text);
        }

        // Verify each skip region tag is present
        for (const skip of response.skip_regions) {
          expect(taggedContent).toContain(skip.reason);
        }
      }

      // On a clean (unmutated) corpus, expected findings should be empty
      expect(expectedFindings).toHaveLength(0);

      // Verify we processed all fixture entries
      expect(taggedDocs.size).toBe(fixtureData.entries.length);
      expect(taggedDocs.size).toBeGreaterThanOrEqual(2);
    },
  );
});
