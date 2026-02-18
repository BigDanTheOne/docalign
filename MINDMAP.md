# DocAlign Product Mind Map

## Overview

**DocAlign** is a documentation-reality alignment engine that detects when documentation drifts from the actual codebase. It extracts verifiable claims from docs and checks each claim against the actual codebase.

**Core Value Proposition:**

- Zero configuration required
- Works as CLI tool and MCP server for AI coding agents
- Prevents documentation drift (stale docs, broken links, incorrect examples)

---

## 🏗️ Architecture (8 Layers)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DocAlign Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Layer 0: Codebase Index (L0)                                    │
│  ├── File tree (git ls-files + walkDir)                         │
│  ├── Package manifests (package.json, etc.)                     │
│  └── AST entities (tree-sitter parsing)                         │
│                                                                   │
│  Layer 1: Claim Extractor (L1)                                   │
│  ├── Preprocessing (format detection, skip tags)                │
│  ├── Syntactic extractors (regex patterns)                      │
│  └── Deduplication                                              │
│                                                                   │
│  Layer 2: Mapper (L2)                                            │
│  └── Maps claims to relevant code files (3-step mapping)        │
│                                                                   │
│  Layer 3: Verifier (L3)                                          │
│  ├── Tier 1: Deterministic checks                               │
│  ├── Tier 2: Pattern-based checks                               │
│  ├── Tier 3: LLM verification (optional)                        │
│  └── Tier 4: Human review                                       │
│                                                                   │
│  Layer 4: Triggers (L4)                                          │
│  ├── Webhook handlers                                           │
│  ├── Scan queue                                                 │
│  └── Pipeline orchestration                                     │
│                                                                   │
│  Layer 5: Reporter (L5)                                          │
│  ├── PR comments                                                │
│  ├── Check runs                                                 │
│  └── Health scores                                              │
│                                                                   │
│  Layer 6: MCP Server (L6)                                        │
│  └── 10 MCP tools for AI agent integration                      │
│                                                                   │
│  Layer 7: Learning (L7)                                          │
│  ├── Feedback loop                                              │
│  ├── Suppression rules                                          │
│  └── Learning system                                            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Claim Types (11 Types)

| Type                   | Description           | Example                    |
| ---------------------- | --------------------- | -------------------------- |
| **path_reference**     | File paths in docs    | `src/auth.ts`              |
| **dependency_version** | Package versions      | `express 4.18`             |
| **command**            | CLI commands          | `npm run deploy`           |
| **api_route**          | API endpoints         | `GET /api/users`           |
| **code_example**       | Code snippets         | Import statements          |
| **behavior**           | Behavioral claims     | "Function retries 3 times" |
| **architecture**       | Architecture claims   | "Uses microservices"       |
| **config**             | Configuration claims  | "Defaults to port 3000"    |
| **convention**         | Convention claims     | Code style rules           |
| **environment**        | Environment variables | `DATABASE_URL`             |
| **url_reference**      | URLs/links            | External documentation     |

---

## 🖥️ CLI Commands (9 Commands)

### Core Commands

```
docalign scan                    # Full repository scan
docalign check <file>            # Check single doc file
docalign fix [file]              # Apply suggested fixes
docalign extract [file...]       # Extract semantic claims via Claude
```

### Setup Commands

```
docalign init                    # Setup Claude Code integration
  ├── Creates .claude/settings.local.json
  ├── Adds MCP server config
  ├── Adds PostToolUse hook
  └── Creates .claude/skills/docalign/SKILL.md

docalign configure               # Create/update .docalign.yml
  ├── --exclude=PATTERN
  ├── --min-severity=LEVEL
  └── --reset
```

### Utility Commands

```
docalign status                  # Show config and integration status
docalign mcp                     # Start MCP server
docalign viz                     # Generate interactive knowledge graph
```

---

## 🔌 MCP Tools (10 Tools)

### Documentation Checking

| Tool            | Purpose                               | CLI Equivalent          |
| --------------- | ------------------------------------- | ----------------------- |
| `check_doc`     | Check specific file for drift         | `docalign check <file>` |
| `check_section` | Check specific section                | MCP-only                |
| `deep_check`    | Thorough audit (syntactic + semantic) | Enhanced check          |

### Discovery & Search

| Tool                | Purpose                    | CLI Equivalent             |
| ------------------- | -------------------------- | -------------------------- |
| `get_doc_health`    | Overall health score       | `docalign scan` summary    |
| `list_drift`        | Find all stale docs        | `docalign scan` drift list |
| `get_docs_for_file` | Find docs referencing code | MCP-only                   |
| `get_docs`          | Search docs by topic       | MCP-only                   |

### Fixing & Reporting

| Tool              | Purpose                  | CLI Equivalent               |
| ----------------- | ------------------------ | ---------------------------- |
| `fix_doc`         | Generate fix suggestions | `docalign fix [file]`        |
| `report_drift`    | Report inaccuracy found  | MCP-only                     |
| `register_claims` | Persist semantic claims  | `docalign extract` generates |

---

## ⚙️ Configuration System

### Configuration File: `.docalign.yml`

```yaml
# 14 Configuration Sections

doc_patterns: # Which docs to scan
  include: [...]
  exclude: [...]

code_patterns: # Which code to index
  include: ["**"]
  exclude: [...]

verification: # Verification behavior
  min_severity: low
  max_claims_per_pr: 50
  auto_fix: false

claim_types: # Enable/disable types
  path_reference: true
  dependency_version: true
  # ... etc

suppress: # Suppression rules
  - file: "docs/legacy.md"
  - pattern: "internal-.*"

schedule: # Automated scans
  full_scan: weekly

agent: # Agent execution
  concurrency: 5

trigger: # GitHub App triggers
  on_pr_open: true

llm: # Model selection
  verification_model: claude-sonnet-4-20250514

# ... and more
```

### Zero-Config Philosophy

- If `.docalign.yml` missing → uses sensible defaults
- 18 default doc patterns included (README, docs/\*\*, etc.)
- All claim types enabled by default
- Auto-discovers docs, no manual configuration needed

---

## 🔧 Current Init Process (Non-Interactive)

### What `docalign init` Does:

```
1. Check for git repository
   └── If no .git → Error exit

2. Create .claude/ directory

3. Write .claude/settings.local.json
   ├── permissions.allow: ["mcp__docalign__*"]
   ├── mcpServers.docalign: {command: "npx docalign mcp --repo ."}
   └── hooks.PostToolUse: Git commit detection

4. Write .claude/skills/docalign/SKILL.md
   ├── 8-9 workflow definitions
   ├── 8-10 tool descriptions
   └── Troubleshooting guide

5. Output success message
```

### What's Missing (For Interactive Setup):

- ❌ No user prompts/questions
- ❌ No customization options
- ❌ No pre-flight checks (npx, Claude Code)
- ❌ No backup/restore
- ❌ No MCP connection test
- ❌ No sample check
- ❌ No multi-client support
- ❌ No hook customization

---

## 🎭 Skill Content (Current)

### Workflows Defined (8-9):

1. **Post-Change Doc Check** (most important)
2. Check a Specific Doc
3. Repository Health Overview
4. Check a Specific Section
5. Find All Stale Docs
6. Post-Implementation Check (post-commit)
7. Search and Verify
8. Report and Track Drift
9. Deep Documentation Audit

### Tool Documentation:

- Table of 8-10 MCP tools
- When to use each tool
- Parameter descriptions

### Verdicts & Severity:

- **Verified**: Claim matches code
- **Drifted**: Claim contradicts code
- **Severity**: high/medium/low

---

## 📦 Entry Points

### 1. CLI Entry

```typescript
// src/cli/main.ts → dist/cli/main.js
// Binary: docalign
docalign < command > [args][options];
```

### 2. MCP Server Entry

```typescript
// src/layers/L6-mcp/local-server.ts → dist/layers/L6-mcp/local-server.js
// Binary: docalign-mcp
npx docalign mcp --repo .
```

### 3. Express Server Entry

```typescript
// src/app.ts
// Full server with webhooks, API, queue
```

---

## 🔄 Data Flow

### CLI Mode Pipeline:

```
CLI Command → LocalPipeline
    ├── L0: Build InMemoryIndex
    │    ├── File tree
    │    ├── Package manifests
    │    └── AST entities
    ├── L1: extractClaimsInMemory()
    │    ├── Preprocessing
    │    ├── Syntactic extractors
    │    └── Deduplication
    ├── L3: verifyClaim() per claim
    │    ├── Tier 1: Deterministic
    │    ├── Tier 2: Pattern-based
    │    └── Tier 3: LLM (optional)
    └── Output: CheckResult / ScanResult
```

### Storage:

- **CLI Mode**: SQLite (`.docalign/db.sqlite`)
- **Server Mode**: PostgreSQL

---

## 🛠️ Technologies

| Technology                | Purpose                    |
| ------------------------- | -------------------------- |
| TypeScript                | Primary language           |
| Node.js                   | Runtime (>= 18)            |
| Express                   | HTTP server                |
| Tree-sitter               | AST parsing (JS/TS/Python) |
| Zod                       | Schema validation          |
| BullMQ + Redis            | Job queue                  |
| PostgreSQL                | Server database            |
| better-sqlite3            | Local database             |
| Pino                      | Structured logging         |
| MiniSearch                | Full-text search           |
| @modelcontextprotocol/sdk | MCP server                 |
| Vitest                    | Testing                    |

---

## 🎯 Interactive Setup Requirements (New Feature)

### Goals:

1. **Transparent Installation** - Show source before running
2. **Interactive Configuration** - Ask user preferences
3. **Token Budget Awareness** - Show costs upfront
4. **Flexible Initial Scan** - Demo → Full scan options
5. **Hook Customization** - Optional git hooks
6. **Configuration Persistence** - Save to `.docalign/config.yml`

### Proposed Flow:

```
1. Discovery
   ├── Find all docs
   ├── Show token estimates
   └── Let user select which to monitor

2. Ignore Patterns
   ├── Suggest common patterns
   └── Let user add custom

3. Git Hooks
   └── Ask: Install post-commit hook? (y/n)

4. Initial Scan Scope
   ├── [1] Quick Demo (1 doc, ~500 tokens)
   ├── [2] Fast Scan (core docs, ~5K tokens)
   ├── [3] Full Scan (all docs, ~25K tokens)
   └── [4] Skip for now

5. Summary & Next Steps
   ├── Show configuration saved
   ├── Quick commands reference
   └── Pro tips
```

---

## 📋 File Locations Summary

### Source Code:

```
src/
├── cli/
│   ├── commands/
│   │   ├── init.ts          # Current init command
│   │   ├── scan.ts
│   │   ├── check.ts
│   │   ├── fix.ts
│   │   ├── extract.ts
│   │   ├── configure.ts
│   │   ├── status.ts
│   │   ├── mcp.ts
│   │   └── viz.ts
│   ├── main.ts              # CLI entry
│   ├── index.ts             # Command router
│   └── real-pipeline.ts     # LocalPipeline impl
├── layers/
│   └── L6-mcp/
│       ├── local-server.ts  # MCP server entry
│       ├── tool-handlers.ts # 10 tool implementations
│       └── server.ts        # Server mode
├── config/
│   ├── loader.ts            # Config loading
│   ├── schema.ts            # Zod schema
│   └── defaults.ts          # Default values
└── shared/
    └── types.ts             # TypeScript types
```

### Generated Files (by init):

```
.claude/
├── settings.local.json      # MCP config + hooks
└── skills/
    └── docalign/
        └── SKILL.md         # Claude skill
```

### User Config:

```
.docalign.yml                # User configuration (optional)
.docalign/                   # Local data directory
├── db.sqlite               # Local database
├── semantic/               # Semantic claims storage
└── reports/                # Drift reports
```

---

## 🔗 Key Integration Points

### For Interactive Setup:

1. **MCP Tools to Use:**
   - `get_doc_health` - Discovery
   - `get_docs` - Search
   - `check_doc` - Sample checks

2. **Files to Modify:**
   - `src/cli/commands/init.ts` - Make interactive
   - `.claude/skills/docalign/SKILL.md` - Add setup workflow

3. **New Files to Create:**
   - Interactive setup wizard
   - Configuration templates
   - Token estimator

4. **Configuration to Generate:**
   - `.docalign/config.yml` (new file)
   - Enhanced `.claude/settings.local.json`
   - Customized `.claude/skills/docalign/SKILL.md`
