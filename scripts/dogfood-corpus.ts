/**
 * Dogfood scan: run LocalPipeline against the synthetic-node corpus.
 * Usage: npx tsx scripts/dogfood-corpus.ts
 */

import path from 'path';
import { LocalPipeline } from '../src/cli/real-pipeline';
import { buildHotspots } from '../src/cli/local-pipeline';

const CORPUS_ROOT = path.resolve(
  __dirname,
  '../test/fixtures/corpora/synthetic-node/tagged',
);

async function main() {
  console.log(`\nScanning: ${CORPUS_ROOT}\n`);
  const pipeline = new LocalPipeline(CORPUS_ROOT);

  let docCount = 0;
  const result = await pipeline.scanRepo((current, total) => {
    docCount = total;
    process.stdout.write(`\r  Checking [${current}/${total}]...`);
  });
  process.stdout.write('\n\n');

  // Summary
  console.log('═'.repeat(60));
  console.log(`  Doc files scanned : ${docCount}`);
  console.log(`  Total claims      : ${result.totalClaims}`);
  console.log(`  Verified          : ${result.totalVerified}`);
  console.log(`  Drifted           : ${result.totalDrifted}`);
  console.log(`  Uncertain         : ${result.totalUncertain}`);
  console.log(`  Duration          : ${result.durationMs}ms`);
  console.log('═'.repeat(60));

  // Per-file breakdown
  console.log('\nPer-file results:\n');
  for (const f of result.files) {
    const drifted = f.results.filter((r) => r.verdict === 'drifted');
    const verified = f.results.filter((r) => r.verdict === 'verified');
    const uncertain = f.results.filter((r) => r.verdict === 'uncertain');
    const icon = drifted.length > 0 ? '✗' : '✓';
    console.log(
      `  ${icon} ${f.file.padEnd(45)} ` +
      `verified:${verified.length}  drifted:${drifted.length}  uncertain:${uncertain.length}`,
    );
    for (const d of drifted) {
      const claim = f.claims.find((c) => c.id === d.claim_id);
      const text = claim?.claim_text.slice(0, 70) ?? d.claim_id;
      console.log(`      → [${d.severity ?? '?'}] ${text}`);
      if (d.reasoning) console.log(`        ${d.reasoning.slice(0, 100)}`);
    }
  }

  const hotspots = buildHotspots(result.files);
  if (hotspots.length > 0) {
    console.log('\nHotspots:\n');
    for (const h of hotspots) {
      console.log(`  ${h.driftedCount} drift(s)  ${h.file}`);
    }
  } else {
    console.log('\n✓ No drift detected on clean corpus.\n');
  }

  process.exit(result.totalDrifted > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
