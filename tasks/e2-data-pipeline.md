# Epic E2: Data Pipeline -- Index + Extraction

## Story S2.1: L0 Codebase Index

### Task E2-01: tree-sitter WASM Setup + Language Grammar Loading
- **Files:** `src/layers/L0-codebase-index/ast-parser.ts`, `src/shared/types.ts`
- **Implements:** TDD-0 Section 3 (SupportedLanguage, ExtensionMap, ParsedFileResult, ParsedEntity), TDD-0 Section 6 (web-tree-sitter), TDD-0 Appendix B (EXTENSION_MAP, detectLanguage, isSupportedCodeFile)
- **Types used:** `EntityType` (Section 1), `CodeEntity` (Section 2.1)
- **Tests:** `test/layers/L0-codebase-index/ast-parser.test.ts` -- WASM initializes, all three grammars load, detectLanguage returns correct language for all extensions, returns null for unsupported
- **Done when:** web-tree-sitter initializes and loads .wasm grammars for TS/JS/Python; detectLanguage works for all extensions; memory per grammar < 30MB; all tests pass
- **Estimated effort:** 3 hours

### Task E2-02: tree-sitter Entity Extraction Queries (TS/JS + Python)
- **Files:** `src/layers/L0-codebase-index/ast-parser.ts`
- **Implements:** TDD-0 Section 6 (S-expression queries), TDD-0 Section 3 (ParsedFileResult, ParsedEntity)
- **Types used:** `EntityType` (Section 1), `ParsedEntity`, `ParsedFileResult`
- **Tests:** TS/JS exported functions/classes/interfaces/routes, Python top-level functions/classes/routes, negative tests, edge cases (parse errors, empty files)
- **Done when:** parseFile returns correct entities for all patterns; route entities formatted as "{METHOD} {path}"; single 500-line TS file parses < 10ms; all tests pass
- **Estimated effort:** 4 hours

### Task E2-03: Database Migration -- code_entities + repo_files Tables
- **Files:** `migrations/{timestamp}_create_code_entities.ts`, `migrations/{timestamp}_create_repo_files.ts`
- **Implements:** TDD-0 Section 4.1-4.4, Section 7, phase4-api-contracts.md Section 12 (CodeEntityRow)
- **Types used:** `CodeEntityRow`, `EntityType`
- **Tests:** migration up/down, columns match schema, pgvector VECTOR(1536), indexes exist
- **Done when:** Tables created with all columns, indexes, HNSW index on embedding; migration rolls back cleanly
- **Estimated effort:** 2 hours

### Task E2-04: L0 File and Entity Lookup APIs
- **Files:** `src/layers/L0-codebase-index/index-store.ts`
- **Implements:** TDD-0 Sections 4.1 (fileExists), 4.2 (getFileTree), 4.3 (findSymbol), 4.4 (getEntityByFile), 4.5 (getEntityById)
- **Types used:** `CodeEntity` (Section 2.1), `CodebaseIndexService` (Section 2.2)
- **Tests:** All 5 functions with positive/negative/edge cases, path normalization, case-insensitive fallback for findSymbol
- **Done when:** All 5 functions match TDD-0 signatures; fileExists checks both tables; performance targets met; all tests pass
- **Estimated effort:** 3 hours

### Task E2-05: L0 Route Lookup APIs
- **Files:** `src/layers/L0-codebase-index/index-store.ts`
- **Implements:** TDD-0 Sections 4.6 (findRoute), 4.7 (searchRoutes)
- **Types used:** `RouteEntity`, `CodebaseIndexService`
- **Tests:** Exact match, parameterized path normalization, fuzzy search ranking, threshold filtering
- **Done when:** findRoute matches exact + parameterized routes; searchRoutes ranks by similarity; performance < 10ms
- **Estimated effort:** 3 hours

### Task E2-06: L0 Dependency + Script Lookup APIs
- **Files:** `src/layers/L0-codebase-index/index-store.ts`
- **Implements:** TDD-0 Sections 4.8 (getDependencyVersion), 4.9 (scriptExists), 4.10 (getAvailableScripts)
- **Types used:** `DependencyVersion`, `ScriptInfo`, `CodebaseIndexService`
- **Tests:** Lockfile vs manifest source, Python case-insensitive, scoped packages, Makefile targets
- **Done when:** All 3 functions match specs; performance < 5ms; all tests pass
- **Estimated effort:** 3 hours

### Task E2-07: L0 Manifest Parsing
- **Files:** `src/layers/L0-codebase-index/manifest-parser.ts`
- **Implements:** TDD-0 Section 6 (Manifest Parsing table), TDD-0 Section 3 (ParsedManifest), TDD-0 Appendix B (MANIFEST_FILES)
- **Types used:** `ParsedManifest`, `DependencyVersion`, `ScriptInfo`
- **Tests:** package.json, package-lock.json v3, requirements.txt, pyproject.toml, Makefile, yarn.lock, pnpm-lock.yaml, Cargo.toml, go.mod, edge cases
- **Done when:** parseManifest works for all supported types; isManifestFile identifies all files; all tests pass
- **Estimated effort:** 4 hours

### Task E2-08: L0 Semantic Search + pgvector
- **Files:** `src/layers/L0-codebase-index/index-store.ts`
- **Implements:** TDD-0 Section 4.11 (searchSemantic)
- **Types used:** `CodeEntity`, `CodebaseIndexService`
- **Tests:** Cosine similarity ranking, threshold filtering, topK cap, empty repos, dimension mismatch, MVP fallback
- **Done when:** searchSemantic uses pgvector cosine distance; filters >= 0.7; fallback to findSymbol when no embedding; < 50ms
- **Estimated effort:** 3 hours

### Task E2-09: L0 Incremental Update + Entity Diff
- **Files:** `src/layers/L0-codebase-index/index-store.ts`, `src/layers/L0-codebase-index/ast-parser.ts`
- **Implements:** TDD-0 Section 4.12 (updateFromDiff), TDD-0 Appendix A (computeEntityDiff)
- **Types used:** `FileChange`, `IndexUpdateResult`, `CodebaseIndexService`
- **Tests:** Add/modify/remove/rename files, manifest changes, non-code files, parse errors, signature changes null embedding, empty input, entity diff algorithm, transaction atomicity
- **Done when:** Full updateFromDiff pseudocode implemented; entity diff uses (name, entity_type) key; renames update file_path; signature changes null embedding; atomic transaction; < 5s for 100 files
- **Estimated effort:** 4 hours

### Task E2-10: L0 Service Interface Assembly
- **Files:** `src/layers/L0-codebase-index/index.ts`
- **Implements:** TDD-0 Section 2.2, phase4-api-contracts.md Section 2.2 (CodebaseIndexService)
- **Types used:** `CodebaseIndexService`, all L0 data types
- **Tests:** Integration test calling all 12 public methods against test DB with fixtures
- **Done when:** All 12 methods exported; constructor injection of StorageAdapter; consistent error handling
- **Estimated effort:** 2 hours

## Story S2.2: L1 Claim Extractor

### Task E2-11: Database Migration -- claims Table
- **Files:** `migrations/{timestamp}_create_claims.ts`
- **Implements:** phase4-api-contracts.md Section 12 (ClaimRow)
- **Types used:** `ClaimRow`, `ClaimType`, `Testability`, `ExtractionMethod`
- **Tests:** Migration up/down, columns match schema, JSONB extracted_value, TEXT[] keywords, VECTOR(1536) embedding, indexes
- **Done when:** claims table with all columns, self-referential FK, indexes; migration rolls back
- **Estimated effort:** 1.5 hours

### Task E2-12: L1 Pre-processing Pipeline + Doc Format Detection
- **Files:** `src/layers/L1-claim-extractor/syntactic.ts`
- **Implements:** TDD-1 Appendix A (preProcess), TDD-1 Section 4.1 (format detection)
- **Types used:** `PreProcessedDoc`
- **Tests:** Strip YAML frontmatter, HTML tags, base64 images, inline SVG, JSX components; line map; format detection; size limit; binary detection
- **Done when:** preProcess implements all 6 steps; detectFormat maps extensions; line map correct; < 10ms per file
- **Estimated effort:** 3 hours

### Task E2-13: L1 Regex Extractors -- Path References + API Routes
- **Files:** `src/layers/L1-claim-extractor/syntactic.ts`
- **Implements:** TDD-1 Appendix B.1 (FILE_PATH_PATTERNS), B.4 (ROUTE_PATTERNS), Appendix C (isValidPath)
- **Types used:** `ClaimType`, `ExtractedValue`, `RawExtraction`
- **Tests:** Backtick/link/text paths, post-match filters, isValidPath validation, route extraction, negative cases
- **Done when:** All 3 path patterns + 6 filters + route patterns work; isValidPath matches Appendix C; regex timeout 50ms
- **Estimated effort:** 3 hours

### Task E2-14: L1 Regex Extractors -- Commands + Dependency Versions
- **Files:** `src/layers/L1-claim-extractor/syntactic.ts`
- **Implements:** TDD-1 Appendix B.2 (COMMAND_BLOCK_PATTERN, COMMAND_INLINE_PATTERNS), B.3 (VERSION_PATTERNS)
- **Types used:** `ClaimType`, `ExtractedValue`, `RawExtraction`, `KnownDependencies`
- **Tests:** Code block commands, inline commands, version extraction, known-dependency validation, negative cases
- **Done when:** Code block 5-step algorithm works; version post-match validation with L0 known deps; runtime versions always kept
- **Estimated effort:** 3 hours

### Task E2-15: L1 Regex Extractors -- Code Examples
- **Files:** `src/layers/L1-claim-extractor/syntactic.ts`
- **Implements:** TDD-1 Appendix B.5 (CODE_EXAMPLE_PATTERN)
- **Types used:** `ClaimType`, `ExtractedValue`, `RawExtraction`
- **Tests:** Fenced code blocks, CLI block exclusion, import/symbol/command extraction, sub-claims as JSONB, edge cases
- **Done when:** code_example extraction with language, imports, symbols, commands; sub-claims in parent JSONB; symbols deduped
- **Estimated effort:** 3 hours

### Task E2-16: L1 extractSyntactic() Orchestrator + Dedup + Keywords
- **Files:** `src/layers/L1-claim-extractor/syntactic.ts`, `src/layers/L1-claim-extractor/claim-store.ts`
- **Implements:** TDD-1 Section 4.1 (full algorithm), Appendix E (deduplication), Appendix F (keywords)
- **Types used:** `Claim`, `ClaimExtractorService`, `ExtractionConfig`
- **Depends on:** E2-12 (pre-processing output consumed by orchestrator), E2-13/14/15 (individual extractors), E2-11 (claims table for DB insert)
- **Tests:** Full pipeline, deduplication, identity keys, keyword generation, config integration, edge cases
- **Done when:** Full 7-step algorithm; dedup with identity keys; keywords per Appendix F; config respected; < 200ms for 100KB
- **Estimated effort:** 3 hours

### Task E2-17: L1 Claim CRUD
- **Files:** `src/layers/L1-claim-extractor/claim-store.ts`
- **Implements:** TDD-1 Sections 4.2-4.4, 4.7
- **Types used:** `Claim`, `ClaimRow`, `Verdict`, `ClaimExtractorService`
- **Tests:** getClaimsByFile, getClaimsByRepo, getClaimById, updateVerificationStatus with all edge cases
- **Done when:** All 4 functions match signatures; ClaimRow->Claim mapping; performance targets met
- **Estimated effort:** 2 hours

### Task E2-18: L1 Re-extraction + Deletion
- **Files:** `src/layers/L1-claim-extractor/claim-store.ts`, `src/layers/L1-claim-extractor/syntactic.ts`
- **Implements:** TDD-1 Sections 4.5 (reExtract), 4.6 (deleteClaimsForFile)
- **Types used:** `Claim`, `ClaimExtractorService`, `ClaimDiff`
- **Tests:** reExtract new/unchanged/updated/removed claims, LLM claims excluded, transaction atomicity; deleteClaimsForFile count and cascade
- **Done when:** reExtract computes ClaimDiff preserving IDs; LLM claims excluded; deleteClaimsForFile cascades; < 200ms for 20/25 claims
- **Estimated effort:** 3 hours

### Task E2-19: L1 Doc File Discovery + Service Interface Assembly
- **Files:** `src/layers/L1-claim-extractor/syntactic.ts`, `src/layers/L1-claim-extractor/index.ts`
- **Implements:** TDD-1 Appendix H (discoverDocFiles), TDD-1 Section 2.2, phase4-api-contracts.md Section 3.2
- **Types used:** `ClaimExtractorService`, all L1 types
- **Tests:** discoverDocFiles patterns and exclusions; service assembly delegates correctly
- **Done when:** discoverDocFiles matches DOC_PATTERNS/DOC_EXCLUDE; service exports all 7 methods; constructor injection
- **Estimated effort:** 2 hours

## Summary

| Task | Title | Story | Effort (h) |
|------|-------|-------|:----------:|
| E2-01 | tree-sitter WASM Setup | S2.1 | 3 |
| E2-02 | Entity Extraction Queries | S2.1 | 4 |
| E2-03 | DB Migration -- code_entities + repo_files | S2.1 | 2 |
| E2-04 | File and Entity Lookup APIs | S2.1 | 3 |
| E2-05 | Route Lookup APIs | S2.1 | 3 |
| E2-06 | Dependency + Script Lookup APIs | S2.1 | 3 |
| E2-07 | Manifest Parsing | S2.1 | 4 |
| E2-08 | Semantic Search + pgvector | S2.1 | 3 |
| E2-09 | Incremental Update + Entity Diff | S2.1 | 4 |
| E2-10 | L0 Service Interface Assembly | S2.1 | 2 |
| E2-11 | DB Migration -- claims | S2.2 | 1.5 |
| E2-12 | Pre-processing + Format Detection | S2.2 | 3 |
| E2-13 | Regex: Paths + Routes | S2.2 | 3 |
| E2-14 | Regex: Commands + Versions | S2.2 | 3 |
| E2-15 | Regex: Code Examples | S2.2 | 3 |
| E2-16 | extractSyntactic Orchestrator | S2.2 | 3 |
| E2-17 | Claim CRUD | S2.2 | 2 |
| E2-18 | Re-extraction + Deletion | S2.2 | 3 |
| E2-19 | Doc Discovery + L1 Assembly | S2.2 | 2 |
| **Total** | | | **55.5** |
