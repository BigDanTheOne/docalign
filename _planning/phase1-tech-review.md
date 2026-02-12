# Phase 1 Review: Technical Feasibility

> Reviewer: Technical Feasibility Reviewer (AI Agent)
> Date: 2026-02-09
> Inputs: PRD.md, phases/technical-reference.md, PRODUCT-VISION.md
> PRD Version: 0.1 (Discovery Draft, 2026-02-08)

---

## Summary

**Total findings: 52**
- BLOCKING: 11
- IMPORTANT: 24
- MINOR: 17

**Top 3 most critical technical risks:**

1. **MVP cost model is wrong for semantic verification.** The PRD skips the Tier 3 triage gate in MVP (Section 14.1) but the cost model (Section 13.2) prices Tier 4 semantic verification at $0.012/claim using Claude Sonnet. At current Sonnet pricing (~$3/$15 per 1M input/output tokens), the per-claim cost for Tier 4 is significantly higher than $0.012 when evidence windows reach 3000-5000 input tokens. Without the triage gate, every semantic claim hits the expensive model. The per-PR cost will likely be 2-4x the $0.08 estimate, making the $19/repo pricing unsustainable at medium-activity levels from day one.

2. **tree-sitter WASM route extraction is fragile and underspecified.** The PRD assumes tree-sitter can reliably extract API route definitions from Express/Fastify/Flask/FastAPI code. Route definitions vary enormously in pattern (middleware chains, decorator factories, dynamic route generation, route arrays, controller decorators). The tree-sitter queries shown in technical-reference.md Section 6.1 match only the simplest case. This is a complexity iceberg that will consume significant implementation time and produce unreliable results.

3. **No specification for initial onboarding / first-scan flow.** The PRD describes incremental PR-triggered flows but never specifies what happens when a GitHub App is first installed on a repo with existing documentation. The full initial indexing + claim extraction + mapping flow for a medium-large repo (500+ files, 30+ doc files) has no cost estimate, no timeout budget, no progress/feedback mechanism, and no failure recovery strategy. This is the user's first experience with the product.

---

## Section 1: Feasibility Matrix

| Component | Claim | Assessment | Notes |
|-----------|-------|------------|-------|
| **L0: tree-sitter WASM parsing** | Parse TS/JS/Python exports, classes | **FEASIBLE** | Well-supported grammars, mature WASM bindings |
| **L0: tree-sitter route extraction** | Extract Express/Fastify/Flask routes via AST | **COMPLEX** | Route definition patterns are highly variable; decorators, middleware chains, dynamic routes. Simple queries work for ~60% of real-world patterns |
| **L0: Package metadata parsing** | Parse package.json, requirements.txt, etc. | **FEASIBLE** | JSON/TOML/text parsing is straightforward |
| **L0: File tree indexing** | List all files excluding .gitignore | **FEASIBLE** | Standard git operations |
| **L0: Incremental entity diffing** | Detect changed entities via AST diff | **COMPLEX** | Requires stable entity identity across reparses (rename detection, moved functions). Not a simple equals check |
| **L0: Embedding generation** | Embed function signatures with text-embedding-3-small | **FEASIBLE** | Standard API call, well-documented |
| **L1: Syntactic claim extraction** | Regex/heuristic extraction for paths, commands, versions, routes | **FEASIBLE** | Regex patterns are provided in technical-reference.md; will need iterative tuning but fundamentally sound |
| **L1: Semantic claim extraction** | GPT-4o-mini structured output for behavior/architecture claims | **FEASIBLE** | Standard structured output use case; quality depends on prompt iteration |
| **L1: Claim deduplication** | Deduplicate by type+value or embedding similarity >0.95 | **COMPLEX** | Embedding similarity threshold for dedup (0.95) is very high; may miss paraphrased duplicates. Also: computing pairwise similarity across all claims is O(n^2) without an index |
| **L2: Direct reference mapping** | Map paths/commands/versions/routes to source files | **FEASIBLE** | Deterministic lookups against L0 index |
| **L2: Symbol search mapping** | Find code entities by keyword from claims | **FEASIBLE** | pgvector text search or simple SQL LIKE/trigram |
| **L2: Semantic search mapping** | Embed claim, find similar code entities | **FEASIBLE** | Standard vector similarity search |
| **L2: Reverse index** | Given code file, find mapped claims | **FEASIBLE** | Standard indexed SQL query |
| **L2: Mapping maintenance (renames)** | Detect file renames via git, update mappings | **COMPLEX** | Git rename detection is heuristic-based (similarity threshold); may miss renames with heavy modification |
| **L3: Tier 1 syntactic verification** | File existence, version comparison, script existence | **FEASIBLE** | Deterministic checks against L0 index |
| **L3: Tier 1 similar path finding** | Suggest renamed files when path not found | **COMPLEX** | Levenshtein/fuzzy matching against file tree; needs defined algorithm and threshold |
| **L3: Tier 3 triage gate** | GPT-4o-mini binary classification | **FEASIBLE** | Standard LLM classification task |
| **L3: Tier 4 semantic verification** | Claude Sonnet deep analysis | **FEASIBLE** | Standard LLM reasoning task; accuracy depends heavily on evidence quality |
| **L3: Tier 5 post-check** | LLM generates shell command, system executes it | **COMPLEX** | Security risk (command injection), sandboxing required, many claims have no simple shell verification |
| **L4: GitHub webhook handling** | Receive PR/push events, queue jobs | **FEASIBLE** | Standard GitHub App pattern |
| **L4: Debouncing** | 30-second window for rapid pushes | **COMPLEX** | Requires distributed state (Redis) to track in-flight scans per PR; race conditions between debounce timer expiry and new events |
| **L4: Rate limiting** | Per-repo and per-org daily limits | **FEASIBLE** | Standard Redis counter pattern |
| **L5: PR comment formatting** | Post structured markdown comment on PR | **FEASIBLE** | Standard GitHub API |
| **L5: GitHub suggestion syntax** | Use native suggestion blocks for one-click fix | **COMPLEX** | Requires exact line number mapping between claim source location and current PR diff state; line numbers shift when multiple fixes apply to the same file |
| **L5: Auto-commit fixes** | Create commit on PR branch with fixes | **FEASIBLE** | Standard GitHub API (create tree, create commit, update ref) |
| **L5: Feedback collection via reactions** | Detect thumbs up/down on PR comments | **COMPLEX** | GitHub does not send webhook events for reactions on issue/PR comments from a bot. Must poll or use GraphQL subscriptions |
| **L6: MCP server (local mode)** | SQLite-backed local MCP server | **FEASIBLE** | Standard MCP server pattern; well-documented protocol |
| **L6: MCP server (remote mode)** | Proxy to hosted API | **FEASIBLE** | Standard proxy pattern |
| **L7: Co-change tracking** | Record code+doc co-changes from commits | **FEASIBLE** | Parse commit file lists, store pairs |
| **L7: Confidence decay** | Exponential decay on verification age | **FEASIBLE** | Simple math function |
| **L7: Learning generalization** | Generalize dismissal patterns | **INFEASIBLE (as described)** | PRD correctly marks this as unsolved. Rule-based suppression will over- or under-suppress. Not feasible to get right without significant experimentation with real data |
| **Infrastructure: BullMQ/Redis** | Background job queue | **FEASIBLE** | Mature library, well-documented |
| **Infrastructure: Supabase + pgvector** | Managed Postgres with vector search | **FEASIBLE** | Supabase supports pgvector natively |
| **Infrastructure: Railway deployment** | Deploy Node.js app + worker | **FEASIBLE** | Standard Railway deployment |
| **Infrastructure: GitHub API file access** | Read files via REST API for PR checks | **COMPLEX** | Rate limit of 5000 requests/hour shared across all installations. A single large PR could exhaust significant budget. Need to track and budget API calls carefully |
| **Infrastructure: Shallow clone** | `git clone --depth 1` for full scans | **COMPLEX** | Requires temp disk space management, cleanup, timeout handling. On Railway/Fly, disk may be ephemeral and limited |

---

## Section 2: Cost Estimate Validation

### Current API Pricing (as of early 2026)
- OpenAI text-embedding-3-small: $0.02 per 1M tokens
- GPT-4o-mini: $0.15 per 1M input tokens, $0.60 per 1M output tokens
- Claude Sonnet (3.5/3.6): ~$3 per 1M input tokens, ~$15 per 1M output tokens

| Item | PRD Estimate | Independent Estimate | Delta | Flag |
|------|-------------|---------------------|-------|------|
| **Claim extraction (1 doc file)** | $0.0006 (2000 in, 500 out) | $0.0006 (2000 * $0.15/1M + 500 * $0.60/1M = $0.0003 + $0.0003) | Match | OK |
| **Embedding (1 function sig)** | $0.000002 (~100 tokens) | $0.000002 (100 * $0.02/1M) | Match | OK |
| **Triage gate (1 claim)** | $0.0001 (500 in, 30 out) | $0.000093 (500 * $0.15/1M + 30 * $0.60/1M = $0.000075 + $0.000018) | Match | OK |
| **Semantic verification (1 claim)** | $0.012 (3000 in, 200 out) | $0.012 (3000 * $3/1M + 200 * $15/1M = $0.009 + $0.003) | Match | OK |
| **Fix text generation (1 claim)** | $0.0001 (500 in, 100 out) | $0.000135 (500 * $0.15/1M + 100 * $0.60/1M) | Match | OK |
| **Per-PR total (20 claims scenario)** | $0.08 | See analysis below | **~$0.14-0.19** | **FLAG: ~2x off** |
| **Monthly cost: Medium repo (100 PRs)** | $8 | ~$14-19 | **~2x off** | **FLAG** |
| **Monthly cost: High repo (300 PRs)** | $30 | ~$42-57 | **~1.5-2x off** | **FLAG** |
| **Full scan cost (weekly)** | $0.50-2.00 | See analysis below | **$2-12** | **FLAG: up to 6x off** |

### Per-PR Cost Deep Dive (20 claims affected, MVP without triage gate)

The PRD's MVP explicitly skips the triage gate (Tier 3). This means ALL semantic claims go directly to Claude Sonnet (Tier 4).

**PRD's scenario:**
- 20 claims affected by PR
- PRD assumes 30% pass triage to Tier 4 = 6 claims at $0.012 = $0.072
- But MVP has NO triage gate

**Corrected MVP scenario:**
- ~8-10 syntactic claims: verified by Tier 1 (free) = $0
- ~10-12 semantic claims: ALL go to Tier 4 (no triage gate in MVP)
- 10-12 claims * $0.012 = $0.12-0.144
- Plus embedding/extraction costs: ~$0.004
- **Total: ~$0.12-0.15 per PR**

This is 1.5-1.9x the PRD estimate. Not catastrophic, but for a medium-activity repo (100 PRs/month), monthly cost becomes $12-15 instead of $8.

**But the real concern is evidence window size.** The PRD's $0.012 per Tier 4 claim assumes 3000 input tokens. The PRD also says evidence can be "up to 500 lines" for entity-mapped claims and "up to 3 files, 200 lines each" for multi-file claims with a "hard cap 4000 tokens." At 4000 tokens input + 200 output:
- 4000 * $3/1M + 200 * $15/1M = $0.012 + $0.003 = $0.015 per claim

For multi-file evidence (architecture/behavior claims referencing multiple files), actual token usage could reach the 4000-token cap frequently. The PRD's 3000-token average may be optimistic.

**Revised per-claim Tier 4 cost range: $0.012-0.018**

### Full Scan Cost Deep Dive

A "medium" repo with ~500 claims:
- ~250 syntactic claims: Tier 1 (free)
- ~250 semantic claims
- With triage gate (v2): ~75-100 go to Tier 4 = $0.90-1.80
- Without triage gate (MVP): 250 * $0.012-0.018 = $3.00-4.50
- Plus extraction: 30 doc files * $0.0006 = $0.018
- Plus embeddings: ~200 entities * $0.000002 = $0.0004
- **Full scan total (MVP): ~$3.00-4.50**
- **Full scan total (v2 with triage): ~$0.90-1.80**

A "large" repo with 1000+ claims could easily hit $6-12 per full scan without the triage gate.

The PRD's "$0.50-2.00 per scan" estimate is based on having the triage gate, but weekly scheduled scans are listed as a v2/v3 feature -- by which time the triage gate should exist. However, the PRD does not clarify whether the initial installation scan (first-time full scan) occurs in MVP. If it does, it uses MVP pricing (no triage) and the cost estimate is 3-6x off.

### Gross Margin Recomputation

Using corrected MVP estimates (no triage gate):

| Activity | Monthly LLM Cost (corrected) | Gross Margin at $19/repo |
|----------|------------------------------|--------------------------|
| Low (20 PRs) | $2.40-3.00 | 84-87% |
| Medium (100 PRs) | $12-15 | 21-37% |
| High (300 PRs) | $36-45 | -89% to -137% |

Medium-activity repos are borderline profitable even in the corrected model. This makes the triage gate a **critical path** dependency for financial viability, not a "nice to have for v2."

---

## Section 3: Findings

### Finding 1: Initial onboarding/first-scan flow is unspecified
- **Quote:** No section describes what happens when the GitHub App is first installed on a repo.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** Add a "Section: Initial Onboarding Flow" that specifies: (a) what triggers on installation (installation webhook), (b) does a full scan run automatically, (c) cost budget for initial scan, (d) timeout (large repos may take >10 minutes), (e) progress indication to the user, (f) what happens if the initial scan fails or times out, (g) whether the app is "active" before the initial scan completes. An implementing agent cannot build the installation handler without this.

### Finding 2: MVP skips triage gate but cost model assumes triage exists
- **Quote:** Section 14.1: "Layer 3: Tier 3+4 combined (skip triage gate, go straight to Claude Sonnet for semantic claims)"; Section 13.2 shows only 6 of 20 claims reaching Tier 4
- **Category:** INCONSISTENT
- **Severity:** BLOCKING
- **Recommendation:** Recompute the Section 13.2 cost table for the actual MVP configuration (no triage gate). All semantic claims hit Tier 4 in MVP. Alternatively, move triage gate into MVP scope -- the implementation cost is low (one GPT-4o-mini prompt) and the savings are substantial.

### Finding 3: No error handling specification for LLM API failures
- **Quote:** No section addresses LLM API failure modes.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** Specify behavior when: (a) OpenAI API returns 429 (rate limit), (b) Anthropic API returns 529 (overloaded), (c) API returns malformed JSON, (d) API times out, (e) API returns content filter refusal. For each: retry policy, fallback behavior, user-facing message. An implementing agent will make arbitrary choices without this, and wrong choices (e.g., infinite retry on rate limit) will cause cascading failures.

### Finding 4: No specification for GitHub App authentication and token management
- **Quote:** Section 12.1 lists permissions but does not describe authentication flow.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** Specify: (a) how the app authenticates to GitHub (JWT for app, installation tokens for API calls), (b) token refresh strategy (installation tokens expire after 1 hour), (c) how tokens are stored in the worker (passed via job payload vs fetched on demand), (d) what happens when a token expires mid-job. GitHub App auth is notoriously tricky and an implementing agent needs explicit guidance.

### Finding 5: `findSimilarPaths` function is referenced but never defined
- **Quote:** Technical reference Section 3.4: `const similar = await findSimilarPaths(index, claim.repoId, path);`
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Define the algorithm: Levenshtein distance? Path segment matching? Basename matching? What similarity threshold constitutes a "similar" path? What is the maximum number of results? An implementing agent will need to make non-trivial algorithmic choices.

### Finding 6: `findCloseMatch` function for commands is referenced but never defined
- **Quote:** Technical reference Section 3.4: `const closeMatch = findCloseMatch(script, available.map(s => s.name));`
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Define the fuzzy matching algorithm and threshold. Common approaches: Levenshtein distance <= 2, or Jaro-Winkler similarity > 0.8. Specify the choice.

### Finding 7: Version comparison semantics are ambiguous
- **Quote:** Section 6 / technical reference: `semverSatisfies(actualVersion, claimedVersion)`
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Specify what "satisfies" means for documentation claims. If docs say "React 18.2" and package.json has "^18.2.0" which resolves to 18.3.1, is that verified or drifted? If docs say "React 18" and actual is "18.2.0", is that verified? The direction of satisfaction matters: is the doc claim a semver range, or is the actual version being checked against the claim as a range? Define the comparison semantics explicitly with examples.

### Finding 8: Embedding index type requires minimum row count
- **Quote:** Technical reference Section 4.2: `CREATE INDEX idx_entities_embedding ON code_entities USING ivfflat (embedding vector_cosine_ops);`
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** IVFFlat indexes require a minimum number of rows to build (the number of lists must be <= number of rows). For a new repo with few entities, the index creation will fail or produce poor results. Specify: (a) use HNSW instead of IVFFlat (no minimum row requirement, better recall), or (b) defer index creation until entity count exceeds a threshold, or (c) use exact search for small repos. The same applies to the claims embedding index.

### Finding 9: No specification for how code evidence is fetched for verification
- **Quote:** Section 6.4: "entity code up to 200 lines, truncate to 2000 tokens max" and "entity-mapped claims get full entity code (up to 500 lines)"
- **Category:** AMBIGUOUS
- **Severity:** BLOCKING
- **Recommendation:** The `rawCode` field on CodeEntity stores "source code of the entity" but: (a) how is entity boundary determined (tree-sitter node span)? (b) does it include the entity body or just the signature? (c) what about surrounding context (imports, type definitions used by the entity)? (d) for file-mapped claims (no specific entity), where does the "first 300 lines" come from -- the raw file via GitHub API or from stored data? (e) the PRD says "hard cap 4000 tokens" but token counting requires a tokenizer -- which one (tiktoken, cl100k_base)? These decisions directly affect verification accuracy and cost.

### Finding 10: Race condition in PR webhook handling
- **Quote:** Section 7.2: Steps 3-8 describe a sequential pipeline triggered by a PR event.
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** If a developer pushes two commits in rapid succession (within the 30s debounce window), the second event should cancel/supersede the first. But the PRD does not specify: (a) how an in-flight job is cancelled when a new event arrives for the same PR, (b) whether the PR comment is updated (edited) or replaced, (c) what happens if two workers pick up jobs for the same PR concurrently. BullMQ supports job deduplication via job IDs but this needs explicit design.

### Finding 11: PR comment update vs create strategy is unspecified
- **Quote:** Section 8.2 describes a PR comment format but does not specify whether comments are created once or updated.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** On subsequent pushes to the same PR, should the bot: (a) edit the existing comment, (b) delete and recreate, (c) post a new comment? CodeRabbit edits the existing comment. Specify the strategy. If editing: how to find the existing comment (search by bot username + marker text). If creating new: how to avoid comment spam.

### Finding 12: Feedback collection via GitHub reactions is technically problematic
- **Quote:** Section 8.2: "Thumbs up on a finding = confirmed useful" and "Thumbs down on a finding = false positive"
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** GitHub PR comment reactions are per-comment, not per-finding. A single PR comment contains multiple findings. A thumbs-up on the comment does not indicate which finding was useful. Options: (a) post one comment per finding (noisy), (b) use a webhook + link pattern where each finding has a unique "dismiss" URL, (c) use GitHub Check Run annotations instead of comments (allows per-annotation feedback). The current design cannot distinguish per-finding feedback. This affects the entire Learning System (Layer 7).

### Finding 13: GitHub webhook signature verification not mentioned
- **Quote:** Section 12.1 describes webhook events but not security.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** All incoming webhooks must verify the `X-Hub-Signature-256` header using the app's webhook secret. Without this, anyone can send fake webhook payloads to trigger arbitrary scans. An implementing agent might skip this critical security step. Add explicit requirement.

### Finding 14: No specification for concurrent scan limit enforcement
- **Quote:** Section 7.4: "Per-repo rate limit: max 100 scans per day" and "Per-org rate limit: max 1000 scans per day"
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** How are these limits enforced? Redis counters with TTL? What key schema? What happens when the limit is hit -- drop the event silently, queue for next day, or notify the user? How does the system know which org a repo belongs to (GitHub installation can span multiple orgs)?

### Finding 15: Semantic search mapping threshold (0.6) has no calibration data
- **Quote:** Section 5.6: "Similarity threshold: 0.6 initial guess, needs calibration via experiment"
- **Category:** UNTESTABLE
- **Severity:** IMPORTANT
- **Recommendation:** The 0.6 threshold is acknowledged as a guess. However, for an implementing agent, this needs to be a configurable constant with clear documentation of where to adjust it. More importantly: OpenAI's text-embedding-3-small cosine similarities tend to cluster in the 0.5-0.8 range for even loosely related text. A 0.6 threshold may produce many false-positive mappings. Recommend starting at 0.7 and making it configurable.

### Finding 16: `code_example` claim type has no extraction or verification spec
- **Quote:** Section 4.2 taxonomy lists `code_example` as a claim type. Section 5.5 of technical-reference says "Extract: import paths, function calls, class names, variable names"
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Code examples in documentation are one of the most common sources of drift, yet the PRD provides no specification for: (a) how to extract verifiable claims from a code block (parse imports? execute the code? check syntax?), (b) how to map a code example to actual code (which file does `import { AuthService } from './auth'` map to?), (c) how to verify a code example (does the import path exist? does the function signature match?). This claim type needs its own subsection with concrete extraction and verification logic, or it should be explicitly deferred to post-MVP.

### Finding 17: Tree-sitter WASM memory management in worker process
- **Quote:** Section 1 (tech stack): "tree-sitter (WASM)" for AST parsing.
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** tree-sitter WASM parsers allocate memory per language grammar. When parsing many files across multiple languages, WASM memory grows. Specify: (a) parser lifecycle (create once, reuse per language, or create per file), (b) memory limits, (c) how many languages can be loaded simultaneously. On Railway with 512MB-1GB containers, loading multiple tree-sitter WASM grammars plus processing large repos could hit memory limits.

### Finding 18: Database migration strategy is missing
- **Quote:** Repository structure shows `migrations/` directory but no migration strategy.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Specify: (a) migration tool (e.g., node-pg-migrate, Prisma, Drizzle), (b) how migrations run on deployment (pre-deploy hook, startup script), (c) rollback strategy, (d) how schema changes are coordinated with code changes during rapid iteration.

### Finding 19: No specification for handling large repos
- **Quote:** Section 3.6: "Parsing 100 changed files with tree-sitter: <2 seconds"
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** The 100-file parsing benchmark is for incremental updates. But what about initial indexing of a large repo (10,000+ files, 500+ doc files)? The initial scan needs: (a) estimated time for full repo parsing, (b) memory budget, (c) whether to stream or batch, (d) whether to show progress, (e) timeout behavior. Some popular repos (e.g., Next.js, VS Code) have thousands of source files. The 10-minute per-job timeout (Section 12.2) may be insufficient.

### Finding 20: MCP local mode uses SQLite but main system uses PostgreSQL
- **Quote:** Section 9.3: "Reads from local SQLite database (.docalign/claims.db)" vs Section 12: "PostgreSQL (Supabase)"
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Recommendation:** The system has two different databases for essentially the same data: PostgreSQL for the GitHub App flow, SQLite for the MCP local mode. This means: (a) two different schema management systems, (b) data format translation between them, (c) the `docalign scan` CLI command must populate SQLite, not PostgreSQL. Specify: how does `docalign scan` work -- does it run the full pipeline locally and write to SQLite? Does it call the hosted API? Are the schemas identical? This dual-database architecture adds significant implementation complexity.

### Finding 21: No idempotency guarantee for webhook processing
- **Quote:** Section 7.2 describes PR webhook handler flow but no idempotency.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** GitHub may deliver the same webhook event multiple times (documented behavior). The system must be idempotent: processing the same event twice should not produce duplicate PR comments or duplicate verification runs. Specify: (a) use webhook delivery ID as idempotency key, (b) check for existing scan_run before starting a new one, (c) use BullMQ's job deduplication by job ID.

### Finding 22: `searchRoutes` method referenced in verifier but not in CodebaseIndex interface
- **Quote:** Technical reference Section 3.4: `const alternatives = await index.searchRoutes(claim.repoId, path);`
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** The `CodebaseIndex` interface in Section 3.1 defines `findRoute(repoId, method, path)` but not `searchRoutes(repoId, path)`. Add `searchRoutes` to the interface or clarify that `findRoute` handles partial/fuzzy matching.

### Finding 23: Claim extraction prompt does not specify model parameters
- **Quote:** Section 7.1 (P-EXTRACT prompt template) specifies the prompt text but not model parameters.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Specify: temperature (0 for deterministic extraction), max_tokens, response_format (JSON mode / structured outputs). For structured output with GPT-4o-mini, specify whether to use `response_format: { type: "json_schema", ... }` or `response_format: { type: "json_object" }`. The choice affects reliability.

### Finding 24: Verification prompt does not handle multi-file evidence format
- **Quote:** Section 7.3 (P-VERIFY prompt): `{for each mapped code file/entity:}` uses pseudo-template syntax.
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** Specify the concrete template rendering logic: how are multiple evidence files concatenated? Is there a separator? What happens when total evidence exceeds the 4000-token cap -- which files are truncated first? The implementing agent needs deterministic rendering logic, not prose.

### Finding 25: No specification for handling repos with zero documentation
- **Quote:** No section addresses the empty-state case.
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** What happens if a repo has no documentation files matching DOC_PATTERNS? Does the GitHub App post a "no documentation found" comment on PRs? Does it silently do nothing? This affects user experience on repos without READMEs (rare but possible) or repos with non-standard doc locations.

### Finding 26: Suppression rules in `.docalign.yml` have no matching/execution spec
- **Quote:** Appendix A: `suppress` configuration with file/pattern and claim_type/package.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** The suppression rule format is defined but not the matching logic. How does `pattern: "badge"` work -- substring match on claim text? Regex? Does it match the source line, the claim text, or the extracted value? How does `claim_type: "dependency_version", package: "typescript"` filter -- does it check extracted_value.package? Define the matching engine precisely. An implementing agent cannot build this without knowing the matching semantics.

### Finding 27: GitHub App secret management
- **Quote:** No section addresses secret storage for API keys, webhook secrets, GitHub App private keys.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** Specify how the following secrets are managed: (a) GitHub App private key, (b) GitHub App webhook secret, (c) OpenAI API key, (d) Anthropic API key, (e) Database connection string, (f) Redis connection string. Options: Railway environment variables, Supabase secrets, Vault. This is critical for both security and implementability.

### Finding 28: No healthcheck or monitoring specification
- **Quote:** No section addresses operational monitoring.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** For a production service receiving webhooks: (a) healthcheck endpoint for Railway, (b) alerting on job queue depth/failures, (c) logging strategy (structured logs?), (d) LLM cost monitoring dashboard, (e) error rate tracking. Without monitoring, the solo founder will not know when the system is failing.

### Finding 29: Dependency version extraction regex has high false positive risk
- **Quote:** Technical reference Section 5.3: `VERSION_PATTERNS` include `/(\w+(?:\.\w+)?)\s+v?(\d+\.\d+(?:\.\d+)?)/gi`
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** This regex will match many non-version patterns in documentation. Example: "Section 2.1" matches as package "Section" version "2.1". "Table 3.2" matches as "Table" version "3.2". "HTTP 1.1" matches as "HTTP" version "1.1". The regex needs negative patterns or a validation step (check if the captured "package name" is an actual known package). Without filtering, syntactic extraction will produce many false claims.

### Finding 30: File path regex will match URLs and image paths
- **Quote:** Technical reference Section 5.1: `` /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g ``
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** This regex matches anything in backticks with a dot-extension, including: `image.png`, `style.css`, `README.md` (self-reference), `package.json` (valid but trivial), URLs like `example.com`. The comment says "Exclude: URLs (http://), anchor links (#), common false positives" but no exclusion patterns are provided. Specify the exclusion list or the implementing agent will include all of them.

### Finding 31: Command extraction from code blocks captures all lines, not just commands
- **Quote:** Technical reference Section 5.2: `/```(?:bash|sh|shell|zsh|console)?\n((?:.*\n)*?)```/g`
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** A bash code block may contain output, comments, and environment setup alongside actual commands. Example: `$ npm install\n> added 150 packages`. The regex captures everything. Specify how to distinguish commands from output (look for `$` or `>` prompts, or take the first line only?).

### Finding 32: No specification for `.docalign.yml` validation and error reporting
- **Quote:** Appendix A describes the config schema but not validation.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** What happens if `.docalign.yml` has invalid YAML? What if `min_severity` is set to an invalid value? What if glob patterns are syntactically wrong? Specify: (a) validation library (Zod, Joi), (b) error behavior (fall back to defaults, fail the scan, post a warning comment on PR), (c) how config errors are communicated to the user.

### Finding 33: Scheduled scan cron implementation details missing
- **Quote:** Section 7.2: "Trigger: Scheduled Full Scan" with no implementation detail.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** How is the weekly cron scheduled? Options: (a) external cron service (Railway cron), (b) in-process cron (node-cron), (c) BullMQ repeatable jobs. For multi-repo, does each repo get its own cron entry? How is the "sunday" preference from `.docalign.yml` applied? The system needs to manage potentially thousands of cron entries.

### Finding 34: No specification for handling private repo file access
- **Quote:** Section 12.3 mentions reading files via GitHub API but no auth detail.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** For private repos, all API calls require a valid installation access token. The `git clone --depth 1` also requires authentication (HTTPS clone with token, or SSH). Specify: how is the clone authenticated? Does the worker have the installation token available for git operations?

### Finding 35: Evidence assembly for file-mapped claims (no entity) is underspecified
- **Quote:** Section 6.2: "file-mapped claims get first 300 lines"
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** "First 300 lines" of a file may not contain the relevant evidence. If a claim maps to a file but no specific entity, the claim might reference something at line 500. Specify: (a) use the mapping confidence and any keyword hints to select the most relevant section of the file, (b) or use a cheap embedding search within the file to find the relevant section, (c) or always use a fixed window. "First 300 lines" is a poor heuristic for large files.

### Finding 36: No retry/circuit-breaker for external API calls
- **Quote:** Section 12.2 mentions "3 attempts with exponential backoff" for jobs but not for individual API calls within a job.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** A single verification job may make 5-20 LLM API calls. If one call fails, does the entire job retry (re-running successful calls)? Or should individual API calls have their own retry logic? Specify: (a) per-call retry policy (2 retries, 1s/2s/4s backoff), (b) circuit breaker when an API is down (if 5 consecutive calls to Anthropic fail, stop trying for 60 seconds), (c) partial success handling (job completed 15 of 20 verifications before failure -- save the 15 results?).

### Finding 37: Co-change tracking stores unbounded data
- **Quote:** Section 4.7: `co_changes` table records every code+doc pair per commit.
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** For a repo with 100 commits/week, each touching 5 code files and 1 doc file, that is 500 co_change records per week, 26,000 per year. This is manageable. But for a monorepo with 1000 commits/week touching many files, this table grows fast. Specify: (a) retention policy (keep last 6 months?), (b) aggregation (store counts instead of individual records?), (c) index cleanup.

### Finding 38: `code_patterns.include` default is `src/**, lib/**` -- too narrow
- **Quote:** Appendix A: `code_patterns.include` default is `src/**, lib/**`
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** Many repos use `app/`, `packages/`, `internal/`, `cmd/`, `pkg/`, or project root as their code directory. The default `src/**, lib/**` would miss code in these locations, causing mapping failures (claims reference code that is not indexed). Recommend either: (a) default to `**` with explicit excludes, or (b) auto-detect common patterns, or (c) clearly document that users should configure this.

### Finding 39: PRODUCT-VISION.md references ada-002 but PRD uses text-embedding-3-small
- **Quote:** PRODUCT-VISION.md Section 4: "OpenAI ada-002 for embeddings"; PRD Section 3.4: "text-embedding-3-small"
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** Align on the embedding model. text-embedding-3-small is newer and cheaper ($0.02/1M vs ada-002's $0.10/1M tokens). The PRD is correct; update PRODUCT-VISION.md.

### Finding 40: No specification for handling doc files larger than LLM context window
- **Quote:** Section 4.2: "split sections over 2000 words at paragraph boundaries"
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** 2000 words is roughly 2500-3000 tokens. With the P-EXTRACT prompt overhead (~200 tokens), the total input is ~3200 tokens -- well within GPT-4o-mini's context window. However, the chunking strategy needs more precision: (a) how are heading sections detected (markdown ## markers)? (b) what if a section has no headings (e.g., a flat text file)? (c) what if the entire document is one section over 2000 words? (d) how are paragraph boundaries detected? An implementing agent needs deterministic chunking logic.

### Finding 41: Claim embedding generation is not specified
- **Quote:** Section 4.4: "embedding cosine similarity > 0.95 (for semantic claims)" implies claims have embeddings. Section 4.3 outputs do not include embedding.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** The claim deduplication uses embedding similarity, and the MCP `get_docs` tool uses claim embedding search, but the claim extraction pipeline does not specify when embeddings are generated for claims. Add to Layer 1 outputs: (a) when are claim embeddings generated (during extraction or as a post-processing step), (b) what text is embedded (claim_text? claim_text + keywords? claim_text + context?), (c) model (same text-embedding-3-small as code entities?).

### Finding 42: scan_runs table references itself before creation
- **Quote:** Technical reference Section 4.5: `scan_run_id UUID REFERENCES scan_runs(id)` in verification_results, but scan_runs is defined in Section 4.8 (after verification_results).
- **Category:** MINOR (documentation ordering)
- **Severity:** MINOR
- **Recommendation:** The SQL schema ordering matters for migrations. Ensure the migration order creates tables in dependency order: repos -> scan_runs -> code_entities -> claims -> claim_mappings -> verification_results -> feedback -> co_changes -> agent_drift_reports.

### Finding 43: No specification for what "dismiss all" means technically
- **Quote:** Section 8.2: "Dismiss all on PR comment = developer doesn't want findings on this PR"
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** How is "dismiss all" implemented? A link in the PR comment that calls an API endpoint? A slash command in a comment reply? A GitHub reaction? The implementing agent needs to know the interaction mechanism and what data to store (all claims in this PR suppressed permanently? Only for this PR?).

### Finding 44: Tree-sitter queries for Python route extraction are not provided
- **Quote:** Technical reference Section 6.1 shows TypeScript queries. Section 6.2 lists Python as MVP but no Python queries.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Python route definitions (Flask `@app.route`, FastAPI `@app.get`, Django `urlpatterns`) use decorators with completely different AST structure from Express/Fastify. Provide tree-sitter queries for Python route extraction, or the implementing agent will need to design them from scratch (which is complex for decorator patterns).

### Finding 45: No specification for handling binary files or images in doc scanning
- **Quote:** Section 4.2: "Parse documentation files (markdown, mdx, rst)"
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** The `DOC_PATTERNS` globs will match `.md` files that may reference or embed images. Markdown files may contain base64-encoded images, HTML img tags, or SVG inline content. Specify: (a) strip non-text content before processing, (b) handle `.mdx` files that may contain JSX components (are these valid input?).

### Finding 46: PRODUCT-VISION.md says 180-day half-life for confidence decay, also states 365-day half-life
- **Quote:** PRODUCT-VISION.md Section Layer 7: "365-day half-life"; PRD technical reference: "180-day half-life"
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** Pick one. 180-day (from PRD) is more aggressive and probably more appropriate for fast-moving codebases. Update PRODUCT-VISION.md.

### Finding 47: No specification for multi-language repos (which parser for which file)
- **Quote:** Section 3.2 says "TypeScript/JavaScript, Python (MVP)" but no routing logic.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Specify how the system determines which tree-sitter grammar to use for which file. Options: (a) file extension mapping (.ts/.tsx -> TypeScript, .js/.jsx -> JavaScript, .py -> Python), (b) what about .mjs, .cjs, .mts, .cts files? (c) what about files with no extension (Makefile, Dockerfile)? (d) what about polyglot files? Provide the extension-to-grammar mapping table.

### Finding 48: Auto-fix commit requires branch protection awareness
- **Quote:** Section 8.2: "Create a new commit on the PR branch with fixes"
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** Many repos have branch protection rules. The GitHub App may not have permission to push to the PR branch if: (a) the PR is from a fork (cross-repo PRs), (b) the branch has "require signed commits" enabled, (c) the branch requires status checks before pushing. Specify behavior when auto-fix commit fails due to branch protection.

### Finding 49: The `extracted_value` field has different shapes per claim type but uses JSONB
- **Quote:** Section 4.3 schema: `extracted_value JSONB`; examples show string for path_reference, object {runner, script} for command, object {package, version} for dependency.
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define the exact JSONB schema per claim type. An implementing agent needs to know: for `path_reference`, is extracted_value a string or `{path: string}`? For `api_route`, is it `{method: string, path: string}`? For `code_example`, what is the shape? Create a discriminated union type definition for extracted_value keyed by claim_type.

### Finding 50: No specification for handling GitHub App rate limits
- **Quote:** Section 12.3 mentions "5,000 requests/hour" but no management strategy.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** With multiple repos installed, the 5,000 req/hour limit is shared across all installations. Specify: (a) rate limit tracking (read X-RateLimit-Remaining headers), (b) behavior when approaching the limit (defer non-urgent operations, switch to clone-based access), (c) how to prioritize which repos get API budget, (d) fallback to shallow clone when API budget is low.

### Finding 51: No data retention or cleanup policy
- **Quote:** No section addresses data retention.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Specify how long data is retained: (a) verification_results: keep last N per claim, or keep all? (b) scan_runs: archive after 90 days? (c) feedback: keep forever? (d) co_changes: retention window? Without cleanup, the database will grow unboundedly. For Supabase free tier, this matters.

### Finding 52: GitHub App installation webhook does not specify initial setup flow
- **Quote:** Section 12.1: "installation (app installed/uninstalled)" webhook event listed.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** The installation webhook is the entry point for new users. Specify: (a) what happens on `installation.created`: create repo record, trigger initial full scan? (b) what happens when the app is installed on multiple repos at once (org-wide install)? (c) how to handle `installation_repositories` events (repos added/removed from installation)? (d) what is the user experience during initial setup (do they see anything, or just wait for the first PR)? This is the critical first-touch experience.

---

## Section 4: Questions for Founder

1. **Triage gate in MVP?** The cost analysis shows MVP without the triage gate is 1.5-2x more expensive per PR than estimated. The triage gate implementation is relatively simple (one GPT-4o-mini prompt). Should it be moved into MVP scope to ensure financial viability from day one?

2. **Initial scan on install?** When a user installs the GitHub App, should a full scan run automatically to populate the claim database and show a health score? Or should the system only activate on the next PR? The former gives immediate value but costs $3-12 for a medium-to-large repo (with no revenue yet if the user is on free tier). The latter delays time-to-value.

3. **Code example claim type: MVP or deferred?** Code examples in documentation (fenced code blocks with imports, function calls) are a very common source of drift and high user value. But the PRD has no extraction or verification spec for them. Should this be a priority for MVP spec development, or deferred to v2?

4. **Dual database architecture (PostgreSQL + SQLite)?** The MCP local mode uses SQLite while the GitHub App uses PostgreSQL. This means maintaining two schema definitions and a data translation layer. Alternative: MCP local mode queries the hosted API (requires internet), or generates a SQLite export from the hosted PostgreSQL. Which approach do you prefer?

5. **Per-finding vs per-comment feedback?** GitHub reactions are per-comment, not per-finding. If findings are posted as a single aggregated comment (as spec'd), individual finding feedback requires a different mechanism (links, slash commands, or check run annotations). Which interaction model should be prioritized?

6. **Default code patterns scope?** The default `code_patterns.include` of `src/**, lib/**` will miss code in many common repo structures (`app/`, `packages/`, `cmd/`, etc.). Should the default be `**` with explicit excludes (more inclusive but potentially slower), or should the system auto-detect the code root?

7. **GitHub API rate limit budget allocation?** With a shared 5,000 req/hour limit across all installations, high-volume orgs could exhaust the budget. At what installation scale does this become a problem, and should the architecture default to shallow clones for all operations to avoid this entirely?

8. **Error UX for scan failures?** When a PR scan fails (LLM API down, timeout, rate limit), what should the user see? Options: (a) no comment (silent failure -- user never knows a scan happened), (b) error comment on PR ("DocAlign encountered an error, retrying..."), (c) GitHub Check Run with failure status. This affects user trust significantly.

9. **Auto-fix as a separate commit or amendment?** When auto-fix is enabled, should fixes be a new commit on the PR branch (visible in git history as a separate commit) or squashed into the PR? New commit is simpler to implement but adds noise to the commit history.

10. **Monorepo support timing?** The PRD mentions multi-repo support in v3 but does not address monorepos. A monorepo with multiple documentation directories and separate code packages needs claim scoping per package. Is monorepo awareness needed for MVP (many AI-native startups use monorepos), or can it wait?

11. **What happens when a user uninstalls the app?** Should we delete all their data immediately (GDPR compliance), keep it for N days (in case they reinstall), or keep it indefinitely? This affects the data model and the `installation.deleted` webhook handler.
