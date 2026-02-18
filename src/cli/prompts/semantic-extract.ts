/**
 * Semantic extraction prompt — sent to `claude -p` to extract
 * falsifiable claims from documentation sections.
 *
 * Developers can customize this file to change what gets extracted
 * and how evidence is gathered. The prompt guides Claude on:
 * - What kinds of claims to extract (behavior, architecture, config)
 * - What to skip (things regex already catches)
 * - How to find and structure evidence
 * - Output format (JSON with claims array)
 */

export const SEMANTIC_EXTRACT_SYSTEM_PROMPT = `You analyze documentation in two phases: first classify which regions are illustrative/instructional (not factual claims about the current codebase), then extract specific falsifiable semantic claims from the real content. For Phase 2 evidence gathering, use the Task tool to investigate multiple claims in parallel — launch all sub-agents simultaneously in a single message, not one-by-one. You are ruthlessly selective: skip vague descriptions, skip anything regex can catch (commands, paths, versions, env vars), skip marketing language. Only extract claims where you can find concrete code evidence. Return valid JSON.`;

/**
 * Build the extraction prompt for one doc file's changed sections.
 *
 * @param sectionText - Pre-formatted section content (heading + lines + body)
 * @param repoPath - Absolute path to the repository root
 */
export function buildSemanticExtractPrompt(sectionText: string, repoPath: string): string {
  return `You are analyzing documentation in a codebase at: ${repoPath}

Work in two phases. Return a single JSON object with both phases' results.

---

## PHASE 1 — Document Classification (no tools needed)

Read the documentation sections below and identify regions that should be SKIPPED by the claim extractor. These are regions that contain illustrative content, not factual claims about the current codebase.

### What to mark as skip regions

Mark a region as a skip region if it:

1. **Example / illustration tables** — Tables showing what the tool detects or capabilities, using hypothetical file paths, package names, API routes, etc. E.g., a table listing "src/auth.ts referenced but doesn't exist" is showing an *example of the tool's output*, not a real file claim.
2. **Sample CLI output** — Code blocks showing what the output *looks like* (e.g., "Scanning repository... README.md (12 claims)..."). These paths are invented for illustration.
3. **Illustrative code examples** — Code blocks that show hypothetical usage or examples, not the project's own code. E.g., \`import { foo } from './bar'\` shown as an example of what the tool can detect.
4. **User instructions / imperatives** — Text telling the reader to create a file, run a command, etc. "Create \`.docalign.yml\`" is an instruction, not a claim that the file exists.
5. **Capability descriptions** — Prose describing what the product *can* detect or *can* do ("DocAlign can find X, Y, Z") using example paths/names that are not part of the actual project.
6. **Getting-started tutorials** — Hypothetical project state shown as an example (the "your repository" scenario).

### What NOT to mark as skip

- Real factual claims about the current project's behavior ("Uses Pino for logging", "Validates config with Zod")
- Real architecture statements about how this codebase works
- Configuration defaults for this project ("Defaults to port 3000")

### Skip region output

For each skip region, output:
- \`start_line\`: 1-based line number of the FIRST line to skip (inclusive)
- \`end_line\`: 1-based line number of the LAST line to skip (inclusive)
- \`reason\`: one of: \`example_table\`, \`sample_output\`, \`illustrative_example\`, \`user_instruction\`, \`capability_description\`, \`tutorial_example\`
- \`description\`: brief human-readable explanation (e.g., "What It Finds capability table")

Be conservative: when uncertain whether a region is illustrative, do NOT mark it as skip.

---

## PHASE 2 — Semantic Claim Extraction (use Task, Read, Glob, Grep tools)

From the remaining content (excluding skip regions from Phase 1), extract specific falsifiable claims.

### Speed: use parallel sub-agents

You have access to the **Task tool**. Use it to investigate evidence for multiple claims in parallel — this is much faster than sequential tool calls.

**Workflow:**
1. Read the document sections and identify all candidate claims (5–15 typical per file)
2. Launch one Task sub-agent per claim simultaneously — do NOT investigate claims one-by-one
3. Each sub-agent prompt should be: "Search the codebase at [repoPath] for evidence of the claim: '[claim_text]'. Use Grep and Read to find the relevant source file and exact code pattern. Return JSON: { entities: [{symbol, file}], assertions: [{pattern, scope, expect, description}] }"
4. Collect all sub-agent results, then assemble the final output JSON

**Important:** launch all Task agents in a single message (parallel invocations), not sequentially. If a claim has no evidence after one round of search, mark it as already-drifted (see below) rather than exploring further.

### What to extract

Claims that are **specific, falsifiable, and would break if code changes**:

- "Retries up to 3 times before failing" → could become 5, or retries could be removed
- "Uses JWT for authentication" → could switch to sessions
- "Processes files in parallel using worker threads" → could become sequential
- "Returns 404 for unknown routes" → error handling could change
- "Validates input with Zod schemas" → validation library could change
- "Caches results for 5 minutes" → TTL could change, caching could be removed

### What NOT to extract (CRITICAL — these are already handled by regex)

SKIP all of these — another system already checks them:
- **Commands**: "docalign scan", "npm run test" — regex catches these
- **File paths**: "src/foo.ts", "config/bar.yml" — regex catches these
- **Dependency versions**: "express 4.x" — regex catches these
- **API routes**: "GET /api/health" — regex catches these
- **Environment variables**: "ANTHROPIC_API_KEY" — regex catches these
- **Code blocks/examples** — regex catches these

Also SKIP:
- **Project descriptions / marketing**: "Detects when docs drift from code" — too vague, can't falsify
- **Obvious tautologies**: "The scan command scans the repository" — restating the name
- **External claims**: "GitHub sends webhooks" — we can't verify third-party behavior
- **Aspirational statements**: "Designed for scale" — not falsifiable
- **Tool capability summaries**: "DocAlign uses Claude for extraction", "The extract command finds behavior claims using Claude", "docalign works with zero config" — these describe the tool's own high-level features. They span multiple modules, no single code entity proves them, and extraction sub-agents tend to invent entity names that don't exist. Skip them.

### Quality bar

Ask yourself for each potential claim: "If a developer changed the code in a plausible way, would this claim become wrong, AND would it matter?"

If the answer is no to either question, skip it.

### Evidence — PARALLEL SEARCH, THEN ASSERT

**PREFERRED WORKFLOW** (fast): Use Task to investigate all claims at once.

Spawn sub-agents in parallel — one per claim. Each sub-agent:
1. Grepping for keywords in \`src/\`
2. Reading the relevant file
3. Returning verified pattern + scope

**FALLBACK WORKFLOW** (if Task not available): Use Read, Glob, Grep directly but still investigate claims in parallel where possible (multiple tool calls in one message).

**Quality rule**: Every assertion must be derived from code you actually read AND verified with Grep. DO NOT guess patterns.

If a pattern \`expect: "exists"\` but Grep finds nothing — fix it or mark the claim as already-drifted. If \`expect: "absent"\` but Grep finds matches — fix it. Only include assertions that pass.

### evidence_entities
Specific symbols you found in the code that implement the claimed behavior. Only include symbols you actually located via the tools.

### evidence_assertions
Grep patterns that match **actual lines you saw** in the code. These are snapshots — if the code changes, the pattern breaks, signaling potential drift.

**Good workflow** (claim: "Uses JWT for authentication"):
1. Grep for "jwt\\|jsonwebtoken" across src/
2. Find it in src/auth.ts line 5: \`import jwt from 'jsonwebtoken'\`
3. Read src/auth.ts, see line 42: \`const token = jwt.sign(payload, secret)\`
4. Write assertions:
   - \`{"pattern": "import jwt from .jsonwebtoken.", "scope": "src/auth.ts", "expect": "exists", "description": "JWT library imported"}\`
   - \`{"pattern": "jwt\\\\.sign", "scope": "src/auth.ts", "expect": "exists", "description": "JWT signing is used for auth"}\`

**Bad workflow** (DO NOT DO THIS):
1. Assume there's probably a file called src/auth.ts
2. Guess it probably has \`writeFileSync.*settings.local.json\`
3. Write assertion without reading the code ← THIS CAUSES FALSE POSITIVES

### Already-drifted claims

If a claim is specific and falsifiable but you CANNOT find supporting evidence in the code after searching:
- **Still extract it** with assertions describing what SHOULD exist if the claim were true
- These are likely already-drifted claims — the most valuable ones to report
- Example: doc says "Uses JWT for authentication" but grepping for jwt/jsonwebtoken finds nothing → extract with \`{"pattern": "jsonwebtoken", "scope": "src/**/*.ts", "expect": "exists"}\`

---

## Output format

Return a single JSON object:
{
  "skip_regions": [
    {
      "start_line": 29,
      "end_line": 38,
      "reason": "example_table",
      "description": "What It Finds capability table with hypothetical paths"
    }
  ],
  "claims": [
    {
      "claim_text": "exact text or minimal phrase from the doc",
      "claim_type": "behavior" | "architecture" | "config",
      "keywords": ["relevant", "keywords"],
      "line_number": 42,
      "evidence_entities": [{"symbol": "functionName", "file": "src/path.ts"}],
      "evidence_assertions": [{"pattern": "specific.*pattern", "scope": "src/specific-file.ts", "expect": "exists", "description": "Why this pattern proves the claim"}]
    }
  ]
}

It is completely fine to return \`{"skip_regions": [], "claims": []}\` if there are no regions to skip and no claims worth extracting. Quality over quantity.

Documentation sections to analyze:

${sectionText}`;
}
