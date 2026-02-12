#!/usr/bin/env node
/**
 * DocAlign Local MCP Server — runs entirely in-memory against a local repo.
 * No database required. Designed for use with Cursor, Claude Code, etc.
 *
 * Usage:
 *   node dist/layers/L6-mcp/local-server.js --repo /path/to/repo
 *
 * Or via the docalign CLI:
 *   docalign mcp --repo /path/to/repo
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { LocalPipeline } from '../../cli/real-pipeline';
import { filterUncertain, countVerdicts, buildHotspots } from '../../cli/local-pipeline';

function log(msg: string): void {
  process.stderr.write(`[docalign-mcp] ${msg}\n`);
}

function parseArgs(argv: string[]): { repoPath: string; verbose: boolean } {
  let repoPath = '';
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--repo':
        repoPath = argv[++i] ?? '';
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--version':
        process.stderr.write('docalign-mcp (local) v0.1.0\n');
        process.exit(0);
        break;
      case '--help':
        process.stderr.write(
          'Usage: docalign-mcp --repo <path> [--verbose]\n' +
          '\nLocal MCP server for documentation verification.\n' +
          'No database required — runs entirely in-memory.\n',
        );
        process.exit(0);
        break;
    }
  }

  return { repoPath, verbose };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Default to cwd if no --repo specified
  const repoPath = args.repoPath
    ? path.resolve(args.repoPath)
    : process.cwd();

  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    log(`Error: ${repoPath} is not a git repository (no .git directory)`);
    process.exit(1);
  }

  log(`Starting local MCP server for: ${repoPath}`);

  const pipeline = new LocalPipeline(repoPath);

  // Pre-warm the index
  log('Building codebase index...');
  const warmupStart = Date.now();
  // Run a quick scan to initialize the index
  await pipeline.scanRepo();
  log(`Index built in ${((Date.now() - warmupStart) / 1000).toFixed(1)}s`);

  const server = new McpServer({
    name: 'docalign',
    version: '0.1.0',
  });

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
            line: r.claim_id ? undefined : undefined, // Line info is on the claim
            claim_text: result.claims.find((c) => c.id === r.claim_id)?.claim_text ?? '',
            claim_type: result.claims.find((c) => c.id === r.claim_id)?.claim_type ?? '',
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

  // Tool 2: get_doc_health — Repository health overview
  s.tool(
    'get_doc_health',
    'Get documentation health score for the repository. Shows overall verification coverage and top drift hotspots.',
    {},
    async () => {
      try {
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
              hotspots: hotspots.slice(0, 10).map((h) => ({
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

  // Tool 3: list_drift — List all drifted documentation claims
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

  // Tool 4: get_docs_for_file — Reverse lookup: which docs reference a code file
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

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio. Ready for requests.');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
