# Documentation-Reality Drift: Feature Landscape & Mechanism Reference

> Compiled: 2026-02-08
> Purpose: Comprehensive catalog of every feature/mechanism found across competitors that contributes to keeping documentation in sync with code reality. Each entry describes HOW the mechanism works technically, WHO implements it, and WHAT gap remains.
> Source: Deep dives on CodeRabbit, Mintlify, DeepDocs, DocSync, Cloudy, Continue CLI, Qodo, Sourcery, Semcheck, Greptile, Swimm, Drift, plus academic research.

---

## Table of Contents

1. [Codebase Understanding & Indexing](#1-codebase-understanding--indexing)
2. [Code-to-Documentation Mapping](#2-code-to-documentation-mapping)
3. [Semantic Comparison (Spec vs Code)](#3-semantic-comparison-spec-vs-code)
4. [Change-Triggered Scanning](#4-change-triggered-scanning)
5. [Noise Filtering & Quality Control](#5-noise-filtering--quality-control)
6. [Structured Evaluation & Compliance](#6-structured-evaluation--compliance)
7. [Context Engineering](#7-context-engineering)
8. [Update Generation](#8-update-generation)
9. [Learning & Memory](#9-learning--memory)
10. [AI Agent Context Serving (MCP)](#10-ai-agent-context-serving-mcp)
11. [Syntactic Validation (Baseline)](#11-syntactic-validation-baseline)
12. [Claim Decomposition & Evidence Retrieval](#12-claim-decomposition--evidence-retrieval)

---

## 1. Codebase Understanding & Indexing

The foundation layer: building a machine-readable representation of the codebase that supports semantic queries about structure, relationships, and behavior.

### 1.1 AST Parsing + Recursive Docstring Generation (Greptile)

**How it works:**

1. **Parse every file** using [tree-sitter](https://tree-sitter.github.io/) (supports dozens of languages) into Abstract Syntax Trees. Extract structural nodes: functions, classes, variables, imports, and their relationships.

2. **Recursively generate synthetic docstrings** for each AST node. Rather than embedding raw code, Greptile translates each code entity into a natural language description. This is similar to HyDE (Hypothetical Document Embeddings) — convert code to prose, then embed the prose.

3. **Embed docstrings** (likely using OpenAI embedding models) and store in a vector database. Queries matched against natural-language descriptions score **0.8152 similarity** vs 0.7280 against raw code (12% improvement).

4. **Store graph relationships** separately as a structured graph: function calls, imports, dependencies, variable usage.

**Chunking strategy:** Function-level, not file-level. Isolated function chunks score 0.768 vs 0.718 for full-file chunks. Aggressive noise reduction — smaller, tighter chunks produce better retrieval.

**Workflow orchestration:** Uses [Hatchet](https://hatchet.run/) as the workflow engine. The indexing pipeline is broken into 4 resumable stages with automatic retry. Initial indexing for large repos (100k+ lines) takes several hours. Incremental updates (on new commits) process only changes.

**What the graph captures:**
- Files, directories, modules (structural entities)
- Functions, classes, variables (code elements)
- Function calls, imports, dependencies, variable usage (relationships)
- AI-generated docstring + embedding vector for each entity

**What the graph does NOT capture:**
- External API consumers
- Cross-repository dependencies (unless repos are explicitly linked)
- Runtime behavior or dynamic dispatch patterns
- Protocol-level details (gRPC vs REST vs direct function call)
- Architectural intent claims ("this is a microservice architecture")

**Performance:** Successfully indexed the Linux kernel, CPython, and VS Code. PR review completes in ~3 minutes. v3 uses 75% lower inference cost than v2 despite 3x more context (aggressive caching).

**Source:** Greptile ($25M Series A, YC W24). 82% bug detection rate.

---

### 1.2 Smart Token Reference Tracking (Swimm)

**How it works:**

1. Documentation is authored in Swimm's editor, stored as `.sw.md` files in a `.swm/` directory (docs-as-code).

2. **Smart Tokens** are embedded identifiers that link specific code elements (variable names, function names, file paths, code snippets) to documentation text. These are syntactic references — they track names and locations, not meaning or behavior.

3. **Auto-sync algorithm** (patented) runs on every PR. Examines "every conceivable piece of information available in a change (including previous history)" to decide whether the change is trivial or significant.

4. **Decision tree:**
   - Code shifted position but is identical → auto-sync
   - Variable renamed with no functional impact → auto-sync
   - Too much changed → flag for human review
   - Code entirely removed → alert ("can't document a negative")

5. **Conservative by design:** Prefers asking a human to re-select a snippet over making a bad auto-suggestion.

**What it tracks:** Token names (variables, functions, classes), file paths, code snippet content (line-by-line diff comparison), positional information.

**What it does NOT track:** What code actually does (behavioral semantics), whether English prose is accurate, behavioral drift (function name unchanged but behavior changed), intent drift, side effects, contract changes.

**Explicitly stated limitation:** "Swimm has no knowledge of types, syntactic sugar flavors, intermediate compiler output." Language-agnostic precisely because it doesn't parse or understand code semantics.

**LLM usage:** Swimm uses LLMs ONLY for generation (docs, chat Q&A, diagrams). It does NOT use LLMs for validation. Their three-step approach (deterministic code mapping → deterministic retrieval → LLM generation) uses AI only at the output stage, never at the validation stage.

**Source:** Swimm ($33.3M raised, $8.8M revenue, 57 employees). No new AI validation features shipped in 8+ months. Pivoting toward enterprise/mainframe COBOL modernization.

---

### 1.3 Pattern Detection (Drift)

**How it works:**

Drift scans codebases using 101+ pattern detectors across 10 languages. Built in Rust for performance, runs 100% locally. Builds call graphs and exposes findings via 50+ MCP tools.

**Cortex Memory System:** A "living memory system that replaces static instruction files." Instead of a static CLAUDE.md, you store tribal knowledge, architectural decisions, and conventions in Drift's memory (`drift memory add tribal "Always use bcrypt for passwords"`). AI agents query this dynamically via MCP. Confidence decays on stale knowledge (365-day half-life).

**Limitation:** Requires manual knowledge entry for tribal knowledge — does not auto-detect conventions from code changes. Does not generate or update instruction files.

**Source:** Drift (678 GitHub stars). Open source.

---

## 2. Code-to-Documentation Mapping

The linking problem: given a code change, which documentation files/sections are affected? This is the hardest unsolved piece across the entire landscape.

### 2.1 Manual YAML Rule Mapping (Semcheck)

**How it works:**

Users define explicit mappings in `semcheck.yaml`:

```yaml
rules:
  - name: "api-spec-compliance"
    description: "Verify API handlers match the API specification"
    files:
      include:
        - "./src/api/**/*.go"
      exclude:
        - "./src/api/**/*_test.go"
    specs:
      - path: "./specs/api-spec.md"
        fail_on: "error"

  - name: "readme-accuracy"
    description: "Verify README examples match actual code"
    files:
      include:
        - "./README.md"
    specs:
      - path: "./src/config/config.go"
      - path: "./cmd/cli/cli.go"
    prompt: |
      Make sure the examples in the README are correct as defined by the code.
      It is not required that everything is documented but what IS documented must be correct.
```

**Key design insight:** The `readme-accuracy` rule inverts the typical direction — it treats README.md as the "implementation" and source code files as the "specs." This allows bidirectional validation: docs against code OR code against specs.

**Fragment targeting:** Supports `#section-name` anchors for both HTML and Markdown headers to send only relevant sections of large documents.

**Inline annotations:** Code comments like `// semcheck:file(./specs/api.md)` or `// semcheck:rfc(8259)` create file-level links directly in source code.

**Strengths:** Precise, configurable, bidirectional, supports custom prompts per rule.
**Weakness:** Entirely manual. Requires humans to define and maintain every mapping. No automatic discovery.

**Source:** Semcheck (111 GitHub stars, open source, Go).

---

### 2.2 Manual Database Links (Cloudy)

**How it works:**

Cloudy (open source) stores code-to-doc mappings in a PostgreSQL table:

**`document_repo_links` table:** Connects a document (stored in `thoughts` table) to a specific file/path in a repository, with a `branch` column.

**Link creation:** Users create documents in Cloudy's editor and manually link them to code files/paths through the UI. PR auto-generation creates implicit links via the `document_pr_drafts` table.

**Trigger flow:** When a push event arrives on the default branch:
1. Identify repository by external ID
2. Query `document_repo_links` to find which documents are linked to changed files
3. Create `document_updates` records with commit metadata
4. Trigger AI analysis for each affected document

**Strengths:** Explicit, persistent, supports revision tracking.
**Weakness:** Manual setup creates high friction. Links only work if someone creates and maintains them.

**Source:** Cloudy (8 GitHub stars, open source, Brain Fog Inc.). Domain registered Oct 2025.

---

### 2.3 Manual Path Configuration (DeepDocs)

**How it works:**

Users configure source-to-doc path mappings in `deepdocs.yml`:

```yaml
mappings:
  - sources:
    - 'src/main/java/**/*.java'
    docs:
    - 'docs/api-reference.md'
    - 'README.md'
```

Or via web dashboard: select a branch to monitor, add Source Code Context (files/folders), add Target Docs (files/folders).

**Two modes:**
- **Folder-based:** Point at a docs folder. The LLM determines which docs are affected by code changes.
- **File-specific:** Explicitly list up to 5 individual documentation files.

**Strengths:** Simple to configure.
**Weakness:** Manual, limited (5 files in file-specific mode). No automatic discovery.

**Source:** DeepDocs (236 GitHub Marketplace installations, deprecated marketplace listing, $25/mo).

---

### 2.4 LLM-Inferred Mapping via Semantic Search (Mintlify)

**How it works:**

Mintlify does NOT use explicit mappings. The "mapping" is the LLM's reasoning over code diffs and the documentation corpus, aided by semantic search.

**The flow:**
1. Autopilot check fires on a merged PR
2. Agent calls `fetch_pull_request` to read the PR diff
3. Agent calls `read_navigation` to understand the doc site structure
4. Agent calls `list` and `read` on the documentation repo to read existing doc pages
5. **Agent uses Trieve-powered RAG** (vector embeddings, dense vector search, re-ranker models) to find relevant doc sections based on the content of the code changes
6. **The LLM decides which docs are affected** based on reasoning over the diff, doc structure, and semantic search results
7. Agent drafts updates and creates a PR

**Trieve integration:** Mintlify acquired Trieve (open-source RAG infrastructure) in July 2025. Trieve provides vector embeddings, dense vector search, re-ranker models, date recency biasing, sub-sentence highlighting. Handles 23M+ queries/month.

**Strengths:** Zero configuration needed. Works automatically.
**Weakness:** Accuracy depends entirely on LLM reasoning quality. No explicit mapping means no guarantees about coverage. "Early users reported that the AI sometimes produces generic or repetitive content, especially with disorganized codebases."

**Source:** Mintlify ($21.7M funded, a16z-backed, $300/mo Pro tier).

---

### 2.5 Co-Change History (CodeRabbit)

**How it works:**

CodeRabbit's **codegraph** tracks files that frequently change together via commit history analysis. It scans commit history for co-occurring file changes to build a lightweight dependency map.

If `auth.ts` and `docs/auth.md` are historically co-committed, the codegraph may surface that correlation during review. This is emergent pattern detection, not explicit mapping.

**Used as context for LLM:** The codegraph informs what context to include in the review prompt, but the actual "should docs be updated" decision is made by the LLM based on `path_instructions` configuration.

**Strengths:** Automatic, no setup needed, captures real team behavior.
**Weakness:** Purely correlational. Only works if the team has a history of co-updating code and docs (which is the problem we're trying to solve). Cold start problem.

**Source:** CodeRabbit (2M+ repos, $24/mo Pro).

---

## 3. Semantic Comparison (Spec vs Code)

The core product bet: using LLMs to compare what documentation claims against what code actually does.

### 3.1 Full-File LLM Comparison (Semcheck)

**How it works:**

1. For each rule, gather all matched spec files and implementation files.
2. Load full file contents. Wrap in XML tags:
   ```
   <specification file="./specs/api.md">
   [full file content]
   </specification>

   <implementation file="./src/api/handler.go">
   [full file content]
   </implementation>
   ```
3. Send to LLM with a structured system prompt.

**System prompt (key instructions):**
- "You are an expert code reviewer tasked with analyzing inconsistencies between a software specification and its implementation"
- Focus on semantic correctness, not formatting
- "ONLY REPORT ON INCONSISTENCIES!!! NEVER MENTION IF THINGS ARE CORRECTLY IMPLEMENTED!!!"
- All issues must reference spec or implementation as evidence
- Three severity levels: ERROR (breaks functionality), WARNING (missing recommended features), NOTICE (documentation inconsistencies, style)
- "If you think implementation is missing, consider that it might be omitted in this analysis and lower its severity"

**Output format (JSON):**
```json
[{
  "reasoning": "Brief explanation of the inconsistency",
  "level": "ERROR",
  "message": "Function Bar returns 'baz' instead of 'bar' as specified",
  "suggestion": "Update function Bar in handler.go to return 'bar'",
  "file": "internal/handler.go"
}]
```

**Accuracy benchmarks (9 test cases):**
| Model | Accuracy | Speed | Tokens |
|-------|----------|-------|--------|
| qwen-3-coder-480b (Cerebras) | 80.56% | 16s | 113K |
| claude-opus-4-1 | 78.89% | 116s | ~140K |
| claude-sonnet-4-0 | 73.89% | ~60s | ~130K |
| gemini-2.5-flash | 70.46% | ~40s | ~120K |
| gpt-5 | 61.96% | 1,271s | 156K |

**Cost:** ~12K-17K tokens per rule on average. At Anthropic Sonnet pricing, roughly $0.02-0.10 per rule check.

**Pre-commit optimization:** `semcheck -pre-commit` only checks rules where staged files match patterns. Dramatically reduces cost and time.

**Limitations:**
- Full file contents sent = context window limits for large files
- No diff-awareness — resends full files even if only 1 line changed
- Single LLM call per rule — no iterative refinement
- No caching of unchanged portions
- No cross-rule reasoning (each rule isolated)
- ~70-80% accuracy at best — 1 in 4-5 findings may be wrong
- False positive bias — "LLMs tend to raise issues even when there's nothing to report"

**Source:** Semcheck (111 GitHub stars, open source, Go). Last commit Dec 2024.

---

### 3.2 Academic: Code-Comment Inconsistency Detection

**State of the art (method-level code comments):**

| Approach | Source | F1 Score | Key Insight |
|----------|--------|----------|-------------|
| **C4RLLaMA** | ICSE 2025 | ~90% detection | Fine-tuned CodeLLaMA + chain-of-thought. Detection >> rectification (90% vs 55-65%). |
| **CCISolver** | arXiv June 2025 | 89.54% | Hybrid: traditional DL classifier for detection + LLM for repair. Specialized models may be better than raw LLMs for detection. |
| **CARL-CCI** | arXiv Dec 2025 | Beat fine-tuned LLMs by 13.5% | Smaller specialized model with structured code diffs beats large LLMs. "Larger is not always better." |
| **MCCL** | IEEE TSE 2024 | 82.6% | Confidence learning for training data denoising. Training data is inherently noisy. |
| **LLM + Program Analysis** | FSE 2024 | 160 found, 23 confirmed (14.4%) | Real-world validation. 14.4% developer acceptance rate = noise is severe. |

**Critical finding from Document Testing (Kang et al. 2024):**
- Traditional CCI detection has NO statistically significant relationship with actual accuracy
- ~20% of LLM-generated comments contain demonstrably inaccurate statements
- Proposed "document testing": generate executable tests from doc claims, run them to verify
- This showed a robust statistical relationship with comment accuracy
- Implication: generating tests from doc claims is more reliable than asking "is this consistent?"

**Nobody has attempted document-level validation.** All academic work is scoped to method-level code comments. README claims, architecture docs, API guides — completely untouched.

---

## 4. Change-Triggered Scanning

The event system: what triggers documentation checks, and how is scope determined?

### 4.1 Commit-Triggered Full Scan (DeepDocs)

**How it works:**

1. GitHub webhook fires on every push to monitored branch
2. System extracts the git diff (changed files, additions, deletions)
3. Checks configured source-to-doc mappings
4. LLM analyzes: "given these code changes, are these docs now outdated?"
5. If outdated: generates specific section edits (not full rewrites)
6. Creates branch `deepdocs-update/<branch-name>`, commits doc updates, opens PR
7. PR includes detailed change report: what files updated, why, which commits triggered it

**Two scan modes:**
- **Incremental (default):** Only analyzes the diff. Runs on every commit.
- **Deep scan (manual trigger):** Change the `reinit` string in `deepdocs.yml` to trigger a full codebase-to-docs comparison. Batch-fixes all outdated documentation in one pass.

**Credit cost:** 1 credit = 1 doc file update. 0.5 credits = analysis where no update needed.

**Source:** DeepDocs ($25/mo, 50 credits).

---

### 4.2 PR-Merge Monitoring (Mintlify Autopilot)

**How it works:**

1. A GitHub Check called "Mintlify Autopilot" runs on pull requests in monitored repositories
2. Analyzes merged PRs for potential documentation impacts
3. On first enable: backfills suggestions for PRs merged in last 7 days
4. Monitors ALL merged PRs regardless of target branch
5. Agent reads the PR diff, searches docs semantically, proposes updates
6. Suggestions appear in the Mintlify dashboard organized by source PR

**Second signal source — Conversation analysis:**
- The agent periodically analyzes AI Assistant conversations (the chatbot embedded in docs sites)
- Creates suggestions when it identifies patterns of user questions indicating missing or unclear documentation
- This is a fundamentally different signal: user confusion rather than code changes

**API trigger for automation:**
```
POST https://api.mintlify.com/v1/agent/{projectId}/job
Body: { "message": "analyze recent changes in repo X" }
```
Can be wired to GitHub Actions or n8n for push-to-main automation.

**Source:** Mintlify ($300/mo Pro).

---

### 4.3 Push-Triggered with Cheap Triage (Cloudy)

**How it works:**

1. GitHub push webhook arrives on default branch
2. System identifies changed files across commits
3. Cross-references with `document_repo_links` to find affected documents
4. **Triage step (GPT-4o-mini):** Quick structured check — does this doc actually need updating given the commit changes? Returns `{reasoning, documentNeedsUpdate}`.
5. If no: skip (saves expensive analysis)
6. If yes: **Full analysis (Claude 3.5 Sonnet at temperature 0.0):** Generates suggestions as XML-tagged content with specific snippet replacements
7. Suggestions stored as chat messages in threads (type: document_update)

**The triage step is the smartest design found.** Cheap model ($0.15/M tokens) gates expensive model ($3/M tokens). Avoids wasting LLM calls when code changes don't affect docs.

**Source:** Cloudy (open source, $20/user/month Pro).

---

### 4.4 Pre-Commit Selective Check (Semcheck)

**How it works:**

`semcheck -pre-commit` identifies which staged files match rule patterns and runs ONLY those rules. Does not run all rules on every commit.

Example: If you stage `src/api/handler.go`, and a rule maps `src/api/**/*.go` → `specs/api-spec.md`, only that rule runs. Other rules (e.g., README checks) are skipped.

**Cost optimization:** A repo with 20 rules only runs 1-3 on a typical commit, reducing LLM cost by 80-90%.

**Source:** Semcheck (open source).

---

### 4.5 PR-Triggered Doc Generation (Cloudy — PR flow)

**How it works for new PRs (separate from push-triggered revisions):**

1. GitHub `pull_request.opened` webhook arrives
2. **Triage (GPT-4o-mini):** Reads PR title, description, and diff. Returns boolean `needsDocs`.
3. If no: posts comment "Looks like your changes don't need any docs, you're all clear!"
4. If yes: **Generation (Claude 3.5 Haiku):** System prompt "You are an expert at creating documentation for projects." Receives existing doc library structure + PR context. Uses `createDocument` tool (path, title, content). Max 8 tool-call steps.
5. Posts GitHub PR comment with links to edit drafts on Cloudy platform
6. On PR merge: `publishPrDocsOnMerge()` — drafts become published
7. On PR close without merge: `skipPrDocsOnClose()` — drafts discarded

**Source:** Cloudy (open source).

---

## 5. Noise Filtering & Quality Control

The #1 product killer. Academic research shows only 14.4% of flagged inconsistencies are confirmed by developers. Every tool that ships must solve false positive noise.

### 5.1 Multi-Agent Judge Synthesis (Qodo)

**How it works:**

Qodo 2.0 uses a fan-out/fan-in architecture:

1. **Orchestrator** classifies the PR and routes to relevant expert agents
2. **Expert agents run in parallel** (15+): Critical Issue Agent, Breaking Changes Agent, Ticket Compliance Agent, Duplicated Logic Agent, Rules Agent, Test Coverage Agent, Recommendation Agent, etc.
3. Each agent independently analyzes the changeset from its specialized angle
4. **Judge Agent** aggregates all findings:
   - Resolves conflicts between agents (one says "fine", another says "bug")
   - Deduplicates overlapping findings
   - Filters low-confidence issues
   - Performs "deliberate self-reflection" on combined output
   - Surfaces only high-confidence issues

**Result:** Higher precision than single-pass review. The Judge layer is the key noise reduction mechanism.

**Source:** Qodo (60.1% F1, highest recall at 56.7% on their benchmark).

---

### 5.2 Verification Scripts (CodeRabbit)

**How it works:**

After the LLM generates review comments, CodeRabbit runs post-generation verification:

1. Generates shell/Python check scripts (grep, ast-grep patterns) to confirm assumptions
2. Example: if the LLM says "function X is not called anywhere," a grep check confirms this before posting
3. Filters out hallucinated or speculative feedback that fails verification

**Also:** Static analysis pre-pass runs 40+ linters and SAST tools BEFORE the LLM sees the code. Results are folded into LLM context, reducing the LLM's burden of catching things linters already catch.

**Source:** CodeRabbit (2M+ repos).

---

### 5.3 Cheap Model Triage Gate (Cloudy)

**How it works:**

Before running expensive semantic analysis (Claude Sonnet, ~$3/M input tokens), a cheap model (GPT-4o-mini, ~$0.15/M input tokens) answers a binary question: "Does this document need updating given this code change?"

Returns a structured `{reasoning, documentNeedsUpdate}` response. Only if `true` does the expensive analysis proceed.

**Cost impact:** In a repo where 80% of commits don't affect documentation, this saves 80% of LLM costs. Cheap triage: ~$0.001 per check. Full analysis: ~$0.05-0.20 per doc.

**Source:** Cloudy (open source).

---

### 5.4 Deterministic Temperature (Semcheck)

Semcheck defaults to `temperature: 0.0` for all LLM calls. This produces deterministic (or near-deterministic) output, reducing variability in findings between runs. Same code + same spec = same findings every time.

Still not enough to eliminate false positives — "LLMs tend to raise issues even when there's nothing to report" — but reduces noise from non-deterministic generation.

---

### 5.5 Progressive Verification (Academic: Document Testing)

**How it works (Kang et al. 2024):**

Instead of asking "is this doc consistent with code?" (unreliable), the approach:
1. Extract testable claims from documentation
2. Use LLM to generate executable test cases from each claim
3. Run the tests against the actual code
4. If tests pass: claim is verified. If tests fail: claim is potentially stale.

**Why this matters:** The paper demonstrated that traditional CCI detection (asking LLM if doc matches code) showed NO statistically significant relationship with actual accuracy. But document testing showed a robust relationship. Generating tests is more reliable than asking for opinions.

**Limitation:** Requires code to be testable. Not all doc claims are testable (e.g., "we use event-driven architecture" is hard to test automatically).

**Source:** Academic (Kang et al. 2024, arXiv:2406.14836).

---

## 6. Structured Evaluation & Compliance

Producing actionable, structured output rather than free-text suggestions.

### 6.1 Ticket Compliance Labels (Qodo)

**How it works:**

1. **Auto-detection:** Qodo recognizes tickets via PR description links or branch name prefixes (e.g., `ISSUE-123-feature`)
2. **Data extraction:** Fetches ticket title, description, acceptance criteria, custom fields, subtasks, linked tasks, labels, status, attached images, comments from Jira/Linear/GitHub/GitLab Issues
3. **LLM evaluation:** The Ticket Compliance Agent reads acceptance criteria and evaluates whether the code diff satisfies each requirement
4. **Structured output:**
   - **Fully Compliant** — all requirements satisfied
   - **Partially Compliant** — some requirements met, others need attention
   - **Not Compliant** — clear violations
   - **PR Code Verified** — meets ticket requirements but requires manual testing
5. **Scope creep detection:** Flags code additions that go beyond ticket scope

**Configuration:**
```toml
[pr_reviewer]
require_ticket_analysis_review = true
check_pr_additional_content = true  # flag unrelated changes
```

**Source:** Qodo (paid tier).

---

### 6.2 Custom Compliance Checklists (Qodo)

**How it works:**

Define declarative rules in YAML that the LLM evaluates against every PR:

```yaml
pr_compliances:
  - title: "Error Handling for API Calls"
    compliance_label: true
    objective: "All external API calls must have proper error handling"
    success_criteria: "Try-catch blocks with logging"
    failure_criteria: "Unhandled external API calls"

  - title: "Documentation Updated"
    compliance_label: true
    objective: "Documentation reflects code changes"
    success_criteria: "Relevant docs updated in same PR"
    failure_criteria: "Code changes without corresponding doc updates"
```

**Hierarchical config:** A dedicated `pr-agent-settings` repo with folder structures organizing compliance by groups, individual repos, or monorepo subprojects.

**Source:** Qodo (paid tier).

---

### 6.3 Severity Levels with Evidence (Semcheck)

**How it works:**

Every finding has three possible severity levels:
- **ERROR:** Implementation is blatantly different from spec, would break functionality
- **WARNING:** Missing recommended features, performance issues
- **NOTICE:** Documentation inconsistencies, style issues, missing optional features

Each finding includes:
- `reasoning` — explanation of why this is an inconsistency
- `message` — the specific problem
- `suggestion` — how to fix it
- `file` — which file is affected

**CI integration:** `fail_on_issues: true` in config causes non-zero exit on errors, blocking merge. Individual specs can set `fail_on: "error"` (block on errors only) vs `fail_on: "warning"` (block on warnings too).

**Source:** Semcheck (open source).

---

## 7. Context Engineering

Assembling the right context for LLM analysis — the quality of validation is bounded by the quality of context.

### 7.1 Multi-Source Context Assembly (CodeRabbit)

**How it works:**

CodeRabbit maintains a **1:1 ratio of code-to-context** in LLM prompts. For every line of code reviewed, roughly equivalent contextual information is assembled from:

1. **Codegraph:** Lightweight dependency map built from AST/symbol lookups + commit history analysis (files that frequently change together). Regenerated per review.

2. **Semantic Index (LanceDB):** Embeddings of functions, classes, modules, tests, and prior PRs. Searches by purpose (semantic), not keywords. Sub-second latency at P99 for 50K+ daily PRs.

3. **Past PRs and Issue Tickets:** Indexed titles, descriptions, commit ranges from Jira, Linear, GitHub Issues, GitLab Issues.

4. **Learnings:** Team-specific natural language preferences extracted from past chat interactions.

5. **Coding Guidelines:** Auto-detected from `.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md`, etc.

6. **Web Queries:** Real-time searches for current library/framework documentation when the LLM may lack recent knowledge.

**Intelligent filtering philosophy:** "Curate deliberately, not maximize." Too much irrelevant context overwhelms the model. Context is selected based on relevance to the specific diff hunks being reviewed.

**Multi-model prompting:** Different models receive different prompt structures:
- Claude Sonnet 4.5 = "high-recall point-fixer" (direct DO/DO NOT prompting)
- GPT-5-Codex = "patch generator" (fewer examples, surgical changes)
- Prompt subunits: model-agnostic core logic + model-specific style/formatting layers

**Source:** CodeRabbit (2M+ repos). Architecture described in their [context engineering blog](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews).

---

### 7.2 Three-Layer Codebase Indexing (Qodo Aware)

**How it works:**

Qodo's Context Engine (Qodo Aware) indexes repositories using three layers:

1. **Semantic Context Layer:** Identifies relevant methods, variables, function meanings via vector embeddings.
2. **Architectural Context Layer:** Maps module and service dependencies via structural indexing.
3. **Temporal Context Layer:** Traces commits, changelogs, and test history.

When a code change comes in, the engine retrieves relevant functions, docs, commit history, and architectural patterns using these pre-built indexes.

**Specialized retrieval tools:**
- `get_context` — semantic search
- `deep_research` — agentic analysis (multi-hop)
- `read-file`, `list-dir` — file access
- `pr-memory` — historical PR retrieval

**Multi-repo:** Can index thousands of repos. Every merged PR is semantically embedded and indexed. Review discussions mined for implicit preferences. Failure-pattern database: incident-causing PRs specially indexed.

**Source:** Qodo (paid tier).

---

### 7.3 Agentic RAG with Tools (Mintlify)

**How it works:**

The Mintlify agent has access to tools and decides autonomously how to search and retrieve context:

- `list`, `read`, `write`, `edit`, `delete` — docs file operations
- `external_list`, `external_read`, `list_repositories` — cross-repo access
- `read_navigation` — docs site structure
- `fetch_pull_request` — PR diff and metadata
- `web_fetch`, `web_search` — external references
- `message_user`, `todowrite`/`todoread`, `review_ready` — workflow

The LLM decides what to read and in what order. This is agentic retrieval — the model drives its own context gathering, rather than receiving a pre-constructed context window.

**Powered by Trieve:** Dense vector search + re-ranker models for semantic doc search. 23M+ queries/month.

**Source:** Mintlify ($300/mo Pro).

---

### 7.4 Diff-as-Context Pipeline (Continue CLI)

**How it works:**

Pre-compute the git diff and feed it as a text file:
```bash
git diff origin/main..HEAD --stat >> context.txt
git diff origin/main..HEAD >> context.txt

cn --config org/agent-config \
   --auto \
   --allow Write \
   -p \
   --prompt ./context.txt \
   "Analyze the git diff and update documentation..."
```

The agent receives the raw diff as initial context, then uses built-in tools (Read, List, Search via ripgrep) to explore the full repository as needed.

**Key insight:** The diff focuses attention. The tools enable exploration. This is a cheap but effective context strategy — give the LLM the "what changed" and let it pull additional context on demand.

**Source:** Continue (31K GitHub stars, open source).

---

## 8. Update Generation

How tools generate documentation updates once drift is detected.

### 8.1 Agentic Write Loop (Mintlify)

**How it works:**

The agent has `write` (create/replace) and `edit` (patch) tools for documentation files. It runs in an agentic loop:

1. Read relevant doc pages using `list`/`read` tools
2. Read code changes using `fetch_pull_request`
3. Decide what to update based on reasoning
4. Use `edit` for patching specific sections or `write` for new pages
5. Iterate: read result, check quality, edit further if needed
6. When satisfied: `review_ready` to signal human review

**AGENTS.md customization:** Users can provide content requirements, project context, and style guidelines that the agent appends to its system prompt.

**Human-in-the-loop:** Creates PR. Human reviews and merges. Never auto-publishes.

**Source:** Mintlify.

---

### 8.2 Targeted Section Edits (DeepDocs)

**How it works:**

DeepDocs does NOT rewrite entire documents. It generates targeted edits:
- Identifies which sections within a doc are affected by code changes
- Modifies only those sections
- Preserves formatting, tone, and structure of surrounding content
- PR includes a detailed change report explaining what changed and why

**Source:** DeepDocs.

---

### 8.3 Surgical Snippet Replacement (Cloudy)

**How it works:**

Revision suggestions use XML-tagged structure:
```xml
<suggestion>
  <selected_snippet>Old text from the document</selected_snippet>
  <replacement_snippet>New text reflecting the code change</replacement_snippet>
</suggestion>
```

This is the most precise update format found — specific old text → new text replacements rather than section-level or page-level rewrites. Easy for humans to review: you see exactly what changes and why.

**Source:** Cloudy (open source).

---

### 8.4 General-Purpose Agent Framework (Continue CLI)

**How it works:**

The same agent framework used for doc generation can be used for any doc operation. You control behavior entirely through the prompt:

- **Generation prompt:** "Create or modify Markdown files to document new features..."
- **Validation prompt:** "Compare docs against code and flag inconsistencies..." (with `--exclude Write` for read-only)
- **Update prompt:** "Update only the sections that are now outdated..."

**Permission controls:**
- `--allow Write` — agent can modify files
- `--exclude Write --exclude Edit --exclude Bash` — read-only mode (validation only)
- `--auto` — auto-approve all tool calls

**Model-agnostic:** System message tools convert tool definitions to XML, providing universal compatibility. Even instruction-following-only models can use agent tools.

**Source:** Continue (open source, Alpha).

---

## 9. Learning & Memory

Systems that improve over time based on team behavior, past corrections, and accumulated project knowledge.

### 9.1 Explicit Learnings System (CodeRabbit)

**How it works:**

1. **Creation:** Team members reply to CodeRabbit's PR comments with natural language feedback (e.g., "We prefer early returns over nested try-catch"). Can also import from files (`@coderabbitai add a learning using docs/coding-standards.md`). Admins create via dashboard.

2. **Storage:** LanceDB-backed vector embeddings associated with the Git organization.

3. **Scope:** Three modes:
   - `local` — repo-specific only
   - `global` — all org repos
   - `auto` — public repos = local, private repos = global

4. **Metadata:** Each learning stores PR number, filename, associated user.

5. **Application:** Every review loads applicable learnings based on scope and uses them as additional LLM context.

6. **Evolution:** Developer chats and PR outcomes are continuously re-embedded. Pattern drift detected automatically as team behaviors evolve.

7. **Management:** View/filter/edit/delete via web interface. Export as CSV. Similarity search available.

**Source:** CodeRabbit.

---

### 9.2 Team Standard Learning (Greptile)

**How it works:**

Greptile v3 reads engineers' existing GitHub/GitLab review comments to learn team-specific coding standards. Examples: "use pytest parametrization", "prefer @ts-expect-error over as any".

**MCP feedback loop:** Learnings are served to coding agents (Cursor, Claude Code, Devin) via MCP server BEFORE they write code. This improves generation quality upstream, not just review quality.

**Org-isolated:** Learnings from one organization never leak to another.

**Source:** Greptile (v3, $25M Series A).

---

### 9.3 PR History & Failure Patterns (Qodo)

**How it works:**

1. **PR history indexing:** Every merged PR is semantically embedded and indexed. During new reviews, relevant past PRs are retrieved to understand precedent.

2. **Review discussion mining:** Past PR comments and discussions are parsed to extract implicit team preferences and architectural decisions.

3. **Failure-pattern database:** Incident-causing PRs are specially indexed. The system recognizes when a new PR touches code areas that previously caused incidents.

4. **Temporal context ("PR Time Machine"):** Traces how code areas have evolved through commits, changelogs, and PR discussions. Confirms whether a field, rule, or pattern was removed intentionally or accidentally.

**Source:** Qodo.

---

### 9.4 Confidence Decay Memory (Drift Cortex)

**How it works:**

Tribal knowledge stored in Drift's memory has time-based confidence decay (365-day half-life). Knowledge added a year ago has half the confidence of fresh knowledge. This automatically down-weights stale tribal knowledge without requiring manual curation.

`drift memory add tribal "Always use bcrypt for passwords"` — starts at full confidence, decays over time.

**Source:** Drift (678 GitHub stars, open source).

---

## 10. AI Agent Context Serving (MCP)

Serving documentation and codebase knowledge to AI coding agents before they write code.

### 10.1 Read-Only Doc Retrieval (DocSync)

**How it works:**

DocSync's MCP server (`npx @docsync/mcp-server`) provides read-only access to auto-generated documentation:
- Query documentation by topic/module
- Get architecture context
- Retrieve function purposes, parameters, return values, usage examples
- Access high-level patterns, design decisions, module interactions
- Search across multiple repos in a "Project"

**One-directional:** The AI assistant reads docs but cannot report "this doc is wrong" or "this section is outdated" through MCP. No write/update/validate tools exposed.

**Source:** DocSync ($29/mo Pro).

---

### 10.2 Codebase Query + Team Rules (Greptile)

**How it works:**

Greptile's MCP server exposes:
- Codebase queries (natural language → answer + relevant files/functions)
- Team-learned coding standards

AI coding agents (Cursor, Claude Code, Devin) query Greptile BEFORE writing code. This frontloads context — the agent knows about project patterns and conventions before it generates code, not just during review.

**API endpoints:**
- `POST /repositories` — submit repo for indexing
- `POST /query` — natural language query → answer + references
- `POST /search` — search repos → matching code elements

**Source:** Greptile.

---

### 10.3 Context Engine Access (Qodo)

**How it works:**

Qodo Aware is exposed via MCP for integration with external tools. Coding agents can access:
- Semantic codebase search
- Architectural context
- PR history and patterns

**Source:** Qodo (paid tier).

---

## 11. Syntactic Validation (Baseline)

Deterministic checks that don't require LLMs. These form the cheap, reliable baseline.

### 11.1 File Path Reference Validation

**How it works:** Parse documentation for file path references (`src/auth/handlers.ts`, `docs/api.md`). Check if each referenced path exists on disk.

**Implementations:**
- **DOCER** (academic, 3 GitHub stars): GitHub Actions workflow scanning README and wiki pages. Found 28.9% of top 1000 GitHub projects had at least one outdated reference.
- **Link checkers** (linkinator, check-links, etc.): Validate URL references and internal links.
- **Swimm Smart Tokens:** Track file path references with auto-sync on rename.

**Coverage:** Catches renamed/deleted files. Does NOT catch changed behavior at unchanged paths.

---

### 11.2 Dependency Version Validation

**How it works:** Parse documentation for package/dependency references. Cross-reference against `package.json`, `requirements.txt`, `Cargo.toml`, etc. Flag mismatches.

**Example:** Doc says "React 18.2" but `package.json` has `"react": "^19.0.0"` → flag.

**No known production tool does this specifically.** Could be built with regex + package file parsing, zero LLM required.

---

### 11.3 Command Validation

**How it works:** Parse documentation for shell commands (`pnpm dev`, `cargo test`, `npm run build`). Validate against package.json scripts, Makefile targets, Cargo.toml commands.

**Example:** Doc says `npm run test:unit` but `package.json` has no `test:unit` script → flag.

**No known production tool does this specifically.** Could be built deterministically.

---

### 11.4 API Spec Drift (DriftLinter)

**How it works:** Static analysis compares route definitions in code against OpenAPI 3.0+ specs. Detects:
- Missing routes (in code but not in spec)
- Zombie routes (in spec but not in code)
- Schema parameter mismatches

Supports Python (Flask, FastAPI, Django), TypeScript/JS (Express, NestJS, Fastify), PHP (Laravel, Symfony).

**Source:** DriftLinter (2 GitHub stars, v0.0.4, GitHub Action).

---

### 11.5 Prose Quality Linting (Vale)

**How it works:** Rule-based pattern matching on prose: terminology consistency, passive voice, sentence length, jargon. NOT freshness or accuracy — just writing quality.

**Source:** Vale (5,226 GitHub stars). Used by Red Hat, Datadog, Elastic.

---

## 12. Claim Decomposition & Evidence Retrieval

The emerging architecture pattern: break docs into individual claims, then verify each.

### 12.1 The Pattern (No Production Implementation)

**Proposed architecture (synthesized from academic research + Exa + Semcheck):**

1. **Extract claims from documentation:** Parse each doc file into discrete, testable assertions.
   - "Authentication uses bcrypt" → claim about dependency/pattern
   - "Data flows: API → Queue → Worker" → claim about architecture
   - "Run `pnpm test` for unit tests" → claim about commands
   - "The AuthService handles login and registration" → claim about code structure

2. **Classify each claim:**
   - **Syntactic** (verifiable by file/symbol lookup): file paths, dependency names, CLI commands
   - **Semantic** (requires code understanding): behavior descriptions, architecture claims, pattern assertions
   - **Untestable** (opinion/preference): style preferences, tone guidelines

3. **Gather evidence for each claim:**
   - Syntactic claims: grep, file existence check, package.json lookup
   - Semantic claims: retrieve relevant code via embeddings/graph, send to LLM
   - Untestable claims: skip or flag as "unverifiable"

4. **Verify each claim individually:**
   - Syntactic: deterministic pass/fail (cheap, fast, reliable)
   - Semantic: LLM comparison of claim + evidence (expensive, slower, ~80% accuracy)
   - Generate executable tests from claims where possible (Kang et al. approach)

5. **Aggregate results into structured report:**
   - Per-claim: Valid / Drifted / Uncertain
   - Per-document: health score (% of claims still valid)
   - Per-repo: overall documentation health

**Why this doesn't exist yet:**
- Step 1 (claim extraction from unstructured markdown) is non-trivial
- Step 3 (evidence retrieval for semantic claims) requires codebase understanding
- Step 4 (semantic verification) has ~14% acceptance rate in real-world studies
- Nobody has combined all steps into a production system

**The closest approximation:** Semcheck does steps 1+4 but skips 2+3 (sends full files instead of claim-level evidence). The academic "document testing" approach does steps 1+4+verification via tests but is limited to method-level comments.

---

## Summary: What Exists vs What's Missing

| Capability | Best Existing Implementation | Gap |
|------------|------------------------------|-----|
| Codebase graph | Greptile (AST + docstrings + embeddings) | Nobody combines with doc validation |
| Code-to-doc mapping | All manual (Semcheck YAML, Cloudy DB, DeepDocs config) | **Automatic discovery** |
| Semantic comparison | Semcheck (full-file LLM) | **Diff-aware, incremental, claim-level** |
| Change triggers | DeepDocs/Cloudy/Mintlify (webhooks) | **Multi-signal** (commits + confusion + staleness age) |
| Noise filtering | Qodo Judge, CodeRabbit verification, Cloudy triage | **Progressive: cheap syntactic → expensive semantic** |
| Structured evaluation | Qodo compliance labels | **Applied to docs**, not just tickets |
| Context engineering | CodeRabbit (codegraph + LanceDB + learnings) | **Doc-optimized** context assembly |
| Update generation | Mintlify (agentic), Cloudy (snippet replacement) | **Claim-level** edits |
| Learning/memory | CodeRabbit (explicit), Greptile (implicit) | **Doc-correction-specific** learning |
| MCP serving | DocSync/Greptile (read-only) | **Bidirectional** (read + report drift) |
| Syntactic validation | DOCER, link checkers, Swimm | Fragmented, no unified tool |
| Claim decomposition | Nobody (academic only) | **End-to-end production system** |
