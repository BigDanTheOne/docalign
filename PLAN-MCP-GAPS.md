# Plan: Close MCP Server Gaps (v2)

## Problem Statement

The original E8 MCP spec (TDD-6) specified 4 tools. What was built diverged. Three tools were never built, and one user-requested capability is missing.

**Gaps to close:**
1. **`get_docs(topic)`** — never built. Agents can't search docs by topic.
2. **`report_drift`** — never built. Agents can't report drift they discover.
3. **`fix_doc(file)`** — user-requested. Agents can't request fix suggestions via MCP.
4. **Post-implementation hook** — user-requested. No automatic doc check after coding.

**Code deduplication:** 5 existing tools are copy-pasted between `src/cli/commands/mcp.ts` and `src/layers/L6-mcp/local-server.ts`. Must extract shared handlers before adding new tools.

---

## Task 1: Extract Shared MCP Tool Handlers

**Why first:** Adding 3 new tools to two duplicated files would create 6 copies. Extract once.

**Files:**
- Create: `src/layers/L6-mcp/tool-handlers.ts`
- Modify: `src/layers/L6-mcp/local-server.ts` (import handlers)
- Modify: `src/cli/commands/mcp.ts` (import handlers)

**Design:**
```typescript
// src/layers/L6-mcp/tool-handlers.ts
export function registerTools(
  server: McpServer,
  pipeline: CliPipeline,
  repoRoot: string,
): void {
  // All tool registrations here — single source of truth
}
```

Both entry points call `registerTools(server, pipeline, repoRoot)` instead of inlining tool definitions.

**Acceptance criteria:**
- `npm run typecheck && npm run test` passes
- Both `docalign mcp` and `npx docalign-mcp` produce identical tool lists
- Zero duplicated tool logic

**Estimated effort:** 1 hour

---

## Task 2: `get_docs(topic)` — Multi-Signal Ranked Search

**Why:** The highest-value missing tool. Lets agents ask "what does the project say about authentication?" and get back verified doc sections. Without it, agents must know exact file paths.

### Architecture: Multi-Signal Search with RRF

Inspired by Sourcegraph Cody's Repo-level Semantic Graph approach. DocAlign already has a pre-computed tripartite graph (doc sections → claims → code entities) with typed edges and verification metadata. No other tool has this. The search should exploit it.

```
Query: "authentication"
        │
        ▼
┌───────────────────────┐
│  Query Preprocessor   │  Tokenize + classify intent
└───────┬───────────────┘
        │
        ├──► Signal 1: MiniSearch (BM25-like text search over doc sections)
        │
        ├──► Signal 2: Code entity graph traversal
        │    query tokens → findSymbol() → entity file paths →
        │    claims whose evidence_files include those paths →
        │    doc sections containing those claims
        │
        ├──► Signal 3: Claim type boost from query intent
        │    "API endpoints" → boost sections with api_route claims
        │
        ├──► Signal 4: Verification status
        │    Verified sections ranked above drifted ones
        │
        └──► Signal 5 (optional): Embedding similarity
             Only when user provides an API key (OpenAI, Anthropic, etc.)
             State-of-the-art quality, not constrained to local models
        │
        ▼
┌───────────────────────┐
│  RRF Fusion           │  Reciprocal Rank Fusion across all signals
└───────┬───────────────┘
        │
        ▼
  Ranked doc sections with verification metadata
```

### Signal Details

**Signal 1: Text Search (MiniSearch)**

MiniSearch indexes doc sections (split by markdown headings). Fields: `heading` (2x boost), `content`. Supports fuzzy matching and prefix search. Zero dependencies.

```typescript
const index = new MiniSearch<DocSection>({
  fields: ['heading', 'content'],
  storeFields: ['file', 'heading', 'startLine', 'endLine'],
  searchOptions: { boost: { heading: 2 }, fuzzy: 0.2, prefix: true },
});
```

**Signal 2: Code Entity Graph Traversal**

This is what makes DocAlign's search unique. The `InMemoryIndex` already has `findSymbol()` and `searchSemantic()` for entity lookup, plus `evidence_files` on verification results link claims to code files.

Algorithm:
1. Tokenize query into keywords (words > 2 chars)
2. For each keyword, call `index.findSymbol(keyword)` → get matching `CodeEntity[]`
3. Collect file paths of matched entities
4. From the last scan result, find all claims whose `evidence_files` include any of those file paths
5. Map those claims back to their doc sections (by `source_file` + `line_number` range)
6. Rank by number of entity matches (more entity connections = more relevant)

Example: "authentication" → finds entity `authenticateUser` in `src/auth/login.ts` → finds claims in `docs/auth.md` that reference `src/auth/login.ts` → returns the "Authentication" section of `docs/auth.md` with verification status.

**Signal 3: Query Intent Classifier (no LLM)**

A lightweight keyword → claim_type map (~40 lines). Sections containing claims of the matching type get a rank boost.

```typescript
const INTENT_MAP: Record<string, ClaimType[]> = {
  'api': ['api_route'], 'endpoint': ['api_route'], 'route': ['api_route'],
  'deploy': ['command'], 'install': ['command'], 'build': ['command'],
  'run': ['command'], 'test': ['command'], 'setup': ['command'],
  'config': ['config', 'environment'], 'env': ['environment'],
  'file': ['path_reference'], 'path': ['path_reference'],
  'version': ['dependency_version'], 'package': ['dependency_version'],
  'example': ['code_example'], 'import': ['code_example'],
};
```

**Signal 4: Verification Status**

Not a separate retrieval pass — applied as a rank adjustment after fusion:
- Sections where all claims are verified: small positive boost
- Sections with drifted claims: small negative penalty (still returned — agents need to know)
- Verification status always included in response for the agent's own trust decision

**Signal 5: Optional Embedding Similarity**

Only activated when user provides an API key via `.docalign.yml` or environment variable:

```yaml
# .docalign.yml
llm:
  embedding_model: text-embedding-3-small  # or any provider
```

When available:
1. Embed query via the configured API (OpenAI, Anthropic, etc.)
2. Embed doc sections (cached on disk at `.docalign/embeddings.json` — recomputed only when docs change)
3. Cosine similarity against cached section embeddings
4. Feeds into RRF as another signal

Design principle: **state-of-the-art quality when opted in, zero API calls by default.** No local model compromise — if you're paying for embeddings, use the best available.

### RRF Fusion (~30 lines)

```typescript
function reciprocalRankFusion(
  resultSets: Array<{ id: string; rank: number }[]>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const results of resultSets) {
    for (const { id, rank } of results) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return scores;
}
```

Used by Azure AI Search, OpenSearch, Weaviate, LanceDB as the standard for hybrid search. Only parameter (`k=60`) has a well-established default.

### Files

- Create: `src/layers/L6-mcp/doc-search.ts` — `DocSearchIndex` class (MiniSearch + section splitting + graph traversal + RRF)
- Create: `src/layers/L6-mcp/query-intent.ts` — intent classifier
- Create: `src/layers/L6-mcp/embedding-search.ts` — optional embedding client (lazy-loaded)
- Modify: `src/layers/L6-mcp/tool-handlers.ts` (add `get_docs` tool)
- Modify: `package.json` (add `minisearch` dependency)

### Data Types

```typescript
interface DocSection {
  id: string;             // `${file}#${heading}` or `${file}#_full`
  file: string;
  heading: string;        // "Installation" or "Full Document"
  content: string;
  startLine: number;
  endLine: number;
}

interface SearchResult {
  file: string;
  heading: string;
  content_preview: string;
  verification_status: 'verified' | 'drifted' | 'mixed' | 'unchecked';
  health_score: number | null;
  claims_total: number;
  claims_verified: number;
  claims_drifted: number;
  relevance_score: number;
}
```

### MCP Tool Schema

```typescript
server.tool(
  'get_docs',
  'Search project documentation by topic. Returns relevant doc sections ranked by relevance, with verification status showing whether the content matches the actual code.',
  {
    query: z.string().min(1).describe('Topic to search for (e.g., "authentication", "API endpoints", "deployment")'),
    verified_only: z.boolean().optional().default(false).describe('Only return sections where all claims are verified'),
    max_results: z.number().int().min(1).max(50).optional().describe('Max sections to return (default 10)'),
  },
  async ({ query, verified_only, max_results }) => { ... }
);
```

### Response Example

```json
{
  "sections": [
    {
      "file": "docs/auth.md",
      "heading": "Password Hashing",
      "content_preview": "Authentication uses argon2id with 64MB memory cost for password hashing. The auth module...",
      "verification_status": "verified",
      "health_score": 1.0,
      "claims_total": 5,
      "claims_verified": 5,
      "claims_drifted": 0,
      "relevance_score": 0.042
    },
    {
      "file": "README.md",
      "heading": "Getting Started",
      "content_preview": "Configure authentication by setting AUTH_SECRET in .env...",
      "verification_status": "drifted",
      "health_score": 0.33,
      "claims_total": 3,
      "claims_verified": 1,
      "claims_drifted": 2,
      "relevance_score": 0.031
    }
  ],
  "total_matches": 2,
  "signals_used": ["text", "entity_graph", "intent_boost"]
}
```

### Tests

`test/layers/L6-mcp/doc-search.test.ts`:
- Text search returns ranked sections by keyword relevance
- Entity graph traversal finds sections via code entity → claim → doc section path
- Query intent boosts sections with matching claim types
- `verified_only` filters out sections with drifted claims
- Sections without claims return `verification_status: 'unchecked'`
- RRF fusion combines signals correctly (document appearing in multiple signals ranks higher)
- Fuzzy matching works for typos
- `max_results` limits output
- Empty query returns error
- No matches returns `{ sections: [] }`

`test/layers/L6-mcp/query-intent.test.ts`:
- "API endpoints" classifies to `api_route`
- "deployment" classifies to `command`
- Unknown terms return empty array
- Multiple intent tokens combine correctly

`test/layers/L6-mcp/embedding-search.test.ts`:
- Without API key, embedding signal is skipped (no error)
- With API key, embeddings are computed and cached
- Cached embeddings are reused across queries
- Cache invalidated when doc file content changes

### Acceptance criteria
- `get_docs` tool appears in MCP tool list
- Multi-signal search finds docs that pure keyword search would miss (entity graph)
- Each result includes verification_status and health_score
- Works without any API key (signals 1-4 only)
- When embedding API key is provided, signal 5 activates and improves results
- `signals_used` field shows which signals contributed
- Tests pass

**Estimated effort:** 5 hours (up from 3 — graph traversal + RRF + optional embeddings)

---

## Task 3: `fix_doc(file)` — Generate Fix Suggestions via MCP

**Why:** Agents should be able to request doc fixes through MCP. The pipeline already generates fixes (LLM-based for Tier 3, deterministic `suggested_fix` for Tier 1-2). This tool exposes that capability.

**Files:**
- Modify: `src/layers/L6-mcp/tool-handlers.ts` (add `fix_doc` tool)

**Design:**

`LocalPipeline.checkFile()` already returns `fixes: DocFix[]` when an LLM client is available. Even without LLM, `VerificationResult.suggested_fix` contains deterministic fix text. The tool exposes both.

**MCP tool schema:**
```typescript
server.tool(
  'fix_doc',
  'Generate fix suggestions for drifted documentation claims in a file. Returns specific text replacements.',
  {
    file: z.string().min(1).describe('Path to the documentation file (relative to repo root)'),
  },
  async ({ file }) => { ... }
);
```

**Response format (with LLM):**
```json
{
  "file": "README.md",
  "total_drifted": 2,
  "llm_fixes_available": true,
  "fixes": [
    {
      "line": 15,
      "claim_text": "Run `npm start` to start the server",
      "claim_type": "command",
      "severity": "high",
      "fix": {
        "line_start": 15,
        "line_end": 15,
        "old_text": "Run `npm start` to start the server",
        "new_text": "Run `npm run dev` to start the server",
        "reason": "package.json has 'dev' script but no 'start' script",
        "confidence": 0.95
      }
    }
  ]
}
```

**Response format (without LLM):**
```json
{
  "file": "README.md",
  "total_drifted": 1,
  "llm_fixes_available": false,
  "fixes": [
    {
      "line": 15,
      "claim_text": "Run `npm start` to start the server",
      "claim_type": "command",
      "severity": "high",
      "fix": {
        "suggested_fix": "Script 'start' not found. Available: dev, build, test, lint",
        "reasoning": "Script 'start' does not exist in package.json scripts"
      }
    }
  ]
}
```

**Tests:**
- `fix_doc` on file with no drift returns empty fixes array
- `fix_doc` on file with drift returns fix suggestions
- `fix_doc` on nonexistent file returns error
- Without LLM, returns `suggested_fix` text instead of structured fix

**Acceptance criteria:**
- `fix_doc` tool appears in MCP tool list
- Returns structured fixes for drifted claims
- Works without LLM (deterministic fallback)
- Tests pass

**Estimated effort:** 1.5 hours

---

## Task 4: `report_drift` — Local JSON Persistence

**Why:** Agents discover drift while working. They should be able to report it for tracking even if not immediately fixed.

**Files:**
- Create: `src/layers/L6-mcp/drift-reports.ts`
- Modify: `src/layers/L6-mcp/tool-handlers.ts` (add `report_drift` tool)

**Design:**

```typescript
// src/layers/L6-mcp/drift-reports.ts
interface DriftReport {
  id: string;
  doc_file: string;
  line_number: number | null;
  claim_text: string;
  actual_behavior: string;
  evidence_files: string[];
  reported_at: string;
  status: 'pending' | 'fixed' | 'dismissed';
}

const REPORTS_DIR = '.docalign';
const REPORTS_FILE = 'reports.json';

export function loadReports(repoRoot: string): DriftReport[] { ... }
export function appendReport(repoRoot: string, report: DriftReport): void { ... }
export function updateReportStatus(repoRoot: string, id: string, status: string): void { ... }
```

Storage at `.docalign/reports.json` — append-only, local, not committed to git.

**MCP tool schema:**
```typescript
server.tool(
  'report_drift',
  'Report a documentation inaccuracy you discovered while working. Stores the report locally for tracking.',
  {
    doc_file: z.string().min(1).describe('Documentation file with the inaccuracy'),
    claim_text: z.string().min(1).max(2000).describe('The inaccurate text in the doc'),
    actual_behavior: z.string().min(1).max(2000).describe('What the code actually does'),
    line_number: z.number().int().min(1).optional().describe('Approximate line number'),
    evidence_files: z.array(z.string()).max(20).optional().describe('Code files showing actual behavior'),
  },
  async ({ doc_file, claim_text, actual_behavior, line_number, evidence_files }) => { ... }
);
```

**Tests:**
- `appendReport` creates file and directory if missing
- `appendReport` appends to existing reports
- `loadReports` returns empty array for missing file
- Report has all required fields with UUID and timestamp
- `report_drift` MCP tool returns `acknowledged: true` with report ID

**Acceptance criteria:**
- `report_drift` tool appears in MCP tool list
- Reports persist to `.docalign/reports.json`
- File created on first report, accumulates thereafter
- Tests pass

**Estimated effort:** 2 hours

---

## Task 5: Post-Implementation Hook

**Why:** When an agent commits code, docs should be checked. The user said "the hook should be triggered when the implementation phase ends, not in every file edition." A `git commit` is the natural "done" signal.

**Approach:** Claude Code PostToolUse hook on `Bash` matching `git commit`.

**Files:**
- Modify: `src/cli/commands/init.ts` (add hook config to settings.local.json)

**Design:**

The hook is a lightweight reminder — not a full scan. The agent then decides whether to call MCP tools.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "pattern": "git commit",
        "command": "echo '[DocAlign] Code committed. Consider running get_doc_health or check_doc to verify documentation is still accurate.'"
      }
    ]
  }
}
```

A full-scan hook can be added later as opt-in via `docalign configure --hook=full-scan`.

**Also update SKILL.md** to include a "Post-Implementation Check" workflow guiding agents to check docs after committing.

**Tests:**
- `docalign init` writes hooks config to settings.local.json
- Existing hooks are preserved (merged, not overwritten)
- Hook matcher targets `Bash` with `git commit` pattern

**Acceptance criteria:**
- `docalign init` adds hook configuration
- Hook fires after `git commit` in Claude Code
- SKILL.md includes post-implementation workflow
- Tests pass

**Estimated effort:** 1.5 hours

---

## Task 6: Update SKILL.md and init.ts for New Tools

**Why:** Both skill files need to document the 3 new tools and new workflows.

**Files:**
- Modify: `src/cli/commands/init.ts` (update SKILL_MD constant)
- Modify: `~/.codex/skills/docalign/SKILL.md` (update Codex skill)

**Changes:**
- Add `get_docs`, `fix_doc`, `report_drift` to tool list
- Add Workflow 6: Post-Implementation Check
- Add Workflow 7: Search and Verify

```markdown
### Workflow 7: Search and Verify
When user asks about a topic ("how does auth work?"):
1. Call `get_docs` with the topic
2. Check `verification_status` of returned sections
3. If verified — share the content confidently
4. If drifted — warn the user and suggest running `fix_doc`
5. If unchecked — note that the docs haven't been verified yet
```

**Acceptance criteria:**
- Both SKILL.md files document all 8 tools
- Workflows cover all major use cases

**Estimated effort:** 1 hour

---

## Execution Order

```
Task 1: Extract shared handlers ──┐
                                  ├── Task 2: get_docs (multi-signal search)
                                  ├── Task 3: fix_doc
                                  └── Task 4: report_drift
                                        │
                                        ├── Task 5: Post-commit hook
                                        └── Task 6: Update skills
```

**Total estimated effort: ~12 hours**

## Dependencies to Install

```bash
npm install minisearch
```

MiniSearch v7.x — zero dependencies, ~15KB gzipped, native TypeScript. Used for Signal 1 (text search with BM25-like scoring, fuzzy match, prefix search, field boosting).

No other new dependencies. Embedding (Signal 5) uses the user's own API key via the existing `LLMClient` infrastructure — no new packages needed.

## Definition of Done

- [ ] All 8 MCP tools work via both `docalign mcp` and `npx docalign-mcp`
- [ ] `get_docs` performs multi-signal search (text + entity graph + intent + verification)
- [ ] `get_docs` optionally uses embeddings when API key is configured
- [ ] `fix_doc` returns fix suggestions (LLM or deterministic)
- [ ] `report_drift` persists reports to `.docalign/reports.json`
- [ ] Post-commit hook reminds agent to check docs
- [ ] SKILL.md documents all tools and workflows
- [ ] `npm run typecheck && npm run test` passes
- [ ] No duplicated tool handler code between entry points

## What Makes This Search Unique

| Feature | Generic code search (Cursor, Cody) | DocAlign `get_docs` |
|---------|-------------------------------------|---------------------|
| What's indexed | Code files | Documentation sections |
| Relationships | File-level deps | Claim → code entity mappings |
| Metadata | File type, path | Claim type, verification status |
| Trust signal | None | Verified / drifted / unchecked |
| Graph structure | Code dependency graph | Doc → claim → code entity tripartite graph |
| LLM requirement | Always (embeddings) | Zero by default, optional for premium quality |

The unique advantage: DocAlign has a pre-computed tripartite graph with typed edges and trust annotations. The search exploits this graph rather than trying to replicate pure vector search.
