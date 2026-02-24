/**
 * `docalign status` — Show drift health summary.
 *
 * Displays health score, verified/drifted counts, and top hotspot files.
 * Supports --json for structured output and getStatusData() for MCP reuse.
 */

import type { CliPipeline, ScanResult, ScanFileResult } from '../local-pipeline';
import type { Claim, VerificationResult } from '../../shared/types';
import { filterUncertain, countVerdicts, buildHotspots } from '../local-pipeline';
import { color } from '../output';

export interface StatusData {
  health_score: number;
  verified: number;
  drifted: number;
  hotspots: Array<{ file: string; drifted: number }>;
}

/**
 * Normalize a scan result into the files-based shape.
 * Handles both the standard ScanResult (with `files`) and simplified
 * flat results (with top-level `results` array) for testability.
 */
function normalizeToFiles(
  raw: Record<string, unknown>,
): ScanFileResult[] {
  if (Array.isArray(raw.files) && raw.files.length > 0) {
    return raw.files as ScanFileResult[];
  }
  // Flat results shape: group by source_file
  if (Array.isArray(raw.results)) {
    const byFile = new Map<string, { claims: unknown[]; results: unknown[] }>();
    for (const r of raw.results as Array<Record<string, unknown>>) {
      const file = (r.source_file as string) ?? 'unknown';
      if (!byFile.has(file)) byFile.set(file, { claims: [], results: [] });
      const entry = byFile.get(file)!;
      entry.results.push(r);
    }
    if (Array.isArray(raw.claims)) {
      for (const c of raw.claims as Array<Record<string, unknown>>) {
        const file = (c.source_file as string) ?? 'unknown';
        if (!byFile.has(file)) byFile.set(file, { claims: [], results: [] });
        byFile.get(file)!.claims.push(c);
      }
    }
    return [...byFile.entries()].map(([file, data]) => ({
      file,
      claims: data.claims as Claim[],
      results: data.results as VerificationResult[],
    }));
  }
  return [];
}

/**
 * Compute drift health data from a pipeline scan.
 * Shared function for CLI and MCP tool reuse.
 */
export async function getStatusData(
  pipeline: CliPipeline,
): Promise<StatusData | null> {
  let raw: ScanResult;
  try {
    raw = await pipeline.scanRepo();
  } catch {
    return null;
  }
  if (!raw) return null;

  const files = normalizeToFiles(raw as unknown as Record<string, unknown>);

  let totalVerified = 0;
  let totalDrifted = 0;

  const filteredFiles = files.map((f) => {
    const visible = filterUncertain(f.results);
    const counts = countVerdicts(visible);
    totalVerified += counts.verified;
    totalDrifted += counts.drifted;
    return { ...f, results: visible };
  });
  const hotspotList = buildHotspots(filteredFiles);

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
