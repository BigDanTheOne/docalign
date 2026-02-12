> Part of [DocAlign PRD](../PRD.md)

## 4. Layer 0: Codebase Index

### 4.1 Purpose

Build a lightweight, doc-optimized representation of the codebase that supports file existence checks, symbol lookup, semantic search, dependency version lookup, and command/script lookup. This index powers all claim mapping and verification.

### 4.2 Functional Requirements

**Structural entity indexing (via AST parsing):**

| Entity Type | What Gets Indexed | Used For |
|-------------|------------------|----------|
| Exported functions | name, parameters, return type, file, line | Symbol lookup, semantic search |
| Exported classes | name, methods, file, line | Symbol lookup |
| API route definitions | HTTP method, path, handler, file, line | API route claim verification. MVP supports 6 frameworks: Express, Fastify, Koa (TypeScript/JavaScript); Flask, FastAPI, Django (Python). |
| Type/interface exports | name, fields, file, line | Type claim verification |
| Config schemas | keys, types, defaults, file, line | Config claim verification |

**Package metadata indexing (direct file parsing):**

| Source File | What Gets Indexed | Used For |
|-------------|------------------|----------|
| package.json | dependencies, devDependencies, scripts | Version claims, command claims |
| requirements.txt / pyproject.toml | dependencies with versions | Version claims |
| Cargo.toml | dependencies, features | Version claims |
| go.mod | module path, dependencies | Version claims |
| Dockerfile | FROM images, RUN commands, ENV vars | Infrastructure claims |
| Makefile | targets | Command claims |

**File tree indexing:**
- Complete list of file paths in the repo (excluding .gitignore patterns)
- Used for: path reference verification

**Language support:** TypeScript/JavaScript, Python (MVP). Go, Rust, Java (post-MVP; see Section 15 for phasing).

**tree-sitter WASM parser lifecycle:** Create one parser instance per language grammar. Reuse across all files of that language. Maximum 3 language grammars loaded simultaneously. On Railway (512MB-1GB containers), this keeps WASM memory usage under 100MB.

**File extension to tree-sitter grammar mapping:** `.ts`, `.tsx` -> TypeScript; `.js`, `.jsx`, `.mjs`, `.cjs` -> JavaScript; `.py` -> Python. Files with no matching extension are skipped by the AST parser (they are still indexed in the file tree but produce no code entities).

### 4.3 Inputs and Outputs

**Inputs:**
- Repository files (source code, package manifests, config files)
- Git diff (for incremental updates on commit/PR)

**Outputs (capabilities the index exposes):**
- File existence checks ("does `src/auth/handler.ts` exist?")
- Symbol lookup ("where is `class AuthService` defined?")
- Semantic search ("find functions related to 'password hashing'")
- Dependency version lookup ("what version of React is installed?")
- Command/script lookup ("does `test:unit` script exist?")
- Route lookup ("is there a `POST /api/v2/users` route?")
- File tree listing

### 4.4 Embedding Generation

- Each exported function/class gets embedded using its name and docstring/signature (not raw code)
- Embedding model: OpenAI `text-embedding-3-small` (1536 dimensions). **Execution model (ADR):** Embedding generation runs client-side in the GitHub Action using the client's API key. DocAlign server never calls the embedding API.
- Re-embed only when an entity's signature changes (incremental)

### 4.5 Incremental Update Flow

```
On new commit/PR:
1. Get list of changed files from git diff
2. For each changed file:
   a. If file deleted: remove all entities from index
   b. If file added/modified:
      - Re-parse with AST parser
      - Diff extracted entities against stored entities
      - Remove deleted entities
      - Update modified entities (re-embed if signature changed)
      - Add new entities
3. For package files (package.json, etc.): re-parse entirely (small, fast)
4. Update file tree index
```

### 4.6 Performance Requirements

- Parsing 100 changed files with tree-sitter: <2 seconds
- Re-embedding 50 changed function signatures: ~$0.001 (client cost, using client's API key), <1 second

### 4.7 Known Limitations

MVP assumes single-project repos. For monorepos with multiple package.json files: the system checks ALL manifest files and returns the first version match found. Monorepo-aware per-package scoping is v3.

### 4.8 Open Questions

(None currently -- this layer is well-defined.)

> Technical detail: see phases/technical-reference.md Section 3.1 (CodebaseIndex interface, CodeEntity interface), Section 6 (tree-sitter query patterns)

