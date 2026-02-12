# Product Vision: Documentation-Reality Alignment Engine

> Status: Synthesis draft — post feature-landscape research
> Date: 2026-02-08
> Inputs: feature-landscape.md (12 capability areas, 9 competitor deep dives), signals.md (22 validated pain points), wtp.md (pricing/WTP data), founder.md (constraints), harness.md (autonomy architecture)

---

## 1. The Problem (Concrete)

Every software repo has documentation: READMEs, architecture docs, API guides, onboarding docs, ADRs, CLAUDE.md files, AGENTS.md files (OpenAI's repo has 88 of them across subdirectory levels). This documentation makes claims about the code:

- "Authentication uses bcrypt with 12 rounds"
- "Run `pnpm test:unit` for unit tests"
- "Data flows: API Gateway → SQS Queue → Worker Lambda"
- "The AuthService handles login, registration, and password reset"
- "Configuration is loaded from `config/default.yaml`"

These claims rot. Code changes. Documentation doesn't. Nobody updates the README when they switch from bcrypt to argon2. Nobody fixes the architecture doc when they replace SQS with Kafka.

**This was always annoying. Now it's dangerous.**

AI coding agents (Claude Code, Cursor, Copilot, Codex) treat documentation as ground truth. When an agent reads a stale CLAUDE.md that says "we use Express.js" but the codebase migrated to Fastify six months ago, the agent generates Express.js code. The developer wastes 30 minutes figuring out why the agent built the wrong thing.

This is not a niche problem. It is the mechanism behind a significant portion of the 22 intent-gap incidents we cataloged — agents building wrong things because their context (documentation) was wrong.

**Scale of the problem:**
- DOCER research: 28.9% of the top 1,000 GitHub projects have at least one outdated file path reference (and that's just the syntactic surface — semantic drift is far worse)
- 66% of developers report "AI solutions that are almost right, but not quite" as their #1 frustration
- Academic CCI research: ~20% of LLM-generated comments contain demonstrably inaccurate statements
- Root cause clustering from our signals research: Context loss (35%) is the #1 root cause of intent-gap failures

---

## 2. Who Suffers Most

**Primary: Developers who use AI coding agents on repos with documentation.**

Not documentation writers. Not technical writers. Not VP Engineering.

The person who opens Claude Code, types "add a new endpoint for user preferences," and gets wrong code because the agent read a stale API architecture doc that describes last quarter's routing structure.

**Segments (in order of pain intensity):**

1. **AI-native startup teams (3-15 devs)** — Highest agent usage, fastest code velocity, docs rot fastest. They rely heavily on agents to be productive. Wrong agent output = hours wasted daily.

2. **Open source maintainers with contributors using agents** — External contributors who use agents depend entirely on repo documentation. Stale docs → bad PRs → review burden on maintainers.

3. **Solo developers with growing codebases** — They wrote the docs months ago. They've changed the code since. They know the code but the agent doesn't — it trusts the stale docs.

4. **Enterprise teams adopting coding agents** — Governance-sensitive. They need to know their documentation is accurate before letting agents consume it. But they have the most docs and the most drift.

**The user is the developer. The buyer (at team/enterprise) is the engineering lead. The distribution is bottom-up: individual developer installs it, sees value, brings it to the team.**

---

## 3. The Product (Concrete)

A system that continuously verifies whether documentation in a repo still matches code reality, alerts developers to drift, suggests targeted fixes, and serves verified documentation to AI coding agents.

**Three surfaces:**

### Surface 1: CI/CD Integration (Primary — the wedge)
A GitHub App (and later GitLab/Bitbucket) that runs on every PR. When code changes, it:
1. Identifies which documentation claims are affected by the changed code
2. Checks those claims against the new code state
3. Posts a PR comment: "These 3 doc claims are now inconsistent with your code changes"
4. Suggests specific text replacements to fix each claim
5. Optionally auto-creates a commit with the fixes

This is the CodeRabbit model applied to documentation health instead of code quality.

### Surface 2: CLI Tool (Secondary — local development)
`docalign check` — runs locally before commit. Like `semcheck -pre-commit` but with automatic mapping (no YAML configuration needed). Developer sees drift before pushing.

`docalign scan` — full repo scan. Reports documentation health score. Lists every drifted claim across all docs.

`docalign fix <file>` — generates targeted fixes for a specific doc file.

### Surface 3: MCP Server (Tertiary — agent context)
An MCP server that AI coding agents can query:
- `get_docs(topic)` — returns documentation about a topic, annotated with verification status (verified/stale/uncertain)
- `report_drift(doc_file, claim, evidence)` — agents report suspected drift they discover during work
- `get_doc_health(path)` — returns health score for a doc file or directory

This is the novel bidirectional pattern. DocSync and Greptile serve docs read-only. We serve docs with freshness metadata AND accept drift reports from agents.

---

## 4. Architecture (How It Works, Layer by Layer)

### Layer 0: Codebase Index

**What:** A lightweight, doc-optimized index of the codebase. Not a full code graph (we're not Greptile). Focused on the entities that documentation typically references.

**How:**
- tree-sitter AST parsing for structural entities: exported functions, classes, API routes, CLI commands, configuration schemas, dependency declarations
- Dependency file parsing: package.json, requirements.txt, Cargo.toml, go.mod for version claims
- Script/command extraction: package.json scripts, Makefile targets, Dockerfile commands
- Embedding generation for exported function signatures and their docstrings (for semantic search when mapping claims to code)

**Incremental update:** On each commit, re-parse only changed files. Re-embed only changed function signatures. The index stays current without full rebuild.

**What we DON'T build:** Full function-level embeddings of all code (Greptile's approach). We index only what docs typically reference — the "surface" of the codebase, not its internals.

**Estimated cost per index update:** Minimal. AST parsing is deterministic (no LLM). Embedding calls only for changed functions (~$0.001 per file for OpenAI text-embedding-3-small).

---

### Layer 1: Claim Extractor

**What:** Parse every documentation file (markdown, mdx, rst, txt) in the repo and decompose it into individual, verifiable claims.

**How:**
1. Identify documentation files: `README.md`, `docs/**/*.md`, `CLAUDE.md`, `AGENTS.md`, `*.md` in root and common doc directories, `ADR-*.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`.

2. Send each file (or section, for large files) to an LLM with a structured prompt:

```
Given this documentation file, extract every factual claim about the codebase.
For each claim, output:
- claim_text: the exact text making the claim
- claim_type: "path_reference" | "dependency_version" | "command" | "api_route" | "behavior" | "architecture" | "config" | "convention"
- testability: "syntactic" (can verify by file/symbol lookup) | "semantic" (requires code understanding) | "untestable" (opinion/preference)
- line_number: where the claim appears
- confidence: how confident you are this is a factual claim (0-1)

Do NOT extract:
- Style preferences ("we prefer X")
- Aspirational statements ("we plan to")
- Opinions or recommendations
- Generic programming advice
```

3. Cache the extracted claims. Re-extract only when a doc file changes.

**Claim types and their verification strategy:**

| Claim Type | Example | Verification |
|-----------|---------|-------------|
| path_reference | "see `src/auth/handlers.ts`" | File existence check (deterministic) |
| dependency_version | "React 18.2" | package.json lookup (deterministic) |
| command | "`pnpm test:unit`" | package.json scripts / Makefile targets (deterministic) |
| api_route | "POST /api/v2/users" | Route definition search in code (deterministic + AST) |
| behavior | "AuthService handles password reset" | LLM comparison with actual AuthService code (semantic) |
| architecture | "Data flows through SQS queue" | LLM analysis of imports/infra code (semantic) |
| config | "Config loaded from config/default.yaml" | File existence + schema comparison (mixed) |
| convention | "All API responses use camelCase" | AST/grep pattern check (deterministic) |

**Key insight borrowed from Kang et al. 2024:** Don't ask "is this claim consistent?" — extract the claim, gather evidence, and verify with evidence in hand. This is more reliable than holistic "is the doc correct?" prompting.

**Estimated cost:** ~$0.01-0.03 per doc file (one LLM call per file using GPT-4o-mini for extraction). A repo with 50 doc files = $0.50-1.50 for full extraction. Re-extraction only on doc changes.

---

### Layer 2: Code-to-Claim Mapper (Automatic Discovery)

**What:** For each extracted claim, automatically identify which code files/functions contain the evidence to verify that claim. This is the biggest gap across the entire landscape — everyone else does this manually (Semcheck YAML, Cloudy DB, DeepDocs config).

**How (progressive, from cheap to expensive):**

**Step 1 — Direct reference extraction (deterministic, free):**
- Path references: parse the claim for file paths, module names → direct file lookup
- Command references: parse for CLI commands → package.json/Makefile lookup
- Dependency references: parse for package names → dependency file lookup
- API route references: parse for URL patterns → route definition search

**Step 2 — Symbol-based search (deterministic, fast):**
- Extract identifiers from the claim text (function names, class names, variable names)
- Search the codebase index for matching symbols
- Example: claim mentions "AuthService" → find `class AuthService` in the AST index

**Step 3 — Semantic search (embedding-based, cheap):**
- Embed the claim text
- Search against function signature embeddings in the codebase index
- Return top-k most relevant code locations
- Example: claim says "password reset flow" → find functions with "reset", "password", "forgot" in their signatures/docstrings

**Step 4 — LLM-assisted mapping (expensive, last resort):**
- For claims that Steps 1-3 can't map, send the claim + file tree to an LLM
- Ask: "Which files in this repo would contain evidence for or against this claim?"
- Use only when the claim references behavior without naming specific code entities

**Output:** Each claim gets a list of `(file, function, confidence)` tuples — its evidence sources.

**Caching:** Mappings are cached and only re-computed when:
- The claim changes (doc was edited)
- The mapped code file was deleted/renamed
- A periodic refresh (weekly) catches mapping drift

**Estimated cost:** Steps 1-2 are free (deterministic). Step 3 is ~$0.0001 per query (embedding search). Step 4 is ~$0.005-0.01 per claim (rare, only for unmappable claims). For a repo with 500 claims, initial mapping costs ~$0.05-0.50.

---

### Layer 3: Verification Engine (Progressive)

**What:** Verify each claim against its mapped code evidence. Progressive means: use the cheapest reliable method first, escalate only when needed.

**Tier 1 — Syntactic verification (deterministic, free, 100% reliable):**
- Path references → does the file exist?
- Dependency versions → does package.json match?
- CLI commands → does the script/target exist?
- API routes → does a route definition exist? (AST search)
- Config files → does the config file exist and contain expected keys?

**Accuracy: 100%.** These are binary checks. No LLM involved. No false positives.

**Tier 2 — Pattern verification (grep/AST, free, ~95% reliable):**
- Convention claims ("all API responses use camelCase") → grep/AST pattern check
- Import claims ("uses Express.js") → import statement search
- Naming convention claims → regex across codebase

**Tier 3 — Triage gate (cheap LLM, $0.001 per claim):**
Before running expensive semantic analysis, ask GPT-4o-mini:
```
Given this documentation claim and this code snippet, does the claim appear to be:
A) Clearly accurate (no further check needed)
B) Clearly wrong (flag immediately)
C) Uncertain (needs deeper analysis)
Return only the letter and a 1-sentence reason.
```

This is the Cloudy pattern. If A: skip expensive analysis. If B: flag directly. If C: proceed to Tier 4.

**Estimated filtering:** Based on Cloudy's experience, ~60-70% of claims pass triage as "clearly accurate." Only 30-40% need Tier 4.

**Tier 4 — Semantic verification (expensive LLM, $0.02-0.10 per claim):**
Send the claim + its mapped code evidence to a capable model (Claude Sonnet or equivalent):

```
<claim file="README.md" line="45">
Authentication uses bcrypt with 12 salt rounds for password hashing.
</claim>

<evidence file="src/auth/password.ts">
import { hash, compare } from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { type: 2, memoryCost: 65536 });
}
</evidence>

Is this documentation claim still accurate given the code evidence?
Respond with:
- verdict: "accurate" | "drifted" | "uncertain"
- reasoning: 1-2 sentences explaining your assessment
- severity: "high" (functional impact) | "medium" (misleading but not breaking) | "low" (minor inaccuracy)
- suggested_fix: the corrected text if drifted
```

**Post-verification check (CodeRabbit pattern):**
For "drifted" findings, generate a verification script:
- If claim says "uses bcrypt" and code shows argon2, verify: `grep -r "bcrypt" src/` should return nothing
- If the verification script contradicts the LLM finding, demote or drop the finding

**Accuracy target:** Tier 1-2 = 95-100%. Tier 3-4 combined = 70-80% (matching Semcheck benchmarks, improving with learning).

---

### Layer 4: Change-Triggered Scanning

**What:** Determine WHEN to run verification and WHAT to verify based on code changes.

**Trigger 1 — PR scan (primary):**
1. GitHub webhook fires on PR open/update
2. Extract changed files from the PR diff
3. Query the claim-to-code mapper: which claims are mapped to any changed file?
4. Run verification only on those claims
5. Post results as PR comment

**Efficiency:** A typical PR touches 5-15 files. If the repo has 500 claims, maybe 10-30 are mapped to those files. We verify 10-30 claims, not 500. Cost: $0.05-0.50 per PR.

**Trigger 2 — Pre-commit hook (local):**
Same flow as PR scan but runs locally on staged files. Even faster because it checks fewer files.

**Trigger 3 — Scheduled full scan (weekly/manual):**
Verify ALL claims across the repo. Catches drift that accumulated from many small changes. Generates a documentation health report.

**Trigger 4 — Agent-reported drift (MCP):**
When an AI agent reports suspected drift via the MCP server, queue that claim for immediate re-verification.

**Scoping logic (critical for cost control):**
- Changed file → find all claims mapped to that file → verify those claims
- NOT: changed file → re-verify all docs
- NOT: any PR → verify all claims
- This is the Semcheck pre-commit pattern generalized to all triggers

---

### Layer 5: Report & Fix Generation

**What:** Present findings in actionable format and generate targeted fixes.

**PR comment format (inspired by CodeRabbit + Semcheck):**

```markdown
## Documentation Health Check

3 claims may need updating based on your code changes:

### 1. HIGH: Password hashing library changed
**File:** README.md, line 45
**Claim:** "Authentication uses bcrypt with 12 salt rounds"
**Evidence:** `src/auth/password.ts` now imports from `argon2`, not `bcrypt`
**Suggested fix:**
> Authentication uses argon2 with type 2 (argon2id) and 64MB memory cost

### 2. MEDIUM: API route path changed
**File:** docs/api.md, line 112
**Claim:** "POST /api/v1/users"
**Evidence:** Route definition in `src/routes/users.ts` is now `/api/v2/users`
**Suggested fix:**
> POST /api/v2/users

### 3. LOW: Config file renamed
**File:** CONTRIBUTING.md, line 23
**Claim:** "see `config/default.yaml`"
**Evidence:** File was renamed to `config/default.toml`
**Suggested fix:**
> see `config/default.toml`

---
📊 Repo documentation health: 94% (467/497 claims verified)
```

**Fix generation format (Cloudy snippet replacement pattern):**
```json
{
  "file": "README.md",
  "old_text": "Authentication uses bcrypt with 12 salt rounds for password hashing.",
  "new_text": "Authentication uses argon2id with 64MB memory cost for password hashing.",
  "reason": "src/auth/password.ts switched from bcrypt to argon2"
}
```

**Auto-fix mode:** If enabled, commit the fixes directly to the PR branch. Developer reviews the diff like any other code change.

**Health dashboard (web):**
- Per-file health scores (% of claims verified)
- Repo-wide health score
- Trend over time (is documentation getting healthier or drifting?)
- Hotspots: files with the most drift

---

### Layer 6: MCP Server (Bidirectional Agent Context)

**What:** An MCP server that AI coding agents query for verified documentation and report drift they discover.

**Read tools:**
```
get_docs(topic: string) → DocResult[]
```
Returns documentation sections relevant to the topic, annotated with freshness:
```json
{
  "file": "docs/auth.md",
  "section": "Password Hashing",
  "content": "Authentication uses argon2id...",
  "verification_status": "verified",
  "last_verified": "2026-02-07",
  "health_score": 0.97
}
```

An agent receiving this knows: this section was verified 1 day ago, 97% of its claims check out. It can trust it.

```
get_doc_health(path: string) → HealthReport
```
Returns health metadata for a doc file. An agent can check before relying on a doc: "is this doc still accurate?"

**Write tools:**
```
report_drift(file: string, line: number, claim: string, evidence: string) → void
```
An agent working on the codebase notices that a doc claim doesn't match what it sees in the code. It reports this. The system queues the claim for re-verification.

This creates a feedback loop: agents consuming docs → agents reporting drift → system verifying → docs getting fixed → agents get better docs.

**Integration:** The MCP server is configured in `claude_desktop_config.json`, `.cursor/mcp.json`, or equivalent. Any agent that supports MCP can use it.

---

### Layer 7: Learning System

**What:** Improve accuracy over time based on user feedback and observed patterns.

**Signal 1 — Developer feedback on findings:**
When a developer dismisses a finding ("this is fine, not actually drifted"), record:
- The claim text
- The evidence that triggered the finding
- The developer's dismissal
This trains the system to not re-flag similar patterns.

**Signal 2 — Co-change patterns (CodeRabbit insight):**
Track when code files and doc files change together in commits. Build implicit mappings from observed behavior. If `src/auth/` and `docs/auth.md` are frequently co-committed, strengthen the mapping confidence.

**Signal 3 — Agent drift reports:**
When agents report drift via MCP, and the finding is later confirmed (developer fixes the doc), strengthen trust in agent-reported drift. When agent reports are false, down-weight.

**Signal 4 — Fix acceptance rate:**
Track which suggested fixes are accepted vs rejected. Rejected suggestions indicate the system misunderstands the codebase's documentation style.

**Storage:** LanceDB or similar vector store, scoped per repository. Learnings never leak across repos.

**Decay:** Learnings have confidence decay (Drift pattern, 180-day half-life). Old learnings about code patterns that may have changed get naturally down-weighted.

---

## 5. What's Novel (Why This Doesn't Exist)

1. **Automatic claim extraction from unstructured documentation.** Nobody decomposes free-text markdown into individual testable claims in production. Academic work (Kang et al. 2024) proposes this for method-level comments. We apply it to all documentation types.

2. **Automatic code-to-claim mapping.** Every existing tool requires manual configuration (Semcheck YAML, DeepDocs config, Cloudy DB links). We infer mappings automatically using a progressive strategy (direct references → symbol search → semantic search → LLM-assisted).

3. **Progressive verification tiering.** Nobody combines deterministic syntactic checks with triage-gated semantic checks in a single pipeline. Semcheck does semantic-only. Swimm does syntactic-only. We do both, in order, with cost optimization at each stage.

4. **Bidirectional MCP for documentation.** DocSync and Greptile serve docs read-only. No tool allows agents to report drift back. The feedback loop (agent reads docs → agent reports drift → system verifies → docs improve) is entirely new.

5. **Claim-level granularity.** Existing tools operate at file level (Semcheck sends full files) or section level (DeepDocs edits sections). We operate at claim level — each individual assertion is independently verified. This produces more precise findings and more targeted fixes.

---

## 6. What's Borrowed (Proven Patterns We Adopt)

| Pattern | Source | How We Use It |
|---------|--------|---------------|
| Cheap triage gate | Cloudy | GPT-4o-mini filters before expensive analysis |
| Verification scripts | CodeRabbit | grep/AST checks confirm LLM findings |
| Snippet replacement format | Cloudy | Precise old→new text for fixes |
| Pre-commit selective check | Semcheck | Only verify claims mapped to changed files |
| PR comment format | CodeRabbit | Structured, severity-labeled, actionable |
| Learnings from feedback | CodeRabbit | Developer accept/reject improves accuracy |
| Confidence decay | Drift | Stale learnings auto-degrade |
| Agentic doc update loop | Mintlify | Multi-step read-reason-edit for fix generation |
| Judge synthesis | Qodo | Aggregate/deduplicate/filter parallel findings |
| tree-sitter parsing | Greptile | Language-agnostic AST for codebase index |

---

## 7. MVP Scope (What Ships in 2-4 Weeks)

**Goal:** A working GitHub App that detects documentation drift on PRs.

### MVP includes:

**Claim extraction (simplified):**
- Parse markdown files for explicit references: file paths, CLI commands, dependency names, API routes, code block examples
- Use regex + heuristics for syntactic claims (no LLM needed for extraction in v1)
- Use one LLM call per doc file for semantic claims (behavior, architecture)

**Mapping (simplified):**
- Direct reference mapping only: file paths map to files, commands map to package.json, dependency names map to lock files
- Simple semantic search for behavior claims (embed claim → find top-3 matching functions)
- No LLM-assisted mapping in v1

**Verification (v1):**
- Tier 1 (syntactic): file existence, command existence, version comparison — deterministic
- Tier 3-4 combined (semantic): send claim + evidence to one LLM call, get verdict

**No triage gate in v1** (add in v2 when cost optimization matters).

**Trigger:** PR webhook only. No pre-commit, no scheduled scan, no MCP in v1.

**Output:** PR comment with findings + suggested fixes. No auto-commit. No dashboard.

### MVP does NOT include:
- MCP server (v2)
- Learning system (v2)
- CLI tool (v2)
- Dashboard (v3)
- Auto-fix commits (v2)
- Verification scripts post-LLM (v2)
- Judge/deduplication layer (v2)
- Co-change pattern learning (v3)

### MVP technical stack:
- GitHub App (Node.js/TypeScript)
- tree-sitter for AST parsing (via WASM bindings)
- OpenAI text-embedding-3-small for embeddings (cheap, good enough for v1)
- Claude Sonnet for semantic verification (best accuracy per Semcheck benchmarks)
- GPT-4o-mini for claim extraction (cheap, fast)
- PostgreSQL for claim/mapping cache (Supabase or Neon for managed)
- GitHub Actions or Railway for hosting

### MVP cost per PR (estimate):
- Claim extraction: ~$0.02 (for affected doc files only)
- Mapping: ~$0.001 (embedding search)
- Verification: $0.05-0.20 (semantic checks for 5-15 affected claims)
- **Total: ~$0.07-0.23 per PR**

At 100 PRs/month per repo, that's $7-23/month in LLM costs per repo. Sustainable at $15-20/month pricing.

---

## 8. Growth Path (MVP → v2 → v3)

### v2 (Weeks 4-8): Accuracy + Efficiency
- Add cheap triage gate (GPT-4o-mini filter before semantic checks) — reduces cost 60-70%
- Add verification scripts (grep/AST post-checks) — reduces false positives
- Add pre-commit CLI tool
- Add MCP server (read-only first: serve verified docs to agents)
- Add auto-fix commit option on PR
- Add learning from developer accept/reject on findings

### v3 (Weeks 8-16): Intelligence + Scale
- Full bidirectional MCP (agents report drift)
- Co-change pattern learning for mapping improvement
- Web dashboard with repo health scores and trends
- Scheduled full-repo scans
- Multi-repo support (monorepo + polyrepo)
- Judge layer for deduplication and noise reduction
- GitLab/Bitbucket support

### v4+ (Week 16+): Platform
- Team learnings (org-level patterns)
- Custom verification rules (like Semcheck YAML, but auto-suggested)
- Document testing (Kang et al. pattern — generate executable tests from claims)
- IDE integration (show claim health inline in VS Code)
- API for custom integrations

---

## 9. Distribution (How We Get Users)

**Primary: GitHub App Marketplace**
- Free for public repos (open source funnel — proven by CodeRabbit's 100K+ free users)
- Install with one click
- First value within minutes (initial scan runs on install)

**Secondary: Show HN / dev community**
- Content-first: publish "We scanned the top 1,000 GitHub repos for documentation drift — here's what we found" (using our own tool)
- This validates the tool publicly AND generates inbound interest
- Target: r/ClaudeAI, r/cursor, r/programming, Hacker News

**Tertiary: MCP ecosystem**
- Listed in MCP server registries (Model Context Protocol is growing fast)
- Agents that use MCP discover the tool organically
- "Add this MCP server to get verified docs in your coding agent"

**Not in scope (yet):**
- Enterprise sales (no outbound, no sales team)
- Paid advertising
- Partnerships

**Adoption flywheel:**
1. Developer installs GitHub App on a repo
2. Sees drift findings on first PR — immediate value
3. Fixes a few docs — notices agent output improves
4. Tells team: "install this, our agents were reading stale docs"
5. Team installs → more repos → more learnings → better accuracy

---

## 10. Pricing (Based on WTP Research)

**Model: Per-repo/month with transparent usage.**

| Tier | Price | What You Get |
|------|-------|-------------|
| **Free** | $0 | Public repos. Up to 3 repos. PR checks only. Community support. |
| **Pro** | $19/repo/month | Private repos. Unlimited PRs. CLI tool. MCP server. Email support. |
| **Team** | $39/repo/month | Everything in Pro. Dashboard. Team learnings. Priority support. Multi-repo. |
| **Enterprise** | Custom | Self-hosted. SSO. Audit logs. Custom rules. SLA. |

**Why per-repo, not per-seat:**
- Per-seat pricing punishes adoption (more devs = more cost but same repo)
- Per-repo aligns cost with value (more repos = more documentation to keep fresh = more value)
- CodeRabbit uses per-contributing-developer; we simplify to per-repo
- Avoids Kiro's opaque consumption model (their pricing failure is our warning)

**Usage transparency:**
- Dashboard shows: claims checked, LLM tokens used, estimated cost
- No surprise bills — fixed per-repo price includes generous limits
- Overage: soft cap + alert, not hard cutoff

**Revenue math (target: $1M ARR):**
- At $19/repo/month: need ~4,400 paid repos
- At 5% free-to-paid conversion: need ~88,000 free repo installs
- CodeRabbit reached 100K+ free installs within 2 years — achievable at smaller scale

---

## 11. Risks & Mitigations

### Risk 1: Claim extraction quality
**Problem:** LLMs may not reliably decompose unstructured markdown into testable claims.
**Mitigation:** v1 starts with regex/heuristic extraction for syntactic claims (file paths, commands, versions) — no LLM needed. Semantic claim extraction is additive, not foundational. Even syntactic-only findings deliver immediate value.
**Validation:** Build the claim extractor first. Run it on 100 public repos. Manually review output quality before building the rest.

### Risk 2: Mapping accuracy
**Problem:** Automatically mapping claims to code files may produce wrong or missing mappings.
**Mitigation:** Progressive strategy means most claims have obvious mappings (file path → file, command → package.json). Only behavior/architecture claims need inference. v1 can ship with direct-reference mapping only and still be useful.
**Validation:** Compare auto-discovered mappings against manually created Semcheck YAML for the same repos.

### Risk 3: False positive rate
**Problem:** Academic research shows 14.4% developer acceptance rate for CCI findings. If we achieve similar rates, users will disable the tool.
**Mitigation:**
- Syntactic findings are 100% accurate (no false positives)
- Triage gate + verification scripts filter most false positives
- Learning from developer feedback improves over time
- Target: >50% acceptance rate for semantic findings (vs 14.4% academic baseline)
**Validation:** Measure acceptance rate in beta. If below 40%, prioritize noise reduction before growth.

### Risk 4: Cost
**Problem:** LLM calls cost money. At scale, $0.10-0.20/PR might be unsustainable.
**Mitigation:**
- Triage gate reduces semantic checks by 60-70%
- Incremental only (check claims for changed files, not all claims)
- Caching (unchanged claims don't re-verify)
- Model optimization (use cheapest model that meets accuracy threshold per tier)
**Math:** At $0.07-0.23/PR, 100 PRs/month = $7-23/month in costs. At $19/month pricing, gross margin is 0-63%. Triage gate moves this to 70-85%.

### Risk 5: Vendor absorption
**Problem:** Cursor, Claude Code, or CodeRabbit adds doc-drift detection.
**Mitigation:** This is our entire product. We iterate on claim extraction, mapping, verification, and noise reduction every week. When a vendor ships their v1, we should be on v5 with 3x better accuracy and 10x more claim types. The velocity advantage is real as long as we maintain focus.
**Also:** CodeRabbit's doc-checking today is limited to `path_instructions` configuration — manual, not automatic. If they move into automatic doc validation, they validate the market for us, and we compete on accuracy and depth.

### Risk 6: "Just use Semcheck"
**Problem:** Semcheck is open source and does semantic comparison.
**Mitigation:** Semcheck requires manual YAML mapping, has no claim decomposition, has no progressive verification, has 70-80% accuracy, and hasn't been updated since Dec 2024. Our automatic mapping alone is a 10x UX improvement. But Semcheck's existence means the base concept works — we're building the production-grade version of what Semcheck proved possible.

---

## 12. Why We Win (The Velocity Argument)

The thesis from CLAUDE.md applies directly:

> "We win by being 6-12 months ahead on the 'layer above.' When Cursor ships their v1 of what we have, we should already be on v5."

Documentation-reality alignment is our ENTIRE product. For CodeRabbit, it's one of 15+ review capabilities. For Cursor, it's a feature they might add. For Mintlify, it's a side effect of their doc generation workflow.

**Our focus advantage:**
- We ship claim extraction improvements weekly
- We optimize mapping accuracy with every repo that uses the tool
- We reduce false positive rates with every developer interaction
- We add new claim types (architecture claims, config claims, convention claims) faster than anyone

**The 10x better metric:**
- Today's tools: manual mapping + full-file LLM comparison = 70-80% accuracy, 10+ minutes setup per rule
- Our tool: automatic mapping + claim-level progressive verification = starts at 70-80% accuracy but with zero setup, improving to 85-90% with learning

**What makes us hard to replicate even when vendors try:**
- The learning data (accept/reject feedback, co-change patterns, agent drift reports) is per-repo and accumulates over time
- The claim type taxonomy grows richer with every repo type we encounter
- The mapping heuristics improve with every new language/framework
- These aren't moats in the traditional sense — they're execution depth that compounds through velocity

---

## 13. Connection to the Intent Layer Thesis

This product is not a pivot away from the Intent Layer thesis. It is the first concrete wedge INTO the Intent Layer.

Documentation is the primary vehicle through which developer intent reaches AI agents. When docs say "we use Express.js," the agent understands: "the developer intends for this codebase to use Express.js." When that claim is stale, the agent operates with wrong intent.

**The progression:**
1. **v1 (this product):** Keep documentation aligned with code reality → agents get accurate context → better agent output
2. **v2-v3:** Serve verified documentation to agents via MCP → agents know which docs to trust → agents self-correct when they encounter drift
3. **v4+:** From passive doc health to active intent management → developers express intent in structured forms → the system ensures agents follow intent → this IS the Intent Layer

The documentation health engine is the foundation on which the Intent Layer can be built. We start with the most concrete, measurable, immediately valuable piece (docs matching code) and expand toward the broader vision (developer intent reaching agents reliably).

---

## 14. First-Week Execution Plan

**Day 1-2:** Build claim extractor. Test on 10 popular open-source repos (Next.js, fastify, prisma, etc.). Measure claim extraction quality.

**Day 3-4:** Build syntactic verifier. Run path/command/version checks across extracted claims. Measure false positive rate (should be ~0%).

**Day 5-7:** Build basic mapping (direct references only). Wire up: doc file → extract claims → map to code → verify syntactic claims. Run end-to-end on 5 repos.

**Day 8-10:** Add semantic verification (LLM-based). Add triage gate. Measure accuracy on manually labeled test set.

**Day 11-14:** Build GitHub App integration. Webhook → extract claims for affected docs → verify → post PR comment. Deploy to our own repos.

**Day 15+:** Beta with 5-10 open source repos. Measure: acceptance rate, time-to-review, developer feedback. Iterate.
