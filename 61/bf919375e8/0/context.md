# Session Context

**Session ID:** f72936a6-196a-4d29-ad28-c6a9a02f5405

**Commit Message:** Hey hey hey, I can see that you started manually tagging our documentati

## Prompt

Hey hey hey, I can see that you started manually tagging our documentation. Don't do this. This is the DocAlign job. It must be able to do everything itself so please revert all the tags. We must tune DocAlign so that it will do all this.

## Summary

Clean. Now let's talk about what DocAlign actually needs to do automatically instead.

Looking at the false positives we saw, there are three distinct patterns DocAlign needs to detect on its own:

---

**1. "Extracts:" / "Verifies:" bullet sections** — documentation about a tool describing what it does, using example values. The doc structure is a giveaway: a bold label like `**Extracts:**` or `**Verifies:**` followed by bullet items containing example paths/routes/versions. DocAlign should recognize that bullet lists under those specific headings are illustrative, not claims.

**2. `create .docalign.yml` / `create <config-file>` instructions** — the verb "create" before a filename signals that the file is user-produced, not expected to exist in the repo. The path verifier should recognize "create `X`", "add `X`", "generate `X`" patterns as instructions rather than existence assertions.

**3. Named example sentences** — text like `"Example: docs/setup.md says port 3000"` explicitly signals an illustrative scenario. The `isIllustrativeLine` heuristic already catches `e.g.` and `for example` but misses the `Example:` label pattern.

Which of these do you want to tackle first, and do you want me to also propose fixes for the remaining real false positives (the bullet-list examples in checks.md, the nav config file names like `mkdocs.yml`, and the `.docalign.yml` instruction pattern)?

## Key Actions

- - **Read**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Read**: /Users/kotkot/docalign/docs/getting-started.md
- - **Read**: /Users/kotkot/docalign/README.md
- - **Edit**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Edit**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Edit**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Edit**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Edit**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Edit**: /Users/kotkot/docalign/docs/reference/checks.md
- - **Edit**: /Users/kotkot/docalign/docs/getting-started.md
