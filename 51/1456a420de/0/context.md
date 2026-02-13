# Session Context

**Session ID:** a62e0458-bb12-437e-88dd-de953921ae64

**Commit Message:** How can we make Claude to strictly follow the steps

## Prompt

How can we make Claude to strictly follow the steps?

## Summary

**5 claims, 5 verified, 0 drifted, 0 false positives.** 100% accuracy.

The assertion pruning works: any pattern Claude guessed without actually verifying via Grep gets silently dropped because it fails our own check. Only assertions that match real code survive. The combination is:

1. **Prompt says "verify with Grep"** — Claude follows it ~90% of the time, producing good assertions
2. **Code prunes failures** — the ~10% that slip through get dropped deterministically

No loops, no second pass. Just one extraction + one filter.

## Key Actions

- - **Read**: /Users/kotkot/Discovery/docalign/src/cli/real-pipeline.ts
- - **Read**: /Users/kotkot/Discovery/docalign/src/cli/real-pipeline.ts
- - **Read**: /Users/kotkot/Discovery/docalign/src/cli/real-pipeline.ts
- - **Read**: /Users/kotkot/Discovery/docalign/src/cli/real-pipeline.ts
- - **Grep**: import.*staleness-checker
- - **Grep**: ^export |^function checkAssertion
- - **Edit**: /Users/kotkot/Discovery/docalign/src/cli/staleness-checker.ts
- - **Edit**: /Users/kotkot/Discovery/docalign/src/cli/real-pipeline.ts
- - **Edit**: /Users/kotkot/Discovery/docalign/src/cli/real-pipeline.ts
- - **Bash**: Typecheck and run tests
