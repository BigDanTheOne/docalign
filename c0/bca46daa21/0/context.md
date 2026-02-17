# Session Context

**Session ID:** 55286b63-9acd-4da9-9efc-391273de6a31

**Commit Message:** Yes

## Prompt

yes

## Summary

Here's what the competitive landscape reveals:

## The Closest Competitor: Swimm

Swimm is the most relevant prior art. Their approach is fundamentally different from DocAlign's: **explicit coupling**. Authors use a proprietary editor to create `.sw.md` files with `<SwmToken>`, `<SwmSnippet>`, and `<SwmPath>` tags. Only elements explicitly marked get tracked for drift.

This completely sidesteps the example-vs-real-reference problem - if you didn't tag it, it doesn't get checked. Their "Auto-sync" uses a multi-signal histogram (line positions, token presence, nearby context, file history) to decide whether to auto-fix or fail to a human. When confidence is low, they **always fail to human review** rather than guess. $16-28/seat/month.

## The Rest

| Tool | Approach | Key Insight |
|------|----------|-------------|
| **Doc Detective** | Execute docs as browser tests | Uses regex with procedural verb detection ("Go to", "Click", "Navigate") to auto-detect testable steps. Free, open source. |
| **Mintlify Agent** | AI watches code changes, proposes doc updates | No deterministic analysis at all. Pure LLM. $300/mo. |
| **Semcheck** | LLM compares spec documents against code | Closest to DocAlign's semantic tier. Open source. Admits "somewhat primitive evaluation." |
| **DeepDocs** | AI creates PRs with doc updates per commit | Fix-forward approach - updates docs rather than detecting drift. |
| **Writerside** | 100+ structural inspections in IDE | Broken links, missing files. Explicitly acknowledges it can't detect semantic drift. Free. |
| **Optic/DriftLinter/Dredd** | API spec vs traffic/code | Precise because OpenAPI is machine-readable. Not applicable to prose docs. |

## What This Means for DocAlign

**Nobody solves the example-vs-real problem automatically.** The industry falls into three camps:

1. **Explicit coupling** (Swimm) - Author tags what matters. Zero false positives, high annotation burden.
2. **Structured specs only** (Optic, DriftLinter, Dredd) - Works because API specs are machine-readable. Not applicable to prose.
3. **LLM judgment** (Mintlify, Semcheck, DeepDocs) - Throw AI at it. No deterministic guarantees.

DocAlign is trying to do something none of them do: **automatically extract verifiable claims from unstructured prose docs and deterministically check them against code.** That's genuinely novel. But the false positive problem we saw (0% precision on this repo) is exactly why nobody else attempts it - it's hard.

The research suggests three paths forward:

**Path A: Swimm's approach** - Add optional `<!-- docalign:track -->` directives. Only check explicitly marked claims. High precision, high burden.

**Path B: Doc Detective's approach** - Use verb/context detection to classify what's testable. "Create `.docalign.yml`" has an imperative verb → skip. Table in a "What It Finds" section → skip examples. Lower burden, imperfect precision.

**Path C: Conservative default** - Keep automatic extraction but fail to human review (like Swimm's Auto-sync). Flag findings as "suggestions" rather than "errors." Accept that some will be wrong and make dismissal easy.

These aren't mutually exclusive. What's your instinct?

## Key Actions

- - **Task**: Research Swimm doc-detective competitors
