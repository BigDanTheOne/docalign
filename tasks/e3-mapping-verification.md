# Epic E3: Mapping + Deterministic Verification

## Task E3-01: L7 Learning Stubs + claim_mappings + verification_results Migrations
- **Files:** `src/services/learning-service-stub.ts`, `src/db/migrations/XXX-create-claim-mappings.ts`, `src/db/migrations/XXX-create-verification-results.ts`
- **Implements:** TDD-2 Section 2.1 (L7 dependency), TDD-3 Section 2.1, phase6-epics.md E3 L7 Stubs, Appendix C (claim_mappings schema), TDD-3 Appendix G (verification_results schema)
- **Types used:** `LearningService`, `SuppressionRule`, `ClaimMapping`, `ClaimMappingRow`, `VerificationResult`, `VerificationResultRow`
- **Tests:** getCoChangeBoost returns 0.0; isClaimSuppressed returns false; stubs satisfy interface
- **Done when:** Stubs implement LearningService; migrations create both tables with indexes; all tests pass
- **Estimated effort:** 2 hours

## Task E3-02: L2 Mapper Core -- Step 1 Direct Reference (path_reference, command, dependency_version)
- **Files:** `src/services/mapper-service.ts`, `src/services/mapper/step1-direct-reference.ts`, `src/services/mapper/runner-manifest-map.ts`
- **Implements:** TDD-2 Section 4.1 (mapDirectReference), Appendix A.1-A.3, Appendix F (runner-to-manifest map), TDD2-003
- **Types used:** `Claim`, `ClaimMapping`, `ExtractedValue`, `MappingMethod`, `CodebaseIndexService`, `DependencyVersion`
- **Tests:** path_reference file exists/missing, command npm run build, dependency_version mapping, runner-manifest map coverage
- **Done when:** mapDirectReference dispatches for 3 types; RUNNER_MANIFEST_MAP matches Appendix F; returns [] for types without Step 1
- **Estimated effort:** 3 hours

## Task E3-03: L2 Mapper Core -- Step 1 Direct Reference (api_route) + code_example Step 2
- **Files:** `src/services/mapper/step1-direct-reference.ts` (modify), `src/services/mapper/step2-symbol-search.ts`
- **Implements:** TDD-2 Appendix A.4, A.5, TDD2-002, TDD2-004
- **Types used:** `Claim`, `ExtractedValue`, `CodebaseIndexService`, `RouteEntity`
- **Tests:** api_route exact/fuzzy match, fuzzy threshold 0.7, code_example import/symbol extraction
- **Done when:** api_route Step 1 with fuzzy fallback; code_example Step 2 extracts symbols; all tests pass
- **Estimated effort:** 3 hours

## Task E3-04: L2 Mapper Core -- Steps 2-3, Dedup, Co-Change Boost, Pipeline
- **Files:** `src/services/mapper/step2-symbol-search.ts`, `src/services/mapper/step3-semantic-search.ts`, `src/services/mapper/dedup-merge.ts`, `src/services/mapper/skip-classification.ts`, `src/services/mapper-service.ts`
- **Implements:** TDD-2 Section 4.1 (full mapClaim), Appendix A.6-A.7, Appendix D (dedup), Appendix E (skip), Appendix B (co-change boost), TDD2-001, TDD2-005
- **Types used:** `Claim`, `ClaimMapping`, `ClaimMappingRow`, `MappingMethod`, `CodebaseIndexService`, `LearningService`
- **Tests:** Symbol search, semantic search, dedup keeps highest confidence, co-change boost cap 1.0, pipeline runs all 3 steps, skip classification, transaction persistence
- **Done when:** mapClaim runs Steps 1-3; dedup by (code_file, code_entity_id); co-change boost applied; zero-mapping classified; persisted in transaction
- **Estimated effort:** 4 hours

## Task E3-05: L2 Reverse Index + Maintenance Operations + getEntityLineCount
- **Files:** `src/services/mapper-service.ts`
- **Implements:** TDD-2 Sections 4.2-4.7, Appendix C, Appendix H
- **Types used:** `Claim`, `ClaimMapping`, `ClaimMappingRow`, `MapperService`, `CodeEntity`
- **Tests:** findClaimsByCodeFiles, getMappingsForClaim, refreshMapping, updateCodeFilePaths (rename chain), removeMappingsForFiles, getEntityLineCount with LEFT JOIN
- **Done when:** All 6 maintenance functions implemented; full MapperService interface; all tests pass
- **Estimated effort:** 3 hours

## Task E3-06: L3 Tier 1 Verifiers -- path_reference + api_route
- **Files:** `src/services/verifier-service.ts`, `src/services/verifier/tier1-path-reference.ts`, `src/services/verifier/tier1-api-route.ts`, `src/services/verifier/similar-path.ts`
- **Implements:** TDD-3 Section 4.1, Appendix A.1, A.4, Appendix C (findSimilarPaths)
- **Types used:** `Claim`, `ClaimMapping`, `VerificationResult`, `Verdict`, `Severity`, `CodebaseIndexService`, `RouteEntity`
- **Tests:** path exists/missing/similar, similar path Levenshtein passes, api_route exact/fuzzy/no match
- **Done when:** 3-step path verification; 2-pass similar path; api_route with fallback; all tier:1 confidence:1.0
- **Estimated effort:** 3 hours

## Task E3-07: L3 Tier 1 Verifiers -- dependency_version + command
- **Files:** `src/services/verifier/tier1-dependency-version.ts`, `src/services/verifier/tier1-command.ts`, `src/services/verifier/version-comparison.ts`, `src/services/verifier/close-match.ts`
- **Implements:** TDD-3 Appendix A.3, A.2, Appendix B (version comparison)
- **Types used:** `Claim`, `VerificationResult`, `Verdict`, `Severity`, `CodebaseIndexService`, `DependencyVersion`, `ScriptInfo`
- **Tests:** Version comparison (major-only, major.minor, exact), prefix stripping, range prefixes, command exists/close match/no match
- **Done when:** compareVersions handles all 3 types; stripVersionPrefix for all prefixes; close match Levenshtein <= 2
- **Estimated effort:** 3 hours

## Task E3-08: L3 Tier 1 Verifier -- code_example + Tier 2 Shell
- **Files:** `src/services/verifier/tier1-code-example.ts`, `src/services/verifier/tier2-pattern-strategies.ts`
- **Implements:** TDD-3 Appendix A.5, Appendix D (D.1-D.5), TDD3-001
- **Types used:** `Claim`, `VerificationResult`, `Verdict`, `Severity`, `CodebaseIndexService`, `CodeEntity`
- **Tests:** All imports + symbols found, some missing, syntax validation, empty imports, Tier 2 framework check, other strategies return null, full dispatch
- **Done when:** 3 sub-checks for code_example; severity by ratio; 5 Tier 2 strategies (only D.2 non-null); correct routing
- **Estimated effort:** 4 hours

## Task E3-09: L3 Routing + Evidence Assembly
- **Files:** `src/services/verifier/routing.ts`, `src/services/verifier/evidence-builder.ts`, `src/services/verifier/evidence-formatter.ts`
- **Implements:** TDD-3 Section 4.2 (routeClaim), 4.3 (buildPath1Evidence), Appendix E, F, TDD3-002, TDD3-003
- **Types used:** `Claim`, `ClaimMapping`, `RoutingDecision`, `RoutingReason`, `VerificationPath`, `FormattedEvidence`, `CodeEntity`
- **Tests:** Routing: zero/multi-file/file-only/single entity under/over cap/multi entity/deleted entity/boundary; token estimation; evidence: highest confidence entity, imports+entity+types, formatted template
- **Done when:** routeClaim follows Appendix F decision tree; token estimation per TDD3-003; buildPath1Evidence per TDD3-002; config defaults set
- **Estimated effort:** 4 hours

## Task E3-10: L3 Result Storage + Merge + Latest
- **Files:** `src/services/verifier/result-store.ts`, `src/services/verifier-service.ts`
- **Implements:** TDD-3 Sections 4.4 (storeResult with 3C-005), 4.5 (mergeResults), 4.6 (getLatestResult)
- **Types used:** `VerificationResult`, `VerificationResultRow`, `Verdict`, `PostCheckOutcome`, `ScanRun`
- **Tests:** storeResult insert + update claims, 3C-005 downgrade, confidence reduction, idempotent, deleted claim, truncation; mergeResults dedup by tier; getLatestResult
- **Done when:** 3C-005 downgrade applied; claims updated; mergeResults prefers higher tier; getLatestResult by created_at DESC; full VerifierService interface
- **Estimated effort:** 3 hours

## Task E3-11: Cross-Layer Integration Test (L0 -> L2 -> L3)
- **Files:** `src/__tests__/integration/e3-cross-layer.test.ts`, fixture files
- **Implements:** phase6-epics.md E3 Key Deliverable 13, phase5-integration-examples.md IE-01/IE-02 intermediate outputs
- **Types used:** All L0, L2, L3 types
- **Tests:** 7 scenarios: path_reference verified, path_reference drifted, dependency_version mismatch, behavior routing, evidence assembly, architecture zero mappings, command drifted
- **Done when:** All 7 scenarios pass end-to-end with real services (no mocks between layers); L7 stubs injected; fixture repo; test DB; independently runnable
- **Estimated effort:** 4 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E3-01 | L7 Stubs + DB Migrations | 2 |
| E3-02 | Step 1: path, command, dep | 3 |
| E3-03 | Step 1: api_route + code_example | 3 |
| E3-04 | Steps 2-3 + Dedup + Pipeline | 4 |
| E3-05 | Reverse Index + Maintenance | 3 |
| E3-06 | Tier 1: path_reference + api_route | 3 |
| E3-07 | Tier 1: dependency_version + command | 3 |
| E3-08 | Tier 1: code_example + Tier 2 | 4 |
| E3-09 | Routing + Evidence Assembly | 4 |
| E3-10 | Result Storage + Merge | 3 |
| E3-11 | Cross-Layer Integration Test | 4 |
| **Total** | | **36** |

## Dependency Order
- E3-01 -> E3-02 -> E3-03 -> E3-04 -> E3-05 (L2 track)
- E3-01 -> E3-06 -> E3-07 -> E3-08 (L3 verifier track, parallel with L2)
- E3-05 -> E3-09 (routing needs getEntityLineCount)
- E3-09 -> E3-10 (storage after routing)
- E3-05 + E3-08 + E3-10 -> E3-11 (integration test last)
