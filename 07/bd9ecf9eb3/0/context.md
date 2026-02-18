# Session Context

**Session ID:** f72936a6-196a-4d29-ad28-c6a9a02f5405

**Commit Message:** Yes, wire it up

## Prompt

yes, wire it up

## Summary

Much better — now scanning **14 docs, 88 claims, 50 verified**. Here's the honest breakdown of the 11 remaining drifts:

---

**Genuine extractor false positives** (pipeline bugs, not corpus problems):

| Finding | Cause |
|---|---|
| `process.env` not found (3 files) | `.env` is a known extension — `process.env` gets extracted as a file path |
| `./api/errors.md` not found | `markdown_link_path` regex eats one `.` of `../`, turns `../api/errors.md` into `./api/errors.md`, resolves to wrong dir |
| `./guides/mcp.md` not found | Same `../` regex bug |
| `Node.js` package not found (3 files) | Runtime version extractor has no special handling for `Node.js` as a package name |

**Genuine corpus gaps** (docs reference things that don't exist in the codebase):

| Finding | Cause |
|---|---|
| `GET /api/v1/health` not found | Mentioned in `api/overview.md` prose — the corpus has `/health` in `src/index.ts` but not at `/api/v1/health` |
| `POST /api/v1/auth/login` not found | Mentioned in prose — no auth system in the corpus code |
| `dist/index.js` not found | Build output referenced in deployment docs — doesn't exist (no build) |
| `express 3.` version mismatch | README has a note about express 3.x that the version extractor picks up |
| `.eslintrc.json` not found | Referenced in CONTRIBUTING — file doesn't exist in corpus |

The 5 extractor bugs are what `docalign:skip` was papering over in the corpus test runner. The 6 corpus gaps are real — the synthetic project has docs that outran its code.

## Key Actions

- - **Bash**: Check CLI and available pipeline entry points
- - **Read**: /Users/kotkot/docalign/src/cli/local-pipeline.ts
- - **Read**: /Users/kotkot/docalign/src/cli/real-pipeline.ts
- - **Read**: /Users/kotkot/docalign/src/cli/main.ts
- - **Read**: /Users/kotkot/docalign/src/cli/real-pipeline.ts
- - **Glob**: src/lib/repo-root-resolver.ts
- - **Bash**: Check if corpus has its own git repo
- - **Read**: /Users/kotkot/docalign/src/lib/repo-root-resolver.ts
- - **Read**: /Users/kotkot/docalign/src/cli/real-pipeline.ts
- - **Bash**: Check module type and build setup
