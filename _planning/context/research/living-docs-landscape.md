# Living Documentation Landscape: Products, Approaches, and Gaps

> Compiled: 2026-02-08
> Purpose: Map the "living documentation" space -- what exists, what works, what gaps remain -- specifically as it relates to AI instruction files (CLAUDE.md, AGENTS.md, .cursorrules).
> Builds on: README.md (tool catalog), workflow-analysis.md (staleness lifecycle), failure-scenarios.md (compliance failures)

---

## 1. Documentation-Code Sync Products

### Tier 1: Dedicated Documentation Sync Platforms

#### Swimm (swimm.io) -- The Gold Standard for Code-Coupled Docs
- **Status**: Active, independent ($8.8M revenue, 57 employees, Series A, $33.3M raised). NOT acquired by Notion (rumor is false -- both companies remain separate as of Feb 2026).
- **What it does**: "Code-coupled documentation" that links docs to specific code elements via Smart Tokens. Auto-syncs docs when code changes via a patented algorithm.
- **How Smart Tokens work**: When you reference a function, variable, or file path in a Swimm doc, it creates a tracked link. The auto-sync algorithm analyzes line markers, line numbers, token references, change size, and file version history to determine if a doc is still fresh.
- **CI integration**: Runs on every PR. Compares existing docs against code changes. If auto-sync can handle the delta, it patches automatically. If the change is too large/ambiguous, it blocks the PR and flags the doc as potentially stale. Swimm provides a Health Score via Atlassian Compass integration.
- **Reliability**: The algorithm is conservative -- it prefers asking a human to reselect a snippet over offering a bad auto-fix. Currently no known limits on CI performance.
- **Limitation for our purposes**: Swimm targets human-facing documentation (onboarding guides, architecture docs, tutorials). It does NOT target AI instruction files. Smart Tokens track code references, not behavioral rules or conventions. If your CLAUDE.md says "always use bcrypt for passwords," Swimm has no mechanism to detect that you switched to argon2.
- **Pricing**: Undisclosed (enterprise sales). Free tier for small teams.
- **Sources**: [swimm.io](https://swimm.io), [Auto-sync blog](https://swimm.io/blog/how-does-swimm-s-auto-sync-feature-work), [Swimm CI docs](https://swimm.io/blog/continuous-documentation-through-continuous-integration-with-swimm)

#### Mintlify (mintlify.com) -- AI-Powered Docs with Autopilot
- **Status**: Active, well-funded ($18.5M Series A led by a16z).
- **What it does**: Developer documentation platform with an AI "Autopilot" agent that monitors your codebase and proposes doc updates when you ship code.
- **How Autopilot works**: Watches your code repository. When a merge occurs, the agent reviews changed files, identifies what needs documentation updates, and creates a PR in your docs repository. It understands your documentation structure and tone.
- **Auto-update workflow**: Can be triggered via webhooks on code changes. Agent can also incorporate context from PRs, Slack threads, or links.
- **Limitation for our purposes**: Mintlify is an external documentation platform for API docs, guides, and references. It generates/updates Mintlify-hosted docs, not in-repo AI instruction files. No mechanism to update CLAUDE.md or .cursorrules.
- **Pricing**: Agent features only on Pro ($300/month) or Custom. Includes 250 AI messages/month.
- **Sources**: [Mintlify Autopilot blog](https://www.mintlify.com/blog/autopilot), [Auto-update tutorial](https://www.mintlify.com/docs/guides/automate-agent), [Mintlify Review](https://ferndesk.com/blog/mintlify-review)

#### DocSync (docsync.dev) -- AI Docs Platform with MCP
- **Status**: Active, early stage, unclear adoption.
- **What it does**: AI-powered documentation platform that connects to your GitHub/Bitbucket repo, analyzes your codebase, and generates architecture guides, API references, and module documentation. Includes an MCP server so AI assistants can query docs directly.
- **Auto-detect on merge**: When you merge code, DocSync detects what changed and updates affected documentation automatically.
- **Limitation for our purposes**: Generates its own documentation format, not AI instruction files. The MCP integration is interesting (AI agents can query DocSync for context) but it's a documentation platform, not an instruction-file updater.
- **Pricing**: Unknown.
- **Sources**: [docsync.dev](https://docsync.dev/)

#### DeepDocs (deepdocs.dev) -- GitHub-Native Doc Auto-Update
- **Status**: Deprecated on GitHub Marketplace, but service appears still operational via deepdocs.dev.
- **What it does**: Watches your codebase and auto-proposes documentation update PRs when code changes.
- **Limitation**: Deprecated marketplace listing suggests uncertain future. Targets general documentation, not AI instruction files.
- **Pricing**: $0-25/month.
- **Sources**: [GitHub Marketplace](https://github.com/marketplace/deepdocsai), [deepdocs.dev](https://deepdocs.dev/)

#### DocsAlot (docsalot.dev) -- Autonomous Doc Generation
- **Status**: Active, early stage.
- **What it does**: Fully autonomous agentic workflow that analyzes codebases and generates/updates documentation. Can target individual files like README.md and CONTRIBUTING.md. Includes version control and AI chatbot assistant.
- **Limitation**: Targets general documentation (README, CONTRIBUTING). No specific AI instruction file support.
- **Sources**: [docsalot.dev](https://docsalot.dev/)

### Tier 2: API Documentation Sync (Spec-Driven)

These products auto-sync documentation from API specifications (OpenAPI/AsyncAPI). Relevant as a pattern but not directly applicable to AI instruction files.

| Product | What It Does | Auto-Sync Mechanism | Limitation |
|---------|-------------|---------------------|------------|
| **ReadMe.com** | API docs hub with analytics | GitHub Action syncs OpenAPI spec to ReadMe on every push to main. CLI (`rdme`) for manual sync. | API docs only. Syncs spec-to-docs, not code-to-docs. |
| **Bump.sh** | API doc platform with changelog | GitHub Action auto-deploys docs from OpenAPI/AsyncAPI on merge. Comments PRs with API diff. | API docs only. No general code awareness. |
| **Speakeasy** | SDK + docs generation from OpenAPI | CI/CD workflows auto-regenerate SDKs and docs from spec changes. Studio for look-and-feel. | SDK/API focused. Generates client libraries, not instruction files. |
| **Stainless** | SDK generation (used by OpenAI, Anthropic) | Pushes to OpenAPI spec auto-regenerate SDKs + open PRs. Hosts spec at stable URL. | Enterprise SDK tooling. Not for documentation sync. |
| **Fern** | SDKs + docs from API definition | Generates SDKs and docs from same source; both auto-update together. Git-versioned docs. | API-first workflow. Not applicable to instruction files. |

**Pattern insight**: All API doc sync tools follow the same model: **single source of truth (OpenAPI spec) -> auto-generate downstream artifacts (docs, SDKs) on change**. This pattern is relevant to AI instruction files: what if the codebase IS the source of truth, and CLAUDE.md is the downstream artifact that gets auto-generated?

### Tier 3: General Documentation Generation Tools

| Tool | Approach | AI Instruction File Relevance |
|------|----------|------------------------------|
| **DocuWriter.ai** | Generates docs from code analysis (comments, function signatures, types). n8n integration for CI/CD triggers. $29-249/month. | Generates developer docs, not AI instruction files. |
| **GitBook** | Docs-as-code with Git workflow. AI writing assistant. $65-249/month + per-user. | Publishing platform. No auto-sync from code. |
| **Notion AI** | AI writing assistant within Notion workspace. Conversational doc generation. $20/user/month (Business tier). | General-purpose. No code awareness. |
| **Confluence AI** (Atlassian Intelligence) | AI add-on for Confluence wikis. | Enterprise wiki. No code coupling. |

---

## 2. Code-Aware Intelligence Tools (The Closest to "Living AI Instructions")

These tools understand code and provide dynamic context to AI agents. They are the closest existing products to "auto-update CLAUDE.md when code changes."

### Drift (dadbodgeoff/drift) -- 678 stars
- **What it does**: Codebase intelligence MCP server. Scans code, detects 101+ patterns across 10 languages, builds call graphs, and exposes findings via 50+ MCP tools. Rust core, 100% local, offline CLI.
- **Cortex Memory System**: The most relevant feature. Cortex is a "living memory system that replaces static instruction files." Instead of a static CLAUDE.md, you store tribal knowledge, architectural decisions, and conventions in Drift's memory (`drift memory add tribal "Always use bcrypt for passwords"`). AI agents query this dynamically via MCP. Confidence decays on stale knowledge.
- **Key claim**: "Delete your static AGENTS.md or CLAUDE.md files -- they become stale. Use Drift instead."
- **Gap analysis**: Drift replaces instruction files with dynamic queries, but it requires AI agents to actively query Drift (via MCP) rather than passively reading a file. This works great for agents that support MCP (Claude Code, Cursor) but breaks the simplicity of a plain markdown file. It also requires the developer to manually add tribal knowledge -- it doesn't auto-detect conventions from code changes.
- **Sources**: [GitHub](https://github.com/dadbodgeoff/drift), [Wiki](https://github.com/dadbodgeoff/drift/wiki)

### Constellation (constellationdev.io) -- Enterprise
- **What it does**: Structural codebase map via MCP. Enterprise-focused.
- **Relevance**: Provides codebase understanding but does not generate or update instruction files.
- **Sources**: [constellationdev.io](https://constellationdev.io/)

### Bito AI Architect (bito.ai)
- **What it does**: Live knowledge graph of your codebase. 60.8% SWE-Bench Pro. $15-25/user/month.
- **Relevance**: Understands code structure but targets code generation quality, not instruction file maintenance.
- **Sources**: [bito.ai](https://bito.ai/)

---

## 3. Tools Specifically Targeting AI Instruction Files

### GitHub Spec Kit -- CLAUDE.md Auto-Update (Buggy)
- **Stars**: 28,000
- **What it does**: Toolkit for spec-driven development. Includes `update-agent-context.sh` that auto-updates CLAUDE.md with technology information detected in the codebase.
- **Known bugs**:
  - **Issue #1469**: Auto-update repeatedly adds the same technologies, creating duplicates. Request to disable automatic updates by default.
  - **Issue #365**: `/plan` command calls `update-agent-context.sh` which completely overwrites CLAUDE.md, deleting all existing project documentation and guidelines. Reported Sep 2025.
  - **Issue #596**: `update-agent-context.sh` does not actually save changes to CLAUDE.md file.
- **Assessment**: The CLAUDE.md auto-update feature is the closest existing attempt at "living AI instruction files," but it is severely buggy. It demonstrates the difficulty of the problem: naive auto-update either creates duplicates, overwrites manual content, or fails silently.
- **Sources**: [GitHub](https://github.com/github/spec-kit), [Issue #1469](https://github.com/github/spec-kit/issues/1469), [Issue #365](https://github.com/github/spec-kit/issues/365)

### AlignTrue (aligntrue-sync) -- Drift Detection for AI Rules
- **Stars**: 0 (alpha)
- **What it does**: Syncs AI rules across 28+ agents. The ONLY tool found with explicit "drift detection" for AI instruction files. Includes CI/CD commands (`aligntrue check --ci`, `aligntrue drift --gates`).
- **Assessment**: Conceptually closest to what we're exploring. But zero adoption, alpha status, and unclear what "drift detection" actually means technically (does it compare rules to code reality, or just check for format/syntax issues?).
- **Sources**: [GitHub](https://github.com/AlignTrue/aligntrue-sync)

### Factory.ai Doc Sync Hooks -- Enterprise Only
- **What it does**: PostToolUse hooks that trigger documentation regeneration after Factory's AI agent ("Droid") executes actions. Hooks can provide feedback including "block" decisions with reasons.
- **Assessment**: Most sophisticated hook-based approach, but locked inside Factory's enterprise platform. Not available as standalone tooling.
- **Sources**: [Factory Hooks Reference](https://docs.factory.ai/reference/hooks-reference)

### Self-Improving Rules Pattern (SashiDo)
- **What it does**: A Cursor-specific pattern where the agent evolves its own `.mdc` rule files over time based on corrections and learnings.
- **Assessment**: Interesting concept (agent maintains its own instructions), but manual, Cursor-only, unvalidated, and no mechanism to prevent drift or hallucination in self-written rules.
- **Sources**: [SashiDo Blog](https://blog.sashido.io/cursor-self-improving-rules/)

---

## 4. The "Docs as Code" Movement -- State of the Art

### How Teams Currently Keep Docs Fresh

| Approach | Description | Effectiveness |
|----------|-------------|---------------|
| **Manual review cadence** | "Review docs monthly" or after sprints | LOW -- depends on discipline, universally forgotten |
| **Reference, don't copy** | Point to files instead of embedding content | MEDIUM -- prevents copy-paste staleness but doesn't detect convention changes |
| **PR-triggered updates** | Tag @claude in PR comments, or use GitHub Actions to flag docs needing review | MEDIUM -- requires manual trigger or CI setup |
| **Symlink single source** | AGENTS.md as canonical source, symlink to CLAUDE.md, .cursorrules | MEDIUM -- solves format duplication, not content accuracy |
| **Rule sync tools** | rulesync, Ruler, rulebook-ai generate tool-specific files from one source | MEDIUM -- solves format fragmentation, not content accuracy |
| **CI doc freshness checks** | Swimm CI, custom scripts comparing doc timestamps to code timestamps | HIGH for what it covers -- but limited to file-reference checks |

### CI/CD Approaches for Doc Validation

1. **Swimm CI**: Runs on every PR, compares Smart Token references to code changes, auto-syncs or blocks if docs are stale. The most mature approach.
2. **Link validation tools**: linkinator, check-links-with-linkcheck prevent broken references. Catches renamed files but not convention changes.
3. **Super-Linter / MegaLinter**: Validate doc formatting (Markdown, YAML, JSON) in CI. Catches syntax errors, not content drift.
4. **Custom timestamp comparison**: "x% of changed files have no corresponding doc update" as merge criteria. Crude but effective for awareness.
5. **API spec validation**: Spectral, Redocly lint OpenAPI specs for completeness and consistency.

### State of the Art for Detecting Doc-Code Drift

**Academic research**: An IEEE paper (2025) titled "A Review on Detecting and Managing Documentation Drift in Software Development" addresses outdated documentation that misleads developers, highlighting the need for robust synchronization and traceability. This is the first formal academic treatment of doc-code drift as a distinct problem.

**Best available approach**: Swimm's patented auto-sync algorithm is the most sophisticated production system for detecting doc-code drift. It tracks code references in docs and flags/fixes them when code changes. But it only works for references it can track (code snippets, function names, file paths). It cannot detect:
- Convention changes (team switched from enums to string literal unions)
- Pattern evolution (error handling approach changed)
- Architectural shifts (monolith split into microservices)
- Dependency updates (SDK v1 to v2 migration)

**The fundamental gap**: No tool detects semantic drift between what documentation CLAIMS about the codebase and what the codebase ACTUALLY does. All existing tools either track syntactic references (file paths, function names) or rely on timestamp heuristics. The semantic layer is entirely unaddressed.

---

## 5. Specific Analysis: AI Instruction File Sync

### Is "Living AI Instruction Files" a Solved Problem?

**No. Definitively not.** Here is the evidence:

1. **50% of AGENTS.md files are never updated after creation** (arXiv:2512.18925, study of 155 files). The staleness problem is the norm, not the exception.

2. **Zero products specifically target AI instruction file freshness.** Swimm, Mintlify, DocSync, DeepDocs, DocsAlot -- all target general developer documentation. None generate, update, or validate CLAUDE.md / AGENTS.md / .cursorrules content.

3. **The closest attempt (Spec Kit) is buggy.** GitHub Spec Kit's CLAUDE.md auto-update creates duplicates, overwrites manual content, or fails to save. Three open issues document fundamental problems.

4. **Drift (Cortex) takes a different approach -- replace files entirely.** Rather than keeping instruction files fresh, Drift advocates deleting them and replacing them with dynamic MCP queries. This is architecturally sound but requires MCP support and manual knowledge entry.

5. **AlignTrue claims drift detection but has zero adoption.** The only tool that explicitly mentions "drift detection" for AI instruction files is in alpha with zero stars.

### What Is the Closest Existing Product?

**Drift (dadbodgeoff)** is the closest to "auto-update CLAUDE.md when code changes," but with a fundamentally different approach:
- Instead of updating a static file, it replaces the file with dynamic queries
- It detects code patterns (101+ detectors) and makes them available via MCP
- Its Cortex memory system stores decisions and conventions with confidence decay
- But it requires manual knowledge entry for tribal knowledge, and it doesn't generate instruction files

**Swimm** is the closest in mechanism (auto-sync algorithm that patches docs when code changes), but it targets human documentation, not AI instruction files, and can only track references it explicitly knows about.

### The Gap Between General Doc Sync and AI Instruction File Sync

| Dimension | General Doc Sync (Swimm, Mintlify) | AI Instruction File Needs |
|-----------|-------------------------------------|---------------------------|
| **Content type** | Prose explanations, API references, tutorials | Behavioral rules, conventions, architectural constraints |
| **Audience** | Human developers reading docs | LLM context window (~150-200 instruction slots) |
| **Freshness signal** | File path / function name references | Conventions, patterns, dependency versions, architecture decisions |
| **Update mechanism** | Patch code snippets in docs | Rewrite behavioral rules to match new reality |
| **Validation** | "Does this code reference still exist?" | "Does this rule still match how the code actually works?" |
| **Format** | Long-form prose, Markdown with rich structure | Concise rules, often under 300 lines, specific instructions |
| **Staleness impact** | Human confusion, slower onboarding | AI generates wrong code confidently, at scale |

**Key insight**: The gap is not incremental. AI instruction files are a fundamentally different artifact than developer documentation. They need:
1. **Convention detection** (what patterns does the code actually use?)
2. **Rule-reality comparison** (does this rule match the codebase?)
3. **Budget-aware generation** (fit within ~150 instruction slots)
4. **Cross-tool translation** (same rules, different formats for each agent)
5. **Semantic validation** (not just "does the file exist?" but "is the rule still true?")

None of these exist in any production tool today.

---

## 6. Product Landscape Map

```
                    GENERAL DOCUMENTATION              AI INSTRUCTION FILES
                    |                                  |
  STATIC            |  GitBook, Notion, Confluence     |  AGENTS.md standard
  (manual update)   |  ReadMe (manual sync)            |  .cursorrules (manual)
                    |                                  |  CLAUDE.md (manual)
                    |                                  |
  SEMI-AUTO         |  Swimm (Smart Token auto-sync)   |  Spec Kit (buggy auto-update)
  (some automation) |  Mintlify Autopilot (PR agent)   |  AlignTrue (alpha, 0 stars)
                    |  DocSync (merge detection)       |  Self-improving rules (manual pattern)
                    |  DeepDocs (deprecated)           |
                    |  DocsAlot (autonomous)           |
                    |                                  |
  AUTO-GENERATED    |  Bump.sh (from OpenAPI spec)     |  Drift Cortex (replaces files
  (from source of   |  Speakeasy (from OpenAPI)        |   with dynamic MCP queries)
  truth)            |  Stainless (from OpenAPI)        |  Factory.ai hooks (enterprise-only)
                    |  Fern (from API definition)      |
                    |  DocuWriter.ai (from code)       |  <<< NOTHING EXISTS HERE
                    |                                  |      that auto-generates AI
                    |                                  |      instruction files from
                    |                                  |      code reality >>>
```

The bottom-right quadrant is empty. No product auto-generates or auto-updates AI instruction files from codebase reality.

---

## 7. What Would It Take to Build an MVP?

### The Core Technical Challenge

An MVP for "living AI instruction files" needs to solve three problems:

**Problem 1: Convention Detection**
- Detect what patterns, conventions, and architectural decisions the codebase actually uses
- Drift already does this (101+ pattern detectors, call graphs, 10 languages, Rust core)
- This is technically feasible today -- it's static analysis + heuristics

**Problem 2: Rule-Reality Comparison**
- Compare what instruction files CLAIM vs what the codebase ACTUALLY does
- Example: CLAUDE.md says "use Jest for testing" but the codebase has migrated to Vitest
- Example: CLAUDE.md references `src/auth/handlers.ts` but the file was renamed to `src/auth/service.ts`
- This requires: parsing instruction files into structured claims, then validating each claim against the codebase
- **Technically hard for semantic claims** (convention rules), **easy for syntactic claims** (file paths, dependency names)

**Problem 3: Instruction Generation/Update**
- Generate or update instruction file content that is accurate, concise, and within the ~150-200 instruction budget
- This is an LLM task -- take detected conventions + existing rules + validation results, produce updated CLAUDE.md
- Risk: LLM-generated rules may themselves be wrong or unhelpful (garbage in, garbage out)

### Possible MVP Approaches

**Approach A: Drift Check (Smallest)**
- Parse CLAUDE.md for concrete references (file paths, dependency names, framework references)
- Validate each against the codebase (does the file exist? is the dependency in package.json?)
- Output a "freshness report" showing stale references
- **Effort**: 2-3 weeks. Deterministic, no LLM needed.
- **Value**: Catches the easiest staleness (renamed files, removed deps) but misses convention drift.

**Approach B: Convention Delta (Medium)**
- Run Drift-style pattern detection on the codebase
- Parse CLAUDE.md rules into structured claims
- Compare detected patterns to claimed patterns
- Flag contradictions (rule says X, code does Y)
- **Effort**: 4-6 weeks. Requires pattern detection + NLP parsing of rules.
- **Value**: Catches convention drift. Higher false-positive risk.

**Approach C: Full Auto-Update (Largest)**
- Detect conventions from code (Approach B)
- Generate updated instruction file content using LLM
- Present as PR or diff for human review
- **Effort**: 8-12 weeks. Requires LLM integration + careful UX for review.
- **Value**: Closest to "living docs" vision. Highest risk of wrong/unhelpful updates.
- **Lesson from Spec Kit**: Naive auto-update (Approach C without human review) creates duplicates, overwrites, and silent failures. Human-in-the-loop is essential.

### The Swimm Pattern Applied to AI Instructions

Swimm's approach offers the most proven architecture:
1. **Track specific code references** in instruction files (file paths, function names, dependency versions)
2. **Run validation on every PR** (are references still valid?)
3. **Auto-patch simple changes** (file renamed -> update reference)
4. **Block and flag complex changes** (architecture shifted -> human must update rules)
5. **Health score** (X% of your instruction file references are still valid)

This could be built as a CI check or pre-commit hook. No LLM needed for the core validation. LLM only needed for suggested fixes (optional).

---

## 8. Key Conclusions

### 1. Living AI instruction files is an unsolved problem.
No product specifically keeps CLAUDE.md, AGENTS.md, or .cursorrules in sync with codebase reality. The general documentation sync space is well-served (Swimm, Mintlify), but AI instruction files are a fundamentally different artifact.

### 2. The closest approaches each have fatal limitations.
- **Spec Kit**: Buggy, creates duplicates, overwrites manual content
- **Drift Cortex**: Replaces files entirely with dynamic MCP queries (different paradigm)
- **AlignTrue**: Zero adoption, alpha, unclear what "drift detection" means technically
- **Swimm**: Mature auto-sync but for human docs, not AI instructions

### 3. The API doc sync pattern is the right architectural model.
Bump.sh, Speakeasy, Stainless, Fern all follow: source of truth -> auto-generate downstream artifacts. For AI instruction files, the codebase IS the source of truth and the instruction file is the downstream artifact.

### 4. Semantic drift is the hard problem.
Syntactic drift (renamed files, removed dependencies) is easy to detect. Semantic drift (convention changes, pattern evolution, architectural shifts) is hard. No tool -- for any documentation type -- solves semantic drift detection today.

### 5. Human-in-the-loop is essential.
Spec Kit's experience proves that naive auto-update is dangerous. Any living docs system for AI instructions must present changes for human review, not silently update. The Swimm model (auto-patch simple changes, block on complex ones) is the right UX pattern.

### 6. The instruction budget constraint changes everything.
Human docs can be long. AI instruction files must fit in ~150-200 instruction slots (HumanLayer research). This means any auto-update system must also manage the instruction budget -- not just add new rules, but prioritize, compress, and retire stale ones. This is a unique requirement that no existing doc sync tool addresses.

---

## Sources

### Products Researched
- [Swimm](https://swimm.io) | [Auto-sync algorithm](https://swimm.io/blog/how-does-swimm-s-auto-sync-feature-work) | [CI integration](https://swimm.io/blog/continuous-documentation-through-continuous-integration-with-swimm)
- [Mintlify](https://mintlify.com) | [Autopilot](https://www.mintlify.com/blog/autopilot) | [Auto-update tutorial](https://www.mintlify.com/docs/guides/automate-agent)
- [ReadMe.com](https://readme.com) | [CLI/GitHub sync](https://docs.readme.com/main/docs/rdme)
- [Bump.sh](https://bump.sh) | [GitHub Action](https://github.com/marketplace/actions/bump-sh-api-documentation-changelog) | [Docs-as-code blog](https://bump.sh/blog/docs-as-code-api-doc-workflows/)
- [Speakeasy](https://speakeasy.com) | [SDK generation](https://www.speakeasy.com/product/sdk-generation)
- [Stainless](https://stainless.com) | [2025 roadmap](https://www.stainless.com/blog/stainless-in-2025-building-the-api-platform-we-always-wanted)
- [Fern](https://buildwithfern.com) | [API docs + SDKs](https://buildwithfern.com/post/api-documentation-sdk-generation-tools)
- [DocSync](https://docsync.dev)
- [DeepDocs](https://deepdocs.dev) | [GitHub Marketplace](https://github.com/marketplace/deepdocsai)
- [DocsAlot](https://docsalot.dev)
- [DocuWriter.ai](https://www.docuwriter.ai)
- [GitBook](https://gitbook.com)
- [Drift (dadbodgeoff)](https://github.com/dadbodgeoff/drift) | [Wiki](https://github.com/dadbodgeoff/drift/wiki)
- [GitHub Spec Kit](https://github.com/github/spec-kit) | [Issue #1469](https://github.com/github/spec-kit/issues/1469) | [Issue #365](https://github.com/github/spec-kit/issues/365)
- [AlignTrue](https://github.com/AlignTrue/aligntrue-sync)
- [Factory.ai](https://docs.factory.ai/reference/hooks-reference)
- [Bito AI](https://bito.ai)
- [Constellation](https://constellationdev.io)
- [ClaudeMDEditor](https://www.claudemdeditor.com)

### Docs-as-Code & Drift Detection
- [Kong: What is Docs as Code](https://konghq.com/blog/learning-center/what-is-docs-as-code)
- [Pronovix: CI/CD and Docs-as-Code](https://pronovix.com/blog/cicd-and-docs-code-workflow)
- [Squarespace: Our Docs-as-Code Journey](https://engineering.squarespace.com/blog/2025/making-documentation-simpler-and-practical-our-docs-as-code-journey)
- [IEEE: Detecting and Managing Documentation Drift](https://ieeexplore.ieee.org/document/11196773/)
- [Overcast: AI-Driven Documentation in 2026](https://overcast.blog/ai-driven-documentation-in-2026-f993f0c6d0d6)

### AI Instruction File Guidance
- [AI Hero: Complete Guide to AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md)
- [Builder.io: Complete Guide to CLAUDE.md](https://www.builder.io/blog/claude-md-guide)
- [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Kaushik Gopal: Keep AGENTS.md in Sync](https://kau.sh/blog/agents-md/)
- [SashiDo: Self-Improving Rules](https://blog.sashido.io/cursor-self-improving-rules/)
- [Arun Iyer: Instruction Files Overview](https://aruniyer.github.io/blog/agents-md-instruction-files.html)
