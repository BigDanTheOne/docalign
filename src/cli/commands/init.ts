/**
 * `docalign init` — Set up DocAlign for Claude Code in the current project.
 *
 * Writes:
 *   .claude/settings.local.json  — MCP server config
 *   .claude/skills/docalign/SKILL.md — Workflow skill
 *
 * Zero-dependency: does not need LocalPipeline or any scanning.
 */

import fs from 'fs';
import path from 'path';

const SKILL_MD = `---
name: docalign
description: >
  Detects documentation drift — finds docs that are out of sync with code.
  Use when user modifies code files and documentation may need updating,
  asks to "check docs", "find stale docs", "verify README", mentions
  "doc drift", or after refactors and API changes. Requires docalign MCP server.
metadata:
  author: DocAlign
  version: 0.1.0
  mcp-server: docalign
---

# DocAlign — Documentation Drift Detection

## Overview
DocAlign verifies that documentation matches code reality. It extracts
factual claims from docs (function signatures, CLI commands, file paths,
config keys, code examples) and checks each claim against the actual codebase.

## When to Use

### Proactive (after code changes)
After modifying code files, use DocAlign to find documentation that
references the changed files and may now be stale.

### On demand
When the user asks to check docs, scan for drift, or verify documentation.

## Workflows

### Workflow 1: Post-Change Doc Check (most important)
When the user has just modified code files:

1. Identify which files were changed (from the conversation context or git diff)
2. For each changed file, call \`get_docs_for_file\` with the file path
3. If any documentation references the changed file, report what was found
4. For any claims marked "drifted", call \`check_doc\` on those doc files for full details
5. Suggest specific documentation fixes based on the findings

Example:
- User modifies \`src/auth/login.ts\`
- Call \`get_docs_for_file\` with file_path="src/auth/login.ts"
- Discover that \`docs/authentication.md\` references it with 2 drifted claims
- Call \`check_doc\` with file="docs/authentication.md" for details
- Report the specific drift and suggest fixes

### Workflow 2: Check a Specific Doc
When user says "check this doc" or "verify README":

1. Call \`check_doc\` with the file path
2. Report results: total claims, verified count, drifted count
3. For each drifted finding, show: the claim text, severity, reasoning, suggested fix

### Workflow 3: Repository Health Overview
When user asks "how are my docs?" or "documentation health":

1. Call \`get_doc_health\` (no parameters)
2. Report the health score, total claims checked, and top drift hotspots
3. If score is below 80%, suggest running \`list_drift\` for details

### Workflow 4: Check a Specific Section
When user says "check the Installation section" or "verify the API section":

1. Call \`check_section\` with the file path and section heading
2. Report results scoped to that section: claims, verified/drifted counts
3. For each drifted finding, show: the claim text, line number, severity, reasoning, suggested fix
4. If the section is not found, the error will list available section headings

### Workflow 5: Find All Stale Docs
When user asks "what's stale?" or "list drift":

1. Call \`list_drift\` (optionally with max_results)
2. Report each file with drift and its drifted claim count
3. Suggest checking the worst offenders first

## Interpreting Results

### Verdicts
- **verified**: The claim in documentation matches the code. No action needed.
- **drifted**: The documentation says something that contradicts the code. Needs fixing.

### Severity Levels
- **high**: Wrong function signatures, incorrect API endpoints, broken commands — will cause errors if followed
- **medium**: Outdated descriptions, missing parameters, stale config examples
- **low**: Minor inaccuracies, cosmetic differences

### When to Act
- **high severity**: Fix immediately — developers following this doc will hit errors
- **medium severity**: Fix soon — creates confusion
- **low severity**: Fix when convenient

## Troubleshooting

### "No documentation files found"
DocAlign looks for .md, .mdx, .rst files. Make sure docs exist in the repo.

### Many false positives
Some claims about external libraries or tutorial code may be flagged.
The tool filters most of these, but suggest the user run:
\`docalign scan --exclude=examples,tutorials\`

### MCP server not responding
The MCP server runs via \`npx docalign mcp --repo .\` — make sure the
project directory is a git repository (has a .git folder).
`;

interface SettingsJson {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  mcpServers?: Record<string, {
    command: string;
    args: string[];
  }>;
  [key: string]: unknown;
}

export async function runInit(
  write: (msg: string) => void = console.log,
): Promise<number> {
  const cwd = process.cwd();

  // Check for git repo
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    write('Error: Not a git repository. Run this from the root of your project.');
    return 2;
  }

  write('DocAlign: Setting up for Claude Code...\n');

  // 1. Ensure .claude/ directory exists
  const claudeDir = path.join(cwd, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // 2. Write/merge .claude/settings.local.json
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  let settings: SettingsJson = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      // Corrupted file — overwrite
    }
  }

  // Ensure permissions.allow includes docalign MCP tools
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];
  const docalignPerm = 'mcp__docalign__*';
  if (!settings.permissions.allow.includes(docalignPerm)) {
    settings.permissions.allow.push(docalignPerm);
  }

  // Add MCP server config
  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers['docalign'] = {
    command: 'npx',
    args: ['docalign', 'mcp', '--repo', '.'],
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  write('  \u2713 .claude/settings.local.json (MCP server config)');

  // 3. Write skill
  const skillDir = path.join(claudeDir, 'skills', 'docalign');
  fs.mkdirSync(skillDir, { recursive: true });

  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillPath, SKILL_MD);
  write('  \u2713 .claude/skills/docalign/SKILL.md (workflow skill)');

  write('');
  write('Done. Restart Claude Code — DocAlign is ready.');
  write('');
  write('Try asking Claude: "Check my docs for drift"');

  return 0;
}
