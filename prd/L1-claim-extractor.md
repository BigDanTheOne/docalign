> Part of [DocAlign PRD](../PRD.md)

## 5. Layer 1: Claim Extractor

### 5.1 Purpose

Parse documentation files and decompose them into individual, verifiable claims about the codebase. A "claim" is any factual assertion the documentation makes about the code, such as file paths, dependency versions, CLI commands, API routes, behavioral descriptions, or architecture patterns.

### 5.2 Functional Requirements

**Documentation file discovery:**
- Documentation file discovery uses the union of two sources: (a) the explicit DOC_PATTERNS glob list (from technical-reference.md Section 3.2), and (b) a heuristic scan of all `.md` files in the repo root + first two directory levels. Results are deduplicated by file path.
- Exclude non-claim files: node_modules, vendor, .git, changelogs, license files
- If a `docs/` directory exists, scan it recursively (covered by DOC_PATTERNS)

**Claim types taxonomy:**

| Claim Type | Description | Example | Testability |
|------------|-------------|---------|-------------|
| `path_reference` | Reference to a file path | "see `src/auth/handler.ts`" | Syntactic |
| `dependency_version` | Reference to a package or its version | "React 18.2", "uses Express.js" | Syntactic |
| `command` | CLI command or script reference | "run `pnpm test:unit`" | Syntactic |
| `api_route` | HTTP API endpoint reference | "POST /api/v2/users" | Syntactic |
| `code_example` | Code blocks that should match reality | Fenced code blocks with imports, function calls | Syntactic/Semantic |
| `behavior` | Behavioral description of code | "AuthService handles password reset" | Semantic |
| `architecture` | System design assertions | "Data flows from API to SQS to Worker" | Semantic |
| `config` | Configuration references | "Configure via config/default.yaml" | Syntactic/Semantic |
| `convention` | Coding convention assertions | "All API responses use camelCase" | Semantic |
| `environment` | Runtime/tooling requirements | "Requires Node.js 18+" | Syntactic |

**Syntactic claim extraction (deterministic, no LLM):**
- Extract file path references from inline code, markdown links, and plain text
- Extract CLI commands from code blocks, inline code, and "run X" patterns
- Extract dependency references matching known package names or version-like patterns. Version claim validation: after regex extraction, validate the captured "package name" against known dependencies from the repo's manifest files (package.json dependencies/devDependencies, pyproject.toml dependencies). Discard version claims where the package name is not a known dependency. This eliminates false positives like "Section 2.1" or "Table 3.2".
- Extract API route references matching HTTP method + path patterns
- Extract code examples from fenced code blocks

**RST (.rst) files:** RST files: syntactic regex extraction patterns are Markdown-specific and do not apply to RST. RST files use LLM-based semantic extraction only (the LLM handles any text format). Syntactic extraction for RST is v2.

**Pre-processing before claim extraction:** Strip HTML tags, base64-encoded images, inline SVG content, and frontmatter (YAML between `---` delimiters). For MDX files: strip JSX component tags, extract text content only.

**Path validation:** All extracted file path references are validated and sandboxed to the repository root. Reject paths containing `..` traversal segments, absolute paths, `file://` URLs, and symlinks pointing outside the repo boundary. Only relative paths within the repo are valid claim values.

**`code_example` extraction logic:**
- Parse fenced code blocks (` ``` ` delimited) in documentation
- For each code block, extract sub-claims as separate verifiable claims linked to the parent `code_example`:
  - **Import paths:** Extract `import ... from 'path'`, `require('path')`, `from module import name` statements. Each becomes a `path_reference`-like sub-claim.
  - **Function/class/variable names:** Extract identifiers used in the code block (function calls, class instantiations, variable references to exported symbols). Each becomes a symbol-lookup sub-claim.
  - **CLI commands:** Extract shell commands if the code block has a bash/shell language annotation. Each becomes a `command` sub-claim.
- Each sub-claim stores a `parent_claim_id` linking back to the `code_example` claim record.
- The parent `code_example` claim's `extracted_value` is: `{ language: string | null, sub_claim_ids: string[], raw_code: string }`.

**Semantic claim extraction (LLM-based):**

**Execution model (ADR):** Syntactic claim extraction runs server-side (deterministic, no LLM). Semantic claim extraction runs in the client's GitHub Action as a `claim_extraction` task. The Action uses the client's LLM API key to read doc files, explore the codebase for context, and return structured claims. DocAlign server never sees the doc file content during extraction — only the resulting claim records. See ADR Section 4 for the task interface.

- After syntactic extraction, send remaining prose sections to an LLM
- Use structured output (JSON mode) to ensure parseable results
- Filter aggressively: only extract claims the model rates as confidence >= 0.7
- Document chunking for LLM extraction: split at markdown `##` heading boundaries. If a section exceeds 2000 words, split at paragraph boundaries (double newline). If no headings and no paragraph breaks, split at 2000-word intervals. Maximum file size for processing: 100KB. Files larger than 100KB are skipped with a warning log.
- Chunk documents by heading sections; skip sections under 50 words

### 5.3 Inputs and Outputs

**Inputs:**
- Documentation files (markdown, mdx, rst)
- Git diff (to know which doc files changed, for incremental re-extraction)

**Outputs (per claim):**
- Claim text (the raw assertion from the documentation)
- Claim type (from taxonomy above)
- Testability classification: syntactic, semantic, or untestable
- Source file and line number
- Extracted structured value (e.g., the file path, the command components, the version string)
- Keywords (for semantic claims -- used by the mapper)
- Extraction confidence score (0-1)
- Extraction method (regex, heuristic, or LLM)
- Claim embeddings are generated as a post-processing step after extraction. The embedded text is `claim_text`. Model: text-embedding-3-small (same as code entity embeddings). Embeddings are stored in the claims table `embedding` column.

### 5.4 Claim Deduplication

Multiple doc files may make the same claim (e.g., README and CONTRIBUTING both reference the same test command). Deduplicate by matching claim type + extracted value (for syntactic claims) or embedding cosine similarity > 0.95 (for semantic claims). Keep all source locations but verify only once.

### 5.5 Refresh Policy

- Re-extract claims for a doc file ONLY when that file is modified (detected via git diff)
- On re-extraction: diff new claims against old claims; preserve verification history for claims that haven't changed text
- Full re-extraction: on manual trigger (`docalign scan --full`) or scheduled weekly

### 5.6 Performance Requirements

- Syntactic extraction of a single doc file: <100ms
- LLM-based extraction: runs client-side in the GitHub Action. Cost borne by client (~$0.01-0.05 per doc file depending on model). DocAlign's cost for syntactic extraction: $0.

### 5.7 Open Questions

- **⚠️ What constitutes a "claim" vs general prose?** The boundary is fuzzy. Example: "Our authentication system is designed to be secure" -- is this a testable claim or a vague statement?
- **⚠️ Over-extraction risk:** LLM might extract 50 claims from a section where only 5 are meaningfully verifiable. This wastes verification budget.
- **⚠️ Under-extraction risk:** LLM might miss implicit claims. "The API uses standard REST conventions" implies specific things about HTTP methods, status codes, URL structure -- should these be individual claims?
- **⚠️ Experiment needed:** Run the extraction prompt on 20 real doc files, manually label output quality, measure precision/recall. Iterate on prompt. (See Section 16.1)

> Technical detail: see phases/technical-reference.md Section 3.2 (ClaimType, DOC_PATTERNS, DOC_EXCLUDE), Section 5 (Regex Patterns), Section 7.1 (P-EXTRACT prompt)

