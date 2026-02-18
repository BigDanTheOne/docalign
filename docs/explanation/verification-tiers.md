# Verification Tiers

DocAlign verifies claims through a four-tier system, from fast deterministic checks to human review. Each tier handles the claims that the previous tier couldn't resolve.

## Tier 1: Deterministic Checks

Direct evidence-based verification with high confidence. These are fast, reliable, and require no configuration.

| Claim Type | Check |
|------------|-------|
| File paths | Does the file exist in the repo? Fuzzy match for close alternatives. |
| Dependencies | Is the package in `package.json`? Does the version match (semver-aware)? |
| Commands | Is the npm script defined in `package.json` scripts? |
| API routes | Does the route exist in Express/Flask/FastAPI handlers (AST-based)? |
| Code examples | Do imports resolve? Do referenced symbols exist in exports? |
| URLs | Does HTTP HEAD/GET return status 200-399? |
| Anchor links | Does the target heading exist? Slug generation matches? |

**Confidence:** 1.0 (pass/fail with no ambiguity)

**When it can't decide:** File doesn't exist but might be generated at build time, URL returns an ambiguous status, import uses a path alias that DocAlign doesn't resolve.

## Tier 2: Pattern-Based Checks

Heuristic verification using well-known file patterns. Slightly lower confidence because patterns may have false positives.

| Claim Type | Check |
|------------|-------|
| Environment variables | Present in `.env`, `.env.example`, `docker-compose.yml`? Referenced in code via `process.env.*`? |
| Conventions | TypeScript config in `tsconfig.json`? Framework in `package.json` dependencies? |
| Engine versions | `engines.node` in `package.json` matches documented Node.js version? |
| Navigation configs | All paths in `mkdocs.yml`, `_sidebar.md`, `mint.json` resolve? |
| Deprecation | Is the referenced code entity marked `@deprecated`? |
| License | Does `package.json` license match documentation? |
| Changelog | Does latest CHANGELOG version match `package.json` version? |
| Frontmatter | Does YAML `title:` match the first `# Heading`? |
| Cross-doc consistency | Does the same entity have the same value across all docs? |

**Confidence:** 0.7-0.9 (high but not certain)

**When it can't decide:** Env var is used in a non-standard way, convention claim is subjective, config file doesn't exist.

## Tier 3: LLM Verification (Optional)

For claims that can't be checked deterministically, an LLM reads the relevant code and assesses whether the claim holds.

**How it works:**
1. The claim text and relevant code files are sent to the LLM
2. The LLM assesses whether the code supports or contradicts the claim
3. Returns a verdict with reasoning

**When it's used:**
- Behavior claims: "Authentication uses JWT tokens"
- Architecture claims: "Services communicate via REST"
- Config assumptions: "Rate limited to 100 req/min"
- Any claim that Tier 1 and Tier 2 couldn't resolve

**Requirements:** `ANTHROPIC_API_KEY` environment variable.

**Confidence:** 0.5-0.9 (varies by claim complexity)

## Tier 4: Human Review

Claims that remain uncertain after all automated tiers are flagged for human review. These appear with verdict `uncertain` in scan results.

**Common reasons:**
- URL timed out or returned an ambiguous response
- Claim is subjective ("good documentation practices")
- Relevant code is obfuscated or uses unusual patterns
- Claim references external systems not in the repo

## Tier Progression

```
Claim arrives
    |
    v
[Tier 1: Deterministic]
    |
    +-- resolved? --> verdict (verified/drifted)
    |
    v
[Tier 2: Pattern-Based]
    |
    +-- resolved? --> verdict (verified/drifted)
    |
    v
[Tier 3: LLM] (if ANTHROPIC_API_KEY set)
    |
    +-- resolved? --> verdict (verified/drifted)
    |
    v
[Tier 4: Human Review] --> verdict: uncertain
```

Claims are only escalated to the next tier if the current tier cannot determine a verdict. Most claims (file paths, versions, commands) are resolved at Tier 1.


