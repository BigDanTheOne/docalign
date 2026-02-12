> Part of [DocAlign PRD](../PRD.md)

## 9. Layer 5: Report & Fix Generation

### 9.1 Purpose

Present verification findings in actionable format and generate targeted fixes. This is the primary user-facing output.

### 9.2 Functional Requirements

**PR output strategy: Hybrid (summary comment + review comments)**

DocAlign uses a two-part output strategy on PRs:

1. **Summary comment** -- A single PR comment (posted via the Issues API) containing:
   - Health score line: "467 verified, 12 drifted, 3 uncertain"
   - Total findings count by severity (HIGH/MEDIUM/LOW). Finding display order: sort by severity descending (HIGH -> MEDIUM -> LOW), then by file path alphabetically, then by line number ascending. Maximum 25 findings shown in the summary comment. If more than 25: show top 25 and append "and N more findings not shown." All findings get review comments regardless of the summary truncation.
   - Table of all findings: severity, doc file, line, claim text, brief description of drift
   - Timestamp showing which push/commit SHA this scan corresponds to
   - Uncertain claims appear in a collapsible `<details>` section at the bottom of the summary: "N claims we couldn't verify (expand for details)." They do NOT get inline review comments — summary only.

2. **Review comments on specific doc file lines** -- Individual review comments posted via the Pull Request Review API (`POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`) on the specific lines in documentation files where each finding occurs. Each review comment:
   - Contains the claim text, mismatch description, and reasoning
   - Includes a GitHub suggestion block (` ```suggestion `) with the proposed fix text, enabling one-click accept
   - Supports per-comment GitHub reactions (thumbs up/down), enabling per-finding feedback collection
   - Uncertain claims do NOT get review comments (they appear only in the summary's collapsible section)

**Dismiss all link:** The summary comment includes a "Dismiss all" link pointing to the DocAlign API: `GET /api/dismiss?repo={repo_id}&pr={pr_number}&token={hmac_token}`. Clicking this link records a dismissal for all findings on this PR in the feedback table (action = 'dismiss_all'). Dismissal applies only to this PR's current findings, not future scans. The HMAC token prevents unauthorized dismissals. Dismiss-all carries 0x learning weight — it does not count toward per-claim suppression thresholds (see Spike C). Only individual per-finding thumbs-down dismissals are learning signals.

**Zero-findings behavior:** When a PR scan finds zero drifted or uncertain claims, post a GitHub Check with "passed" status AND a brief summary comment: "All N claims verified. Documentation is in sync." Always show the health score.

**Comment update strategy (on subsequent pushes):**
- On subsequent pushes to the same PR, post a NEW summary comment (do not edit the existing one). Full history of findings across pushes is preserved in the PR timeline.
- Review comments from previous pushes are NOT deleted. Findings that are no longer present in the current scan have a "(Resolved ✓)" prefix appended to the existing comment body. New findings are posted as new review comments. Each review comment includes a hidden marker (`<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->`) for tracking across pushes.
- Each summary comment includes a timestamp and commit SHA showing which push it corresponds to.

**Feedback collection (via review comments):**
- Thumbs up reaction on a review comment = finding confirmed useful (positive signal)
- Thumbs down reaction on a review comment = false positive (negative signal, suppress similar)
- GitHub suggestion accepted = fix was correct (detected via webhook `pull_request_review` events or by checking if the suggestion was applied in the next push)
- GitHub suggestion dismissed/unresolved = fix was wrong or ignored
- Feedback is recorded in the `feedback` table linked to the claim and verification result.

**Explanation prompt (on thumbs-down):**
- After a thumbs-down reaction, DocAlign replies to its own comment thread with an explanation prompt: "Why isn't this useful?" with 4 quick-picks + optional free-text
- Quick-picks: "Migration in progress" | "Doc is known-stale" | "Don't care about this check" | "Finding is wrong"
- Developer can ignore the prompt (48h timeout = silent dismissal)
- Quick-pick responses trigger deterministic corrective actions (no LLM cost)
- Free-text responses are interpreted by the AI agent (same agent as Spike B)
- See Spike C for full specification

**Fix generation:**
- Syntactic claims: deterministic fix (replace old path with new path, old version with new version)
- Semantic claims: LLM-generated fix text (from verification suggested fix)
- Each fix includes: file, line range, old text, new text, reason, confidence

**Auto-commit option (opt-in, not MVP):**
- If the repo has `.docalign.yml` with `auto_fix: true`
- Create a new commit on the PR branch with fixes
- Only auto-fix HIGH confidence fixes (confidence > 0.9)
- Commit message: `docs: fix N documentation claims detected by DocAlign`

**Health score calculation:**
- Score = verified claims / (verified claims + drifted claims)
- Uncertain claims are excluded from the health score entirely (not in numerator or denominator). They are tracked and displayed separately.
- If all claims are pending (denominator is zero), display "Scanning..." instead of a percentage.
- Health score is stored as a 0-1 decimal internally. Displayed as a percentage to users (e.g., 0.94 -> "94%").
- Health score line format: "467 verified, 12 drifted, 3 uncertain -- 94% health"
- Breakdown by file and by claim type
- Identify hotspots: files with the most drift

### 9.3 Inputs and Outputs

**Inputs:**
- Verification results (from Layer 3) -- findings with verdicts, severity, reasoning, suggested fixes
- Repo claim database (for health score)

**Outputs:**
- GitHub PR summary comment with findings overview
- GitHub review comments on specific doc file lines with suggestions
- GitHub Check Run status (see Section 9.6)
- Fix suggestions (as GitHub suggestion syntax in review comments)
- Optional auto-committed fixes (not MVP)
- Health score data

### 9.4 Performance Requirements

- PR comment should be posted within 30 seconds of verification completing
- Health score calculation: <1 second

### 9.5 Open Questions

(None currently -- this layer is well-defined.)

### 9.6 GitHub Check Run Behavior

DocAlign creates a GitHub Check Run for every PR scan to provide visibility in the PR's Checks tab.

| Event | Check Run Status | Conclusion | Summary |
|-------|-----------------|------------|---------|
| Scan starts | `in_progress` | — | "DocAlign is scanning documentation..." |
| Scan success, HIGH findings exist | `completed` | `action_required` | "Found N documentation issues (X high, Y medium, Z low). Health score: P%." |
| Scan success, only MEDIUM/LOW findings | `completed` | `neutral` | "Found N documentation issues (Y medium, Z low). Health score: P%." |
| Scan success, zero findings | `completed` | `success` | "All N claims verified. Documentation is in sync. Health score: P%." |
| Scan failure | `completed` | `failure` | "DocAlign encountered an error: [error description]" |

The Check Run name is "DocAlign".

**Check conclusion is configurable** via `.docalign.yml` `check.min_severity_to_block` (default: `high`). When set to `high`, only HIGH-severity findings trigger `action_required`; MEDIUM/LOW produce `neutral`. Set to `medium` for stricter enforcement, or set `check.conclusion_on_findings: neutral` for purely informational checks that never block.

> Technical detail: see phases/technical-reference.md Section 3.6 (DocFix interface, health score function, PR comment template)

