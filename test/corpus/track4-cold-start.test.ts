/**
 * Track 4 — Cold-Start Gate
 *
 * Tests the full pipeline from untagged input using pre-recorded LLM responses.
 * Simulates the experience of a first-time user running the pipeline on a fresh repo.
 *
 * Skipped if llm-fixtures.json doesn't exist.
 * Run `npm run corpus:record` to bootstrap fixtures.
 */
import { describe, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const LLM_FIXTURES_PATH = join(CORPUS_PATH, 'llm-fixtures.json');

describe('Track 4 — Cold-start gate: synthetic-node', () => {
  it.skipIf(!existsSync(LLM_FIXTURES_PATH))(
    'clean cold start produces zero drifted findings (run corpus:record to bootstrap)',
    async () => {
      // TODO: implement after bootstrap
      // Steps:
      // 1. Load llm-fixtures.json
      // 2. Run full pipeline on untagged/ using fixture LLM client:
      //    a. L0: index code files
      //    b. Extract step: simulate Claude extract using fixtures
      //    c. L1: extractSyntactic on tagged content
      //    d. L2: map claims
      //    e. L3: verify deterministically
      //    f. Sidecar: evaluate semantic assertions
      // 3. Assert zero drifted findings on clean state
      // 4. Optionally: apply mutations and assert expected findings appear
    },
  );
});
