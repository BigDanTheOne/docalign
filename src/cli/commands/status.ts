/**
 * `docalign status` — Show current DocAlign configuration and integration status.
 */

import fs from 'fs';
import path from 'path';
import { loadDocAlignConfig } from '../../config/loader';
import { discoverDocFiles } from '../../layers/L1-claim-extractor/syntactic';

export async function runStatus(
  write: (msg: string) => void = console.log,
): Promise<number> {
  const cwd = process.cwd();

  write('DocAlign Status\n');

  // 1. Git repo check
  const hasGit = fs.existsSync(path.join(cwd, '.git'));
  write(`  Repository:        ${hasGit ? 'git repo detected' : 'NOT a git repo'}`);

  // 2. Config file
  const configPath = path.join(cwd, '.docalign.yml');
  const hasConfig = fs.existsSync(configPath);
  write(`  Config file:       ${hasConfig ? '.docalign.yml found' : 'none (using defaults)'}`);

  if (hasConfig) {
    const { config, warnings } = loadDocAlignConfig(configPath);
    if (warnings.length > 0) {
      write(`  Config warnings:   ${warnings.length}`);
      for (const w of warnings) {
        write(`    - ${w.field}: ${w.message}`);
      }
    }
    const excludeCount = config.doc_patterns?.exclude?.length ?? 0;
    const suppressCount = config.suppress?.length ?? 0;
    if (excludeCount > 0) {
      write(`  Doc exclusions:    ${excludeCount} patterns`);
    }
    if (suppressCount > 0) {
      write(`  Suppressions:      ${suppressCount} rules`);
    }
  }

  // 3. Claude Code integration
  const claudeSettingsPath = path.join(cwd, '.claude', 'settings.local.json');
  let mcpConfigured = false;
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      mcpConfigured = !!settings?.mcpServers?.docalign;
    } catch {
      // ignore
    }
  }

  const skillPath = path.join(cwd, '.claude', 'skills', 'docalign', 'SKILL.md');
  const hasSkill = fs.existsSync(skillPath);

  // 3b. LLM availability
  const hasLLMKey = !!process.env.ANTHROPIC_API_KEY;
  write(`  LLM verification:  ${hasLLMKey ? 'available (ANTHROPIC_API_KEY set)' : 'not available (set ANTHROPIC_API_KEY for Tier 3)'}`);

  write(`  Claude Code MCP:   ${mcpConfigured ? 'configured' : 'not configured'}`);
  write(`  Claude Code Skill: ${hasSkill ? 'installed' : 'not installed'}`);

  if (!mcpConfigured || !hasSkill) {
    write(`\n  Run \`docalign init\` to set up Claude Code integration.`);
  }

  // 4. Doc files discovery
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
