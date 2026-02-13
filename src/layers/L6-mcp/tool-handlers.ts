/**
 * Shared MCP tool handlers for local (CLI) mode.
 * Used by both `docalign mcp` (CLI entry) and `docalign-mcp` (standalone binary).
 * Single source of truth — no tool logic is duplicated between entry points.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CliPipeline, ScanResult } from '../../cli/local-pipeline';
import { filterUncertain, countVerdicts, buildHotspots } from '../../cli/local-pipeline';
import { DocSearchIndex } from './doc-search';
import { appendReport } from './drift-reports';

/**
 * Register all local MCP tools on the given server.
 * Both entry points (local-server.ts and mcp.ts) call this.
 */
export function registerLocalTools(
  server: McpServer,
  pipeline: CliPipeline,
  repoRoot: string,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = server as any;

  // Tool 1: check_doc — Check a specific doc file for drift
  s.tool(
    'check_doc',
    'Check a documentation file for drift against the codebase. Returns verification results for each claim found.',
    {
      file: z.string().min(1).describe('Path to the documentation file (relative to repo root)'),
    },
    async ({ file }: { file: string }) => {
      try {
        const result = await pipeline.checkFile(file, true);
        const visible = filterUncertain(result.results);
        const counts = countVerdicts(visible);

        const findings = visible
          .filter((r) => r.verdict === 'drifted')
          .map((r) => ({
            claim_text: result.claims.find((c) => c.id === r.claim_id)?.claim_text ?? '',
            claim_type: result.claims.find((c) => c.id === r.claim_id)?.claim_type ?? '',
            line: result.claims.find((c) => c.id === r.claim_id)?.line_number,
            severity: r.severity,
            reasoning: r.reasoning,
            suggested_fix: r.suggested_fix,
            evidence: r.evidence_files,
          }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              file,
              total_claims: result.claims.length,
              verified: counts.verified,
              drifted: counts.drifted,
              duration_ms: result.durationMs,
              findings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 2: check_section — Check a specific section of a doc file
  s.tool(
    'check_section',
    'Check a specific section of a documentation file by heading. Returns verification results for claims within that section only.',
    {
      file: z.string().min(1).describe('Path to the documentation file (relative to repo root)'),
      heading: z.string().min(1).describe('Section heading text (e.g., "Installation", "API Reference")'),
    },
    async ({ file, heading }: { file: string; heading: string }) => {
      try {
        const result = await pipeline.checkSection(file, heading);
        const visible = filterUncertain(result.results);
        const counts = countVerdicts(visible);

        const findings = visible
          .filter((r) => r.verdict === 'drifted')
          .map((r) => ({
            claim_text: result.claims.find((c) => c.id === r.claim_id)?.claim_text ?? '',
            claim_type: result.claims.find((c) => c.id === r.claim_id)?.claim_type ?? '',
            line: result.claims.find((c) => c.id === r.claim_id)?.line_number,
            severity: r.severity,
            reasoning: r.reasoning,
            suggested_fix: r.suggested_fix,
            evidence: r.evidence_files,
          }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              file,
              section: result.section.heading,
              section_lines: `${result.section.startLine}-${result.section.endLine}`,
              total_claims: result.claims.length,
              verified: counts.verified,
              drifted: counts.drifted,
              duration_ms: result.durationMs,
              findings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 3: get_doc_health — Repository health overview
  s.tool(
    'get_doc_health',
    'Get documentation health score for the repository. Shows overall verification coverage and top drift hotspots.',
    {},
    async () => {
      try {
        const result = await pipeline.scanRepo();
        return formatHealthResponse(result);
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 4: list_drift — List all drifted documentation claims
  s.tool(
    'list_drift',
    'List all documentation files with drift, ordered by severity. Shows which docs need updating.',
    {
      max_results: z.number().int().min(1).max(50).optional().describe('Maximum files to return (default 20)'),
    },
    async ({ max_results }: { max_results?: number }) => {
      try {
        const limit = max_results ?? 20;
        const result = await pipeline.scanRepo();
        const hotspots = buildHotspots(
          result.files.map((f) => ({
            ...f,
            results: filterUncertain(f.results),
          })),
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              stale_docs: hotspots.slice(0, limit).map((h) => ({
                file: h.file,
                drifted_claims: h.driftedCount,
              })),
              total_files_with_drift: hotspots.length,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 5: get_docs_for_file — Reverse lookup: which docs reference a code file
  s.tool(
    'get_docs_for_file',
    'Find all documentation claims that reference a specific code file. Useful when modifying code to find docs that may need updating.',
    {
      file_path: z.string().min(1).describe('Path to the code file (relative to repo root)'),
    },
    async ({ file_path }: { file_path: string }) => {
      try {
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
            if (r.evidence_files.some((e) => e === file_path || e.endsWith('/' + file_path))) {
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

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              code_file: file_path,
              referencing_docs: matching,
              total: matching.length,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 6: get_docs — Multi-signal search over documentation sections
  const searchIndex = new DocSearchIndex();
  let searchIndexBuilt = false;

  s.tool(
    'get_docs',
    'Search project documentation by topic. Returns relevant doc sections ranked by relevance, with verification status showing whether the content matches the actual code.',
    {
      query: z.string().min(1).describe('Topic to search for (e.g., "authentication", "API endpoints", "deployment")'),
      verified_only: z.boolean().optional().describe('Only return sections where all claims are verified'),
      max_results: z.number().int().min(1).max(50).optional().describe('Max sections to return (default 10)'),
    },
    async ({ query, verified_only, max_results }: { query: string; verified_only?: boolean; max_results?: number }) => {
      try {
        if (!searchIndexBuilt) {
          await searchIndex.build(pipeline, repoRoot);
          searchIndexBuilt = true;
        }

        const response = searchIndex.search(query, {
          verified_only: verified_only ?? false,
          max_results: max_results ?? 10,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 7: fix_doc — Generate fix suggestions for drifted documentation
  s.tool(
    'fix_doc',
    'Generate fix suggestions for drifted documentation claims in a file. Returns specific text replacements.',
    {
      file: z.string().min(1).describe('Path to the documentation file (relative to repo root)'),
    },
    async ({ file }: { file: string }) => {
      try {
        const result = await pipeline.checkFile(file, true);
        const visible = filterUncertain(result.results);
        const drifted = visible.filter((r) => r.verdict === 'drifted');

        const fixes: Array<{
          line: number | undefined;
          claim_text: string;
          claim_type: string;
          severity: string | null;
          fix: {
            line_start?: number;
            line_end?: number;
            old_text?: string;
            new_text?: string;
            reason?: string;
            confidence?: number;
            suggested_fix?: string;
            reasoning?: string;
          };
        }> = [];

        const llmFixesAvailable = result.fixes.length > 0;

        for (const r of drifted) {
          const claim = result.claims.find((c) => c.id === r.claim_id);
          if (!claim) continue;

          // Check if we have an LLM-generated fix
          const llmFix = result.fixes.find((f) => f.claim_id === claim.id);

          if (llmFix) {
            fixes.push({
              line: claim.line_number,
              claim_text: claim.claim_text,
              claim_type: claim.claim_type,
              severity: r.severity,
              fix: {
                line_start: llmFix.line_start,
                line_end: llmFix.line_end,
                old_text: llmFix.old_text,
                new_text: llmFix.new_text,
                reason: llmFix.reason,
                confidence: llmFix.confidence,
              },
            });
          } else {
            // Deterministic fallback
            fixes.push({
              line: claim.line_number,
              claim_text: claim.claim_text,
              claim_type: claim.claim_type,
              severity: r.severity,
              fix: {
                suggested_fix: r.suggested_fix ?? 'No fix suggestion available',
                reasoning: r.reasoning ?? 'Documentation does not match code',
              },
            });
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              file,
              total_drifted: drifted.length,
              llm_fixes_available: llmFixesAvailable,
              fixes,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );

  // Tool 8: report_drift — Report a documentation inaccuracy
  s.tool(
    'report_drift',
    'Report a documentation inaccuracy you discovered while working. Stores the report locally for tracking.',
    {
      doc_file: z.string().min(1).describe('Documentation file with the inaccuracy'),
      claim_text: z.string().min(1).max(2000).describe('The inaccurate text in the doc'),
      actual_behavior: z.string().min(1).max(2000).describe('What the code actually does'),
      line_number: z.number().int().min(1).optional().describe('Approximate line number'),
      evidence_files: z.array(z.string()).max(20).optional().describe('Code files showing actual behavior'),
    },
    async ({ doc_file, claim_text, actual_behavior, line_number, evidence_files }: {
      doc_file: string;
      claim_text: string;
      actual_behavior: string;
      line_number?: number;
      evidence_files?: string[];
    }) => {
      try {
        const report = appendReport(repoRoot, {
          doc_file,
          claim_text,
          actual_behavior,
          line_number: line_number ?? null,
          evidence_files: evidence_files ?? [],
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              acknowledged: true,
              report_id: report.id,
              message: `Drift report stored. File: ${doc_file}`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    },
  );
}

/** Format a scan result as a health response (shared between get_doc_health and internal use). */
export function formatHealthResponse(result: ScanResult) {
  const filteredFiles = result.files.map((f) => {
    const visible = filterUncertain(f.results);
    const counts = countVerdicts(visible);
    return { ...f, results: visible, counts };
  });

  let totalVerified = 0;
  let totalDrifted = 0;
  for (const f of filteredFiles) {
    totalVerified += f.counts.verified;
    totalDrifted += f.counts.drifted;
  }
  const totalScored = totalVerified + totalDrifted;
  const score = totalScored > 0 ? Math.round((totalVerified / totalScored) * 100) : 100;
  const hotspots = buildHotspots(filteredFiles);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        health_score: score,
        total_scored: totalScored,
        verified: totalVerified,
        drifted: totalDrifted,
        doc_files_scanned: result.files.length,
        duration_ms: result.durationMs,
        hotspots: hotspots.slice(0, 10).map((h) => ({
          file: h.file,
          drifted: h.driftedCount,
        })),
      }, null, 2),
    }],
  };
}
