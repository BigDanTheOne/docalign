---
title: "Checks Reference"
summary: "Reference for all 11 DocAlign claim types and 8 cross-cutting checks with extraction and verification details."
description: "Documents all 11 claim types (path_reference, dependency_version, command, api_route, code_example, environment, convention, config, behavior, architecture, url_reference) with what each extracts and how each is verified. Also covers 8 cross-cutting checks (anchor validation, cross-document consistency, frontmatter consistency, navigation config validation, deprecation detection, license consistency, changelog consistency, fuzzy suggestions)."
category: reference
read_when:
  - You need to know exactly what a claim type extracts
  - You need to understand how a specific claim type is verified
  - You want to understand cross-cutting checks
related:
  - docs/explanation/verification-tiers.md
  - docs/explanation/how-it-works.md
  - docs/contributing/adding-a-check.md
docalign:
  setup_date: "2026-02-19T00:00:00Z"
  monitored: true
---

# Checks Reference

DocAlign extracts 11 types of claims from documentation and runs 8 cross-cutting checks. Each claim is verified against the codebase.

## Claim Types

### path_reference

File paths, image references, and asset links mentioned in documentation.
<!-- docalign:skip reason="capability_description" description="path_reference Extracts bullet list with illustrative example paths and anchor links" -->

**Extracts:**
- Inline paths: `src/auth.ts`, `config/database.yml`
- Image references: `![logo](assets/logo.png)`
- Markdown links to local files: `[Setup Guide](docs/setup.md)`
- Anchor links: `[Installation](#installation)`

**Verifies:**
<!-- /docalign:skip -->
- File exists in the repository
- For anchor links: heading with matching slug exists in the target file
- Fuzzy match suggestions when file not found ("Did you mean `src/auth/index.ts`?")

### dependency_version

Package names and versions mentioned in prose, code blocks, and tables.

**Extracts:**
<!-- docalign:skip reason="capability_description" description="dependency_version Extracts bullet list with illustrative package names and install commands" -->
- Prose mentions: "requires express 4.18"
- Install commands: `npm install react@18.2.0`
- Code blocks: `"express": "^4.18.0"` in JSON snippets
- Table rows with package/version columns

**Verifies:**
- Package exists in `package.json` (or `pyproject.toml`, `go.mod`)
- Version matches (supports semver range comparison)
<!-- /docalign:skip -->
- Fuzzy match suggestions for misspelled package names

### command

CLI commands, npm scripts, and shell invocations.

**Extracts:**
- npm/yarn/pnpm scripts: `npm run build`, `yarn test`
- npx invocations: `npx docalign scan`
<!-- docalign:skip reason="capability_description" description="command Extracts bullet list with illustrative npm/npx/shell commands" -->
- Shell commands in code blocks: `docker compose up`

**Verifies:**
- npm scripts: checks `scripts` in `package.json`
- Close match suggestions for misspelled script names

<!-- /docalign:skip -->
### api_route

HTTP endpoints mentioned in documentation.

**Extracts:**
- Route definitions: `GET /api/users`, `POST /auth/login`
- URL patterns with HTTP methods

**Verifies:**
<!-- docalign:skip reason="capability_description" description="api_route Extracts bullet list with illustrative route definitions" -->
<!-- docalign:semantic id="sem-de225892faf2ed47" claim="Route exists in Express, Flask, or FastAPI handlers (AST-based detection)" -->
- Route exists in Express, Flask, or FastAPI handlers (AST-based detection)
- Method matches (GET vs POST)

### code_example
<!-- /docalign:skip -->

Import statements, symbol references, and code snippets.

**Extracts:**
- Import statements: `import { foo } from './bar'`
- Require calls: `const db = require('./database')`
- Symbol references in code blocks
- Language tags on fenced code blocks

**Verifies:**
<!-- docalign:skip reason="capability_description" description="code_example Extracts bullet list with illustrative import and require examples" -->
- Import paths resolve to existing files
<!-- docalign:semantic id="sem-045e4cebe0259868" claim="Referenced symbols are exported from the target module" -->
- Referenced symbols are exported from the target module
- Language tag matches file extension conventions

### environment

Environment variables referenced in documentation.

<!-- /docalign:skip -->
**Extracts:**
- Inline references: `DATABASE_URL`, `API_KEY`
- Process.env access: `process.env.NODE_ENV`
- env var syntax in code blocks

**Verifies:**
- Present in `.env`, `.env.example`, `docker-compose.yml`, or similar
- Referenced in code via `process.env.*`

<!-- docalign:skip reason="capability_description" description="environment Extracts bullet list with illustrative env var references" -->
### convention

Claims about project conventions, standards, or practices.

**Extracts:**
- Framework claims: "Uses TypeScript strict mode", "Built with React"
<!-- /docalign:skip -->
- Standard claims: "Follows REST conventions"
- Tool claims: "Linted with ESLint"

**Verifies:**
<!-- docalign:semantic id="sem-b8d13bd7737f2ae9" claim="TypeScript strict: checks tsconfig.json for strict: true" -->
- TypeScript strict: checks `tsconfig.json` for `strict: true`
- Framework presence: checks `package.json` dependencies
- Engine versions: checks `engines.node` field against documented Node.js version

<!-- docalign:skip reason="capability_description" description="convention Extracts bullet list with illustrative framework and standard claims" -->
### config

Claims about configuration defaults, limits, and thresholds.

**Extracts:**
- Default values: "Defaults to port 3000"
- Limits: "Maximum of 100 connections"
- Thresholds: "Timeout after 30 seconds"
<!-- /docalign:skip -->

**Verifies:** Tier 2 pattern matching against config files, or Tier 3 LLM verification against code.

### behavior (semantic only)

Behavioral descriptions that require LLM extraction.

**Extracts via `docalign extract`:**
- "Authentication uses JWT tokens stored in HTTP-only cookies"
<!-- docalign:skip reason="capability_description" description="config Extracts bullet list with illustrative default values, limits, and thresholds" -->
- "All API endpoints return JSON with an `error` field on failure"
- "Database migrations are run automatically on startup"

**Verifies:** Grep-verifiable assertions generated by Claude, checked against actual code.
<!-- /docalign:skip -->

### architecture (semantic only)

Architecture decisions that require LLM extraction.

**Extracts via `docalign extract`:**
- "Services communicate via REST APIs, not message queues"
- "Data flows from API gateway to service layer to repository"
- "Frontend uses server-side rendering for initial page load"
<!-- docalign:skip reason="capability_description" description="behavior Extracts bullet list with illustrative behavioral description examples" -->

**Verifies:** Grep-verifiable assertions checked against code structure and imports.

### url_reference
<!-- /docalign:skip -->

URLs and links to external resources.

**Extracts:**
- HTTP/HTTPS URLs in prose and code blocks
- Markdown links to external sites

**Verifies:**
<!-- docalign:semantic id="sem-e3d8d0be4b305428" claim="HTTP HEAD request (falls back to GET)" -->
<!-- docalign:skip reason="capability_description" description="architecture Extracts bullet list with illustrative architecture decision examples" -->
- HTTP HEAD request (falls back to GET)
<!-- docalign:semantic id="sem-d88e64087079c198" claim="Status code 200-399 = verified, 4xx/5xx = drifted, Timeout or network error = uncertain" -->
- Status code 200-399 = verified
- 4xx/5xx = drifted
<!-- /docalign:skip -->
- Timeout or network error = uncertain

Configurable via `url_check` settings (timeout, max per domain, excluded domains).

## Cross-Cutting Checks

These run after individual claim verification and analyze patterns across the entire scan.

### Anchor validation
<!-- docalign:skip reason="capability_description" description="url_reference Extracts bullet list with illustrative URL and link examples" -->

Checks that `[text](#anchor)` links point to headings that exist in the target file. Generates correct slugs from heading text.

### Cross-document consistency
<!-- /docalign:skip -->

<!-- docalign:semantic id="sem-986ff2a3e1f88350" claim="Groups claims by entity (same package, config key, or env var). If different documentation files state different values for the same entity, flags the inconsistency." -->
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

<!-- docalign:semantic id="sem-1954054544978eb8" claim="Cross-references @deprecated markers in code with documentation claims. If docs reference a deprecated symbol without mentioning the deprecation, flags it." -->
Cross-references `@deprecated` markers in code with documentation claims. If docs reference a deprecated symbol without mentioning the deprecation, flags it.

### License consistency

Compares the license stated in documentation with the `license` field in `package.json`.

### Changelog consistency

Checks whether the latest version in `CHANGELOG.md` matches the version in `package.json`.

### Fuzzy suggestions

When a claim references something that doesn't exist but is close to something that does, provides "Did you mean?" suggestions.
<!-- docalign:semantic id="sem-978830f1793bdb0d" claim="Uses Levenshtein distance for package names and file paths." -->
Uses Levenshtein distance for package names and file paths.
