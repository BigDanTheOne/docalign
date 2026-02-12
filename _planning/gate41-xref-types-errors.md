# Gate 4.1: Type & Error Code Conformance Check

> **Date:** 2026-02-11
>
> **Inputs:** `phase4-api-contracts.md` (canonical types), `phase3-error-handling.md` (error taxonomy), all 9 TDD files
>
> **Verdict:** PASS (no blocking issues)

---

## Part A: Type Conformance Summary

### Methodology

Read Section 3 ("TypeScript Interfaces") from each of the 9 TDD files and verified:
1. Each TDD explicitly states it references (not redefines) canonical types from `phase4-api-contracts.md`.
2. Section references (e.g., "Section 2.1", "Section 5.1") match the actual section numbers in the canonical document.
3. Type names and enum literal values quoted in TDDs match the canonical definitions.
4. Layer-internal types do not shadow or conflict with canonical type names.

### Canonical Types Checked

**Shared Enums (Section 1):** 15 types — `ClaimType`, `Testability`, `ExtractionMethod`, `Verdict`, `Severity`, `VerificationPath`, `PostCheckOutcome`, `MappingMethod`, `ScanType`, `TriggerType`, `ScanStatus`, `RepoStatus`, `AgentTaskType`, `AgentTaskStatus`, `FeedbackType`, `QuickPickReason`, `SuppressionScope`, `VagueClaimClassification`, `EntityType`

**Layer Data Types (Sections 2-12):** 38 interfaces — `CodeEntity`, `FileChange`, `DependencyVersion`, `RouteEntity`, `ScriptInfo`, `IndexUpdateResult`, `Claim`, `ExtractedValue`, `ClaimMapping`, `VerificationResult`, `RoutingDecision`, `RoutingReason`, `FormattedEvidence`, `ScanRun`, `DocFix`, `HealthScore`, `FileHealth`, `PRCommentPayload`, `Finding`, `GetDocsRequest`, `GetDocsResponse`, `GetDocHealthRequest`, `GetDocHealthResponse`, `ReportDriftRequest`, `ReportDriftResponse`, `ListStaleDocsRequest`, `ListStaleDocsResponse`, `FeedbackRecord`, `SuppressionRule`, `CoChangeRecord`, `AgentTask`, `AgentTaskPayload` (+ 6 payload sub-types), `AgentTaskResult`, `AgentTaskResultData` (+ 6 result sub-types), `TaskResultMetadata`, all DB Row types (12), `DocAlignError`, `DocAlignConfig`, `TokenValidation`

**Total canonical types/interfaces checked: ~70+**

### TDD Reference Counts

| TDD | Section Ref | Canonical Types Referenced | Internal Types Defined | Conformance |
|-----|-------------|--------------------------|----------------------|-------------|
| tdd-0-codebase-index | Section 2 | 7 data types + 1 service interface | 7 (`ParsedFileResult`, `ParsedEntity`, `SupportedLanguage`, `ExtensionMap`, `ParsedManifest`, `DetectedFramework`, `EntityDiff`) | PASS |
| tdd-1-claim-extractor | Section 3 | 7 data types + 1 service interface | 6 (`PreProcessedDoc`, `RawExtraction`, `ClaimDiff`, `DocChunk`, `KnownDependencies`, `ExtractionConfig`) | PASS |
| tdd-2-mapper | Section 4 | 10 data types + 3 service interfaces | 6 (`MappingCandidate`, `MergedMappings`, `MappingConfig`, `RunnerManifestMap`, `DependencyManifestResult`, `SkippedClaimRecord`) | PASS |
| tdd-3-verifier | Section 5 | 15 data types + 3 service interfaces | 7 (`SimilarPathResult`, `VersionComparison`, `PatternStrategy`, `VerifierConfig`, `CloseMatchResult`, `TokenEstimate`, `RouteAlternative`) | PASS |
| tdd-4-triggers | Section 6 | 16 data types + 7 service interfaces | 7 (`PRScanJobData`, `PushScanJobData`, `FullScanJobData`, `ClassifiedFiles`, `PrioritizedClaim`, `PipelineStage`, `RateLimitResult`) | PASS |
| tdd-5-reporter | Section 7 | 12 data types + 2 service interfaces | 6 (`ScanOutcome`, `ExistingReviewComment`, `CheckConclusion`, `SeverityBadge`, `TruncationInfo`, `PostCommentResult`) | PASS |
| tdd-6-mcp | Section 8 | 10 data types (incl. 3 DB row types) | 7 (`ResolvedRepo`, `McpServerConfig`, `DocSection`, `ClaimWithResult`, `CacheEntry`, `McpDbConnection`, `CliArgs`) | PASS |
| tdd-7-learning | Section 9 | 10 data types + 2 service interfaces | 5 (`DismissalTracker`, `QuickPickAction`, `SuppressionEvaluation`, `CoChangeAggregation`, `LearningConfig`) | PASS |
| tdd-infra | Sections 10-14 | 22 data types | 5 (`CachedInstallationToken`, `WebhookEvent`, `ServerConfig`, `DatabaseClient`, `RateLimitCheckResult`) | PASS |

**Total TDD type references checked: 109+ canonical references across 9 TDDs**

### BLOCKING Mismatches

**None found.**

### WARNINGS

| # | TDD | Issue | Severity |
|---|-----|-------|----------|
| W1 | tdd-0-codebase-index | States types are in "Section 2" -- this is correct for L0 types. No issue. | Info only |
| W2 | tdd-1-claim-extractor | States types are in "Section 3" -- correct for L1 types. No issue. | Info only |
| W3 | tdd-4-triggers | References `DOCALIGN_E405` (rate limit exceeded) which is not explicitly defined as a named scenario in `phase3-error-handling.md`, but falls under the E4xx "Internal Logic Errors" category. See Part B for details. | LOW |
| W4 | tdd-4-triggers | References `DOCALIGN_E106` (clone failure) which has no dedicated scenario playbook in `phase3-error-handling.md`, but falls under E1xx "GitHub API Errors" category. See Part B for details. | LOW |
| W5 | tdd-infra | References `DOCALIGN_E106` (JSON parse failure for webhook body) in its error table at line 298 -- this is a different usage than TDD-4's "clone failure" for the same code. The two TDDs assign different meanings to E106. | MEDIUM |

### Detail on W5 (MEDIUM)

In `tdd-infra.md` line 298, `DOCALIGN_E106` is described as "JSON parse failure" (for malformed webhook body). In `tdd-4-triggers.md` line 1289, `DOCALIGN_E106` is described as "Clone failure." These are two different error conditions sharing the same code. The canonical error taxonomy in `phase3-error-handling.md` does not define individual E1xx sub-codes beyond E101 (rate limit), E103 (token expired), E104 (permission error), E105 (signature failure), and E107 (comment too long). **Recommendation:** Assign separate sub-codes (e.g., E106 = clone failure, E108 = webhook JSON parse failure) or clarify that E106 covers both "GitHub communication failures" broadly.

---

## Part B: Error Code Summary

### Error Codes Defined in Taxonomy (`phase3-error-handling.md`)

The taxonomy defines codes by category prefix with specific sub-codes documented in scenario playbooks:

| Code | Scenario | Description |
|------|----------|-------------|
| **E1xx — GitHub API** | | |
| DOCALIGN_E101 | Scenario 8 | Rate limit mid-batch |
| DOCALIGN_E103 | Scenario 15 | Installation token expired |
| DOCALIGN_E104 | Section 6.2 | Permission error (Check Run) |
| DOCALIGN_E105 | Scenario 16 | Webhook signature failure |
| DOCALIGN_E107 | Scenario 7 | PR comment too long |
| **E2xx — Agent Task** | | |
| DOCALIGN_E201 | Scenario 1 | LLM unparseable output (bad JSON) |
| DOCALIGN_E202 | Scenario 2 | LLM wrong structured output (Zod fail) |
| DOCALIGN_E203 | Scenario 11 | Agent task timeout (30 min) |
| DOCALIGN_E204 | Scenario 12 | Late result (task expired) |
| DOCALIGN_E205 | Section 6.3 | Task already completed (conflict) |
| DOCALIGN_E206 | Scenario 14 | Dispatch 404 (Action not configured) |
| DOCALIGN_E207 | Scenario 13 | Action fails mid-execution |
| DOCALIGN_E208 | Scenario 4 | Zero claims extracted |
| DOCALIGN_E209 | Scenario 5 | No evidence found |
| DOCALIGN_E210 | Scenario 6 | Token limit mid-analysis |
| DOCALIGN_E211 | Section 6.1 | Agent exploration exceeded file limit |
| **E3xx — Database** | | |
| DOCALIGN_E301 | Scenario 9 | DB connection lost |
| DOCALIGN_E303 | Scenario 3 | Webhook idempotency / constraint violation |
| DOCALIGN_E307 | Scenario 19 | Embedding dimension mismatch (storage) |
| **E4xx — Internal Logic** | | |
| DOCALIGN_E401 | Scenario 18 | Tree-sitter parse failure |
| DOCALIGN_E404 | Scenario 10 | Concurrent webhooks same PR |
| DOCALIGN_E407 | Scenario 20 | Partial scan timeout |
| DOCALIGN_E408 | Scenario 19 | Embedding dimension mismatch (query) |
| **E5xx — Configuration** | | |
| DOCALIGN_E501 | Scenario 17 | Invalid YAML syntax |
| DOCALIGN_E502 | Scenario 17 | Invalid config value |
| **E6xx — Redis/Queue** | | |
| DOCALIGN_E601 | Section 6.2 | Redis/queue failure (referenced in Check Run messages) |

### Error Codes Used Across TDDs

| Code | TDDs Using It |
|------|---------------|
| DOCALIGN_E101 | tdd-4-triggers, tdd-5-reporter, tdd-infra |
| DOCALIGN_E103 | tdd-4-triggers, tdd-infra |
| DOCALIGN_E105 | tdd-infra |
| DOCALIGN_E106 | tdd-4-triggers (clone failure), tdd-infra (JSON parse failure) |
| DOCALIGN_E107 | tdd-5-reporter |
| DOCALIGN_E201 | tdd-infra |
| DOCALIGN_E202 | tdd-infra |
| DOCALIGN_E204 | tdd-infra |
| DOCALIGN_E205 | tdd-infra |
| DOCALIGN_E206 | tdd-4-triggers |
| DOCALIGN_E208 | tdd-1-claim-extractor |
| DOCALIGN_E301 | tdd-0, tdd-1, tdd-2, tdd-3, tdd-4, tdd-5, tdd-7, tdd-infra |
| DOCALIGN_E302 | tdd-0, tdd-1, tdd-2, tdd-3, tdd-4 |
| DOCALIGN_E303 | tdd-0, tdd-1, tdd-2, tdd-3, tdd-infra |
| DOCALIGN_E307 | (none -- only in phase3/phase4 canonical docs) |
| DOCALIGN_E401 | tdd-0, tdd-2, tdd-3, tdd-7, tdd-infra |
| DOCALIGN_E404 | tdd-4-triggers, tdd-infra |
| DOCALIGN_E405 | tdd-4-triggers |
| DOCALIGN_E407 | tdd-4-triggers |
| DOCALIGN_E408 | tdd-0, tdd-2, tdd-3 |
| DOCALIGN_E501 | tdd-1, tdd-3 |
| DOCALIGN_E502 | tdd-1 |
| DOCALIGN_E601 | tdd-4-triggers, tdd-infra |

### Codes Used in TDDs but NOT in Taxonomy

| Code | TDD(s) | Description Given | Issue |
|------|--------|-------------------|-------|
| **DOCALIGN_E106** | tdd-4-triggers, tdd-infra | Clone failure / JSON parse failure | Not defined as a named scenario in `phase3-error-handling.md`. Falls under E1xx category generically. Two TDDs use it with **different meanings**. |
| **DOCALIGN_E302** | tdd-0, tdd-1, tdd-2, tdd-3, tdd-4 | Database query timeout | Not a named scenario in phase3. Falls under E3xx category. Consistent usage across all TDDs (always "query timeout"). Implicitly defined by the E3xx prefix convention. |
| **DOCALIGN_E405** | tdd-4-triggers | Rate limit exceeded (per-repo/per-org) | Not a named scenario in phase3. Falls under E4xx category. Used only by TDD-4 for internal rate limiting (distinct from GitHub E101 rate limits). |

### Codes in Taxonomy but NOT Used by Any TDD

| Code | Taxonomy Description | Comment |
|------|---------------------|---------|
| **DOCALIGN_E104** | Permission error (GitHub) | Defined in phase3 Section 6.2 (Check Run messages). No TDD references it. Expected to be handled at the infra/API layer but not explicitly coded in any TDD's error table. |
| **DOCALIGN_E203** | Agent task timeout (30 min) | Defined in phase3 Scenario 11. Not referenced in any TDD. This is handled by the hourly cleanup job which is infra-level but not explicitly called out in `tdd-infra.md`'s error table. |
| **DOCALIGN_E207** | Action fails mid-execution | Defined in phase3 Scenario 13. Not referenced in any TDD. Handled implicitly via the task expiration mechanism (E203/E204). |
| **DOCALIGN_E209** | No evidence found | Defined in phase3 Scenario 5. Not referenced in any TDD. Handled in the result processing logic but no TDD claims ownership. |
| **DOCALIGN_E210** | Token limit mid-analysis | Defined in phase3 Scenario 6. Not referenced in any TDD. Handled by the Action side (reports error in result) but no TDD claims ownership. |
| **DOCALIGN_E211** | Agent exploration exceeded | Defined in phase3 Section 6.1. Not referenced in any TDD. Would be reported by the agent Action. |
| **DOCALIGN_E307** | Embedding dimension mismatch (storage) | Defined in phase3 Scenario 19. Not referenced in any TDD. Only E408 (query side) is referenced by TDD-0/TDD-2/TDD-3. Storage-side mismatch would surface during bulk re-index which is not a primary TDD scenario. |

---

## Overall Verdict

### Type Conformance: PASS

- All 9 TDDs explicitly state they reference (not redefine) canonical types from `phase4-api-contracts.md`.
- All section references are correct.
- All enum literal values quoted in TDDs match canonical definitions.
- All layer-internal types use unique names that do not shadow canonical types.
- No TDD redefines any canonical type differently.

### Error Code Conformance: PASS with WARNINGS

- **0 BLOCKING issues.**
- **1 MEDIUM warning:** `DOCALIGN_E106` is used with two different meanings across TDD-4 (clone failure) and TDD-infra (JSON parse failure). Needs disambiguation.
- **3 codes used in TDDs not formally in taxonomy:** E106, E302, E405. All are consistent with the category-prefix convention. E302 and E405 are used consistently. E106 has the dual-meaning issue noted above.
- **7 taxonomy codes not referenced by any TDD:** E104, E203, E207, E209, E210, E211, E307. These are either handled implicitly via other mechanisms (expiration covers E203/E207), handled by the Action side (E209/E210/E211), or expected to be caught at runtime without explicit TDD specification (E104, E307). None of these gaps are blocking -- they represent error conditions that are defined at the architecture level and will be implemented in the error handling infrastructure layer.

### Recommended Actions (Non-Blocking)

1. **Disambiguate E106:** Assign `DOCALIGN_E106` to one meaning (suggest: clone failure) and use a new code (e.g., `DOCALIGN_E108`) for webhook JSON parse failure, OR document E106 as a catch-all "GitHub communication failure" in the taxonomy.
2. **Add E302, E405 to taxonomy:** These are widely used across TDDs and should be formally listed as named sub-codes in `phase3-error-handling.md` Section 9 (Quick Reference) for completeness.
3. **Verify unused codes have owners:** E104, E203, E207, E209, E210, E211, E307 should be tagged to a specific implementation module (even if not a TDD) to ensure they are not orphaned during development.
