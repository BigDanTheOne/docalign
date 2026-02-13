/**
 * `docalign extract` — Extract semantic claims from documentation using Claude CLI.
 *
 * Runs `claude -p` per doc file to identify behavior, architecture,
 * and config claims that regex extractors can't catch.
 * Results are stored in `.docalign/semantic/` for future verification.
 */

import type { LocalPipeline } from '../real-pipeline';

export interface ExtractOptions {
  dryRun?: boolean;
  force?: boolean;
  files?: string[];
}

export async function runExtract(
  pipeline: LocalPipeline,
  options: ExtractOptions,
  write: (msg: string) => void = console.log,
): Promise<number> {
  write('DocAlign: Semantic claim extraction\n');

  if (options.dryRun) {
    write('  (dry-run mode — no changes will be saved)\n');
  }

  if (options.force) {
    write('  (force mode — re-extracting all sections)\n');
  }

  const result = await pipeline.extractSemantic(
    (current, total, file, status) => {
      write(`  [${current}/${total}] ${file} — ${status}`);
    },
    {
      force: options.force,
      files: options.files,
    },
  );

  // Report results
  write('');
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      write(`  Error${err.file ? ` (${err.file})` : ''}: ${err.message}`);
    }
    write('');
  }

  write(`  Files analyzed: ${result.totalFiles}`);
  write(`  Claims extracted: ${result.totalExtracted}`);
  write(`  Files skipped (unchanged): ${result.totalSkipped}`);

  if (result.errors.length > 0) {
    write(`  Errors: ${result.errors.length}`);
  }

  write('');

  if (result.totalExtracted > 0) {
    write('  Claims stored in .docalign/semantic/');
    write('  Run `docalign check <file>` to verify claims against code.');
  } else if (result.totalSkipped === result.totalFiles && result.totalFiles > 0) {
    write('  All sections unchanged since last extraction. Use --force to re-extract.');
  }

  return result.errors.length > 0 ? 1 : 0;
}
