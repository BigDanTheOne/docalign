/**
 * Track 3 — Extract Snapshot
 *
 * Tests the extract step using pre-recorded LLM responses (llm-fixtures.json).
 * Asserts that the tags written to documents match the stored Vitest snapshot.
 *
 * Skipped if llm-fixtures.json doesn't exist.
 * Run `npm run corpus:record` to bootstrap fixtures.
 */
import { describe, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const LLM_FIXTURES_PATH = join(CORPUS_PATH, 'llm-fixtures.json');

describe('Track 3 — Extract snapshot: synthetic-node', () => {
  it.skipIf(!existsSync(LLM_FIXTURES_PATH))(
    'extract produces expected tags (run corpus:record to bootstrap)',
    async () => {
      // TODO: implement after bootstrap
      // Steps:
      // 1. Load llm-fixtures.json
      // 2. For each doc file in untagged/:
      //    a. Read file content
      //    b. Simulate extract step using fixture response (instead of real Claude API)
      //    c. Collect resulting tags
      // 3. Compare tags against stored Vitest snapshot (toMatchSnapshot)
      // 4. Any difference = regression in P-EXTRACT prompt or extraction logic
    },
  );
});
