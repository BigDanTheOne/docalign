/**
 * corpus:gen-mutations — auto-generates semantic mutation files from sidecar claims.
 *
 * Usage: tsx test/corpus/scripts/gen-mutations.ts [--update]
 *
 * Reads: test/fixtures/corpora/synthetic-node/tagged/.docalign/semantic/claims.json
 * Writes: test/fixtures/corpora/synthetic-node/mutations/sem-auto-*.json
 *
 * Pass --update to overwrite existing mutation files.
 * Without --update, existing files are skipped.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SidecarFile, SidecarClaim, SidecarAssertion, MutationDef } from '../types';

const CORPUS_PATH = 'test/fixtures/corpora/synthetic-node';
const SIDECAR_PATH = join(CORPUS_PATH, 'tagged', '.docalign', 'semantic', 'claims.json');
const MUTATIONS_DIR = join(CORPUS_PATH, 'mutations');
const TAGGED_DIR = join(CORPUS_PATH, 'tagged');

const UPDATE_MODE = process.argv.includes('--update');

function loadTaggedFile(scope: string): string | null {
  const filePath = join(TAGGED_DIR, scope);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

function countPatternOccurrences(content: string, pattern: string): number {
  return content.split('\n').filter((line) => line.includes(pattern)).length;
}

function generateMutation(
  claim: SidecarClaim,
  assertion: SidecarAssertion,
  assertionIndex: number,
): MutationDef | null {
  if (assertion.expect === 'exists') {
    // Check for ambiguous pattern (appears more than once)
    const fileContent = loadTaggedFile(assertion.scope);
    if (fileContent === null) {
      console.warn(
        `[gen-mutations] Warning: scope file not found: ${assertion.scope} ` +
          `(claim ${claim.id}, assertion ${assertionIndex}). Skipping.`,
      );
      return null;
    }

    const occurrences = countPatternOccurrences(fileContent, assertion.pattern);
    if (occurrences > 1) {
      console.warn(
        `[gen-mutations] Warning: pattern appears ${occurrences} times in ${assertion.scope} — ` +
          `ambiguous, skipping mutation for claim ${claim.id}, assertion ${assertionIndex}.\n` +
          `  Pattern: "${assertion.pattern}"\n` +
          `  Consider making the sidecar assertion more specific.`,
      );
      return null;
    }

    return {
      id: `sem-auto-${claim.id}-assert-${assertionIndex}`,
      type: 'semantic',
      description:
        `Auto-generated: delete line matching "${assertion.pattern}" in ${assertion.scope} ` +
        `to make claim ${claim.id} drifted`,
      changes: [
        {
          file: assertion.scope,
          operation: 'delete_line_matching',
          pattern: assertion.pattern,
        },
      ],
      expected_findings: [
        {
          claim_id: claim.id,
          verdict: 'drifted',
        },
      ],
    };
  }

  if (assertion.expect === 'not_exists') {
    // Generate a mutation that adds the forbidden pattern
    return {
      id: `sem-auto-${claim.id}-assert-${assertionIndex}`,
      type: 'semantic',
      description:
        `Auto-generated: insert forbidden pattern "${assertion.pattern}" in ${assertion.scope} ` +
        `to make claim ${claim.id} drifted`,
      changes: [
        {
          file: assertion.scope,
          operation: 'replace_line_matching',
          find: '/* placeholder */',
          replace: assertion.pattern,
        },
      ],
      expected_findings: [
        {
          claim_id: claim.id,
          verdict: 'drifted',
        },
      ],
    };
  }

  return null;
}

function main() {
  if (!existsSync(SIDECAR_PATH)) {
    console.error(`[gen-mutations] Sidecar file not found: ${SIDECAR_PATH}`);
    console.error(
      'Run the bootstrap workflow (Section 9 of CORPUS-DESIGN.md) first:',
    );
    console.error('  npm run corpus:record && npm run corpus:tag');
    process.exit(1);
  }

  const sidecarContent = readFileSync(SIDECAR_PATH, 'utf8');
  const sidecar = JSON.parse(sidecarContent) as SidecarFile;

  let generated = 0;
  let skipped = 0;
  let warned = 0;

  for (const claim of sidecar.claims) {
    for (let i = 0; i < claim.evidence_assertions.length; i++) {
      const assertion = claim.evidence_assertions[i];
      const mutationId = `sem-auto-${claim.id}-assert-${i}`;
      const outputPath = join(MUTATIONS_DIR, `${mutationId}.json`);

      // Skip if file exists and --update not passed
      if (existsSync(outputPath) && !UPDATE_MODE) {
        console.log(`[gen-mutations] Skipping existing: ${mutationId}.json (use --update to overwrite)`);
        skipped++;
        continue;
      }

      const mutation = generateMutation(claim, assertion, i);

      if (mutation === null) {
        warned++;
        continue;
      }

      writeFileSync(outputPath, JSON.stringify(mutation, null, 2) + '\n');
      console.log(`[gen-mutations] Written: ${mutationId}.json`);
      generated++;
    }
  }

  console.log(
    `\n[gen-mutations] Done. Generated: ${generated}, Skipped: ${skipped}, Warnings: ${warned}`,
  );
}

main();
