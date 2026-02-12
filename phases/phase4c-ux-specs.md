# Phase 4C: UX Specifications -- All User-Facing Output

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4B/4C Supplementary Artifacts
>
> **Inputs:** tdd-5-reporter.md (Appendices A-H), tdd-6-mcp.md (Section 4), tdd-infra.md (Section 4), phase3-error-handling.md (Section 4 + 6), phase1-prd-review.md, PRD.md (Sections 1, 3)
>
> **Date:** 2026-02-11
>
> **Working title:** "DocAlign" is a placeholder name used throughout all specs. The final product name is TBD. When the name is decided, replace all occurrences of "DocAlign", "docalign", `.docalign.yml`, `@docalign`, `DOCALIGN_*` env vars, and `docalign/*` URLs across all spec files.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [PR Comment Output (Primary UX Surface)](#2-pr-comment-output-primary-ux-surface)
   - 2.1 Findings Found
   - 2.2 Zero Findings
   - 2.3 No Claims in Scope
   - 2.4 First Scan on New Repo (Onboarding)
   - 2.5 Force Push Detected
   - 2.6 Config Warnings
   - 2.7 Agent Unavailable (Action Not Configured)
   - 2.8 Partial Results (Timeout)
   - 2.9 Rate Limited Mid-Scan
   - 2.10 Error Occurred (Scan Failed)
   - 2.11 Inline Review Comments (Deferred to Post-MVP)
   - 2.12 Resolved Findings
   - 2.13 "Apply All Fixes" Commit
3. [Check Run Output](#3-check-run-output)
4. [GitHub Reactions UX](#4-github-reactions-ux)
5. [MCP Server Responses](#5-mcp-server-responses)
6. [CLI Output](#6-cli-output)
7. [Error Messages](#7-error-messages)
8. [Onboarding Experience](#8-onboarding-experience)
9. [Configuration Error Messages](#9-configuration-error-messages)
10. [Severity Badges and Sorting](#10-severity-badges-and-sorting)
11. [Health Score Display](#11-health-score-display)
12. [Sanitization Contract](#12-sanitization-contract)
13. [Comment Length and Truncation](#13-comment-length-and-truncation)

---

## 1. Design Principles

### 1.1 Tone

Professional, helpful, concise. Not robotic, not overly casual. Think GitHub-native tool -- like the output from Dependabot or CodeQL. Every message should feel like it belongs in a PR review from a knowledgeable teammate.

### 1.2 Actionable

Every message tells the user what to do next. Never present a problem without guidance. Error messages include steps to resolve. Findings include evidence and suggestions.

### 1.3 Non-Noisy / Developer-Controlled

- **Default trigger: manual.** Scans run only when a developer comments `@docalign review` on a PR. Auto-scan on push, PR open, and draft→ready are available but opt-in via `trigger` config.
- One summary comment per scan invocation. Never edit previous summary comments -- post a new one. The PR timeline preserves history.
- No inline review comments in MVP (deferred per GATE42-016). The "Apply all fixes" commit (Section 2.13) provides one-click remediation for all drifted findings. Uncertain findings are not shown in PR output.
- When a manual scan finds zero findings, a confirmation comment is still posted (the developer explicitly asked).

### 1.4 Accessible

Severity indicators use both text labels and semantic formatting for colorblind accessibility. Labels are always spelled out: `HIGH`, `MEDIUM`, `LOW`. No reliance on color emoji alone for conveying severity.

### 1.5 Security

All user-provided text in PR comments (claim text, reasoning, mismatch descriptions, evidence file paths) is sanitized via `sanitizeForMarkdown()` before inclusion. Agent-sourced text never appears inside HTML comment markers. See Section 12 for the full sanitization contract.

### 1.6 Placeholders Convention

Throughout this document, `{placeholder}` denotes dynamic values injected at render time. All placeholders are documented with their source and type.

---

## 2. PR Comment Output (Primary UX Surface)

### 2.0 Trigger Model

**Default: Manual trigger.** Scans are triggered by commenting `@docalign review` on a PR.

**Command format:** The comment must contain `@docalign review` (case-insensitive). It can appear anywhere in the comment body — the developer can add context (e.g., "Updated the auth docs, @docalign review please"). The trigger phrase is detected via regex: `/\b@docalign\s+review\b/i`.

**What happens when triggered:**

1. GitHub fires an `issue_comment.created` webhook.
2. The server checks the comment body for the trigger phrase.
3. If matched, a PR scan is created for the current HEAD commit.
4. A reaction (`:eyes:`) is added to the triggering comment to acknowledge receipt.
5. A Check Run is created (`in_progress`).
6. When the scan completes, the summary comment is posted (Sections 2.1-2.12).

**Acknowledgment reaction:** The `:eyes:` reaction on the trigger comment provides instant feedback that DocAlign received the request. No acknowledgment comment is posted — the reaction is sufficient and non-noisy.

**Opt-in auto-triggers:** The following automatic triggers are available via `trigger` config but disabled by default:

| Config Key | Default | When It Fires |
|------------|---------|---------------|
| `trigger.on_pr_open` | `false` | PR opened or reopened |
| `trigger.on_push` | `false` | Every push to a PR branch |
| `trigger.on_ready_for_review` | `false` | PR transitions from draft to ready |
| `trigger.on_command` | `true` | `@docalign review` comment (always available) |

**Initial full scan:** The installation-time full scan (Section 8) still runs automatically regardless of trigger config. It is a one-time onboarding event, not a PR trigger.

**Duplicate prevention:** If a scan is already in progress for the same PR and commit SHA, a new `@docalign review` command is ignored. The `:eyes:` reaction is still added but no duplicate scan is created.

---

### 2.1 Findings Found (1+ Drifted Claims)

**When:** The scan completes and at least one unsuppressed finding has `verdict: 'drifted'`.

**One output is posted:**
1. A **summary comment** (via GitHub Issues API) with the full report and an "Apply all fixes" link (see Section 2.13).

> **Note:** Inline review comments are deferred to post-MVP (per GATE42-016). See Section 2.11.

#### 2.1.1 Summary Comment Template

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

{agent_unavailable_banner}
{force_push_warning}
{config_warnings}

Found **{drifted_count} documentation issue(s)** in this PR:

**{verified_count} verified** | **{drifted_count} drifted** -- **{score_pct}% health**

| Severity | File | Line | Issue |
|----------|------|------|-------|
| {severity_label} | `{source_file}` | {line_number} | {brief_mismatch} |
{... additional rows ...}
{truncation_row}

---

{for_each_drifted_finding}

---

[**Apply all fixes**]({apply_fixes_url}) -- creates a commit on this PR branch with all documentation fixes.

---

Commit: `{commit_sha_short}` | Scanned at {timestamp_iso}
Repo health: {score_pct}% ({verified_count}/{scored_total} claims verified)
```

**Placeholder definitions:**

| Placeholder | Source | Type | Example |
|-------------|--------|------|---------|
| `{scan_run_id}` | `scan_runs.id` | UUID | `scan-abc-123` |
| `{agent_unavailable_banner}` | Computed; see Section 2.7 | Markdown block or empty | See Section 2.7 |
| `{force_push_warning}` | Computed; see Section 2.5 | Markdown block or empty | See Section 2.5 |
| `{config_warnings}` | Computed; see Section 2.6 | Markdown block or empty | See Section 2.6 |
| `{drifted_count}` | Count of unsuppressed drifted findings | Integer | `3` |
| `{total_checked}` | `scan_run.claims_checked` — the number of claims evaluated in this scan (not the repo-wide total) | Integer | `42` |
| `{verified_count}` | `health_score.verified` | Integer | `467` |
| `{score_pct}` | `Math.round(health_score.score * 100)` | Integer percent | `97` |
| `{severity_label}` | Finding severity, uppercased | `HIGH` / `MEDIUM` / `LOW` | `HIGH` |
| `{source_file}` | `claim.source_file` (sanitized) | File path | `README.md` |
| `{line_number}` | `claim.line_number` | Integer | `45` |
| `{brief_mismatch}` | A short (under 80 chars) human-readable summary of the mismatch, generated by the reporter from the finding data. This is NOT a raw truncation of `specific_mismatch` — it is a concise title suitable for a heading. (sanitized) | String | `Password hashing library changed` |
| `{truncation_row}` | Present only if >25 findings | Table row | `\| ... \| \| \| and 12 more findings not shown \|` |
| `{commit_sha_short}` | First 7 chars of `scan_run.commit_sha` | String | `abc123d` |
| `{timestamp_iso}` | `new Date().toISOString()` | ISO 8601 | `2026-02-11T14:23:00Z` |
| `{scored_total}` | `health_score.verified + health_score.drifted` | Integer | `479` |
| `{apply_fixes_url}` | `GET /api/fix/apply?repo={repo_id}&scan_run_id={scan_run_id}&token={hmac_token}` | URL | `https://app.docalign.dev/api/fix/apply?repo=123&scan_run_id=scan-abc-123&token=abc...` |
| `{apply_fixes_hmac}` | `HMAC-SHA256(DOCALIGN_API_SECRET, repo_id + ":" + scan_run_id)` | String | `a1b2c3...` |

**"Apply all fixes" link condition:** The "Apply all fixes" link appears only when at least one drifted finding has a generated fix (`suggested_fix` is not null). If all drifted findings lack fixes, the link is omitted.

#### 2.1.2 Individual Finding Block (Within Summary)

Each drifted finding renders as:

```markdown
### {SEVERITY}: {brief_mismatch}
**docs:** `{source_file}` line {line_number}
**claim:** "{claim_text}"
**evidence:** `{evidence_file_1}`, `{evidence_file_2}`

{reasoning}

<details>
<summary>Suggested fix</summary>

```diff
- {old_text}
+ {new_text}
```
</details>
```

- `{SEVERITY}`: Uppercased severity label (`HIGH`, `MEDIUM`, `LOW`).
- `{brief_mismatch}`: A short (under 80 chars) human-readable summary of the mismatch, generated by the reporter from the finding data. This is NOT a raw truncation of `specific_mismatch` — it is a concise title suitable for a heading. Falls back to `"Documentation drift detected"` if null.
- `{claim_text}`: Truncated to 200 characters with `"..."` suffix if exceeded.
- `{evidence_file_1}`, etc.: Each wrapped in backticks. Omit the evidence line entirely if `evidence_files` is empty.
- `{reasoning}`: Full reasoning text. Omitted entirely if null or empty.
- The `<details>` block is omitted entirely if no fix is available.
- `{old_text}` and `{new_text}` are sanitized via `sanitizeForCodeBlock()` to prevent premature code block closure.

**Finding sort order:** Severity descending (HIGH first, then MEDIUM, then LOW), then file path alphabetically, then line number ascending.

**Maximum findings shown in summary:** 25. If more than 25, the first 25 are shown, followed by:

```markdown
and {remaining_count} more findings not shown. Use "Apply all fixes" to fix all drifted documentation.
```

#### 2.1.3 Uncertain Claims

Uncertain claims (claims that could not be verified or disproved) are **not shown** in any user-facing surface: PR comments, CLI output, or Check Run summaries (per GATE42-021). They are tracked internally and available only via the MCP server (for AI agents that want full context). This keeps all developer-facing output focused on actionable findings only.

---

### 2.2 Zero Findings (All Verified)

**When:** The scan completes, all checked claims are verified, and no unsuppressed drifted or uncertain findings exist.

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

All **{total_checked} claims** verified. Documentation is in sync. :white_check_mark:

**{verified_count} verified** | **{drifted_count} drifted** -- **{score_pct}% health**

Commit: `{commit_sha_short}` | Scanned at {timestamp_iso}
```

- No review comments are posted.
- No "Dismiss all" link (nothing to dismiss).
- No feedback prompt (no review comments to react to).
- The `:white_check_mark:` emoji renders as a visual confirmation in GitHub.

---

### 2.3 No Claims in Scope

**When:** The PR does not touch any files that map to existing documentation claims, and no documentation files were changed.

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

No documentation claims are affected by the changes in this PR.

**{verified_count} verified** | **{drifted_count} drifted** -- **{score_pct}% health**

Commit: `{commit_sha_short}` | Scanned at {timestamp_iso}
Repo health: {score_pct}% ({verified_count}/{scored_total} claims verified)
```

- No review comments are posted.
- This message confirms DocAlign ran and determined the PR is out of scope.

---

### 2.4 First Scan on New Repo (Onboarding Welcome)

**When:** The initial full scan completes for a newly installed repository. This is NOT a PR comment -- it is a Check Run on the default branch HEAD commit.

See Section 8.2 for the full onboarding Check Run template.

If the first user-opened PR triggers before or after the initial scan, the PR comment follows the standard templates above (2.1, 2.2, or 2.3).

---

### 2.5 Force Push Detected

**When:** Before posting the PR comment, the worker detects that the current PR HEAD SHA differs from the SHA the scan was started against.

The following banner is prepended to the summary comment, immediately after the HTML marker line:

```markdown
> **Note:** These results are from commit `{scan_commit_sha_short}`. The PR has been updated since this scan ran.
```

- `{scan_commit_sha_short}`: First 7 chars of the commit SHA the scan ran against.
- This banner appears at the top, before the findings count or "all verified" text.
- The scan results are still posted because they are valid for the commit they ran against. Run `@docalign review` on the updated branch to get fresh results.

---

### 2.6 Config Warnings

**When:** The `.docalign.yml` file has validation issues but the scan still proceeds with defaults.

Each warning is rendered as a blockquote banner prepended after the HTML marker (and after the force push warning, if present):

#### Invalid YAML Syntax (DOCALIGN_E501)

```markdown
> **Configuration warning:** `.docalign.yml` has invalid YAML syntax. Using all default settings.
```

#### Invalid Config Value (DOCALIGN_E502)

```markdown
> **Configuration warning:** field `{field_path}` is invalid ({validation_reason}), using default value `{default_value}`.
```

- `{field_path}`: Dot-notation path to the invalid field (e.g., `verification.min_severity`).
- `{validation_reason}`: Human-readable reason (e.g., `"must be one of: high, medium, low"`).
- `{default_value}`: The default value being used instead.

Multiple E502 warnings are rendered as separate blockquotes, one per invalid field.

#### Unknown Config Key

```markdown
> **Configuration warning:** unknown key `{key_name}` in `.docalign.yml`. Did you mean `{suggestion}`?
```

- `{key_name}`: The unrecognized key.
- `{suggestion}`: The closest valid key name by edit distance, if one exists within distance 2. If no close match: omit the "Did you mean" part and end with a period after the key name.

#### Embedding Model Changed (DOCALIGN_E307/E408)

```markdown
> **Note:** Semantic search is disabled because the embedding model configuration changed. Run a full scan to re-index.
```

---

### 2.7 Agent Unavailable (Action Not Configured)

There are two distinct scenarios:

#### 2.7.1 Action Not Configured at All (DOCALIGN_E206)

**When:** The repository dispatch returns HTTP 404, meaning no Action workflow file exists.

**No PR comment is posted.** Instead, a Check Run is posted. See Section 3, conclusion `action_required`.

#### 2.7.2 Agent Timeout / Partial Unavailability (>20%)

**When:** More than 20% of agent tasks expired or failed to return results.

A prominent banner is prepended to the summary comment:

```markdown
> **Warning:** {unavailable_pct}% of claims could not be verified because the DocAlign Action did not complete in time. Check your Action configuration and LLM API key.
```

- `{unavailable_pct}`: Rounded to the nearest integer.

#### 2.7.3 Agent Timeout / Minor Unavailability (<=20%)

**When:** Some agent tasks expired but 20% or fewer.

A footer note is appended before the commit line:

```markdown
{expired_count} claim(s) could not be verified due to timeout.
```

#### 2.7.4 Action Crashed Mid-Execution (DOCALIGN_E207)

```markdown
> **Warning:** The DocAlign Action encountered an error. {completed_count} of {total_count} claims were verified.
```

#### 2.7.5 Agent Not Configured, Deterministic Only

When the Action is not configured but some deterministic (Tier 1/2) checks were possible:

```markdown
> **Note:** Agent not configured. Only syntactic checks were performed.
```

---

### 2.8 Partial Results (Scan Timeout -- DOCALIGN_E407)

**When:** The server-side scan job times out before all layers complete.

The summary comment is posted with whatever results exist, plus this note in the footer area:

```markdown
Scan timed out after verifying {verified_count} of {total_scope} claims. Remaining claims will be checked on the next push.
```

The Check Run conclusion is `neutral` (not `failure`). See Section 3.

---

### 2.9 Rate Limited Mid-Scan (DOCALIGN_E101)

**When:** GitHub API returns HTTP 429 while posting PR comments or creating commits.

The summary comment is posted with all available data (or retried when the rate limit resets). No special user-facing note is required in MVP since there are no deferred review comments.

---

### 2.10 Error Occurred (Scan Failed)

**When:** The scan fails after all retry attempts are exhausted. A temporary infrastructure issue prevents completion.

#### 2.10.1 PR Comment (If Postable)

If the error occurs late enough that a comment can be posted:

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

DocAlign encountered a temporary error scanning this PR. Run `@docalign review` to retry.

Commit: `{commit_sha_short}` | Scanned at {timestamp_iso}
```

#### 2.10.2 Check Run (Always Updated)

The Check Run is updated to `failure`. See Section 3 for exact messages per error type.

#### 2.10.3 Database Errors (DOCALIGN_E301)

If the scan fails due to a database connection issue, the Check Run summary is:

```
DocAlign encountered a temporary infrastructure issue. This PR will be rescanned automatically.
```

No internal details are exposed.

---

### 2.11 Review Comments (Deferred to Post-MVP)

Per GATE42-016, inline review comments with GitHub `suggestion` syntax are deferred to post-MVP. The most common DocAlign scenario (code changed, docs not updated) means the doc file is NOT in the PR diff, so GitHub rejects review comments on those lines. Instead, the "Apply all fixes" commit (Section 2.13) provides a one-click fix that works on any file regardless of diff scope.

---

### 2.12 Resolved Findings

**When:** A previously drifted finding is verified as correct in a subsequent scan (the developer fixed the documentation).

**No editing of old comments.** Old summary comments are left as-is. The new scan simply does not re-report the resolved finding -- its absence from the new summary comment is the resolution signal. The PR timeline preserves the history of all scans.

> **Note:** When review comments are added post-MVP, the same principle applies: old review comments are not edited or deleted.

---

### 2.13 "Apply All Fixes" Commit

When the summary comment contains drifted findings, it includes an "Apply all fixes" link at the bottom (per GATE42-019, GATE42-022). Clicking this link triggers DocAlign to create a commit on the PR branch that fixes all drifted documentation.

**URL format:** `GET /api/fix/apply?repo={repo_id}&scan_run_id={scan_run_id}&token={hmac_token}`

**HMAC:** `HMAC-SHA256(DOCALIGN_API_SECRET, repo_id + ":" + scan_run_id)` (per GATE42-024)

**Security model:** The HMAC token is the sole security layer (per GATE42-025). There is no per-user OAuth session or write-access check. Anyone who can see the PR comment can click the link.

**Flow (GET -> Confirmation Page -> POST):**
1. User clicks the "Apply all fixes" link in the PR comment (GET request).
2. Server validates HMAC token.
3. Server checks that the PR is still open (not merged or closed).
4. Server returns a confirmation HTML page showing: "Apply {N} fixes to PR #{number} on {owner}/{repo}?" with a "Confirm" button.
   - **Implementation note:** The confirmation page response MUST include these headers: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: no-referrer`. The page must not load any third-party resources (no external scripts, fonts, or analytics).
5. User clicks "Confirm" -> browser sends POST with the same query parameters.
6. Server re-validates HMAC token and re-checks PR is still open.
7. Server fetches latest PR branch state.
8. For each `DocFix` from the scan: reads current file, finds `old_text`, replaces with `new_text`.
9. Server creates a single commit via GitHub Git Trees API.
10. Server posts confirmation comment on the PR.
11. POST response shows a success page (auto-redirects to the PR after 3 seconds) or an error page.

**Commit details:**
- Author: `docalign[bot] <noreply@docalign.dev>`
- Message: `docs: fix documentation drift detected by DocAlign`
- Branch: PR head branch

**Success confirmation comment:**

```markdown
Applied {N} documentation fixes in commit `{short_sha}`.
```

**Partial failure comment (some fixes applied, some could not):**

```markdown
Applied {M} of {N} documentation fixes in commit `{short_sha}`.

{K} fix(es) could not be applied:
- `{file_path}` line {line}: target text has changed since the scan
```

**Full failure comment (no fixes could be applied):**

```markdown
Could not apply documentation fixes. The target files have changed since the scan. Run `@docalign review` to re-scan.
```

**Error: invalid/expired HMAC:**
Returns 403. No comment posted.

**Error: PR closed/merged:**
Returns 400: "This PR is no longer open. Fixes cannot be applied."

**Error: scan not found:**
Returns 404 with an HTML error page (not JSON) since the user is in a browser. The page says "Scan not found. This fix link may be invalid." with a link back to the repository. No PR comment posted.

---

## 3. Check Run Output

Check Runs are the secondary UX surface. They appear in the PR's "Checks" tab and in the commit status area.

### 3.1 Check Run Name

Always: `DocAlign`

### 3.2 Status Transitions

| Event | Status | Conclusion | Title |
|-------|--------|------------|-------|
| Scan starts | `in_progress` | -- | `DocAlign: Scanning documentation...` |
| Scan success, findings found (`block_on_findings: false`, default) | `completed` | `neutral` | `DocAlign: Found {N} documentation issue(s)` |
| Scan success, findings at/above `min_severity_to_block` (`block_on_findings: true`) | `completed` | `action_required` | `DocAlign: Found {N} documentation issue(s)` |
| Scan success, findings below block threshold (`block_on_findings: true`) | `completed` | `neutral` | `DocAlign: Found {N} documentation issue(s)` |
| Scan success, zero findings | `completed` | `success` | `DocAlign: All {N} claims verified` |
| No claims in scope | `completed` | `success` | `DocAlign: No claims in scope` |
| Scan timeout (partial) | `completed` | `neutral` | `DocAlign: Partial scan` |
| Scan failure (infra error) | `completed` | `failure` | `DocAlign: Scan failed` |
| Scan failure (permission error) | `completed` | `failure` | `DocAlign: Permission error` |
| Action not configured | `completed` | `action_required` | `DocAlign: Action setup required` |
| Initial scan in progress | `in_progress` | -- | `DocAlign: Initial scan in progress` |
| Initial scan complete | `completed` | `success` | `DocAlign: Initial scan complete` |

### 3.3 Check Run Summary Templates

#### 3.3.1 Success (Zero Findings)

```
All {total_checked} claims verified. Documentation is in sync. Health score: {score_pct}%.
```

#### 3.3.2 No Claims in Scope

```
No documentation claims are affected by this PR.
```

#### 3.3.3 Findings Found

```
Found {drifted_count} documentation issue(s) ({high_count} high, {medium_count} medium, {low_count} low). Health score: {score_pct}%.
```

Components with zero count are omitted from the parenthetical, and the count-specific noun is conditionally pluralized: `issue` for 1, `issues` for 2+. Example: `Found 3 documentation issues (1 high, 2 medium). Health score: 94%.` / `Found 1 documentation issue (1 medium). Health score: 92%.`

#### 3.3.4 Scan Failure (Infra Error -- DOCALIGN_E301, E601)

```
DocAlign encountered a temporary infrastructure issue. This PR will be rescanned automatically.
```

#### 3.3.5 Scan Failure (Permission Error -- DOCALIGN_E104)

```
DocAlign no longer has permission to access this repository. Please check the app installation.
```

#### 3.3.6 Scan Failure (Generic, All Retries Exhausted)

```
DocAlign encountered an error scanning this PR. The scan will be retried automatically.
```

#### 3.3.7 Partial Scan (DOCALIGN_E407)

```
Scan timed out. {verified_count} of {total_scope} claims verified. See PR comment for details.
```

#### 3.3.8 Action Setup Required (DOCALIGN_E206)

```
DocAlign requires the GitHub Action to be configured before it can scan documentation.

To set up:
1. Add the DocAlign Action workflow file to your repository (.github/workflows/docalign.yml)
2. Add your LLM API key as a repository secret (ANTHROPIC_API_KEY or OPENAI_API_KEY)
3. Push a commit or re-open this PR to trigger a scan

See https://docs.docalign.dev/setup for detailed instructions.
```

#### 3.3.9 Initial Scan Complete (Onboarding)

```
DocAlign scanned {doc_file_count} documentation files, found {total_claims} claims, verified {verified_count}. Health score: {score_pct}%. {drifted_count} findings detected.
```

### 3.4 Check Run Annotations

Check Run annotations are NOT used in the MVP. Line-level feedback is delivered via the summary comment finding blocks. Review comments are deferred to post-MVP (GATE42-016).

---

## 4. GitHub Reactions UX

**Deferred to post-MVP.** Reaction-based feedback (thumbs-up/down on review comments) and "Dismiss all" link are not implemented in MVP. We will instrument usage patterns first and design the feedback mechanism based on observed behavior.

For MVP, the primary feedback signals are implicit:
- **Positive signal:** Developer clicks "Apply all fixes" and the commit succeeds (fixes were helpful).
- **Negative signal:** Developer configures a `suppress` rule for a claim type or pattern (finding was unwanted).

These implicit signals are sufficient for the L7 learning system's count-based heuristics without requiring explicit user interaction.

---

## 5. MCP Server Responses

The MCP server exposes five tools to AI coding agents. All responses are JSON serialized into the MCP text content format: `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.

### 5.1 `get_docs` Response

**Success (results found):**

```json
{
  "sections": [
    {
      "file": "docs/auth.md",
      "section": "Password Hashing",
      "content": "Authentication uses argon2id with 64MB memory cost for password hashing.",
      "verification_status": "verified",
      "last_verified": "2026-02-07T14:23:00Z",
      "claims_in_section": 5,
      "verified_claims": 5,
      "health_score": 1.0
    },
    {
      "file": "README.md",
      "section": "Getting Started",
      "content": "Configure authentication by setting AUTH_SECRET in .env",
      "verification_status": "drifted",
      "last_verified": "2026-02-05T10:00:00Z",
      "claims_in_section": 3,
      "verified_claims": 1,
      "health_score": 0.33
    }
  ]
}
```

**Success (no results):**

```json
{
  "sections": []
}
```

This is NOT an error. The query simply matched no claims.

**Error (empty query):**

```json
{
  "error": {
    "code": -32602,
    "message": "query must be a non-empty string"
  }
}
```

**Error (database connection):**

```json
{
  "error": {
    "code": -32603,
    "message": "Database connection error. Check DOCALIGN_DATABASE_URL."
  }
}
```

**Error (query timeout):**

```json
{
  "error": {
    "code": -32603,
    "message": "Query timed out. Try a more specific search."
  }
}
```

### 5.2 `get_doc_health` Response

**Success (specific file):**

```json
{
  "health": {
    "total_claims": 12,
    "verified": 9,
    "drifted": 2,
    "uncertain": 1,
    "pending": 0,
    "score": 0.82,
    "by_file": {
      "README.md": { "total": 12, "verified": 9, "drifted": 2, "uncertain": 1 }
    },
    "by_type": {
      "path_reference": 4,
      "command": 3,
      "dependency_version": 2,
      "behavior": 2,
      "api_route": 1
    },
    "hotspots": ["README.md"]
  }
}
```

**Success (repo-wide, no path specified):**

```json
{
  "health": {
    "total_claims": 147,
    "verified": 120,
    "drifted": 15,
    "uncertain": 8,
    "pending": 4,
    "score": 0.89,
    "by_file": {
      "README.md": { "total": 12, "verified": 9, "drifted": 2, "uncertain": 1 },
      "docs/api.md": { "total": 45, "verified": 40, "drifted": 3, "uncertain": 2 },
      "docs/auth.md": { "total": 23, "verified": 22, "drifted": 1, "uncertain": 0 }
    },
    "by_type": {
      "path_reference": 35,
      "command": 20,
      "dependency_version": 18,
      "api_route": 25,
      "behavior": 30,
      "code_example": 10,
      "architecture": 5,
      "config": 2,
      "convention": 1,
      "environment": 1
    },
    "hotspots": ["docs/api.md", "README.md", "docs/deploy.md", "CONTRIBUTING.md", "docs/config.md"]
  }
}
```

**Success (all claims pending, no scans completed):**

```json
{
  "health": {
    "total_claims": 50,
    "verified": 0,
    "drifted": 0,
    "uncertain": 0,
    "pending": 50,
    "score": null,
    "by_file": { "README.md": { "total": 50, "verified": 0, "drifted": 0, "uncertain": 0 } },
    "by_type": { "behavior": 30, "path_reference": 20 },
    "hotspots": []
  }
}
```

When `score` is `null`, the agent should understand the repo has not been scanned yet.

**Error (path not found):**

```json
{
  "error": {
    "code": -32000,
    "message": "No documentation claims found for path 'nonexistent/file.md'."
  }
}
```

**Error (database connection):**

```json
{
  "error": {
    "code": -32603,
    "message": "Database connection error. Check DOCALIGN_DATABASE_URL."
  }
}
```

### 5.3 `list_stale_docs` Response

**Success (stale docs found):**

```json
{
  "stale_docs": [
    {
      "file": "docs/api.md",
      "drifted_claims": 3,
      "uncertain_claims": 1,
      "last_verified": "2026-02-01T10:00:00Z"
    },
    {
      "file": "README.md",
      "drifted_claims": 2,
      "uncertain_claims": 0,
      "last_verified": "2026-02-05T14:30:00Z"
    },
    {
      "file": "docs/deploy.md",
      "drifted_claims": 0,
      "uncertain_claims": 2,
      "last_verified": "2026-01-15T08:00:00Z"
    }
  ]
}
```

**Success (no stale docs):**

```json
{
  "stale_docs": []
}
```

**Error (invalid max_results):**

```json
{
  "error": {
    "code": -32602,
    "message": "max_results must be between 1 and 100"
  }
}
```

### 5.4 `report_drift` Response (v3)

**Success:**

```json
{
  "acknowledged": true,
  "claim_id": "rpt-abc123-def456"
}
```

Note: `claim_id` here is actually the `agent_drift_reports.id`, not a `claims.id`. The name is kept for API simplicity.

**Error (missing required field):**

```json
{
  "error": {
    "code": -32602,
    "message": "actual_behavior is required"
  }
}
```

**Error (feature not available in v2):**

```json
{
  "error": {
    "code": -32603,
    "message": "Drift reporting is not available in this version. Upgrade to DocAlign v3."
  }
}
```

**Error (write failure):**

```json
{
  "error": {
    "code": -32603,
    "message": "Failed to record drift report. Please try again."
  }
}
```

### 5.5 `get_docs_for_file` Response

Reverse lookup: given a code file path, returns all documentation claims that reference it. This is the primary integration point for AI coding agents — "before I change this file, what docs mention it?"

**Parameters:**
- `file_path` (string, required): Relative path to a code file (e.g., `src/auth/password.ts`).
- `include_verified` (boolean, optional, default: `true`): Whether to include verified claims or only drifted/uncertain.

**Success (claims found):**

```json
{
  "claims": [
    {
      "doc_file": "README.md",
      "line_number": 45,
      "claim_text": "Authentication uses argon2id with 64MB memory cost for password hashing.",
      "claim_type": "behavior",
      "verification_status": "verified",
      "last_verified": "2026-02-07T14:23:00Z",
      "mapping_confidence": 0.92
    },
    {
      "doc_file": "docs/auth.md",
      "line_number": 12,
      "claim_text": "Password hashing is handled in src/auth/password.ts",
      "claim_type": "path_reference",
      "verification_status": "drifted",
      "last_verified": "2026-02-05T10:00:00Z",
      "mapping_confidence": 1.0
    }
  ]
}
```

**Success (no claims reference this file):**

```json
{
  "claims": []
}
```

**Error (file not in index):**

```json
{
  "error": {
    "code": -32000,
    "message": "File 'nonexistent/file.ts' is not in the codebase index."
  }
}
```

### 5.6 MCP Server Startup Messages (stderr)

**Success:**

```
DocAlign MCP server started for {owner}/{repo} (repo_id: {repo_id})
```

**Repo not found:**

```
Error: Repository not found in DocAlign database. Is the DocAlign GitHub App installed?
```
Exit code: 1.

**Not a git repository:**

```
Error: Not a git repository: {repo_path}
```
Exit code: 1.

**No database URL:**

```
Error: No database URL configured. Set DOCALIGN_DATABASE_URL or run `docalign configure`.
```
Exit code: 1.

**Cannot parse git remote:**

```
Error: Could not parse GitHub owner/repo from remote URL: {remote_url}
```
Exit code: 1.

---

## 6. CLI Output (MVP — Primary Product Surface)

The CLI is the **primary product surface**, not an add-on. DocAlign uses an **embedded server architecture**: when you run a CLI command, an embedded server starts automatically within the process, runs the pipeline, stores results in local SQLite, and stops when the command completes. The user never sees or manages a server.

**Two operating modes:**

| Mode | Command | Server | Storage | Use Case |
|------|---------|--------|---------|----------|
| **Embedded** (default) | `docalign scan`, `docalign check`, etc. | Auto-starts, auto-stops | Local SQLite | Solo developer, quick checks |
| **Headless** (opt-in) | `docalign serve` | Persistent, accepts connections | PostgreSQL | Teams, GitHub App webhooks, shared state |

**Distribution:** Single binary via npm (`npm i -g docalign`), curl installer, Homebrew, or agent skill (Claude Code, Cursor). No Docker required for basic usage.

**GitHub App integration** requires headless mode (`docalign serve`) — it is an optional add-on for teams that want PR-triggered scanning via webhooks.

The CLI uses the same 8-layer pipeline as the server. Only the storage backend differs (SQLite vs PostgreSQL).

### 6.1 Color Scheme

| Color | Usage |
|-------|-------|
| Red (bold) | HIGH severity findings, errors, failure status |
| Yellow | MEDIUM severity findings, warnings |
| Dim/gray | LOW severity findings, informational text |
| Green | Verified claims, success status, health score > 90% |
| Cyan | File paths, claim references |
| White (bold) | Headers, summary counts |
| Reset/default | Body text |

All color output respects `NO_COLOR` and `FORCE_COLOR` environment variables (per https://no-color.org/).

### 6.2 `docalign check` -- Local Verification

Runs verification against the current working tree. Quick, single-file or targeted check.

```
$ docalign check README.md

DocAlign: Checking README.md
  Extracting claims... 12 claims found
  Verifying claims... done (3.2s)

  Results:
    9 verified   2 drifted

  HIGH  README.md:45
    Claim: "Authentication uses bcrypt with 12 salt rounds"
    Actual: Code uses argon2id, not bcrypt
    Evidence: src/auth/password.ts
    Fix: Authentication uses argon2id with 64MB memory cost for password hashing.

  MEDIUM  README.md:112
    Claim: "Run tests with npm test"
    Actual: Package.json scripts.test is "vitest run", not "npm test"
    Evidence: package.json

  2 issues found. Run `docalign fix README.md` to apply suggested fixes.
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | All claims verified (or no claims found) |
| 1 | One or more drifted findings |
| 2 | Error during check (network, config, etc.) |

### 6.3 `docalign scan` -- Full Repository Scan

Runs a complete scan with progress indicators.

```
$ docalign scan

DocAlign: Scanning repository...
  Indexing codebase.............. done (1.2s, 847 files)
  Extracting claims............. done (4.5s, 156 claims from 12 doc files)
  Mapping claims to code........ done (2.1s, 156 mappings)
  Verifying claims.............. done (45.3s, 156 verified)
    [========================================] 156/156 claims

  Repository Health: 94% (142/151 scored claims verified)

  Summary:
    142 verified   6 drifted

  Hotspots:
    docs/api.md         3 drifted
    README.md           2 drifted
    CONTRIBUTING.md     1 drifted

  Run `docalign check <file>` for details on specific files.
```

**Progress indicator:** The verification step shows a progress bar because it is the longest-running phase. Other phases show a spinner that resolves to "done" with timing.

**Exit codes:** Same as `docalign check`.

### 6.4 `docalign fix` -- Apply Fixes from Prior Scan

Applies fixes from a prior `docalign check` or `docalign scan` to local documentation files. Reads fix data from local SQLite -- no GitHub API calls are made.

**Single file:**

```
$ docalign fix README.md

DocAlign: Applying fixes to README.md
  2 fixes applied:
    Line 45: Updated express version (4.18.2 -> 4.19.0)
    Line 112: Updated test command

  Files modified: README.md
```

**All files (no argument):**

```
$ docalign fix

DocAlign: Applying all available fixes
  5 fixes applied:
    README.md:45: Updated express version (4.18.2 -> 4.19.0)
    README.md:112: Updated test command
    docs/api.md:201: Updated default pagination limit
    docs/api.md:305: Updated rate limit threshold
    CONTRIBUTING.md:88: Updated CI platform reference

  Files modified: README.md, docs/api.md, CONTRIBUTING.md
```

**No prior scan exists:**

```
$ docalign fix README.md

No scan results found. Run `docalign check README.md` first.
```

**No fixes available:**

```
$ docalign fix README.md

DocAlign: No fixes available for README.md. All claims are verified.
```

**Behavior:**
- Reads available `DocFix` records from local SQLite, stored by a prior `docalign check` or `docalign scan`.
- Applies fixes as local file writes (direct filesystem operations, no GitHub API).
- `docalign fix` (no file argument) applies all available fixes across all files.
- `docalign fix <file>` applies only fixes for the specified file.
- **Implementation note:** validate that `DocFix.file` is a relative path within the repository root. Reject paths containing `..` or absolute paths. Resolve symlinks and verify the target is within the working directory before writing.

**Partial success (some fixes applied, some target text changed):**

```
$ docalign fix

DocAlign: Applying all available fixes
  2 fixes applied:
    README.md:45: Updated express version (4.18.2 -> 4.19.0)
    README.md:112: Updated test command

  1 fix could not be applied:
    docs/api.md:201: Target text has changed since the scan. Run `docalign check` to rescan.

  Files modified: README.md
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | One or more fixes applied successfully (including partial success — some applied, some skipped) |
| 1 | No fixes available (all verified, or no scan results) |
| 2 | All fixes failed (target text changed, file write failure, corrupted scan data, etc.) |

### 6.5 `docalign status` -- Repository Health Dashboard

```
$ docalign status

DocAlign: Repository Health Dashboard

  Overall Health: 94% (142/151 scored claims verified)

  By File:
    File                    Claims  Verified  Drifted  Health
    docs/api.md               45       40        3     93%
    README.md                  23       20        2     91%
    CONTRIBUTING.md            15       14        1     93%
    docs/auth.md               23       23        0    100%
    docs/deploy.md             18       18        0    100%
    ... (7 more files, all 100%)

  By Type:
    path_reference:    35 claims (34 verified, 1 drifted)
    behavior:          30 claims (28 verified, 2 drifted)
    command:           20 claims (18 verified, 2 drifted)
    dependency_version: 18 claims (17 verified, 1 drifted)
    api_route:         25 claims (25 verified)
    ... (5 more types, all verified)

  Last scan: 2026-02-11T14:23:00Z (2 hours ago)
```

### 6.6 `docalign serve` -- Headless Server Mode

Starts a persistent server for team use and GitHub App integration.

```
$ docalign serve --port 3000

DocAlign server listening on http://127.0.0.1:3000
  Database: postgresql://localhost:5432/docalign
  Webhooks: ready
  Press Ctrl+C to stop.
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `3000` | HTTP port |
| `--hostname` | `127.0.0.1` | Bind address (use `0.0.0.0` for external access) |
| `--database-url` | `$DOCALIGN_DATABASE_URL` | PostgreSQL connection string |

**Requirements:** Headless mode requires PostgreSQL (unlike embedded mode which uses SQLite). If `--database-url` is not provided and `DOCALIGN_DATABASE_URL` is not set:

```
Error: Headless mode requires a PostgreSQL database.

Set DOCALIGN_DATABASE_URL or pass --database-url. For local use without a database, run `docalign scan` instead.
```

### 6.7 `docalign connect` -- Link CLI to Server (Optional)

Links the local CLI to a running headless server for shared state.

```
$ docalign connect http://localhost:3000

Connected to DocAlign server at http://localhost:3000.
CLI commands will now use the server's database.
Run `docalign disconnect` to return to local mode.
```

After connecting, `docalign scan`, `docalign check`, etc. send requests to the server instead of running the embedded pipeline. This enables shared state between CLI users and the GitHub App.

### 6.8 Error Output (CLI)

All CLI errors print to stderr in a consistent format:

```
Error: {message}

{guidance}
```

Examples:

```
Error: LLM API key not configured.

Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment, or configure it in .docalign.yml.
```

```
Error: Could not connect to server at http://localhost:3000.

Is the server running? Start it with `docalign serve`. Or run `docalign disconnect` to use local mode.
```

---

## 7. Error Messages

Every user-facing error is specified here with its exact text, location, and guidance. Errors reference `DOCALIGN_E###` codes for traceability to Phase 3C scenario playbooks.

### 7.1 PR Summary Comment Error Messages

These are internal error conditions that result in claims being marked as uncertain. Per GATE42-021, uncertain claims are hidden from all user-facing surfaces. These error messages are logged internally for debugging but not shown to users in PR comments or CLI output. The MCP server may expose them to AI agents.

| Code | Context | Exact Message (internal, not user-facing) |
|------|---------|-----------------------------------------------------|
| DOCALIGN_E201 | LLM returned unparseable JSON | `Could not verify this claim (analysis returned invalid output).` |
| DOCALIGN_E202 | LLM returned invalid schema | `Could not verify this claim (analysis returned incomplete data).` |
| DOCALIGN_E203 | Agent task timed out (30 min) | `Verification timed out. The DocAlign Action did not respond within the time limit.` |
| DOCALIGN_E208 | Zero claims extracted from doc files | `No verifiable claims found in the changed documentation files.` |
| DOCALIGN_E209 | No evidence files found | `Insufficient evidence to verify this claim.` |
| DOCALIGN_E210 | LLM token limit exceeded | `Claim analysis exceeded model context limits.` |
| DOCALIGN_E211 | Agent exploration limit exceeded | `Verification scope too broad (exceeded file exploration limit). Claim marked as uncertain.` |
| DOCALIGN_E407 | Scan timed out | `Scan timed out after verifying {N} of {M} claims. Remaining claims will be checked on the next push.` |

### 7.2 PR Summary Comment Banner Messages

These appear as blockquote banners at the top of the summary comment.

| Code / Condition | Exact Banner Text |
|-----------------|-------------------|
| DOCALIGN_E501 | `> **Configuration warning:** \`.docalign.yml\` has invalid YAML syntax. Using all default settings.` |
| DOCALIGN_E502 | `> **Configuration warning:** field \`{field}\` is invalid ({reason}), using default value \`{default}\`.` |
| DOCALIGN_E307/E408 | `> **Note:** Semantic search is disabled because the embedding model configuration changed. Run a full scan to re-index.` |
| Agent unavailable >20% | `> **Warning:** {N}% of claims could not be verified because the DocAlign Action did not complete in time. Check your Action configuration and LLM API key.` |
| Agent crash (E207) | `> **Warning:** The DocAlign Action encountered an error. {N} of {M} claims were verified.` |
| Agent not configured (deterministic only) | `> **Note:** Agent not configured. Only syntactic checks were performed.` |
| Rate limit deferral (E101) | Not applicable in MVP (no review comments). Summary comment posting is retried on rate limit reset. |
| Force push detected | `> **Note:** These results are from commit \`{sha}\`. The PR has been updated since this scan ran.` |
| Comment truncated (E107) | `Showing {N} of {total} findings. Use "Apply all fixes" to fix all drifted documentation.` |

### 7.3 Check Run Error Messages

| Code(s) | Conclusion | Title | Summary |
|----------|-----------|-------|---------|
| DOCALIGN_E206 | `action_required` | `DocAlign: Action setup required` | Setup instructions (see Section 3.3.8) |
| DOCALIGN_E301, E601 | `failure` | `DocAlign: Temporary error` | `DocAlign encountered a temporary infrastructure issue. This PR will be rescanned automatically.` |
| DOCALIGN_E104 | `failure` | `DocAlign: Permission error` | `DocAlign no longer has permission to access this repository. Please check the app installation.` |
| DOCALIGN_E407 | `neutral` | `DocAlign: Partial scan` | `Scan timed out. {N} of {M} claims verified. See PR comment for details.` |
| All retries exhausted | `failure` | `DocAlign: Scan failed` | `DocAlign encountered an error scanning this PR. The scan will be retried automatically.` |
| DOCALIGN_E103 (token refresh fail) | `failure` | `DocAlign: Authentication error` | `DocAlign could not authenticate with GitHub. Please check your app installation.` |

### 7.4 HTTP API Error Responses (Agent Task API)

All API errors return JSON with this structure:

```json
{
  "error": "DOCALIGN_EXXX",
  "message": "Human-readable description."
}
```

| Endpoint | HTTP Status | Code | Message |
|----------|------------|------|---------|
| `POST /api/tasks/{id}/result` | 400 | DOCALIGN_E201 | `Result data is not valid JSON. Retry with valid JSON.` |
| `POST /api/tasks/{id}/result` | 400 | DOCALIGN_E202 | `Result validation failed. See \`details\` for specific field errors.` |
| `POST /api/tasks/{id}/result` | 404 | -- | `Task not found.` |
| `POST /api/tasks/{id}/result` | 409 | DOCALIGN_E205 | `Task already completed by another Action run.` |
| `POST /api/tasks/{id}/result` | 410 | DOCALIGN_E204 | `Task has expired. Result rejected.` |
| `GET /api/tasks/pending` | 401 | -- | `Invalid or missing DOCALIGN_TOKEN.` |
| `GET /api/tasks/pending` | 403 | -- | `Token does not have access to this repository.` |
| `POST /webhook` | 401 | DOCALIGN_E105 | *(No response body. HTTP 401 only.)* |
| `GET /api/dismiss` | 400 | -- | `Invalid or expired dismiss token.` |
| `GET /api/dismiss` | 404 | -- | `Scan not found.` |

### 7.5 Health Endpoint Response

```json
{
  "status": "ok",
  "redis": true,
  "queue_depth": 5,
  "active_jobs": 2,
  "waiting_jobs": 3,
  "uptime_seconds": 86400
}
```

Degraded state (Redis unavailable):

```json
{
  "status": "degraded",
  "redis": false,
  "queue_depth": 0,
  "active_jobs": 0,
  "waiting_jobs": 0,
  "uptime_seconds": 3600
}
```

HTTP 200 for `status: "ok"`, HTTP 503 for `status: "degraded"`.

### 7.6 MCP Server Error Messages

| Condition | JSON-RPC Code | Message |
|-----------|--------------|---------|
| Missing required parameter | `-32602` | `{param} is required` |
| Invalid parameter value | `-32602` | `{param} must be {constraint}` |
| Database connection failure | `-32603` | `Database connection error. Check DOCALIGN_DATABASE_URL.` |
| Database query timeout | `-32603` | `Query timed out. Try a more specific search.` |
| Internal database error | `-32603` | `Internal database error.` |
| Repo not found in DB | `-32000` | `Repository not found in DocAlign database.` |
| No claims for path | `-32000` | `No documentation claims found for path '{path}'.` |
| Write not available (v2) | `-32603` | `Drift reporting is not available in this version.` |
| Write failure | `-32603` | `Failed to record drift report. Please try again.` |

---

## 8. Onboarding Experience

### 8.1 Installation Flow

**Step 1: User installs the DocAlign GitHub App from the GitHub Marketplace.**

No immediate visible output. The `installation.created` webhook fires. The server creates `repos` records.

**Step 2: Server detects whether the GitHub Action is configured.**

The server attempts a repository dispatch. If the dispatch returns 404, the Action is not configured.

**Step 3a: Action IS configured -- Full scan begins.**

A Check Run is created on the default branch HEAD:

| Field | Value |
|-------|-------|
| Name | `DocAlign` |
| Status | `in_progress` |
| Title | `DocAlign: Initial scan in progress` |
| Summary | `DocAlign is performing its initial scan of your documentation. This may take a few minutes.` |

**Step 3b: Action is NOT configured -- Setup instructions posted.**

A Check Run is created on the default branch HEAD:

| Field | Value |
|-------|-------|
| Name | `DocAlign` |
| Status | `completed` |
| Conclusion | `action_required` |
| Title | `DocAlign: Action setup required` |
| Summary | See Section 3.3.8 template |

### 8.2 Initial Scan Completion

When the full onboarding scan completes, the Check Run is updated:

| Field | Value |
|-------|-------|
| Status | `completed` |
| Conclusion | `success` |
| Title | `DocAlign: Initial scan complete` |
| Summary | See below |

**Summary template:**

```
DocAlign scanned {doc_file_count} documentation files, found {total_claims} claims, verified {verified_count}. Health score: {score_pct}%. {drifted_count} findings detected.

{if drifted_count > 0:}
Top issues:
{for top 5 drifted findings:}
- {source_file}:{line_number} -- {brief_mismatch}
{end for}

Open a PR to see detailed findings with fix suggestions.
{end if}

{if drifted_count == 0:}
Your documentation is in great shape! DocAlign will alert you when docs drift on future PRs.
{end if}
```

### 8.3 Initial Scan Failure

If the initial scan fails after all retries:

| Field | Value |
|-------|-------|
| Status | `completed` |
| Conclusion | `failure` |
| Title | `DocAlign: Initial scan failed` |
| Summary | `DocAlign encountered an error during the initial scan. It will retry automatically. If the issue persists, check your Action configuration and LLM API key.` |

### 8.4 First PR After Installation

The first PR opened after the GitHub App is installed will receive a standard scan comment (Section 2.1, 2.2, or 2.3 depending on findings) with a **one-time welcome line** prepended after the HTML marker:

```markdown
> **Welcome to DocAlign!** We verify your documentation against your code and flag drift. This is your first scan -- [learn more](https://docs.docalign.dev/getting-started).
```

This welcome line appears only on the very first PR comment for this repository (tracked via `repos.first_pr_comment_posted` flag). Subsequent PR comments use the standard templates without the welcome line.

If the PR arrives before the initial scan completes, it is queued behind the initial scan (per-repo job lock). The PR scan begins after the initial scan finishes.

### 8.5 Setup Instructions (Action Workflow File)

When the setup instructions are shown (in Check Run summary or docs), the recommended workflow file is:

```yaml
# .github/workflows/docalign.yml
name: DocAlign
on:
  repository_dispatch:
    types: [docalign-scan]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: docalign/agent-action@v1
        with:
          token: ${{ secrets.DOCALIGN_TOKEN }}
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

This content is referenced in the Check Run summary link to `https://docs.docalign.dev/setup`.

---

## 9. Configuration Error Messages

All configuration errors produce warnings in the PR summary comment (never failures). The scan always continues with resolved defaults.

### 9.1 Invalid YAML Syntax (DOCALIGN_E501)

**Trigger:** `.docalign.yml` cannot be parsed as YAML.

**Exact message (PR comment banner):**

```markdown
> **Configuration warning:** `.docalign.yml` has invalid YAML syntax. Using all default settings.
```

**Where:** PR summary comment, as a blockquote banner after the HTML marker.

**What the user should do:** Fix the YAML syntax in `.docalign.yml`. Common issues: incorrect indentation, missing colons, unquoted special characters.

### 9.2 Unknown Config Key

**Trigger:** A key in `.docalign.yml` is not recognized by the schema.

**Exact message (PR comment banner) -- with suggestion:**

```markdown
> **Configuration warning:** unknown key `verifcation` in `.docalign.yml`. Did you mean `verification`?
```

**Exact message (PR comment banner) -- without suggestion (no close match):**

```markdown
> **Configuration warning:** unknown key `foobar` in `.docalign.yml` (ignored).
```

**Where:** PR summary comment banner.

**What the user should do:** Check key spelling against the configuration reference at `https://docs.docalign.dev/config`.

**Suggestion logic:** Compute Levenshtein distance between the unknown key and all valid keys. If a valid key is within edit distance 2, suggest it. Otherwise, omit the suggestion.

### 9.3 Invalid Value (DOCALIGN_E502)

**Trigger:** A config value fails schema validation (wrong type, out of range, invalid enum).

**Examples:**

Severity field with invalid value:
```markdown
> **Configuration warning:** field `verification.min_severity` is invalid (must be one of: high, medium, low), using default value `medium`.
```

Number field with wrong type:
```markdown
> **Configuration warning:** field `verification.max_claims_per_pr` is invalid (must be a positive integer), using default value `50`.
```

Boolean field with string value:
```markdown
> **Configuration warning:** field `check.block_on_findings` is invalid (must be true or false), using default value `false`.
```

**Where:** PR summary comment banner. Multiple invalid fields produce multiple banners.

**What the user should do:** Check the field type and valid values in the configuration reference.

### 9.4 Deprecated Config Key

**Trigger:** A config key has been renamed or deprecated in a newer version.

```markdown
> **Configuration warning:** key `severity_threshold` is deprecated. Use `verification.min_severity` instead.
```

**Where:** PR summary comment banner.

---

## 10. Severity Badges and Sorting

### 10.1 Badge Format

| Severity | Summary Table Column | Review Comment Header | Finding Block Header |
|----------|---------------------|----------------------|---------------------|
| `high` | `HIGH` | `**DocAlign: HIGH**` | `### HIGH: {mismatch}` |
| `medium` | `MEDIUM` | `**DocAlign: MEDIUM**` | `### MEDIUM: {mismatch}` |
| `low` | `LOW` | `**DocAlign: LOW**` | `### LOW: {mismatch}` |

No color emoji is used. Severity is communicated through text labels only, ensuring accessibility for colorblind users. GitHub's native markdown rendering provides sufficient visual weight through bold formatting and heading levels.

### 10.2 Sort Order

Findings are sorted in all contexts (summary table, finding blocks, review comment posting order) by:

1. **Severity descending:** HIGH (first) -> MEDIUM -> LOW (last)
2. **File path alphabetically:** A -> Z
3. **Line number ascending:** lowest first

### 10.3 Null Severity Handling

If `result.severity` is null (should not occur for drifted findings), default to `LOW` for sorting purposes and display as `LOW` in all badges.

---

## 11. Health Score Display

### 11.1 Formula

```
score = verified / (verified + drifted)
```

- Uncertain and pending claims are excluded from both numerator and denominator.
- Range: 0 to 1 (stored internally as decimal).
- Display: Percentage rounded to nearest integer (e.g., `0.9749` -> `97%`).

### 11.2 Health Line Format

Used in summary comments:

```
**{verified} verified** | **{drifted} drifted** -- **{score_pct}% health**
```

Example: `**467 verified** | **12 drifted** -- **97% health**`

### 11.3 Zero Denominator

When `verified + drifted = 0` (all claims are pending or uncertain):

- Display: `Scanning...` instead of a percentage.
- Health line: `**0 verified** | **0 drifted** -- **Scanning...**`

### 11.4 Footer Health Format

Used in the summary comment footer:

```
Repo health: {score_pct}% ({verified}/{scored_total} claims verified)
```

Example: `Repo health: 97% (467/479 claims verified)`

---

## 12. Sanitization Contract

### 12.1 `sanitizeForMarkdown()` -- General Text

Applied to all agent-sourced strings before inclusion in PR comments: `claim_text`, `reasoning`, `specific_mismatch`, `suggested_fix`, `evidence_files` paths.

| Rule | Pattern | Replacement | Reason |
|------|---------|-------------|--------|
| JavaScript URL | `/javascript:/gi` | `''` (remove) | Prevent URL injection |
| Data URL | `/data:/gi` | `''` (remove) | Prevent data URL injection |
| VBScript URL | `/vbscript:/gi` | `''` (remove) | Prevent VBScript injection |
| Script open tag | `/<script[\s>]/gi` | `'&lt;script '` | Prevent HTML injection |
| Script close tag | `/<\/script>/gi` | `'&lt;/script&gt;'` | Prevent HTML injection |
| Iframe tag | `/<iframe/gi` | `'&lt;iframe'` | Prevent embed injection |
| Object tag | `/<object/gi` | `'&lt;object'` | Prevent embed injection |
| Embed tag | `/<embed/gi` | `'&lt;embed'` | Prevent embed injection |
| Form tag | `/<form/gi` | `'&lt;form'` | Prevent form injection |
| HTML comment open | `/<!--/g` | `'&lt;!--'` | Prevent marker manipulation |
| HTML comment close | `/-->/g` | `'--&gt;'` | Prevent marker manipulation |
| Max length | `.length > 5000` | Truncate to 4997 + `"..."` | Prevent overflow |

Does NOT escape standard markdown characters (`*`, `_`, `#`, backticks). These are valid and expected in PR comments.

### 12.2 `sanitizeForCodeBlock()` -- Suggestion Blocks

Applied to text inside ` ```suggestion ``` ` and ` ```diff ``` ` blocks.

| Rule | Pattern | Replacement | Reason |
|------|---------|-------------|--------|
| Triple backtick | ` ``` ` | `` ` ` ` `` (space-separated) | Prevent premature code block closure |
| Max length | `.length > 10000` | Truncate to 9997 + `"..."` | Prevent oversized suggestions |

### 12.3 What Is NOT Sanitized

- DocAlign's own template text (headers, labels, markers).
- UUIDs from the database (used in markers).
- Numeric values (counts, line numbers, percentages).
- Fixed strings (severity labels, status text).

---

## 13. Comment Length and Truncation

### 13.1 GitHub Limits

| Item | Character Limit |
|------|----------------|
| Issue/PR comment body | 65,535 |
| Review comment body | 65,535 |
| Check Run summary | 65,535 |
| Check Run title | 255 |

### 13.2 Summary Comment Truncation (DOCALIGN_E107)

**Threshold:** 65,000 characters (leaving margin for encoding).

**Strategy when exceeded:**

1. Keep: header, HTML marker, banners, health line, findings summary table (up to 25 rows).
2. Remove: individual finding detail blocks, starting from the lowest severity.
3. Append truncation note:

```markdown
---

Showing partial results. Use "Apply all fixes" to fix all drifted documentation.
```

4. If even the table exceeds the limit (extremely unlikely):

```markdown
(Truncated due to size. Use "Apply all fixes" to fix all drifted documentation.)
```

### 13.3 Review Comment Truncation (Deferred)

Review comments are deferred to post-MVP (GATE42-016). This section is reserved for future specification.

### 13.4 Finding Table Truncation

The summary table shows a maximum of 25 rows. If more than 25 drifted findings exist:

| Severity | File | Line | Issue |
|----------|------|------|-------|
| ... | | | and {N} more findings not shown |

Where `{N}` is `total_drifted - 25`.

---

## Appendix A: Complete Summary Comment Example (Findings Found)

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id=scan-abc-123 -->

Found **3 documentation issue(s)** in this PR:

**467 verified** | **3 drifted** -- **99% health**

| Severity | File | Line | Issue |
|----------|------|------|-------|
| HIGH | `README.md` | 45 | Password hashing library changed |
| MEDIUM | `CONTRIBUTING.md` | 88 | CI platform changed from CircleCI to GitHub Actions |
| LOW | `docs/api.md` | 201 | Default pagination limit changed |

---

### HIGH: Password hashing library changed
**docs:** `README.md` line 45
**claim:** "Authentication uses bcrypt with 12 salt rounds"
**evidence:** `src/auth/password.ts`

Code uses argon2id, not bcrypt. The password.ts file imports argon2 and configures it with 64MB memory cost.

<details>
<summary>Suggested fix</summary>

```diff
- Authentication uses bcrypt with 12 salt rounds
+ Authentication uses argon2id with 64MB memory cost for password hashing.
```
</details>

---

### MEDIUM: CI platform changed from CircleCI to GitHub Actions
**docs:** `CONTRIBUTING.md` line 88
**claim:** "The CI pipeline runs on CircleCI"
**evidence:** `.github/workflows/ci.yml`

Repository uses GitHub Actions, not CircleCI. The .github/workflows/ci.yml file defines the CI pipeline.

---

### LOW: Default pagination limit changed
**docs:** `docs/api.md` line 201
**claim:** "API returns 20 items per page by default"
**evidence:** `src/api/middleware/pagination.ts`

Default page size is configured as 25 in pagination middleware, not 20.

<details>
<summary>Suggested fix</summary>

```diff
- API returns 20 items per page by default
+ API returns 25 items per page by default
```
</details>

---

[**Apply all fixes**](https://app.docalign.dev/api/fix/apply?repo=repo-001&scan_run_id=scan-abc-123&token=a1b2c3d4e5f6) — creates a commit on this PR with all documentation fixes.

---

Commit: `abc123d` | Scanned at 2026-02-11T14:23:00Z
Repo health: 99% (467/470 claims verified)
```

---

## Appendix B: Review Comment Example (Deferred to Post-MVP)

Per GATE42-016, inline review comments are deferred to post-MVP. This appendix is preserved for future specification. See Section 2.11 for context.

---

## Appendix C: Review Comment Example Without Suggestion (Deferred to Post-MVP)

Per GATE42-016, inline review comments are deferred to post-MVP. This appendix is preserved for future specification.

---

## Appendix D: Resolved Comment Example (Deferred to Post-MVP)

Per GATE42-016, inline review comments are deferred to post-MVP. Resolved-finding UX will be specified when review comments are implemented. For MVP, resolution is signaled by the absence of a finding from the new scan's summary comment (see Section 2.12).

The entire original body (minus the original marker) is wrapped in `~~strikethrough~~`. The marker is updated with the `resolved-by` attribute.

---

## Appendix E: Scenario-to-UX Mapping

This table maps every Phase 3C error scenario to its user-facing UX output, confirming complete coverage.

| Scenario | Code | PR Comment | Check Run | Review Comment | API Response | MCP Error |
|----------|------|-----------|-----------|----------------|-------------|-----------|
| 1: LLM unparseable output | E201 | Hidden (GATE42-021) | -- | N/A (deferred) | HTTP 400 | -- |
| 2: LLM wrong schema | E202 | Hidden (GATE42-021) | -- | N/A (deferred) | HTTP 400 | -- |
| 3: Webhook idempotency | E303 | None (transparent) | -- | N/A (deferred) | -- | -- |
| 4: Zero claims extracted | E208 | "No verifiable claims" note | -- | N/A (deferred) | -- | -- |
| 5: No evidence found | E209 | Hidden (GATE42-021) | -- | N/A (deferred) | -- | -- |
| 6: Token limit | E210 | Hidden (GATE42-021) | -- | N/A (deferred) | -- | -- |
| 7: Comment too long | E107 | Truncation note | -- | N/A (deferred) | -- | -- |
| 8: Rate limit mid-batch | E101 | Retry (transparent) | -- | N/A (deferred) | -- | -- |
| 9: DB connection lost | E301 | Retry note or none | `failure` | N/A (deferred) | -- | -- |
| 10: Concurrent webhooks | E404 | None (transparent) | -- | N/A (deferred) | -- | -- |
| 11: Agent timeout 30m | E203 | Hidden (GATE42-021) + banner | -- | N/A (deferred) | -- | -- |
| 12: Late result (410) | E204 | None (already handled) | -- | N/A (deferred) | HTTP 410 | -- |
| 13: Action crash | E207 | Partial banner | -- | N/A (deferred) | -- | -- |
| 14: No Action configured | E206 | None (Check Run only) | `action_required` | N/A (deferred) | -- | -- |
| 15: Token expired | E103 | None (transparent) or auth error | `failure` (if refresh fails) | N/A (deferred) | -- | -- |
| 16: Webhook signature fail | E105 | None | -- | N/A (deferred) | HTTP 401 | -- |
| 17: Invalid YAML | E501 | Config warning banner | -- | N/A (deferred) | -- | -- |
| 17: Invalid config value | E502 | Config warning banner | -- | N/A (deferred) | -- | -- |
| 18: Tree-sitter failure | E401 | None (transparent) | -- | N/A (deferred) | -- | -- |
| 19: Embedding mismatch | E307/E408 | Note banner | -- | N/A (deferred) | -- | -- |
| 20: Partial timeout | E407 | Timeout footer note | `neutral` | N/A (deferred) | -- | -- |

---

## Appendix F: Hidden Marker Reference

All hidden markers use HTML comments that are invisible to users in GitHub's rendered markdown.

### F.1 Summary Comment Marker

```html
<!-- docalign-summary scan-run-id={scan_run_id} -->
```

Purpose: Deduplication (prevent posting the same summary twice), identification (which scan produced this comment).

### F.2 Review Comment Marker (Deferred to Post-MVP)

```html
<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->
```

Purpose: Feedback tracking (map reactions to claims), resolved detection (match claims across scans), deduplication. Not used in MVP (review comments deferred per GATE42-016).

### F.3 Resolved Comment Marker (Deferred to Post-MVP)

```html
<!-- docalign-review-comment claim-id={claim_id} scan-run-id={original_scan_run_id} resolved-by={resolving_scan_run_id} -->
```

Purpose: Track which scan resolved the finding. Prevent re-resolving already-resolved comments. Not used in MVP (review comments deferred per GATE42-016).

### F.4 Marker Security

- Markers are generated from trusted data only (database UUIDs).
- Agent-sourced text never appears inside markers.
- The `sanitizeForMarkdown()` function escapes `<!--` and `-->` in agent text to prevent marker injection.

---

## Appendix G: Cross-Reference to Source Documents

| Section | Primary Source |
|---------|---------------|
| 2.1-2.3 Summary Comment Templates | TDD-5 Appendix A (A.1-A.5) |
| 2.11 Review Comments (Deferred) | TDD-5 Appendix B (B.1-B.3) — deferred per GATE42-016 |
| 2.12 Resolved Format | TDD-5 Section 4.2, Appendix B (B.3) |
| 2.13 "Apply All Fixes" Commit | GATE42-019, GATE42-022, GATE42-023, GATE42-024 |
| 3 Check Run Output | TDD-5 Appendix F (F.1-F.3) |
| 4 Reactions UX | TDD-7 (feedback signals), TDD-5 Appendix A footer |
| 5 MCP Responses | TDD-6 Section 4 (4.1-4.4), Appendix A, Appendix D |
| 7 Error Messages | Phase 3C Section 4 (Scenarios 1-20), Section 6 |
| 8 Onboarding | PRD Section 3, TDD-Infra Section 4.1, TDD-4 Section 4.7 |
| 9 Config Errors | Phase 3C Scenario 17 (E501/E502) |
| 10 Severity Badges | TDD-5 Appendix C |
| 11 Health Score | TDD-5 Appendix D (D.1-D.4) |
| 12 Sanitization | TDD-5 Section 4.5, Appendix E |
| 13 Truncation | TDD-5 Section 4.1 (edge cases), Appendix G (G.6) |
