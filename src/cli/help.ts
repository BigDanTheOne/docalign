/**
 * CLI help text for global and per-command --help output.
 *
 * Each subcommand help follows a consistent structure:
 *   SYNOPSIS, DESCRIPTION, FLAGS, EXAMPLES
 */

const COMMAND_HELP: Record<string, string> = {
  check: `
SYNOPSIS
  docalign check <file> [--section=HEADING] [--deep] [--json]

DESCRIPTION
  Check a single documentation file for drift against the codebase.
  Extracts claims from the file, maps them to code entities, and
  verifies each claim. Reports drifted claims sorted by severity.

FLAGS
  --section=HEADING   Check only a specific section by heading name
  --deep              Include unchecked sections and uncertain claims in output
  --json              Output results as JSON

EXAMPLES
  docalign check README.md
  docalign check docs/api.md --section="Authentication"
  docalign check README.md --deep --json
`.trim(),

  scan: `
SYNOPSIS
  docalign scan [--exclude=FILE[,FILE]] [--json] [--max=N] [--format=github-pr]

DESCRIPTION
  Scan the entire repository for documentation drift. Discovers all
  doc files, extracts and verifies claims, then reports a health score
  with hotspots ranked by drift count.

FLAGS
  --exclude=FILE[,FILE]   Exclude specific files from the scan (comma-separated)
  --json                  Output results as JSON
  --max=N                 Limit the number of hotspot entries returned
  --format=github-pr      Output scan results as a GitHub PR comment in markdown

EXAMPLES
  docalign scan
  docalign scan --exclude=CHANGELOG.md,LICENSE.md
  docalign scan --json
  docalign scan --format=github-pr
`.trim(),

  search: `
SYNOPSIS
  docalign search <query> [--code-file=PATH] [--verified-only] [--json] [--max=N]

DESCRIPTION
  Search documentation by topic or find docs that reference a specific
  code file. Uses a full-text search index built from the repository's
  documentation claims.

FLAGS
  --code-file=PATH    Reverse lookup: find docs that reference this code file
  --verified-only     Only return sections where all claims are verified
  --json              Output results as JSON
  --max=N             Maximum number of results to return (default: 10)

EXAMPLES
  docalign search "authentication"
  docalign search --code-file=src/auth/password.ts
  docalign search "database" --verified-only --json
`.trim(),

  extract: `
SYNOPSIS
  docalign extract [file...] [--dry-run] [--force]

DESCRIPTION
  Extract semantic claims from documentation using Claude CLI.
  Runs AI-powered extraction to identify behavior, architecture, and
  config claims that regex extractors cannot catch. Results are stored
  in .docalign/semantic/ for future verification.

FLAGS
  --dry-run           Show what would be extracted without saving changes
  --force             Re-extract all sections, even if unchanged since last run

EXAMPLES
  docalign extract
  docalign extract README.md docs/api.md
  docalign extract --dry-run
  docalign extract --force
`.trim(),

  init: `
SYNOPSIS
  docalign init

DESCRIPTION
  Set up DocAlign for Claude Code in the current project. Registers the
  MCP server, installs skills (daily usage and setup wizard), configures
  hooks for post-commit drift detection, and writes a setup trigger to
  CLAUDE.md. Must be run from the root of a git repository.

FLAGS
  (no flags)

EXAMPLES
  cd my-project && docalign init
`.trim(),

  status: `
SYNOPSIS
  docalign status

DESCRIPTION
  Show the current DocAlign configuration and integration status.
  Reports whether the git repo is detected, config file exists,
  Claude Code MCP is configured, skills are installed, LLM verification
  is available, and lists discovered documentation files.

FLAGS
  (no flags)

EXAMPLES
  docalign status
`.trim(),

  configure: `
SYNOPSIS
  docalign configure [--exclude=PATTERN] [--min-severity=LEVEL] [--reset]

DESCRIPTION
  Create or update the .docalign.yml configuration file. When run
  without options on a new project, creates a default config. Use flags
  to add exclusion patterns, set minimum severity, or reset to defaults.

FLAGS
  --exclude=PATTERN       Add a documentation file exclusion pattern
  --min-severity=LEVEL    Set minimum severity threshold (low, medium, high)
  --reset                 Reset configuration to defaults

EXAMPLES
  docalign configure
  docalign configure --exclude=CHANGELOG.md
  docalign configure --min-severity=medium
  docalign configure --reset
`.trim(),

  viz: `
SYNOPSIS
  docalign viz [--output=PATH] [--no-open] [--exclude=FILE[,FILE]]

DESCRIPTION
  Generate an interactive knowledge graph visualization. Runs a full
  repository scan, transforms results into a Cytoscape.js graph, and
  writes a self-contained HTML file. Opens automatically in a browser
  unless --no-open is specified.

FLAGS
  --output=PATH           Output path for the HTML file (default: .docalign/viz.html)
  --no-open               Do not auto-open the visualization in a browser
  --exclude=FILE[,FILE]   Exclude specific files from the scan (comma-separated)

EXAMPLES
  docalign viz
  docalign viz --output=report.html
  docalign viz --no-open --exclude=CHANGELOG.md
`.trim(),

  mcp: `
SYNOPSIS
  docalign mcp [--repo=PATH]

DESCRIPTION
  Start the MCP (Model Context Protocol) server for Claude Code or
  Cursor integration. The server exposes documentation verification
  tools over stdio transport. Typically invoked automatically by
  Claude Code via the MCP configuration, not run manually.

FLAGS
  --repo=PATH   Path to the repository root (default: current directory)

EXAMPLES
  docalign mcp
  docalign mcp --repo=/path/to/project
`.trim(),
};

export function getGlobalHelp(): string {
  const lines: string[] = [
    'Usage: docalign <command> [options]',
    '',
    'Documentation-reality alignment engine — detects when docs drift from code.',
    '',
    'Commands:',
    '  check <file>          Check a single documentation file for drift',
    '  scan                  Scan entire repository and report health score',
    '  search <query>        Search documentation by topic or code file reference',
    '  extract [file...]     Extract semantic claims using Claude CLI',
    '  init                  Set up DocAlign for Claude Code (MCP + skills + hooks)',
    '  status                Show configuration and integration status',
    '  configure             Create or update .docalign.yml configuration',
    '  viz                   Generate interactive knowledge graph visualization',
    '  mcp                   Start MCP server for Claude Code / Cursor',
    '',
    'Run `docalign <command> --help` for detailed usage of each command.',
    '',
    'Global Options:',
    '  --help                Show help (global or per-command)',
    '  --json                Output results as JSON (check, scan, search)',
    '',
    'Environment:',
    '  ANTHROPIC_API_KEY     Enable LLM verification (Tier 3)',
  ];
  return lines.join('\n');
}

export function getCommandHelp(command: string): string | undefined {
  return COMMAND_HELP[command];
}
