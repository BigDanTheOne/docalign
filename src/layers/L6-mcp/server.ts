import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Pool } from 'pg';
import { SimpleCache } from './cache';
import { resolveRepo } from './repo-resolver';
import { registerTools } from './tools';
import type { HandlerConfig } from './handlers';

export interface CliArgs {
  repoPath: string;
  databaseUrl?: string;
  verbose?: boolean;
}

/**
 * Parse CLI arguments.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { repoPath: '' };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--repo':
        args.repoPath = argv[++i] ?? '';
        break;
      case '--database-url':
        args.databaseUrl = argv[++i];
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--version':
        process.stderr.write('docalign-mcp v0.1.0\n');
        process.exit(0);
        break;
      case '--help':
        process.stderr.write(
          'Usage: docalign-mcp --repo <path> [--database-url <url>] [--verbose]\n',
        );
        process.exit(0);
        break;
    }
  }

  return args;
}

/**
 * Resolve database URL from CLI arg, env, or config file.
 * TDD-6 Appendix B.
 */
export function resolveDatabaseUrl(cliArg?: string): string {
  if (cliArg) return cliArg;

  const envUrl = process.env.DOCALIGN_DATABASE_URL;
  if (envUrl) return envUrl;

  // Could check ~/.docalign/config.json here, but for now just error
  throw new Error(
    'No database URL configured. Set DOCALIGN_DATABASE_URL or pass --database-url.',
  );
}

/**
 * Start the MCP server.
 * TDD-6 Section 4.0.
 */
export async function startServer(args: CliArgs): Promise<void> {
  if (!args.repoPath) {
    process.stderr.write('Error: --repo <path> is required\n');
    process.exit(1);
  }

  const databaseUrl = resolveDatabaseUrl(args.databaseUrl);

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    statement_timeout: 5000,
    connectionTimeoutMillis: 5000,
    application_name: 'docalign-mcp',
  });

  // Set read-only mode
  pool.on('connect', async (client) => {
    await client.query('SET default_transaction_read_only = ON');
  });

  try {
    const resolved = await resolveRepo(args.repoPath, pool);

    process.stderr.write(
      `DocAlign MCP server started for ${resolved.github_owner}/${resolved.github_repo} (repo_id: ${resolved.repo_id})\n`,
    );

    const cache = new SimpleCache();
    const config: HandlerConfig = {
      repoId: resolved.repo_id,
      cacheTtlSeconds: 60,
      maxSearchResults: 20,
      staleThresholdDays: 30,
    };

    const server = new McpServer({
      name: 'docalign',
      version: '0.1.0',
    });

    registerTools(server, pool, config, cache);

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    await pool.end();
    process.exit(1);
  }
}

// CLI entry point
if (require.main === module) {
  const args = parseCliArgs(process.argv.slice(2));
  startServer(args).catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
  });
}
