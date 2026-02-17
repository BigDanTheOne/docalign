# Session Context

**Session ID:** 55286b63-9acd-4da9-9efc-391273de6a31

**Commit Message:** Okay there are a lot of tools out there that actually resolve determinis

## Prompt

Okay there are a lot of tools out there that actually resolve deterministic claims in DocAlign to quadrality. Before proposing fixes please research how exactly tools out there solve these problems and only then synthesize your conclusion.

## Summary

Here's what the research found:

## Solved Problems (just copy what everyone does)

**Relative path resolution** is completely solved. Every tool - markdown-link-check, remark-validate-links, Sphinx, Docusaurus - resolves relative paths from the document's directory. Sphinx even had this exact bug (resolving from project root) and fixed it in PR #8245. DocAlign just needs to do `path.join(path.dirname(docFile), claimedPath)` before checking existence. This is a one-line fix in the verifier.

## Partially Solved Problems

**Code block / inline code detection** - All tools that work on markdown AST (remark, markdownlint) get this for free because fenced code blocks are typed as `code` nodes. Vale goes further with a scoping system that lets rules target `summary` (prose only, excluding code, headings, and table cells). Inline comment directives (`<!-- markdownlint-disable -->`) are the universal escape hatch for manual overrides.

But here's the thing: DocAlign's false positives aren't from code blocks - they're from **prose that describes examples**. The checks.md table says `src/auth.ts` as an example in a table cell. No existing tool distinguishes "illustrative mention in prose" from "real claim in prose." They all either check everything or skip everything via manual directives.

**Partial path matching** - No documentation tool does this at all. The closest analogy is webpack's module resolution and Node.js `require()` - they use extension fallbacks, directory walking, and alias mappings. For DocAlign, a **suffix match** against a file index (does any repo file end with `L3-verifier/index.ts`?) would be simple and effective.

## Unsolved Problems (DocAlign would be novel here)

**Instruction vs assertion** - No documentation tool makes this distinction. NLP research shows that POS tagging (detecting base-form verbs at sentence start) achieves ~84% accuracy on imperative vs declarative classification. Practical heuristics without ML:
- Sentence starts with imperative verb (create, run, add, install, configure) → likely instruction
- Section heading contains "Setup", "Getting Started", "Tutorial" → likely instructional context
- Third-person present tense with subject ("reads from", "stores in") → likely assertion

**Example vs real reference in prose** - Nobody solves this automatically. Vale's scoping can skip table cells and code blocks, but when a table cell contains an example path, and another table cell contains a real path, no tool distinguishes them.

## Synthesis

| Problem | Industry Solution | DocAlign Fix |
|---------|------------------|--------------|
| Relative paths | Resolve from file dir (universal) | Bug fix in verifier, trivial |
| Partial paths | No doc tool does this | Suffix matching against file index |
| Code block examples | AST node type filtering | Already possible with markdown parsing |
| Prose examples in tables | Comment directives (manual) | Need heuristic: table context + heading context |
| Instructions vs claims | No tool does this | Verb-first heuristic + section heading context |

The first fix (relative paths) is a bug. The second (suffix matching) is a small feature. The last three are where DocAlign would need to do something genuinely new - and where it could differentiate itself from existing tools. Should I plan the implementation?

## Key Actions

- - **Task**: Research doc checking tools
