# Session Context

**Session ID:** f72936a6-196a-4d29-ad28-c6a9a02f5405

**Commit Message:** Yes now this is what we need but before writing actual file content let'

## Prompt

Yes now this is what we need but before writing actual file content let's write a spec or a design document or whatever you call it. So that in any further session with empty context we can take a look at it and proceed without getting stuck or without doing wrong things and finish everything. This document, I want everything we discussed, from how we are going to test our Drift mechanics and so on, to how our Synthetic code base must look like and what it must contain.

## Summary

Written to `test/qa/CORPUS-DESIGN.md`.

The document is self-contained — a future session can open it and execute from Section 11 (implementation checklist) in order without needing any of this conversation for context.

A few things worth noting about the structure:

**Section 6.3 (code file blueprints)** is the piece that prevents the most common implementation mistake — writing a code file that doesn't actually satisfy the claims it's supposed to support. It tells whoever writes `src/middleware/auth.ts` exactly what must be in it and why.

**Section 7.4 (mutation auto-generation algorithm)** is written precisely enough that the `corpus:gen-mutations` script can be implemented directly from it, including the ambiguity check.

**Section 9 (bootstrap workflow)** has a human review step (Steps 4 and 7) that can't be automated. A future session needs to know those exist and not skip them.

The one thing the document deliberately does not contain is the actual file contents of the corpus — those come in the next session, using Section 6.3 and 6.4 as the spec.

## Key Actions

- - **Bash**: Check current QA directory structure
- - **Write**: /Users/kotkot/docalign/test/qa/CORPUS-DESIGN.md
