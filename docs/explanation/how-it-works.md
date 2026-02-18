---
title: "How DocAlign Works"
summary: "Explains the three-stage pipeline: extract claims from docs, verify against code, and report results."
description: "Describes the full DocAlign pipeline: Stage 1 (syntactic, table, and semantic claim extraction from markdown), Stage 2 (tiered verification: Tier 1 deterministic, Tier 2 pattern-based, Tier 3 LLM, Tier 4 human review), Stage 3 (CLI, MCP, PR comment output). Also covers the codebase index structure and cross-cutting analysis."
category: tutorial
read_when:
  - You want to understand how DocAlign finds and verifies claims
  - You are debugging unexpected verification behavior
  - You want to understand claim types and verdicts
related:
  - docs/explanation/verification-tiers.md
  - docs/reference/checks.md
  - docs/contributing/architecture.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# How It Works

DocAlign follows a three-stage pipeline: **extract** claims from documentation, **verify** each claim against the codebase, and **report** the results.

## Pipeline Overview
<!-- docalign:skip reason="illustrative_example" description="ASCII art pipeline diagram illustrating data flow between layers; not a factual claim about specific code" -->
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
<!-- /docalign:skip -->

## Stage 1: Extract
DocAlign scans each documentation file and extracts **claims** -- verifiable statements about the codebase.
**Syntactic extraction** uses regex patterns to find:
- File paths: `src/auth.ts`, `![logo](assets/logo.png)`
- Dependency versions: "express 4.18.0", `npm install react@18`
- Commands: `npm run build`, `yarn test`
- API routes: `GET /api/users`, `POST /auth/login`
- Code examples: fenced code blocks with imports and symbols
- Environment variables: `DATABASE_URL`, `process.env.API_KEY`
- Convention claims: "Uses TypeScript strict mode"
- Config values: "defaults to port 3000"
- URLs: `https://docs.example.com/guide`

**Table extraction** parses markdown tables and recognizes column semantics (package/version/path/command columns).

**Semantic extraction** (optional, via `docalign extract`) uses Claude to find behavior, architecture, and config claims that regex can't catch.

Each claim has a type, source file and line number, extracted value, and confidence score.

## Stage 2: Verify

Each claim is verified against the codebase through a tiered system. See [Verification Tiers](verification-tiers.md) for the full breakdown.

<!-- docalign:semantic id="sem-59522c3b60d1a211" claim="Tier 1 (Deterministic): direct evidence checks -- file exists? version matches? script defined?" -->
- **Tier 1 (Deterministic):** Direct evidence checks -- file exists? version matches? script defined?
<!-- docalign:semantic id="sem-4983c35fcf7c02c9" claim="Tier 2 (Pattern-Based): heuristic checks -- env var in .env? config in tsconfig.json?" -->
- **Tier 2 (Pattern-Based):** Heuristic checks -- env var in .env? config in tsconfig.json?
- **Tier 3 (LLM):** For claims that can't be checked deterministically, optional
- **Tier 4 (Human Review):** Claims that remain uncertain after all tiers

## Stage 3: Report

Results flow to multiple outputs:

- **CLI:** `docalign scan` and `docalign check` print formatted results to the terminal
<!-- docalign:semantic id="sem-0e699b5a8fbabcbe" claim="MCP: 10 tools expose results to AI coding agents" -->
- **MCP:** 10 tools expose results to AI coding agents
- **PR Comments:** In server mode, posts verification results as GitHub PR comments
<!-- docalign:semantic id="sem-3a386ac2b08c5113" claim="Health score: 0-100 based on verified / (verified + drifted) ratio" -->
- **Health Score:** 0-100 based on verified / (verified + drifted) ratio
<!-- docalign:semantic id="sem-74299a87457ee3f6" claim="docalign viz generates an interactive knowledge graph" -->
- **Viz:** `docalign viz` generates an interactive knowledge graph

## Verdicts

Each claim gets one of three verdicts:

| Verdict | Meaning |
|---------|---------|
| **verified** | Claim matches the codebase |
| **drifted** | Claim contradicts the codebase (with severity: low/medium/high) |
| **uncertain** | Not enough evidence to determine |

## Cross-Cutting Analysis

After individual claims are verified, DocAlign runs cross-cutting checks:

<!-- docalign:semantic id="sem-9fbc66ccef6867c0" claim="Cross-document consistency: groups claims by entity" -->
- **Cross-document consistency:** Groups claims by entity. If different files say different things about the same entity, flags the inconsistency.
- **Frontmatter consistency:** Checks YAML frontmatter `title` against the document's first heading.
- **Navigation validation:** Verifies that doc site configs reference files that exist.

## Codebase Index

<!-- docalign:semantic id="sem-e91d8748ba04d549" claim="The L0 codebase index contains: file tree, package manifest, AST entities, headings" -->
The L0 codebase index maintains a lightweight view of the repo:

- **File tree:** Which files exist (for path verification)
- **Package manifest:** Dependencies, versions, scripts, engines, license
- **AST entities:** Functions, classes, and exports (for symbol resolution)
- **Headings:** Markdown heading hierarchy with slugs (for anchor validation)

<!-- docalign:semantic id="sem-90ab2dd5b182ad1f" claim="The codebase index is built on-demand and cached during a scan session" -->
This index is built on-demand and cached during a scan session.
