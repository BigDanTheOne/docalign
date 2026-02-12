> Part of [DocAlign PRD](../PRD.md)

## 7. Layer 3: Verification Engine

### 7.1 Purpose

Given a claim and its mapped code evidence, determine whether the claim is still accurate. The verification engine uses a tiered approach: start with cheap deterministic checks, escalate to LLM-based reasoning only when needed.

### 7.2 Functional Requirements

**Verification pipeline (4 tiers, cheapest first — Tier 3 removed per ADR):**

```
Claim + Mapped Evidence
        |
        v
+------------------+
| Tier 1:          |---- syntactic claim? ----> Deterministic check ----> RESULT
| Syntactic        |
| Verification     |
+--------+---------+
         | (semantic claim)
         v
+------------------+
| Tier 2:          |---- pattern checkable? --> grep/AST check ---------> RESULT
| Pattern          |
| Verification     |
+--------+---------+
         | (needs LLM — all client-side)
         v
+------------------+
| Tier 4:          |---- Path 1 (entity-mapped, ~60-70%) --> direct LLM call --> RESULT
| Semantic         |---- Path 2 (file/multi/none, ~30-40%) -> agent-delegated -> RESULT
| Verification     |
| (client-side)    |
+--------+---------+
         |
         v
+------------------+
| Tier 5:          |--> confirm or demote finding ---------------------> FINAL RESULT
| Post-Check       |
| (verification    |
|  scripts)        |
+------------------+
```

**Tier 1: Syntactic Verification (Deterministic)**
- Path reference check: does the file exist? If not, look for similar filenames (likely renames). Similar path search algorithm: compute Levenshtein distance on the basename (filename without directory). Threshold: distance <= 2. Return max 5 results, ordered by distance ascending. If no basename match, try full path Levenshtein with threshold <= 3.
- Command check: does the script/target exist in the package manifest? If not, suggest close matches.
- Dependency version check: does the actual version satisfy the documented version? Version comparison semantics: compare the documented version against the resolved version from the lock file (package-lock.json, yarn.lock, poetry.lock). If no lock file exists, compare against the version specifier in the manifest. "React 18" matches any "18.x.y" (major-only = prefix match). "React 18.2" matches "18.2.x" (major.minor = prefix match). "React 18.2.0" requires exact match.
- API route check: does the documented route exist in the codebase?
- Code example sub-claim checks:
  - **Import paths:** Check if the import resolves to a real file/module in the codebase index (symbol lookup against L0 file tree and entity index).
  - **Function/class/variable names:** Check if the referenced symbol exists in the codebase index (entity name lookup).
  - **Syntax validation:** If the code block has a language annotation (e.g., ` ```typescript `), validate that the block is syntactically valid for that language using tree-sitter. Invalid syntax = drifted.
- **Static analysis rule checks (v2):** For universal/quantified claims with generated static rules (Spike A), evaluate the rule against all files matching the scope glob. Deterministic, $0 cost per check. See Spike A Section 5.1.
- All checks return confidence 1.0 (deterministic).

**Tier 2: Pattern Verification (grep/AST)**
- For convention and environment claims that can be checked with pattern matching
- Known strategies: check tsconfig.json for "strict mode" claims, search imports for framework claims, grep for counter-examples to "all X use Y" claims, check tool version files
- Limited coverage -- most convention claims will fall through to Tier 4 (semantic verification)

**Tier 3: Removed.** The triage gate was removed per ADR (agent-first architecture). All semantic claims that pass Tiers 1-2 go directly to Tier 4 semantic verification. Cost optimization is achieved by the all-client-side model (client pays LLM costs via their own API key).

**Tier 4: Semantic Verification (all client-side)**
- **Path 1 (entity-mapped claims, ~60-70%):** Entity evidence + claim sent to LLM via direct API call in the GitHub Action. Fast (1-3s). Model configurable (default Claude Sonnet). Produces: verdict, severity, reasoning, mismatch, suggested fix.
- **Path 2 (file-mapped, large entity, multi-file, no mappings, ~30-40%):** Entire verification delegated to client's AI agent within the Action. Agent explores codebase, assembles own context, returns verdict directly. Agent may also propose fixes to Spike A rules and mapper issues. Rule fixes are auto-applied immediately (per Spike B founder decision 3). Before applying, validate rule syntax and dry-run against the current file tree — reject the fix if the modified rule matches zero files.
- Both paths run in the client's GitHub Action using the client's API key. DocAlign server never sees code content.
- Code example handling: Architecture/behavior assertions found in code comments within code examples are treated as semantic claims and verified at this tier.
- Evidence assembly rules: see Section 7.5 below.

**Tier 5: Post-Check (Verification Scripts)**
- ⚠️ **STATUS: Approach defined but not finalized. MVP can ship without this; add in v2.**
- After an LLM produces a "drifted" finding, generate a deterministic check to confirm the finding before showing it to the user
- Only allow read-only commands; timeout 5 seconds
- Reduces false positives

### 7.3 Inputs and Outputs

**Inputs:**
- Claim (from Layer 1)
- Mapped code evidence (from Layer 2) -- file paths, entity code, context

**Outputs (per verification):**
- Verdict: verified, drifted, or uncertain
- Confidence score (0-1)
- Which tier produced the result (1-5)
- Severity (high/medium/low) -- for drifted claims
- Human-readable reasoning
- Specific mismatch description (for drifted claims)
- Suggested fix text (for drifted claims)
- Evidence files examined
- Token cost and duration (for monitoring)
- Post-check result: confirmed, contradicted, or skipped

### 7.4 Performance Requirements

- Tier 1 (syntactic): <50ms per claim
- Tier 2 (pattern): <200ms per claim
- Tier 4 Path 1 (semantic, client-side): ~100-800 tokens evidence, ~100-200 tokens output, ~$0.003-0.012 per claim (client cost)
- Tier 4 Path 2 (agent, client-side): variable (agent manages own context), ~$0.02-0.20 per claim (client cost)
- Tier 5 (post-check): <5 seconds per claim

### 7.5 Evidence Assembly (Two-Path Model)

Evidence assembly determines what code context supports verification.
Solved by Spike B — see `phases/spike-b-evidence-assembly.md` for full specification.

**Path 1: Direct Entity Extraction (~60-70% of claims)**
- Applies when: single entity mapped, entity ≤ 500 lines
- Extracts: entity code (tree-sitter node span) + file imports (up to 30 lines) + same-file type signatures
- Deterministic, <5ms, $0 cost. Typical evidence size: 100-800 tokens
- Evidence package sent to verification LLM in the client's GitHub Action

**Path 2: Agent-Delegated Verification (~30-40% of claims)**
- Applies when: file-mapped without entity, large entity (>500 lines), multi-file, or no mappings
- Delegates ENTIRE verification to client's configured AI agent
- Agent receives claim + file hints, explores codebase autonomously, returns verdict directly
- No evidence assembly step — the agent IS the verifier
- See Spike B Section 5.2 and ADR Section 4 for agent interface

**Routing is deterministic** based on mapping metadata (no LLM call). See Spike B Section 5.3 for routing pseudocode.

**Token budgets, keyword search, truncation strategy eliminated.** Path 1 uses exact entity extraction. Path 2 lets agent manage its own context.

**Entity boundary definition (Path 1):**
- Entity boundary = the tree-sitter node span of the matched code entity, including its full body (not just the signature).
- For functions: from the function keyword/decorator to the closing brace/dedent.
- For classes: from the class keyword/decorator to the closing brace/dedent.
- For routes: the route handler function and its decorator/registration call.

**Surrounding context (Path 1):**
- Always include the imports/requires at the top of the entity's file (up to the first non-import statement, max 30 lines).
- Include type definitions referenced by the entity's signature if they are in the same file.

### 7.6 Open Questions

- **⚠️ Is agent-generated shell command execution (Tier 5) safe enough?** Risk of injection. Alternative: use a restricted DSL instead of shell commands.
- **⚠️ How often does post-check actually catch false positives?** Need data.

> Technical detail: see phases/technical-reference.md Section 3.4 (VerificationResult interface, verification functions), Section 7.2-7.4 (LLM prompt templates)

