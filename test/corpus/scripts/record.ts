/**
 * corpus:record — records LLM responses for the synthetic-node corpus
 * Usage: tsx test/corpus/scripts/record.ts [--update]
 * Requires: ANTHROPIC_API_KEY environment variable
 *
 * For each doc file in test/fixtures/corpora/synthetic-node/untagged/:
 *   1. Read file content
 *   2. Call Claude API with P-EXTRACT prompt
 *   3. Store response in test/fixtures/corpora/synthetic-node/llm-fixtures.json
 *
 * TODO: implement when P-EXTRACT prompt API is available
 */

console.log(
  'corpus:record not yet implemented. See test/corpus/scripts/record.ts for implementation notes.',
);
process.exit(0);
