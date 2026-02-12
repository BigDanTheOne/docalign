# Epic E7: Fix Application + Configuration

## Task E7-1: Configuration System (loadConfig + Defaults + Validation)
- **Files:** `src/config/loader.ts`, `src/config/defaults.ts`, `src/config/schema.ts`, `src/config/types.ts`, `src/config/index.ts`
- **Implements:** phase4d-config-spec.md Sections 2-5, Section 8 (precedence), Appendix B (Zod), Appendix C (loading sequence)
- **Types used:** `DocAlignConfig`, `ClaimType`, `Severity`
- **Tests:** Valid YAML parses; missing file uses defaults (GATE42-015); empty file uses defaults; invalid YAML (E501) falls back; unknown key (E502) with "did you mean?"; invalid value uses field default; type mismatch; range violation; cross-field validation (4 conflict cases); invalid regex in suppress[].pattern; multiple errors all reported; env var override; Zod strict mode
- **Done when:** loadConfig returns fully-populated DocAlignConfig; empty/absent file produces valid defaults; invalid YAML -> E501 + defaults; invalid values -> E502 + field defaults; cross-field conflicts detected; warnings collected for PR banner
- **Estimated effort:** 4 hours

## Task E7-2: Fix Endpoint -- HMAC + Confirmation Page (GET)
- **Files:** `src/server/routes/fix.ts`, `src/server/fix/hmac.ts`, `src/server/fix/confirmation-page.ts`
- **Implements:** GATE42-019, GATE42-024 (HMAC-signed URL), GATE42-025 (HMAC-only auth), GATE42-029 (GET->confirmation->POST), GATE42-028 (reject closed/merged PR)
- **Types used:** `ScanRun`, `DocFix`
- **Tests:** HMAC generation deterministic; timing-safe validation; valid HMAC returns HTML with fix count/repo/PR; security headers (X-Frame-Options: DENY, CSP: frame-ancestors 'none', Referrer-Policy: no-referrer); no third-party resources; form with hidden fields; PR state: open passes, closed/merged returns 400; scan not found returns 404 HTML; invalid HMAC returns 403
- **Done when:** generateFixHmac correct; validateFixHmac uses timingSafeEqual; GET returns confirmation HTML with security headers; PR state check works
- **Estimated effort:** 3 hours

## Task E7-3: Fix Apply + Git Trees API (POST)
- **Files:** `src/server/fix/apply.ts`, `src/server/fix/git-trees.ts`, `src/server/fix/path-validation.ts`, `src/server/routes/fix.ts` (add POST)
- **Implements:** GATE42-022 (single link), GATE42-023 (commit mechanics), GATE42-025 (HMAC-only), GATE42-028 (reject closed), GATE42-036 (>= 1 fix required); IE-04 Steps 3-6
- **Types used:** `DocFix`, `ScanRun`
- **Tests:**
  - **$-pattern safety (CRITICAL):** String.replace uses `() => fix.new_text` replacer, NOT literal second arg. Test with `$1`, `$&`, `$$`, `$'` in new_text
  - **Path traversal:** relative paths rejected, `..` rejected, symlinks resolved and validated inside repo root, absolute paths rejected, symlink-to-outside-repo rejected
  - **Fix application:** old_text found -> replaced; not found -> failedFixes
  - **Multiple fixes same file:** applied sequentially in-memory
  - **Git Trees API:** create blobs (base64), create tree (base_tree), create commit (docalign[bot] author), update ref (force: false)
  - **Fast-forward failure (422):** return error asking user to retry
  - **Comments:** success ("Applied N fixes in commit sha"), partial failure (lists applied+failed), full failure ("Could not apply")
  - **POST re-validates:** HMAC + PR state (could merge between GET and POST)
  - **Empty commit prevention:** all fixes fail -> no commit created (explicit test case)
  - **GATE42-036:** zero fixes -> no "Apply fixes" link generated (link requires >= 1 fix)
- **Done when:** POST re-validates HMAC+PR; applies fixes via Git Trees API; $-pattern safety verified; path traversal rejected (including symlinks); correct comments for all outcomes; no commit on full failure
- **Estimated effort:** 4 hours

## Task E7-4: Fix-Commit Integration Test (IE-04)
- **Files:** `src/server/fix/__tests__/ie-04-integration.test.ts`
- **Implements:** IE-04 from phase5-integration-examples.md; validates GATE42-019/022/023/025/028/029/031/036
- **Types used:** `DocFix`, `ScanRun`
- **Tests:**
  - **Scenario A (full success):** 2 fixes applied, success comment
  - **Scenario B (partial):** 1 applied, 1 failed (old_text changed), partial comment
  - **Scenario C (full failure):** both old_text changed, no commit, failure comment
  - **Scenario D (PR closed):** POST returns 400
  - **Scenario E (double-click/idempotency per GATE42-031):** second POST after first succeeds, all fixes fail, failure comment
  - **GATE42-036 scenario:** scan with zero fixes -> no "Apply fixes" link in PR comment
  - **$-pattern scenario:** at least one fix with special chars in new_text applied correctly
- **Done when:** All 5 IE-04 scenarios + GATE42-036 + $-pattern pass with mocked GitHub API
- **Estimated effort:** 3 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E7-1 | Configuration System | 4 |
| E7-2 | Fix Endpoint -- HMAC + Confirmation (GET) | 3 |
| E7-3 | Fix Apply + Git Trees API (POST) | 4 |
| E7-4 | IE-04 Integration Test | 3 |
| **Total** | | **14** |

## Dependencies
- E7-1 is independent (config system, can start early)
- E7-2 -> E7-3 -> E7-4 (sequential: GET -> POST -> integration)
- E7-3 depends on E4-08 (PR comment includes "Apply fixes" link)
