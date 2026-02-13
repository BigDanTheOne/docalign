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

export const SEMANTIC_EXTRACT_SYSTEM_PROMPT = `You extract specific, falsifiable claims from documentation — claims that would break if someone changed the code. You are ruthlessly selective: skip vague descriptions, skip anything regex can catch (commands, paths, versions, env vars), skip marketing language. Only extract claims where you can find concrete code evidence. Return valid JSON.`;

/**
 * Build the extraction prompt for one doc file's changed sections.
 *
 * @param sectionText - Pre-formatted section content (heading + lines + body)
 * @param repoPath - Absolute path to the repository root
 */
export function buildSemanticExtractPrompt(sectionText: string, repoPath: string): string {
  return `You are analyzing documentation in a codebase at: ${repoPath}

Your job: find claims in the docs that could become WRONG if someone changes the code, but that simple regex can't catch. These are claims about HOW the system works, not WHAT files exist.

## What to extract

Extract claims that are **specific, falsifiable, and would break if code changes**:

- "Retries up to 3 times before failing" → could become 5, or retries could be removed
- "Uses JWT for authentication" → could switch to sessions
- "Processes files in parallel using worker threads" → could become sequential
- "Returns 404 for unknown routes" → error handling could change
- "Validates input with Zod schemas" → validation library could change
- "Caches results for 5 minutes" → TTL could change, caching could be removed
- "Logs all API requests to stdout" → logging could change
- "The pipeline runs extractors in this order: paths, commands, versions" → order could change

## What NOT to extract (CRITICAL — these are already handled by regex)

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

## Quality bar

Ask yourself for each potential claim: "If a developer changed the code in a plausible way, would this claim become wrong, AND would it matter?"

If the answer is no to either question, skip it.

## Evidence — READ THE CODE FIRST, THEN ASSERT

**CRITICAL WORKFLOW**: You have Read, Glob, and Grep tools. For each claim:

1. **Find the implementation**: Use Glob/Grep to locate the relevant source file(s)
2. **Read the actual code**: Use Read to see the exact implementation
3. **Write assertions based on what you actually see** — not what you imagine the code looks like
4. **Verify each assertion**: Use Grep to test your pattern against the scope file BEFORE including it. If \`expect: "exists"\` but Grep finds nothing — your pattern is wrong, fix it. If \`expect: "absent"\` but Grep finds matches — fix it. Only include assertions that pass.

**DO NOT GUESS code patterns.** Every assertion must be derived from code you actually read AND verified with Grep.

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

## Output format

Return JSON:
{
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

It is completely fine to return {"claims": []} if there are no claims worth extracting. Quality over quantity.

Documentation sections to analyze:

${sectionText}`;
}
