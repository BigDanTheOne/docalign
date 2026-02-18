---
title: "Checks Reference"
summary: "All claim types, how they're extracted, and how they're verified"
description: "Use when you need to understand what DocAlign checks, how each claim type is extracted, and how it is verified."
category: "reference"
read_when:
  - Looking up what DocAlign detects and verifies
  - Understanding what a specific claim type means
  - Knowing whether a claim type is deterministic or LLM-verified
related:
  - docs/explanation/verification-tiers.md
  - docs/reference/configuration.md
---

# Checks Reference

DocAlign extracts 11 types of claims from documentation and runs 8 cross-cutting checks. Each claim is verified against the codebase.

## Claim Types

### path_reference

<!-- docalign:skip reason="illustrative_example" description="path_reference Extracts/Verifies bullet lists use hypothetical paths like src/auth.ts, assets/logo.png, docs/setup.md" -->
File paths, image references, and asset links mentioned in documentation.

**Extracts:**
- Inline paths: `src/auth.ts`, `config/database.yml`
- Image references: `![logo](assets/logo.png)`
- Markdown links to local files: `[Setup Guide](docs/setup.md)`
- Anchor links: `[Installation](#installation)`

<!-- /docalign:skip -->
**Verifies:**
- File exists in the repository
- For anchor links: heading with matching slug exists in the target file
- Fuzzy match suggestions when file not found ("Did you mean `src/auth/index.ts`?")

### dependency_version
<!-- docalign:skip reason="illustrative_example" description="dependency_version Extracts/Verifies bullet lists use hypothetical packages like express 4.18, react@18.2.0" -->

Package names and versions mentioned in prose, code blocks, and tables.

**Extracts:**
- Prose mentions: "requires express 4.18"
- Install commands: `npm install react@18.2.0`
- Code blocks: `"express": "^4.18.0"` in JSON snippets
- Table rows with package/version columns

**Verifies:**
<!-- /docalign:skip -->
- Package exists in `package.json` (or `pyproject.toml`, `go.mod`)
- Version matches (supports semver range comparison)
- Fuzzy match suggestions for misspelled package names

### command
<!-- docalign:skip reason="illustrative_example" description="command Extracts/Verifies bullet lists use hypothetical commands like npm run build, yarn test, docker compose up" -->

CLI commands, npm scripts, and shell invocations.

**Extracts:**
- npm/yarn/pnpm scripts: `npm run build`, `yarn test`
- npx invocations: `npx docalign scan`
- Shell commands in code blocks: `docker compose up`

<!-- /docalign:skip -->
**Verifies:**
- npm scripts: checks `scripts` in `package.json`
- Close match suggestions for misspelled script names

### api_route
<!-- docalign:skip reason="illustrative_example" description="api_route Extracts/Verifies bullet lists use hypothetical routes like GET /api/users, POST /auth/login" -->

HTTP endpoints mentioned in documentation.

**Extracts:**
- Route definitions: `GET /api/users`, `POST /auth/login`
- URL patterns with HTTP methods

**Verifies:**
<!-- /docalign:skip -->
- Route exists in Express, Flask, or FastAPI handlers (AST-based detection)
- Method matches (GET vs POST)

### code_example
<!-- docalign:skip reason="illustrative_example" description="code_example Extracts/Verifies bullet lists use hypothetical imports like import { foo } from './bar', require('./database')" -->

Import statements, symbol references, and code snippets.

**Extracts:**
- Import statements: `import { foo } from './bar'`
- Require calls: `const db = require('./database')`
- Symbol references in code blocks
- Language tags on fenced code blocks

**Verifies:**
- Import paths resolve to existing files
<!-- /docalign:skip -->
- Referenced symbols are exported from the target module
- Language tag matches file extension conventions

### environment
<!-- docalign:skip reason="illustrative_example" description="environment Extracts/Verifies bullet lists use hypothetical env vars like DATABASE_URL, API_KEY" -->

Environment variables referenced in documentation.

**Extracts:**
- Inline references: `DATABASE_URL`, `API_KEY`
- Process.env access: `process.env.NODE_ENV`
- env var syntax in code blocks

**Verifies:**
<!-- /docalign:skip -->
- Present in `.env`, `.env.example`, `docker-compose.yml`, or similar
- Referenced in code via `process.env.*`

### convention
<!-- docalign:skip reason="illustrative_example" description="convention Extracts/Verifies bullet lists use hypothetical framework claims like 'Uses TypeScript strict mode', 'Built with React'" -->

Claims about project conventions, standards, or practices.

**Extracts:**
- Framework claims: "Uses TypeScript strict mode", "Built with React"
- Standard claims: "Follows REST conventions"
- Tool claims: "Linted with ESLint"

**Verifies:**
- TypeScript strict: checks `tsconfig.json` for `strict: true`
- Framework presence: checks `package.json` dependencies
<!-- /docalign:skip -->
- Engine versions: checks `engines.node` field against documented Node.js version

### config
<!-- docalign:skip reason="illustrative_example" description="config Extracts bullet list uses hypothetical defaults like 'Defaults to port 3000', 'Maximum of 100 connections'" -->

Claims about configuration defaults, limits, and thresholds.

**Extracts:**
- Default values: "Defaults to port 3000"
- Limits: "Maximum of 100 connections"
- Thresholds: "Timeout after 30 seconds"
<!-- /docalign:skip -->

**Verifies:** Tier 2 pattern matching against config files, or Tier 3 LLM verification against code.

### behavior (semantic only)
<!-- docalign:skip reason="illustrative_example" description="behavior Extracts bullets show example claims like 'Authentication uses JWT tokens stored in HTTP-only cookies'" -->

Behavioral descriptions that require LLM extraction.

**Extracts via `docalign extract`:**
- "Authentication uses JWT tokens stored in HTTP-only cookies"
- "All API endpoints return JSON with an `error` field on failure"
- "Database migrations are run automatically on startup"
<!-- /docalign:skip -->

**Verifies:** Grep-verifiable assertions generated by Claude, checked against actual code.

### architecture (semantic only)
<!-- docalign:skip reason="illustrative_example" description="architecture Extracts bullets show example claims like 'Services communicate via REST APIs, not message queues'" -->

Architecture decisions that require LLM extraction.

**Extracts via `docalign extract`:**
- "Services communicate via REST APIs, not message queues"
- "Data flows from API gateway to service layer to repository"
- "Frontend uses server-side rendering for initial page load"
<!-- /docalign:skip -->

**Verifies:** Grep-verifiable assertions checked against code structure and imports.

### url_reference
<!-- docalign:skip reason="illustrative_example" description="url_reference Extracts/Verifies bullet lists describe hypothetical URL checking scenarios" -->

URLs and links to external resources.

**Extracts:**
- HTTP/HTTPS URLs in prose and code blocks
- Markdown links to external sites

<!-- /docalign:skip -->
**Verifies:**
- HTTP HEAD request (falls back to GET)
- Status code 200-399 = verified
- 4xx/5xx = drifted
- Timeout or network error = uncertain

Configurable via `url_check` settings (timeout, max per domain, excluded domains).

## Cross-Cutting Checks

These run after individual claim verification and analyze patterns across the entire scan.

### Anchor validation

Checks that `[text](#anchor)` links point to headings that exist in the target file. Generates correct slugs from heading text.

### Cross-document consistency

Groups claims by entity (same package, config key, or env var). If different documentation files state different values for the same entity, flags the inconsistency.
<!-- docalign:skip reason="illustrative_example" description="Cross-document consistency example: 'docs/setup.md says port 3000, docs/deploy.md says port 8080' is a hypothetical illustration" -->

Example: `docs/setup.md` says port 3000, `docs/deploy.md` says port 8080.
<!-- /docalign:skip -->

### Frontmatter consistency

Checks YAML frontmatter `title:` against the document's first `# Heading`. Flags mismatches.

### Navigation config validation

Verifies that documentation site configs reference files that exist:
- `mkdocs.yml` nav entries
- `_sidebar.md` links
- `mint.json` navigation paths

### Deprecation detection

Cross-references `@deprecated` markers in code with documentation claims. If docs reference a deprecated symbol without mentioning the deprecation, flags it.

### License consistency

Compares the license stated in documentation with the `license` field in `package.json`.

### Changelog consistency

Checks whether the latest version in `CHANGELOG.md` matches the version in `package.json`.

### Fuzzy suggestions

When a claim references something that doesn't exist but is close to something that does, provides "Did you mean?" suggestions. Uses Levenshtein distance for package names and file paths.
