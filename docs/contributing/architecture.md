---
title: "Architecture"
summary: "Technical architecture reference for DocAlign contributors: layer overview, directory structure, data flow, core types, and entry points."
description: "Documents the 8-layer architecture (L0-L7), directory structure under src/, full scan pipeline flow, CLI mode vs server mode distinction, core TypeScript types in src/shared/types.ts, configuration flow from .docalign.yml through Zod validation, storage adapters (SQLite for CLI, PostgreSQL for server), and entry points."
category: architecture
read_when:
  - You are a contributor learning the codebase structure
  - You are implementing a new layer or feature
  - You need to understand how CLI mode differs from server mode
  - You are debugging a pipeline issue
related:
  - docs/contributing/adding-a-check.md
  - docs/contributing/design-patterns.md
  - docs/contributing/testing.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Architecture

DocAlign is organized into 8 layers (L0-L7), each with a single responsibility. Data flows through the layers as a pipeline.

<!-- docalign:skip reason="example_table" description="Layer overview table showing L0-L7 layer names and descriptions - this is illustrative of the architecture, but the specific tools count (10 tools) is a factual claim that should be verified separately" -->
## Layer Overview

<!-- docalign:semantic id="sem-54a8ac288ba87790" claim="MCP server has 10 tools with stdio transport" -->
```
L0  Codebase Index     Build lightweight repo view (file tree, AST, package.json)
L1  Claim Extractor    Parse docs, extract verifiable claims
L2  Mapper             Map claims to relevant code files
L3  Verifier           Check claims against code (Tier 1-2-3)
L4  Triggers           Webhook handlers, scan queue, pipeline orchestration
L5  Reporter           PR comments, check runs, health scores
L6  MCP                MCP server (10 tools, stdio transport)
L7  Learning           Feedback, suppression, learning loop
<!-- /docalign:skip -->
```

<!-- docalign:skip reason="illustrative_example" description="Directory structure example showing target file layout - this is aspirational/future state, not a claim about current codebase state" -->
## Directory Structure

```
src/
  layers/
    L0-codebase-index/    # AST parsing, entity indexing, file tree
    L1-claim-extractor/   # Doc parsing, regex extraction, table parsing
    L2-mapper/            # Claim-to-code mapping (3-step progressive)
    L3-verifier/          # Deterministic + pattern-based verification
    L4-triggers/          # Webhook handlers, scan queue
    L5-reporter/          # PR comments, check runs, health
    L6-mcp/               # MCP server (separate entry point)
    L7-learning/          # Feedback loop, suppress rules
  cli/                    # CLI commands (check, scan, extract, fix, viz)
  config/                 # Config loader, defaults, Zod schema
  shared/                 # Cross-cutting types, logger, db adapters
  storage/                # StorageAdapter interface + SQLite + PostgreSQL
```

<!-- /docalign:skip -->
## Data Flow
<!-- docalign:skip reason="capability_description" description="Full scan pipeline steps describing what the system does at each layer - this is high-level capability description using numbered steps" -->
### Full scan pipeline

```
1. L0 builds codebase index:
   - File tree (all paths in repo)
   - Package manifest (dependencies, scripts, engines, license from package.json)
   - AST entities (exports, functions, classes via tree-sitter)
   - Markdown headings (heading hierarchy with slugs)

2. L1 extracts claims from each doc file:
   - Syntactic: regex patterns per claim type
   - Table: column-semantic parsing
   - Semantic: Claude-generated assertions (if .docalign/semantic/ exists)

3. L2 maps each claim to relevant code files:
   - Step 1: Direct path match
   - Step 2: Keyword search
   - Step 3: Semantic similarity (if embeddings available)

4. L3 verifies each claim:
   - Tier 1: Deterministic checks (file exists? version matches?)
   - Tier 2: Pattern-based checks (env vars, conventions, config)
   - Tier 3: LLM verification (optional, for unresolved claims)
   - Cross-cutting: consistency, frontmatter, navigation, deprecation

5. L5 reports results:
   - CLI: formatted terminal output
   - MCP: tool responses
   - PR: GitHub comments (server mode)
```

<!-- /docalign:skip -->
### CLI mode vs Server mode

DocAlign runs in two modes:

<!-- docalign:semantic id="sem-bff55669284c98d8" claim="CLI mode uses SQLite, runs local pipeline: L0 → L1 → L3 → output, no L4 triggers, no L5 PR comments" -->
<!-- docalign:semantic id="sem-dd5dd0eaa580350f" claim="CliPipeline class orchestrates CLI pipeline in src/cli/local-pipeline.ts" -->
**CLI mode** (default): Uses SQLite for storage. Runs a local pipeline: L0 → L1 → L3 → output. No L4 triggers, no L5 PR comments. The `CliPipeline` class orchestrates this in `src/cli/local-pipeline.ts`.

<!-- docalign:semantic id="sem-21bd5f62c09b3da9" claim="Server mode uses PostgreSQL + Redis. Express server handles webhooks (L4), runs scan queue (BullMQ), posts PR comments (L5)" -->
**Server mode**: Uses PostgreSQL + Redis. Express server handles webhooks (L4), runs scan queue (BullMQ), posts PR comments (L5). Full pipeline with all layers.

## Core Types

The type system lives in `src/shared/types.ts`:

<!-- docalign:semantic id="sem-ec9acba3b77d80cc" claim="ClaimType is a union of 11 literal types" -->
- **`ClaimType`**: Union of 11 literal types (`'path_reference' | 'dependency_version' | ...`)
<!-- docalign:semantic id="sem-f232977934997b85" claim="Verdict is 'verified' | 'drifted' | 'uncertain'" -->
- **`Verdict`**: `'verified' | 'drifted' | 'uncertain'`
<!-- docalign:semantic id="sem-8b113ad32397a77d" claim="Severity is 'low' | 'medium' | 'high'" -->
- **`Severity`**: `'low' | 'medium' | 'high'`
- **`Claim`**: A verified claim with type, source location, value, verdict, severity, evidence
- **`RawExtraction`**: Output of L1 extraction before verification
- **`VerificationResult`**: Output of L3 verification (verdict, confidence, reasoning, evidence)
- **`ClaimMapping`**: L2 output linking a claim to code files

<!-- docalign:skip reason="illustrative_example" description="Configuration flow diagram showing data flow from .docalign.yml through loader and schema to validated config - this is a visual illustration" -->
## Configuration Flow

```
.docalign.yml  -->  config/loader.ts (parseConfig)  -->  config/schema.ts (Zod validation)
                                                              |
                                                    Merged with CONFIG_DEFAULTS
                                                              |
                                                    Validated DocalignConfig object
```

<!-- docalign:semantic id="sem-25cebbb673b72c10" claim="Config loader reads YAML, validates against Zod schema, merges with defaults, invalid fields get warnings and fall back to defaults" -->
The loader reads YAML, validates against the Zod schema, merges with defaults, and returns a typed config object. Invalid fields get warnings and fall back to defaults.

<!-- /docalign:skip -->
## Storage Adapters

The `StorageAdapter` interface abstracts the database:

<!-- docalign:semantic id="sem-2c74a43ec427a3d9" claim="SQLiteAdapter uses better-sqlite3. Single file at .docalign/db.sqlite" -->
- **SQLiteAdapter**: For CLI mode. Uses better-sqlite3. Single file at `.docalign/db.sqlite`.
- **PostgresAdapter**: For server mode. Uses pg with pgvector for embeddings.

Both implement the same interface, so layers above don't know which storage is in use.

## Entry Points

- **CLI**: `src/cli/index.ts` -- parses args, dispatches to command handlers
- **MCP Server**: `src/layers/L6-mcp/` -- stdio transport, tool handlers
- **Express Server**: `src/app.ts` -- webhook routes, health endpoint (server mode)
