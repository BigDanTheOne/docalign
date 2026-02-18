# Architecture

DocAlign is organized into 8 layers (L0-L7), each with a single responsibility. Data flows through the layers as a pipeline.

## Layer Overview

```
L0  Codebase Index     Build lightweight repo view (file tree, AST, package.json)
L1  Claim Extractor    Parse docs, extract verifiable claims
L2  Mapper             Map claims to relevant code files
L3  Verifier           Check claims against code (Tier 1-2-3)
L4  Triggers           Webhook handlers, scan queue, pipeline orchestration
L5  Reporter           PR comments, check runs, health scores
L6  MCP                MCP server (10 tools, stdio transport)
<!-- docalign:skip reason="tutorial_example" description="Directory structure listing of src/ layers — flagged in extraction notes and by the existing docalign:skip markers as target layout that may not match current state" -->
L7  Learning           Feedback, suppression, learning loop
```

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

## Data Flow
<!-- /docalign:skip -->

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

### CLI mode vs Server mode

DocAlign runs in two modes:

**CLI mode** (default): Uses SQLite for storage. Runs a local pipeline: L0 → L1 → L3 → output. No L4 triggers, no L5 PR comments. The `CliPipeline` class orchestrates this in `src/cli/local-pipeline.ts`.

**Server mode**: Uses PostgreSQL + Redis. Express server handles webhooks (L4), runs scan queue (BullMQ), posts PR comments (L5). Full pipeline with all layers.

## Core Types

The type system lives in `src/shared/types.ts`:

- **`ClaimType`**: Union of 11 literal types (`'path_reference' | 'dependency_version' | ...`)
- **`Verdict`**: `'verified' | 'drifted' | 'uncertain'`
- **`Severity`**: `'low' | 'medium' | 'high'`
- **`Claim`**: A verified claim with type, source location, value, verdict, severity, evidence
- **`RawExtraction`**: Output of L1 extraction before verification
- **`VerificationResult`**: Output of L3 verification (verdict, confidence, reasoning, evidence)
- **`ClaimMapping`**: L2 output linking a claim to code files

## Configuration Flow

```
.docalign.yml  -->  config/loader.ts (parseConfig)  -->  config/schema.ts (Zod validation)
                                                              |
                                                    Merged with CONFIG_DEFAULTS
                                                              |
                                                    Validated DocalignConfig object
```

The loader reads YAML, validates against the Zod schema, merges with defaults, and returns a typed config object. Invalid fields get warnings and fall back to defaults.

## Storage Adapters

The `StorageAdapter` interface abstracts the database:

- **SQLiteAdapter**: For CLI mode. Uses better-sqlite3. Single file at `.docalign/db.sqlite`.
- **PostgresAdapter**: For server mode. Uses pg with pgvector for embeddings.

Both implement the same interface, so layers above don't know which storage is in use.

## Entry Points

- **CLI**: `src/cli/index.ts` -- parses args, dispatches to command handlers
- **MCP Server**: `src/layers/L6-mcp/` -- stdio transport, tool handlers
- **Express Server**: `src/app.ts` -- webhook routes, health endpoint (server mode)
