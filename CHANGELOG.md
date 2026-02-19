# Changelog

All notable changes to DocAlign will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.6] - 2026-02-19

### Fixed
- **CRITICAL**: Removed `semantic` from `SKIP_BLOCK_TAGS` in preprocessing — was causing entire documents to be blanked after inline `docalign:semantic` tags (no closing tag exists, so activeBlockTag remained set until EOF)
- Reverted tag-first semantic claim loading to avoid stale line numbers from JSON snapshots

### Removed
- Tag-first semantic claim discovery (`writeTagStatusBack`, `blankSemanticClaimLines`) — reverted to store-only approach for accurate line number tracking
- Parser support for `docalign:claim` tags — returned to `docalign:semantic` inline tags without migration

## [0.3.5] - 2026-02-15

### Added
- Interactive concurrency limit prompt when spawning sub-agents
- Dogfood re-tagging of documentation

## [0.3.4] - 2026-02-14

### Added
- Semantic extract prompt with corpus tests and synthetic-node fixtures

### Changed
- Synchronized `.claude/skills` and `CLAUDE.md` with latest changes

### Fixed
- Run targeted `docs/` glob before broad sweep to prevent truncation miss

## [0.3.3] - 2026-02-13

### Fixed
- Rewrote `docalign-setup` skill
- Stripped bad dogfood artifacts from documentation

## [0.3.2] - 2026-02-12

### Changed
- Moved skill sources to top-level `skills/` directory

## [0.3.1] - 2026-02-11

### Fixed
- Guard against missing array fields in semantic claim records

### Changed
- Moved skill prompts out of `init.ts` into standalone `SKILL.md` files

## [0.3.0] - 2026-02-10

### Added
- Auto-trigger setup wizard via `CLAUDE.md` on first Claude Code launch
- Embedded setup skill as constant to avoid fragile file-path resolution
- User-level skill installation (`~/.claude/skills/`) in addition to project-level
- Installation script (`install.sh`) and `docalign-setup` skill
- Corpus test scripts and skill v0.3.0
- Interactive setup with parallel sub-agents

### Changed
- Rewrote README around MCP-first installation approach
- Corrected Claude Code hooks format in `docalign init`

### Fixed
- Auto-start setup wizard without requiring user input
- Terminal line discipline reset before launching Claude Code
- Explanatory pre-launch banner describing setup wizard steps
- Don't launch Claude Code from within `curl|bash` pipe
- Use `script` to launch Claude Code in same terminal window (macOS)
- Auto-launch Claude Code via `osascript` new Terminal window (macOS)
- Add `</dev/tty` to script invocation for proper keyboard input
- Repair hooks format in `settings.local.json` after `docalign init`

## [0.2.x] - Implementation Phase

### Added
- MCP server with 5 tools: `check_file`, `scan_repo`, `get_drift_report`, `dismiss_claim`, `get_docs_for_file` (E8)
- GitHub webhook handlers for `@docalign` review comments and installation onboarding (E4)
- L7 learning system: feedback tracking, suppression, co-change analysis (E6)
- L4 trigger system and L5 PR reporter with Check Runs and health scores (E4)
- L3 verification engine with Tier 1-2 deterministic verification (E3)
- L2 claim-to-code mapper with 3-step progressive mapping (E3)
- L1 claim extractor with regex-based extraction and claim pipeline (E2)
- L0 codebase indexer with AST parsing and entity lookup APIs (E2)
- SQLite storage adapter for CLI mode (E9)
- `.docalign.yml` configuration system with validation (E7)
- Railway deployment configuration (E1)
- Vertical slice integration tests (E4)
- Cross-layer integration tests (L0 → L2 → L3) (E3)
- PostgreSQL + pgvector database with migrations (E1)
- Redis + BullMQ job queue (E1)
- Express.js server with health endpoints (E1)
- GitHub App authentication with webhook HMAC verification (E1)
- Structured logging with Pino (E1)
- Zod schema validation throughout (E1)

### Changed
- Implemented agent-first architecture: all LLM calls client-side in GitHub Action

### Fixed
- L1 syntactic extractor respects `docalign:skip` regions (BL-002)
- Extract command prevents overwriting user-placed skip tags

## [0.1.0] - Initial Scaffold

### Added
- Project structure and planning artifacts
- TypeScript build configuration
- Vitest test framework setup
- ESLint and Prettier configuration
- Development tooling and permission guardrails

---

## Version Scheme

DocAlign follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** version (1.0.0): Incompatible API changes
- **MINOR** version (0.x.0): New functionality in a backward-compatible manner
- **PATCH** version (0.0.x): Backward-compatible bug fixes

During the pre-1.0 phase (0.x.x), minor versions may include breaking changes as the API stabilizes.

[unreleased]: https://github.com/BigDanTheOne/docalign/compare/v0.3.6...HEAD
[0.3.6]: https://github.com/BigDanTheOne/docalign/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/BigDanTheOne/docalign/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/BigDanTheOne/docalign/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/BigDanTheOne/docalign/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/BigDanTheOne/docalign/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/BigDanTheOne/docalign/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/BigDanTheOne/docalign/compare/v0.2.0...v0.3.0
