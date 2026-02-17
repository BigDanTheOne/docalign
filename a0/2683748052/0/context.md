# Session Context

**Session ID:** 55286b63-9acd-4da9-9efc-391273de6a31

**Commit Message:** Okay so how do we fix them? As far as I understand, all these claims are

## Prompt

Okay so how do we fix them? As far as I understand, all these claims are false positives or deterministic claims (not Semantic that are extracted by a Claude code), correct?

## Summary

Correct. Every finding we saw came from the syntactic/deterministic pipeline - regex extractors in L1, deterministic verifiers in L3. No LLM involved. These are code bugs, not prompt problems.

Three fixes cover almost everything:

**Fix 1: Relative path resolution (verifier bug)**
When verifying a path claim from `docs/getting-started.md`, resolve `reference/cli.md` relative to `docs/`, not repo root. This kills ~10 false positives.

**Fix 2: Partial path matching (verifier bug)**
When `L3-verifier/index.ts` isn't found at repo root, try suffix matching against the file tree. `src/layers/L3-verifier/index.ts` matches. This kills ~5 more.

**Fix 3: Example/illustration detection (extractor bug)**
This is the biggest one (~20 false positives). The extractor pulls `src/auth.ts` and `express 4.18` from a table that's showing *what the tool detects*, not making claims about this repo. Needs context awareness - if a path or version appears inside an example table, a code block showing sample output, or a description of capability, don't extract it as a factual claim.

There's also two smaller ones:
- **Instruction detection** - "create `.docalign.yml`" is imperative, not declarative
- **Prerequisite vs dependency** - "Node.js 18+" is a runtime requirement, not an npm package

Want me to plan the implementation, or should we pick the highest-impact fix and start there?

## Key Actions

