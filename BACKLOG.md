# DocAlign Backlog

Tracked issues that are worth investigating but not immediately actionable.
Each entry includes reproduction context so future improvements can be verified.

---

## BL-001: Semantic extractor produces unverifiable capability claims about DocAlign itself

**Category**: False positive — L3 verifier cannot verify high-level tool capability claims

**Status**: Quick-fix applied (prompt filter); deep fix tracked here.

### Problem

The semantic extractor picks up claims that describe DocAlign's own high-level
features or architecture. These claims are often _true_ but impossible to verify
reliably because:

1. The claim spans multiple modules (no single entity "proves" it)
2. The extraction sub-agent guesses entity names that don't match actual code
3. The verifier then looks for the guessed entity, finds nothing, and reports drift

This is distinct from real verifier bugs — the verifier logic is correct; the
issue is that no single code entity can evidence a cross-cutting capability claim.

### Quick fix (applied)

Added to `src/cli/prompts/semantic-extract.ts` "What NOT to extract":

> **Capability summaries about this tool**: "DocAlign uses X for Y", "The extract
> command finds behavior claims using Claude", "works with zero config" — these
> describe the tool's own features at too high a level to pin to specific code
> entities. Skip them; they cannot be reliably verified.

### Reproduction cases (dogfood run, 2026-02-18)

| File | Line | Claim text | Verifier error | Analysis |
|------|------|-----------|----------------|----------|
| `docs/getting-started.md` | 101 | "docalign extract finds behavior and architecture claims using Claude" | Entity `claudeBridge` not found in `src/cli/claude-bridge.ts` | Capability description. Extractor invented entity name `claudeBridge`; actual call site is elsewhere. |
| `AGENTS.md` | 42 | "DocAlign works with zero config. Customize via `.docalign.yml` at repo root." | Entity `loadConfig` not found in `src/config/loader.ts` | Zero-config UX claim. Extractor guessed `loadConfig`; actual export is `loadDocAlignConfig`. |
| `docs/reference/cli.md` | 80 | "fix command requires ANTHROPIC_API_KEY; without it, only deterministic suggestions are available" | Entity `LocalPipeline.generateFix` not found in `src/cli/real-pipeline.ts` | Feature capability + env-var claim (env var already covered by regex). Extractor invented method name `generateFix`. |
| `docs/contributing/design-patterns.md` | 89 | "Error codes follow a numbering convention: E5xx for config errors, E4xx for pipeline errors" | Entity `loadConfig` not found in `src/config/loader.ts` | Architectural convention claim. Extractor looked in wrong file and guessed wrong entity. |

### Root cause

Extraction sub-agents are instructed to "grep for keywords and find the relevant
source file." For capability claims, the "relevant source file" is ambiguous —
there is no single file. The sub-agent defaults to guessing a plausible entity
name, which then fails verification.

### Deep fix candidates

1. **Verifier: fuzzy entity resolution** — instead of exact symbol lookup, try
   substring/prefix matching before reporting "not found". This would catch
   `loadConfig` → `loadDocAlignConfig`.

2. **Verifier: multi-file evidence** — allow a claim to be verified against a
   set of files rather than a single entity. Useful for cross-cutting claims.

3. **Extractor: entity name validation** — after finding evidence, the sub-agent
   should confirm the entity actually exists with a Grep before writing the
   assertion. The prompt already says this but the instruction is not always
   followed.

4. **New claim type: `capability_claim`** — extract these separately and route
   them to a different verifier that checks for feature existence at a higher
   abstraction level (e.g., "does any Claude call exist in the codebase?").

---

## BL-002: L1 syntactic extractor picks up code-block examples in contributing docs

**Category**: False positive — L1 regex extracts code examples from `<!-- docalign:skip -->` regions it hasn't seen yet

**Status**: Needs investigation. Phase 1 skip tagging and L1 extraction are
currently decoupled — extract must run before scan for skip tags to take effect.

### Problem

`docs/contributing/design-patterns.md` claims like
`function verifyPathReference(claim: Claim, index: CodebaseIndex)` are picked up
as function-signature claims from code blocks that should be inside skip regions.
If `extract` has been run, these blocks should have `<!-- docalign:skip -->` tags.
If not, L1 runs on raw markdown and extracts them as real claims.

### Reproduction (dogfood run, 2026-02-18)

`docs/contributing/design-patterns.md` lines 36, 50, 67, 107 — function signature
and code-block claims from the "Verifier pattern" and "Test helpers" sections.

### Deep fix candidates

1. **Make `extract` mandatory**: `check` and `scan` should refuse (or at least
   warn loudly) when no semantic store exists for a file. This ensures skip tags
   are present before L1 runs.

2. **L1 skip-tag awareness**: L1 syntactic extractor should read skip tags from
   the file itself and drop claims that fall inside a tagged region — even without
   the semantic store.

---
