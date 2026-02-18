/**
 * `docalign init` — Interactive setup for DocAlign in the current project.
 *
 * This command performs initial setup and installs both skills:
 *   - docalign-setup: Interactive setup wizard (runs when config missing)
 *   - docalign: Daily usage workflows (runs after setup complete)
 *
 * Writes:
 *   .claude/settings.local.json  — MCP server config + hooks
 *   .claude/skills/docalign/SKILL.md — Daily usage skill
 *   .claude/skills/docalign-setup/SKILL.md — Setup wizard skill
 *
 * After running this command, restart Claude Code to begin interactive setup.
 */

import fs from "fs";
import path from "path";

const SKILL_MD = `---
name: docalign
description: >
  Detects documentation drift — finds docs that are out of sync with code.
  Use when user modifies code files and documentation may need updating,
  asks to "check docs", "find stale docs", "verify README", mentions
  "doc drift", or after refactors and API changes. Requires docalign MCP server.
metadata:
  author: DocAlign
  version: 0.3.0
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

## Available Tools

| Tool | Purpose |
|------|---------|
| \`check_doc\` | Check a documentation file for drift |
| \`check_section\` | Check a specific section of a doc file |
| \`get_doc_health\` | Get repo-wide documentation health score |
| \`list_drift\` | List all docs with drift, ordered by severity |
| \`get_docs_for_file\` | Find docs that reference a code file |
| \`get_docs\` | Search docs by topic with multi-signal ranking |
| \`fix_doc\` | Generate fix suggestions for drifted claims |
| \`report_drift\` | Report a doc inaccuracy for tracking |
| \`deep_check\` | Deep audit: syntactic + semantic claims + coverage |
| \`register_claims\` | Persist semantic claims from agent analysis |

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

### Workflow 6: Post-Implementation Check
After committing code changes (triggered by the post-commit hook):

1. Call \`get_doc_health\` to see if overall score dropped
2. If it dropped, call \`list_drift\` to find newly drifted docs
3. For each drifted doc, call \`fix_doc\` to get fix suggestions
4. Propose the fixes to the user

### Workflow 7: Search and Verify
When user asks about a topic ("how does auth work?", "what are the API endpoints?"):

1. Call \`get_docs\` with the topic as query
2. Check \`verification_status\` of returned sections
3. If verified — share the content confidently
4. If drifted — warn the user and suggest running \`fix_doc\`
5. If unchecked — note that the docs haven't been verified yet

### Workflow 8: Report and Track Drift
When the agent discovers documentation that doesn't match code but can't fix it now:

1. Call \`report_drift\` with the doc file, inaccurate text, and actual behavior
2. Include evidence files if known
3. The report is stored locally in \`.docalign/reports.json\` for later review

### Workflow 9: Deep Documentation Audit
When the user asks for a thorough doc audit or wants semantic claim tracking:

1. Call \`deep_check\` with the file path
2. Review the results:
   - **syntactic**: Regex-extracted claims (paths, commands, etc.) and their verdicts
   - **semantic**: LLM-extracted claims (behavior, architecture, config) and verifications
   - **unchecked_sections**: Sections with zero claims of any kind
   - **coverage**: Percentage of sections that have at least one claim
3. For unchecked sections, analyze the content and identify verifiable claims
4. Present found claims to the user: "I found N new claims. Should I register them?"
5. If approved, call \`register_claims\` with the claim details
6. If semantic claims are missing, suggest running \`docalign extract\`

**Important**: Always ask user confirmation before calling \`register_claims\`.

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

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

interface SettingsJson {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  mcpServers?: Record<
    string,
    {
      command: string;
      args: string[];
    }
  >;
  hooks?: {
    PostToolUse?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function runInit(
  write: (msg: string) => void = console.log,
): Promise<number> {
  const cwd = process.cwd();

  // Check for git repo
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    write(
      "Error: Not a git repository. Run this from the root of your project.",
    );
    return 2;
  }

  write("DocAlign: Setting up for Claude Code...\n");

  // 1. Ensure .claude/ directory exists
  const claudeDir = path.join(cwd, ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // 2. Write/merge .claude/settings.local.json
  const settingsPath = path.join(claudeDir, "settings.local.json");
  let settings: SettingsJson = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      // Corrupted file — overwrite
    }
  }

  // Ensure permissions.allow includes docalign MCP tools
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];
  const docalignPerm = "mcp__docalign__*";
  if (!settings.permissions.allow.includes(docalignPerm)) {
    settings.permissions.allow.push(docalignPerm);
  }

  // Add MCP server config
  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers["docalign"] = {
    command: "npx",
    args: ["docalign", "mcp", "--repo", "."],
  };

  // Add post-commit hook (new hooks format with matcher + hooks array)
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  const hookCommand =
    'bash -c \'INPUT=$(cat); if echo "$INPUT" | grep -q "git commit"; then echo "[DocAlign] Code committed. Consider running get_doc_health or check_doc to verify documentation is still accurate."; fi\'';
  const existingHook = settings.hooks.PostToolUse.find(
    (h) =>
      h.matcher === "Bash" &&
      h.hooks?.some((hk) => hk.command.includes("DocAlign")),
  );
  if (!existingHook) {
    settings.hooks.PostToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: hookCommand }],
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  write("  \u2713 .claude/settings.local.json (MCP server + hooks)");

  // 3. Write daily usage skill
  const skillDir = path.join(claudeDir, "skills", "docalign");
  fs.mkdirSync(skillDir, { recursive: true });

  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, SKILL_MD);
  write("  ✓ .claude/skills/docalign/SKILL.md (daily usage skill)");

  // 4. Write setup skill
  const setupSkillDir = path.join(claudeDir, "skills", "docalign-setup");
  fs.mkdirSync(setupSkillDir, { recursive: true });

  const setupSkillPath = path.join(setupSkillDir, "SKILL.md");
  const setupSkillMd = getSetupSkillMd();
  fs.writeFileSync(setupSkillPath, setupSkillMd);
  write("  ✓ .claude/skills/docalign-setup/SKILL.md (setup wizard)");

  write("");
  write("✅ DocAlign installation complete!");
  write("");
  write("🚀 Next step: Restart Claude Code");
  write("");
  write("On restart, the interactive setup wizard will begin:");
  write("  1. Discover your documentation");
  write("  2. Let you select which docs to monitor");
  write("  3. Configure and annotate your docs");
  write("  4. Run initial verification");
  write("");
  write("This takes about 3-5 minutes for most projects.");

  return 0;
}

function getSetupSkillMd(): string {
  try {
    // Try to read from the package's skill directory
    const skillPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      ".claude",
      "skills",
      "docalign-setup",
      "SKILL.md",
    );
    if (fs.existsSync(skillPath)) {
      return fs.readFileSync(skillPath, "utf-8");
    }
  } catch {
    // Fall back to reading from current working directory (development)
    try {
      const devPath = path.join(
        process.cwd(),
        ".claude",
        "skills",
        "docalign-setup",
        "SKILL.md",
      );
      if (fs.existsSync(devPath)) {
        return fs.readFileSync(devPath, "utf-8");
      }
    } catch {
      // Final fallback
    }
  }

  // Fallback content if file not found
  return `---
name: docalign-setup
description: >
  Interactive setup wizard for DocAlign. 
  USE ONLY when .docalign/config.yml does not exist.
metadata:
  author: DocAlign
  version: 0.3.0
---

# DocAlign Interactive Setup

See full documentation at: https://github.com/yourname/docalign
`;
}
