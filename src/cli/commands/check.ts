/**
 * `docalign check <file>` — Verify a single doc file.
 *
 * Implements: phase4c-ux-specs.md Section 6.2
 * Gates: GATE42-012, GATE42-014, GATE42-015, GATE42-021
 */

import type { CliPipeline } from '../local-pipeline';
import { filterUncertain, countVerdicts } from '../local-pipeline';
import { formatCheckResults, type CheckFinding, type Severity } from '../output';

export interface CheckOptions {
  section?: string;
  deep?: boolean;
  json?: boolean;
}

export async function runCheck(
  pipeline: CliPipeline,
  filePath: string,
  options: CheckOptions = {},
  write: (msg: string) => void = console.log,
): Promise<number> {
  if (!filePath) {
    write('Error: No file specified. Usage: docalign check <file>');
    return 2;
  }

  try {
    const result = options.section
      ? await pipeline.checkSection(filePath, options.section)
      : await pipeline.checkFile(filePath);

    // Filter uncertain claims (GATE42-021)
    const visibleResults = filterUncertain(result.results);
    const { verified, drifted } = countVerdicts(visibleResults);

    // Build findings for display
    const findings: CheckFinding[] = visibleResults
      .filter((r) => r.verdict === 'drifted')
      .sort((a, b) => {
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (sevOrder[a.severity ?? 'low'] ?? 2) - (sevOrder[b.severity ?? 'low'] ?? 2);
      })
      .map((r) => {
        const claim = result.claims.find((c) => c.id === r.claim_id);
        return {
          severity: (r.severity ?? 'low') as Severity,
          file: claim?.source_file ?? filePath,
          line: claim?.line_number ?? 0,
          claimText: claim?.claim_text ?? '',
          actual: r.specific_mismatch ?? r.reasoning ?? 'Documentation drift detected',
          evidenceFiles: r.evidence_files ?? [],
        };
      });

    const durationSec = result.durationMs / 1000;
    const output = formatCheckResults(
      filePath,
      result.claims.length,
      durationSec,
      verified,
      drifted,
      findings,
    );

    write(output);

    return drifted > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write(`Error: ${message}`);
    return 2;
  }
}
