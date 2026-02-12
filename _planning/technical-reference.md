# DocAlign: Technical Reference (Extracted from PRD)

> This file contains implementation-level detail extracted from the PRD during the planning workflow.
> These details serve as input for Phase 3 (Architecture) and Phase 4 (TDDs).
> They represent early design thinking and may be modified during those phases.

---

## 1. Tech Stack Decisions

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Node.js / TypeScript | GitHub App ecosystem, fast iteration |
| AST Parsing | tree-sitter (WASM) | Multi-language, battle-tested |
| LLM Execution | All client-side (GitHub Action) | ADR: DocAlign server makes zero LLM calls. Client uses their own API key. Default models: Claude Sonnet (verification, extraction), text-embedding-3-small (embeddings), configurable via `.docalign.yml`. |
| Database | PostgreSQL (Supabase) | Managed, free tier, familiar |
| Vector Store | pgvector (via Supabase) | Co-located with relational data, no extra service |
| Hosting | Railway or Fly.io | Simple deployment, reasonable free tier |
| Queue | BullMQ (Redis) | Background job processing for webhook handling |

---

## 2. Repository Structure

```
docalign/
├── src/
│   ├── app.ts                    # GitHub App entry point (Probot or custom)
│   ├── layers/
│   │   ├── L0-codebase-index/
│   │   │   ├── ast-parser.ts     # tree-sitter integration
│   │   │   ├── embedder.ts       # embedding generation
│   │   │   └── index-store.ts    # index CRUD operations
│   │   ├── L1-claim-extractor/
│   │   │   ├── syntactic.ts      # regex/heuristic extraction
│   │   │   ├── semantic.ts       # LLM-based extraction
│   │   │   └── claim-store.ts    # claim CRUD operations
│   │   ├── L2-mapper/
│   │   │   ├── direct-ref.ts     # file path, command, version mapping
│   │   │   ├── symbol-search.ts  # AST symbol lookup
│   │   │   ├── semantic-search.ts# embedding similarity
│   │   │   ├── llm-mapper.ts     # LLM-assisted mapping (vague claims)
│   │   │   └── mapping-store.ts  # mapping CRUD operations
│   │   ├── L3-verifier/
│   │   │   ├── syntactic.ts      # deterministic checks (Tier 1)
│   │   │   ├── pattern.ts        # grep/AST pattern checks (Tier 2)
│   │   │   ├── router.ts         # Path 1/Path 2 routing logic
│   │   │   ├── evidence.ts       # Path 1 entity extraction
│   │   │   └── post-check.ts     # verification scripts (Tier 5)
│   │   ├── L4-triggers/
│   │   │   ├── pr-webhook.ts     # GitHub PR event handler
│   │   │   ├── push-webhook.ts   # push event handler
│   │   │   ├── scheduler.ts      # periodic full scans
│   │   │   └── scope-resolver.ts # determine which claims to check
│   │   ├── L5-reporter/
│   │   │   ├── pr-comment.ts     # GitHub PR comment formatting
│   │   │   ├── fix-generator.ts  # snippet replacement generation
│   │   │   └── health-score.ts   # repo/file health calculation
│   │   ├── L6-mcp/
│   │   │   ├── server.ts         # MCP server implementation
│   │   │   ├── tools.ts          # MCP tool definitions
│   │   │   └── handlers.ts       # tool request handlers
│   │   └── L7-learning/
│   │       ├── feedback.ts       # accept/reject recording
│   │       ├── co-change.ts      # co-change pattern detection
│   │       └── learnings-store.ts# learning CRUD operations
│   ├── shared/
│   │   ├── llm.ts                # LLM client abstraction
│   │   ├── git.ts                # git operations
│   │   ├── db.ts                 # database client
│   │   └── types.ts              # shared type definitions
│   └── config/
│       └── defaults.ts           # default configuration
├── migrations/                   # database migrations
├── test/
└── package.json
```

---

## 3. TypeScript Interfaces

### 3.1 Layer 0: Codebase Index

```typescript
interface CodebaseIndex {
  // File existence
  fileExists(repoId: string, path: string): Promise<boolean>;

  // Symbol lookup
  findSymbol(repoId: string, name: string): Promise<CodeEntity[]>;

  // Semantic search
  searchSemantic(repoId: string, query: string, topK: number): Promise<CodeEntity[]>;

  // Dependency lookup
  getDependencyVersion(repoId: string, packageName: string): Promise<string | null>;

  // Script/command lookup
  scriptExists(repoId: string, scriptName: string): Promise<boolean>;
  getAvailableScripts(repoId: string): Promise<Script[]>;

  // Route lookup
  findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null>;

  // Route search (similarity/prefix matching for verification)
  searchRoutes(repoId: string, path: string): Promise<Array<{ method: string, path: string, file: string, line: number, similarity: number }>>;

  // File tree
  getFileTree(repoId: string): Promise<string[]>;

  // Incremental update
  updateFromDiff(repoId: string, changedFiles: FileChange[]): Promise<void>;
}

interface CodeEntity {
  id: string;
  repoId: string;
  filePath: string;
  lineNumber: number;
  entityType: 'function' | 'class' | 'route' | 'type' | 'config';
  name: string;
  signature: string;        // human-readable signature
  embedding: number[];       // vector embedding
  rawCode: string;           // source code of the entity (for verification context)
  lastUpdated: Date;
}
```

### 3.2 Layer 1: Claim Extractor

**Claim type enum:**

```typescript
type ClaimType =
  | 'path_reference'       // "see src/auth/handler.ts"
  | 'dependency_version'   // "React 18.2", "uses Express.js"
  | 'command'              // "run pnpm test:unit"
  | 'api_route'            // "POST /api/v2/users"
  | 'code_example'         // ```js code blocks that should match reality
  | 'behavior'             // "AuthService handles password reset"
  | 'architecture'         // "Data flows from API to SQS to Worker"
  | 'config'               // "Configure via config/default.yaml"
  | 'convention'           // "All API responses use camelCase"
  | 'environment'          // "Requires Node.js 18+"
  ;

type Testability = 'syntactic' | 'semantic' | 'untestable';
```

**Documentation file discovery patterns:**

```typescript
const DOC_PATTERNS = [
  // Root-level docs
  'README.md', 'README.mdx', 'README.rst',
  'CONTRIBUTING.md', 'ARCHITECTURE.md',
  'CLAUDE.md', 'AGENTS.md', 'COPILOT-INSTRUCTIONS.md',
  '.cursorrules',

  // Doc directories
  'docs/**/*.md', 'docs/**/*.mdx',
  'doc/**/*.md',
  'wiki/**/*.md',

  // ADRs
  'adr/**/*.md', 'ADR-*.md',

  // Nested agent instructions (OpenAI pattern: 88 AGENTS.md across subdirs)
  '**/CLAUDE.md', '**/AGENTS.md',

  // API docs
  'api/**/*.md',
];

const DOC_EXCLUDE = [
  'node_modules/**',
  'vendor/**',
  '.git/**',
  '**/CHANGELOG.md',  // Changelogs are historical, not claims about current state
  '**/LICENSE.md',
];
```

**Syntactic extraction output examples:**

```typescript
// Path reference output
{
  claim_text: "see `src/auth/handler.ts`",
  claim_type: 'path_reference',
  testability: 'syntactic',
  source_file: 'README.md',
  line_number: 45,
  extracted_value: 'src/auth/handler.ts',  // the path to check
  confidence: 1.0
}

// Command output
{
  claim_text: "```bash\npnpm test:unit\n```",
  claim_type: 'command',
  testability: 'syntactic',
  source_file: 'CONTRIBUTING.md',
  line_number: 12,
  extracted_value: { runner: 'pnpm', script: 'test:unit' },
  confidence: 1.0
}
```

**Claim deduplication logic:**

```typescript
// Two claims are duplicates if:
// 1. Same claim_type AND
// 2. Same extracted_value (for syntactic) OR embedding cosine similarity > 0.95 (for semantic)

// When deduplicating, keep all source locations (the claim exists in both files)
// but verify only once
```

### 3.3 Layer 2: Mapper

**Mapping methods:** `direct_reference` | `symbol_search` | `semantic_search` | `llm_assisted` | `manual` | `co_change` (from Layer 7 co-change tracking)

**Direct reference mapping functions:**

```typescript
// Path reference mapping
function mapPathReference(claim: Claim, index: CodebaseIndex): Mapping[] {
  const path = claim.extracted_value;
  const exists = await index.fileExists(claim.repoId, path);
  return [{
    claim_id: claim.id,
    code_file: path,
    code_entity: null,  // entire file
    confidence: 1.0,
    mapping_method: 'direct_reference',
  }];
}

// Command mapping
function mapCommand(claim: Claim, index: CodebaseIndex): Mapping[] {
  const { runner, script } = claim.extracted_value;
  // Map to the file that defines the script
  if (['npm', 'npx', 'yarn', 'pnpm'].includes(runner)) {
    return [{ code_file: 'package.json', confidence: 1.0, mapping_method: 'direct_reference' }];
  }
  if (runner === 'make') {
    return [{ code_file: 'Makefile', confidence: 1.0, mapping_method: 'direct_reference' }];
  }
  // ... etc for cargo, go, pip
}

// Dependency mapping
function mapDependency(claim: Claim, index: CodebaseIndex): Mapping[] {
  const packageName = claim.extracted_value.package;
  // Find which dependency file contains this package
  // Check: package.json, requirements.txt, Cargo.toml, go.mod
  // Return the specific dependency file
}

// API route mapping
function mapApiRoute(claim: Claim, index: CodebaseIndex): Mapping[] {
  const { method, path } = claim.extracted_value;
  const route = await index.findRoute(claim.repoId, method, path);
  if (route) {
    return [{ code_file: route.filePath, code_entity: route.id, confidence: 1.0, mapping_method: 'direct_reference' }];
  }
  // Fallback: search for the path string in code files
  return []; // will fall through to next step
}
```

**Symbol-based search:**

```typescript
function mapBySymbol(claim: Claim, index: CodebaseIndex): Mapping[] {
  const keywords = claim.keywords; // extracted by claim extractor
  const mappings: Mapping[] = [];

  for (const keyword of keywords) {
    const entities = await index.findSymbol(claim.repoId, keyword);
    for (const entity of entities) {
      mappings.push({
        claim_id: claim.id,
        code_file: entity.filePath,
        code_entity: entity.id,
        confidence: 0.85,
        mapping_method: 'symbol_search',
      });
    }
  }

  return deduplicateAndRank(mappings);
}
```

**Semantic search:**

```typescript
function mapBySemantic(claim: Claim, index: CodebaseIndex): Mapping[] {
  const results = await index.searchSemantic(
    claim.repoId,
    claim.claim_text,
    topK: 5
  );

  return results
    .filter(r => r.similarity > 0.7)  // Similarity threshold: 0.7 (configurable via .docalign.yml mapping_threshold). OpenAI text-embedding-3-small cosine similarities cluster in 0.5-0.8 range; 0.7 balances precision and recall.
    .map(r => ({
      claim_id: claim.id,
      code_file: r.filePath,
      code_entity: r.id,
      confidence: r.similarity * 0.8, // scale down: similarity != certainty
      mapping_method: 'semantic_search',
    }));
}
```

**LLM-assisted mapping options (vague/architecture claims):**

```typescript
// Option A: File-tree + LLM reasoning
function mapByLLM_OptionA(claim: Claim, index: CodebaseIndex): Mapping[] {
  const fileTree = await index.getFileTree(claim.repoId);
  // Problem: file tree can be 10,000+ entries
  // Mitigation: filter to likely-relevant directories first
  const relevantDirs = filterByKeywords(fileTree, claim.keywords);

  const prompt = `
    Given this documentation claim: "${claim.claim_text}"
    And these potentially relevant files:
    ${relevantDirs.join('\n')}

    Which files (up to 5) would contain evidence to verify or disprove this claim?
    Return file paths only, one per line.
  `;

  // Problem: this might return wrong files
  // Problem: how do we know if the LLM's file selection is correct?
}

// Option B: Multi-hop search
// Use the LLM to decompose the claim into sub-claims that ARE localizable
function mapByLLM_OptionB(claim: Claim, index: CodebaseIndex): Mapping[] {
  const prompt = `
    This documentation claim cannot be verified by looking at a single file:
    "${claim.claim_text}"

    Decompose it into 2-5 specific, localizable sub-claims that together
    would verify the original claim.

    Example: "Data flows from API to queue to worker" ->
    1. "An API endpoint exists that publishes to a queue"
    2. "A queue consumer/worker exists that reads from the queue"
    3. "The API imports or references the queue client"
  `;

  // Then map each sub-claim using Steps 1-3
  // Problem: adds LLM cost and latency
  // Problem: decomposition may be wrong
}

// Option C: Skip and mark as "unmappable"
function mapByLLM_OptionC(claim: Claim): Mapping[] {
  return [{
    claim_id: claim.id,
    code_file: null,
    code_entity: null,
    confidence: 0,
    mapping_method: 'unmappable',
    reason: 'Architecture-level claim requires manual mapping or full-repo analysis',
  }];
}
```

**Mapping maintenance logic:**

```
On each commit:
1. Get deleted files -> remove all mappings pointing to them
2. Get renamed files -> update file paths in mappings
3. For modified files: entity-level changes detected by Layer 0 index update
   - If a mapped entity was removed: re-run mapping for that claim (Steps 1-3)
```

**Reverse index query:**

```sql
-- Reverse lookup: code file -> claims
SELECT c.* FROM claims c
JOIN claim_mappings m ON c.id = m.claim_id
WHERE m.code_file = $1 AND m.repo_id = $2;
```

### 3.4 Layer 3: Verifier

**Verification result interface:**

```typescript
interface VerificationResult {
  claim_id: string;
  verdict: 'verified' | 'drifted' | 'uncertain';
  confidence: number;          // 0-1
  tier: 1 | 2 | 3 | 4 | 5;   // which tier produced the result
  severity?: 'high' | 'medium' | 'low';
  reasoning?: string;
  specific_mismatch?: string;
  suggested_fix?: string;
  evidence_files: string[];    // which code files were examined
  token_cost?: number;         // LLM tokens used
  duration_ms: number;         // wall clock time
  post_check_result?: 'confirmed' | 'contradicted' | 'skipped';
}
```

**Tier 1 verification functions:**

```typescript
// Path reference check
async function verifyPathReference(claim: Claim, index: CodebaseIndex): Promise<VerificationResult> {
  const path = claim.extracted_value;
  const exists = await index.fileExists(claim.repoId, path);

  if (exists) {
    return { verdict: 'verified', confidence: 1.0, tier: 1 };
  }

  // Check for likely renames
  const similar = await findSimilarPaths(index, claim.repoId, path);
  if (similar.length > 0) {
    return {
      verdict: 'drifted',
      confidence: 1.0,
      tier: 1,
      severity: 'medium',
      reasoning: `File '${path}' no longer exists. Similar file found: '${similar[0]}'`,
      suggested_fix: claim.claim_text.replace(path, similar[0]),
    };
  }

  return {
    verdict: 'drifted',
    confidence: 1.0,
    tier: 1,
    severity: 'high',
    reasoning: `File '${path}' does not exist in the repository`,
    suggested_fix: null, // can't auto-fix a missing file reference
  };
}

// Command check
async function verifyCommand(claim: Claim, index: CodebaseIndex): Promise<VerificationResult> {
  const { runner, script } = claim.extracted_value;
  const exists = await index.scriptExists(claim.repoId, script);

  if (exists) {
    return { verdict: 'verified', confidence: 1.0, tier: 1 };
  }

  // Check available scripts for close matches
  const available = await index.getAvailableScripts(claim.repoId);
  const closeMatch = findCloseMatch(script, available.map(s => s.name));

  if (closeMatch) {
    return {
      verdict: 'drifted',
      confidence: 1.0,
      tier: 1,
      severity: 'high',
      reasoning: `Script '${script}' not found. Did you mean '${closeMatch}'?`,
      suggested_fix: claim.claim_text.replace(script, closeMatch),
    };
  }

  return {
    verdict: 'drifted',
    confidence: 1.0,
    tier: 1,
    severity: 'high',
    reasoning: `Script '${script}' not found in ${runner} configuration`,
    suggested_fix: null,
  };
}

// Dependency version check
async function verifyDependencyVersion(claim: Claim, index: CodebaseIndex): Promise<VerificationResult> {
  const { package: pkgName, version: claimedVersion } = claim.extracted_value;
  const actualVersion = await index.getDependencyVersion(claim.repoId, pkgName);

  if (!actualVersion) {
    return {
      verdict: 'drifted',
      confidence: 1.0,
      tier: 1,
      severity: 'high',
      reasoning: `Package '${pkgName}' not found in dependencies`,
      suggested_fix: null,
    };
  }

  if (semverSatisfies(actualVersion, claimedVersion)) {
    return { verdict: 'verified', confidence: 1.0, tier: 1 };
  }

  return {
    verdict: 'drifted',
    confidence: 1.0,
    tier: 1,
    severity: 'medium',
    reasoning: `Documentation says '${pkgName} ${claimedVersion}' but actual version is '${actualVersion}'`,
    suggested_fix: claim.claim_text.replace(claimedVersion, actualVersion),
  };
}

// API route check
async function verifyApiRoute(claim: Claim, index: CodebaseIndex): Promise<VerificationResult> {
  const { method, path } = claim.extracted_value;
  const route = await index.findRoute(claim.repoId, method, path);

  if (route) {
    return { verdict: 'verified', confidence: 1.0, tier: 1 };
  }

  // Search for the path with different methods or slight variations
  const alternatives = await index.searchRoutes(claim.repoId, path);
  // ... similar to other checks
}
```

**Tier 2 pattern verification strategies:**

```typescript
async function verifyPattern(claim: Claim, index: CodebaseIndex): Promise<VerificationResult | null> {
  // Only applicable to 'convention' and some 'environment' claims
  // Each convention type has a specific verification strategy

  const strategy = getPatternStrategy(claim);
  if (!strategy) return null; // can't verify with patterns, fall through

  return strategy.execute(claim, index);
}
```

| Convention Claim Pattern | Verification Strategy |
|-------------------------|----------------------|
| "strict mode" / "strict: true" | Check tsconfig.json / eslint config |
| "uses [framework]" | Search imports for framework package |
| "all X use Y pattern" | Grep for counter-examples |
| "environment variable X" | Check .env.example or config files |
| "[tool] version X+" | Check tool version files (.nvmrc, .python-version) |

**Post-check verification (Tier 5):**

```typescript
// After Tier 4 returns verdict: "drifted"
// Ask the LLM to generate a verification command

const postCheckPrompt = `
You found that this claim is drifted:
Claim: "${claim.claim_text}"
Mismatch: "${tier4Result.specific_mismatch}"

Generate a shell command (grep, find, or similar) that would CONFIRM this finding.
The command should return non-empty output if the finding is correct.

Examples:
- If the claim says "uses bcrypt" but code uses argon2:
  grep -r "bcrypt" src/ (should return empty, confirming bcrypt is not used)
- If the claim says file "config/default.yaml" exists:
  ls config/default.yaml (should fail if file doesn't exist)

Return ONLY the shell command, nothing else.
If no simple verification command exists, return "SKIP".
`;
```

### 3.5 Layer 4: Change-Triggered Scanning

**PR webhook handler:**

```typescript
// Event: pull_request.opened, pull_request.synchronize
async function onPullRequest(event: PullRequestEvent) {
  const { owner, repo, pull_number } = event;

  // 1. Get changed files
  const changedFiles = await github.pulls.listFiles({ owner, repo, pull_number });

  // 2. Separate doc files from code files
  const changedDocs = changedFiles.filter(f => isDocFile(f.filename));
  const changedCode = changedFiles.filter(f => !isDocFile(f.filename));

  // 3. Update codebase index for changed code files
  await codebaseIndex.updateFromDiff(repoId, changedCode);

  // 4. Re-extract claims for changed doc files
  for (const doc of changedDocs) {
    await claimExtractor.reExtract(repoId, doc.filename);
  }

  // 5. Find claims affected by code changes (reverse index lookup)
  const affectedClaims = await mapper.findClaimsByCodeFiles(
    repoId,
    changedCode.map(f => f.filename)
  );

  // 6. Also include claims from changed doc files (they may reference unchanged code)
  const docClaims = await claimStore.getClaimsByFiles(
    repoId,
    changedDocs.map(f => f.filename)
  );

  // 7. Merge and deduplicate
  const claimsToVerify = dedup([...affectedClaims, ...docClaims]);

  // 8. Run verification pipeline
  const results = await verifier.verifyBatch(claimsToVerify);

  // 9. Filter to actionable findings only
  const findings = results.filter(r => r.verdict === 'drifted');

  // 10. Post PR comment
  if (findings.length > 0) {
    await reporter.postPRComment(owner, repo, pull_number, findings);
  }
}
```

**Push handler:**

```typescript
// Event: push (to main/master)
async function onPush(event: PushEvent) {
  // Same flow as PR but:
  // - No PR comment to post
  // - Update stored verification results
  // - Update repo health score
  // This keeps the claim database current between PRs
}
```

**Scheduled scan:**

```typescript
// Cron: weekly (configurable)
async function onScheduledScan(repoId: string) {
  // 1. Re-extract all claims from all doc files
  // 2. Re-map all claims (some mappings may have gone stale)
  // 3. Verify ALL claims (not just changed ones)
  // 4. Generate health report
  // 5. Store results

  // This catches drift that accumulated from many small changes
  // where no individual PR triggered a re-check
}
```

**Agent drift report handler:**

```typescript
// When an agent reports suspected drift via MCP
async function onAgentDriftReport(report: DriftReport) {
  // 1. Find the claim being reported (or create a new one)
  // 2. Queue immediate re-verification
  // 3. If confirmed drifted: create a finding record
  // 4. Optionally notify the developer (GitHub issue, Slack, etc.)
}
```

**Debouncing constants:**

```typescript
// Multiple pushes to the same PR in quick succession
// Don't re-scan every time; debounce with 30-second window
const DEBOUNCE_MS = 30_000;

// Per-repo rate limit: max 100 scans per day
const MAX_DAILY_SCANS = 100;

// Per-org rate limit: max 1000 scans per day
const MAX_ORG_DAILY_SCANS = 1000;
```

### 3.6 Layer 5: Reporter

**DocFix interface:**

```typescript
interface DocFix {
  file: string;
  line_start: number;
  line_end: number;
  old_text: string;      // exact text to replace
  new_text: string;       // replacement text
  reason: string;         // why this fix is needed
  claim_id: string;       // which claim triggered this
  confidence: number;     // how confident the fix is correct
}
```

**Health score calculation:**

```typescript
function calculateHealthScore(repoId: string): HealthScore {
  const claims = await claimStore.getAllClaims(repoId);
  const verified = claims.filter(c => c.verification_status === 'verified');
  const drifted = claims.filter(c => c.verification_status === 'drifted');
  const uncertain = claims.filter(c => c.verification_status === 'uncertain');
  const pending = claims.filter(c => c.verification_status === 'pending');

  return {
    total_claims: claims.length,
    verified: verified.length,
    drifted: drifted.length,
    uncertain: uncertain.length,
    pending: pending.length,
    score: verified.length / (claims.length - pending.length), // 0-1
    by_file: groupByFile(claims),      // per-file breakdown
    by_type: groupByType(claims),      // per claim-type breakdown
    hotspots: findHotspots(claims),    // files with most drift
  };
}
```

**PR comment template:**

```markdown
## DocAlign: Documentation Health Check

Found **3 documentation issues** related to your code changes:

---

### HIGH: Password hashing library changed
**docs:** `README.md` line 45
**claim:** "Authentication uses bcrypt with 12 salt rounds"
**evidence:** `src/auth/password.ts` now imports `argon2`, not `bcrypt`

<details>
<summary>Suggested fix</summary>

\`\`\`diff
- Authentication uses bcrypt with 12 salt rounds for password hashing.
+ Authentication uses argon2id with 64MB memory cost for password hashing.
\`\`\`
</details>

---

### MEDIUM: API version in docs is outdated
**docs:** `docs/api.md` line 112
**claim:** "POST /api/v1/users"
**evidence:** Route in `src/routes/users.ts:34` is `/api/v2/users`

<details>
<summary>Suggested fix</summary>

\`\`\`diff
- POST /api/v1/users
+ POST /api/v2/users
\`\`\`
</details>

---

### LOW: Config file renamed
**docs:** `CONTRIBUTING.md` line 23
**claim:** "see `config/default.yaml`"
**evidence:** File was renamed to `config/default.toml`

<details>
<summary>Suggested fix</summary>

\`\`\`diff
- see `config/default.yaml`
+ see `config/default.toml`
\`\`\`
</details>

---

Repo health: 94% (467/497 claims verified) | [View dashboard](#)

> Was this helpful? React with thumbs up or thumbs down to improve future checks.
> [Documentation](link) | [Dismiss all](link)
```

**Inline suggestion format (GitHub native):**

```markdown
\`\`\`suggestion
Authentication uses argon2id with 64MB memory cost for password hashing.
\`\`\`
```

### 3.7 Layer 6: MCP

**MCP tool schemas:**

**Tool 1: `get_docs`**

```typescript
{
  name: "get_docs",
  description: "Search project documentation for information about a topic. Returns relevant documentation sections with verification status indicating whether the content is confirmed accurate, potentially stale, or uncertain.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What you want to know about (e.g., 'authentication', 'API endpoints', 'deployment process')"
      },
      verified_only: {
        type: "boolean",
        description: "If true, only return documentation that has been verified as accurate. Default: false.",
        default: false
      }
    },
    required: ["query"]
  }
}

// Handler:
async function handleGetDocs(params: { query: string, verified_only?: boolean }): Promise<DocResult[]> {
  // 1. Embed the query
  // 2. Search claim embeddings for relevant claims
  // 3. Group claims by source file/section
  // 4. Return doc sections with verification metadata

  return [{
    file: "docs/auth.md",
    section: "Password Hashing",
    content: "Authentication uses argon2id with 64MB memory cost...",
    verification_status: "verified",
    last_verified: "2026-02-07T14:23:00Z",
    claims_in_section: 5,
    verified_claims: 5,
    health_score: 1.0,
  }];
}
```

**Tool 2: `get_doc_health`**

```typescript
{
  name: "get_doc_health",
  description: "Check the freshness/accuracy status of a specific documentation file or the entire repo. Use this before relying on documentation that might be outdated.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to a doc file (e.g., 'README.md') or directory (e.g., 'docs/'). Omit for repo-wide health."
      }
    }
  }
}

// Handler:
async function handleGetDocHealth(params: { path?: string }): Promise<HealthReport> {
  if (params.path) {
    return calculateFileHealth(params.path);
  }
  return calculateRepoHealth();
}
```

**Tool 3: `report_drift`**

```typescript
{
  name: "report_drift",
  description: "Report a suspected documentation inaccuracy you discovered while working with the code. This helps keep documentation fresh.",
  inputSchema: {
    type: "object",
    properties: {
      doc_file: {
        type: "string",
        description: "The documentation file containing the inaccurate claim"
      },
      line_number: {
        type: "number",
        description: "Approximate line number of the claim"
      },
      claim_text: {
        type: "string",
        description: "The text of the inaccurate claim"
      },
      actual_behavior: {
        type: "string",
        description: "What the code actually does (your evidence)"
      },
      evidence_files: {
        type: "array",
        items: { type: "string" },
        description: "Code files that show the actual behavior"
      }
    },
    required: ["doc_file", "claim_text", "actual_behavior"]
  }
}

// Handler:
async function handleReportDrift(params: DriftReport): Promise<void> {
  // 1. Find or create the claim record
  // 2. Record the agent's report as evidence
  // 3. Queue re-verification with the agent's evidence
  // 4. Return acknowledgment
}
```

**Tool 4: `list_stale_docs`**

```typescript
{
  name: "list_stale_docs",
  description: "List documentation files that have known inaccuracies or haven't been verified recently. Useful before starting work to know which docs to be cautious about.",
  inputSchema: {
    type: "object",
    properties: {
      max_results: {
        type: "number",
        description: "Maximum number of results to return. Default: 10.",
        default: 10
      }
    }
  }
}
```

**MCP server architecture diagrams:**

Local mode:
```
Agent --MCP--> docalign MCP server (local process)
                    |
                    +-- reads .docalign/claims.db (SQLite)
                    +-- reads repo files directly
                    +-- writes drift reports to .docalign/reports/
```

Remote mode:
```
Agent --MCP--> docalign MCP server (local process)
                    |
                    +-- API calls to api.docalign.dev
                         |
                         +-- reads/writes PostgreSQL (hosted)
```

### 3.8 Layer 7: Learning

**FeedbackRecord interface:**

```typescript
interface FeedbackRecord {
  id: string;
  repo_id: string;
  claim_id: string;
  verification_result_id: string;
  feedback_type: 'thumbs_up' | 'thumbs_down' | 'fix_accepted' | 'fix_dismissed' | 'all_dismissed';
  timestamp: Date;
}
```

**Co-change tracking:**

```typescript
// On each push to default branch:
async function recordCoChanges(commits: Commit[]) {
  for (const commit of commits) {
    const codeFiles = commit.files.filter(f => !isDocFile(f));
    const docFiles = commit.files.filter(f => isDocFile(f));

    if (codeFiles.length > 0 && docFiles.length > 0) {
      // Record co-change: these code files and doc files were changed together
      for (const code of codeFiles) {
        for (const doc of docFiles) {
          await coChangeStore.record(repoId, code, doc, commit.sha, commit.date);
        }
      }
    }
  }
}

// When mapping claims to code (Layer 2), boost confidence for pairs
// that have co-change history
async function boostByCoChange(mapping: Mapping): Promise<number> {
  const coChangeCount = await coChangeStore.getCount(
    mapping.repo_id,
    mapping.code_file,
    mapping.claim.source_file
  );

  // More co-changes = higher mapping confidence
  // 0 co-changes: no boost
  // 5+ co-changes: +0.1 confidence boost
  return Math.min(coChangeCount * 0.02, 0.1);
}
```

**Confidence decay:**

```typescript
function getEffectiveConfidence(result: VerificationResult): number {
  const daysSinceVerification = daysBetween(result.verified_at, now());
  const decayFactor = Math.exp(-daysSinceVerification * Math.LN2 / 180); // 180-day half-life (50% at 180 days)
  return result.confidence * decayFactor;
}
```

**Learning generalization placeholder approaches:**

Option A: Rule-based suppression
```
- Same claim dismissed 2+ times -> suppress that claim
- Same file's claims dismissed >50% -> suppress all claims in that file
- Same claim_type dismissed >50% -> suppress that claim_type for this repo
```

Option B: Embedding-based similarity
```
- Embed the dismissed finding (claim + evidence + mismatch)
- On future findings, check cosine similarity with dismissed findings
- If similarity > 0.85 -> suppress
```

Option C: LLM-based generalization
```
- When a finding is dismissed, ask an LLM:
  "The developer dismissed this finding. What general rule should we learn?"
  - "Don't flag bcrypt->argon2 migration in this repo"
  - "Don't flag convention claims in this repo"
  - "This specific claim is known-outdated, suppress until doc is updated"
- Store the learned rule as natural language
- On future findings, ask: "Does this finding match any suppression rule?"
```

---

## 4. Database Schema

### 4.1 Table: `repos`

```sql
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_installation_id BIGINT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  last_indexed_commit TEXT,            -- SHA of last indexed commit
  last_full_scan_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',           -- repo-specific settings
  health_score REAL,                   -- cached overall health score
  total_claims INT DEFAULT 0,
  verified_claims INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(github_owner, github_repo)
);
```

### 4.2 Table: `code_entities`

```sql
CREATE TABLE code_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  line_number INT NOT NULL,
  entity_type TEXT NOT NULL,   -- 'function' | 'class' | 'route' | 'type' | 'config'
  name TEXT NOT NULL,
  signature TEXT,              -- human-readable signature
  raw_code TEXT,               -- source code (for verification context)
  embedding VECTOR(1536),      -- pgvector
  last_commit_sha TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_entities_repo_file ON code_entities(repo_id, file_path);
CREATE INDEX idx_entities_repo_name ON code_entities(repo_id, name);
-- Use HNSW indexes for vector similarity search (no minimum row count requirement, better recall than IVFFlat)
CREATE INDEX idx_entities_embedding ON code_entities USING hnsw (embedding vector_cosine_ops);
```

### 4.3 Table: `claims`

```sql
CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,          -- which doc file
  line_number INT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL,           -- enum from 4.3
  testability TEXT NOT NULL,          -- 'syntactic' | 'semantic' | 'untestable'
  extracted_value JSONB,              -- structured data (path, command, version, etc.)
  keywords TEXT[],                    -- for search
  extraction_confidence REAL NOT NULL DEFAULT 1.0,
  extraction_method TEXT NOT NULL,    -- 'regex' | 'heuristic' | 'llm'
  verification_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'verified' | 'drifted' | 'uncertain'
  last_verified_at TIMESTAMPTZ,
  embedding VECTOR(1536),
  last_verification_result_id UUID REFERENCES verification_results(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_claims_repo ON claims(repo_id);
CREATE INDEX idx_claims_repo_file ON claims(repo_id, source_file);
CREATE INDEX idx_claims_repo_status ON claims(repo_id, verification_status);
-- Use HNSW indexes for vector similarity search (no minimum row count requirement, better recall than IVFFlat)
CREATE INDEX idx_claims_embedding ON claims USING hnsw (embedding vector_cosine_ops);
```

### 4.3.1 `extracted_value` JSONB Schema Per Claim Type

```
extracted_value JSONB schema per claim_type:
- path_reference: { path: string }
- command: { runner: string, script: string } (e.g., { runner: "npm", script: "test" })
- dependency_version: { package: string, version: string }
- api_route: { method: string, path: string }
- config_value: { key: string, value: string }
- behavior: { description: string }
- architecture: { description: string }
- code_example: { language: string | null, imports: string[], symbols: string[], commands: string[] }
```

### 4.4 Table: `claim_mappings`

```sql
CREATE TABLE claim_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  code_file TEXT NOT NULL,
  code_entity_id UUID REFERENCES code_entities(id) ON DELETE SET NULL,
  confidence REAL NOT NULL,
  mapping_method TEXT NOT NULL,        -- 'direct_reference' | 'symbol_search' | 'semantic_search' | 'llm_assisted' | 'manual' | 'co_change'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Critical reverse index: given a code file, which claims map to it?
CREATE INDEX idx_mappings_repo_codefile ON claim_mappings(repo_id, code_file);
CREATE INDEX idx_mappings_claim ON claim_mappings(claim_id);
```

### 4.5 Table: `verification_results`

```sql
CREATE TABLE verification_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  scan_run_id UUID REFERENCES scan_runs(id),
  verdict TEXT NOT NULL,                -- 'verified' | 'drifted' | 'uncertain'
  confidence REAL NOT NULL,
  tier INT NOT NULL,                    -- 1-5
  severity TEXT,                        -- 'high' | 'medium' | 'low'
  reasoning TEXT,
  specific_mismatch TEXT,
  suggested_fix TEXT,
  evidence_files TEXT[],
  token_cost INT,
  duration_ms INT,
  post_check_result TEXT,               -- 'confirmed' | 'contradicted' | 'skipped'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_results_claim ON verification_results(claim_id);
CREATE INDEX idx_results_scan ON verification_results(scan_run_id);
```

### 4.6 Table: `feedback`

```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  verification_result_id UUID REFERENCES verification_results(id),
  feedback_type TEXT NOT NULL,          -- 'thumbs_up' | 'thumbs_down' | 'fix_accepted' | 'fix_dismissed' | 'all_dismissed'
  github_user TEXT,                     -- who gave feedback
  pr_number INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_claim ON feedback(claim_id);
CREATE INDEX idx_feedback_repo ON feedback(repo_id);
```

### 4.7 Table: `co_changes`

```sql
CREATE TABLE co_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  code_file TEXT NOT NULL,
  doc_file TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cochanges_repo_code ON co_changes(repo_id, code_file);
CREATE INDEX idx_cochanges_repo_doc ON co_changes(repo_id, doc_file);
```

### 4.8 Table: `scan_runs`

```sql
CREATE TABLE scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,           -- 'pr' | 'push' | 'scheduled' | 'manual' | 'agent_report'
  trigger_ref TEXT,                     -- PR number, commit SHA, etc.
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  claims_checked INT DEFAULT 0,
  claims_drifted INT DEFAULT 0,
  claims_verified INT DEFAULT 0,
  claims_uncertain INT DEFAULT 0,
  total_token_cost INT DEFAULT 0,
  total_duration_ms INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_scan_runs_repo ON scan_runs(repo_id);
```

### 4.8.1 Database Migration Dependency Order

Database migration dependency order: repos -> scan_runs -> code_entities -> claims -> claim_mappings -> verification_results -> feedback -> co_changes -> agent_drift_reports.

### 4.9 Table: `agent_drift_reports`

```sql
CREATE TABLE agent_drift_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES claims(id),  -- nullable: report may not match existing claim
  doc_file TEXT NOT NULL,
  line_number INT,
  claim_text TEXT NOT NULL,
  actual_behavior TEXT NOT NULL,
  evidence_files TEXT[],
  agent_type TEXT,                       -- 'claude_code' | 'cursor' | 'copilot' | 'unknown'
  verification_status TEXT DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'rejected'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Regex Patterns for Syntactic Extraction

### 5.1 File Path References

```typescript
// Patterns to match:
// - Inline code: `src/auth/handler.ts`
// - Links: [handler](src/auth/handler.ts)
// - Plain text: see src/auth/handler.ts
// - Markdown links: [auth module](./src/auth/)

const FILE_PATH_PATTERNS = [
  /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g,                    // `path/to/file.ext`
  /\[.*?\]\(\.?\/?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\)/g,     // [text](path/to/file)
  /(?:see|in|at|from|file)\s+[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/gi,  // see path/to/file
];

// Filter: must look like a real path (has directory separator or known extension)
// Exclude from path extraction results: URLs (contains `://`), image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`), self-references (path matches the current doc file), anchor-only links (starts with `#`), common non-code assets (`.css`, `.scss`, `.less`)
```

### 5.2 CLI Commands

```typescript
// Match commands in:
// - Code blocks: ```bash\npnpm test:unit\n```
// - Inline code: `npm run build`
// - Text: run `pnpm dev`

const COMMAND_PATTERNS = [
  // Code block commands
  /```(?:bash|sh|shell|zsh|console)?\n((?:.*\n)*?)```/g,
  // Inline commands with known prefixes
  /`((?:npm|npx|yarn|pnpm|pip|cargo|go|make|docker|kubectl)\s+[^`]+)`/g,
  // "run X" patterns
  /(?:run|execute|use)\s+`([^`]+)`/gi,
];

// Extract individual commands from multi-line code blocks
// Identify the command runner (npm, pnpm, cargo, etc.)
// Extract the script/target name

// Within captured code blocks, lines starting with `$` or `>` are treated as commands (strip the prompt prefix).
// Lines without a prompt prefix in blocks with prompt-prefixed lines are treated as output and skipped.
// In blocks with NO prompt prefixes, treat all non-empty, non-comment lines as commands.
```

### 5.3 Dependency References

```typescript
// Match:
// - "React 18.2" / "React v18" / "React ^18.0.0"
// - "uses Express.js" / "built with Fastify"
// - "requires Node.js 18+"

// Known package name list (top 5000 npm, pip, cargo packages)
// Or: match any word followed by version-like pattern

const VERSION_PATTERNS = [
  /(\w+(?:\.\w+)?)\s+v?(\d+\.\d+(?:\.\d+)?)/gi,         // "React 18.2.0"
  /(\w+(?:\.\w+)?)\s+(?:version\s+)?[v^~]?(\d+[\d.]*)/gi, // "Express version 4"
  /(?:uses?|built\s+with|requires?|depends\s+on)\s+(\w+(?:\.\w+)?(?:\.js)?)/gi, // "uses Express.js"
  /(?:Node\.?js|Python|Ruby|Go|Rust|Java)\s+(\d+[\d.+]*)/gi, // "Node.js 18+"
];
```

### 5.4 API Route References

```typescript
// Match:
// - "GET /api/v2/users"
// - "POST /users/:id"
// - "`DELETE /api/items/{itemId}`"

const ROUTE_PATTERNS = [
  /(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+[`"]?(\/[a-zA-Z0-9_\-/:{}.*]+)/gi,
];
```

### 5.5 Code Example Blocks

```typescript
// Match fenced code blocks with language identifiers
// These contain code that should (ideally) match reality

// ```typescript
// import { AuthService } from './auth';
// const result = await AuthService.login(email, password);
// ```

// Extract: import paths, function calls, class names, variable names
// These become individual claims of type 'code_example'
```

---

## 6. tree-sitter Query Patterns

### 6.0 Route Framework Support

MVP supports 6 frameworks for API route extraction:
- **TypeScript/JavaScript:** Express, Fastify, Koa
- **Python:** Flask, FastAPI, Django

tree-sitter queries must be provided for all 6 frameworks. Currently only Express-style queries exist (Section 6.1). Queries for the remaining 5 frameworks are marked with a warning below.

### 6.1 TypeScript Example Queries

```scheme
;; Exported function declarations
(export_statement
  declaration: (function_declaration
    name: (identifier) @function.name
    parameters: (formal_parameters) @function.params
    return_type: (type_annotation)? @function.return_type
  )
) @function.export

;; Express/Fastify route definitions
(call_expression
  function: (member_expression
    object: (identifier) @router
    property: (property_identifier) @method
  )
  arguments: (arguments
    (string) @route.path
  )
) @route.definition
```

### 6.1.1 Fastify Route Queries

> **TODO:** tree-sitter queries for Fastify route definitions (e.g., `fastify.get('/path', handler)`). Not yet written.

### 6.1.2 Koa Route Queries

> **TODO:** tree-sitter queries for Koa route definitions (e.g., `router.get('/path', handler)`). Not yet written.

### 6.1.3 Flask Route Queries (Python)

> **TODO:** tree-sitter queries for Flask route definitions (e.g., `@app.route('/path', methods=['GET'])`). Not yet written.

### 6.1.4 FastAPI Route Queries (Python)

> **TODO:** tree-sitter queries for FastAPI route definitions (e.g., `@app.get('/path')`). Not yet written.

### 6.1.5 Django Route Queries (Python)

> **TODO:** tree-sitter queries for Django URL patterns (e.g., `path('api/users/', views.user_list)`). Not yet written.

### 6.2 Languages to Support

| Language | tree-sitter Grammar | Key Queries | Phase |
|----------|-------------------|-------------|-------|
| TypeScript/JavaScript | tree-sitter-typescript | export_statement, function_declaration, class_declaration, call_expression (route definitions) | MVP |
| Python | tree-sitter-python | function_definition, class_definition, decorated_definition (Flask/FastAPI routes) | MVP |
| Go | tree-sitter-go | function_declaration, method_declaration, type_declaration | v2 |
| Rust | tree-sitter-rust | function_item, impl_item, struct_item | v2 |
| Java | tree-sitter-java | method_declaration, class_declaration, annotation (Spring routes) | v3 |

---

## 7. LLM Prompt Templates

### 7.0 LLM Prompt Parameters

All LLM prompts use: temperature=0, response_format={ type: 'json_schema', ... } with a defined schema. Max tokens: extraction=2000, triage=100, verification=1000, fix_generation=500.

### 7.1 Claim Extraction Prompt (P-EXTRACT)

```
You are a documentation analyzer. Given a section of documentation from a software project, extract every factual claim about the codebase that could be verified by examining the code.

Rules:
- ONLY extract claims about what the code IS or DOES, not aspirational/planned statements
- ONLY extract claims that reference specific code constructs (functions, modules, services, patterns, data flows)
- DO NOT extract style preferences, opinions, or generic programming advice
- DO NOT extract claims that are already covered by file path, command, version, or API route references (those are handled separately)
- Each claim should be independently verifiable

For each claim, provide:
- claim_text: the exact sentence or phrase making the claim
- claim_type: "behavior" | "architecture" | "config" | "convention" | "environment"
- keywords: 2-5 code-relevant keywords for mapping to source code
- confidence: 0.0-1.0 how confident you are this is a verifiable factual claim

Documentation section:
---
{section_text}
---

Respond as a JSON array of claims. If no verifiable claims exist, return [].
```

### 7.2 Triage Prompt (P-TRIAGE)

```
You are a documentation accuracy triage classifier. Given a documentation claim and the relevant source code, quickly classify whether the claim needs deeper analysis.

<claim file="{source_file}" line="{line_number}">
{claim_text}
</claim>

<code file="{code_file}">
{code_snippet}
</code>

Classify as exactly one of:
A) ACCURATE - The claim clearly matches the code. No issues visible.
B) DRIFTED - The claim clearly contradicts the code. Obvious mismatch.
C) UNCERTAIN - Cannot determine from this evidence alone. Needs deeper analysis.

Respond with ONLY the letter (A, B, or C) and a single sentence explanation.
```

### 7.3 Verification Prompt (P-VERIFY)

```
You are a documentation accuracy verifier. Compare this documentation claim against the actual source code and determine if the claim is still accurate.

<claim file="{source_file}" line="{line_number}" type="{claim_type}">
{claim_text}
</claim>

<evidence>
{for each mapped code file/entity:}
<code file="{code_file}" lines="{start}-{end}">
{relevant_code}
</code>
{end for}
</evidence>

Instructions:
- Focus on FACTUAL accuracy, not style or completeness
- The claim does not need to describe everything -- it just needs to be correct about what it DOES describe
- Consider that the documentation may use simplified language -- minor simplifications are acceptable
- If the claim is partially accurate (some parts true, some false), classify as DRIFTED
- If you cannot determine accuracy from the evidence provided, classify as UNCERTAIN

Respond in JSON:
{
  "verdict": "verified" | "drifted" | "uncertain",
  "severity": "high" | "medium" | "low",
  "reasoning": "1-2 sentence explanation",
  "specific_mismatch": "what exactly is wrong (null if verified)",
  "suggested_fix": "corrected claim text (null if verified or uncertain)"
}
```

### 7.4 Post-Check Prompt (P-POSTCHECK)

```
You found that this claim is drifted:
Claim: "${claim.claim_text}"
Mismatch: "${tier4Result.specific_mismatch}"

Generate a shell command (grep, find, or similar) that would CONFIRM this finding.
The command should return non-empty output if the finding is correct.

Examples:
- If the claim says "uses bcrypt" but code uses argon2:
  grep -r "bcrypt" src/ (should return empty, confirming bcrypt is not used)
- If the claim says file "config/default.yaml" exists:
  ls config/default.yaml (should fail if file doesn't exist)

Return ONLY the shell command, nothing else.
If no simple verification command exists, return "SKIP".
```

---

## 8. Infrastructure Details

### 8.1 Processing Architecture

```
GitHub Webhook --> API Server (Railway/Fly) --> Job Queue (BullMQ/Redis)
                        |                              |
                        |                              v
                        |                     Worker Process
                        |                         |
                        v                         v
                   PostgreSQL              LLM APIs (OpenAI, Anthropic)
                   (Supabase)
```

**Why a job queue:**
- Webhooks must respond within 10 seconds (GitHub timeout)
- Verification can take 1-5 minutes
- Queue handles retries, rate limiting, and concurrent processing

### 8.2 Worker Job Types

```typescript
// Worker handles these job types:
type JobType =
  | 'index_update'        // Update codebase index for changed files
  | 'claim_extraction'    // Extract claims from doc files
  | 'claim_mapping'       // Map claims to code
  | 'verification'        // Verify claims
  | 'pr_comment'          // Post results to PR
  | 'full_scan'           // Scheduled full repo scan
  | 'drift_report'        // Process agent drift report
  ;

// Concurrency: 5 jobs at a time (limited by LLM rate limits)
// Retry: 3 attempts with exponential backoff
// Timeout: 10 minutes per job
```

### 8.3 File Access Strategy

The worker needs to read repo files. Two approaches:

**Option A: GitHub API (REST/GraphQL)**
- Read files via `GET /repos/{owner}/{repo}/contents/{path}`
- Pro: no local clone needed
- Con: rate limited (5,000 requests/hour), slow for many files

**Option B: Shallow clone**
- `git clone --depth 1` into a temp directory
- Pro: fast file access, no rate limits
- Con: disk usage, clone time

**Decision:** Option B for full scans (need many files). Option A for PR-triggered checks (need only a few files). Hybrid approach.

### 8.4 MCP Server Architecture (Local vs Remote)

**Local mode:**
- SQLite file in `.docalign/` directory within the repo
- Pro: works offline, fast
- Con: stale if not synced

**Remote mode:**
- API calls to hosted DocAlign service
- For repos with GitHub App installed

**Option A: SQLite file in repo**
- `.docalign/claims.db` committed to repo (or gitignored and synced separately)
- Pro: works offline, fast
- Con: stale if not synced

**Option B: Generated on demand**
- `docalign scan` generates the local DB
- MCP server reads from it
- Pro: always fresh when regenerated
- Con: requires running scan first

**Decision deferred to implementation. MVP uses Option B (user runs `docalign scan` first, MCP reads the output).**

### 8.5 Scaling Considerations (Not MVP)

- **Multi-worker:** Run multiple worker processes for parallel repo processing
- **Caching:** Cache embeddings, claim extractions, and mappings in Redis for repeat checks
- **CDN for MCP:** If MCP server queries hit the hosted API, cache doc health data at the edge

---

## 9. Configuration File Schema

Full `.docalign.yml` configuration format:

```yaml
# .docalign.yml

# Which documentation files to scan (overrides defaults)
doc_patterns:
  include:
    - "README.md"
    - "docs/**/*.md"
    - "CLAUDE.md"
    - "**/AGENTS.md"
  exclude:
    - "docs/changelog.md"
    - "docs/archive/**"

# Which code files to index (overrides defaults)
code_patterns:
  include:
    - "src/**"
    - "lib/**"
  exclude:
    - "src/**/*.test.ts"
    - "src/**/*.spec.ts"

# Verification settings
verification:
  # Minimum severity to report in PR comments
  min_severity: "medium"    # "high" | "medium" | "low"

  # Maximum claims to check per PR (cost control)
  max_claims_per_pr: 50

  # Auto-fix: commit fixes directly to PR branch
  auto_fix: false

  # Auto-fix confidence threshold (only fix above this confidence)
  auto_fix_threshold: 0.9

# Claim types to check (disable specific types)
claim_types:
  path_reference: true
  dependency_version: true
  command: true
  api_route: true
  code_example: true
  behavior: true
  architecture: false       # disable architecture claims (too noisy)
  config: true
  convention: false          # disable convention claims

# Custom claim suppressions
suppress:
  - file: "README.md"
    pattern: "badge"        # don't check badge URLs
  - claim_type: "dependency_version"
    package: "typescript"   # don't check TS version claims (changes too often)

# Scheduling
schedule:
  full_scan: "weekly"       # "daily" | "weekly" | "monthly" | "never"
  full_scan_day: "sunday"
```
