/**
 * `docalign status` — Show current DocAlign configuration and integration status.
 */

import fs from 'fs';
import path from 'path';
import { loadDocAlignConfig } from '../../config/loader';
import { discoverDocFiles } from '../../layers/L1-claim-extractor/syntactic';

/** Summary of drift state when pipeline data is available. */
export interface DriftSummary {
  health_score: number;
  total_claims: number;
  drifted: number;
  verified: number;
}

/** Status data shape returned by getStatusData() and used by MCP get_status tool. */
export interface StatusData {
  git: { detected: boolean };
  config: { found: boolean; path: string | null; warnings: Array<{ field: string; message: string }> };
  mcp_configured: boolean;
  skill_installed: boolean;
  llm_available: boolean;
  doc_files: number;
  drift: DriftSummary | null;
}

/**
 * Collect status data as a plain object.
 * Used by the MCP get_status tool and `docalign status --json`.
 * @param cwd - Working directory to inspect. Defaults to process.cwd().
 */
export async function getStatusData(cwd?: string): Promise<StatusData> {
  const resolvedCwd = cwd ?? process.cwd();

  const hasGit = fs.existsSync(path.join(resolvedCwd, '.git'));

  const configPath = path.join(resolvedCwd, '.docalign.yml');
  const hasConfig = fs.existsSync(configPath);
  let configWarnings: Array<{ field: string; message: string }> = [];
  if (hasConfig) {
    const { warnings } = loadDocAlignConfig(configPath);
    configWarnings = warnings;
  }

  const claudeSettingsPath = path.join(resolvedCwd, '.claude', 'settings.local.json');
  let mcpConfigured = false;
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      mcpConfigured = !!settings?.mcpServers?.docalign;
    } catch {
      // ignore
    }
  }

  const skillPath = path.join(resolvedCwd, '.claude', 'skills', 'docalign', 'SKILL.md');
  const hasSkill = fs.existsSync(skillPath);
  const hasLLMKey = !!process.env.ANTHROPIC_API_KEY;

  let docFileCount = 0;
  try {
    const files = getFileTree(resolvedCwd);
    const docFiles = discoverDocFiles(files);
    docFileCount = docFiles.length;
  } catch {
    // unable to scan
  }

  return {
    git: { detected: hasGit },
    config: {
      found: hasConfig,
      path: hasConfig ? configPath : null,
      warnings: configWarnings,
    },
    mcp_configured: mcpConfigured,
    skill_installed: hasSkill,
    llm_available: hasLLMKey,
    doc_files: docFileCount,
    drift: null,
  };
}

export async function runStatus(
  write: (msg: string) => void = console.log,
): Promise<number> {
  const cwd = process.cwd();
  const data = await getStatusData(cwd);

  write('DocAlign Status\n');

  // 1. Git repo check
  write(`  Repository:        ${data.git.detected ? 'git repo detected' : 'NOT a git repo'}`);

  // 2. Config file
  write(`  Config file:       ${data.config.found ? '.docalign.yml found' : 'none (using defaults)'}`);

  if (data.config.found && data.config.path) {
    if (data.config.warnings.length > 0) {
      write(`  Config warnings:   ${data.config.warnings.length}`);
      for (const w of data.config.warnings) {
        write(`    - ${w.field}: ${w.message}`);
      }
    }
    // Load full config for additional details (exclude/suppress counts)
    const { config } = loadDocAlignConfig(data.config.path);
    const excludeCount = config.doc_patterns?.exclude?.length ?? 0;
    const suppressCount = config.suppress?.length ?? 0;
    if (excludeCount > 0) {
      write(`  Doc exclusions:    ${excludeCount} patterns`);
    }
    if (suppressCount > 0) {
      write(`  Suppressions:      ${suppressCount} rules`);
    }
  }

  // 3. Claude Code integration + LLM
  write(`  LLM verification:  ${data.llm_available ? 'available (ANTHROPIC_API_KEY set)' : 'not available (set ANTHROPIC_API_KEY for Tier 3)'}`);
  write(`  Claude Code MCP:   ${data.mcp_configured ? 'configured' : 'not configured'}`);
  write(`  Claude Code Skill: ${data.skill_installed ? 'installed' : 'not installed'}`);

  if (!data.mcp_configured || !data.skill_installed) {
    write(`\n  Run \`docalign init\` to set up Claude Code integration.`);
  }

  // 4. Doc files discovery — need full list for display
  write('');
  try {
    const files = getFileTree(cwd);
    const docFiles = discoverDocFiles(files);
    write(`  Doc files found:   ${docFiles.length}`);
    if (docFiles.length > 0 && docFiles.length <= 20) {
      for (const f of docFiles) {
        write(`    - ${f}`);
      }
    } else if (docFiles.length > 20) {
      for (const f of docFiles.slice(0, 15)) {
        write(`    - ${f}`);
      }
      write(`    ... and ${docFiles.length - 15} more`);
    }
  } catch {
    write(`  Doc files found:   (unable to scan)`);
  }

  write('');
  write('  Run `docalign scan` for a full verification report.');

  return 0;
}

/**
 * Simple recursive file tree for status display.
 * Skips common ignored directories.
 */
function getFileTree(dir: string, prefix = ''): string[] {
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'vendor']);
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...getFileTree(path.join(dir, entry.name), relPath));
      } else {
        files.push(relPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return files;
}
