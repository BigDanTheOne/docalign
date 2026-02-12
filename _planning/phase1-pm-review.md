# Phase 1 Review: Product Manager

## Summary

**Total findings: 62**
- BLOCKING: 14
- IMPORTANT: 29
- MINOR: 19

**Top 3 most critical issues:**

1. **No onboarding / first-run specification (Finding 1).** The PRD never describes what happens when a user installs the GitHub App for the first time. There is no initial scan trigger, no first-PR experience, no "time to first value" design. An implementing agent would have no idea how to build the installation flow.

2. **No error handling or failure mode specification anywhere in the PRD (Finding 5).** Every layer describes the happy path. No layer describes what happens when an LLM call fails, when the GitHub API rate-limits us, when a webhook is malformed, when the database is down, or when a job times out. An agent implementing this would produce zero error handling.

3. **PR comment interaction model is unimplementable as specified (Finding 31).** The PRD says thumbs up/down reactions on findings collect feedback, but GitHub reactions are on entire comments, not on individual sections within a comment. The PRD also references a "Dismiss all" link but never specifies what URL it points to or what API it calls.

---

## Section 1: User Journey Trace

### Journey: GitHub App Installation Through First PR Comment

**Step 1: User discovers DocAlign**
- How? GitHub App Marketplace listing? Direct URL? Referral?
- **GAP:** No marketplace listing content specified. No landing page described. No install CTA defined. (See Finding 2.)

**Step 2: User installs GitHub App on a repository**
- Input: User clicks "Install" on GitHub Marketplace.
- Output: GitHub sends an `installation` webhook event.
- **GAP:** What happens when we receive the `installation` webhook? The PRD mentions this webhook in Section 12.1 but never describes the handler behavior. Does the system run an initial full scan? Does it index the repo? Does it just store the installation and wait for the first PR? (See Finding 1.)

**Step 3: System performs initial setup for the repo**
- **GAP:** Completely undefined. There is no "repo onboarding" flow described anywhere. Questions: Does the system clone the repo? Build the initial codebase index (Layer 0)? Extract all claims (Layer 1)? Create initial mappings (Layer 2)? Run an initial verification pass (Layer 3)? How long does this take? What does the user see while it runs? What if it fails? (See Finding 1.)

**Step 4: User opens a PR (or pushes to an existing PR)**
- Input: GitHub webhook `pull_request.opened` or `pull_request.synchronize`.
- Output: Webhook received by API server, job queued.
- Transition: Job worker picks up the job.
- **GAP:** What if the initial index has never been built (user installed the app and immediately opened a PR before any initial scan)? The PR flow in Section 7.2 assumes the codebase index and claim database already exist. It says "Find claims affected by code changes using the reverse index" -- but if no claims have been extracted yet, the reverse index is empty. (See Finding 3.)

**Step 5: System extracts changed files from PR diff**
- Input: PR metadata (owner, repo, pull_number).
- Output: List of changed files, separated into doc files and code files.
- Transition: Feeds into Layer 0 (index update), Layer 1 (claim re-extraction), Layer 2 (reverse index lookup).
- **GAP:** What counts as a "documentation file" vs a "code file"? The PRD defines DOC_PATTERNS in the technical reference (Section 3.2) but the PRD itself (Section 4.2) says "Scan standard documentation locations: README files, docs/ directories, ADRs, agent instruction files." The patterns in the technical reference are more specific but are labeled as "extracted" detail subject to change. An agent might implement different detection logic depending on which source it reads. (See Finding 12.)

**Step 6: System updates codebase index (Layer 0)**
- Input: Changed code files.
- Output: Updated index with new/modified/deleted entities.
- **OK:** Well-defined in Section 3.5 (incremental update flow). Inputs and outputs are clear.

**Step 7: System re-extracts claims for changed doc files (Layer 1)**
- Input: Changed doc files.
- Output: New/updated claim records.
- **GAP:** What happens on the very first PR when NO claims exist yet? Should the system extract claims from ALL doc files on first run, or only from the doc files that changed in this PR? If only changed doc files, then claims from unchanged doc files won't exist, and no reverse-index lookup will find them. (See Finding 3.)

**Step 8: System finds affected claims via reverse index (Layer 2)**
- Input: Changed code files.
- Output: Claims mapped to those code files.
- **GAP:** Same bootstrapping problem. If mappings don't exist yet, this returns nothing. (See Finding 3.)

**Step 9: System merges claim lists and runs verification (Layer 3)**
- Input: Affected claims + doc-change claims, merged and deduplicated.
- Output: Verification results with verdicts.
- **GAP:** Deduplication logic is defined for claim extraction (Section 4.4) but not for the merge step in the PR flow. If the same claim appears in both the "affected by code changes" list and the "from changed doc files" list, how is it deduplicated? By claim ID? (See Finding 15.)

**Step 10: System filters to drifted claims only**
- Input: All verification results.
- Output: Findings (drifted claims only).
- **GAP:** What about "uncertain" verdicts? The PRD says filter to "drifted" only (Section 7.2 step 9), but Section 6.3 defines three possible verdicts: verified, drifted, uncertain. Are uncertain claims silently dropped? Should the user be told about uncertain claims? (See Finding 16.)

**Step 11: System posts PR comment (Layer 5)**
- Input: Findings.
- Output: GitHub PR comment.
- **GAP:** What if there are zero findings? The technical reference code (Section 3.5) says `if (findings.length > 0) { await reporter.postPRComment(...) }`. So no comment is posted if everything is fine. But there is no specification for whether this is correct behavior. Should a "all docs are healthy" comment be posted? A check status? Nothing? (See Finding 17.)

**Step 12: User reads PR comment and reacts**
- Input: PR comment with findings.
- Output: User takes action (accept suggestion, dismiss, react with thumbs up/down).
- **GAP:** The feedback collection mechanism is not implementable as described. (See Finding 31.)

**Step 13: System records feedback (Layer 7)**
- **GAP:** Layer 7 is not in MVP scope per Section 14.1. But Section 8.2 says "Feedback prompts: thumbs up/down reactions, dismiss all option" as part of the PR comment format, which IS MVP. So feedback UI is shipped in MVP but feedback recording is not? This creates a confusing UX where users can react but nothing happens. (See Finding 18.)

---

## Section 2: Findings

### Finding 1: No installation/onboarding flow specified
- **Quote:** "Webhook events: ... installation (app installed/uninstalled)" (Section 12.1) -- and nothing else about what happens on install.
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** Add a new section "Onboarding Flow" that defines: (a) What the `installation` webhook handler does (create repo record, queue initial scan?). (b) Whether an initial full scan runs on install. (c) Time budget for initial scan (how long before user gets first value?). (d) What happens if initial scan exceeds timeout. (e) Whether there is any notification to the user that setup is complete. (f) What the database state looks like after install but before any PR.

### Finding 2: No marketplace listing or discovery specification
- **Quote:** (no relevant quote -- this is entirely absent)
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Out of scope for PRD (marketing), but note that the agent building the GitHub App will need to know what permissions to request at install time, what description to show, and what categories to list under. At minimum, add a subsection to 12.1 specifying the marketplace metadata fields.

### Finding 3: First-PR bootstrapping problem -- no claims or index exist yet
- **Quote:** "Layer 4 extracts changed files from PR diff ... Layer 2 queries: 'Which claims are mapped to any of these changed code files?'" (Section 2.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** Define the bootstrapping behavior explicitly. Option A: On install, run a full initial scan (extract all claims, build full index, create all mappings) before the first PR can be processed. Option B: On first PR, detect that no claims exist and run a full extraction/mapping pass instead of incremental. Option C: First PR only checks claims from doc files that were changed in the PR itself (no reverse-index lookup). Document the chosen behavior and its tradeoffs.

### Finding 4: No specification for how the system accesses repo files during initial setup
- **Quote:** "PR-triggered checks (few files): Read files via GitHub API ... Full scans (many files): Shallow clone" (Section 12.3)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** Specify which file access strategy is used for the initial onboarding scan (if it exists). A new repo install likely requires reading many files (all docs, code for indexing), which means a shallow clone. But the PRD only describes file access strategies for PR checks and full scans, not for initial setup.

### Finding 5: No error handling specification anywhere
- **Quote:** (no relevant quote -- error handling is never mentioned in any layer)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** For EVERY layer, define: (a) What errors can occur. (b) What the system does on each error. (c) What the user sees. Minimum error scenarios to cover: LLM API failure (rate limit, timeout, bad response), GitHub API failure (rate limit, permission denied, repo deleted), database failure, job timeout (10 min exceeded), webhook signature validation failure, invalid/corrupt repo content (binary files in doc paths, huge files), AST parsing failure for unsupported syntax.

### Finding 6: No webhook signature validation mentioned
- **Quote:** "Webhooks are received by an API server" (Section 12.2)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** GitHub App webhooks must be validated using the webhook secret to prevent spoofed events. This is a security requirement. Add to Section 12.1 or a Security section.

### Finding 7: No authentication/authorization model for the API server
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** The API server receives webhooks. Does it serve any other endpoints? The MCP server (future) has its own architecture. But the main API server needs: webhook validation (see Finding 6), possibly a health check endpoint, possibly a status/config endpoint. Define what endpoints exist and how they are secured.

### Finding 8: Layer 0 -- "semantic search" capability listed but embedding model inconsistency
- **Quote:** "Embedding model: OpenAI text-embedding-3-small (1536 dimensions)" (PRD Section 3.4) vs "OpenAI ada-002 for embeddings" (PRODUCT-VISION.md Section 7)
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Recommendation:** The PRD says `text-embedding-3-small` and the product vision says `ada-002`. These are different models with different dimensions and pricing. The PRD is more recent and should be canonical, but resolve this explicitly. Also: `text-embedding-3-small` produces 1536 dimensions by default but supports dimensionality reduction. The schema uses `VECTOR(1536)` -- confirm this is correct for the chosen model.

### Finding 9: Layer 0 -- AST parsing scope for "route definitions" is underspecified
- **Quote:** "API route definitions: HTTP method, path, handler, file, line" (Section 3.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Route definitions vary wildly by framework. Express uses `app.get('/path', handler)`. Fastify uses `fastify.route({ method: 'GET', url: '/path' })`. Flask uses `@app.route('/path')`. Django uses `urlpatterns = [path('api/', ...)]`. NestJS uses `@Get('/path')`. The tree-sitter queries in the technical reference (Section 6.1) show an Express-style pattern only. Specify which frameworks are supported in MVP and which query patterns apply. Without this, an agent will implement only Express-style detection and miss all others.

### Finding 10: Layer 0 -- No specification for handling monorepos or multi-package repos
- **Quote:** (absent -- the PRD assumes a single package.json, single project)
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Many repos have multiple `package.json` files (monorepo workspaces, nested projects). The index stores `file_path` relative to repo root, but dependency lookups like `getDependencyVersion(repoId, packageName)` assume a single set of dependencies. Clarify behavior: does the system check ALL `package.json` files? Return the first match? Return all matches? This can be deferred to v2 but should be explicitly noted as a known limitation.

### Finding 11: Layer 1 -- "rst" file support claimed but no extraction logic defined
- **Quote:** "Documentation files (markdown, mdx, rst)" (Section 4.3, Inputs)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** RST (reStructuredText) uses completely different syntax from Markdown (different heading, code block, and link syntax). The regex patterns in the technical reference (Section 5) are all Markdown-oriented. Either remove RST from MVP scope or add RST-specific patterns. Recommendation: remove RST from MVP, add to v2.

### Finding 12: Layer 1 -- Doc file discovery conflict between PRD and technical reference
- **Quote:** "Scan standard documentation locations: README files, docs/ directories, ADRs, agent instruction files (CLAUDE.md, AGENTS.md, .cursorrules), API docs" (PRD Section 4.2) vs detailed DOC_PATTERNS list in technical reference Section 3.2 which includes `wiki/**/*.md`, `**/CLAUDE.md`, `**/AGENTS.md`, etc.
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Recommendation:** The PRD description is vaguer and less complete than the technical reference patterns. But the PRD also says "Heuristic for unknown repos: scan all `.md` files in root + first two directory levels" -- this heuristic could match files NOT in the DOC_PATTERNS list. Decide: is DOC_PATTERNS the canonical list, or is the heuristic the fallback? Can both run? What takes precedence? This must be a single, unambiguous algorithm.

### Finding 13: Layer 1 -- PRODUCT-VISION.md includes CHANGELOG.md as a doc to scan; PRD excludes it
- **Quote:** PRODUCT-VISION.md: "CHANGELOG.md" listed in doc file examples (Section 4, Layer 1). PRD technical reference: `'**/CHANGELOG.md'` is in DOC_EXCLUDE.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** The PRD is correct to exclude changelogs (they are historical, not claims about current state). Confirm the PRD is canonical and note the vision doc is outdated on this point.

### Finding 14: Layer 1 -- "code_example" claim type has no verification strategy defined
- **Quote:** "code_example: Code blocks that should match reality. Fenced code blocks with imports, function calls. Testability: Syntactic/Semantic" (Section 4.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** The claim taxonomy lists `code_example` but neither Layer 3 (verification) nor any experiment plan addresses how to verify a code example. What does it mean for a code block in docs to "match reality"? Should the imports be resolvable? Should the function calls use correct signatures? Should the entire block be executable? This is a hard problem -- define at least the MVP approach (e.g., extract imports and function names from the code block and verify they exist as syntactic claims) or explicitly exclude `code_example` from MVP verification.

### Finding 15: Layer 4 PR flow -- merge/dedup of affected claims is underspecified
- **Quote:** "Merge, deduplicate, and run verification pipeline" (Section 7.2, step 8)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** Specify dedup key. The natural key is `claim.id` -- if the same claim appears in both the reverse-index results and the doc-change results, deduplicate by claim ID. Confirm this is the intended behavior.

### Finding 16: Uncertain verdicts are silently dropped in PR flow
- **Quote:** "Filter to actionable findings (drifted claims only)" (Section 7.2, step 9)
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** Define behavior for "uncertain" verdicts. Options: (a) Include uncertain findings in PR comment with a different visual treatment (e.g., "? UNCERTAIN" instead of severity badge). (b) Drop them silently. (c) Drop them but count them in the health score. The current spec drops them silently, which means the user never sees claims the system could not verify. This is a product decision that affects trust.

### Finding 17: No specification for zero-findings behavior
- **Quote:** Technical reference Section 3.5 shows `if (findings.length > 0) { await reporter.postPRComment(...) }` -- no else branch.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** When a PR has no drifted claims, should the system: (a) Post nothing (current implied behavior). (b) Post a brief "all clear" comment. (c) Set a GitHub check status to "passed" (green checkmark). (d) Do nothing on the first PR but start posting "all clear" once the user has seen at least one finding. This affects the user's awareness that the tool is active. A user who installs the app and sees nothing on their next 5 PRs may think it is broken.

### Finding 18: Feedback UI is in MVP but feedback processing is not
- **Quote:** PR comment format includes "React with thumbs up or thumbs down" (Section 8.2) but Layer 7 (learning system) is listed as not-in-scope for MVP (Section 14.1).
- **Category:** INCONSISTENT
- **Severity:** IMPORTANT
- **Recommendation:** Either: (a) Remove feedback prompts from MVP PR comment template, or (b) Add minimal feedback recording to MVP (store reactions in DB, no learning/suppression logic yet -- that comes in v2). Option (b) is recommended: collecting data early is valuable even if you don't act on it yet.

### Finding 19: Layer 3 -- Tier 3 (triage gate) is both "not in MVP" and "in MVP" depending on which section you read
- **Quote:** Section 14.1 says "Layer 3: Tier 3+4 combined (skip triage gate, go straight to Claude Sonnet for semantic claims)" AND "Not in scope for MVP: ... Layer 3 Tier 3 (triage gate -- cost optimization)". But Section 6.2 describes the triage gate as part of the verification pipeline.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** The intent is clear (skip triage in MVP, add it in v2 for cost optimization), but an agent reading the PRD from top to bottom would see the full pipeline description and might implement it. Add a clear annotation to Section 6.2 stating that Tier 3 is skipped in MVP and all semantic claims go directly to Tier 4.

### Finding 20: Layer 3 -- Tier 4 semantic verification cost estimate inconsistency
- **Quote:** Section 6.4: "~$0.003-0.02 per claim" for Tier 4 vs Section 13.1: "$0.012" per semantic verification call
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** The range and the point estimate are not contradictory but an agent needs a single number for budget calculations. Clarify: the range represents variable evidence sizes (small claim = fewer tokens = cheaper, architecture claim = more tokens = more expensive). The $0.012 is the average/typical case.

### Finding 21: Layer 3 -- "code snippet preparation" rules are defined in two places differently
- **Quote:** Tier 3: "entity code up to 200 lines, truncate to 2000 tokens max" (Section 6.2). Tier 4: "entity-mapped claims get full entity code (up to 500 lines); file-mapped claims get first 300 lines; multi-file claims get up to 3 files, 200 lines each; hard cap 4000 tokens" (Section 6.2).
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** These are different evidence assembly rules for different tiers, which is fine. But: (a) What unit is "200 lines" / "500 lines"? Lines of code after stripping comments and blank lines? Raw lines? (b) How are tokens counted? Which tokenizer? (c) What happens when the hard cap is exceeded -- truncate from the end? From the middle? Summarize? These details determine the quality of verification.

### Finding 22: Layer 3 -- Dependency version "satisfies" semantics undefined
- **Quote:** Technical reference: `if (semverSatisfies(actualVersion, claimedVersion))` (Section 3.4)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define what "satisfies" means. If docs say "React 18.2" and package.json has `"react": "^18.2.0"`, does that satisfy? What about `"react": "^18.3.0"` -- the actual installed version might be 18.3.1, which is not 18.2. Does the system compare against the version specifier in package.json, or against the resolved version in the lock file? These produce different results. Specify which comparison is done and what constitutes a "match."

### Finding 23: Layer 3 -- "similar filenames" search for renames is unspecified
- **Quote:** "If not, look for similar filenames (likely renames)" (Section 6.2, Tier 1)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define the similarity algorithm. Options: Levenshtein distance on filename, Levenshtein distance on full path, git rename detection (from diff), filename stem matching (same name, different directory). Each produces very different results. Also specify: what threshold of similarity counts as "likely rename"? What if multiple similar files are found?

### Finding 24: Layer 2 -- Mapper "stops as soon as a high-confidence mapping is found" is underspecified
- **Quote:** "The mapper runs four steps in order. It stops as soon as a high-confidence mapping is found." (Section 5.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define "high-confidence." Is it confidence >= 0.9? >= 0.8? >= 1.0? Also: should the mapper really stop at one mapping? A behavior claim might map to multiple files. If Step 1 finds one high-confidence mapping, should Step 2-3 still run to find additional mappings? Define: (a) The confidence threshold for "high-confidence." (b) Whether "stop" means "stop looking for more mappings" or "stop trying lower tiers."

### Finding 25: Layer 2 -- Symbol search confidence is hardcoded at 0.85
- **Quote:** "Confidence: 0.85" (Section 5.2, Step 2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** Explain why 0.85. Is this because symbol name match implies high confidence but not certainty (e.g., two classes might share a name in different modules)? Document the rationale so future tuning has context. Also: does this value vary by claim type or match quality (exact match vs partial match)?

### Finding 26: Layer 2 -- Semantic search confidence calculation inconsistency
- **Quote:** Technical reference: `confidence: r.similarity * 0.8` (Section 3.3) -- "scale down: similarity != certainty"
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** The 0.8 scaling factor is arbitrary. Document rationale. Also: with a similarity threshold of 0.6 and a 0.8 scaling factor, the minimum mapping confidence from semantic search is 0.48. Is that intentional? Should it interact with the "high-confidence" stop condition from Finding 24?

### Finding 27: Layer 4 -- Debounce behavior is underspecified
- **Quote:** "Multiple pushes to the same PR in quick succession: debounce with 30-second window" (Section 7.4)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define the debounce semantics precisely. When a new push arrives within 30 seconds of a previous one: (a) Is the in-progress job cancelled and a new one queued? (b) Is the new push ignored (trailing edge debounce)? (c) Is the new push queued to run after the in-progress job completes? (d) If a job is already past the "index update" stage and into "verification," should it be cancelled? Cancellation vs queuing has very different implementation implications.

### Finding 28: Layer 4 -- Rate limit enforcement mechanism not specified
- **Quote:** "Per-repo rate limit: max 100 scans per day" (Section 7.4)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** How is this enforced? Counter in the database? Redis counter? What happens when the limit is hit -- is the webhook silently dropped, or does the system post a comment saying "rate limit reached"? What timezone defines "per day"? UTC? Repo owner's timezone?

### Finding 29: Layer 5 -- PR comment update vs new comment behavior
- **Quote:** (absent -- never specified)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** When a PR is updated (new push), should the system: (a) Edit the existing DocAlign PR comment with new results, or (b) Post a new comment for each push, or (c) Edit the existing comment and add a "Updated at [timestamp]" note? This is critical for UX. Multiple comments per PR create noise. But editing removes the history of what was found on earlier versions. Most CI bots (CodeRabbit, Codecov) edit their existing comment. Specify the behavior.

### Finding 30: Layer 5 -- PR comment template uses hardcoded example text, not a parameterized template
- **Quote:** The PR comment template in technical reference Section 3.6 shows a full example but does not define the template variables or rendering logic.
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define the template as a parameterized template, not just an example. Specify: (a) How findings are ordered (by severity? by file? by line number?). (b) Maximum findings shown before truncation (what if 30 claims are drifted?). (c) The exact markdown structure for each severity level. (d) Whether the health score line appears always or only when findings exist. An agent implementing from the example alone would hardcode the structure; a template definition lets them implement it correctly for any input.

### Finding 31: PR comment feedback mechanism is not implementable
- **Quote:** "Thumbs up on a finding = confirmed useful ... Thumbs down on a finding = false positive" (Section 8.2)
- **Category:** MISSING
- **Severity:** BLOCKING
- **Recommendation:** GitHub comment reactions (thumbs up/down, etc.) apply to the ENTIRE comment, not to individual sections within it. You cannot react to "Finding 1" separately from "Finding 2" within a single comment. Options to resolve: (a) Post each finding as a separate comment (noisy). (b) Post each finding as a review comment on the specific line (uses PR review API, more complex). (c) Use a custom web link per finding that records the feedback via the DocAlign API. (d) Use GitHub's suggestion feature and track accept/dismiss per suggestion. Choose one and specify the implementation. This is BLOCKING because the feedback system underpins the entire learning loop.

### Finding 32: "Dismiss all" link has no implementation specification
- **Quote:** "Dismiss all option" (Section 8.2) and "[Dismiss all](link)" in the template.
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** What does "Dismiss all" do? What URL does the link point to? Does it call a DocAlign API endpoint? Does it use a GitHub API? Does it hide the comment? Does it record feedback for all findings? Define the mechanism.

### Finding 33: Layer 5 -- GitHub native suggestion syntax requires review comments, not issue comments
- **Quote:** "Where possible, use GitHub's native suggestion syntax so developers can accept with one click" (Section 8.2) and the suggestion format in technical reference Section 3.6.
- **Category:** AMBIGUOUS
- **Severity:** BLOCKING
- **Recommendation:** GitHub suggestion syntax (`\`\`\`suggestion\n...\n\`\`\``) only works in **pull request review comments** posted on specific lines via the Pull Request Review API. It does NOT work in regular PR comments posted via the Issues API. The PRD conflates these two APIs. If findings are posted as a single PR comment (the template in Section 3.6), suggestions will not be click-to-accept. If findings are posted as individual review comments on doc file lines, suggestions will work but the UX is completely different (no summary comment, findings scattered across the diff). Decide which approach to use and redesign the output format accordingly.

### Finding 34: Layer 5 -- Auto-commit fix specification has gaps
- **Quote:** "Create a new commit on the PR branch with fixes. Only auto-fix HIGH confidence fixes (confidence > 0.9). Commit message: docs: fix N documentation claims detected by DocAlign" (Section 8.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** (a) Which confidence score? The verification confidence or the fix confidence? These are different numbers (DocFix has its own `confidence` field). (b) How does the system authenticate to push a commit to the PR branch? The GitHub App has `contents: read` permission (Section 12.1) -- it needs `contents: write` to push commits. (c) What if the PR branch is on a fork? GitHub Apps cannot push to fork branches. (d) What if the auto-fix conflicts with other changes in the PR? (e) Is auto-fix in MVP? Section 14.1 says "Not in scope for MVP: ... Layer 5: auto-fix commits" but the configuration schema in Appendix A includes `auto_fix` settings.

### Finding 35: Layer 5 -- Health score formula edge case: divide by zero
- **Quote:** "Score = verified claims / (total claims - pending claims)" (Section 8.2)
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** If all claims are pending (e.g., right after initial extraction, before any verification), the denominator is zero. Define the behavior: return null/undefined? Return 0? Return 1? Also: the technical reference formula (Section 3.6) uses `claims.length - pending.length` which is the same issue.

### Finding 36: Layer 6 MCP -- "get_docs" tool search mechanism not specified
- **Quote:** "Search project documentation for information about a topic" (Section 9.2)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** The technical reference handler (Section 3.7) says "Embed the query, search claim embeddings for relevant claims, group claims by source file/section." But: (a) Does this search claim text embeddings or doc section embeddings? Claims are individual assertions, not topical sections. A query like "authentication" might match 20 claims from 5 different files. (b) What is returned -- the raw doc file content, or the claim text, or the original markdown section? (c) How are results ranked and truncated? Top-k? Similarity threshold? Since MCP is v2, this has time to be resolved, but it should be flagged.

### Finding 37: Layer 6 MCP -- Local SQLite vs PostgreSQL inconsistency
- **Quote:** "Reads from local SQLite database (.docalign/claims.db)" (Section 9.3) vs "Database: PostgreSQL on Supabase" (Section 14.1)
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** The GitHub App uses PostgreSQL. The MCP local mode uses SQLite. These are different schemas and different query engines. Clarify: is the local SQLite a separate, simplified schema? Is it a dump/export from PostgreSQL? Who generates it -- `docalign scan` (CLI tool, which is v2)?

### Finding 38: Layer 7 -- Suppression rule "2+ times" has no time window
- **Quote:** "If the same claim has been flagged and dismissed 2+ times, suppress future flags" (Section 10.2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** Over what time window? If a claim was dismissed once in January and once in August, is that 2+ dismissals? The code might change between those times, making the second dismissal about a different version. Specify a time window or clarify that the count is lifetime (and how to reset it if the claim text changes).

### Finding 39: Configuration -- Default doc_patterns.include is "Standard doc locations" with no definition
- **Quote:** "Default: Standard doc locations" (Appendix A, doc_patterns.include)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** Define exactly what "Standard doc locations" means. Is it the DOC_PATTERNS list from the technical reference? The heuristic from PRD Section 4.2? Both? An agent implementing this will need a concrete default value, not a vague label.

### Finding 40: Configuration -- Default code_patterns.include is "src/**, lib/**" which misses many repo structures
- **Quote:** "Default: src/**, lib/**" (Appendix A, code_patterns.include)
- **Category:** EDGE_CASE
- **Severity:** IMPORTANT
- **Recommendation:** Many repos use different structures: `app/`, `packages/`, `cmd/`, `internal/`, root-level `.py` files, etc. If the default only indexes `src/**` and `lib/**`, repos with different structures will have empty indexes. Options: (a) Default to `**/*` with exclusions. (b) Auto-detect project structure (look for package.json, pyproject.toml, etc. and infer source roots). (c) Default to `**/*` with language-specific file extensions. This significantly affects out-of-box experience.

### Finding 41: Configuration -- Suppression rules schema is vague
- **Quote:** "suppress: - file: 'README.md' / pattern: 'badge'" (Appendix A)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** What does `pattern: "badge"` match against? The claim text? The claim type? The extracted value? Is it a regex or a substring match? How does `claim_type` + `package` work as a suppression rule -- does it suppress all version claims for that package, or only when the version is wrong? Define the suppression matching algorithm.

### Finding 42: Data model -- claims table has "verification_status" but no "last_verification_result_id"
- **Quote:** Claims table schema (technical reference Section 4.3) has `verification_status` and `last_verified_at` but no FK to the verification result that set that status.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Add a `last_verification_result_id` FK to the claims table so you can trace why a claim has its current status. Without this, you'd have to query the verification_results table by claim_id and order by created_at, which is less robust.

### Finding 43: Data model -- No index on scan_runs for repo_id
- **Quote:** scan_runs table (technical reference Section 4.8) has no indexes defined.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Add `CREATE INDEX idx_scan_runs_repo ON scan_runs(repo_id)` for querying scan history by repo.

### Finding 44: Section 13 cost model -- "High activity repos are unprofitable" with no resolution
- **Quote:** "Problem: High-activity repos are unprofitable at $19/month. ... Decision needed: pricing structure must account for variable costs." (Section 13.4)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** This is an open business decision that should be resolved before MVP ships. If the pricing is $19/repo/month flat, the system needs hard cost controls to prevent loss on high-activity repos. If usage-based pricing is adopted, the billing infrastructure needs to be in the MVP plan. At minimum, decide: flat pricing with a hard cap on scans/month (e.g., 200 PRs included, then disabled or degraded), or usage-based from day one.

### Finding 45: Section 14 -- MVP scope says "Tier 3+4 combined" but never defines what "combined" means
- **Quote:** "Layer 3: Tier 3+4 combined (skip triage gate, go straight to Claude Sonnet for semantic claims)" (Section 14.1)
- **Category:** AMBIGUOUS
- **Severity:** IMPORTANT
- **Recommendation:** "Combined" here means "skip Tier 3 entirely and send all semantic claims directly to Tier 4." But an agent might interpret "combined" as "merge the triage and verification into a single prompt." Rewrite to be unambiguous: "For MVP, all semantic claims bypass triage (Tier 3) and go directly to Tier 4 (Claude Sonnet semantic verification)."

### Finding 46: Section 14 -- v2 scope includes "Developer feedback collection" but does not specify what changes in the PR comment
- **Quote:** "Developer feedback collection (thumbs up/down on PR comments)" (Section 14.2)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** Since Finding 31 established that GitHub reactions don't work per-finding, the feedback mechanism needs to be redesigned. The v2 scope should reference that redesigned mechanism, not the original "reactions" approach.

### Finding 47: Section 14 -- "Go and Rust language support" in v2 but no tree-sitter queries defined
- **Quote:** "Go and Rust language support" (Section 14.2)
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** The technical reference (Section 6.2) lists the languages and their tree-sitter grammars but provides no query patterns for Go or Rust (only TypeScript examples). This is fine for v2 planning but should be noted as work to be done.

### Finding 48: Experiment 15.1 -- Success criteria conflict
- **Quote:** "Precision >= 70% ... Over-extraction < 20% of total output" (Section 15.1)
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** If precision >= 70%, that means up to 30% of extracted claims are not genuinely testable. But over-extraction must be < 20%. Over-extraction is defined as "vague/untestable claims" -- which is the same as 1 - precision. These two criteria conflict: 70% precision allows 30% non-testable, but over-extraction requires < 20% non-testable. Reconcile the definitions or acknowledge that "precision" includes duplicates (precision = testable / (testable + untestable + duplicates)) while over-extraction counts only vague/untestable.

### Finding 49: Experiment 15.5 -- "Zero findings that are clearly absurd" is untestable
- **Quote:** "Zero findings that are clearly absurd (would damage credibility)" (Section 15.5)
- **Category:** UNTESTABLE
- **Severity:** MINOR
- **Recommendation:** "Clearly absurd" is subjective. Define objective criteria for what makes a finding "absurd." For example: (a) Finding claims a file doesn't exist when the claim doesn't reference a file. (b) Finding claims a dependency version is wrong when the claim doesn't mention a version. (c) Finding is about a completely unrelated file. Alternatively, accept this as a qualitative assessment and note it as such.

### Finding 50: Term "Finding" vs "Verification Result" vs "Drift" used inconsistently
- **Quote:** Glossary defines "Finding" as "A claim that has been determined to be drifted." Section 6.3 outputs are called "Verification Results." Section 8.2 says "findings" in PR comment context. Section 7.2 step 9 says "actionable findings (drifted claims only)."
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** Clarify: a VerificationResult is the output of Layer 3. A Finding is a VerificationResult where verdict = 'drifted'. Use "finding" exclusively for drifted results in all user-facing contexts. Use "verification result" for all results (including verified and uncertain) in system contexts.

### Finding 51: Term "health score" is a percentage in some places and a 0-1 decimal in others
- **Quote:** "94% (467/497 claims verified)" in the PR comment template vs `score: verified.length / (claims.length - pending.length)` returning a 0-1 decimal in the code.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** Standardize: store as 0-1 decimal, display as percentage. Note this convention so agents format correctly.

### Finding 52: No specification for concurrent PR handling on the same repo
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** If two PRs are open simultaneously and both trigger scans, they may both try to update the codebase index concurrently. Define: (a) Are index updates atomic per repo? (b) Is there a per-repo lock? (c) Can two PR scans run in parallel? (d) Do they share the same codebase index or does each scan get a snapshot? This affects data integrity.

### Finding 53: No specification for PR to a non-default branch
- **Quote:** Data flow assumes PR trigger, but doesn't specify which base branches are monitored.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** Does DocAlign only trigger on PRs targeting the default branch? Or any PR? If someone opens a PR from `feature-a` to `feature-b` (neither is main), should the system scan? Most CI tools only care about PRs to main/master. Specify the behavior.

### Finding 54: No specification for what happens when the GitHub App is uninstalled
- **Quote:** "installation (app installed/uninstalled)" (Section 12.1) -- webhook event is listed but handler behavior is not defined.
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** When the app is uninstalled, should the system: (a) Delete all repo data (claims, mappings, verification results)? (b) Soft-delete (mark as inactive)? (c) Keep data for N days in case of reinstall? This affects database size, privacy, and re-install experience.

### Finding 55: No GitHub API version pinning
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** MINOR
- **Recommendation:** GitHub periodically deprecates API versions. The PRD should specify which GitHub REST API version and which Octokit version to target, or at least note that the implementation should pin the API version header (`X-GitHub-Api-Version`).

### Finding 56: No specification for large file handling
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** What happens when a documentation file is extremely large (e.g., a generated API reference that is 50,000 lines)? The LLM extraction would exceed token limits. What happens when a code file used as evidence is huge? The "500 lines" and "4000 tokens" caps in Section 6.2 help but: (a) How is the 500-line window selected (first 500? Around the relevant function?) (b) What if the "entity" itself is >500 lines? (c) What about generated/minified files that match doc patterns? Add file size limits and handling for oversized files.

### Finding 57: No retry/idempotency specification for PR comment posting
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** If the PR comment post fails (GitHub API error, rate limit), should the system retry? If it retries and the first attempt actually succeeded (network error on response), will it post a duplicate comment? Define idempotency: check if a DocAlign comment already exists on the PR before posting a new one. If editing existing comments (see Finding 29), this is naturally idempotent.

### Finding 58: PRODUCT-VISION.md says "get_verified_docs" but PRD says "get_docs"
- **Quote:** PRODUCT-VISION.md: `get_verified_docs(topic)`. PRD Section 9.2 / technical reference: `get_docs`.
- **Category:** INCONSISTENT
- **Severity:** MINOR
- **Recommendation:** The PRD is canonical. Note the vision doc has the old name.

### Finding 59: No specification for the `checks: write` permission usage
- **Quote:** "checks: write -- (optional) create check runs instead of/in addition to comments" (Section 12.1)
- **Category:** AMBIGUOUS
- **Severity:** MINOR
- **Recommendation:** Is this in MVP or not? The parenthetical "(optional)" is ambiguous -- optional for the user, or optional for the implementation? If it's used, define: what check run name, what status (success/failure/neutral), what summary text. If it's not MVP, remove it from the permissions list or explicitly mark as "requested at install for future use."

### Finding 60: No specification for handling private repos that require authentication for file access
- **Quote:** "contents: read -- read repo files" (Section 12.1)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** The GitHub App installation token provides access to repo contents. But specify: (a) How is the installation token obtained and refreshed? (Installation tokens expire after 1 hour.) (b) Is the token passed to the worker via the job queue? (c) For shallow clones, how is the token used for git authentication? These are implementation details but they are critical for the agent to implement correctly. At minimum, note that the system must use the GitHub App installation token (not a personal access token) and must handle token refresh.

### Finding 61: No logging, monitoring, or observability specification
- **Quote:** (absent)
- **Category:** MISSING
- **Severity:** IMPORTANT
- **Recommendation:** For a system that processes webhooks, runs LLM calls, and posts to GitHub, observability is essential for debugging. Define at minimum: (a) What gets logged (webhook received, job started/completed/failed, LLM call duration/cost, PR comment posted). (b) What metrics are tracked (job queue depth, average scan duration, LLM cost per scan, error rate). (c) Where logs go (stdout, structured JSON, a logging service). This can be a brief section but it should exist so the implementing agent includes logging.

### Finding 62: No specification for `.docalign.yml` parsing failure behavior
- **Quote:** "Users can configure DocAlign behavior via .docalign.yml in the repo root." (Appendix A)
- **Category:** EDGE_CASE
- **Severity:** MINOR
- **Recommendation:** What happens if the YAML is malformed? What if it contains unknown keys? What if values are out of range (e.g., `max_claims_per_pr: 999999`)? Options: (a) Fail the scan and post an error comment. (b) Fall back to defaults and log a warning. (c) Fail validation and ignore the file. Specify the behavior and any value constraints (min/max for numeric fields, allowed values for enums).

---

## Section 3: Questions for Founder

These are decisions only the founder can make. They cannot be resolved by reading the PRD more carefully.

1. **What happens on first install?** Does the system run an automatic full scan when the GitHub App is installed on a repo? If yes, how long is acceptable for this initial scan (1 min? 5 min? 10 min?)? What does the user see while it runs? (Findings 1, 3, 4)

2. **What should the system do when zero findings are found on a PR?** Post nothing? Post a green "all clear" message? Create a passing GitHub Check? (Finding 17)

3. **How should per-finding feedback work given that GitHub reactions are per-comment, not per-section?** Options: (a) One comment per finding (noisy). (b) Review comments on specific lines (enables suggestions but fragments the report). (c) Custom web links per finding. (d) Hybrid: summary comment + individual review comments with suggestions. (Finding 31, 33)

4. **Should PR comments be edited on subsequent pushes, or should new comments be posted?** (Finding 29)

5. **What happens with "uncertain" verification verdicts?** Show them in the PR comment with a different treatment? Drop them silently? (Finding 16)

6. **Should feedback UI be in the MVP comment even though feedback processing isn't?** (Finding 18)

7. **What is the pricing model for high-activity repos?** Flat with a cap? Usage-based? Tiered? This affects whether cost controls need to be in MVP. (Finding 44)

8. **Should code_example claims be verified in MVP, or deferred?** Verifying code blocks is a significantly harder problem than verifying path/command/version claims. (Finding 14)

9. **What is the default code indexing scope?** Only `src/**` and `lib/**`, or auto-detect, or index everything? The default determines out-of-box experience for repos with non-standard structures. (Finding 40)

10. **Should the GitHub App request `checks: write` permission in MVP?** Using GitHub Checks provides a better UX (green/red status in the PR) but adds implementation complexity. (Finding 59)

11. **What is the target behavior for concurrent PR scans on the same repo?** Allow parallel with potential index conflicts, or serialize with a per-repo lock? (Finding 52)

12. **Should PRs targeting non-default branches be scanned?** (Finding 53)
