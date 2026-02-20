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
 * Skill content lives in skills/{skill}/SKILL.md in the package root.
 * Edit those files directly to update skill prompts — no TypeScript needed.
 *
 * After running this command, restart Claude Code to begin interactive setup.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

// Skill files ship with the npm package under skills/.
// At runtime, __dirname is dist/cli/commands/ so the package root is 3 levels up.
function readSkillFile(relPath: string): string {
  const packageRoot = path.join(__dirname, "../../..");
  const fullPath = path.join(packageRoot, relPath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    throw new Error(`DocAlign: could not read skill file at ${fullPath}`);
  }
}

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

  // Register MCP server globally via the official claude mcp add command.
  // --scope user writes to the user-level config (~/.claude.json),
  // making docalign available in every project without per-repo setup.
  // No --repo flag: the server defaults to process.cwd() at startup, which is
  // whatever directory Claude Code is opened in.
  const mcpResult = spawnSync(
    "claude",
    ["mcp", "add", "--scope", "user", "docalign", "--", "npx", "docalign", "mcp"],
    { cwd, stdio: "pipe" },
  );
  if (mcpResult.status === 0) {
    write("  \u2713 MCP server registered globally (claude mcp add --scope user)");
  } else {
    write("  \u26a0 Could not register MCP server via claude mcp add — is Claude Code installed?");
  }

  // Add post-commit hook (new hooks format with matcher + hooks array)
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  // Normalise any existing entries: matcher must be a string, hooks must be an array
  settings.hooks.PostToolUse = (settings.hooks.PostToolUse as unknown[])
    .filter((h): h is Record<string, unknown> => h != null && typeof h === "object")
    .map((h) => {
      const matcherStr =
        typeof h["matcher"] === "string"
          ? h["matcher"]
          : ((h["matcher"] as Record<string, unknown>)?.["tools"] as string[])?.[0] ?? "Bash";
      const hooksArr = Array.isArray(h["hooks"])
        ? h["hooks"]
        : h["command"]
          ? [{ type: "command", command: h["command"] }]
          : null;
      if (!hooksArr) return null;
      return { matcher: matcherStr, hooks: hooksArr };
    })
    .filter((h): h is HookEntry => h !== null);

  const hookCommand =
    "bash -c 'test -f .docalign/config.yml || exit 0; INPUT=$(cat); echo \"$INPUT\" | grep -q \"git commit\" || exit 0; CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -v \"\\.md$\" | grep -v \"^\\.docalign/\"); [ -z \"$CHANGED\" ] && exit 0; echo \"[DocAlign] Source files changed in commit:\"; echo \"$CHANGED\" | while IFS= read -r f; do echo \"  $f\"; done; echo \"Invoke /docalign: for each file above, call get_docs(code_file=<file>) to find affected docs, then check_doc on each affected doc.\"'";
  // Force-replace any existing DocAlign hook so re-running `docalign init` picks up the latest command
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (h) => !h.hooks?.some((hk) => hk.command.includes("DocAlign")),
  );
  settings.hooks.PostToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: hookCommand }],
  });

  // Add SessionStart hook: on every new session, if config is missing, inject setup context
  // Also provide guidance on enabling the MCP server if it's not yet enabled
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  const sessionStartCmd =
    "bash -c 'test -f .docalign/config.yml || echo \"[DocAlign] Setup required: run /docalign-setup to configure documentation monitoring for this project.\"; echo \"[DocAlign] If the docalign MCP server is disabled, use /mcp to enable it (docalign → enable).\"'";
  const hasSessionStartHook = (settings.hooks.SessionStart as unknown[]).some(
    (h) =>
      h != null &&
      typeof h === "object" &&
      (h as Record<string, unknown[]>)["hooks"]?.some?.(
        (hk: unknown) =>
          typeof hk === "object" &&
          hk != null &&
          (hk as Record<string, string>)["command"]?.includes("docalign"),
      ),
  );
  if (!hasSessionStartHook) {
    (settings.hooks.SessionStart as unknown[]).push({
      matcher: "startup",
      hooks: [{ type: "command", command: sessionStartCmd }],
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  write("  \u2713 .claude/settings.local.json (MCP server + hooks)");

  // 2b. Create .mcp.json for project-level MCP configuration
  // Claude Code reads this file to configure the docalign MCP server with explicit repo context
  const mcpPath = path.join(cwd, ".mcp.json");
  const mcpConfig = {
    mcpServers: {
      docalign: {
        type: "stdio",
        command: "npx",
        args: ["docalign", "mcp", "--repo", "."],
        env: {},
        enabled: true,
      },
    },
  };
  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  write("  \u2713 .mcp.json (project-level MCP configuration with auto-enable)");

  // 3. Read skill content from package files
  const skillMd = readSkillFile("skills/docalign/SKILL.md");
  const setupSkillMd = readSkillFile("skills/docalign-setup/SKILL.md");
  const docProcessorMd = readSkillFile("skills/docalign-setup/document-processor.md");

  // 4. Write skills to BOTH project-level AND user-level (~/.claude/skills/)
  //    Project-level: available when Claude Code opens in this directory
  //    User-level: always available globally, regardless of working directory
  const userClaudeDir = path.join(
    process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
    ".claude",
  );

  for (const baseDir of [claudeDir, userClaudeDir]) {
    const skillDir = path.join(baseDir, "skills", "docalign");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);

    const setupSkillDir = path.join(baseDir, "skills", "docalign-setup");
    fs.mkdirSync(setupSkillDir, { recursive: true });
    fs.writeFileSync(path.join(setupSkillDir, "SKILL.md"), setupSkillMd);
    fs.writeFileSync(path.join(setupSkillDir, "document-processor.md"), docProcessorMd);
  }

  write("  \u2713 .claude/skills/docalign/SKILL.md (daily usage skill)");
  write("  \u2713 .claude/skills/docalign-setup/SKILL.md (setup wizard)");
  write("  \u2713 .claude/skills/docalign-setup/document-processor.md (sub-agent spec)");
  write("  \u2713 ~/.claude/skills/docalign/SKILL.md (user-level, global)");
  write("  \u2713 ~/.claude/skills/docalign-setup/SKILL.md (user-level, global)");
  write("  \u2713 ~/.claude/skills/docalign-setup/document-processor.md (user-level, global)");

  // 5. Write setup trigger to CLAUDE.md so setup starts automatically on next Claude Code launch
  const claudeMdPath = path.join(cwd, "CLAUDE.md");
  const setupMarker = `<!-- docalign:setup-pending -->
**DocAlign Setup Required:** Immediately invoke the \`/docalign-setup\` skill to begin interactive configuration of documentation monitoring. (This notice is removed automatically when setup completes.)
<!-- /docalign:setup-pending -->

`;
  const claudeMdContent = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, "utf-8")
    : "";
  if (!claudeMdContent.includes("docalign:setup-pending")) {
    fs.writeFileSync(claudeMdPath, setupMarker + claudeMdContent);
    write("  \u2713 CLAUDE.md (setup trigger \u2014 removed after setup completes)");
  }

  write("");
  write("\u2705 DocAlign installation complete!");
  write("");
  write("\uD83D\uDE80 Next step: Restart Claude Code");
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
