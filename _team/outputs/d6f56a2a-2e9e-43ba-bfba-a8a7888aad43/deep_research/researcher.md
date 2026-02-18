# Deep Research — Nightly 2026-02-18

## Competitive Landscape

DocAlign occupies a unique niche: automated doc-code drift detection with verifiable claims. Key competitors and adjacent tools:

- **AI coding agents** (Cursor, Codex CLI, Aider, Windsurf, Copilot): Focus on code generation, not documentation verification. None offer systematic drift detection. This is DocAlign's defensible moat.
- **Doc linters** (Vale, Spectral, markdownlint): Check style/grammar, not code-reality alignment. Complementary, not competitive.
- **Docs-as-code platforms** (ReadMe, GitBook, Mintlify): Hosting/rendering focused. Some offer API sync but not general claim verification.
- **MCP ecosystem**: Growing rapidly. DocAlign's MCP server integration (L6) is a strong distribution channel for AI coding agents.

**Key insight**: No tool systematically extracts verifiable claims from docs and checks them against code. DocAlign's 7-layer architecture (L0-L7) is uniquely deep.

## Community Signals

- Documentation drift is a known pain point across all engineering teams. Common complaints: outdated README examples, wrong dependency versions, dead file references.
- MCP adoption accelerating — agents want tools that verify context, not just generate it.
- No direct DocAlign mentions found (limited search capability), but the problem space has strong demand signals.

## Codebase Gaps & Technical Debt

### Test Failures (16 total)
1. **Track 1 FP test** (1 failure): `track1-fp.test.ts` — the false-positive gate on synthetic-node corpus is failing. This means DocAlign reports false drifts on clean tagged corpus. **High priority fix.**
2. **Track 2 FN tests** (15 failures): `track2-fn.test.ts` — all 15 mutation detection tests fail. DocAlign is NOT detecting known drift mutations (renamed files, bumped versions, removed routes, deleted files, renamed functions, changed HTTP methods). **Critical — this is the core value proposition.**
3. **Shutdown test**: Unhandled Redis connection close in `test/shutdown.test.ts`.

### Layer Assessment
- **L0 (Codebase Index)**: Has AST parser. Appears functional.
- **L1 (Claim Extractor)**: Extractors for paths, deps, commands, URLs, code examples. Mature.
- **L2 (Mapper)**: Present but thin.
- **L3 (Verifier)**: Has tier1 (specific claim types) and tier2 (pattern-based). Core verification layer. Likely where FN failures originate — the verifiers aren't catching mutations.
- **L4 (Triggers)**: Full scan + PR scan processors, webhook handlers. Good infrastructure.
- **L5 (Reporter)**: Present.
- **L6 (MCP)**: Full MCP server with tool handlers, doc search, drift reports, query intent. Strong.
- **L7 (Learning)**: Feedback, suppression, confidence, co-change analysis, quick-pick. Advanced but unclear if connected.
- **Tags**: Parser + writer for inline tags (`docalign:skip|check|semantic`).

### Architecture Gaps
- Track 2 failures suggest L3 verifiers don't cover: route detection, function rename detection, MCP tool rename detection, file deletion detection, script rename detection.
- These are all tier1 verification gaps — each mutation type needs a corresponding verifier or verifier enhancement.

## Market Trends & Opportunities

1. **AI agent tool ecosystem**: MCP is the distribution channel. DocAlign as an MCP tool means every AI coding agent can verify docs before/after changes.
2. **CI/CD integration**: Doc drift as a CI gate (like linting) is underserved.
3. **Semantic verification**: Current verifiers are syntactic. Semantic claim verification (using LLMs) would be a major differentiator.
4. **Multi-repo support**: Enterprise need for cross-repo doc verification.

## Recommended Focus Areas (ranked)

1. **🔴 Fix Track 2 FN detection (CRITICAL)**: 15/15 mutation detection tests fail. The core drift detection doesn't catch renamed routes, bumped deps, deleted files, renamed functions, or changed HTTP methods. This is the product's reason to exist. Focus on L3 verifier enhancements for: route verification, function/export verification, script name verification, file existence verification, and MCP tool verification.

2. **🟡 Fix Track 1 FP gate**: The false-positive test fails on clean corpus. Users won't trust a tool that reports phantom drift. Likely a verifier that's too aggressive or a tag parsing issue.

3. **🟢 Shutdown test stability**: Redis connection handling in shutdown path. Minor but shows up in CI.

**Recommendation for tonight's epic**: Focus on **Track 2 FN detection fixes** — this is the highest-impact work. Fixing the mutation detection tests directly improves DocAlign's core capability. Scope: enhance L3 tier1 verifiers to detect the 15 mutation categories that are currently missed.
