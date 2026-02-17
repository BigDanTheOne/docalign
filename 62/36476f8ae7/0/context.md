# Session Context

**Session ID:** 55286b63-9acd-4da9-9efc-391273de6a31

**Commit Message:** Okay synthesize report for me. All problems and for each problem all pot

## Prompt

Okay synthesize report for me. All problems and for each problem all potential solutions.

## Summary

Written to `_team/docs/false-positive-analysis.md`. Here's the summary:

## 5 Problems, 18 Solutions

**Problem 1: Relative path resolution** (~10 FPs)
- S1.1: Resolve from doc directory *(industry standard, bug fix)*
- S1.2: Configurable base path *(for static site generators)*
- S1.3: Regex replacement patterns *(power user)*

**Problem 2: Partial path matching** (~5 FPs)
- S2.1: Suffix matching against file index *(no tool does this, but simple)*
- S2.2: Alias/prefix config *(webpack/TypeScript approach)*
- S2.3: Walk-up directory search *(Node.js approach)*
- S2.4: Fuzzy/closest match with threshold *(already have close-match.ts)*

**Problem 3: Example/illustration confusion** (~20 FPs, biggest category)
- S3.1: AST-based scope filtering *(Vale approach)*
- S3.2: Inline comment directives *(markdownlint/remark-lint approach)*
- S3.3: Explicit coupling *(Swimm approach — author tags what to track)*
- S3.4: Contextual confidence scoring *(Swimm auto-sync approach)*
- S3.5: Table header analysis *(novel heuristic, catches 17 of 20)*
- S3.6: Verb-pattern intent classification *(Doc Detective approach)*

**Problem 4: Instruction vs assertion** (~5 FPs)
- S4.1: Imperative verb detection *(NLP research, ~84% accuracy)*
- S4.2: Section heading context *(Vale/Doc Detective approach)*
- S4.3: Tense/mood analysis *(lightweight NLP)*
- S4.4: "To" + infinitive pattern detection

**Problem 5: Prerequisite vs dependency** (~1 FP)
- S5.1: Known-runtime allowlist
- S5.2: Check `engines` field instead of `dependencies`
- S5.3: Section context ("Prerequisites" heading)

## Recommended Priority

Fixes 1-5 (S1.1, S3.5, S4.1, S2.1, S5.1) are all small effort and would eliminate nearly all 95 false positives. They're independent of each other and could be done in parallel.

## Key Actions

- - **Write**: /Users/kotkot/docalign/_team/docs/false-positive-analysis.md
