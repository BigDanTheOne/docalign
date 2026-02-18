---
title: "How It Works"
summary: "Explains DocAlign's three-stage extract/verify/report pipeline, the codebase index structure, and how results flow to CLI, MCP, and PR outputs."
description: "Describes the full pipeline: Stage 1 (Extract) uses syntactic regex, table parsing, and optional LLM semantic extraction to produce typed claims with line numbers; Stage 2 (Verify) runs a four-tier system (Deterministic → Pattern-Based → LLM → Human Review); Stage 3 (Report) outputs to CLI, MCP tools, PR comments, health score, and viz. Also explains cross-cutting checks (consistency, frontmatter, navigation) and the L0 codebase index (file tree, package manifest, AST entities, headings)."
category: guide
read_when:
  - You want to understand what DocAlign does internally
  - You are evaluating whether DocAlign can catch a specific type of claim
  - You need to understand the difference between syntactic and semantic extraction
related:
  - docs/explanation/verification-tiers.md
  - docs/reference/checks.md
  - docs/contributing/architecture.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# How It Works

DocAlign follows a three-stage pipeline: **extract** claims from documentation, **verify** each claim against the codebase, and **report** the results.

## Pipeline Overview
<!-- docalign:skip reason="illustrative_example" description="ASCII pipeline diagram showing architecture with L0, L1, L3, L5 layer labels — already tagged by the project as an illustrative example, not a set of falsifiable code claims" -->

```
                    +-----------------------+
                    |   Documentation       |
                    |   (README.md, etc.)   |
                    +-----------+-----------+
                                |
                    +-----------v-----------+
                    |   L1: Extract Claims  |
                    |   (regex + tables +   |
                    |    optional LLM)      |
                    +-----------+-----------+
                                |
                         claims[]
                                |
+-----------------+  +----------v----------+
|   L0: Codebase  +-->   L3: Verify Each   |
|   Index         |  |   Claim             |
|   (AST, deps,   |  |   (Tier 1-2-3)      |
|    files, etc.)  |  +----------+----------+
+-----------------+             |
                         results[]
                                |
                    +-----------v-----------+
                    |   L5: Report          |
                    |   (CLI, MCP, PR)      |
                    +-----------------------+
```

## Stage 1: Extract
<!-- /docalign:skip -->

DocAlign scans each documentation file and extracts **claims** -- verifiable statements about the codebase.
<!-- docalign:skip reason="capability_description" description="Existing docalign:skip block — already tagged by the project as a capability description with hypothetical file paths, routes, commands, and env vars as illustrations of what the tool detects" -->

**Syntactic extraction** uses regex patterns to find:
- File paths: `src/auth.ts`, `![logo](assets/logo.png)`
- Dependency versions: "express 4.18.0", `npm install react@18`
- Commands: `npm run build`, `yarn test`
- API routes: `GET /api/users`, `POST /auth/login`
- Code examples: fenced code blocks with imports and symbols
- Environment variables: `DATABASE_URL`, `process.env.API_KEY`
- Convention claims: "Uses TypeScript strict mode"
- Config values: "defaults to port 3000"
<!-- /docalign:skip -->
- URLs: `https://docs.example.com/guide`

**Table extraction** parses markdown tables and recognizes column semantics (package/version/path/command columns).

**Semantic extraction** (optional, via `docalign extract`) uses Claude to find behavior, architecture, and config claims that regex can't catch.

<!-- docalign:semantic id="sem-da48f5798031ded4" claim="Each claim has a type, source file and line number, extracted value, and confidence score" -->
Each claim has a type, source file and line number, extracted value, and confidence score.

## Stage 2: Verify

Each claim is verified against the codebase through a tiered system. See [Verification Tiers](verification-tiers.md) for the full breakdown.

- **Tier 1 (Deterministic):** Direct evidence checks -- file exists? version matches? script defined?
- **Tier 2 (Pattern-Based):** Heuristic checks -- env var in .env? config in tsconfig.json?
- **Tier 3 (LLM):** For claims that can't be checked deterministically, optional
- **Tier 4 (Human Review):** Claims that remain uncertain after all tiers

## Stage 3: Report

Results flow to multiple outputs:

- **CLI:** `docalign scan` and `docalign check` print formatted results to the terminal
- **MCP:** 10 tools expose results to AI coding agents
- **PR Comments:** In server mode, posts verification results as GitHub PR comments
- **Health Score:** 0-100 based on verified / (verified + drifted) ratio
- **Viz:** `docalign viz` generates an interactive knowledge graph

## Verdicts

Each claim gets one of three verdicts:

<!-- docalign:skip reason="example_table" description="Verdict table listing the three verdict values and their meanings — the verdict values themselves are factual claims but the table format is illustrative; the claim about three verdicts is extracted separately as a semantic claim" -->
| Verdict | Meaning |
|---------|---------|
| **verified** | Claim matches the codebase |
| **drifted** | Claim contradicts the codebase (with severity: low/medium/high) |
| **uncertain** | Not enough evidence to determine |

## Cross-Cutting Analysis

After individual claims are verified, DocAlign runs cross-cutting checks:

<!-- /docalign:skip -->
<!-- docalign:semantic id="sem-e2cc3832298b7b29" claim="Cross-document consistency groups claims by entity; flags inconsistency when different files say different things about the same entity" -->
- **Cross-document consistency:** Groups claims by entity. If different files say different things about the same entity, flags the inconsistency.
<!-- docalign:semantic id="sem-a8bbe58405c4fa6a" claim="Frontmatter consistency checks YAML frontmatter title against the document's first heading" -->
- **Frontmatter consistency:** Checks YAML frontmatter `title` against the document's first heading.
- **Navigation validation:** Verifies that doc site configs reference files that exist.

## Codebase Index

<!-- docalign:semantic id="sem-82b3ceea31894520" claim="The L0 codebase index maintains: file tree, package manifest (dependencies/versions/scripts/engines/license), AST entities (functions/classes/exports), and Markdown headings with slugs" -->
The L0 codebase index maintains a lightweight view of the repo:

- **File tree:** Which files exist (for path verification)
- **Package manifest:** Dependencies, versions, scripts, engines, license
- **AST entities:** Functions, classes, and exports (for symbol resolution)
- **Headings:** Markdown heading hierarchy with slugs (for anchor validation)

<!-- docalign:semantic id="sem-90ab2dd5b182ad1f" claim="The codebase index is built on-demand and cached during a scan session" -->
This index is built on-demand and cached during a scan session.
