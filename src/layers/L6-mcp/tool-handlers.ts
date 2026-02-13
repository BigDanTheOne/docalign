/**
 * Shared MCP tool handlers for local (CLI) mode.
 * Used by both `docalign mcp` (CLI entry) and `docalign-mcp` (standalone binary).
 * Single source of truth — no tool logic is duplicated between entry points.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CliPipeline, ScanResult } from '../../cli/local-pipeline';
import { filterUncertain, countVerdicts, buildHotspots, listHeadings, findSection } from '../../cli/local-pipeline';
import { DocSearchIndex } from './doc-search';
import { appendReport } from './drift-reports';
import {
  loadClaimsForFile,
  saveClaimsForFile,
  hashContent,
  generateClaimId,
  type SemanticClaimFile,
  type SemanticClaimRecord,
} from '../../cli/semantic-store';
import fs from 'fs';
import path from 'path';

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
  // Tool 9: deep_check — Deep documentation audit with semantic claims
  s.tool(
    'deep_check',
    'Deep documentation audit. Returns syntactic claims + semantic claims + unchecked sections + coverage metrics. Use for thorough doc verification.',
    {
      file: z.string().min(1).describe('Path to the documentation file (relative to repo root)'),
    },
    async ({ file }: { file: string }) => {
      try {
        // Syntactic check
        const result = await pipeline.checkFile(file, true);
        const visible = filterUncertain(result.results);
        const counts = countVerdicts(visible);

        const syntacticFindings = visible.map((r) => {
          const claim = result.claims.find((c) => c.id === r.claim_id);
          return {
            claim_text: claim?.claim_text ?? '',
            claim_type: claim?.claim_type ?? '',
            line: claim?.line_number,
            verdict: r.verdict,
            severity: r.severity,
            reasoning: r.reasoning,
          };
        });

        // Semantic claims from store
        const semanticData = loadClaimsForFile(repoRoot, file);
        const semanticClaims = semanticData?.claims ?? [];
        const semanticFindings = semanticClaims.map((sc) => ({
          id: sc.id,
          claim_text: sc.claim_text,
          claim_type: sc.claim_type,
          line: sc.line_number,
          section: sc.section_heading,
          keywords: sc.keywords,
          verification: sc.last_verification ? {
            verdict: sc.last_verification.verdict,
            confidence: sc.last_verification.confidence,
            reasoning: sc.last_verification.reasoning,
            verified_at: sc.last_verification.verified_at,
          } : null,
        }));

        // Unchecked sections
        const absPath = path.join(repoRoot, file);
        let uncheckedSections: Array<{
          heading: string;
          line_range: string;
          content_preview: string;
        }> = [];

        if (fs.existsSync(absPath)) {
          const content = fs.readFileSync(absPath, 'utf-8');
          const headings = listHeadings(content);
          const lines = content.split('\n');

          // Build set of checked sections (have at least one claim)
          const checkedSections = new Set<string>();
          for (const claim of result.claims) {
            for (const h of headings) {
              const section = findSection(content, h.text);
              if (section && claim.line_number >= section.startLine && claim.line_number <= section.endLine) {
                checkedSections.add(h.text.toLowerCase());
              }
            }
          }
          for (const sc of semanticClaims) {
            checkedSections.add(sc.section_heading.toLowerCase());
          }

          uncheckedSections = headings
            .filter((h) => !checkedSections.has(h.text.toLowerCase()))
            .map((h) => {
              const section = findSection(content, h.text);
              const startLine = section?.startLine ?? h.line;
              const endLine = section?.endLine ?? h.line;
              const sectionContent = lines.slice(startLine - 1, endLine).join('\n');
              return {
                heading: h.text,
                line_range: `${startLine}-${endLine}`,
                content_preview: sectionContent.slice(0, 300),
              };
            });
        }

        // Coverage
        const allHeadingCount = fs.existsSync(absPath)
          ? listHeadings(fs.readFileSync(absPath, 'utf-8')).length || 1
          : 1;
        const checkedCount = allHeadingCount - uncheckedSections.length;
        const coveragePct = Math.round((checkedCount / allHeadingCount) * 100);

        // Warnings
        const warnings: string[] = [];
        if (semanticClaims.length === 0) {
          warnings.push('No semantic claims stored. Run `docalign extract` first.');
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              file,
              syntactic: {
                total_claims: result.claims.filter((c) => c.extraction_method !== 'llm').length,
                verified: counts.verified,
                drifted: counts.drifted,
                findings: syntacticFindings.filter((f) => f.verdict === 'drifted'),
              },
              semantic: {
                total_claims: semanticClaims.length,
                findings: semanticFindings,
              },
              unchecked_sections: uncheckedSections,
              coverage: {
                total_sections: allHeadingCount,
                checked_sections: checkedCount,
                coverage_pct: coveragePct,
              },
              warnings,
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

  // Tool 10: register_claims — Persist semantic claims from agent analysis
  s.tool(
    'register_claims',
    'Register semantic claims discovered during analysis. Persists them to .docalign/semantic/ for future verification.',
    {
      claims: z.array(z.object({
        source_file: z.string().min(1),
        line_number: z.number().int().positive(),
        claim_text: z.string().min(1),
        claim_type: z.enum(['behavior', 'architecture', 'config']),
        keywords: z.array(z.string()),
        evidence_entities: z.array(z.object({
          symbol: z.string(),
          file: z.string(),
        })).optional().default([]),
        evidence_assertions: z.array(z.object({
          pattern: z.string(),
          scope: z.string(),
          expect: z.enum(['exists', 'absent']),
          description: z.string(),
        })).optional().default([]),
        verification: z.object({
          verdict: z.enum(['verified', 'drifted', 'uncertain']),
          confidence: z.number().min(0).max(1),
          reasoning: z.string(),
        }).optional(),
      })).min(1).max(100),
    },
    async ({ claims }: {
      claims: Array<{
        source_file: string;
        line_number: number;
        claim_text: string;
        claim_type: 'behavior' | 'architecture' | 'config';
        keywords: string[];
        evidence_entities?: Array<{ symbol: string; file: string }>;
        evidence_assertions?: Array<{ pattern: string; scope: string; expect: 'exists' | 'absent'; description: string }>;
        verification?: { verdict: 'verified' | 'drifted' | 'uncertain'; confidence: number; reasoning: string };
      }>;
    }) => {
      try {
        // Group claims by source file
        const byFile = new Map<string, typeof claims>();
        for (const c of claims) {
          const existing = byFile.get(c.source_file) ?? [];
          existing.push(c);
          byFile.set(c.source_file, existing);
        }

        const allIds: string[] = [];

        for (const [sourceFile, fileClaims] of byFile) {
          const absPath = path.join(repoRoot, sourceFile);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf-8');
            const headingsList = listHeadings(content);
            const lines = content.split('\n');

            // For each claim, find its section
            const newRecords: SemanticClaimRecord[] = fileClaims.map((c) => {
              // Find section for this line
              let foundHeading = '(document)';
              let foundHash = hashContent(content);

              for (let i = headingsList.length - 1; i >= 0; i--) {
                if (headingsList[i].line <= c.line_number) {
                  foundHeading = headingsList[i].text;
                  const section = findSection(content, headingsList[i].text);
                  if (section) {
                    const sectionContent = lines.slice(section.startLine - 1, section.endLine).join('\n');
                    foundHash = hashContent(sectionContent);
                  }
                  break;
                }
              }

              const id = generateClaimId(sourceFile, c.claim_text);
              allIds.push(id);

              return {
                id,
                source_file: sourceFile,
                line_number: c.line_number,
                claim_text: c.claim_text,
                claim_type: c.claim_type,
                keywords: c.keywords,
                section_content_hash: foundHash,
                section_heading: foundHeading,
                extracted_at: new Date().toISOString(),
                evidence_entities: (c.evidence_entities ?? []).map((e) => ({
                  ...e,
                  content_hash: '',
                })),
                evidence_assertions: c.evidence_assertions ?? [],
                last_verification: c.verification ? {
                  verdict: c.verification.verdict,
                  confidence: c.verification.confidence,
                  reasoning: c.verification.reasoning,
                  verified_at: new Date().toISOString(),
                } : null,
              };
            });

            // Load or create file data
            const existing = loadClaimsForFile(repoRoot, sourceFile) ?? {
              version: 1 as const,
              source_file: sourceFile,
              last_extracted_at: new Date().toISOString(),
              claims: [],
            };

            // Merge — don't remove claims from non-mentioned sections
            const claimMap = new Map<string, SemanticClaimRecord>();
            for (const c of existing.claims) {
              claimMap.set(c.id, c);
            }
            for (const c of newRecords) {
              claimMap.set(c.id, c);
            }

            const updated: SemanticClaimFile = {
              ...existing,
              last_extracted_at: new Date().toISOString(),
              claims: Array.from(claimMap.values()),
            };

            saveClaimsForFile(repoRoot, sourceFile, updated);
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              registered: claims.length,
              claim_ids: allIds,
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
