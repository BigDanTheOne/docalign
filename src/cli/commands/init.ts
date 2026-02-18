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

const SETUP_SKILL_MD = `---
name: docalign-setup
description: >
  Interactive setup wizard for DocAlign. 
  USE ONLY when .docalign/config.yml does not exist.
  Guides user through: doc discovery → selection → configuration → 
  document annotation → initial scan.
  After setup completes, this skill becomes inactive and docalign skill takes over.
metadata:
  author: DocAlign
  version: 0.3.0
  trigger: config_missing
---

# DocAlign Interactive Setup

## Auto-Trigger Condition

**CHECK IMMEDIATELY ON LOAD:** Does \`.docalign/config.yml\` exist?

- **IF NO:** This is first-time setup. Begin "Setup Wizard" workflow below.
- **IF YES:** Setup already complete. Do nothing (docalign skill will handle usage).

---

## Setup Wizard (4 Phases)

### Phase 1: Discovery & Document Selection

**Step 1.1: Welcome & Discovery**

Say to user:

\`\`\`
👋 Welcome to DocAlign!

I can help you keep documentation in sync with your code. Let me start by
discovering what documentation you have in this project.

Scanning for documentation files...
\`\`\`

**Step 1.2: Discover Documentation**

1. Use Glob tool to find all markdown files:
   - \`**/*.md\`
   - \`**/*.mdx\`
   - Exclude: node_modules/**, .git/**, dist/**, build/**

2. Categorize each doc:
   - **Core docs:** README.md, docs/\\*_/_.md, API docs
   - **Changelog:** CHANGELOG.md, HISTORY.md, NEWS.md
   - **Backlog/Planning:** tasks/**, backlog/**, planning/\\*\\*
   - **Legacy:** docs/legacy/**, docs/archive/**
   - **Examples:** examples/**, tutorials/**

3. Calculate token estimates:
   - Read first 100 lines of each core doc to estimate size
   - Rough formula: 1 token ≈ 4 characters
   - Group by category

**Step 1.3: Present Interactive Selection**

Use interactive UI to present multi-select:

\`\`\`
📚 Documentation Discovery Complete

Found 12 documentation files:

┌─ Core Documentation (Recommended) ─┐
│ [✓] README.md                 500 tokens  │
│ [✓] docs/api.md              1200 tokens  │
│ [✓] docs/setup.md             800 tokens  │
│ [✓] docs/architecture.md     1500 tokens  │
└──────────────────────────────────────────┘

┌─ Auto-Generated (Usually Skip) ────────┐
│ [✗] CHANGELOG.md              300 tokens  │
│ [✗] LICENSE.md                200 tokens  │
└──────────────────────────────────────────┘

┌─ Internal/Planning (Usually Skip) ─────┐
│ [✗] tasks/backlog.md          400 tokens  │
│ [✗] planning/roadmap.md       600 tokens  │
└──────────────────────────────────────────┘

┌─ Legacy/Archive ───────────────────────┐
│ [?] docs/legacy/v1-api.md    1000 tokens  │
└──────────────────────────────────────────┘

Estimated tokens for initial scan: ~5,000

[Actions]
• Click to toggle selection
• "all" - monitor all docs
• "core" - monitor only core docs
• "done" - confirm selection
\`\`\`

**Step 1.4: Handle User Input**

- User clicks/toggles individual docs
- Or types: "all", "core", "skip 3,7", "done"
- Validate: at least 1 doc selected
- Show updated token estimate

**Step 1.5: Confirm Selection**

Say:

\`\`\`
✅ Selection confirmed:
• Monitoring: 8 docs (~5,000 tokens)
• Skipping: 4 docs (changelog, internal)

Ready to proceed to configuration?
\`\`\`

---

### Phase 2: Configuration & Headers

**Step 2.1: Generate Configuration**

1. Create \`.docalign/config.yml\`:

\`\`\`yaml
# DocAlign Configuration
# Generated by interactive setup

doc_patterns:
  include:
    # Core documentation (user selected)
    - README.md
    - docs/**/*.md
    - [other selected docs...]

  exclude:
    # Auto-generated files
    - CHANGELOG.md
    - CHANGELOG-*.md
    - HISTORY.md
    - NEWS.md
    - LICENSE.md

    # Internal planning
    - tasks/**
    - backlog/**
    - planning/**

    # Build artifacts
    - node_modules/**
    - dist/**
    - build/**

code_patterns:
  include:
    - "**"
  exclude:
    - node_modules/**
    - .git/**
    - dist/**
    - build/**
    - coverage/**

verification:
  min_severity: low
  max_claims_per_doc: 100

llm:
  verification_model: claude-sonnet-4-20250514
  extraction_model: claude-sonnet-4-20250514
\`\`\`

2. Write config file using Write tool

**Step 2.2: Write Document Headers**

For EACH selected document, write YAML frontmatter header:

Read the document first to understand its content, then write:

\`\`\`markdown
---
title: "[Extracted from doc]"
summary: "[2-3 sentence summary of purpose]"
description: "[Detailed description of what this doc covers]"
category: "[tutorial|reference|api|architecture|guide]"
read_when:
  - [Specific scenario when user should read this]
  - [Another scenario]
related:
  - [relative/path/to/related-doc.md]
  - [another/related/doc.md]
docalign:
  setup_date: "2024-01-15T10:30:00Z"
  monitored: true
---

[Original document content follows...]
\`\`\`

**Process per doc:**

1. Read existing content
2. Analyze: What is this doc about?
3. Extract/generate metadata (title, summary, category)
4. Identify related docs (files that reference each other)
5. Write header + original content back

**Step 2.3: Report Progress**

Say:

\`\`\`
✅ Configuration saved to .docalign/config.yml
✅ Headers written to 8 documents

Next: Processing documents to extract claims and add annotations...
\`\`\`

---

### Phase 3: Document Processing (Parallel Sub-Agents)

**Step 3.1: Spawn Sub-Agents**

For EACH selected document, spawn a sub-agent using Task tool:

\`\`\`
Spawn sub-agent: Document Processor - {filename}
\`\`\`

**Sub-Agent Task Description:**

\`\`\`
You are a Document Processor for DocAlign.

Your task: Process this single document completely.

Document: {file_path}

What to do:
1. READ the document thoroughly
2. UNDERSTAND what code/concepts it describes
3. EXTRACT all claims:
   - Syntactic: file paths, commands, versions, API routes, env vars
   - Semantic: behavior descriptions, architecture decisions, config defaults
4. WRITE TAGS to the document:
   - <!-- docalign:skip reason="..." --> for examples/tutorials
   - <!-- docalign:semantic id="..." claim="..." --> for semantic claims
   - <!-- docalign:claim id="..." type="..." status="..." --> for syntactic claims
5. STORE semantic claims in .docalign/semantic/{file}.json:
   - Include evidence entities (code symbols)
   - Include evidence assertions (grep patterns)

Context provided:
- The document itself
- Related source files (if referenced)
- Package.json / project metadata
- File tree structure

Rules:
- Be thorough but precise
- Only mark clear examples as "skip"
- Include strong evidence for semantic claims
- Use ids like: claim-{hash}, semantic-{hash}, skip-{hash}

Return: Summary of what you found and created
\`\`\`

**Step 3.2: Parallel Execution**

- All sub-agents run in parallel (one per doc)
- Track progress: "Processing 5/8 documents..."

**Step 3.3: Retry Logic**

**IF a sub-agent fails:**

1. Log the failure
2. Wait 2 seconds
3. Retry the same sub-agent (up to 3 attempts)
4. If still failing after 3 retries:
   - Mark doc as "failed"
   - Continue with other docs
   - Report to user at end

**Step 3.4: Collect Results**

As sub-agents complete:

- Count successful completions
- Collect summaries
- Track any failures

Say:

\`\`\`
✅ Document processing complete:
• Successful: 7 docs
• Failed: 1 doc (docs/legacy/api.md)
• Claims extracted: ~150 total
• Tags written: ~200 total
\`\`\`

---

### Phase 4: Initial Scan

**Step 4.1: Offer Initial Scan**

Say:

\`\`\`
🎉 Setup nearly complete!

Your documentation is now configured and annotated. Let's verify everything
is working with an initial scan.

Choose scan scope:

[1] Quick Demo - Check README only (~30 seconds)
    Great for seeing how results look

[2] Fast Scan - Check all selected docs (~2 minutes)
    Full verification of your documentation

[3] Skip for now - Complete setup, scan later
    You can run "docalign scan" anytime

Enter 1, 2, or 3:
\`\`\`

**Step 4.2: Execute Scan**

**IF user chooses 1 (Quick Demo):**

\`\`\`
Running quick check on README.md...
\`\`\`

Call MCP tool: \`check_doc\` with file="README.md"

Present results:

\`\`\`
📊 README.md Check Results:

Claims found: 15
✅ Verified: 12 (80%)
⚠️  Drifted: 2 (13%)
❓ Uncertain: 1 (7%)

Drifted Claims:
• Line 23: Path "src/auth.ts" doesn't exist
  Suggested fix: "src/authentication.ts"

• Line 45: Command "npm run deploy" script not found
  Suggested fix: Add to package.json or update docs

Overall health: Good! Most docs are accurate.
\`\`\`

**IF user chooses 2 (Fast Scan):**

\`\`\`
Running full scan on all selected docs...
This will take approximately 2 minutes.
\`\`\`

For each doc, call \`check_doc\` and aggregate results:

\`\`\`
📊 Documentation Health Report

Overall Score: 87/100

✅ README.md        15 claims  (93% verified)
✅ docs/api.md      42 claims  (88% verified)
⚠️  docs/setup.md   23 claims  (78% verified)
   └─ 3 drifted claims found

Top Issues:
1. docs/setup.md line 34: Outdated command
2. docs/api.md line 128: Missing parameter
3. docs/setup.md line 56: Wrong version
\`\`\`

**Step 4.3: Clean Up Setup Trigger**

Remove the auto-trigger notice from \`CLAUDE.md\`:

1. Read \`CLAUDE.md\` from the project root
2. Remove the block between \`<!-- docalign:setup-pending -->\` and \`<!-- /docalign:setup-pending -->\` (inclusive, including the trailing blank line)
3. Write the updated content back
4. If \`CLAUDE.md\` is now empty, delete it

**Step 4.4: Final Summary**

Say:

\`\`\`
✅ DocAlign Setup Complete!

Configuration:
• Config file: .docalign/config.yml
• Monitored docs: 8 files
• Semantic claims: .docalign/semantic/

Next Steps:
• Run "docalign scan" anytime to check all docs
• After code changes, I'll suggest checking related docs
• Use "docalign fix" to apply suggested fixes

The docalign skill is now active for daily usage.
\`\`\`

---

## Error Handling

### Document Processing Failures

**IF sub-agent fails:**

1. **First failure:** Retry immediately
2. **Second failure:** Wait 2 seconds, retry
3. **Third failure:**
   - Mark as permanent failure
   - Add to \`.docalign/failed-docs.json\`
   - Continue with other docs
   - Report at end: "1 doc failed processing (will retry on next scan)"

### User Cancellation

**IF user cancels during setup:**

1. Stop current operation gracefully
2. Save partial progress to \`.docalign/config.yml\`
3. Say: "Setup paused. Run 'docalign init' to continue."

### Missing Tools

**IF MCP tools unavailable:**

Say:

\`\`\`
⚠️  DocAlign MCP server not connected.

Please ensure:
1. DocAlign is installed: npm install -g docalign
2. Run: docalign init (to configure MCP)
3. Restart Claude Code
\`\`\`

---

## Post-Setup Transition

After setup completes successfully:

1. \`.docalign/config.yml\` now exists
2. This skill becomes inactive (trigger condition no longer met)
3. User restarts Claude Code
4. **docalign skill** (daily usage) becomes active
5. Normal workflows begin (post-change checks, health monitoring, etc.)

---

## Key Design Principles

1. **Transparent:** User sees every step, understands what's happening
2. **Educational:** Explains token costs, claim types, why certain docs are skipped
3. **Forgiving:** Retry logic, can resume if interrupted
4. **Progressive:** Demo option lets user see value before full scan
5. **Parallel:** Sub-agents process docs simultaneously for speed
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
    'bash -c \'INPUT=$(cat); if echo "$INPUT" | grep -q "git commit"; then echo "[DocAlign] Code committed. Consider running get_doc_health or check_doc to verify documentation is still accurate."; fi\'';
  const existingHook = settings.hooks.PostToolUse.find((h) =>
    h.hooks?.some((hk) => hk.command.includes("DocAlign")),
  );
  if (!existingHook) {
    settings.hooks.PostToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: hookCommand }],
    });
  }

  // Add SessionStart hook: on every new session, if config is missing, inject setup context
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  const sessionStartCmd =
    "bash -c 'test -f .docalign/config.yml || echo \"[DocAlign] Setup required: run /docalign-setup to configure documentation monitoring for this project.\"'";
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
  const setupSkillMd = SETUP_SKILL_MD;
  fs.writeFileSync(setupSkillPath, setupSkillMd);
  write("  ✓ .claude/skills/docalign-setup/SKILL.md (setup wizard)");

  // 5. Write setup trigger to CLAUDE.md so setup starts automatically on next Claude Code launch
  const claudeMdPath = path.join(cwd, "CLAUDE.md");
  const setupMarker = `<!-- docalign:setup-pending -->
**DocAlign Setup Required:** Immediately invoke the \`/docalign-setup\` skill to begin interactive configuration of documentation monitoring. (This notice is removed automatically when setup completes.)
<!-- /docalign:setup-pending -->

`;
  let claudeMdContent = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, "utf-8")
    : "";
  if (!claudeMdContent.includes("docalign:setup-pending")) {
    fs.writeFileSync(claudeMdPath, setupMarker + claudeMdContent);
    write("  ✓ CLAUDE.md (setup trigger — removed after setup completes)");
  }

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

