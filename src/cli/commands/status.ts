/**
 * `docalign status` — Show drift health summary.
 *
 * Displays health score, verified/drifted counts, and top hotspot files.
 * Supports --json for structured output and getStatusData() for MCP reuse.
 *
 * Breaking change (v0.5): The old `docalign status` showed setup diagnostics
 * (git detection, config check, MCP status, skill check, doc discovery).
 * That functionality is now available via `docalign init` or `docalign configure`.
 * This command now shows drift health from a repository scan.
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
 * Shape used by external callers (e.g. QA tests) that pass a flat
 * `{ claims, results }` object instead of the standard `ScanResult`.
 */
interface FlatScanShape {
  claims?: Array<{ source_file?: string }>;
  results?: Array<{ source_file?: string; verdict?: string; confidence?: number }>;
}

/**
 * Normalize a scan result into the files-based shape.
 *
 * The standard ScanResult has a `files` array. External callers (MCP tools,
 * test mocks) may pass a flat `{ claims, results }` shape grouped by
 * source_file. This function handles both.
 */
function normalizeToFiles(raw: ScanResult | FlatScanShape): ScanFileResult[] {
  // Standard shape: ScanResult with files array
  if ('files' in raw && Array.isArray(raw.files) && raw.files.length > 0) {
    return raw.files as ScanFileResult[];
  }

  // Flat shape: group results by source_file
  if ('results' in raw && Array.isArray(raw.results)) {
    const byFile = new Map<string, { claims: unknown[]; results: unknown[] }>();
    for (const r of raw.results) {
      const file = (r as Record<string, unknown>).source_file as string ?? 'unknown';
      if (!byFile.has(file)) byFile.set(file, { claims: [], results: [] });
      byFile.get(file)!.results.push(r);
    }
    if ('claims' in raw && Array.isArray(raw.claims)) {
      for (const c of raw.claims) {
        const file = (c as Record<string, unknown>).source_file as string ?? 'unknown';
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
  let raw: ScanResult | null;
  try {
    raw = await pipeline.scanRepo();
  } catch {
    // scanRepo failure (network error, missing config, etc.) — report as no data
    return null;
  }
  // Defensive: scanRepo may resolve to null in degraded scenarios
  if (!raw) return null;

  const files = normalizeToFiles(raw as ScanResult | FlatScanShape);

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
  // When no claims were scored, report 0 rather than a misleading 100
  const health_score = totalScored > 0 ? Math.round((totalVerified / totalScored) * 100) : 0;

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
