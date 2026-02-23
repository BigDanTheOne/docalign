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
import {
  loadClaimsForFile,
  saveClaimsForFile,
  hashContent,
  generateClaimId,
  type SemanticClaimFile,
  type SemanticClaimRecord,
} from '../../cli/semantic-store';
import { getStatusData } from '../../cli/commands/status';
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

  // Tool 1: check_doc — Check a doc file (with optional section scoping and deep audit)
  s.tool(
    'check_doc',
    'Check a documentation file for drift against the codebase. Optionally scope to a specific section (section param) or run a deep audit including semantic claims and unchecked sections (deep param).',
    {
      file: z.string().min(1).describe('Path to the documentation file (relative to repo root)'),
      section: z.string().optional().describe('Section heading to scope check to (e.g., "Installation", "API Reference"). If omitted, checks the whole file.'),
      deep: z.boolean().optional().describe('If true, includes semantic claims, unchecked sections, and coverage metrics in addition to syntactic claims.'),
    },
    async ({ file, section, deep }: { file: string; section?: string; deep?: boolean }) => {
      try {
        let result: Awaited<ReturnType<CliPipeline['checkFile']>> & { section?: { heading: string; startLine: number; endLine: number } };

        if (section) {
          const sectionResult = await pipeline.checkSection(file, section);
          result = sectionResult;
        } else {
          result = await pipeline.checkFile(file, true);
        }

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

        const base: Record<string, unknown> = {
          file,
          total_claims: result.claims.length,
          verified: counts.verified,
          drifted: counts.drifted,
          duration_ms: result.durationMs,
          findings,
        };

        if (section && 'section' in result && result.section) {
          base.section = result.section.heading;
          base.section_lines = `${result.section.startLine}-${result.section.endLine}`;
        }

        if (deep) {
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
          let uncheckedSections: Array<{ heading: string; line_range: string; content_preview: string }> = [];

          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf-8');
            const headings = listHeadings(content);
            const lines = content.split('\n');

            const checkedSections = new Set<string>();
            for (const claim of result.claims) {
              for (const h of headings) {
                const sec = findSection(content, h.text);
                if (sec && claim.line_number >= sec.startLine && claim.line_number <= sec.endLine) {
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
                const sec = findSection(content, h.text);
                const startLine = sec?.startLine ?? h.line;
                const endLine = sec?.endLine ?? h.line;
                return {
                  heading: h.text,
                  line_range: `${startLine}-${endLine}`,
                  content_preview: lines.slice(startLine - 1, endLine).join('\n').slice(0, 300),
                };
              });
          }

          const allHeadingCount = fs.existsSync(absPath)
            ? listHeadings(fs.readFileSync(absPath, 'utf-8')).length || 1
            : 1;
          const checkedCount = allHeadingCount - uncheckedSections.length;

          const warnings: string[] = [];
          if (semanticClaims.length === 0) {
            warnings.push('No semantic claims stored. Run `docalign extract` first.');
          }

          base.semantic = {
            total_claims: semanticClaims.length,
            findings: semanticFindings,
          };
          base.unchecked_sections = uncheckedSections;
          base.coverage = {
            total_sections: allHeadingCount,
            checked_sections: checkedCount,
            coverage_pct: Math.round((checkedCount / allHeadingCount) * 100),
          };
          base.warnings = warnings;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(base, null, 2),
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

  // Tool 2: scan_docs — Repository health + drift hotspots (replaces get_doc_health + list_drift)
  s.tool(
    'scan_docs',
    'Scan repository documentation for drift. Returns health score, verification coverage, and ordered list of files with most drift. Use this to get a quick overview of documentation quality.',
    {
      max_results: z.number().int().min(1).max(50).optional().describe('Maximum hotspot files to return (default 20)'),
    },
    async ({ max_results }: { max_results?: number }) => {
      try {
        const limit = max_results ?? 20;
        const result = await pipeline.scanRepo();
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
              hotspots: hotspots.slice(0, limit).map((h) => ({
                file: h.file,
                drifted: h.driftedCount,
              })),
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

  // Tool 3: get_docs — Search documentation or reverse-lookup by code file
  const searchIndex = new DocSearchIndex();
  let searchIndexBuilt = false;

  s.tool(
    'get_docs',
    'Search project documentation by topic or find docs that reference a specific code file. Provide query for topic search, code_file for reverse lookup (which docs reference that file), or both to combine results.',
    {
      query: z.string().optional().describe('Topic to search for (e.g., "authentication", "API endpoints", "deployment")'),
      code_file: z.string().optional().describe('Code file path (relative to repo root) to find docs that reference it. Useful when modifying code to find docs that may need updating.'),
      verified_only: z.boolean().optional().describe('Only return sections where all claims are verified'),
      max_results: z.number().int().min(1).max(50).optional().describe('Max results to return (default 10)'),
    },
    async ({ query, code_file, verified_only, max_results }: {
      query?: string;
      code_file?: string;
      verified_only?: boolean;
      max_results?: number;
    }) => {
      try {
        if (!query && !code_file) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'Provide at least one of: query, code_file' }),
            }],
            isError: true,
          };
        }

        const limit = max_results ?? 10;
        const combined: Record<string, unknown> = {};

        if (code_file) {
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
              if (r.evidence_files.some((e) => e === code_file || e.endsWith('/' + code_file))) {
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

          combined.code_file = code_file;
          combined.referencing_docs = matching.slice(0, limit);
          combined.total_referencing = matching.length;
        }

        if (query) {
          if (!searchIndexBuilt) {
            await searchIndex.build(pipeline, repoRoot);
            searchIndexBuilt = true;
          }

          const response = searchIndex.search(query, {
            verified_only: verified_only ?? false,
            max_results: limit,
          });

          combined.query = query;
          combined.search_results = response;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(combined, null, 2),
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

  // Tool 4: register_claims — Persist semantic claims from agent analysis
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

            const newRecords: SemanticClaimRecord[] = fileClaims.map((c) => {
              let foundHeading = '(document)';
              let foundHash = hashContent(content);

              for (let i = headingsList.length - 1; i >= 0; i--) {
                if (headingsList[i].line <= c.line_number) {
                  foundHeading = headingsList[i].text;
                  const sec = findSection(content, headingsList[i].text);
                  if (sec) {
                    const sectionContent = lines.slice(sec.startLine - 1, sec.endLine).join('\n');
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

            const existing = loadClaimsForFile(repoRoot, sourceFile) ?? {
              version: 1 as const,
              source_file: sourceFile,
              last_extracted_at: new Date().toISOString(),
              claims: [],
            };

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

  // Tool 5: get_status — Project status (mirrors `docalign status --json`)
  s.tool(
    'get_status',
    {},
    async () => {
      try {
        const data = await getStatusData();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(data, null, 2),
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

/** Format a scan result as a health response (shared between scan_docs and internal use). */
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
