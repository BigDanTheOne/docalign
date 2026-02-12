# Staleness Detection in AI Instruction Files: Technical Approaches

> Compiled: 2026-02-08
> Purpose: Systematic analysis of what types of documentation staleness exist, how each can be detected, what tools exist, and what's feasible for a solo founder to build in 2-4 weeks.
> Sources: Academic research (arxiv), GitHub tools (driftcheck, Drift, AlignTrue, Swimm, remark-validate-links, markdown-link-check), MCPMarket skills, Arize research, Hacker News, 30+ web sources.

---

## 1. Taxonomy of Staleness Types

### Type 1: Dead File References
**Description:** Instruction file mentions files/directories that no longer exist (renamed, deleted, moved).
**Example:** CLAUDE.md says "authentication logic lives in `src/auth/handlers.ts`" but file was renamed to `src/auth/auth-handler.ts`.
**Frequency:** Tier 1 (daily/weekly). Most concrete and documented failure mode.
**Severity:** HIGH -- agent confidently looks in wrong place, generates code referencing nonexistent modules.

**Subtypes:**
- Explicit file paths in markdown (`src/foo/bar.ts`)
- Markdown links to local files (`[see auth](./src/auth/README.md)`)
- Import paths mentioned in code blocks (`` `import { foo } from './old-path'` ``)
- Directory references (`the /api directory contains...`)

### Type 2: Stale Import Paths / Module References
**Description:** Code examples or import patterns in instruction files reference modules that moved or were renamed.
**Example:** CLAUDE.md shows `import { db } from '@/lib/database'` but module moved to `@/services/db`.
**Frequency:** Tier 1-2 (weekly/sprint). Happens with every refactor.
**Severity:** MEDIUM-HIGH -- agent generates code with broken imports. TypeScript/ESLint may catch downstream, but agent wastes tokens and context on wrong approach.

### Type 3: Pattern Mismatch (Docs Say X, Code Does Y)
**Description:** Instruction file describes a pattern ("use async/await everywhere", "prefer functional components") but codebase has migrated to a different pattern.
**Example:** CLAUDE.md says "use Redux for state management" but the team migrated to Zustand 3 months ago.
**Frequency:** Tier 2 (sprint/monthly).
**Severity:** HIGH -- agent generates code in abandoned style. Creates architectural inconsistency.

**Subtypes:**
- Error handling patterns (try/catch vs Result types)
- State management approaches
- Testing framework preferences (Jest vs Vitest)
- API patterns (REST vs tRPC vs GraphQL)
- Component patterns (class vs functional, HOC vs hooks)
- CSS approach (styled-components vs Tailwind vs CSS modules)

### Type 4: Dependency Version Drift
**Description:** Instruction file references specific dependency versions, APIs, or SDK methods that changed.
**Example:** CLAUDE.md says "use NextAuth v4 `getServerSession()`" but project upgraded to Auth.js v5 which uses `auth()`.
**Frequency:** Tier 1-2 (weekly for active projects).
**Severity:** MEDIUM-HIGH -- agent generates code using deprecated APIs. May compile but produce runtime errors or use verbose v1 patterns when v2 is cleaner.

**Subtypes:**
- Explicit version references ("we use React 18")
- API method references (`prisma.user.findUnique` vs current schema)
- Framework-specific patterns tied to versions
- Deprecated package references (package replaced or renamed)

### Type 5: Architecture Description Decay
**Description:** High-level architecture descriptions no longer match actual project structure.
**Example:** CLAUDE.md describes a monolith but the project was split into microservices, or describes 3 services but a 4th was added.
**Frequency:** Tier 3 (quarterly), but highest impact when wrong.
**Severity:** VERY HIGH -- agent makes fundamental structural decisions based on wrong mental model. Mahdi Yusuf documented agents consolidating microservices because they didn't understand why separation existed.

**Subtypes:**
- Service/module boundary descriptions
- Database schema descriptions
- API endpoint listings
- Environment descriptions (dev/staging/prod)
- Infrastructure descriptions (deployment, hosting)

### Type 6: Dead Commands
**Description:** Build, test, lint, or deployment commands documented in instruction files that no longer work.
**Example:** CLAUDE.md says "run `npm run test:e2e`" but the script was renamed to `npm run e2e` or removed entirely.
**Frequency:** Tier 1-2 (weekly/sprint).
**Severity:** MEDIUM -- agent runs wrong commands, gets errors, wastes tokens debugging. May attempt to "fix" the command rather than questioning the documentation.

**Subtypes:**
- npm/yarn/pnpm scripts that don't exist in package.json
- CLI tools that aren't installed
- Docker commands referencing images that don't exist
- Environment variable references that aren't set
- Makefile targets that were removed

### Type 7: Deprecated API / Tool References
**Description:** References to third-party APIs, tools, or services that are deprecated or replaced.
**Example:** CLAUDE.md says "use Heroku for deployment" but team moved to Vercel.
**Frequency:** Tier 2-3 (monthly/quarterly).
**Severity:** MEDIUM -- similar to pattern mismatch but specifically about external dependencies.

### Type 8: Stale Convention/Style Rules
**Description:** Coding style or convention rules that no longer reflect team practice.
**Example:** CLAUDE.md says "always use semicolons" but the project's ESLint/Prettier config enforces no-semicolons.
**Frequency:** Tier 2 (sprint/monthly).
**Severity:** LOW-MEDIUM -- usually caught by linters, but creates noise and wastes agent tokens on reformatting.

### Type 9: Team/Process Descriptions
**Description:** References to team members, review processes, or workflows that changed.
**Example:** CLAUDE.md says "get approval from @alice for database changes" but Alice left the team.
**Frequency:** Tier 3 (quarterly).
**Severity:** LOW for AI instruction files (agents don't typically act on team process info).

---

## 2. Detection Approaches by Staleness Type

### Approach A: Static File Existence Checking (DETERMINISTIC)

**What it detects:** Types 1, 2 (partially), 6 (partially)
**How it works:**
1. Parse instruction file for file path references using regex/markdown AST
2. Resolve each path relative to project root
3. Check `fs.existsSync()` for each referenced path
4. Report missing files with line numbers

**Technical details:**
- Parse markdown to find: explicit paths (`src/foo.ts`), markdown links (`[text](./path)`), code blocks with imports, backtick-quoted paths
- Regex patterns: `/(?:^|\s|`)((?:\.\/|\.\.\/|src\/|lib\/|app\/|pages\/|components\/|utils\/|services\/|api\/|config\/|test\/|tests\/|__tests__\/)[a-zA-Z0-9_\-\.\/]+)/gm`
- Also match markdown link syntax: `/\[.*?\]\((\.\/[^)]+)\)/g`
- Use glob patterns for directory references

**False positive risk:** LOW. File either exists or it doesn't.
**False negative risk:** MEDIUM. Won't catch paths mentioned in natural language without path-like prefixes.
**Implementation effort:** 1-2 days.
**Dependencies:** Node.js fs module, markdown parser (remark/unified).

**Existing tools that do this:**
- [remark-validate-links](https://github.com/remarkjs/remark-validate-links) -- validates internal markdown links in Git repos. Works offline, specifically for local links. Checks file existence and heading anchors.
- [markdown-link-check](https://github.com/tcort/markdown-link-check) -- checks all hyperlinks in markdown. Supports ignorePatterns via regex. Available as GitHub Action.
- [validate-markdown-docs](https://github.com/adamsc64/validate-markdown-docs) -- finds broken internal links in markdown.
- [linkcheckmd](https://pypi.org/project/linkcheckmd/) -- Python, blazing fast (10K files/sec), async. Good for large projects.

### Approach B: Package.json / Dependency Cross-Reference (DETERMINISTIC)

**What it detects:** Types 4, 6, 8 (partially)
**How it works:**
1. Parse instruction file for package/dependency names and version references
2. Read `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, etc.
3. Compare:
   - Are mentioned packages actually installed?
   - Do mentioned versions match actual versions?
   - Are mentioned npm scripts present?
   - Are mentioned packages deprecated? (`npm-deprecated-check`)

**Technical details:**
- Extract dependency names from instruction file using entity recognition or keyword patterns
- Parse package.json `dependencies`, `devDependencies`, and `scripts` sections
- Version comparison: semver parsing for major version mismatches (minor version drift is usually not breaking)
- Script validation: match documented command names against `scripts` keys

**Existing tools (partial overlap):**
- [npm-deprecated-check](https://www.npmjs.com/package/npm-deprecated-check) -- checks if installed packages are deprecated
- [npm-check](https://www.npmjs.com/package/npm-check) -- outdated, incorrect, unused dependency detection
- [check-dependency-version-consistency](https://www.npmjs.com/package/check-dependency-version-consistency) -- monorepo version consistency
- `npm outdated` -- built-in command for version comparison

**False positive risk:** LOW for script existence checks. MEDIUM for version comparisons (docs might intentionally reference minimum versions).
**Implementation effort:** 2-3 days.
**Dependencies:** Package manager CLIs or direct JSON parsing.

### Approach C: Git Diff Analysis (SEMI-DETERMINISTIC)

**What it detects:** Types 1, 2, 3, 5 (indirectly) -- any type, by correlation
**How it works:**
1. Find the last commit that modified the instruction file
2. Get all files changed since that commit: `git log --name-only --since=<date>`
3. Score "staleness risk" based on:
   - Number of files changed vs. instruction file untouched
   - Which directories changed (if instruction file references those directories)
   - Whether file renames occurred in referenced paths
   - Whether package.json changed (dependency drift signal)

**Technical details:**
- `git log --format=%H --diff-filter=M -- CLAUDE.md` to find last edit commit
- `git diff --name-only <last-edit-hash>..HEAD` to find all changes since
- `git log --diff-filter=R --find-renames -- <referenced-paths>` to detect renames
- Cross-reference changed files against paths mentioned in instruction file
- Compute a "staleness score" based on overlap between changes and documented paths

**Existing tools using this approach:**
- [Swimm](https://swimm.io/) -- Auto-sync feature tracks code changes that affect documentation. When code modifications occur, evaluates whether changes are significant enough to warrant documentation updates. Runs as PR check. Proprietary algorithm (details not disclosed).
- [driftcheck](https://github.com/deichrenner/driftcheck) -- Pre-push hook. Gets git diff, generates ripgrep queries via LLM, searches for related docs in parallel, checks git history to avoid flagging already-fixed issues, then LLM evaluates consistency. Conservative: only flags factual contradictions.
- [Grit.io drift detection](https://docs.grit.io/workflows/drift-detection) -- Scans PRs for file path matches against migration patterns. Only checks file paths, not contents.

**False positive risk:** MEDIUM. Many file changes are unrelated to documentation.
**False negative risk:** MEDIUM. Doesn't detect semantic drift (conventions changed but files are the same).
**Implementation effort:** 2-4 days for basic version, 1+ week for scoring model.

### Approach D: Command Validation (DETERMINISTIC)

**What it detects:** Type 6
**How it works:**
1. Extract commands from instruction file (code blocks with shell-like syntax)
2. Dry-run or validate each command:
   - npm scripts: check `package.json` scripts section
   - CLI tools: check if binary exists (`which <tool>`)
   - Docker commands: check if Dockerfile/image exists
   - Make targets: parse Makefile
3. Report invalid commands with suggestions

**Technical details:**
- Parse markdown code blocks tagged with `bash`, `shell`, `sh`, `zsh`, or untagged
- Extract command names: first word of each line (filter out comments, variables)
- For `npm run X` / `yarn X` / `pnpm X`: check scripts in package.json
- For bare commands: `which <command>` or check common installation paths
- DO NOT actually execute commands (security risk, side effects)

**False positive risk:** LOW for script existence. MEDIUM for CLI tool checks (tools may be installed globally).
**Implementation effort:** 1-2 days.

### Approach E: Pattern Matching / Code Grep (SEMI-DETERMINISTIC)

**What it detects:** Types 3, 8
**How it works:**
1. Extract pattern claims from instruction file (e.g., "use React Query for data fetching", "prefer Zustand over Redux")
2. Search codebase for evidence of the pattern
3. Search codebase for evidence of conflicting patterns
4. Flag when documented pattern has low prevalence vs. alternative

**Technical details:**
- Build a mapping of common pattern pairs: {Redux: "zustand|jotai|recoil", Jest: "vitest", "styled-components": "tailwind|css modules", REST: "trpc|graphql"}
- For each mentioned pattern, count occurrences in codebase via ripgrep
- For each pattern, count occurrences of known alternatives
- If alternative > documented pattern by threshold (e.g., 3:1), flag as potentially stale

**Challenges:**
- Requires domain knowledge of pattern alternatives
- Natural language understanding to extract claims ("we use X" vs "don't use X")
- Some patterns are hard to grep for (architectural patterns vs. specific imports)

**False positive risk:** HIGH without LLM assistance. MEDIUM with LLM.
**Implementation effort:** 3-5 days for deterministic version (limited patterns), 1-2 days additional with LLM.

### Approach F: LLM-Assisted Semantic Analysis (NON-DETERMINISTIC)

**What it detects:** All types, especially 3, 5, 7
**How it works:**
1. Feed instruction file + relevant code samples to LLM
2. Ask: "Does this instruction file accurately describe this codebase?"
3. LLM identifies semantic mismatches

**Technical details (driftcheck's approach):**
- Get git diff of recent changes
- LLM generates targeted ripgrep queries to find related documentation
- Parallel ripgrep search across codebase
- LLM evaluates consistency between code changes and documentation
- Conservative: only flags factual errors, not missing docs or style issues

**Challenges:**
- Cost: 2 LLM calls per check (driftcheck model)
- Latency: 10-30 seconds per check
- False positives from LLM hallucination
- Requires careful prompt engineering for conservative detection
- Token limits constrain how much code + docs can be compared

**False positive risk:** MEDIUM (depends on prompt engineering and model quality).
**Implementation effort:** 2-3 days for basic version. driftcheck already exists as reference.
**Cost per run:** $0.01-0.10 depending on model and context size.

### Approach G: AST-Based Import Resolution (DETERMINISTIC)

**What it detects:** Type 2 specifically
**How it works:**
1. Extract import statements from code blocks in instruction files
2. Resolve imports using the project's module resolution (tsconfig paths, etc.)
3. Check if resolved modules exist and export referenced symbols

**Technical details:**
- Parse code blocks for import/require statements
- Use TypeScript compiler API or babel parser to resolve module paths
- Check for `tsconfig.json` path aliases (`@/` prefix)
- Verify named exports exist in target modules

**Existing tools (partial):**
- TypeScript compiler (`tsc --noEmit`) already validates imports in actual code
- ESLint `import/no-unresolved` rule
- These work on source code but NOT on instruction file code examples

**False positive risk:** LOW (import either resolves or doesn't).
**Implementation effort:** 3-5 days (TypeScript resolver integration is non-trivial).

### Approach H: Environment Variable Cross-Reference (DETERMINISTIC)

**What it detects:** Subset of Types 5, 6
**How it works:**
1. Extract env var references from instruction file
2. Compare against `.env.example`, `.env.local`, Docker configs
3. Flag env vars that are documented but don't appear in any env file, or vice versa

**Existing tools:**
- [zorath-env](https://github.com/zorl-engine/zorath-env) -- CLI for .env validation against JSON schema. Validates env vars, detects missing required vars, catches configuration drift, generates docs.

**Implementation effort:** 1 day.

---

## 3. Existing Tools Landscape

### Tools That Directly Address Documentation-Code Drift

| Tool | Approach | Stars | Status | Key Limitation |
|------|----------|-------|--------|----------------|
| [driftcheck](https://github.com/deichrenner/driftcheck) | LLM + git diff + ripgrep pre-push hook | ~10 | Early stage | LLM-dependent, cost per run, requires API key |
| [Drift (dadbodgeoff)](https://github.com/dadbodgeoff/drift) | Pattern detection + MCP + Cortex memory | 678 | Active | Detects patterns but doesn't compare to instruction files |
| [Swimm](https://swimm.io/) | Code-coupled docs with auto-sync | N/A (commercial) | Active | Proprietary, doesn't target AI instruction files |
| [AlignTrue](https://github.com/AlignTrue/aligntrue-sync) | Rule sync + drift detection + lockfile | ~0 | Alpha | Detects drift between rule files, not between rules and code |
| [Documentation Auditor (MCPMarket)](https://mcpmarket.com/es/tools/skills/documentation-auditor-3) | Two-pass LLM verification | N/A (skill) | Active | Claude Code skill, not standalone tool |
| [Factory.ai Doc Sync](https://docs.factory.ai/guides/hooks/documentation-sync) | PostToolUse hooks | N/A | Enterprise | Factory-only, enterprise pricing |
| [DeepDocs](https://github.com/marketplace/deepdocsai) | Auto-proposes doc update PRs | N/A | **Deprecated** | No longer maintained |

### Tools That Address Adjacent Problems

| Tool | What It Does | Relevance |
|------|-------------|-----------|
| [remark-validate-links](https://github.com/remarkjs/remark-validate-links) | Validates internal markdown links in Git repos | Directly applicable to Type 1 |
| [markdown-link-check](https://github.com/tcort/markdown-link-check) | Checks markdown hyperlinks (internal + external) | Directly applicable to Type 1 |
| [npm-deprecated-check](https://www.npmjs.com/package/npm-deprecated-check) | Checks for deprecated packages | Applicable to Type 4 |
| [npm-check](https://www.npmjs.com/package/npm-check) | Outdated/incorrect/unused dependency detection | Applicable to Type 4 |
| [ai-rulez](https://github.com/Goldziher/ai-rulez) | Rule sync with enforcement (checks violations + auto-fix) | Checks codebase against rules, not rules against codebase |

### The Critical Gap

**No tool detects staleness in AI instruction files specifically.** The landscape breaks down as:
- **Rule sync tools** (Ruler, rulesync, AlignTrue) solve distribution, not accuracy
- **Documentation tools** (Swimm, Mintlify) solve general docs, not AI instruction files
- **Codebase intelligence** (Drift) learns from code but doesn't validate instruction files
- **Driftcheck** comes closest but is: early stage (~10 stars), LLM-dependent, general docs not AI-specific, requires API key setup

The gap that exists: a deterministic tool that parses CLAUDE.md / .cursorrules / AGENTS.md, extracts verifiable claims, and checks them against codebase reality.

### Academic Research Context

The code-comment inconsistency detection field is active and relevant:

- **CoCC (2024):** Machine learning approach treating outdated comment detection as binary classification. 92.1% precision, 78.9% recall on Java. Extracts features from code changes, comments, and their relationships. Validated that 93.6% of detected inconsistencies were genuinely outdated. (Source: arxiv:2403.00251)

- **CCISolver (June 2025):** End-to-end LLM framework for detecting AND repairing code-comment inconsistencies. Introduces CCIBench dataset for evaluation.

- **Structured Code Diffs approach (December 2025):** Decomposes code changes into ordered modification activities (replace, delete, add). Built on CodeT5+ backbone. Claims smaller models with structured diffs outperform larger LLMs for this task.

- **Key finding from empirical study (Wen et al., 2019):** Three primary inconsistency types: (1) comments describing removed code, (2) comments lacking descriptions of newly added code, (3) comments referencing variables that no longer exist. These map directly to our staleness types.

- **Bug correlation:** Inconsistent changes are ~1.5x more likely to lead to bug-introducing commits than consistent changes.

---

## 4. Feasibility Matrix: What a Solo Founder Can Build in 2-4 Weeks

### Tier 1: High Confidence, Deterministic, Ship in Week 1-2

| Check | Staleness Type | Approach | False Positive Rate | Effort | LLM Required? |
|-------|---------------|----------|-------------------|--------|---------------|
| **Dead file references** | Type 1 | Parse paths from markdown, check fs.existsSync | VERY LOW | 1-2 days | No |
| **Dead markdown links** | Type 1 | Markdown AST, resolve local links | VERY LOW | 1 day | No |
| **Missing npm scripts** | Type 6 | Parse commands, check package.json scripts | VERY LOW | 1 day | No |
| **Missing dependencies** | Type 4 | Extract package names, check package.json | LOW | 1-2 days | No |
| **Missing CLI tools** | Type 6 | Extract commands, `which` check | LOW | 0.5 days | No |
| **Env var drift** | Type 5 (subset) | Parse env refs, check .env files | LOW | 0.5 days | No |

**Total for Tier 1 MVP: 5-7 days.** All deterministic, zero LLM cost, zero false positive anxiety.

### Tier 2: Moderate Confidence, Semi-Deterministic, Ship in Week 2-3

| Check | Staleness Type | Approach | False Positive Rate | Effort | LLM Required? |
|-------|---------------|----------|-------------------|--------|---------------|
| **Major version mismatch** | Type 4 | Compare doc versions vs package.json semver | LOW-MEDIUM | 1-2 days | No |
| **Git staleness score** | All types | Last edit date vs. codebase change velocity | MEDIUM | 2-3 days | No |
| **Renamed file detection** | Type 1 | Git rename tracking since last doc edit | LOW | 1-2 days | No |
| **Import path resolution** | Type 2 | Resolve imports in code blocks via TS API | LOW | 3-4 days | No |
| **Style rule vs linter config** | Type 8 | Compare rule claims vs ESLint/Prettier config | MEDIUM | 2-3 days | No |

**Total for Tier 2: 9-14 days additional.**

### Tier 3: Requires LLM, Higher False Positive Risk, Week 3-4

| Check | Staleness Type | Approach | False Positive Rate | Effort | LLM Required? |
|-------|---------------|----------|-------------------|--------|---------------|
| **Pattern prevalence check** | Type 3 | Grep for pattern + alternatives, LLM judges | MEDIUM | 3-4 days | Optional (better with) |
| **Architecture description validation** | Type 5 | Feed structure + docs to LLM, ask for mismatches | MEDIUM-HIGH | 2-3 days | Yes |
| **Semantic command validation** | Type 6 | LLM checks if documented workflows still make sense | MEDIUM | 2 days | Yes |
| **Full semantic drift detection** | All | driftcheck-style: diff + ripgrep + LLM analysis | MEDIUM | 3-5 days | Yes |

**Total for Tier 3: 10-14 days additional.**

### The Recommended MVP (2-Week Build)

**Week 1: The Deterministic Core**
Build Tier 1 checks. No LLM needed. Output: a CLI tool that parses CLAUDE.md / .cursorrules / AGENTS.md and reports:
- Dead file references (with line numbers)
- Broken markdown links
- Missing npm scripts referenced in docs
- Missing packages referenced in docs
- Unresolvable CLI commands
- Missing env vars

This alone is novel. No existing tool does this for AI instruction files.

**Week 2: Git Integration + Reporting**
Add:
- Renamed file suggestions ("did you mean `auth-handler.ts`?")
- Git staleness score (instruction file last edited X days ago, Y files changed since)
- Major version mismatch detection
- CI integration (GitHub Action / pre-commit hook)
- Pretty terminal output + JSON/markdown report

**Post-MVP (Week 3-4 if validated):**
- LLM-assisted pattern prevalence checking
- Architecture description validation
- VS Code extension for inline warnings
- Watch mode (re-run on file changes)

### What NOT to Build

1. **Full semantic analysis from day 1.** LLM-based semantic drift detection is the most impressive demo but the hardest to make reliable. Start deterministic.
2. **Multi-tool format handling.** Supporting every instruction file format (.cursorrules MDC, .windsurfrules, etc.) is a rabbit hole. Start with markdown (CLAUDE.md, AGENTS.md) which covers the majority.
3. **Auto-fix / auto-update.** Tempting but dangerous. Incorrect auto-fixes destroy trust faster than manual detection. Report problems; let humans fix them.
4. **Rule sync.** Ruler (2,400 stars), rulesync (764 stars) already own this. Don't compete on distribution.

---

## 5. Technical Architecture Sketch

### MVP Architecture (Tier 1)

```
CLI Input: doc-lint CLAUDE.md
                |
                v
    +---------------------------+
    |  Markdown Parser (remark) |
    |  Extract:                 |
    |  - File path references   |
    |  - Markdown links         |
    |  - Code blocks            |
    |  - Command references     |
    |  - Package names          |
    |  - Env var references     |
    +---------------------------+
                |
                v
    +---------------------------+
    |  Validators (parallel)    |
    |                           |
    |  [FileExists]             |
    |  [LinkResolver]           |
    |  [ScriptChecker]          |
    |  [DependencyChecker]      |
    |  [CommandChecker]         |
    |  [EnvVarChecker]          |
    +---------------------------+
                |
                v
    +---------------------------+
    |  Reporter                 |
    |  - Terminal (colorized)   |
    |  - JSON (for CI)          |
    |  - Markdown (for PRs)     |
    +---------------------------+
```

### Key Design Decisions

1. **Parse strategy:** Use `unified` / `remark` ecosystem for markdown AST. Extract entities from:
   - Inline code (backticks)
   - Code blocks (fenced)
   - Markdown links
   - Plain text with path-like patterns

2. **Path resolution:** Resolve all paths relative to the instruction file's parent directory or project root (detected via `.git`, `package.json`, or CLI flag).

3. **Package manager detection:** Auto-detect npm/yarn/pnpm/bun from lockfile presence. Fall back to package.json scripts section.

4. **Output format:** Default to human-readable terminal output with emoji-free severity indicators (ERROR, WARN, INFO). Support `--json` for CI and `--markdown` for PR comments.

5. **Exit codes:** Exit 0 if clean, exit 1 if errors found (enables CI gate usage).

6. **Configuration:** Optional `.doc-lint.yaml` for:
   - Paths to check (default: CLAUDE.md, AGENTS.md, .cursorrules)
   - Ignore patterns (specific paths, specific checks)
   - Severity overrides

### Extraction Patterns (Concrete)

**File paths in backticks:**
```
/`([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z]{1,10})`/g
```
Filter: must contain at least one `/` or start with common source dirs.

**Markdown links to local files:**
```
/\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g
```

**npm/yarn/pnpm run commands:**
```
/(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?([a-zA-Z0-9:_\-]+)/g
```

**Package name references (in context of "use X", "install X", etc.):**
```
/(?:use|install|import|require|from)\s+[`"]?([a-z@][a-z0-9\-\.@\/]*)[`"]?/gi
```

**Environment variables:**
```
/(?:process\.env\.|ENV\[|env\.|\.env.*|export\s+)([A-Z][A-Z0-9_]+)/g
```

---

## 6. Competitive Positioning

### Why This Isn't Already Solved

1. **Rule sync tools** (Ruler, rulesync) solved the easier problem (format fragmentation). Content accuracy is harder.
2. **driftcheck** exists but: (a) requires LLM API key, (b) targets general docs not AI instructions, (c) early stage with minimal adoption (~10 stars), (d) conservative to the point of missing many issues.
3. **Drift** learns patterns from code but doesn't validate instruction files against those patterns. It replaces static files rather than validating them.
4. **Swimm** does code-coupled docs but: (a) proprietary, (b) targets general documentation, (c) doesn't support AI instruction file formats.
5. **Documentation Auditor** (MCPMarket skill) is the closest conceptual match but: (a) requires Claude Code, (b) is an LLM-based skill, not a deterministic tool, (c) not standalone.

### The Unique Value Proposition

A **deterministic, zero-LLM, zero-config** CLI that tells you exactly what's broken in your AI instruction files. No API keys. No cost per run. No false positive anxiety from LLM hallucination. Run it in CI. Get a clear report. Fix what's broken.

The academic research validates the approach: the CoCC paper achieved 92.1% precision using mostly deterministic features (code changes, comment structure, semantic similarity). The LLM is not needed for the highest-value checks.

### Bear Test: Will Platforms Build This?

Cursor, Claude Code, and Copilot WILL eventually build some form of instruction file validation. However:
- It will be low priority (it's a meta-feature, not a user-facing feature)
- It will be tool-specific (Cursor validates .cursorrules, Claude validates CLAUDE.md)
- It won't be cross-tool (no incentive for Cursor to validate CLAUDE.md)
- It won't be deterministic-first (they'll use their own models, which adds the LLM-hallucination problem)

A standalone, cross-tool, deterministic-first tool has a real window.

---

## 7. Open Questions for Validation

1. **How common are the deterministic failure modes?** Need to sample 50-100 real CLAUDE.md / AGENTS.md files from GitHub and measure: what % have at least one dead file reference, missing script, or outdated dependency?

2. **Do developers actually notice staleness?** Or does the agent silently work around it? If agents self-correct, the detection value drops.

3. **Would developers run this?** Pre-commit hook? CI check? On-demand CLI? The distribution mechanism matters as much as the detection.

4. **Is this a feature or a product?** The Tier 1 checks could be a feature of Ruler/rulesync (add validation to existing sync tools) rather than a standalone product. Need to validate standalone willingness-to-pay.

5. **Content engineering insight:** Could this be validated with a blog post first? "We analyzed 100 CLAUDE.md files from GitHub and found that 73% had at least one dead reference" -- that's a viral post that validates the problem before writing code.

---

## Sources

### Tools
- [driftcheck](https://github.com/deichrenner/driftcheck) -- Pre-push hook for documentation drift via LLMs
- [Drift (dadbodgeoff)](https://github.com/dadbodgeoff/drift) -- Codebase intelligence with Cortex memory, 678 stars
- [AlignTrue](https://github.com/AlignTrue/aligntrue-sync) -- Rule sync with drift detection and lockfile validation
- [Swimm](https://swimm.io/) -- Code-coupled documentation with auto-sync
- [remark-validate-links](https://github.com/remarkjs/remark-validate-links) -- Markdown internal link validation
- [markdown-link-check](https://github.com/tcort/markdown-link-check) -- Markdown hyperlink checker
- [npm-deprecated-check](https://www.npmjs.com/package/npm-deprecated-check) -- Deprecated package detection
- [Documentation Auditor (MCPMarket)](https://mcpmarket.com/es/tools/skills/documentation-auditor-3) -- Claude Code skill for doc drift
- [Factory.ai Doc Sync](https://docs.factory.ai/guides/hooks/documentation-sync) -- PostToolUse hooks for doc regeneration
- [ClaudeMDEditor](https://www.claudemdeditor.com/) -- Visual editor for AI instruction files
- [ai-rulez](https://github.com/Goldziher/ai-rulez) -- Rule sync with enforcement
- [zorath-env](https://github.com/zorl-engine/zorath-env) -- .env validation against schema

### Research
- [CoCC: Code-Comment Consistency Detection (arxiv:2403.00251)](https://arxiv.org/html/2403.00251v1) -- 92.1% precision, ML-based approach
- [CCISolver (arxiv:2506.20558)](https://arxiv.org/abs/2506.20558) -- End-to-end LLM detection and repair
- [Structured Code Diffs (arxiv:2512.19883)](https://arxiv.org/abs/2512.19883) -- Smaller models with structured diffs outperform large LLMs
- [Bug Impact of Inconsistencies (arxiv:2409.10781)](https://arxiv.org/html/2409.10781v1) -- 1.5x more likely to introduce bugs
- [Wen et al. 2019 Empirical Study](https://dl.acm.org/doi/abs/10.1109/ICPC.2019.00019) -- Large-scale code-comment inconsistency taxonomy
- [Arize: Optimizing Coding Agent Rules](https://arize.com/blog/optimizing-coding-agent-rules-claude-md-agents-md-clinerules-cursor-rules-for-improved-accuracy/) -- Prompt optimization for rule files
- [arXiv:2512.18925 "Beyond the Prompt"](https://arxiv.org/abs/2512.18925) -- Study of 155 AGENTS.md files, 50% never updated

### Community & Industry
- [Show HN: Driftcheck](https://news.ycombinator.com/item?id=46698142) -- Hacker News launch discussion
- [steipete/agent-rules](https://github.com/steipete/agent-rules) -- Curated agent rule repository
- [Cursor Forum: Rules failures](https://forum.cursor.com/t/cursor-rules-do-not-work-well-anymore/145342)
- [Claude Code GitHub Issues: #18454, #18660, #7777](https://github.com/anthropics/claude-code/issues/18454) -- Instruction non-compliance reports
- [Grit.io Drift Detection](https://docs.grit.io/workflows/drift-detection) -- PR-based file path drift
- [Mintlify Auto-Update Guide](https://www.mintlify.com/docs/guides/automate-agent) -- Agent-based doc updates
