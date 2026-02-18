<!-- docalign:setup-pending -->
**DocAlign Setup Required:** Immediately invoke the `/docalign-setup` skill to begin interactive configuration of documentation monitoring. (This notice is removed automatically when setup completes.)
<!-- /docalign:setup-pending -->

---
title: "DocAlign Implementation Instructions"
summary: "Project instructions for Claude Code agents working on the DocAlign implementation: commands, rules, tech stack, and key spec/task file locations."
description: "Defines the development workflow (build, lint, test, migrate commands), coding rules (TDD authority, no scope creep, escalate unknowns), the full tech stack (Node.js, TypeScript strict, Express, PostgreSQL/pgvector, Redis/BullMQ, Vitest, Pino, Zod, web-tree-sitter, Octokit), and a directory of all spec files (phases/), architecture docs, and task breakdowns (tasks/)."
category: reference
read_when:
  - You are an AI agent about to implement a DocAlign task
  - You need to know which npm commands to run after making changes
  - You need to find a spec file or task breakdown
related:
  - CONVENTIONS.md
  - docs/contributing/architecture.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# DocAlign — Implementation

A documentation-reality alignment engine that detects when repo documentation drifts from code reality, alerts developers on PRs, and serves verified docs to AI coding agents via MCP.

## Current Phase

IMPLEMENTATION. Planning is complete. All specs, TDDs, and task breakdowns are finalized.

## Commands

```bash
npm run build          # TypeScript compilation
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run format         # Prettier format
npm run typecheck      # tsc --noEmit
npm run test           # Vitest run (all tests)
npm run test:watch     # Vitest watch mode
npm run migrate:up     # Run database migrations
npm run migrate:down   # Rollback last migration
docker compose up -d   # Start PostgreSQL + Redis (local dev)
docker compose down    # Stop local services
```

**After every task:** run `npm run typecheck && npm run test` to verify. Do not move to the next task until both pass.

**After every file edit:** run `npm run lint:fix` on changed files.

## Rules

1. **Read the task file before starting.** Each task references specific TDD sections, types, and test cases. Read them.
2. **Read before writing.** Before modifying any file, read it and its relevant spec sections. Do not work from memory.
3. **Follow existing patterns.** Match the code style, error handling, and naming conventions established by prior tasks.
4. **TDD is the authority.** If the task file and TDD disagree, the TDD wins. If the TDD and `phases/phase4-api-contracts.md` disagree, escalate.
5. **All tests must pass.** `npm run typecheck && npm run test` must succeed after every task.
6. **No scope creep.** Implement exactly what the task specifies. No extra features, no premature abstractions.
7. **Escalate unknowns.** If a spec is ambiguous or contradictory, ask. Do not guess.
8. **Commit after each task.** One task = one commit. Use descriptive messages.

## Tech Stack

<!-- docalign:semantic id="semantic-tech-stack-typescript" claim="Runtime: Node.js + TypeScript (strict mode)" -->
- **Runtime:** Node.js + TypeScript (strict mode)
<!-- docalign:semantic id="semantic-tech-stack-express" claim="Server: Express.js" -->
- **Server:** Express.js
<!-- docalign:semantic id="semantic-tech-stack-postgresql" claim="Database: PostgreSQL (pgvector), SQLite (CLI mode via better-sqlite3)" -->
- **Database:** PostgreSQL (pgvector), SQLite (CLI mode via better-sqlite3)
<!-- docalign:semantic id="semantic-tech-stack-redis-bullmq" claim="Queue: Redis + BullMQ" -->
- **Queue:** Redis + BullMQ
<!-- docalign:semantic id="semantic-tech-stack-vitest" claim="Testing: Vitest" -->
- **Testing:** Vitest
<!-- docalign:semantic id="semantic-tech-stack-pino" claim="Logging: Pino (structured JSON)" -->
- **Logging:** Pino (structured JSON)
<!-- docalign:semantic id="semantic-tech-stack-zod" claim="Validation: Zod" -->
- **Validation:** Zod
<!-- docalign:semantic id="semantic-tech-stack-web-tree-sitter" claim="AST Parsing: web-tree-sitter (WASM)" -->
- **AST Parsing:** web-tree-sitter (WASM)
<!-- docalign:semantic id="semantic-tech-stack-octokit" claim="GitHub: Octokit (GitHub App auth)" -->
- **GitHub:** Octokit (GitHub App auth)

## Key Files

### Specs (implementation reference)

| File | Content |
|------|---------|
| `phases/phase4-api-contracts.md` | Canonical TypeScript interfaces (Section 12 = all Row types) |
| `phases/tdd-0-codebase-index.md` | L0: AST parsing, entity indexing, lookup APIs |
| `phases/tdd-1-claim-extractor.md` | L1: Doc parsing, regex extractors, claim pipeline |
| `phases/tdd-2-mapper.md` | L2: Claim-to-code mapping (3-step progressive) |
| `phases/tdd-3-verifier.md` | L3: Deterministic verification (Tier 1-2) |
| `phases/tdd-4-triggers.md` | L4: Webhook handlers, scan queue, pipeline orchestration |
| `phases/tdd-5-reporter.md` | L5: PR comments, Check Runs, health scores |
| `phases/tdd-6-mcp.md` | L6: MCP server (5 tools, stdio transport) |
| `phases/tdd-7-learning.md` | L7: Feedback, suppression, learning |
| `phases/tdd-infra.md` | Server, auth, webhooks, Agent Task API, deployment |
| `phases/phase4b-prompt-specs.md` | LLM prompts (P-EXTRACT, P-TRIAGE, P-VERIFY, P-FIX) |
| `phases/phase4c-ux-specs.md` | PR comment templates, CLI output formats |
| `phases/phase4d-config-spec.md` | .docalign.yml schema and validation |
| `phases/phase5-integration-examples.md` | IE-01 through IE-04 golden examples |
| `phases/phase5-test-strategy.md` | Test tiers, acceptance criteria, coverage targets |

### Architecture (background reference)

| File | Content |
|------|---------|
| `phases/phase3-architecture.md` | System architecture, layer boundaries |
| `phases/phase3-integration-specs.md` | GitHub, LLM, MCP integration details |
| `phases/phase3-error-handling.md` | Error codes, recovery strategies |
| `phases/phase3-infrastructure.md` | Deployment (Railway), CI/CD, monitoring |
| `phases/phase3-security.md` | Threat model, HMAC, path traversal |
| `phases/adr-agent-first-architecture.md` | ADR: all LLM calls client-side in GitHub Action |
| `phases/phase4-decisions.md` | Design decisions log |

### Tasks

| File | Content |
|------|---------|
| `tasks/INDEX.md` | Master index: 84 tasks, dependency graph, v2-deferred items |
| `tasks/EXECUTION-PLAN.md` | 32 sessions across 6 waves, critical path analysis |
| `tasks/e1-infrastructure.md` | E1: Server, DB, Redis, webhooks, auth, API (14 tasks, 37h) |
| `tasks/e2-data-pipeline.md` | E2: L0 codebase index + L1 claim extractor (19 tasks, 55.5h) |
| `tasks/e3-mapping-verification.md` | E3: L2 mapper + L3 verifier (11 tasks, 36h) |
| `tasks/e4-orchestration-output.md` | E4: L4 orchestration + L5 PR output (12 tasks, 39h) |
| `tasks/e5-action-llm.md` | E5: GitHub Action + LLM prompts (11 tasks, 32h) |
| `tasks/e6-learning-feedback.md` | E6: Learning + feedback (5 tasks, 11h) |
| `tasks/e7-fix-config.md` | E7: Fix endpoint + config system (4 tasks, 14h) |
| `tasks/e8-mcp-server.md` | E8: MCP server (4 tasks, 13h) |
| `tasks/e9-cli-sqlite.md` | E9: CLI + SQLite adapter (5 tasks, 17h) |

<!-- docalign:skip reason="tutorial_example" description="Target project structure diagram showing aspirational/future file layout, not a factual claim about current state" -->
## Project Structure (target)

```
docalign/
├── src/
│   ├── app.ts                    # Express server entry point
│   ├── shutdown.ts               # Graceful shutdown
│   ├── config/                   # Configuration (loader, defaults, schema)
│   ├── shared/                   # Cross-cutting (types, logger, db, redis, auth, tokens)
│   ├── middleware/               # Express middleware (auth, error-handler)
│   ├── routes/                   # HTTP routes (health, webhook, tasks, dismiss, fix)
│   ├── layers/
│   │   ├── L0-codebase-index/    # AST parsing, entity indexing, lookup APIs
│   │   ├── L1-claim-extractor/   # Doc parsing, regex extraction, claim pipeline
│   │   ├── L2-mapper/            # Claim-to-code mapping
│   │   ├── L3-verifier/          # Deterministic verification
│   │   ├── L4-triggers/          # Webhook handlers, scan queue, pipeline
│   │   ├── L5-reporter/          # PR comments, Check Runs, health
│   │   ├── L6-mcp/              # MCP server (separate entry point)
│   │   └── L7-learning/          # Feedback, suppression, learning
│   ├── storage/                  # StorageAdapter interface + PostgreSQL + SQLite
│   ├── server/                   # Fix endpoint (HMAC, confirmation, git-trees)
│   └── cli/                      # CLI commands (check, scan, fix)
├── test/                         # Mirror of src/ structure
├── migrations/                   # Database migrations
├── agent-action/                 # E5: GitHub Action (separate package)
│   ├── action.yml
│   ├── src/
│   └── tests/
├── phases/                       # Specs (TDDs, contracts, prompts, etc.)
├── prd/                          # Per-layer product requirements
├── tasks/                        # Task breakdowns + execution plan
└── _planning/                    # Archived planning artifacts
```

<!-- /docalign:skip -->