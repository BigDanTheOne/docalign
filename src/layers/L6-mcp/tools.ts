import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Pool } from 'pg';
import { SimpleCache } from './cache';
import type { HandlerConfig } from './handlers';
import {
  handleGetDocs,
  handleGetDocsForFile,
  handleGetDocHealth,
  handleListStaleDocs,
} from './handlers';

/**
 * Register all MCP tools on the server.
 * TDD-6 Section 4.0.
 */
export function registerTools(
  server: McpServer,
  pool: Pool,
  config: HandlerConfig,
  cache: SimpleCache,
): void {
  // Tool 1: get_docs
  server.tool(
    'get_docs',
    'Search documentation claims by keyword. Returns matching documentation sections with verification status.',
    {
      query: z.string().min(1).describe('Search query for documentation'),
      verified_only: z.boolean().optional().describe('Only return verified claims'),
    },
    async ({ query, verified_only }) => {
      const result = await handleGetDocs({ query, verified_only }, pool, config, cache);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 2: get_docs_for_file
  server.tool(
    'get_docs_for_file',
    'Find all documentation claims that reference a specific code file. Reverse lookup from code to docs.',
    {
      file_path: z.string().min(1).describe('Path to the code file'),
      include_verified: z.boolean().optional().describe('Include verified claims (default: true)'),
    },
    async ({ file_path, include_verified }) => {
      const result = await handleGetDocsForFile({ file_path, include_verified }, pool, config, cache);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 3: get_doc_health
  server.tool(
    'get_doc_health',
    'Get documentation health score for a file, directory, or entire repo. Shows verification coverage and drift hotspots.',
    {
      path: z.string().optional().describe('File or directory path (omit for repo-wide)'),
    },
    async ({ path }) => {
      const result = await handleGetDocHealth({ path }, pool, config, cache);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 4: list_stale_docs
  server.tool(
    'list_stale_docs',
    'List documentation files that are stale, drifted, or need attention. Ordered by severity.',
    {
      max_results: z.number().int().min(1).max(100).optional().describe('Maximum results (1-100, default 10)'),
    },
    async ({ max_results }) => {
      const result = await handleListStaleDocs({ max_results }, pool, config, cache);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 5: report_drift (v2 stub)
  server.tool(
    'report_drift',
    'Report documentation drift found during development. (Not available in this version.)',
    {
      doc_file: z.string().min(1).describe('Documentation file path'),
      line_number: z.number().int().positive().optional().describe('Line number in the doc file'),
      claim_text: z.string().min(1).max(2000).describe('The documentation claim that is drifted'),
      actual_behavior: z.string().min(1).max(2000).describe('What the code actually does'),
      evidence_files: z.array(z.string().max(512)).max(20).optional().describe('Related code files'),
    },
    async () => {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          error: 'Drift reporting is not available in this version. Upgrade to DocAlign v3.',
        }) }],
        isError: true,
      };
    },
  );
}
