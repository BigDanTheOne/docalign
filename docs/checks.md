# What DocAlign Checks

DocAlign extracts verifiable claims from documentation and checks each one against the codebase. This page covers every check category, how extraction works, and what verification looks like.

## Claim Types

### path_reference

Detects file and directory paths mentioned in documentation.

**What it catches:**
- Markdown links: `[config](src/config.ts)`
- Inline code: `` `src/auth.ts` ``
- Image references: `![logo](assets/logo.png)`
- CSS/style references: `styles/main.css`
- Paths inside markdown tables
- Anchor fragments: `[Setup](docs/guide.md#setup)`

**Verification:**
- Tier 1: Checks if the file exists in the repo
- If the path includes an anchor (`#heading`), validates that the heading exists in the target file
- Self-referencing anchors (`[section](#section)`) validated against the current file's headings
- Fuzzy suggestion on near-miss: "File 'src/atuh.ts' not found. Did you mean 'src/auth.ts'?"

### dependency_version

Detects package version claims in prose, code blocks, and tables.

**What it catches:**
- Prose: "requires express 4.18.0"
- Code blocks: `npm install express@4.18.0`
- Tables: `| express | 4.18.0 |`
- Install commands: `npm install`, `yarn add`, `pip install`, `cargo add`

**Verification:**
- Tier 1: Looks up the package in `package.json` (dependencies + devDependencies), `pyproject.toml`, `go.mod`, or `Cargo.toml`
- Compares documented version against actual version (handles semver ranges, `^`, `~`, `>=`)
- If package not found: fuzzy suggestion from all known dependencies
- Install command validation: checks that `npm install my-pkg` matches `package.json` name field

### command

Detects CLI commands and npm scripts referenced in documentation.

**What it catches:**
- npm/yarn/pnpm scripts: `npm run build`, `yarn test`
- Direct CLI commands: `npx docalign scan`
- Shell commands in code blocks

**Verification:**
- Tier 1: Checks if the script name exists in `package.json` scripts
- For install commands: validates the package name against the manifest
- For other commands: checks for common patterns (Makefile targets, etc.)

### api_route

Detects API endpoint definitions mentioned in documentation.

**What it catches:**
- REST routes: `GET /api/users`, `POST /auth/login`
- Route patterns with parameters: `GET /users/:id`

**Verification:**
- Tier 1: Searches for route definitions in Express (`app.get`, `router.post`), Flask (`@app.route`), FastAPI (`@app.get`) handlers via AST
- Matches HTTP method and path pattern

### code_example

Detects code blocks and inline code references.

**What it catches:**
- Fenced code blocks with imports: `` ```typescript import { foo } from './bar' ``` ``
- Symbol references in prose: `` `authenticate()` takes 2 parameters ``
- Function calls with arguments

**Verification:**
- Tier 1: Resolves imports against the codebase file structure
- Finds symbols via AST (function names, class names, exports)
- Language tag validation: flags misspelled language tags (e.g., `typscript` -> `typescript`)
- Signature staleness: detects when a code example calls `foo(a, b)` but the actual function signature is `foo(a, b, c, d)`
- Prose signature verification: `` `authenticate()` `` in prose text is resolved to the actual function

### environment

Detects environment variable references.

**What it catches:**
- Prose: "Set `DATABASE_URL` to your connection string"
- Code blocks: `export DATABASE_URL=...`
- Env var patterns: `$VARIABLE`, `process.env.VARIABLE`

**Verification:**
- Tier 2: Checks `.env`, `.env.example`, `.env.sample`, `.env.template` files
- Also checks `docker-compose.yml` environment sections
- Fuzzy suggestion: "Env var 'DATABSE_URL' not found. Did you mean 'DATABASE_URL'?"

### convention

Detects claims about project conventions and technology choices.

**What it catches:**
- "Uses TypeScript strict mode"
- "Built with React 18"
- "Follows REST API conventions"
- Framework claims: Express, Next.js, FastAPI, Django, etc.

**Verification:**
- Tier 2: Checks `tsconfig.json` for TypeScript settings, `package.json` for framework dependencies
- Framework detection via dependency analysis
- License consistency: compares license mentioned in docs against `package.json` `license` field

### config

Detects configuration values, defaults, ports, and limits.

**What it catches:**
- Default values: "defaults to 3000", "default value is 5"
- Port numbers: "runs on port 8080", `localhost:3000`
- Limits and thresholds: "maximum of 100 connections", "timeout of 30 seconds", "rate limit 1000"

**Verification:**
- Tier 2: Cross-references against config files, env defaults, and code constants
- Checked alongside other config claims in cross-document consistency

### behavior (semantic only)

Detects behavioral claims that regex can't capture. Requires `docalign extract`.

**What it catches:**
- "Authentication uses JWT tokens stored in HTTP-only cookies"
- "Failed login attempts are rate-limited after 5 tries"
- "File uploads are validated for MIME type before storage"

**Verification:**
- Semantic claims include grep-verifiable assertions that Claude generates during extraction
- Verified on every `docalign check` by running the assertion patterns against code

### architecture (semantic only)

Detects architecture and design claims. Requires `docalign extract`.

**What it catches:**
- "Services communicate via REST APIs"
- "Database access is abstracted through a repository pattern"
- "Authentication middleware runs before all route handlers"

**Verification:**
- Same as behavior: Claude generates verifiable assertions during extraction

### url_reference

Detects URLs in documentation and checks for dead links.

**What it catches:**
- HTTP/HTTPS URLs in prose and markdown links
- Filters out: localhost, example.com, placeholder URLs, URLs inside code fences

**Verification:**
- Tier 1: HTTP HEAD request with 5-second timeout (falls back to GET on 405)
- Status 200-399: verified
- Status 404/410: drifted (dead link)
- Status 5xx / timeout: uncertain (server issue, not doc issue)
- Rate-limited: max 5 requests per domain per scan

## Cross-Cutting Checks

These checks run across all claim types and across multiple files.

### Anchor/Heading Validation

When a markdown link includes a `#fragment`, DocAlign validates that the target heading exists. Works for both cross-file links (`[guide](docs/setup.md#install)`) and self-references (`[section](#config)`). Suggests the closest heading on mismatch.

### Cross-Document Consistency

Groups claims by semantic identity (same package, same config key, same env var) across all doc files. If the same entity has different values in different files, flags a cross-doc inconsistency. Example: `docs/setup.md` says "port 3000" and `docs/deploy.md` says "port 8080".

### Frontmatter Consistency

For doc files with YAML frontmatter (`---` delimited), checks that the `title` field matches the first `# Heading` in the document.

### Navigation Config Validation

Detects documentation navigation config files (`mkdocs.yml`, `docs/_sidebar.md`, `mint.json`, `docs.json`, `.vitepress/config.ts`, `_data/nav.yml`) and validates that all referenced doc paths exist.

### Deprecation Awareness

When a code entity referenced by documentation is marked `@deprecated`, `@obsolete`, or `// DEPRECATED` in code, DocAlign flags it if the documentation doesn't mention the deprecation.

### License Consistency

Compares the license mentioned in documentation against the `license` field in `package.json`. Detects mismatches like "MIT" in README but "Apache-2.0" in the manifest.

### Changelog Consistency

For claims in CHANGELOG files, compares the latest version heading (`## [X.Y.Z]`) against the `version` field in `package.json`.

### Fuzzy Suggestions

When a referenced entity (package name, env var, file path) isn't found, DocAlign uses Levenshtein distance to suggest the closest match. This catches typos and near-misses across all claim types.

## Markdown Table Extraction

DocAlign parses markdown tables and extracts claims from cells. It recognizes column semantics by header keywords:

| Header Keywords | Recognized As |
|----------------|---------------|
| "package", "name", "dependency" | Package name column |
| "version" | Version column |
| "path", "file" | File path column |
| "command", "script" | Command column |
| "default", "value" | Config value column |

Claims extracted from tables are the same types as prose claims (`path_reference`, `dependency_version`, `command`, `config`) and go through the same verification pipeline.
