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
  json = false,
  max?: number,
): Promise<number> {
  try {
    if (!json) write(`DocAlign: Scanning repository...`);

    const showProgress = !json && (process.stdout.isTTY ?? false);
    const result = await pipeline.scanRepo((current, total) => {
      if (showProgress) {
        clearLine();
        process.stdout.write(progressBar(current, total));
      }
    }, exclude);

    // Clear progress bar
    if (showProgress) clearLine();

    if (result.files.length === 0) {
      if (json) {
        write(JSON.stringify({ healthPercent: 100, verified: 0, drifted: 0, totalClaims: 0, findings: [], hotspots: [] }));
      } else {
        write('  No documentation files found in this repository.');
      }
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
    const healthPercent = totalScored > 0 ? Math.round((totalVerified / totalScored) * 100) : 100;

    if (json) {
      // Build findings array for JSON output
      const findings: Array<{
        file: string;
        line: number;
        claimText: string;
        actual: string;
        severity: string;
        evidence?: string;
      }> = [];

      for (const fileResult of filteredFiles) {
        for (const vr of fileResult.results) {
          if (vr.verdict !== 'drifted') continue;
          const claim = fileResult.claims.find((c) => c.id === vr.claim_id);
          if (!claim) continue;
          findings.push({
            file: fileResult.file,
            line: claim.line_number,
            claimText: claim.claim_text,
            actual: vr.specific_mismatch ?? vr.reasoning ?? 'Documentation does not match code.',
            severity: vr.severity ?? 'medium',
            ...(vr.evidence_files.length > 0 ? { evidence: vr.evidence_files.join(', ') } : {}),
          });
        }
      }

      write(JSON.stringify({
        healthPercent,
        verified: totalVerified,
        drifted: totalDrifted,
        totalClaims: result.totalClaims,
        findings,
        hotspots: (max ? hotspots.slice(0, max) : hotspots).map((h) => ({ file: h.file, drifted: h.driftedCount })),
      }));
    } else {
      const output = formatScanResults({
        verified: totalVerified,
        drifted: totalDrifted,
        healthScore: totalScored > 0 ? (totalVerified / totalScored) * 100 : 100,
        totalScored,
        hotspots,
      });
      write(output);
    }

    return totalDrifted > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      write(JSON.stringify({ error: message }));
    } else {
      write(`Error: ${message}`);
    }
    return 2;
  }
}
