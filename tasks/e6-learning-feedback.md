# Epic E6: Learning + Feedback

## Task E6-1: Feedback Recording + Quick-Pick Processing
- **Files:** `src/layers/L7-learning/learning-service.ts`, `src/layers/L7-learning/feedback.ts`, `src/layers/L7-learning/quick-pick.ts`, `src/layers/L7-learning/types.ts`, `src/layers/L7-learning/index.ts`, `migrations/XXXX-create-feedback-suppression-tables.sql`
- **Implements:** TDD-7 Sections 4.1 (recordFeedback), 4.2 (processQuickPick); TDD-7 Appendix A (quick-pick taxonomy)
- **Types used:** `FeedbackRecord`, `FeedbackType`, `QuickPickReason`, `SuppressionRule`, `SuppressionScope`, `Claim`, `FeedbackRow`, `SuppressionRuleRow`
- **Tests:** recordFeedback for all types (thumbs_down, thumbs_up, all_dismissed, fix_accepted, fix_dismissed); processQuickPick for all 5 reasons with correct scope/duration; migration creates tables with indexes; duplicate quick-pick extends expiry; deleted claim returns null
- **Done when:** recordFeedback inserts for all valid types; processQuickPick creates SuppressionRule per Appendix A; migrations pass; all tests pass
- **Estimated effort:** 3 hours

## Task E6-2: Count-Based Exclusion
- **Files:** `src/layers/L7-learning/count-exclusion.ts`, `src/layers/L7-learning/learning-service.ts`
- **Implements:** TDD-7 Section 4.3 (checkCountBasedExclusion); TDD-7 Appendix B
- **Types used:** `FeedbackType`, `SuppressionRule`, `SuppressionScope`, `ClaimExtractorService`, `FeedbackRow`, `SuppressionRuleRow`
- **Tests:** 2 silent thumbs_down triggers permanent suppression; 1 doesn't trigger; all_dismissed doesn't count; thumbs_down WITH quick_pick doesn't count; fix_dismissed counts; already-excluded returns true; deleted claim returns false; L1.updateVerificationStatus called
- **Done when:** Threshold 2 silent negatives creates permanent rule; all_dismissed excluded (0x weight); L1 notified; configurable threshold
- **Estimated effort:** 2 hours

## Task E6-3: Suppression Evaluation (isClaimSuppressed)
- **Files:** `src/layers/L7-learning/suppression.ts`, `src/layers/L7-learning/learning-service.ts`
- **Implements:** TDD-7 Section 4.4 (isClaimSuppressed), 4.5 (getActiveRules); TDD-7 Appendix E (evaluation order)
- **Types used:** `Claim`, `SuppressionRule`, `SuppressionScope`, `ClaimType`, `SuppressionRuleRow`
- **Tests:** Claim/file/claim_type-level suppression; narrowest scope wins; expired rules don't suppress; revoked excluded; no rules returns false; DB failure returns false (safe default); getActiveRules filtering; batch optimization for >20 claims
- **Done when:** Evaluation in scope order per Appendix E; expired+revoked excluded; DB error returns false; batch < 500ms for 50 claims
- **Estimated effort:** 3 hours

## Task E6-4: L4 Pipeline Integration (Replace Stubs)
- **Files:** `src/layers/L4-triggers/worker.ts`, `src/layers/L2-mapper/mapper-service.ts`, `src/layers/L7-learning/learning-service.ts`
- **Implements:** TDD-7 Section 5 (integration); phase6-epics.md E6 stub replacement
- **Types used:** `LearningService`, `Claim`
- **Tests:** Suppressed claim excluded from PR comment; unsuppressed claim appears (regression); L2 calls real getCoChangeBoost (returns 0.0); DI wiring verified
- **Done when:** L4 calls real isClaimSuppressed; L2 calls real getCoChangeBoost; integration test passes
- **Estimated effort:** 2 hours

## Task E6-5: Co-Change + Confidence Skeletons (MVP Safe Defaults)
- **Files:** `src/layers/L7-learning/co-change.ts`, `src/layers/L7-learning/confidence.ts`, `src/layers/L7-learning/learning-service.ts`
- **Implements:** TDD-7 Sections 4.6 (recordCoChanges), 4.7 (getCoChangeBoost), 4.8 (getEffectiveConfidence)
- **Types used:** `LearningService`, `CoChangeRow`, `VerificationResult`
- **Tests:** recordCoChanges is no-op (returns void); getCoChangeBoost returns 0.0 for any input; getEffectiveConfidence returns raw confidence (identity function in MVP, exponential decay in v2)
- **Done when:** All 3 functions exist in LearningService; return safe defaults; full LearningService interface satisfied; unit tests pass
- **Note:** These are skeleton implementations returning safe defaults. Co-change tracking and confidence decay are v2 features. The functions must exist so the interface is complete and callers don't need conditional logic.
- **Estimated effort:** 1 hour

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E6-1 | Feedback Recording + Quick-Pick | 3 |
| E6-2 | Count-Based Exclusion | 2 |
| E6-3 | Suppression Evaluation | 3 |
| E6-4 | L4 Pipeline Integration | 2 |
| E6-5 | Co-Change + Confidence Skeletons | 1 |
| **Total** | | **11** |

## Dependencies
- E6-1 -> E6-2 -> E6-3 (sequential: feedback -> counting -> evaluation)
- E6-3 -> E6-4 (integration after evaluation works)
- E6-5 is independent (skeleton implementations, can start anytime after E6-1)
