# Epic E4: Orchestration + PR Output (Vertical Slice)

## Task E4-01: @docalign review Comment Detection + :eyes: Reaction
- **Files:** `src/server/webhooks/issueCommentHandler.ts`
- **Implements:** TDD-4 Section 2.2, UX Specs Section 2.0 (Trigger Model), GATE42-009
- **Types used:** `PRWebhookPayload`, `TriggerService`
- **Tests:** Regex matching, :eyes: reaction, PR detail fetch, duplicate prevention, negative cases
- **Done when:** issue_comment.created routed; regex matches @docalign review; reaction added; scan enqueued; duplicates prevented
- **Estimated effort:** 3 hours

## Task E4-02: enqueuePRScan + Scan Run Lifecycle
- **Files:** `src/layers/L4/triggerService.ts`
- **Implements:** TDD-4 Section 4.1 (enqueuePRScan), 4.6 (updateScanStatus)
- **Types used:** `ScanRun`, `ScanStatus`, `TriggerType`, `TriggerService`
- **Tests:** Enqueue happy path, dedup, rate limit rejection, status transitions
- **Done when:** Creates scan_runs record, BullMQ job with dedup, rate limiting, status updates
- **Estimated effort:** 4 hours

## Task E4-03: processPRScan Pipeline Skeleton + Cancellation
- **Files:** `src/layers/L4/processors/prScanProcessor.ts`, `src/layers/L4/helpers/cancellation.ts`
- **Implements:** TDD-4 Section 4.7 (steps 1-3, cancellation, error handling), Appendix B
- **Types used:** `PRScanJobData`, `ScanRun`, `FileChange`, `ClassifiedFiles`
- **Tests:** classifyFiles, isCancelled, savePartialAndExit
- **Done when:** BullMQ worker dispatches; steps 1-3 (status, Check Run, fetch diff, classify files); cancellation checks; timeout handling; remaining steps stubbed
- **Estimated effort:** 4 hours

## Task E4-04: processPRScan Pipeline Steps (Scope through Reporting)
- **Files:** `src/layers/L4/processors/prScanProcessor.ts`, `src/layers/L4/triggerService.ts`, `src/layers/L4/helpers/prioritize.ts`
- **Implements:** TDD-4 Section 4.4 (resolveScope), 4.7 steps 4-14, Appendix B.4-B.6
- **Types used:** `Claim`, `ClaimMapping`, `VerificationResult`, `RoutingDecision`, `PRCommentPayload`, `Finding`, `HealthScore`, `AgentTask`
- **Tests:** resolveScope dedup, prioritizeClaims sorting, zero-claims short-circuit, force push, waitForAgentTasks
- **Done when:** Full pipeline steps 4-14; resolveScope; prioritizeClaims capped at 50; waitForAgentTasks polls; idempotent comment posting (3C-006)
- **Estimated effort:** 4 hours

## ~~Task E4-05: DELETED~~ (Duplicate of E3-01)
> L7 stub is implemented in E3-01. E4 receives it via constructor DI. No separate task needed.

## Task E4-06: sanitizeForMarkdown + sanitizeForCodeBlock
- **Files:** `src/layers/L5/sanitize.ts`
- **Implements:** TDD-5 Section 4.5, Appendix E
- **Types used:** None (pure utilities)
- **Tests:** XSS injection, HTML comments, null input, truncation, code block closure prevention
- **Done when:** Both functions pure, synchronous, never throw; all sanitization rules applied
- **Estimated effort:** 2 hours

## Task E4-07: calculateHealthScore
- **Files:** `src/layers/L5/reporterService.ts`
- **Implements:** TDD-5 Section 4.3, Appendix D, GATE42-032
- **Types used:** `HealthScore`, `FileHealth`, `ClaimType`
- **Tests:** Active repo, fresh repo, all verified, all drifted, empty repo
- **Done when:** Score formula verified/(verified+drifted); zero denominator handled; by_file/by_type/hotspots computed; cached in repos
- **Estimated effort:** 3 hours

## Task E4-08: postPRComment -- Summary Comment Formatting
- **Files:** `src/layers/L5/reporterService.ts`, `src/layers/L5/templates.ts`
- **Implements:** TDD-5 Section 4.1, 4.4, Appendix A, G, UX Specs Sections 2.1-2.3
- **Types used:** `PRCommentPayload`, `Finding`, `HealthScore`, `ScanRun`, `DocFix`, `Verdict`, `Severity`
- **Tests:** All 3 templates (findings, all-verified, no-claims), truncation, banners, duplicate guard, sanitization, golden output matching
- **Done when:** Correct template per outcome; findings sorted; diff blocks; "Apply all fixes" link; truncation at 65K; sanitization; idempotent; review_id=0
- **Estimated effort:** 4 hours

## Task E4-09: Check Run Creation + Update
- **Files:** `src/layers/L5/checkRun.ts`
- **Implements:** TDD-5 Appendix F, UX Specs Section 3, GATE42-003
- **Types used:** `PRCommentPayload`, `DocAlignConfig`, `CheckConclusion`
- **Tests:** success/neutral/action_required conclusions, summary templates, zero-count severity omission
- **Done when:** createCheckRun, updateCheckRun, determineCheckConclusion all work; default neutral per GATE42-003
- **Estimated effort:** 3 hours

## Task E4-10: enqueueFullScan + processFullScan Stub
- **Files:** `src/layers/L4/triggerService.ts`, `src/layers/L4/processors/fullScanProcessor.ts`
- **Implements:** TDD-4 Section 4.3, 4.9 (stubbed)
- **Types used:** `FullScanJobData`, `ScanRun`, `HealthScore`
- **Tests:** Enqueue creates scan_run, stub completes without error
- **Done when:** enqueueFullScan with timestamp jobId; stub transitions through lifecycle; no rate limit
- **Estimated effort:** 2 hours

## Task E4-11: Installation Webhook Handler + Onboarding
- **Files:** `src/server/webhooks/installationHandler.ts`
- **Implements:** TDD-4 Section 2.2, UX Specs Section 2.4
- **Types used:** `InstallationCreatedPayload`, `TriggerService`, `RepoStatus`
- **Tests:** installation.created/deleted, installation_repositories.added/removed, onboarding integration
- **Done when:** All 4 webhook events handled; repos created with onboarding status; full scans enqueued
- **Estimated effort:** 3 hours

## Task E4-12: cancelScan + Edge Cases
- **Files:** `src/layers/L4/triggerService.ts`
- **Implements:** TDD-4 Section 4.5, Appendix D, Appendix B.3
- **Types used:** `ScanRun`, `ScanStatus`
- **Tests:** Cancel queued/running/completed, non-existent, rapid-fire dedup
- **Done when:** cancelScan for queued and running; per-repo queue concurrency 1; debounce via BullMQ job ID
- **Estimated effort:** 3 hours

## Task E4-13: Vertical Slice Integration Tests (IE-01 + IE-03)
- **Files:** `tests/integration/e4-vertical-slice.test.ts`
- **Implements:** Phase 5 IE-01, IE-03, Phase 6 E4 deliverables 12-13
- **Types used:** All pipeline types
- **Tests:** IE-01 (express version drift, full pipeline, golden output), IE-03 (no claims affected, Section 2.3 template), both zero LLM calls
- **Done when:** Both IE tests pass end-to-end with fixtures; exact markdown matching; scan_runs.comment_posted=true; zero total_token_cost
- **Estimated effort:** 4 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E4-01 | @docalign review Detection | 3 |
| E4-02 | enqueuePRScan + Lifecycle | 4 |
| E4-03 | processPRScan Skeleton | 4 |
| E4-04 | Pipeline Steps (Scope-Reporting) | 4 |
| ~~E4-05~~ | ~~L7 Stub~~ (DELETED, duplicate of E3-01) | 0 |
| E4-06 | sanitizeForMarkdown | 2 |
| E4-07 | calculateHealthScore | 3 |
| E4-08 | postPRComment Formatting | 4 |
| E4-09 | Check Run | 3 |
| E4-10 | enqueueFullScan Stub | 2 |
| E4-11 | Installation + Onboarding | 3 |
| E4-12 | cancelScan + Edge Cases | 3 |
| E4-13 | IE-01 + IE-03 Integration | 4 |
| **Total** | | **39** |

## Dependencies
- E4-02 -> E4-03 -> E4-04 -> E4-08 -> E4-13 (critical path)
- E4-10 -> E4-11 (onboarding depends on enqueueFullScan)
- E3-01 provides L7 stub used by E4-03/E4-04 via DI
