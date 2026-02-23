/**
 * `docalign status` — Show drift health summary.
 *
 * Displays health score, verified/drifted counts, and top hotspot files.
 * Supports --json for structured output and getStatusData() for MCP reuse.
 */

import type { CliPipeline, ScanResult } from '../local-pipeline';
import { filterUncertain, countVerdicts, buildHotspots } from '../local-pipeline';
import { color } from '../output';

export interface StatusData {
  health_score: number;
  verified: number;
  drifted: number;
  hotspots: Array<{ file: string; drifted: number }>;
}

/**
 * Compute drift health data from a pipeline scan.
 * Shared function for CLI and MCP tool reuse.
 */
export async function getStatusData(
  pipeline: CliPipeline,
): Promise<StatusData | null> {
  const result: ScanResult | null = await pipeline.scanRepo();
  if (!result) return null;

  // Aggregate results from files array (real ScanResult)
  // or fall back to top-level results array (simplified mock)
  let totalVerified = 0;
  let totalDrifted = 0;
  let hotspotList: Array<{ file: string; driftedCount: number }> = [];

  if (result.files && result.files.length > 0) {
    const filteredFiles = result.files.map((f) => {
      const visible = filterUncertain(f.results);
      const counts = countVerdicts(visible);
      totalVerified += counts.verified;
      totalDrifted += counts.drifted;
      return { ...f, results: visible };
    });
    hotspotList = buildHotspots(filteredFiles);
  } else if ('results' in result && Array.isArray((result as Record<string, unknown>).results)) {
    // Handle flat results array (e.g., from simplified mocks)
    const flatResults = (result as Record<string, unknown>).results as Array<{ verdict: string; source_file?: string }>;
    for (const r of flatResults) {
      if (r.verdict === 'verified') totalVerified++;
      else if (r.verdict === 'drifted') totalDrifted++;
    }
    // Build hotspots from flat results grouped by source_file
    const fileMap = new Map<string, number>();
    for (const r of flatResults) {
      if (r.verdict === 'drifted' && r.source_file) {
        fileMap.set(r.source_file, (fileMap.get(r.source_file) || 0) + 1);
      }
    }
    hotspotList = [...fileMap.entries()]
      .map(([file, driftedCount]) => ({ file, driftedCount }))
      .sort((a, b) => b.driftedCount - a.driftedCount);
  }

  const totalScored = totalVerified + totalDrifted;
  const health_score = totalScored > 0 ? Math.round((totalVerified / totalScored) * 100) : 100;

  return {
    health_score,
    verified: totalVerified,
    drifted: totalDrifted,
    hotspots: hotspotList.slice(0, 5).map((h) => ({ file: h.file, drifted: h.driftedCount })),
  };
}

/**
 * Run the status command: display drift health summary.
 *
 * @param pipeline - CLI pipeline for scanning
 * @param write - output function
 * @param json - if true, output structured JSON
 * @returns exit code: 0 on success, 1 if no scan data
 */
export async function runStatus(
  pipeline: CliPipeline,
  write: (msg: string) => void = console.log,
  json = false,
): Promise<number> {
  const data = await getStatusData(pipeline);

  if (!data) {
    if (json) {
      write(JSON.stringify({ error: 'no scan data' }));
    } else {
      write('No scan data available. Run `docalign scan` first.');
    }
    return 1;
  }

  if (json) {
    write(JSON.stringify(data));
    return 0;
  }

  // Human-readable output
  const scoreColor = data.health_score > 90 ? color.boldGreen : data.health_score > 70 ? color.yellow : color.red;

  write('Drift Health\n');
  write(`  Health score: ${scoreColor(String(data.health_score))}`);
  write(`  Verified:     ${data.verified}`);
  write(`  Drifted:      ${data.drifted}`);

  if (data.hotspots.length > 0) {
    write('');
    write('  Top hotspot files:');
    for (const hs of data.hotspots) {
      write(`    ${color.cyan(hs.file)} — ${hs.drifted} drifted`);
    }
  }

  return 0;
}
