# Phase 1: PRD Hardening Review (Consolidated)

> Sources: phase1-pm-review.md (Product Manager), phase1-tech-review.md (Technical Feasibility)
> Date: 2026-02-09

## Executive Summary

The DocAlign PRD (v0.1) provides a strong conceptual foundation -- the seven-layer architecture is well-structured, the claim taxonomy is thoughtful, and the verification tier system is credible. However, the PRD has critical gaps that would prevent an implementing agent from building a working system. The happy path is described in detail; everything else is missing. There is no onboarding flow, no error handling, no authentication specification, no webhook security, and no specification for what happens when any external dependency fails. An agent given this PRD today would produce a system that works perfectly in demos and fails immediately in production.

The cost model is the most urgent business risk. The MVP explicitly skips the Tier 3 triage gate, but the cost estimates assume triage exists. Without triage, every semantic claim hits Claude Sonnet at $0.012-0.018 per claim. Per-PR costs are 1.5-2x higher than estimated, and medium-activity repos (100 PRs/month) drop to 21-37% gross margin at $19/repo/month. High-activity repos are deeply unprofitable. The triage gate is not a v2 optimization -- it is a financial prerequisite for MVP viability.

The PR comment output layer has three interconnected blocking issues: GitHub reactions cannot provide per-finding feedback, GitHub suggestion syntax only works in review comments (not regular PR comments), and the comment create-vs-update strategy is undefined. These must be resolved together as a single output strategy decision before any implementation begins.

## Stats
- Total unique findings: 86
- BLOCKING: 14
- IMPORTANT: 34
- MINOR: 38

## User Journey Trace

### Journey: GitHub App Installation Through First PR Comment

**Step 1: User discovers DocAlign**
- How? GitHub App Marketplace listing? Direct URL? Referral?
- **GAP:** No marketplace listing content specified. No landing page described. No install CTA defined. (See M5.)

**Step 2: User installs GitHub App on a repository**
- Input: User clicks "Install" on GitHub Marketplace.
- Output: GitHub sends an `installation` webhook event.
- **GAP:** What happens when we receive the `installation` webhook? The PRD mentions this webhook in Section 12.1 but never describes the handler behavior. Does the system run an initial full scan? Does it index the repo? Does it just store the installation and wait for the first PR? (See B1.)

**Step 3: System performs initial setup for the repo**
- **GAP:** Completely undefined. There is no "repo onboarding" flow described anywhere. Questions: Does the system clone the repo? Build the initial codebase index (Layer 0)? Extract all claims (Layer 1)? Create initial mappings (Layer 2)? Run an initial verification pass (Layer 3)? How long does this take? What does the user see while it runs? What if it fails? (See B1.)

**Step 4: User opens a PR (or pushes to an existing PR)**
- Input: GitHub webhook `pull_request.opened` or `pull_request.synchronize`.
- Output: Webhook received by API server, job queued.
- Transition: Job worker picks up the job.
- **GAP:** What if the initial index has never been built (user installed the app and immediately opened a PR before any initial scan)? The PR flow in Section 7.2 assumes the codebase index and claim database already exist. It says "Find claims affected by code changes using the reverse index" -- but if no claims have been extracted yet, the reverse index is empty. (See B2.)

**Step 5: System extracts changed files from PR diff**
- Input: PR metadata (owner, repo, pull_number).
- Output: List of changed files, separated into doc files and code files.
- Transition: Feeds into Layer 0 (index update), Layer 1 (claim re-extraction), Layer 2 (reverse index lookup).
- **GAP:** What counts as a "documentation file" vs a "code file"? The PRD defines DOC_PATTERNS in the technical reference (Section 3.2) but the PRD itself (Section 4.2) says "Scan standard documentation locations: README files, docs/ directories, ADRs, agent instruction files." The patterns in the technical reference are more specific but are labeled as "extracted" detail subject to change. An agent might implement different detection logic depending on which source it reads. (See I8.)

**Step 6: System updates codebase index (Layer 0)**
- Input: Changed code files.
- Output: Updated index with new/modified/deleted entities.
- **OK:** Well-defined in Section 3.5 (incremental update flow). Inputs and outputs are clear.

**Step 7: System re-extracts claims for changed doc files (Layer 1)**
- Input: Changed doc files.
- Output: New/updated claim records.
- **GAP:** What happens on the very first PR when NO claims exist yet? Should the system extract claims from ALL doc files on first run, or only from the doc files that changed in this PR? If only changed doc files, then claims from unchanged doc files won't exist, and no reverse-index lookup will find them. (See B2.)

**Step 8: System finds affected claims via reverse index (Layer 2)**
- Input: Changed code files.
- Output: Claims mapped to those code files.
- **GAP:** Same bootstrapping problem. If mappings don't exist yet, this returns nothing. (See B2.)

**Step 9: System merges claim lists and runs verification (Layer 3)**
- Input: Affected claims + doc-change claims, merged and deduplicated.
- Output: Verification results with verdicts.
- **GAP:** Deduplication logic is defined for claim extraction (Section 4.4) but not for the merge step in the PR flow. If the same claim appears in both the "affected by code changes" list and the "from changed doc files" list, how is it deduplicated? By claim ID? (See M7.)

**Step 10: System filters to drifted claims only**
- Input: All verification results.
- Output: Findings (drifted claims only).
- **GAP:** What about "uncertain" verdicts? The PRD says filter to "drifted" only (Section 7.2 step 9), but Section 6.3 defines three possible verdicts: verified, drifted, uncertain. Are uncertain claims silently dropped? Should the user be told about uncertain claims? (See I10.)

**Step 11: System posts PR comment (Layer 5)**
- Input: Findings.
- Output: GitHub PR comment.
- **GAP:** What if there are zero findings? The technical reference code (Section 3.5) says `if (findings.length > 0) { await reporter.postPRComment(...) }`. So no comment is posted if everything is fine. But there is no specification for whether this is correct behavior. Should a "all docs are healthy" comment be posted? A check status? Nothing? (See I11.)

**Step 12: User reads PR comment and reacts**
- Input: PR comment with findings.
- Output: User takes action (accept suggestion, dismiss, react with thumbs up/down).
- **GAP:** The feedback collection mechanism is not implementable as described. (See B6.)

**Step 13: System records feedback (Layer 7)**
- **GAP:** Layer 7 is not in MVP scope per Section 14.1. But Section 8.2 says "Feedback prompts: thumbs up/down reactions, dismiss all option" as part of the PR comment format, which IS MVP. So feedback UI is shipped in MVP but feedback recording is not? This creates a confusing UX where users can react but nothing happens. (See I12.)

## Feasibility Matrix

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

## Cost Model Validation

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

## BLOCKING Findings

### B1: No installation/onboarding flow specified
- **Quote:** "Webhook events: ... installation (app installed/uninstalled)" (Section 12.1) -- and nothing else about what happens on install.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-1 / Tech-1 / Tech-52
- **Recommendation:** Add a new section "Onboarding Flow" that defines: (a) What the `installation` webhook handler does (create repo record, queue initial scan?). (b) Whether an initial full scan runs on install. (c) Cost budget for initial scan (MVP has no triage gate, so a full scan on a medium repo costs $3-12 -- see Cost Model Validation). (d) Timeout (the 10-minute per-job timeout may be insufficient for large repos with 500+ doc files and 10,000+ source files). (e) Progress indication to the user during initial setup. (f) What happens if initial scan fails or times out. (g) Whether the app is "active" before the initial scan completes. (h) What happens when the app is installed on multiple repos at once (org-wide install). (i) How `installation_repositories` events (repos added/removed from installation) are handled.

### B2: First-PR bootstrapping problem -- no claims or index exist yet
- **Quote:** "Layer 4 extracts changed files from PR diff ... Layer 2 queries: 'Which claims are mapped to any of these changed code files?'" (Section 2.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-3
- **Recommendation:** Define the bootstrapping behavior explicitly. Option A: On install, run a full initial scan (extract all claims, build full index, create all mappings) before the first PR can be processed. Option B: On first PR, detect that no claims exist and run a full extraction/mapping pass instead of incremental. Option C: First PR only checks claims from doc files that were changed in the PR itself (no reverse-index lookup). Document the chosen behavior and its tradeoffs. This is coupled with B1 (onboarding) and must be resolved together.

### B3: MVP cost model assumes triage gate exists, but MVP skips it
- **Quote:** Section 14.1: "Layer 3: Tier 3+4 combined (skip triage gate, go straight to Claude Sonnet for semantic claims)"; Section 13.2 shows only 6 of 20 claims reaching Tier 4
- **Category:** INCONSISTENT
- **Severity:** BLOCKING
- **Source:** Tech-2
- **Recommendation:** Recompute the Section 13.2 cost table for the actual MVP configuration (no triage gate). All semantic claims hit Tier 4 in MVP. Per-PR costs are 1.5-2x higher than estimated, and medium-activity repos are borderline profitable at $19/repo/month. Alternatively, move the triage gate into MVP scope -- the implementation cost is low (one GPT-4o-mini prompt per semantic claim) and the savings are substantial. This is a business viability question, not just an optimization.

### B4: No error handling specification anywhere
- **Quote:** (no relevant quote -- error handling is never mentioned in any layer)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-5 / Tech-3 / Tech-36
- **Recommendation:** For EVERY layer, define: (a) What errors can occur. (b) What the system does on each error. (c) What the user sees. Minimum error scenarios to cover: LLM API failure (rate limit 429, overloaded 529, timeout, malformed JSON, content filter refusal), GitHub API failure (rate limit, permission denied, repo deleted), database failure, job timeout (10 min exceeded), webhook signature validation failure, invalid/corrupt repo content (binary files in doc paths, huge files), AST parsing failure for unsupported syntax. For individual API calls within a job: specify per-call retry policy (2 retries, exponential backoff), circuit breaker when an API is down (if 5 consecutive calls fail, stop for 60 seconds), and partial success handling (job completed 15 of 20 verifications before failure -- save the 15 results?).

### B5: No GitHub App authentication and token management specification
- **Quote:** Section 12.1 lists permissions but does not describe authentication flow.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-60 / Tech-4 / Tech-34
- **Recommendation:** Specify: (a) How the app authenticates to GitHub (JWT for app-level, installation access tokens for API calls). (b) Token refresh strategy (installation tokens expire after 1 hour). (c) How tokens are stored in the worker (passed via job payload vs fetched on demand). (d) What happens when a token expires mid-job. (e) For shallow clones of private repos, how is the clone authenticated (HTTPS with token). (f) How secrets are managed: GitHub App private key, webhook secret, OpenAI API key, Anthropic API key, database connection string, Redis connection string. Specify the storage mechanism (Railway environment variables, Vault, etc.).

### B6: PR comment feedback mechanism is not implementable as described
- **Quote:** "Thumbs up on a finding = confirmed useful ... Thumbs down on a finding = false positive" (Section 8.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-31 / Tech-12
- **Recommendation:** GitHub comment reactions (thumbs up/down, etc.) apply to the ENTIRE comment, not to individual sections within it. You cannot react to "Finding 1" separately from "Finding 2" within a single comment. Additionally, GitHub does not send webhook events for reactions on bot comments -- the system would need to poll or use GraphQL subscriptions. Options to resolve: (a) Post each finding as a separate comment (noisy). (b) Post each finding as a review comment on the specific line (uses PR review API, enables suggestions, but fragments the report). (c) Use a custom web link per finding that records the feedback via the DocAlign API. (d) Use GitHub Check Run annotations instead of comments (allows per-annotation feedback). Choose one and specify the implementation. This is BLOCKING because the feedback system underpins the entire learning loop.

### B7: GitHub suggestion syntax requires review comments, not issue comments
- **Quote:** "Where possible, use GitHub's native suggestion syntax so developers can accept with one click" (Section 8.2)
- **Category:** AMBIGUOUS
- **Severity:** BLOCKING
- **Source:** PM-33
- **Recommendation:** GitHub suggestion syntax (` ```suggestion `) only works in **pull request review comments** posted on specific lines via the Pull Request Review API. It does NOT work in regular PR comments posted via the Issues API. The PRD conflates these two APIs. If findings are posted as a single PR comment (the template in Section 3.6), suggestions will not be click-to-accept. If findings are posted as individual review comments on doc file lines, suggestions will work but the UX is completely different (no summary comment, findings scattered across the diff). Decide which approach to use and redesign the output format accordingly. This is tightly coupled with B6 (feedback mechanism) and I13 (PR comment update strategy) -- resolve all three together as a single output strategy decision.

### B8: PR comment update vs create strategy is unspecified
- **Quote:** (absent -- never specified)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-29 / Tech-11
- **Recommendation:** When a PR is updated (new push), should the system: (a) Edit the existing DocAlign PR comment with new results, or (b) Post a new comment for each push, or (c) Edit the existing comment and add a "Updated at [timestamp]" note? This is critical for UX. Multiple comments per PR create noise. But editing removes the history of what was found on earlier versions. Most CI bots (CodeRabbit, Codecov) edit their existing comment. Specify the behavior, and if editing: how to find the existing comment (search by bot username + marker text).

### B9: Webhook signature verification not specified
- **Quote:** "Webhooks are received by an API server" (Section 12.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-6 / Tech-13
- **Recommendation:** All incoming webhooks must verify the `X-Hub-Signature-256` header using the app's webhook secret to prevent spoofed events. Without this, anyone can send fake webhook payloads to trigger arbitrary scans, consume LLM budget, and post malicious PR comments. This is a critical security requirement. An implementing agent might skip this step if it is not in the PRD.

### B10: `code_example` claim type has no verification strategy defined
- **Quote:** "code_example: Code blocks that should match reality. Fenced code blocks with imports, function calls. Testability: Syntactic/Semantic" (Section 4.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-14 / Tech-16
- **Recommendation:** The claim taxonomy lists `code_example` but neither Layer 3 (verification) nor any experiment plan addresses how to verify a code example. What does it mean for a code block in docs to "match reality"? Should the imports be resolvable? Should the function calls use correct signatures? Should the entire block be executable? The technical reference (Section 5.5) says "Extract: import paths, function calls, class names, variable names" but provides no extraction patterns. This claim type needs its own subsection with concrete extraction and verification logic, or it should be explicitly deferred to post-MVP with a clear note in the claim taxonomy.

### B11: No specification for how code evidence is fetched and assembled for verification
- **Quote:** Section 6.4: "entity code up to 200 lines, truncate to 2000 tokens max" and "entity-mapped claims get full entity code (up to 500 lines)"
- **Category:** AMBIGUOUS
- **Severity:** BLOCKING
- **Source:** Tech-9
- **Recommendation:** The evidence assembly rules determine verification accuracy and cost but are underspecified: (a) How is entity boundary determined (tree-sitter node span)? Does it include the entity body or just the signature? (b) What about surrounding context (imports, type definitions used by the entity)? (c) For file-mapped claims (no specific entity), the PRD says "first 300 lines" -- but relevant code may be at line 500. Use keyword/embedding search within the file to find the relevant section. (d) For multi-file evidence, how are files concatenated? Is there a separator? What happens when total evidence exceeds the 4000-token cap -- which files are truncated first? (e) The "hard cap 4000 tokens" requires a tokenizer -- which one (tiktoken, cl100k_base)? (f) What unit is "200 lines" / "500 lines" -- raw lines or lines after stripping comments and blanks?

### B12: Debounce semantics for rapid PR pushes are underspecified
- **Quote:** "Multiple pushes to the same PR in quick succession: debounce with 30-second window" (Section 7.4)
- **Category:** AMBIGUOUS
- **Severity:** BLOCKING
- **Source:** PM-27 / Tech-10
- **Recommendation:** Define the debounce semantics precisely. When a new push arrives within 30 seconds of a previous one: (a) Is the in-progress job cancelled and a new one queued? (b) Is the new push ignored (trailing edge debounce)? (c) Is the new push queued to run after the in-progress job completes? (d) If a job is already past the "index update" stage and into "verification," should it be cancelled? Also: how are in-flight jobs cancelled when a new event arrives for the same PR? BullMQ supports job deduplication via job IDs but this needs explicit design. This requires distributed state (Redis) to track in-flight scans per PR, and race conditions between debounce timer expiry and new events must be addressed.

### B13: Concurrent PR scans on the same repo can corrupt the index
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-52 / Tech-10
- **Recommendation:** If two PRs are open simultaneously and both trigger scans, they may both try to update the codebase index concurrently. Define: (a) Are index updates atomic per repo? (b) Is there a per-repo lock? (c) Can two PR scans run in parallel? (d) Do they share the same codebase index or does each scan get a snapshot? This affects data integrity. Without a concurrency strategy, two concurrent scans can produce inconsistent index state.

### B14: No idempotency guarantee for webhook processing
- **Quote:** Section 7.2 describes PR webhook handler flow but no idempotency.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Source:** PM-57 / Tech-21
- **Recommendation:** GitHub may deliver the same webhook event multiple times (documented behavior). If the PR comment post fails and the system retries, but the first attempt actually succeeded (network error on response), it will post a duplicate comment. Specify: (a) Use webhook delivery ID as idempotency key. (b) Check for existing scan_run before starting a new one. (c) Use BullMQ's job deduplication by job ID. (d) Before posting a PR comment, check if a DocAlign comment already exists on the PR. If editing existing comments (see B8), this is naturally idempotent.

---

## IMPORTANT Findings

### I1: No specification for how the system accesses repo files during initial setup
- **Quote:** "PR-triggered checks (few files): Read files via GitHub API ... Full scans (many files): Shallow clone" (Section 12.3)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-4
- **Recommendation:** Specify which file access strategy is used for the initial onboarding scan (if it exists). A new repo install likely requires reading many files (all docs, code for indexing), which means a shallow clone. But the PRD only describes file access strategies for PR checks and full scans, not for initial setup. For shallow clones on Railway/Fly, note that disk may be ephemeral and limited -- specify temp disk space management, cleanup, and timeout handling.

### I2: No authentication/authorization model for the API server
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-7
- **Recommendation:** The API server receives webhooks. Does it serve any other endpoints? At minimum define: webhook validation (see B9), a health check endpoint (needed for Railway), and any status/config endpoints. Define what endpoints exist and how they are secured.

### I3: Embedding model inconsistency between PRD and PRODUCT-VISION.md
- **Quote:** "Embedding model: OpenAI text-embedding-3-small (1536 dimensions)" (PRD Section 3.4) vs "OpenAI ada-002 for embeddings" (PRODUCT-VISION.md Section 7)
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Source:** PM-8 / Tech-39
- **Recommendation:** The PRD says `text-embedding-3-small` and the product vision says `ada-002`. These are different models with different dimensions and pricing (text-embedding-3-small is newer and cheaper: $0.02/1M vs ada-002's $0.10/1M). The PRD is canonical; update PRODUCT-VISION.md. Also confirm the `VECTOR(1536)` dimension in the schema matches the chosen model's default output.

### I4: AST parsing scope for route definitions is underspecified
- **Quote:** "API route definitions: HTTP method, path, handler, file, line" (Section 3.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-9 / Tech-44
- **Recommendation:** Route definitions vary wildly by framework. Express uses `app.get('/path', handler)`. Fastify uses `fastify.route(...)`. Flask uses `@app.route('/path')`. Django uses `urlpatterns = [path('api/', ...)]`. NestJS uses `@Get('/path')`. The tree-sitter queries in the technical reference (Section 6.1) show only TypeScript/Express-style patterns -- no Python queries are provided despite Python being MVP scope. Specify which frameworks are supported in MVP, provide tree-sitter queries for each, and document the expected coverage (~60% of real-world patterns for complex codebases).

### I5: Version comparison semantics ("satisfies") are undefined
- **Quote:** Technical reference: `if (semverSatisfies(actualVersion, claimedVersion))` (Section 3.4)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-22 / Tech-7
- **Recommendation:** Define what "satisfies" means. If docs say "React 18.2" and package.json has `"react": "^18.2.0"`, does that satisfy? What about `"react": "^18.3.0"` (actual resolved version is 18.3.1, not 18.2)? Does the system compare against the version specifier in package.json, or against the resolved version in the lock file? These produce different results. If docs say "React 18" and actual is "18.2.0", is that verified? Define the comparison semantics explicitly with examples.

### I6: "Similar filenames" search for renames is unspecified
- **Quote:** "If not, look for similar filenames (likely renames)" (Section 6.2, Tier 1) / `findSimilarPaths(index, claim.repoId, path)` (Section 3.4)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-23 / Tech-5 / Tech-6
- **Recommendation:** Define the similarity algorithm: Levenshtein distance on filename, Levenshtein distance on full path, git rename detection (from diff), filename stem matching (same name, different directory). Each produces very different results. Specify: what threshold of similarity counts as "likely rename"? What if multiple similar files are found? Maximum number of results? The same issue applies to `findCloseMatch` for commands -- specify the fuzzy matching algorithm and threshold (e.g., Levenshtein distance <= 2, or Jaro-Winkler similarity > 0.8).

### I7: Mapper "stops as soon as a high-confidence mapping is found" -- threshold undefined
- **Quote:** "The mapper runs four steps in order. It stops as soon as a high-confidence mapping is found." (Section 5.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-24
- **Recommendation:** Define "high-confidence." Is it confidence >= 0.9? >= 0.8? >= 1.0? Also: should the mapper really stop at one mapping? A behavior claim might map to multiple files. If Step 1 finds one high-confidence mapping, should Steps 2-3 still run to find additional mappings? Define: (a) The confidence threshold for "high-confidence." (b) Whether "stop" means "stop looking for more mappings" or "stop trying lower tiers."

### I8: Doc file discovery conflict between PRD body and technical reference
- **Quote:** "Scan standard documentation locations: README files, docs/ directories, ADRs, agent instruction files (CLAUDE.md, AGENTS.md, .cursorrules), API docs" (PRD Section 4.2) vs detailed DOC_PATTERNS list in technical reference Section 3.2 which includes `wiki/**/*.md`, `**/CLAUDE.md`, `**/AGENTS.md`, etc.
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Source:** PM-12
- **Recommendation:** The PRD description is vaguer and less complete than the technical reference patterns. But the PRD also says "Heuristic for unknown repos: scan all `.md` files in root + first two directory levels" -- this heuristic could match files NOT in the DOC_PATTERNS list. Decide: is DOC_PATTERNS the canonical list, or is the heuristic the fallback? Can both run? What takes precedence? This must be a single, unambiguous algorithm.

### I9: Uncertain verdicts are silently dropped in PR flow
- **Quote:** "Filter to actionable findings (drifted claims only)" (Section 7.2, step 9)
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Source:** PM-16
- **Recommendation:** Define behavior for "uncertain" verdicts. Options: (a) Include uncertain findings in PR comment with a different visual treatment (e.g., "? UNCERTAIN" instead of severity badge). (b) Drop them silently. (c) Drop them but count them in the health score. The current spec drops them silently, which means the user never sees claims the system could not verify. This is a product decision that affects trust.

### I10: No specification for zero-findings behavior
- **Quote:** Technical reference Section 3.5 shows `if (findings.length > 0) { await reporter.postPRComment(...) }` -- no else branch.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-17 / Tech-25
- **Recommendation:** When a PR has no drifted claims, should the system: (a) Post nothing (current implied behavior). (b) Post a brief "all clear" comment. (c) Set a GitHub check status to "passed" (green checkmark). (d) Do nothing on the first PR but start posting "all clear" once the user has seen at least one finding. This affects the user's awareness that the tool is active. A user who installs the app and sees nothing on their next 5 PRs may think it is broken. Related: if the repo has zero documentation files at all, what happens? (See also M20.)

### I11: Feedback UI is in MVP but feedback processing is not
- **Quote:** PR comment format includes "React with thumbs up or thumbs down" (Section 8.2) but Layer 7 (learning system) is listed as not-in-scope for MVP (Section 14.1).
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Source:** PM-18
- **Recommendation:** Either: (a) Remove feedback prompts from MVP PR comment template, or (b) Add minimal feedback recording to MVP (store reactions in DB, no learning/suppression logic yet -- that comes in v2). Option (b) is recommended: collecting data early is valuable even if you don't act on it yet. Note: this depends on the resolution of B6 (feedback mechanism redesign).

### I12: PR comment template is an example, not a parameterized spec
- **Quote:** The PR comment template in technical reference Section 3.6 shows a full example but does not define the template variables or rendering logic.
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-30
- **Recommendation:** Define the template as a parameterized template, not just an example. Specify: (a) How findings are ordered (by severity? by file? by line number?). (b) Maximum findings shown before truncation (what if 30 claims are drifted?). (c) The exact markdown structure for each severity level. (d) Whether the health score line appears always or only when findings exist. An agent implementing from the example alone would hardcode the structure.

### I13: Auto-fix commit specification has gaps
- **Quote:** "Create a new commit on the PR branch with fixes. Only auto-fix HIGH confidence fixes (confidence > 0.9)." (Section 8.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-34 / Tech-48
- **Recommendation:** (a) Which confidence score -- the verification confidence or the fix confidence (DocFix has its own `confidence` field)? (b) The GitHub App has `contents: read` permission (Section 12.1) -- it needs `contents: write` to push commits. (c) What if the PR branch is on a fork? GitHub Apps cannot push to fork branches. (d) What if the PR branch has "require signed commits" or other branch protection rules? (e) Is auto-fix in MVP? Section 14.1 says "Not in scope for MVP: ... Layer 5: auto-fix commits" but the configuration schema in Appendix A includes `auto_fix` settings. Remove auto-fix from the config schema if it is not MVP.

### I14: Code snippet preparation rules differ by tier with undefined details
- **Quote:** Tier 3: "entity code up to 200 lines, truncate to 2000 tokens max" (Section 6.2). Tier 4: "entity-mapped claims get full entity code (up to 500 lines); file-mapped claims get first 300 lines; multi-file claims get up to 3 files, 200 lines each; hard cap 4000 tokens" (Section 6.2).
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-21
- **Recommendation:** These are different evidence assembly rules for different tiers, which is fine. But: (a) What unit is "200 lines" / "500 lines" -- lines of code after stripping comments and blank lines, or raw lines? (b) How are tokens counted and which tokenizer is used? (c) What happens when the hard cap is exceeded -- truncate from the end, from the middle, or summarize?

### I15: Default code_patterns.include is too narrow
- **Quote:** "Default: src/**, lib/**" (Appendix A, code_patterns.include)
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Source:** PM-40 / Tech-38
- **Recommendation:** Many repos use different structures: `app/`, `packages/`, `cmd/`, `internal/`, `pkg/`, root-level `.py` files, etc. If the default only indexes `src/**` and `lib/**`, repos with different structures will have empty indexes, causing mapping failures (claims reference code that is not indexed). Options: (a) Default to `**/*` with exclusions. (b) Auto-detect project structure (look for package.json, pyproject.toml, etc. and infer source roots). (c) Default to `**/*` with language-specific file extensions. This significantly affects out-of-box experience.

### I16: Default doc_patterns.include is "Standard doc locations" with no concrete definition
- **Quote:** "Default: Standard doc locations" (Appendix A, doc_patterns.include)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-39
- **Recommendation:** Define exactly what "Standard doc locations" means. Is it the DOC_PATTERNS list from the technical reference? The heuristic from PRD Section 4.2? Both? An agent implementing this will need a concrete default value, not a vague label.

### I17: Pricing model for high-activity repos is unresolved
- **Quote:** "Problem: High-activity repos are unprofitable at $19/month. ... Decision needed: pricing structure must account for variable costs." (Section 13.4)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-44
- **Recommendation:** This is an open business decision that should be resolved before MVP ships. If the pricing is $19/repo/month flat, the system needs hard cost controls to prevent loss on high-activity repos. If usage-based pricing is adopted, the billing infrastructure needs to be in the MVP plan. At minimum, decide: flat pricing with a hard cap on scans/month (e.g., 200 PRs included, then disabled or degraded), or usage-based from day one.

### I18: No logging, monitoring, or observability specification
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-61 / Tech-28
- **Recommendation:** For a system that processes webhooks, runs LLM calls, and posts to GitHub, observability is essential for debugging -- especially for a solo founder. Define at minimum: (a) What gets logged (webhook received, job started/completed/failed, LLM call duration/cost, PR comment posted). (b) What metrics are tracked (job queue depth, average scan duration, LLM cost per scan, error rate). (c) Where logs go (stdout, structured JSON, a logging service). (d) A healthcheck endpoint for Railway. (e) Alerting on job queue depth/failures and LLM cost anomalies.

### I19: No specification for handling large doc files exceeding LLM context window
- **Quote:** Section 4.2: "split sections over 2000 words at paragraph boundaries"
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-56 / Tech-40 / Tech-19
- **Recommendation:** The chunking strategy needs more precision: (a) How are heading sections detected (markdown ## markers)? (b) What if a section has no headings (e.g., a flat text file)? (c) What if the entire document is one section over 2000 words? (d) How are paragraph boundaries detected? Additionally, what about generated documentation or API references that are 50,000+ lines? Add file size limits (max file size for processing) and handling for oversized files. For initial full-repo scans, a large repo (10,000+ files, 500+ doc files) may exceed the 10-minute timeout -- specify whether to stream, batch, or show progress.

### I20: GitHub API rate limit management strategy missing
- **Quote:** Section 12.3 mentions "5,000 requests/hour" but no management strategy.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-28 / Tech-50 / Tech-14
- **Recommendation:** With multiple repos installed, the 5,000 req/hour limit is shared across all installations. A single large PR could exhaust significant budget. Specify: (a) Rate limit tracking (read X-RateLimit-Remaining headers). (b) Behavior when approaching the limit (defer non-urgent operations, switch to clone-based access). (c) How to prioritize which repos get API budget. (d) Fallback to shallow clone when API budget is low. For per-repo and per-org rate limiting: specify enforcement mechanism (Redis counters with TTL), key schema, behavior when limit is hit (drop silently, queue for next day, or notify user), and how the system knows which org a repo belongs to.

### I21: Embedding index type (IVFFlat) requires minimum row count
- **Quote:** Technical reference Section 4.2: `CREATE INDEX idx_entities_embedding ON code_entities USING ivfflat (embedding vector_cosine_ops);`
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Source:** Tech-8
- **Recommendation:** IVFFlat indexes require a minimum number of rows to build (the number of lists must be <= number of rows). For a new repo with few entities, the index creation will fail or produce poor results. Options: (a) Use HNSW instead of IVFFlat (no minimum row requirement, better recall). (b) Defer index creation until entity count exceeds a threshold. (c) Use exact search for small repos. The same applies to the claims embedding index.

### I22: Semantic search mapping threshold (0.6) has no calibration data
- **Quote:** Section 5.6: "Similarity threshold: 0.6 initial guess, needs calibration via experiment"
- **Category:** UNTESTABLE
- **Severity:** IMPORTANT
- **Source:** Tech-15
- **Recommendation:** The 0.6 threshold is acknowledged as a guess. OpenAI's text-embedding-3-small cosine similarities tend to cluster in the 0.5-0.8 range for even loosely related text. A 0.6 threshold may produce many false-positive mappings. Recommend starting at 0.7, making it configurable, and documenting where to adjust it.

### I23: tree-sitter WASM memory management in worker process
- **Quote:** Section 1 (tech stack): "tree-sitter (WASM)" for AST parsing.
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Source:** Tech-17
- **Recommendation:** tree-sitter WASM parsers allocate memory per language grammar. When parsing many files across multiple languages, WASM memory grows. Specify: (a) Parser lifecycle (create once, reuse per language, or create per file). (b) Memory limits. (c) How many languages can be loaded simultaneously. On Railway with 512MB-1GB containers, loading multiple tree-sitter WASM grammars plus processing large repos could hit memory limits.

### I24: Database migration strategy is missing
- **Quote:** Repository structure shows `migrations/` directory but no migration strategy.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** Tech-18
- **Recommendation:** Specify: (a) Migration tool (e.g., node-pg-migrate, Prisma, Drizzle). (b) How migrations run on deployment (pre-deploy hook, startup script). (c) Rollback strategy. (d) How schema changes are coordinated with code changes during rapid iteration.

### I25: MCP local mode uses SQLite but main system uses PostgreSQL
- **Quote:** "Reads from local SQLite database (.docalign/claims.db)" (Section 9.3) vs "Database: PostgreSQL on Supabase" (Section 14.1)
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Source:** PM-37 / Tech-20
- **Recommendation:** The system has two different databases for essentially the same data. This means: (a) Two different schema management systems. (b) Data format translation between them. (c) The `docalign scan` CLI command must populate SQLite, not PostgreSQL. Specify: how does `docalign scan` work -- does it run the full pipeline locally and write to SQLite? Does it call the hosted API? Are the schemas identical? This dual-database architecture adds significant implementation complexity.

### I26: Suppression rules in `.docalign.yml` have no matching/execution spec
- **Quote:** "suppress: - file: 'README.md' / pattern: 'badge'" (Appendix A)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-41 / Tech-26
- **Recommendation:** What does `pattern: "badge"` match against? The claim text? The claim type? The extracted value? Is it a regex or a substring match? How does `claim_type` + `package` work as a suppression rule -- does it suppress all version claims for that package, or only when the version is wrong? Define the suppression matching algorithm precisely.

### I27: Dependency version extraction regex has high false positive risk
- **Quote:** Technical reference Section 5.3: `VERSION_PATTERNS` include `/(\w+(?:\.\w+)?)\s+v?(\d+\.\d+(?:\.\d+)?)/gi`
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Source:** Tech-29
- **Recommendation:** This regex will match many non-version patterns in documentation. Examples: "Section 2.1" matches as package "Section" version "2.1". "Table 3.2" matches as "Table" version "3.2". "HTTP 1.1" matches as "HTTP" version "1.1". The regex needs negative patterns or a validation step (check if the captured "package name" is an actual known package in the repo's dependency files). Without filtering, syntactic extraction will produce many false claims.

### I28: Claim embedding generation is not specified
- **Quote:** Section 4.4: "embedding cosine similarity > 0.95 (for semantic claims)" implies claims have embeddings. Section 4.3 outputs do not include embedding.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** Tech-41
- **Recommendation:** The claim deduplication uses embedding similarity, and the MCP `get_docs` tool uses claim embedding search, but the claim extraction pipeline does not specify when embeddings are generated for claims. Add to Layer 1 outputs: (a) When are claim embeddings generated (during extraction or as a post-processing step). (b) What text is embedded (claim_text? claim_text + keywords? claim_text + context?). (c) Which model (same text-embedding-3-small as code entities?).

### I29: `extracted_value` field has different shapes per claim type but uses JSONB with no schema
- **Quote:** Section 4.3 schema: `extracted_value JSONB`; examples show string for path_reference, object {runner, script} for command, object {package, version} for dependency.
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** Tech-49
- **Recommendation:** Define the exact JSONB schema per claim type. An implementing agent needs to know: for `path_reference`, is extracted_value a string or `{path: string}`? For `api_route`, is it `{method: string, path: string}`? For `code_example`, what is the shape? Create a discriminated union type definition for extracted_value keyed by claim_type.

### I30: Evidence assembly for file-mapped claims (no entity) uses poor heuristic
- **Quote:** Section 6.2: "file-mapped claims get first 300 lines"
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** Tech-35
- **Recommendation:** "First 300 lines" of a file may not contain the relevant evidence. If a claim maps to a file but no specific entity, the claim might reference something at line 500. Options: (a) Use keyword hints from the claim to select the most relevant section of the file. (b) Use a cheap embedding search within the file to find the relevant section. (c) Always use a fixed window. "First 300 lines" is a poor heuristic for large files and should be improved or at least documented as a known limitation.

### I31: No specification for multi-language file routing (which parser for which file)
- **Quote:** Section 3.2 says "TypeScript/JavaScript, Python (MVP)" but no routing logic.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** Tech-47
- **Recommendation:** Specify how the system determines which tree-sitter grammar to use for which file. Provide the extension-to-grammar mapping table: .ts/.tsx -> TypeScript, .js/.jsx -> JavaScript, .py -> Python. What about .mjs, .cjs, .mts, .cts files? What about files with no extension (Makefile, Dockerfile)? What about polyglot files?

### I32: MVP scope says "Tier 3+4 combined" -- wording is ambiguous
- **Quote:** "Layer 3: Tier 3+4 combined (skip triage gate, go straight to Claude Sonnet for semantic claims)" (Section 14.1)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Source:** PM-45
- **Recommendation:** "Combined" could mean "merge the triage and verification into a single prompt" rather than "skip Tier 3 entirely." Rewrite to be unambiguous: "For MVP, all semantic claims bypass triage (Tier 3) and go directly to Tier 4 (Claude Sonnet semantic verification)."

### I33: No specification for handling private repos during file access
- **Quote:** "contents: read -- read repo files" (Section 12.1)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-60 / Tech-34
- **Recommendation:** The GitHub App installation token provides access to repo contents. But specify: (a) How is the installation token obtained and refreshed? (Installation tokens expire after 1 hour.) (b) Is the token passed to the worker via the job queue? (c) For shallow clones, how is the token used for git authentication (HTTPS clone URL with token)? These are critical implementation details. (Merged with B5 for secret management; retained here for the specific file-access workflow.)

### I34: "Dismiss all" link has no implementation specification
- **Quote:** "Dismiss all option" (Section 8.2) and "[Dismiss all](link)" in the template.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Source:** PM-32 / Tech-43
- **Recommendation:** What does "Dismiss all" do? What URL does the link point to? Does it call a DocAlign API endpoint? Does it use a GitHub API? Does it hide the comment? Does it record feedback for all findings? Define the mechanism. Also: does "dismiss all" suppress findings permanently or only for this PR?

---

## MINOR Findings

### M1: No marketplace listing or discovery specification
- **Quote:** (no relevant quote -- this is entirely absent)
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-2
- **Recommendation:** Out of scope for PRD (marketing), but note that the agent building the GitHub App will need to know what permissions to request at install time, what description to show, and what categories to list under. At minimum, add a subsection to 12.1 specifying the marketplace metadata fields.

### M2: No specification for handling monorepos or multi-package repos
- **Quote:** (absent -- the PRD assumes a single package.json, single project)
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-10
- **Recommendation:** Many repos have multiple `package.json` files (monorepo workspaces, nested projects). The index stores `file_path` relative to repo root, but dependency lookups like `getDependencyVersion(repoId, packageName)` assume a single set of dependencies. Clarify behavior: does the system check ALL `package.json` files? Return the first match? This can be deferred to v2 but should be explicitly noted as a known limitation.

### M3: RST file support claimed but no extraction logic defined
- **Quote:** "Documentation files (markdown, mdx, rst)" (Section 4.3, Inputs)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-11
- **Recommendation:** RST (reStructuredText) uses completely different syntax from Markdown (different heading, code block, and link syntax). The regex patterns in the technical reference are all Markdown-oriented. Either remove RST from MVP scope or add RST-specific patterns. Recommendation: remove RST from MVP, add to v2.

### M4: PRODUCT-VISION.md includes CHANGELOG.md as a doc to scan; PRD excludes it
- **Quote:** PRODUCT-VISION.md: "CHANGELOG.md" listed in doc file examples (Section 4, Layer 1). PRD technical reference: `'**/CHANGELOG.md'` is in DOC_EXCLUDE.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-13
- **Recommendation:** The PRD is correct to exclude changelogs (they are historical, not claims about current state). Confirm the PRD is canonical and note the vision doc is outdated on this point.

### M5: PR flow merge/dedup of affected claims is underspecified
- **Quote:** "Merge, deduplicate, and run verification pipeline" (Section 7.2, step 8)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-15
- **Recommendation:** Specify dedup key. The natural key is `claim.id` -- if the same claim appears in both the reverse-index results and the doc-change results, deduplicate by claim ID. Confirm this is the intended behavior.

### M6: Tier 4 semantic verification cost estimate inconsistency
- **Quote:** Section 6.4: "~$0.003-0.02 per claim" for Tier 4 vs Section 13.1: "$0.012" per semantic verification call
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-20
- **Recommendation:** The range and the point estimate are not contradictory but an agent needs a single number for budget calculations. Clarify: the range represents variable evidence sizes (small claim = fewer tokens = cheaper, architecture claim = more tokens = more expensive). The $0.012 is the average/typical case.

### M7: Tier 3 is both "not in MVP" and described in detail depending on section
- **Quote:** Section 14.1 says "Layer 3: Tier 3+4 combined (skip triage gate)" AND Section 6.2 describes the triage gate as part of the verification pipeline.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-19
- **Recommendation:** The intent is clear (skip triage in MVP, add it in v2), but an agent reading top to bottom might implement it. Add a clear annotation to Section 6.2 stating that Tier 3 is skipped in MVP and all semantic claims go directly to Tier 4.

### M8: Symbol search confidence is hardcoded at 0.85 with no rationale
- **Quote:** "Confidence: 0.85" (Section 5.2, Step 2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-25
- **Recommendation:** Explain why 0.85. Is this because symbol name match implies high confidence but not certainty? Document the rationale so future tuning has context. Also: does this value vary by claim type or match quality (exact match vs partial match)?

### M9: Semantic search confidence scaling factor is arbitrary
- **Quote:** Technical reference: `confidence: r.similarity * 0.8` (Section 3.3) -- "scale down: similarity != certainty"
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-26
- **Recommendation:** The 0.8 scaling factor is arbitrary. Document rationale. With a similarity threshold of 0.6 and a 0.8 scaling factor, the minimum mapping confidence from semantic search is 0.48. Is that intentional? Should it interact with the "high-confidence" stop condition from I7?

### M10: Rate limit enforcement mechanism not specified
- **Quote:** "Per-repo rate limit: max 100 scans per day" (Section 7.4)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-28
- **Recommendation:** How is this enforced? Counter in the database? Redis counter? What happens when the limit is hit -- silently dropped, or comment saying "rate limit reached"? What timezone defines "per day"? UTC? Repo owner's timezone?

### M11: Health score formula edge case -- divide by zero
- **Quote:** "Score = verified claims / (total claims - pending claims)" (Section 8.2)
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Source:** PM-35
- **Recommendation:** If all claims are pending (e.g., right after initial extraction, before any verification), the denominator is zero. Define the behavior: return null? Return 0? Return 1?

### M12: Layer 6 MCP `get_docs` search mechanism not specified
- **Quote:** "Search project documentation for information about a topic" (Section 9.2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-36
- **Recommendation:** Does this search claim text embeddings or doc section embeddings? What is returned -- raw doc file content, claim text, or original markdown section? How are results ranked and truncated? Since MCP is v2, this has time to be resolved.

### M13: Suppression rule "2+ times" has no time window
- **Quote:** "If the same claim has been flagged and dismissed 2+ times, suppress future flags" (Section 10.2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-38
- **Recommendation:** Over what time window? If a claim was dismissed once in January and once in August, is that 2+ dismissals? The code might change between those times. Specify a time window or clarify that the count is lifetime (and how to reset it if the claim text changes).

### M14: claims table has "verification_status" but no FK to verification result
- **Quote:** Claims table schema (technical reference Section 4.3) has `verification_status` and `last_verified_at` but no FK to the verification result.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-42
- **Recommendation:** Add a `last_verification_result_id` FK to the claims table so you can trace why a claim has its current status.

### M15: No index on scan_runs for repo_id
- **Quote:** scan_runs table (technical reference Section 4.8) has no indexes defined.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-43
- **Recommendation:** Add `CREATE INDEX idx_scan_runs_repo ON scan_runs(repo_id)` for querying scan history by repo.

### M16: v2 scope includes "Developer feedback collection" but references broken mechanism
- **Quote:** "Developer feedback collection (thumbs up/down on PR comments)" (Section 14.2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-46
- **Recommendation:** Since B6 established that GitHub reactions don't work per-finding, the v2 scope should reference the redesigned feedback mechanism, not the original "reactions" approach.

### M17: Go and Rust language support listed for v2 but no tree-sitter queries defined
- **Quote:** "Go and Rust language support" (Section 14.2)
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-47
- **Recommendation:** The technical reference (Section 6.2) lists the languages and their tree-sitter grammars but provides no query patterns for Go or Rust. Fine for v2 planning but should be noted as work to be done.

### M18: Experiment 15.1 success criteria conflict
- **Quote:** "Precision >= 70% ... Over-extraction < 20% of total output" (Section 15.1)
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-48
- **Recommendation:** If precision >= 70%, that means up to 30% of extracted claims are not genuinely testable. But over-extraction must be < 20%. These two criteria conflict unless "precision" includes duplicates. Reconcile the definitions.

### M19: Experiment 15.5 -- "Zero clearly absurd findings" is untestable
- **Quote:** "Zero findings that are clearly absurd (would damage credibility)" (Section 15.5)
- **Category:** UNTESTABLE
- **Severity:** MINOR
- **Source:** PM-49
- **Recommendation:** "Clearly absurd" is subjective. Define objective criteria for what makes a finding "absurd" (e.g., finding claims a file doesn't exist when the claim doesn't reference a file), or accept this as a qualitative assessment and note it as such.

### M20: Term "Finding" vs "Verification Result" used inconsistently
- **Quote:** Glossary defines "Finding" as "A claim that has been determined to be drifted." Section 6.3 outputs are called "Verification Results." Section 7.2 step 9 says "actionable findings (drifted claims only)."
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-50
- **Recommendation:** Clarify: a VerificationResult is the output of Layer 3. A Finding is a VerificationResult where verdict = 'drifted'. Use "finding" exclusively for drifted results in all user-facing contexts. Use "verification result" for all results in system contexts.

### M21: Health score is percentage in some places and 0-1 decimal in others
- **Quote:** "94% (467/497 claims verified)" in PR comment template vs `score: verified.length / (claims.length - pending.length)` returning 0-1 decimal.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-51
- **Recommendation:** Standardize: store as 0-1 decimal, display as percentage. Note this convention.

### M22: No specification for PR to a non-default branch
- **Quote:** Data flow assumes PR trigger, but doesn't specify which base branches are monitored.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-53
- **Recommendation:** Does DocAlign only trigger on PRs targeting the default branch? Or any PR? Most CI tools only care about PRs to main/master. Specify the behavior.

### M23: No specification for what happens when the GitHub App is uninstalled
- **Quote:** "installation (app installed/uninstalled)" (Section 12.1) -- webhook event listed but handler behavior not defined.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-54 / Tech-52
- **Recommendation:** When the app is uninstalled, should the system: (a) Delete all repo data (GDPR compliance)? (b) Soft-delete (mark as inactive)? (c) Keep data for N days in case of reinstall? This affects database size, privacy, and re-install experience.

### M24: No GitHub API version pinning
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** PM-55
- **Recommendation:** Specify which GitHub REST API version to target, or note that the implementation should pin the API version header (`X-GitHub-Api-Version`).

### M25: No specification for `checks: write` permission usage
- **Quote:** "checks: write -- (optional) create check runs instead of/in addition to comments" (Section 12.1)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** PM-59
- **Recommendation:** Is this in MVP or not? "(optional)" is ambiguous -- optional for the user, or optional for the implementation? If it is used, define the check run name, status, and summary text. If it is not MVP, remove it from the permissions list or mark as "requested at install for future use."

### M26: No `.docalign.yml` parsing failure behavior
- **Quote:** "Users can configure DocAlign behavior via .docalign.yml in the repo root." (Appendix A)
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Source:** PM-62 / Tech-32
- **Recommendation:** What happens if the YAML is malformed? What if it contains unknown keys? What if values are out of range? Specify: (a) Validation library (Zod, Joi). (b) Error behavior (fall back to defaults, fail the scan, post a warning comment). (c) Value constraints (min/max for numeric fields, allowed values for enums).

### M27: `searchRoutes` method referenced but not in CodebaseIndex interface
- **Quote:** Technical reference Section 3.4: `const alternatives = await index.searchRoutes(claim.repoId, path);`
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** Tech-22
- **Recommendation:** The `CodebaseIndex` interface defines `findRoute(repoId, method, path)` but not `searchRoutes(repoId, path)`. Add `searchRoutes` to the interface or clarify that `findRoute` handles partial/fuzzy matching.

### M28: Claim extraction prompt does not specify model parameters
- **Quote:** Section 7.1 (P-EXTRACT prompt template) specifies the prompt text but not model parameters.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** Tech-23
- **Recommendation:** Specify: temperature (0 for deterministic extraction), max_tokens, response_format (JSON mode vs structured outputs). For structured output with GPT-4o-mini, specify whether to use `response_format: { type: "json_schema", ... }` or `response_format: { type: "json_object" }`.

### M29: Verification prompt does not handle multi-file evidence format
- **Quote:** Section 7.3 (P-VERIFY prompt): `{for each mapped code file/entity:}` uses pseudo-template syntax.
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** Tech-24
- **Recommendation:** Specify the concrete template rendering logic: how are multiple evidence files concatenated? Is there a separator? What happens when total evidence exceeds the 4000-token cap -- which files are truncated first?

### M30: File path regex will match URLs and image paths
- **Quote:** Technical reference Section 5.1: `` /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g ``
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Source:** Tech-30
- **Recommendation:** This regex matches anything in backticks with a dot-extension, including: `image.png`, `style.css`, `README.md` (self-reference), URLs like `example.com`. The comment says "Exclude: URLs, anchor links, common false positives" but no exclusion patterns are provided. Specify the exclusion list.

### M31: Command extraction from code blocks captures all lines, not just commands
- **Quote:** Technical reference Section 5.2: `/```(?:bash|sh|shell|zsh|console)?\n((?:.*\n)*?)```/g`
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Source:** Tech-31
- **Recommendation:** A bash code block may contain output, comments, and environment setup alongside actual commands. Specify how to distinguish commands from output (look for `$` or `>` prompts, or take the first line only).

### M32: Scheduled scan cron implementation details missing
- **Quote:** Section 7.2: "Trigger: Scheduled Full Scan" with no implementation detail.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** Tech-33
- **Recommendation:** How is the weekly cron scheduled? Options: external cron service (Railway cron), in-process cron (node-cron), BullMQ repeatable jobs. For multi-repo, does each repo get its own cron entry?

### M33: Co-change tracking stores unbounded data
- **Quote:** Section 4.7: `co_changes` table records every code+doc pair per commit.
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Source:** Tech-37
- **Recommendation:** Specify retention policy (keep last 6 months? Aggregate instead of storing individual records?). Without cleanup, the database grows unboundedly.

### M34: scan_runs table defined after verification_results table in schema
- **Quote:** Technical reference Section 4.5: `scan_run_id UUID REFERENCES scan_runs(id)` in verification_results, but scan_runs is defined in Section 4.8.
- **Category:** MINOR
- **Severity:** MINOR
- **Source:** Tech-42
- **Recommendation:** The SQL schema ordering matters for migrations. Ensure the migration order creates tables in dependency order: repos -> scan_runs -> code_entities -> claims -> claim_mappings -> verification_results -> feedback -> co_changes.

### M35: PRODUCT-VISION.md says "get_verified_docs" but PRD says "get_docs"
- **Quote:** PRODUCT-VISION.md: `get_verified_docs(topic)`. PRD Section 9.2: `get_docs`.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** PM-58
- **Recommendation:** The PRD is canonical. Note the vision doc has the old name.

### M36: PRODUCT-VISION.md says 365-day half-life; PRD says 180-day
- **Quote:** PRODUCT-VISION.md Section Layer 7: "365-day half-life"; PRD technical reference: "180-day half-life"
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Source:** Tech-46
- **Recommendation:** Pick one. 180-day (from PRD) is more aggressive and probably more appropriate for fast-moving codebases. Update PRODUCT-VISION.md.

### M37: No specification for handling binary files or images in doc scanning
- **Quote:** Section 4.2: "Parse documentation files (markdown, mdx, rst)"
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Source:** Tech-45
- **Recommendation:** Markdown files may contain base64-encoded images, HTML img tags, or SVG inline content. `.mdx` files may contain JSX components. Specify: strip non-text content before processing.

### M38: No data retention or cleanup policy
- **Quote:** No section addresses data retention.
- **Category:** MISSING
- **Severity:** MINOR
- **Source:** Tech-51
- **Recommendation:** Specify how long data is retained: (a) verification_results: keep last N per claim, or keep all? (b) scan_runs: archive after 90 days? (c) feedback: keep forever? Without cleanup, the database will grow unboundedly.

---

## Questions for Founder

### Onboarding & First-Run Experience

**Q1: What happens on first install?**
Does the system run an automatic full scan when the GitHub App is installed on a repo? If yes, how long is acceptable for this initial scan (1 min? 5 min? 10 min?)? What does the user see while it runs? What if it fails? A full scan on a medium repo costs $3-12 with MVP pricing (no triage gate) -- this is a real cost with no revenue yet if the user is on free tier.
- Options: (A) Full scan on install. (B) Wait for first PR. (C) Lightweight partial scan.
- References: B1, B2
- Reviewer recommendation: Define this as a new section. Option A gives immediate value but has cost risk. Option B delays time-to-value. Option C is a compromise (scan only doc files, skip code indexing until first PR).

**Q2: What should the system do when zero findings are found on a PR?**
Post nothing? Post a green "all clear" message? Create a passing GitHub Check?
- Options: (A) Silent (current implied behavior). (B) "All clear" comment. (C) GitHub Check status. (D) Silent until first finding, then always report.
- Reference: I10
- Reviewer recommendation: At minimum, set a GitHub Check status to "passed" so the user knows the system is active. This requires the `checks: write` permission.

### PR Output Strategy (resolve B6, B7, B8 together)

**Q3: How should per-finding feedback work given that GitHub reactions are per-comment, not per-section?**
- Options: (A) One comment per finding (noisy). (B) Review comments on specific lines (enables suggestions but fragments the report). (C) Custom web links per finding via DocAlign API. (D) Hybrid: summary comment + individual review comments with suggestions.
- References: B6, B7
- Reviewer recommendation: Option D (hybrid) provides the best UX -- summary comment for overview, review comments for actionable suggestions. This also solves the GitHub suggestion syntax problem (B7), since review comments support suggestions natively.

**Q4: Should PR comments be edited on subsequent pushes, or should new comments be posted?**
- Options: (A) Edit existing comment. (B) New comment per push. (C) Edit with "Updated at" note.
- Reference: B8
- Reviewer recommendation: Edit existing comment (Option A or C). Most CI bots do this. Reduces noise.

### Cost & Financial Viability

**Q5: Should the triage gate be moved into MVP scope?**
The cost analysis shows MVP without the triage gate is 1.5-2x more expensive per PR than estimated. Medium-activity repos drop to 21-37% gross margin at $19/repo/month. The triage gate implementation is relatively simple (one GPT-4o-mini prompt per semantic claim) and would restore the cost model to its intended range.
- Options: (A) Move triage to MVP. (B) Keep MVP without triage, accept higher costs. (C) Keep without triage but add hard cost caps per repo.
- Reference: B3
- Reviewer recommendation: Move triage into MVP. The implementation cost is low and the financial impact is significant.

**Q6: What is the pricing model for high-activity repos?**
Flat with a cap? Usage-based? Tiered? This affects whether cost controls need to be in MVP.
- Options: (A) Flat $19 with hard cap (e.g., 200 PRs/month). (B) Usage-based from day one. (C) Tiered ($19/small, $49/medium, $99/large).
- Reference: I17
- Reviewer recommendation: Flat with a hard cap is simplest for MVP. Add a "scan limit reached" comment on PRs beyond the cap.

### Verification & Accuracy

**Q7: Should `code_example` claims be verified in MVP, or deferred?**
Code examples in documentation are a very common source of drift and high user value. But the PRD has no extraction or verification spec for them. Verifying code blocks is a significantly harder problem than verifying path/command/version claims.
- Options: (A) MVP: extract sub-claims from code blocks (imports, function names) and verify those. (B) Defer entirely to v2. (C) MVP: flag code blocks as "unverified" in the health score.
- References: B10
- Reviewer recommendation: Option A is ambitious but high-value. Option B is safer for timeline. At minimum, do Option C so users know code examples exist but are not yet checked.

**Q8: What happens with "uncertain" verification verdicts?**
- Options: (A) Show in PR comment with "? UNCERTAIN" treatment. (B) Drop silently. (C) Drop but count in health score.
- Reference: I9
- Reviewer recommendation: Option A is most transparent and builds trust.

### Configuration & Defaults

**Q9: What is the default code indexing scope?**
Only `src/**` and `lib/**`, or auto-detect, or index everything?
- Options: (A) `src/**, lib/**` (current default -- will miss many repos). (B) `**` with explicit excludes (node_modules, .git, etc.). (C) Auto-detect from project config files.
- Reference: I15
- Reviewer recommendation: Option B is safest for out-of-box experience. Exclude `node_modules/`, `.git/`, `dist/`, `build/`, `vendor/`, `__pycache__/`.

### Infrastructure & Operations

**Q10: Should the GitHub App request `checks: write` permission in MVP?**
Using GitHub Checks provides a better UX (green/red status in the PR checks tab) but adds implementation complexity.
- Options: (A) Yes, use Checks. (B) No, comments only. (C) Request permission at install but implement later.
- Reference: M25, I10
- Reviewer recommendation: Option C -- request the permission now (avoids re-install later) but implement in v2.

**Q11: What is the target behavior for concurrent PR scans on the same repo?**
- Options: (A) Allow parallel with potential index conflicts. (B) Serialize with a per-repo lock. (C) Allow parallel with snapshot isolation.
- Reference: B13
- Reviewer recommendation: Option B (per-repo lock) is simplest and safest for MVP. Performance cost is acceptable since scan jobs take seconds, not minutes, for incremental updates.

**Q12: Should PRs targeting non-default branches be scanned?**
- Options: (A) Only default branch. (B) All branches. (C) Configurable.
- Reference: M22
- Reviewer recommendation: Option A for MVP. Most documentation drift matters on the main branch.

**Q13: What is the error UX for scan failures?**
When a PR scan fails (LLM API down, timeout, rate limit), what should the user see?
- Options: (A) No comment (silent failure). (B) Error comment on PR. (C) GitHub Check Run with failure status.
- Reference: B4
- Reviewer recommendation: Option B -- post a brief error comment so the user knows a scan was attempted. Silent failure destroys trust.

**Q14: What happens when a user uninstalls the app?**
- Options: (A) Delete all data immediately (GDPR). (B) Soft-delete, keep 30 days. (C) Keep indefinitely.
- Reference: M23
- Reviewer recommendation: Option B -- soft-delete with 30-day retention for re-install, then hard delete.

### Architecture

**Q15: Dual database architecture (PostgreSQL + SQLite) for MCP -- which approach?**
The MCP local mode uses SQLite while the GitHub App uses PostgreSQL. This means maintaining two schema definitions and a data translation layer.
- Options: (A) Keep dual DB (more implementation work). (B) MCP local mode queries hosted API (requires internet). (C) MCP local mode uses a SQLite export from PostgreSQL.
- Reference: I25
- Reviewer recommendation: Since MCP is v2, defer this decision. For now, document that MCP local mode will be designed in Phase 2+ and remove SQLite references from MVP scope.

**Q16: Should the triage gate (Tier 3) be in MVP?**
(Same as Q5 but from the architecture angle.) If triage is added, the pipeline is: syntactic -> triage (GPT-4o-mini) -> semantic (Claude Sonnet). If not, the pipeline is: syntactic -> semantic (all). This affects the pipeline architecture, the cost model, and the worker job design.
- Options: Same as Q5.
- Reference: B3, I32
- Reviewer recommendation: Yes. It simplifies the cost model, improves margins, and the implementation is a single LLM prompt.
