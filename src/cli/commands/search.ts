/**
 * `docalign search <query>` — Search documentation by topic.
 *
 * Supports:
 *   - Topic search: docalign search "authentication"
 *   - Reverse lookup: docalign search --code-file src/auth/password.ts
 */

import type { CliPipeline } from '../local-pipeline';
import { DocSearchIndex } from '../../layers/L6-mcp/doc-search';

export interface SearchOptions {
  codeFile?: string;
  verifiedOnly?: boolean;
  json?: boolean;
  max?: number;
}

export async function runSearch(
  pipeline: CliPipeline,
  query: string | undefined,
  options: SearchOptions = {},
  write: (msg: string) => void = console.log,
  repoRoot: string = process.cwd(),
): Promise<number> {
  if (!query && !options.codeFile) {
    write('Error: Provide a search query or --code-file <path>.');
    write('Usage: docalign search <query> [--code-file <path>] [--verified-only] [--json]');
    return 2;
  }

  const limit = options.max ?? 10;

  try {
    const combined: Record<string, unknown> = {};

    if (options.codeFile) {
      if (!options.json) write(`DocAlign: Finding docs that reference ${options.codeFile}...`);
      const result = await pipeline.scanRepo();
      const matching: Array<{
        doc_file: string;
        line: number;
        claim_text: string;
        claim_type: string;
        verdict: string;
        severity: string | null;
      }> = [];

      for (const f of result.files) {
        for (const r of f.results) {
          if (r.evidence_files.some((e) => e === options.codeFile || e.endsWith('/' + options.codeFile))) {
            const claim = f.claims.find((c) => c.id === r.claim_id);
            if (claim) {
              matching.push({
                doc_file: claim.source_file,
                line: claim.line_number,
                claim_text: claim.claim_text.slice(0, 200),
                claim_type: claim.claim_type,
                verdict: r.verdict,
                severity: r.severity,
              });
            }
          }
        }
      }

      if (options.json) {
        combined.code_file = options.codeFile;
        combined.referencing_docs = matching.slice(0, limit);
        combined.total = matching.length;
      } else {
        write(`  Found ${matching.length} doc reference(s):`);
        for (const m of matching.slice(0, limit)) {
          const status = m.verdict === 'drifted' ? ' [DRIFTED]' : m.verdict === 'verified' ? ' [ok]' : '';
          write(`  ${m.doc_file}:${m.line}${status} — ${m.claim_text}`);
        }
        if (matching.length === 0) {
          write(`  No docs reference ${options.codeFile}.`);
        }
      }
    }

    if (query) {
      if (!options.json) write(`DocAlign: Searching documentation for "${query}"...`);
      const searchIndex = new DocSearchIndex();
      await searchIndex.build(pipeline, repoRoot);
      const response = searchIndex.search(query, {
        verified_only: options.verifiedOnly ?? false,
        max_results: limit,
      });

      if (options.json) {
        combined.query = query;
        combined.search_results = response;
      } else {
        write(`  ${response.total_matches} match(es) found:`);
        for (const section of response.sections) {
          const status = section.verification_status === 'verified' ? ' [ok]' :
            section.verification_status === 'drifted' ? ' [DRIFTED]' :
            section.verification_status === 'mixed' ? ' [mixed]' : '';
          write(`  ${section.file} § ${section.heading}${status}`);
          if (section.content_preview) {
            write(`    ${section.content_preview.slice(0, 120).replace(/\n/g, ' ')}`);
          }
        }
        if (response.sections.length === 0) {
          write(`  No documentation found for "${query}".`);
        }
      }
    }

    if (options.json && Object.keys(combined).length > 0) {
      write(JSON.stringify(combined, null, 2));
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      write(JSON.stringify({ error: message }));
    } else {
      write(`Error: ${message}`);
    }
    return 2;
  }
}
