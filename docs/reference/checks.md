---
title: "Checks Reference"
summary: "Complete reference for all 11 claim types DocAlign extracts and the 8 cross-cutting checks it runs after individual verification."
description: "Documents all 11 claim types: path_reference (files, images, anchors), dependency_version (package.json semver), command (npm scripts, npx, shell), api_route (Express/Flask/FastAPI AST detection), code_example (imports, symbols, language tags), environment (env vars in .env/.env.example), convention (TypeScript strict, framework, engines), config (defaults, limits, thresholds), behavior (semantic only), architecture (semantic only), url_reference (HTTP status codes). Plus 8 cross-cutting checks: anchor validation, cross-document consistency, frontmatter consistency, navigation config validation, deprecation detection, license consistency, changelog consistency, fuzzy suggestions (Levenshtein distance)."
category: reference
read_when:
  - You need to know if DocAlign can detect a specific type of claim
  - You want to understand what evidence is used to verify a specific claim type
  - You are adding a new claim type and need to see existing patterns
related:
  - docs/explanation/verification-tiers.md
  - docs/contributing/adding-a-check.md
  - docs/guides/suppressing-findings.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Checks Reference

<!-- docalign:semantic id="sem-8781247a0f976d32" claim="DocAlign extracts 11 types of claims from documentation" -->
<!-- docalign:semantic id="sem-8-cross-cutting-checks" claim="DocAlign runs 8 cross-cutting checks after individual claim verification" -->
DocAlign extracts 11 types of claims from documentation and runs 8 cross-cutting checks. Each claim is verified against the codebase.

## Claim Types

<!-- docalign:skip reason="capability_description" description="path_reference claim type description: lists hypothetical inline paths (src/auth.ts, config/database.yml), image references, and markdown link examples as illustrations of what the tool extracts and verifies. Not factual claims about the current codebase." -->
### path_reference

File paths, image references, and asset links mentioned in documentation.

**Extracts:**
- Inline paths: `src/auth.ts`, `config/database.yml`
- Image references: `![logo](assets/logo.png)`
- Markdown links to local files: `[Setup Guide](docs/setup.md)`
- Anchor links: `[Installation](#installation)`

**Verifies:**
- File exists in the repository
- For anchor links: heading with matching slug exists in the target file
- Fuzzy match suggestions when file not found ("Did you mean `src/auth/index.ts`?")

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="dependency_version claim type description: lists hypothetical package names (express 4.18, react@18.2.0) and file types (package.json, pyproject.toml, go.mod) as illustrations of what the tool extracts and verifies." -->
### dependency_version

Package names and versions mentioned in prose, code blocks, and tables.

**Extracts:**
- Prose mentions: "requires express 4.18"
- Install commands: `npm install react@18.2.0`
- Code blocks: `"express": "^4.18.0"` in JSON snippets
- Table rows with package/version columns

**Verifies:**
- Package exists in `package.json` (or `pyproject.toml`, `go.mod`)
- Version matches (supports semver range comparison)
- Fuzzy match suggestions for misspelled package names

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="command claim type description: lists hypothetical npm/yarn/pnpm scripts and docker commands as illustrations of extraction and verification capability." -->
### command

CLI commands, npm scripts, and shell invocations.

**Extracts:**
- npm/yarn/pnpm scripts: `npm run build`, `yarn test`
- npx invocations: `npx docalign scan`
- Shell commands in code blocks: `docker compose up`

**Verifies:**
- npm scripts: checks `scripts` in `package.json`
- Close match suggestions for misspelled script names

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="api_route claim type description: lists hypothetical route examples (GET /api/users, POST /auth/login) as illustrations. The AST-based detection claim IS extracted separately as a behavior claim." -->
### api_route

HTTP endpoints mentioned in documentation.

**Extracts:**
- Route definitions: `GET /api/users`, `POST /auth/login`
- URL patterns with HTTP methods

**Verifies:**
- Route exists in Express, Flask, or FastAPI handlers (AST-based detection)
- Method matches (GET vs POST)

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="code_example claim type description: lists hypothetical import/require statements as illustrations of what the tool extracts and verifies." -->
### code_example

Import statements, symbol references, and code snippets.

**Extracts:**
- Import statements: `import { foo } from './bar'`
- Require calls: `const db = require('./database')`
- Symbol references in code blocks
- Language tags on fenced code blocks

**Verifies:**
- Import paths resolve to existing files
- Referenced symbols are exported from the target module
- Language tag matches file extension conventions

<!-- /docalign:skip -->
<!-- docalign:skip reason="capability_description" description="environment claim type description: lists hypothetical env var references (DATABASE_URL, API_KEY) and config file locations (.env, .env.example, docker-compose.yml) as illustrations." -->
### environment

Environment variables referenced in documentation.

**Extracts:**
- Inline references: `DATABASE_URL`, `API_KEY`
- Process.env access: `process.env.NODE_ENV`
- env var syntax in code blocks

**Verifies:**
- Present in `.env`, `.env.example`, `docker-compose.yml`, or similar
- Referenced in code via `process.env.*`

<!-- /docalign:skip -->
### convention

Claims about project conventions, standards, or practices.

**Extracts:**
- Framework claims: "Uses TypeScript strict mode", "Built with React"
- Standard claims: "Follows REST conventions"
- Tool claims: "Linted with ESLint"

**Verifies:**
- TypeScript strict: checks `tsconfig.json` for `strict: true`
- Framework presence: checks `package.json` dependencies
- Engine versions: checks `engines.node` field against documented Node.js version

### config

Claims about configuration defaults, limits, and thresholds.

**Extracts:**
- Default values: "Defaults to port 3000"
- Limits: "Maximum of 100 connections"
- Thresholds: "Timeout after 30 seconds"

**Verifies:** Tier 2 pattern matching against config files, or Tier 3 LLM verification against code.

<!-- docalign:skip reason="illustrative_example" description="behavior claim type section: the three bullet examples ('Authentication uses JWT tokens...', 'All API endpoints return JSON...', 'Database migrations are run automatically...') are hypothetical illustrations of what the tool can extract, not factual claims about this codebase." -->
### behavior (semantic only)

Behavioral descriptions that require LLM extraction.

**Extracts via `docalign extract`:**
- "Authentication uses JWT tokens stored in HTTP-only cookies"
- "All API endpoints return JSON with an `error` field on failure"
- "Database migrations are run automatically on startup"

**Verifies:** Grep-verifiable assertions generated by Claude, checked against actual code.

<!-- /docalign:skip -->
<!-- docalign:skip reason="illustrative_example" description="architecture claim type section: the three bullet examples ('Services communicate via REST APIs...', 'Data flows from API gateway...', 'Frontend uses server-side rendering...') are hypothetical illustrations, not factual claims about this codebase." -->
### architecture (semantic only)

Architecture decisions that require LLM extraction.

**Extracts via `docalign extract`:**
- "Services communicate via REST APIs, not message queues"
- "Data flows from API gateway to service layer to repository"
- "Frontend uses server-side rendering for initial page load"

**Verifies:** Grep-verifiable assertions checked against code structure and imports.

<!-- /docalign:skip -->
### url_reference

URLs and links to external resources.

**Extracts:**
- HTTP/HTTPS URLs in prose and code blocks
- Markdown links to external sites

**Verifies:**
- HTTP HEAD request (falls back to GET)
- Status code 200-399 = verified
- 4xx/5xx = drifted
- Timeout or network error = uncertain

Configurable via `url_check` settings (timeout, max per domain, excluded domains).

## Cross-Cutting Checks

These run after individual claim verification and analyze patterns across the entire scan.

### Anchor validation

<!-- docalign:semantic id="sem-anchor-slug-generation" claim="Anchor validation generates correct slugs from heading text to check anchor links" -->
Checks that `[text](#anchor)` links point to headings that exist in the target file. Generates correct slugs from heading text.

### Cross-document consistency

<!-- docalign:semantic id="sem-cross-doc-grouping" claim="Cross-document consistency groups claims by entity (same package, config key, or env var) and flags when different doc files state different values for the same entity" -->
Groups claims by entity (same package, config key, or env var). If different documentation files state different values for the same entity, flags the inconsistency.

Example: `docs/setup.md` says port 3000, `docs/deploy.md` says port 8080.

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

<!-- docalign:semantic id="sem-2d5b0a2bfe8222d4" claim="Fuzzy suggestions use Levenshtein distance for package names and file paths" -->
When a claim references something that doesn't exist but is close to something that does, provides "Did you mean?" suggestions. Uses Levenshtein distance for package names and file paths.
