# DocAlign Interactive Setup - Implementation Design

## Overview

This document outlines the implementation of an interactive setup wizard for DocAlign that uses Claude Code sub-agents for efficient codebase exploration and intelligent configuration.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTERACTIVE SETUP FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  USER: "setup docalign" or First Run                                         │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 1: DISCOVERY (Parallel Exploration)                           │    │
│  │                                                                     │    │
│  │ Main Claude (coordinator)                                           │    │
│  │    │                                                                │    │
│  │    ├── Spawn Explore Sub-agent #1  →  /docs directory               │    │
│  │    │    • Model: Haiku (fast, cheap)                               │    │
│  │    │    • Tools: Read-only                                          │    │
│  │    │    • Returns: Doc list + categorization                        │    │
│  │    │                                                                │    │
│  │    ├── Spawn Explore Sub-agent #2  →  /src + config files          │    │
│  │    │    • Model: Haiku                                             │    │
│  │    │    • Tools: Read-only                                          │    │
│  │    │    • Returns: Project structure + type                        │    │
│  │    │                                                                │    │
│  │    └── Spawn Explore Sub-agent #3  →  Root + special files         │    │
│  │         • Model: Haiku                                             │    │
│  │         • Tools: Read-only                                          │    │
│  │         • Returns: README analysis + metadata                       │    │
│  │                                                                     │    │
│  │ Main Claude synthesizes findings → Creates mind map                 │    │
│  │    • Project name, type, architecture                               │    │
│  │    • Doc categorization (core vs skip)                              │    │
│  │    • Token estimates                                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 2: USER CONFIRMATION (Interactive)                            │    │
│  │                                                                     │    │
│  │ Claude presents findings:                                           │    │
│  │                                                                     │    │
│  │ "I analyzed your project:                                           │    │
│  │  • Name: MyApp (Node.js API service)                                │    │
│  │  • Architecture: Express + TypeScript                               │    │
│  │                                                                     │    │
│  │  Core docs to monitor (8 files, ~5K tokens):                        │    │
│  │   ✓ README.md                                                       │    │
│  │   ✓ docs/api.md                                                     │    │
│  │   ✓ docs/authentication.md                                          │    │
│  │                                                                     │    │
│  │  Skipped (5 files):                                                 │    │
│  │   ✗ CHANGELOG.md (auto-generated)                                   │    │
│  │   ✗ tasks/backlog.md (internal planning)                            │    │
│  │   ...                                                               │    │
│  │                                                                     │    │
│  │  Proceed with this configuration? [y/n/adjust]"                     │    │
│  │                                                                     │    │
│  │ If "adjust": Interactive selection of docs                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 3: CONFIGURATION (Writing Files)                              │    │
│  │                                                                     │    │
│  │ Main Claude spawns action sub-agents:                               │    │
│  │                                                                     │    │
│  │ 1. Config Writer Sub-agent                                          │    │
│  │    • Write .docalign/config.yml                                     │    │
│  │    • Include: patterns, claim types, settings                       │    │
│  │                                                                     │    │
│  │ 2. Skill Header Writer Sub-agent                                    │    │
│  │    • Write .claude/skills/docalign/SKILL.md                         │    │
│  │    • Include: Project-specific header                               │    │
│  │    • Include: Auto-trigger conditions                               │    │
│  │                                                                     │    │
│  │ 3. Doc Annotator Sub-agent (optional)                               │    │
│  │    • Add <!-- docalign:skip --> tags                                │    │
│  │    • Mark auto-generated sections                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 4: INITIAL SCAN OPTIONS                                       │    │
│  │                                                                     │    │
│  │ "Setup complete! Want to run initial scan?"                         │    │
│  │                                                                     │    │
│  │ [1] Quick Demo - Check README only (~500 tokens)                    │    │
│  │ [2] Fast Scan - Core docs (~5K tokens)                              │    │
│  │ [3] Skip for now - Scan later with 'check my docs'                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 5: SUMMARY                                                    │    │
│  │                                                                     │    │
│  │ Show final summary with:                                            │    │
│  │ • Files created                                                     │    │
│  │ • Quick command reference                                           │    │
│  │ • Next steps                                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Components

### 1. New Sub-Agent Definitions

#### Sub-agent: `docalign-explore-docs`

**File:** `.claude/agents/docalign-explore-docs.md`

```markdown
---
name: docalign-explore-docs
description: >
  Explores documentation directories to identify and categorize all documentation files.
  Used by DocAlign setup wizard to discover docs that should be monitored vs skipped.
tools:
  - Read
  - Glob
  - Grep
model: haiku
permissionMode: plan
---

You are a documentation explorer for DocAlign setup.

Your task: Explore the provided directory (usually docs/, wiki/, or similar) and identify all documentation files.

For each file found, categorize it:

- **CORE**: Primary documentation users rely on (README, API docs, guides)
- **CHANGELOG**: Version history (usually auto-generated)
- **INTERNAL**: Team planning, backlogs, tasks (not user-facing)
- **EXAMPLES**: Code examples/tutorials (may be outdated)
- **ARCHIVE**: Legacy/outdated docs
- **LICENSE**: License files (not documentation)

Return a structured report:
```

DIRECTORY: [path explored]

CORE DOCUMENTATION ([count] files):

- [filename] - [brief description of content]
- [filename] - [brief description of content]
  ...

AUTO-SKIP (not user-facing docs):

- [filename] - [reason]
- [filename] - [reason]
  ...

UNCERTAIN (needs manual review):

- [filename] - [why uncertain]

```

Be thorough but concise. Focus on file paths and categorization, not full content analysis.
```

#### Sub-agent: `docalign-explore-code`

**File:** `.claude/agents/docalign-explore-code.md`

```markdown
---
name: docalign-explore-code
description: >
  Explores codebase structure to understand project type, architecture, and entry points.
  Used by DocAlign setup wizard to build project context.
tools:
  - Read
  - Glob
  - Grep
model: haiku
permissionMode: plan
---

You are a codebase explorer for DocAlign setup.

Your task: Analyze the codebase structure to understand:

1. Project type (Node.js, Python, Rust, Go, etc.)
2. Main framework/library (Express, Django, React, etc.)
3. Entry points and main modules
4. Architecture pattern (monolith, microservices, etc.)
5. Key directories and their purposes

Quickly scan:

- package.json, Cargo.toml, requirements.txt, go.mod (project type)
- Main source directories (src/, lib/, app/)
- Configuration files
- Test directories

Return a structured report:
```

PROJECT ANALYSIS:

Type: [Node.js/Python/Rust/etc.]
Framework: [Express/Django/React/etc.]
Architecture: [Monolith/Microservices/Library/etc.]

Key Directories:

- [dir] - [purpose]
- [dir] - [purpose]

Entry Points:

- [file] - [what it does]

Key Modules:

- [module] - [purpose]
- [module] - [purpose]

```

Focus on high-level structure, not implementation details.
```

#### Sub-agent: `docalign-explore-root`

**File:** `.claude/agents/docalign-explore-root.md`

```markdown
---
name: docalign-explore-root
description: >
  Explores root directory and special files to extract project metadata.
  Used by DocAlign setup wizard for project identification.
tools:
  - Read
  - Glob
model: haiku
permissionMode: plan
---

You are a root directory explorer for DocAlign setup.

Your task: Analyze the root directory to extract:

1. Project name (from package.json, Cargo.toml, or README)
2. Description/summary (from README or package files)
3. Version (if available)
4. Special files present (.docalign.yml, .claude/, etc.)
5. Repository structure indicators

Files to check:

- README.md (first 50 lines for description)
- package.json, Cargo.toml, pyproject.toml, etc.
- .gitignore (to understand project structure)
- Any existing .docalign/ or .claude/ directories

Return a structured report:
```

ROOT ANALYSIS:

Project Name: [name]
Description: [one-line summary]
Version: [version or "unknown"]

Special Directories Found:

- [dir] - [purpose if known]

Existing Config:

- .docalign.yml: [yes/no]
- .claude/skills/: [yes/no]

README Summary:
[2-3 sentences about what the project does]

```

```

### 2. SKILL.md Updates

Add new workflow to `.claude/skills/docalign/SKILL.md`:

```markdown
## Workflow: Setup Wizard (First-Time Configuration)

**When to trigger:**

- User says "setup docalign" or "configure docalign"
- When this skill loads and `.docalign/config.yml` does not exist
- User is setting up DocAlign for the first time

**Do NOT trigger if:**

- Config already exists (use `/docalign-config` instead)

### Phase 1: Discovery

1. **Announce the setup**
   Say: "👋 Welcome to DocAlign! I'll help you set up documentation monitoring.

   First, let me explore your project to understand its structure and documentation..."

2. **Spawn exploration sub-agents in parallel**

   Use Task tool to spawn 3 sub-agents simultaneously:

   a) **Explore Docs Sub-agent** (`docalign-explore-docs`)
   - Task: "Explore all documentation directories (docs/, wiki/, etc.)
     and categorize each file as CORE, CHANGELOG, INTERNAL, etc."

   b) **Explore Code Sub-agent** (`docalign-explore-code`)
   - Task: "Explore the codebase structure to understand project type,
     framework, architecture, and key directories."

   c) **Explore Root Sub-agent** (`docalign-explore-root`)
   - Task: "Analyze root directory and README to extract project name,
     description, version, and check for existing config."

3. **Wait for all sub-agents to complete**
   Collect results from all three.

4. **Synthesize findings into mind map**
   Build understanding of:
   - Project identity (name, type, architecture)
   - Documentation landscape (core vs skip)
   - Token estimates for scanning

### Phase 2: User Confirmation

Present findings in a clear, structured format:
```

📊 Project Analysis Complete

Project: MyApp v1.2.3
Type: Node.js API Service (Express + TypeScript)
Architecture: Monolithic REST API

📚 Documentation Found (13 files):

Core Documentation (Monitor) - 8 files, ~5K tokens:
✓ README.md - Project overview and quick start
✓ docs/api.md - API endpoint documentation
✓ docs/authentication.md - Auth flow guide
✓ docs/deployment.md - Deployment instructions
✓ docs/configuration.md - Config options
✓ CONTRIBUTING.md - Contribution guidelines
✓ docs/examples.md - Usage examples
✓ docs/troubleshooting.md - Common issues

Auto-Skip (Not user-facing):
✗ CHANGELOG.md - Auto-generated version history
✗ tasks/backlog.md - Internal planning
✗ tasks/active.md - Current sprint tasks
✗ notes/ideas.md - Development notes
✗ LICENSE.md - License file

Does this configuration look correct?
[y] Yes, proceed
[n] No, let me adjust
[v] View full file list

```

If user chooses to adjust:
- Show interactive list: "Enter numbers to toggle (e.g., '3 5' to include docs/api.md and docs/examples.md)"
- Allow pattern input: "Add patterns to ignore (e.g., '**/draft/**, **/*.wip.md')"

### Phase 3: Configuration

1. **Confirm writing configuration**
   Say: "✅ I'll now create your configuration files..."

2. **Spawn configuration sub-agents**

   a) **Write Config Sub-agent** (`docalign-write-config`)
      - Task: Write `.docalign/config.yml` with:
        - doc_patterns.include (core docs)
        - doc_patterns.exclude (skip patterns)
        - claim_types (enable all)
        - verification settings (sensible defaults)

   b) **Write Skill Header Sub-agent** (`docalign-write-skill`)
      - Task: Write `.claude/skills/docalign/SKILL.md` with:
        - Project-specific frontmatter (name, description)
        - Auto-trigger conditions based on project type
        - Updated workflows reflecting project structure

   c) **Annotate Docs Sub-agent** (`docalign-annotate-docs`) - Optional
      - Task: Add `<!-- docalign:skip -->` tags to:
        - Auto-generated sections (changelog, license)
        - Internal-only sections (backlog, tasks)

3. **Verify files were created**
   Check that all expected files exist and are valid.

### Phase 4: Initial Scan Options

Present options for first scan:

```

🎉 Setup Complete!

Configuration created:
✓ .docalign/config.yml
✓ .claude/skills/docalign/SKILL.md
✓ .claude/settings.local.json (MCP config)

Ready to scan your documentation?

[1] 🔍 Quick Demo - Check README only (~500 tokens)
Best for: Seeing how it works

[2] ⚡ Fast Scan - Core docs only (~5K tokens)
Best for: Getting baseline quickly

[3] 🔎 Full Scan - All monitored docs
Best for: Complete baseline

[4] ⏭️ Skip for now - Scan later with "check my docs"

```

If user selects 1-3:
- Call appropriate MCP tool (check_doc, deep_check, or scan)
- Show results
- Explain what was found

### Phase 5: Summary

Display final summary:

```

✨ DocAlign is Ready!

📁 Files Created:
• .docalign/config.yml - Your settings
• .claude/skills/docalign/SKILL.md - Claude workflows
• .claude/settings.local.json - MCP server config

📊 Configuration:
• Monitoring: 8 documentation files
• Skipping: 5 files (auto-generated/internal)
• Est. scan cost: ~5K tokens (full), ~500 tokens (quick)

🚀 Quick Commands:
• "Check README" - Verify specific file
• "List drift" - Show all stale docs
• "Doc health" - Overall status
• "/docalign-config" - Reconfigure anytime

💡 Pro Tips:
• After changing code, I'll suggest checking related docs
• Run "docalign extract" later to enable semantic claims
• Add <!-- docalign:skip --> tags to sections that shouldn't be checked

Happy documenting! 📝

```

```

### 3. Modified Init Command

Update `src/cli/commands/init.ts`:

**Current behavior:** Non-interactive, zero-config setup
**New behavior:** Support both modes

```typescript
interface InitOptions {
  interactive?: boolean; // --interactive flag
  quick?: boolean; // --quick flag (old behavior)
  dryRun?: boolean; // --dry-run (show what would happen)
}

export async function runInit(
  options: InitOptions = {},
  write: (msg: string) => void = console.log,
): Promise<number> {
  if (options.quick) {
    // Legacy behavior: just create files without interaction
    return runQuickInit(write);
  }

  if (options.interactive || !hasExistingConfig()) {
    // Signal that interactive setup should be done via Claude
    write("");
    write("🚀 DocAlign Interactive Setup");
    write("");
    write("This command sets up the basic structure.");
    write("For interactive configuration, Claude Code will guide you:");
    write("");
    write('  1. Say to Claude: "Setup docalign"');
    write("  2. Claude will explore your project");
    write("  3. Review and confirm configuration");
    write("  4. Run initial scan");
    write("");
    write("Or use --quick for non-interactive setup:");
    write("  docalign init --quick");
    write("");

    // Still create minimal files so MCP works
    await createMinimalSetup(write);

    return 0;
  }

  // Config exists - offer reconfiguration
  write("DocAlign is already configured.");
  write('Use "/docalign-config" to modify settings.');
  return 0;
}

async function createMinimalSetup(write: (msg: string) => void): Promise<void> {
  // Create bare minimum for MCP to work
  // - .claude/settings.local.json
  // - .claude/skills/docalign/SKILL.md (with setup workflow)
  // Don't create .docalign/config.yml yet (that's what interactive setup does)
}
```

Add CLI flags in `src/cli/index.ts`:

```typescript
// In argument parsing
if (args["--interactive"] || args["-i"]) {
  options.interactive = true;
}
if (args["--quick"] || args["-q"]) {
  options.quick = true;
}
if (args["--dry-run"]) {
  options.dryRun = true;
}
```

### 4. New Configuration File: `.docalign/config.yml`

**Structure:**

```yaml
# DocAlign Configuration
# Generated by interactive setup on [date]
# Edit with: docalign configure

project:
  name: "MyApp"
  type: "node-api" # node-api, python-service, rust-cli, etc.
  description: "REST API service built with Express"

doc_patterns:
  include:
    - "README.md"
    - "docs/**/*.md"
    - "CONTRIBUTING.md"
  exclude:
    - "CHANGELOG.md"
    - "**/tasks/**"
    - "**/backlog/**"
    - "LICENSE.md"
    - "**/archive/**"

claim_types:
  path_reference: true
  dependency_version: true
  command: true
  api_route: true
  code_example: true
  behavior: false # Disabled by default (requires semantic extraction)
  architecture: false
  config: true
  convention: true
  environment: true
  url_reference: true

verification:
  min_severity: low
  max_claims_per_doc: 100

setup:
  initialized: "2024-01-15T10:30:00Z"
  interactive: true
  version: "0.3.0"
```

### 5. New Files to Create

#### A. Sub-agent definitions (in repo)

- `.claude/agents/docalign-explore-docs.md`
- `.claude/agents/docalign-explore-code.md`
- `.claude/agents/docalign-explore-root.md`
- `.claude/agents/docalign-write-config.md`
- `.claude/agents/docalign-write-skill.md`

#### B. Updated/Enhanced Files

- `.claude/skills/docalign/SKILL.md` (add setup workflow)
- `src/cli/commands/init.ts` (support interactive flag)
- `src/cli/index.ts` (parse new flags)

#### C. Templates

- `templates/config.yml` (config template)
- `templates/skill-header.md` (skill header template)

## User Experience Flow

### Scenario 1: Fresh Install (Happy Path)

```bash
$ npm install -g docalign
$ docalign init

🚀 DocAlign Interactive Setup

This command sets up the basic structure.
For interactive configuration, Claude Code will guide you:

  1. Say to Claude: "Setup docalign"
  2. Claude will explore your project
  3. Review and confirm configuration
  4. Run initial scan

✓ Created .claude/settings.local.json
✓ Created .claude/skills/docalign/SKILL.md

Restart Claude Code and say "Setup docalign"
```

Then in Claude Code:

```
User: Setup docalign

Claude: 👋 Welcome to DocAlign! I'll help you set up documentation monitoring.

First, let me explore your project...
[Spawns sub-agents...]
[Shows progress...]

📊 Project Analysis Complete
[Shows findings...]

Does this configuration look correct? [y/n/adjust]

User: y

Claude: ✅ Configuration saved!

Ready to scan?
[1] Quick Demo  [2] Fast Scan  [3] Full Scan  [4] Skip

User: 1

Claude: [Runs check_doc on README...]
Found 12 claims, 2 drifted.
[Shows results...]

✨ DocAlign is Ready!
[Shows summary...]
```

### Scenario 2: Existing Project

```
User: Setup docalign

Claude: I see DocAlign is already configured.
Use "/docalign-config" to modify settings, or run "docalign init --force" to reset.
```

### Scenario 3: Non-Interactive (CI/Quick)

```bash
$ docalign init --quick
✓ Created .claude/settings.local.json
✓ Created .claude/skills/docalign/SKILL.md
✓ Created .docalign/config.yml (with defaults)

Done. Restart Claude Code to use DocAlign.
```

## Success Metrics

- **Setup completion rate**: % of users who complete interactive setup
- **Time to first scan**: How long from "init" to first successful scan
- **Token efficiency**: Average tokens used for setup vs traditional approach
- **User satisfaction**: Configuration accuracy (do they need to reconfigure?)

## Future Enhancements

1. **Resume interrupted setup**: If user cancels mid-setup, resume where left off
2. **Multi-project monorepo**: Detect and configure multiple packages
3. **Learning from corrections**: If user adjusts config, learn patterns
4. **Integration detection**: Auto-detect and configure for specific frameworks
5. **Team sharing**: Share discovered patterns across team via shared memory
