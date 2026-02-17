# Session Context

**Session ID:** f72936a6-196a-4d29-ad28-c6a9a02f5405

**Commit Message:** Concerned about both equally. Do not suspect any specific claim types to

## Prompt

concerned about both equally. Do not suspect any specific claim types to be honest. Ready to consider any option to battle-test everything. We only want to note that obviously it's much easier to track and treat false positives because we can simply take a big repo and dock it to our system, then take a look at all claims that are marked as drifted and check if it's true. If it's not, this is a false positive.
On the other hand false negatives are actually two different problems that might be rooted in two different problems:
1. Incorrect claim verification
2. Incorrect claim extraction, like we simply skipped the claim

## Summary

That's a sharp distinction. You've correctly identified that FN is actually two orthogonal problems:

```
FN Type 1: claim exists in system → wrong verdict (verified when should be drifted)
FN Type 2: claim never entered the system → missed at extraction
```

These require fundamentally different testing strategies, and you can't catch one by testing the other.

---

**For FP (your big-repo approach):**

You're right, it's the cheapest test to run. The workflow is:
1. Pick 5-10 well-maintained OSS repos (docs should be in sync with code by assumption)
2. Run DocAlign, collect all "drifted" findings
3. Any finding that's wrong = FP

The hard part isn't running it — it's the **manual review step**. At scale this gets expensive. Worth thinking about: can you build a review UI or script that presents findings one at a time with context, so a human can quickly triage? Even a simple `--review-mode` that outputs findings as a numbered list with the relevant doc snippet and code snippet side-by-side would make spot-checking fast.

---

**For FN Type 1 (wrong verdict):**

Mutation testing is the right tool. The key property: **ground truth is free** — you introduce the drift programmatically, so you know exactly what should be flagged.

The tricky design decision is mutation scope. Do you mutate:
- The **code** (change what the code does) and expect DocAlign to flag the existing doc claim?
- The **doc** (change what the doc says) and expect DocAlign to flag it against unchanged code?

Both are valid drifts but exercise different verification paths. A complete mutation suite needs both.

---

**For FN Type 2 (missed extraction):**

This one is harder, and it's a different shape than the other two. The question isn't "is the verdict correct?" but "do we even know about this claim?"

A few approaches:
- **Annotated corpus**: Take 3-5 real doc files, manually label every claim (what type, what value), compare to what L1 actually extracted. Gives you extraction recall directly. One-time cost, but expensive.
- **Synthetic docs with known density**: Write doc files where YOU control exactly what claims exist. Since you wrote them, ground truth is free — similar to the mutation approach.
- **Cross-check with a second extractor**: Run the same docs through a dumb LLM prompt ("list every factual claim in this document") and diff against L1's output. Not ground truth but surfaces obvious gaps.

For syntactic claims (regex-based), Type 2 testing is actually tractable — you can enumerate the regex patterns and write docs that exercise every variant plus edge cases. For semantic claims (LLM-based), you're measuring extraction recall of an LLM which is inherently fuzzy and harder to pin down.

---

**The practical priority question:**

Type 2 FNs are dangerous but silent — you can't see what you're missing. However, they're arguably less urgent than Type 1 because:
- A missed claim means DocAlign just doesn't monitor that fact (no harm done beyond coverage gap)
- A wrong verdict on a known claim means DocAlign actively lies about the state of a claim (erodes trust)

Do you agree with that priority ordering? And on the extraction side — are you more concerned about syntactic extraction coverage (the regex patterns) or semantic extraction coverage (the LLM step)?

## Key Actions

