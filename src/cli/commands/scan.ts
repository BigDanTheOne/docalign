/**
 * `docalign scan` — Full repository scan.
 *
 * Implements: phase4c-ux-specs.md Section 6.3
 * Gates: GATE42-012, GATE42-014, GATE42-015, GATE42-021
 */

import type { CliPipeline } from '../local-pipeline';
import { filterUncertain, countVerdicts, buildHotspots } from '../local-pipeline';
import { formatScanResults, progressBar } from '../output';

export async function runScan(
  pipeline: CliPipeline,
  write: (msg: string) => void = console.log,
  clearLine: () => void = () => {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }
  },
  exclude: string[] = [],
): Promise<number> {
  try {
    write(`DocAlign: Scanning repository...`);

    const result = await pipeline.scanRepo((current, total) => {
      clearLine();
      process.stdout.write(progressBar(current, total));
    }, exclude);

    // Clear progress bar
    clearLine();

    if (result.files.length === 0) {
      write('  No documentation files found in this repository.');
      return 0;
    }

    // Filter uncertain (GATE42-021) and count
    let totalVerified = 0;
    let totalDrifted = 0;
    const filteredFiles = result.files.map((f) => {
      const visible = filterUncertain(f.results);
      const counts = countVerdicts(visible);
      totalVerified += counts.verified;
      totalDrifted += counts.drifted;
      return { ...f, results: visible };
    });

    const totalScored = totalVerified + totalDrifted;
    const hotspots = buildHotspots(filteredFiles);

    const output = formatScanResults({
      verified: totalVerified,
      drifted: totalDrifted,
      healthScore: totalScored > 0 ? (totalVerified / totalScored) * 100 : 100,
      totalScored,
      hotspots,
    });

    write(output);

    return totalDrifted > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write(`Error: ${message}`);
    return 2;
  }
}
