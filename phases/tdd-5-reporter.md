# TDD-5: Report & Fix Generation (Layer 5)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 7), prd/L5-report-fix.md, technical-reference.md (Sections 3.6, 7), phase3-architecture.md (Section 7, steps 5k-5l), phase3-decisions.md (3C-006, 3E-004), phase3-error-handling.md (Scenarios 7, 8, 11), phase3-integration-specs.md (Sections 1.2.5-1.2.7)
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 5 (Report & Fix Generation) is the primary user-facing output layer of DocAlign. It receives verification results, formats them as actionable GitHub PR output, and calculates repository health metrics. L5 operates in two output modes:

1. **Summary comment** -- A single PR comment (Issues API) containing health score, severity breakdown, findings table, and dismiss-all link.
2. **Review comments** -- Individual line-level comments on documentation files (Pull Request Review API) with GitHub suggestion blocks for one-click fixes.

L5 also manages the lifecycle of previously-posted comments across subsequent pushes: new findings get new review comments, resolved findings are marked with a "(Resolved)" prefix, and a new summary comment is posted per push (never editing the previous one).

**Boundaries:** L5 does NOT perform verification -- it receives fully-formed `VerificationResult` objects from L3 via the L4 orchestrator. L5 does NOT manage the scan lifecycle or trigger GitHub Actions -- those are L4's responsibilities. L5 does NOT record feedback -- that is L7's responsibility. L5 does NOT call the GitHub API directly for webhook handling -- it calls Octokit methods for comment posting and Check Run updates only.

**Sanitization mandate (3E-004):** Every string from agent results or claim data that appears in PR comments must pass through `sanitizeForMarkdown()` before inclusion. This is a security boundary enforced within L5.

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| L3 `VerifierService` | `VerificationResult` objects (via L4 merge) | PR comment formatting |
| L3 `VerifierService` (via L4) | `VerificationResult` objects filtered by L4 (suppressed claims already excluded) | PR comment formatting |
| GitHub API (Octokit) | `POST /repos/{owner}/{repo}/issues/{pr}/comments` | Post summary comment |
| GitHub API (Octokit) | `POST /repos/{owner}/{repo}/pulls/{pr}/reviews` | Post review comments with suggestions |
| GitHub API (Octokit) | `PATCH /repos/{owner}/{repo}/pulls/comments/{id}` | Mark resolved comments |
| GitHub API (Octokit) | `GET /repos/{owner}/{repo}/pulls/{pr}/comments` | Fetch existing review comments for resolved detection |
| GitHub API (Octokit) | `GET /repos/{owner}/{repo}/issues/{pr}/comments` | Check for duplicate summary comments |
| GitHub API (Octokit) | `POST /repos/{owner}/{repo}/check-runs` | Create Check Run |
| GitHub API (Octokit) | `PATCH /repos/{owner}/{repo}/check-runs/{id}` | Update Check Run |
| PostgreSQL | `claims`, `verification_results`, `scan_runs`, `repos` tables | Health score calculation, comment_posted guard |
| DocAlignConfig | `check.min_severity_to_block`, `verification.min_severity` | Check Run conclusion, finding filtering |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| L4 Worker (processPRScan) | `postPRComment(owner, repo, prNumber, payload, installationId)` | After merge_results (step 5k-5l) |
| L4 Worker (processPRScan) | `markResolved(owner, repo, prNumber, resolvedClaimIds, scanRunId, installationId)` | After identifying resolved findings |
| L4 Worker (any scan type) | `calculateHealthScore(repoId)` | After scan completion |
| L6 MCP Server | (none -- L6 computes health inline via DB query using same formula) | `get_doc_health` tool |
| Internal (postPRComment) | `formatFinding(finding)` | Per-finding markdown generation |
| Internal (postPRComment) | `sanitizeForMarkdown(text)` | All user-visible text |

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md`. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `DocFix` (Section 7.1) -- fix suggestion data
- `HealthScore` (Section 7.1) -- aggregate health metrics
- `FileHealth` (Section 7.1) -- per-file health breakdown
- `PRCommentPayload` (Section 7.1) -- input to postPRComment
- `Finding` (Section 7.1) -- claim + result + fix + suppression state
- `Claim` (Section 3.1) -- claim record
- `VerificationResult` (Section 5.1) -- verification output
- `Verdict` (Section 1) -- `'verified' | 'drifted' | 'uncertain'`
- `Severity` (Section 1) -- `'high' | 'medium' | 'low'`
- `ClaimType` (Section 1) -- 10 claim type literals
- `ScanRun` (Section 6.1) -- scan execution record
- `DocAlignConfig` (Section 14) -- parsed `.docalign.yml`
- `DocAlignError` (Section 13) -- structured error

**Referenced service interfaces:**
- `ReporterService` (Section 7.2) -- the public API surface (5 functions)
- `LearningService` (Section 9.2) -- for `isClaimSuppressed`

**Layer-internal types** (not in api-contracts, specific to L5 implementation):

```typescript
/** Outcome of a scan for determining comment content */
type ScanOutcome =
  | { type: 'no_claims_in_scope'; total_repo_claims: number }
  | { type: 'all_verified'; total_checked: number; health_score: HealthScore }
  | { type: 'findings_found'; total_checked: number; findings: Finding[]; health_score: HealthScore };

/** Previously-posted review comment parsed from GitHub */
interface ExistingReviewComment {
  comment_id: number;
  claim_id: string;
  scan_run_id: string;
  body: string;
  resolved: boolean;
}

/** Check Run conclusion based on findings and config */
type CheckConclusion = 'success' | 'neutral' | 'action_required' | 'failure';

/** Severity badge for markdown rendering */
interface SeverityBadge {
  label: string;     // "HIGH", "MEDIUM", "LOW"
  emoji: string;     // used as prefix in review comments
}

/** Comment truncation metadata */
interface TruncationInfo {
  original_finding_count: number;
  shown_finding_count: number;
  truncated: boolean;
  original_char_count: number;
}

/** GitHub API IDs returned from comment posting */
interface PostCommentResult {
  comment_id: number;     // Issues API comment ID (summary)
  review_id: number;      // Pull Request Review ID (review comments)
}
```

---

## 4. Public API

### 4.1 postPRComment

#### Signature

```typescript
postPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  payload: PRCommentPayload,
  installationId: number
): Promise<{ comment_id: number; review_id: number }>
```

#### Algorithm

```
function postPRComment(owner, repo, prNumber, payload, installationId):
  // 1. Duplicate comment guard (3C-006)
  scanRun = SELECT * FROM scan_runs WHERE id = payload.scan_run_id
  if scanRun.comment_posted:
    log(WARN, "duplicate_comment_prevented", { scanRunId: payload.scan_run_id })
    return { comment_id: 0, review_id: 0 }

  // 2. Defense-in-depth: check for existing summary comment with this scan_run_id
  existingComments = octokit.issues.listComments({ owner, repo, issue_number: prNumber })
  marker = "<!-- docalign-summary scan-run-id=" + payload.scan_run_id + " -->"
  if any comment in existingComments contains marker:
    log(WARN, "duplicate_comment_marker_found", { scanRunId: payload.scan_run_id })
    UPDATE scan_runs SET comment_posted = true WHERE id = payload.scan_run_id
    return { comment_id: 0, review_id: 0 }

  // 3. Determine scan outcome
  outcome = determineScanOutcome(payload)

  // 4. Build summary comment body
  summaryBody = buildSummaryComment(payload, outcome)

  // 5. Truncation check (DOCALIGN_E107)
  if summaryBody.length > 65000:
    summaryBody = truncateSummaryComment(summaryBody, payload)

  // 6. Post summary comment (Issues API)
  summaryResult = octokit.issues.createComment({
    owner, repo,
    issue_number: prNumber,
    body: summaryBody
  })
  comment_id = summaryResult.data.id

  // 7. Build and post review comments (Pull Request Review API)
  //    Only for drifted findings (NOT uncertain)
  driftedFindings = payload.findings.filter(f =>
    f.result.verdict === 'drifted' && !f.suppressed
  )

  review_id = 0
  if driftedFindings.length > 0:
    reviewComments = driftedFindings.map(f => buildReviewComment(f, payload.scan_run_id))

    // Batch into groups of 30 (GitHub limit per review)
    for batch in chunk(reviewComments, 30):
      reviewResult = octokit.pulls.createReview({
        owner, repo,
        pull_number: prNumber,
        commit_id: scanRun.commit_sha,
        event: 'COMMENT',
        comments: batch
      })
      if review_id === 0:
        review_id = reviewResult.data.id

  // 8. Update Check Run
  checkConclusion = determineCheckConclusion(payload, config)
  checkSummary = buildCheckRunSummary(payload, outcome)
  if scanRun.check_run_id:
    octokit.checks.update({
      owner, repo,
      check_run_id: scanRun.check_run_id,
      status: 'completed',
      conclusion: checkConclusion,
      output: { title: checkSummary.title, summary: checkSummary.summary }
    })

  // 9. Mark comment as posted (atomic with guard)
  UPDATE scan_runs SET comment_posted = true WHERE id = payload.scan_run_id AND comment_posted = false

  return { comment_id, review_id }
```

#### Input/Output Example 1: PR with findings

```
Input:
  postPRComment(
    "acme", "webapp", 42,
    {
      findings: [
        {
          claim: { id: "claim-001", source_file: "README.md", line_number: 45,
                   claim_text: "Authentication uses bcrypt with 12 salt rounds",
                   claim_type: "behavior", ... },
          result: { verdict: "drifted", severity: "high", confidence: 0.95,
                    reasoning: "Code uses argon2, not bcrypt.",
                    specific_mismatch: "bcrypt -> argon2id",
                    suggested_fix: "Authentication uses argon2id with 64MB memory cost.",
                    evidence_files: ["src/auth/password.ts"], ... },
          fix: { file: "README.md", line_start: 45, line_end: 45,
                 old_text: "Authentication uses bcrypt with 12 salt rounds",
                 new_text: "Authentication uses argon2id with 64MB memory cost for password hashing.",
                 reason: "Library migrated", claim_id: "claim-001", confidence: 0.95 },
          suppressed: false
        }
      ],
      health_score: { total_claims: 497, verified: 467, drifted: 12, uncertain: 3,
                      pending: 15, score: 0.975, by_file: {}, by_type: {}, hotspots: [] },
      scan_run_id: "scan-001",
      agent_unavailable_pct: 0
    },
    12345
  )

Output: { comment_id: 98765432, review_id: 55443322 }
// Summary comment posted via Issues API with health score and findings table.
// One review comment posted on README.md line 45 with suggestion block.
// Check Run updated to completed/action_required (HIGH finding).
// scan_runs.comment_posted set to true.
```

#### Input/Output Example 2: PR with zero findings

```
Input:
  postPRComment(
    "acme", "webapp", 43,
    {
      findings: [],
      health_score: { total_claims: 497, verified: 497, drifted: 0, uncertain: 0,
                      pending: 0, score: 1.0, by_file: {}, by_type: {}, hotspots: [] },
      scan_run_id: "scan-002",
      agent_unavailable_pct: 0
    },
    12345
  )

Output: { comment_id: 98765433, review_id: 0 }
// Summary comment: "All 497 claims verified. Documentation is in sync. Health: 100%"
// No review comments (no findings).
// Check Run updated to completed/success.
```

#### Negative Example

Does NOT edit or delete previous summary comments. Each push produces a new summary comment -- the full PR timeline history is preserved. Does NOT post review comments for uncertain findings -- those appear only in the summary's collapsible section. Does NOT call `sanitizeForMarkdown` on its own output (summary template) -- only on strings sourced from agent results and claim data.

#### Edge Cases

- `comment_posted` already true: returns `{ comment_id: 0, review_id: 0 }` immediately. No duplicate comment.
- Summary comment exceeds 65,000 chars: truncated to fit (Scenario 7, DOCALIGN_E107). All findings still get individual review comments.
- More than 30 drifted findings: review comments batched into multiple `createReview` calls of 30 each.
- Agent unavailability > 20%: prominent banner prepended to summary comment.
- Force push detected (head SHA mismatch): L4 prepends warning text to payload before calling postPRComment. L5 renders it as-is.
- All findings suppressed: treated as zero findings. Brief positive comment posted.
- No check_run_id on scan_run: skip Check Run update (e.g., push scans without a Check Run).

#### Error Handling

- GitHub API rate limit during comment posting (DOCALIGN_E101): propagate error to L4 for retry/deferral per 3C Scenario 8.
- GitHub API 404 for PR (PR closed or deleted): log WARN, mark comment_posted=true to prevent retries, return `{ comment_id: 0, review_id: 0 }`.
- Database failure on comment_posted update: log ERROR (DOCALIGN_E301). The defense-in-depth marker check prevents duplicate on retry.
- Single review comment body exceeds 65,535 chars: truncate reasoning field, append "Full analysis truncated."

---

### 4.2 markResolved

#### Signature

```typescript
markResolved(
  owner: string,
  repo: string,
  prNumber: number,
  resolvedClaimIds: string[],
  scanRunId: string,
  installationId: number
): Promise<number>  // count of resolved
```

#### Algorithm

```
function markResolved(owner, repo, prNumber, resolvedClaimIds, scanRunId, installationId):
  if resolvedClaimIds.length === 0:
    return 0

  // 1. Fetch all existing review comments on this PR
  existingComments = octokit.pulls.listReviewComments({
    owner, repo, pull_number: prNumber, per_page: 100
  })
  // Paginate if > 100 comments

  // 2. Parse markers from DocAlign comments
  docalignComments = []
  for comment in existingComments:
    parsed = parseReviewCommentMarker(comment.body)
    if parsed and parsed.claim_id in resolvedClaimIds:
      if not parsed.resolved:   // skip already-resolved
        docalignComments.push({
          comment_id: comment.id,
          claim_id: parsed.claim_id,
          scan_run_id: parsed.scan_run_id,
          body: comment.body,
          resolved: false
        })

  // 3. Update each comment to prepend "(Resolved)" prefix
  resolvedCount = 0
  for dc in docalignComments:
    newBody = "**(Resolved)** ~~" + stripMarker(dc.body) + "~~"
    newBody += "\n\n<!-- docalign-review-comment claim-id=" + dc.claim_id
              + " scan-run-id=" + dc.scan_run_id
              + " resolved-by=" + scanRunId + " -->"

    octokit.pulls.updateReviewComment({
      owner, repo,
      comment_id: dc.comment_id,
      body: newBody
    })
    resolvedCount++

  return resolvedCount
```

#### Input/Output Example 1: Some findings resolved

```
Input:
  markResolved(
    "acme", "webapp", 42,
    ["claim-001", "claim-003"],
    "scan-002",
    12345
  )

Output: 2
// Two existing review comments found matching claim-001 and claim-003.
// Both updated with "(Resolved)" prefix and strikethrough text.
// Markers updated with resolved-by=scan-002.
```

#### Input/Output Example 2: No matching comments

```
Input:
  markResolved(
    "acme", "webapp", 42,
    ["claim-999"],
    "scan-003",
    12345
  )

Output: 0
// No existing review comments match claim-999. Nothing updated.
```

#### Negative Example

Does NOT delete any comments. Resolved comments are edited with a prefix, not removed. Does NOT create new comments -- only updates existing ones. Does NOT mark summary comments as resolved -- only individual review comments.

#### Edge Cases

- Comment already has "(Resolved)" prefix (resolved by a previous scan): skipped via the `resolved` check in marker parsing.
- Claim ID appears in multiple review comments (e.g., from different scan runs): all matching non-resolved comments are updated.
- More than 100 review comments on the PR: pagination via `Link` header handles this.
- Empty `resolvedClaimIds` array: returns 0 immediately without making any API calls.

#### Error Handling

- GitHub API 404 when updating a deleted comment: log WARN, skip, continue with remaining comments. Do not fail the batch.
- GitHub API rate limit: propagate to L4 for handling per 3C Scenario 8. Partial resolution is acceptable -- remaining comments will be resolved on the next scan.

---

### 4.3 calculateHealthScore

#### Signature

```typescript
calculateHealthScore(repoId: string): Promise<HealthScore>
```

#### Algorithm

```
function calculateHealthScore(repoId):
  // 1. Query claim counts by verification status
  rows = SELECT
    verification_status,
    source_file,
    claim_type,
    COUNT(*) as cnt
  FROM claims
  WHERE repo_id = repoId
  GROUP BY verification_status, source_file, claim_type

  // 2. Aggregate totals
  verified = sum of cnt WHERE verification_status = 'verified'
  drifted = sum of cnt WHERE verification_status = 'drifted'
  uncertain = sum of cnt WHERE verification_status = 'uncertain'
  pending = sum of cnt WHERE verification_status = 'pending'
  total = verified + drifted + uncertain + pending

  // 3. Calculate score
  //    Formula: verified / (verified + drifted)
  //    Uncertain and pending are EXCLUDED from numerator and denominator
  denominator = verified + drifted
  score = denominator > 0 ? verified / denominator : 0

  // 4. Build per-file breakdown
  by_file = {}
  for each unique source_file in rows:
    fileRows = rows filtered by source_file
    by_file[source_file] = {
      total: sum(fileRows.cnt),
      verified: sum where verification_status = 'verified',
      drifted: sum where verification_status = 'drifted',
      uncertain: sum where verification_status = 'uncertain'
    }

  // 5. Build per-type breakdown
  by_type = {}
  for each unique claim_type in rows:
    by_type[claim_type] = sum of cnt for that type (all statuses)

  // 6. Identify hotspots (files with most drift, sorted descending)
  hotspots = by_file entries sorted by drifted count descending
             .filter(f => f.drifted > 0)
             .map(f => f.file_path)
             .slice(0, 10)

  // 7. Cache score in repos table
  UPDATE repos SET health_score = score, total_claims = total, verified_claims = verified
  WHERE id = repoId

  return {
    total_claims: total,
    verified, drifted, uncertain, pending,
    score, by_file, by_type, hotspots
  }
```

#### Input/Output Example 1: Active repo

```
Input:  calculateHealthScore("repo-uuid-001")

Output:
  {
    total_claims: 500,
    verified: 467,
    drifted: 12,
    uncertain: 6,
    pending: 15,
    score: 0.975,           // 467 / (467 + 12) = 0.9749...
    by_file: {
      "README.md": { total: 23, verified: 20, drifted: 2, uncertain: 1 },
      "docs/api.md": { total: 45, verified: 40, drifted: 3, uncertain: 2 },
      ...
    },
    by_type: {
      "path_reference": 120,
      "dependency_version": 45,
      "command": 30,
      "behavior": 180,
      ...
    },
    hotspots: ["docs/api.md", "README.md", "docs/architecture.md"]
  }
// repos.health_score updated to 0.975
```

#### Input/Output Example 2: Fresh repo (all pending)

```
Input:  calculateHealthScore("repo-uuid-002")

Output:
  {
    total_claims: 200,
    verified: 0,
    drifted: 0,
    uncertain: 0,
    pending: 200,
    score: 0,               // denominator is 0, score defaults to 0
    by_file: { "README.md": { total: 200, verified: 0, drifted: 0, uncertain: 0 } },
    by_type: { "path_reference": 50, "behavior": 150 },
    hotspots: []
  }
// Display as "Scanning..." instead of "0%" (handled by rendering layer)
```

#### Negative Example

Does NOT include suppressed claims in the score calculation. Suppressed claims are still in the `claims` table but their verification_status reflects their last known state. L5 counts them as-is. Suppression filtering is L7's responsibility. Does NOT trigger re-verification of any claims -- this is a read-only aggregation.

#### Edge Cases

- Zero claims in repo (brand new, no docs scanned yet): returns `{ total_claims: 0, verified: 0, drifted: 0, uncertain: 0, pending: 0, score: 0, by_file: {}, by_type: {}, hotspots: [] }`.
- All claims drifted: score = 0 (0 / (0 + N) = 0).
- All claims verified: score = 1.0 (N / (N + 0) = 1).
- All claims uncertain or pending: denominator is 0, score defaults to 0. Rendered as "Scanning..." in UI.

#### Error Handling

- Database connection failure: throw `DocAlignError` code `DOCALIGN_E301`, retryable. Caller (L4) handles retry.
- Query timeout (>1 second): log WARN with timing. The query should complete in <100ms for MVP scale (<500 claims per repo).

---

### 4.4 formatFinding

#### Signature

```typescript
formatFinding(finding: Finding): string
```

#### Algorithm

```
function formatFinding(finding):
  // 1. Determine severity badge
  badge = getSeverityBadge(finding.result.severity)

  // 2. Sanitize all agent-sourced strings
  claimText = sanitizeForMarkdown(finding.claim.claim_text)
  reasoning = sanitizeForMarkdown(finding.result.reasoning || "")
  mismatch = sanitizeForMarkdown(finding.result.specific_mismatch || "")
  evidenceFiles = finding.result.evidence_files.map(f => sanitizeForMarkdown(f))

  // 3. Build finding block
  output = "### " + badge.label + ": " + truncate(mismatch, 80) + "\n"
  output += "**docs:** `" + finding.claim.source_file + "` line " + finding.claim.line_number + "\n"
  output += "**claim:** \"" + truncate(claimText, 200) + "\"\n"

  if evidenceFiles.length > 0:
    output += "**evidence:** " + evidenceFiles.map(f => "`" + f + "`").join(", ") + "\n"

  if reasoning:
    output += "\n" + reasoning + "\n"

  // 4. Add suggestion block if fix available
  if finding.fix:
    fixText = sanitizeForMarkdown(finding.fix.new_text)
    output += "\n<details>\n<summary>Suggested fix</summary>\n\n"
    output += "```diff\n"
    output += "- " + sanitizeForMarkdown(finding.fix.old_text) + "\n"
    output += "+ " + fixText + "\n"
    output += "```\n</details>\n"

  return output
```

#### Input/Output Example 1: Drifted finding with fix

```
Input:
  formatFinding({
    claim: { id: "claim-001", source_file: "README.md", line_number: 45,
             claim_text: "Authentication uses bcrypt with 12 salt rounds",
             claim_type: "behavior", ... },
    result: { verdict: "drifted", severity: "high", confidence: 0.95,
              reasoning: "Code uses argon2, not bcrypt.",
              specific_mismatch: "Password hashing library changed",
              evidence_files: ["src/auth/password.ts"], ... },
    fix: { file: "README.md", line_start: 45, line_end: 45,
           old_text: "Authentication uses bcrypt with 12 salt rounds",
           new_text: "Authentication uses argon2id with 64MB memory cost for password hashing.",
           reason: "Library migrated", claim_id: "claim-001", confidence: 0.95 },
    suppressed: false
  })

Output:
  "### HIGH: Password hashing library changed\n" +
  "**docs:** `README.md` line 45\n" +
  "**claim:** \"Authentication uses bcrypt with 12 salt rounds\"\n" +
  "**evidence:** `src/auth/password.ts`\n" +
  "\nCode uses argon2, not bcrypt.\n" +
  "\n<details>\n<summary>Suggested fix</summary>\n\n" +
  "```diff\n" +
  "- Authentication uses bcrypt with 12 salt rounds\n" +
  "+ Authentication uses argon2id with 64MB memory cost for password hashing.\n" +
  "```\n</details>\n"
```

#### Input/Output Example 2: Drifted finding without fix

```
Input:
  formatFinding({
    claim: { id: "claim-005", source_file: "CONTRIBUTING.md", line_number: 88,
             claim_text: "The CI pipeline runs on CircleCI",
             claim_type: "architecture", ... },
    result: { verdict: "drifted", severity: "medium", confidence: 0.80,
              reasoning: "Repository uses GitHub Actions, not CircleCI.",
              specific_mismatch: "CI platform changed from CircleCI to GitHub Actions",
              suggested_fix: null, evidence_files: [".github/workflows/ci.yml"], ... },
    fix: null,
    suppressed: false
  })

Output:
  "### MEDIUM: CI platform changed from CircleCI to GitHub Actions\n" +
  "**docs:** `CONTRIBUTING.md` line 88\n" +
  "**claim:** \"The CI pipeline runs on CircleCI\"\n" +
  "**evidence:** `.github/workflows/ci.yml`\n" +
  "\nRepository uses GitHub Actions, not CircleCI.\n"
```

#### Negative Example

Does NOT generate review comment format -- this function produces the summary comment entry for a single finding. The review comment format (with `suggestion` block and marker) is built separately by `buildReviewComment()` (internal helper). Does NOT add the `---` separator between findings -- the caller adds those when assembling the full summary.

#### Edge Cases

- `specific_mismatch` is null: use a generic header based on claim type (e.g., "Documentation drift detected").
- `reasoning` is null or empty: omit the reasoning line entirely.
- `evidence_files` is empty: omit the evidence line.
- Very long `claim_text` (>200 chars): truncated with "..." suffix.
- Finding with `severity: null` (should not occur for drifted findings): default to "UNKNOWN" badge.

#### Error Handling

- `sanitizeForMarkdown` throws (should not happen): catch, log ERROR, use raw text with a fallback strip of `<` and `>` characters.
- This function is pure (no I/O, no side effects). It does not throw under normal operation.

---

### 4.5 sanitizeForMarkdown

#### Signature

```typescript
sanitizeForMarkdown(text: string): string
```

#### Algorithm

```
function sanitizeForMarkdown(text):
  // 1. Strip null/undefined
  if text is null or undefined:
    return ""

  // 2. Convert to string if not already
  result = String(text)

  // 3. Block javascript: and data: URL schemes
  result = result.replace(/javascript:/gi, '')
  result = result.replace(/data:/gi, '')
  result = result.replace(/vbscript:/gi, '')

  // 4. Strip HTML tags (prevent injection)
  result = result.replace(/<script[\s>]/gi, '&lt;script ')
  result = result.replace(/<\/script>/gi, '&lt;/script&gt;')
  result = result.replace(/<iframe/gi, '&lt;iframe')
  result = result.replace(/<object/gi, '&lt;object')
  result = result.replace(/<embed/gi, '&lt;embed')
  result = result.replace(/<form/gi, '&lt;form')

  // 5. Prevent HTML comment injection (could break marker parsing)
  result = result.replace(/<!--/g, '&lt;!--')
  result = result.replace(/-->/g, '--&gt;')

  // 6. Enforce max length (5000 chars for general text)
  if result.length > 5000:
    result = result.slice(0, 4997) + "..."

  return result
```

#### Input/Output Example 1: Clean text

```
Input:  sanitizeForMarkdown("Code uses argon2, not bcrypt.")
Output: "Code uses argon2, not bcrypt."
// No transformation needed -- text is clean.
```

#### Input/Output Example 2: Malicious input

```
Input:  sanitizeForMarkdown('Click <script>alert("xss")</script> here. Visit javascript:alert(1)')
Output: 'Click &lt;script alert("xss")&lt;/script&gt; here. Visit alert(1)'
// Script tags escaped, javascript: scheme stripped.
```

#### Negative Example

Does NOT escape standard markdown formatting characters (`*`, `_`, `#`, etc.). These are valid in PR comments and should render as markdown. Does NOT escape backticks -- code references in agent output should render as inline code. Does NOT sanitize for code blocks specifically -- that is handled by `sanitizeForCodeBlock()` (a separate internal helper for suggestion blocks).

#### Edge Cases

- null input: returns empty string.
- Empty string input: returns empty string.
- Text containing only URL schemes: returns empty string after stripping.
- Exactly 5000 characters: returned as-is (no truncation).
- 5001 characters: truncated to 4997 + "...".
- Text with nested HTML comments `<!-- <!-- -->`: both `<!--` occurrences escaped.
- Unicode text: passed through unchanged. No encoding transformation.
- Text with legitimate `<` and `>` characters (e.g., generics): only specific dangerous tags are escaped, not all angle brackets.

#### Error Handling

- Non-string input (number, object): `String()` coercion handles gracefully.
- This function is pure, synchronous, and never throws.

---

## 5. Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| **PR comment posted** | < 30 seconds from verification completion | Wall clock from L4 calling `postPRComment` to GitHub API response |
| **Health score calculation** | < 1 second for repos with < 500 claims | Database query time |
| **Health score calculation** | < 5 seconds for repos with < 5000 claims | Database query time (future scaling) |
| **formatFinding** | < 5 ms per finding | CPU time (synchronous, pure function) |
| **sanitizeForMarkdown** | < 1 ms per call | CPU time (regex operations) |
| **Summary comment size** | < 65,000 chars | Enforced by truncation logic |
| **Review comments per batch** | Max 30 per API call | GitHub API limit |
| **GitHub API calls per PR scan** | 3-15 total for L5 | 1 summary + 1-N review batches + 1 Check Run update + 0-N resolved updates |

**Key latency considerations:**
- The 30-second target is dominated by GitHub API latency (typically 200-500ms per call).
- For a PR with 25 findings: 1 summary POST + 1 review POST (25 < 30 batch limit) + 1 Check Run PATCH = ~3 API calls = ~1.5s.
- For a PR with 50 findings: 1 summary POST + 2 review POSTs + 1 Check Run PATCH = ~4 API calls = ~2s.
- markResolved adds 1 GET (list comments) + N PATCH calls. For 10 resolved comments: ~11 API calls = ~5.5s.

---

## 6. Required Framework Knowledge

| Technology | Usage in L5 | Key API Surface |
|-----------|-------------|-----------------|
| **Octokit** (`@octokit/rest`) | All GitHub API calls | `octokit.issues.createComment()`, `octokit.pulls.createReview()`, `octokit.pulls.listReviewComments()`, `octokit.pulls.updateReviewComment()`, `octokit.checks.update()` |
| **GitHub Issues API** | Summary comments | `POST /repos/{owner}/{repo}/issues/{number}/comments` |
| **GitHub Pull Request Review API** | Review comments with suggestions | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` with `event: 'COMMENT'` |
| **GitHub Check Runs API** | Check status updates | `PATCH /repos/{owner}/{repo}/check-runs/{id}` |
| **GitHub Suggestion Syntax** | One-click fix | ` ```suggestion\nnew text\n``` ` in review comment body |
| **PostgreSQL** | Claim aggregation for health score | GROUP BY queries, atomic UPDATE for comment_posted |
| **Markdown** | All output formatting | Tables, code blocks, `<details>` sections, HTML comments for markers |

---

## 7. Open Questions

### 7.1 Multi-Line Suggestion Blocks

GitHub suggestion blocks replace the exact lines specified by the review comment's `line`/`start_line` parameters. When a fix spans multiple lines (e.g., `line_start: 10, line_end: 15`), the review comment must use `start_line: 10, line: 15` to cover the range. The suggestion block inside replaces all those lines.

**Question:** Should L5 validate that `fix.line_start` and `fix.line_end` are within the PR diff hunk? GitHub rejects review comments on lines that are not part of the diff.

**Proposal:** Yes, validate against the diff. If the fix targets a line outside the diff, fall back to posting the fix in the summary comment only (no review comment for that finding). Log WARN. This is expected for claims triggered by code changes where the doc file itself was not modified in the PR.

### 7.2 Dismiss-All HMAC Token Generation

The dismiss-all link requires an HMAC token: `GET /api/dismiss?repo={repo_id}&pr={pr_number}&token={hmac_token}`. The HMAC is computed using `DOCALIGN_API_SECRET`.

**Question:** Should the dismiss-all link include a scan_run_id to scope dismissal to the current scan's findings only?

**Proposal:** Yes, include `scan_run_id` in the HMAC payload and URL. Format: `GET /api/dismiss?repo={repo_id}&pr={pr_number}&scan_run_id={scan_run_id}&token={hmac}` where HMAC = `HMAC-SHA256(DOCALIGN_API_SECRET, repo_id + ":" + pr_number + ":" + scan_run_id)`.

### 7.3 Review Comment Line Mapping in Non-Diff Context

Review comments can only be posted on lines that are part of the PR diff. For findings where the documentation file was NOT changed in the PR (the finding was triggered by a code change), the doc file line is not in the diff.

**Proposal:** For findings where `claim.source_file` is not in the PR diff, post the finding in the summary comment only with a note: "This finding references `{file}` which is not modified in this PR." Do not attempt to post a review comment.

---

## Appendix A: PR Comment Markdown Template

### A.1 Summary Comment (Findings Found)

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

{agent_unavailable_banner (if agent_unavailable_pct > 20%)}
{force_push_warning (if applicable)}
{config_warnings (if applicable)}

Found **{N} documentation issue(s)** in this PR:

**{verified} verified** | **{drifted} drifted** | **{uncertain} uncertain** -- **{score_pct}% health**

| Severity | File | Line | Issue |
|----------|------|------|-------|
| {severity_badge} | `{source_file}` | {line} | {brief_mismatch} |
| ... | ... | ... | ... |
{if truncated: "| ... | | | and {N} more findings not shown |"}

---

{for each drifted finding (sorted: severity desc, file alpha, line asc):}
{formatted_finding with --- separator}
{end for}

---

{if uncertain_count > 0:}
<details>
<summary>{uncertain_count} claim(s) we couldn't verify (expand for details)</summary>

| File | Line | Claim | Reason |
|------|------|-------|--------|
| `{source_file}` | {line} | {claim_text_truncated} | {reasoning} |
| ... | ... | ... | ... |

</details>

---
{end if}

Commit: `{commit_sha}` | Scanned at {timestamp}
Repo health: {score_pct}% ({verified}/{verified+drifted} claims verified) | [Dismiss all]({dismiss_url})

> React with :+1: or :-1: on individual review comments to improve future checks.
```

### A.2 Summary Comment (Zero Findings)

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

All **{N} claims** verified. Documentation is in sync. :white_check_mark:

**{verified} verified** | **0 drifted** | **{uncertain} uncertain** -- **{score_pct}% health**

Commit: `{commit_sha}` | Scanned at {timestamp}
```

### A.3 Summary Comment (No Claims in Scope)

```markdown
## DocAlign: Documentation Health Check

<!-- docalign-summary scan-run-id={scan_run_id} -->

No documentation claims are affected by the changes in this PR.

Repo health: {score_pct}% ({verified}/{total_scored} claims verified)

Commit: `{commit_sha}` | Scanned at {timestamp}
```

### A.4 Agent Unavailability Banner

```markdown
> **Warning:** {pct}% of claims could not be verified because the DocAlign Action did not complete in time. Check your Action configuration and LLM API key.
```

### A.5 Force Push Warning

```markdown
> **Note:** These results are from commit `{sha}`. The PR has been updated since this scan ran.
```

---

## Appendix B: Review Comment Format

### B.1 Review Comment Body (Drifted with Fix)

```markdown
**DocAlign: {SEVERITY}** -- {brief_mismatch}

**Claim:** "{claim_text}"
**Evidence:** `{evidence_file_1}`, `{evidence_file_2}`

{reasoning}

```suggestion
{new_text (replaces the lines covered by start_line to line)}
```

<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->
```

### B.2 Review Comment Body (Drifted without Fix)

```markdown
**DocAlign: {SEVERITY}** -- {brief_mismatch}

**Claim:** "{claim_text}"
**Evidence:** `{evidence_file_1}`

{reasoning}

<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->
```

### B.3 Resolved Comment Body

```markdown
**(Resolved)** ~~{original_comment_body_without_marker}~~

<!-- docalign-review-comment claim-id={claim_id} scan-run-id={original_scan_run_id} resolved-by={new_scan_run_id} -->
```

---

## Appendix C: Severity Badges

| Severity | Summary Table Display | Review Comment Prefix | Sort Priority |
|----------|----------------------|----------------------|---------------|
| `high` | `HIGH` | `**DocAlign: HIGH**` | 1 (first) |
| `medium` | `MEDIUM` | `**DocAlign: MEDIUM**` | 2 |
| `low` | `LOW` | `**DocAlign: LOW**` | 3 (last) |

**Finding display order** (per PRD 9.2): sort by severity descending (HIGH -> MEDIUM -> LOW), then by file path alphabetically, then by line number ascending.

```typescript
function sortFindings(findings: Finding[]): Finding[] {
  const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => {
    const sevA = severityOrder[a.result.severity ?? 'low'];
    const sevB = severityOrder[b.result.severity ?? 'low'];
    if (sevA !== sevB) return sevA - sevB;

    const fileA = a.claim.source_file;
    const fileB = b.claim.source_file;
    if (fileA !== fileB) return fileA.localeCompare(fileB);

    return a.claim.line_number - b.claim.line_number;
  });
}
```

**Summary table maximum:** 25 findings shown. If more than 25: show top 25 and append "and N more findings not shown." All findings get review comments regardless of summary truncation.

---

## Appendix D: Health Score Formula

### D.1 Core Formula

```
score = verified / (verified + drifted)
```

- **Numerator:** count of claims with `verification_status = 'verified'`
- **Denominator:** count of `verified` + count of `drifted`
- **Excluded from both numerator and denominator:** `uncertain` and `pending` claims
- **Range:** 0 to 1 (stored as decimal internally)
- **Display:** Percentage to users (e.g., 0.94 -> "94%")
- **Zero denominator:** When all claims are pending or uncertain (denominator = 0), display "Scanning..." instead of a percentage

### D.2 Health Score Line Format

```
{verified} verified, {drifted} drifted, {uncertain} uncertain -- {score_pct}% health
```

Example: `467 verified, 12 drifted, 3 uncertain -- 97% health`

### D.3 Per-File Health

Same formula applied per `source_file`:

```typescript
interface FileHealth {
  total: number;      // all claims in this file
  verified: number;
  drifted: number;
  uncertain: number;  // informational, not in score denominator
}
```

### D.4 Hotspot Detection

Hotspots are the files with the most drifted claims. Return up to 10, sorted by drifted count descending.

```
SELECT source_file, COUNT(*) as drift_count
FROM claims
WHERE repo_id = $1 AND verification_status = 'drifted'
GROUP BY source_file
ORDER BY drift_count DESC
LIMIT 10
```

---

## Appendix E: Sanitization Rules

### E.1 sanitizeForMarkdown (General Text)

Applied to: `claim_text`, `reasoning`, `specific_mismatch`, `suggested_fix` from agent results. Also applied to `evidence_files` paths.

| Rule | Pattern | Replacement | Reason |
|------|---------|-------------|--------|
| JavaScript URL scheme | `/javascript:/gi` | `''` (remove) | Prevent URL injection |
| Data URL scheme | `/data:/gi` | `''` (remove) | Prevent data URL injection |
| VBScript URL scheme | `/vbscript:/gi` | `''` (remove) | Prevent VBScript injection |
| Script tags | `/<script[\s>]/gi` | `'&lt;script '` | Prevent HTML injection |
| Script close tags | `/<\/script>/gi` | `'&lt;/script&gt;'` | Prevent HTML injection |
| Iframe tags | `/<iframe/gi` | `'&lt;iframe'` | Prevent embed injection |
| Object tags | `/<object/gi` | `'&lt;object'` | Prevent embed injection |
| Embed tags | `/<embed/gi` | `'&lt;embed'` | Prevent embed injection |
| Form tags | `/<form/gi` | `'&lt;form'` | Prevent form injection |
| HTML comment open | `/<!--/g` | `'&lt;!--'` | Prevent marker manipulation |
| HTML comment close | `/-->/g` | `'--&gt;'` | Prevent marker manipulation |
| Max length | `.length > 5000` | Truncate to 4997 + "..." | Prevent overflow |

### E.2 sanitizeForCodeBlock (Suggestion Blocks)

Applied specifically to text inside ` ```suggestion ``` ` blocks and ` ```diff ``` ` blocks.

```typescript
function sanitizeForCodeBlock(text: string): string {
  if (!text) return "";
  let result = String(text);
  // Prevent premature code block closure
  result = result.replace(/```/g, '` ` `');
  // Enforce max length for suggestion text
  if (result.length > 10000) {
    result = result.slice(0, 9997) + "...";
  }
  return result;
}
```

### E.3 Marker Injection Prevention

Hidden HTML comment markers (`<!-- docalign-... -->`) are generated by L5 using trusted data only (UUIDs from the database). Agent-sourced text NEVER appears inside markers. The `<!--` escape in `sanitizeForMarkdown` prevents agent output from creating fake markers.

---

## Appendix F: Check Run Integration

### F.1 Check Run Status Transitions

| Event | Status | Conclusion | Title |
|-------|--------|------------|-------|
| Scan starts (L4 creates) | `in_progress` | -- | "DocAlign: Scanning documentation..." |
| Scan success, HIGH findings | `completed` | `action_required` | "DocAlign: Found N documentation issues" |
| Scan success, MEDIUM/LOW only | `completed` | `neutral` | "DocAlign: Found N documentation issues" |
| Scan success, zero findings | `completed` | `success` | "DocAlign: All N claims verified" |
| Scan failure | `completed` | `failure` | "DocAlign: Scan failed" |
| Scan partial (timeout) | `completed` | `neutral` | "DocAlign: Partial scan" |

### F.2 Conclusion Determination Logic

```typescript
function determineCheckConclusion(
  payload: PRCommentPayload,
  config: DocAlignConfig
): CheckConclusion {
  const driftedFindings = payload.findings.filter(
    f => f.result.verdict === 'drifted' && !f.suppressed
  );

  if (driftedFindings.length === 0) {
    return 'success';
  }

  const minSeverityToBlock = config.check?.min_severity_to_block ?? 'high';
  const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const blockThreshold = severityOrder[minSeverityToBlock];

  const hasBlockingFindings = driftedFindings.some(
    f => severityOrder[f.result.severity ?? 'low'] <= blockThreshold
  );

  return hasBlockingFindings ? 'action_required' : 'neutral';
}
```

### F.3 Check Run Summary Format

```typescript
function buildCheckRunSummary(
  payload: PRCommentPayload,
  outcome: ScanOutcome
): { title: string; summary: string } {
  if (outcome.type === 'no_claims_in_scope') {
    return {
      title: "DocAlign: No claims in scope",
      summary: "No documentation claims are affected by this PR."
    };
  }

  if (outcome.type === 'all_verified') {
    return {
      title: "DocAlign: All " + outcome.total_checked + " claims verified",
      summary: "All " + outcome.total_checked + " claims verified. Documentation is in sync. Health score: " + formatPct(outcome.health_score.score) + "."
    };
  }

  // findings_found
  const drifted = payload.findings.filter(f => f.result.verdict === 'drifted' && !f.suppressed);
  const highCount = drifted.filter(f => f.result.severity === 'high').length;
  const medCount = drifted.filter(f => f.result.severity === 'medium').length;
  const lowCount = drifted.filter(f => f.result.severity === 'low').length;

  const parts = [];
  if (highCount > 0) parts.push(highCount + " high");
  if (medCount > 0) parts.push(medCount + " medium");
  if (lowCount > 0) parts.push(lowCount + " low");

  return {
    title: "DocAlign: Found " + drifted.length + " documentation issue(s)",
    summary: "Found " + drifted.length + " documentation issues (" + parts.join(", ") + "). Health score: " + formatPct(outcome.health_score.score) + "."
  };
}
```

---

## Appendix G: Internal Helper Functions

These functions are layer-internal and not part of the `ReporterService` public API.

### G.1 determineScanOutcome

```typescript
function determineScanOutcome(payload: PRCommentPayload): ScanOutcome {
  const nonSuppressed = payload.findings.filter(f => !f.suppressed);
  const totalChecked = payload.health_score.verified
    + payload.health_score.drifted
    + payload.health_score.uncertain;

  if (totalChecked === 0 && payload.health_score.pending > 0) {
    return { type: 'no_claims_in_scope', total_repo_claims: payload.health_score.total_claims };
  }

  if (nonSuppressed.length === 0) {
    return {
      type: 'all_verified',
      total_checked: totalChecked,
      health_score: payload.health_score
    };
  }

  return {
    type: 'findings_found',
    total_checked: totalChecked,
    findings: nonSuppressed,
    health_score: payload.health_score
  };
}
```

### G.2 buildSummaryComment

Assembles the full summary comment body from the payload and outcome using templates from Appendix A.

```
function buildSummaryComment(payload, outcome):
  body = ""

  // 1. Header and marker
  body += "## DocAlign: Documentation Health Check\n\n"
  body += "<!-- docalign-summary scan-run-id=" + payload.scan_run_id + " -->\n\n"

  // 2. Banners (agent unavailable, force push, config warnings)
  if payload.agent_unavailable_pct > 20:
    body += "> **Warning:** " + round(payload.agent_unavailable_pct) + "% of claims could not be verified...\n\n"

  // 3. Outcome-specific content
  if outcome.type === 'no_claims_in_scope':
    body += "No documentation claims are affected by the changes in this PR.\n\n"
    body += "Repo health: " + formatPct(payload.health_score.score) + "...\n"
    return body

  if outcome.type === 'all_verified':
    body += "All **" + outcome.total_checked + " claims** verified. Documentation is in sync.\n\n"
    body += formatHealthLine(payload.health_score) + "\n"
    return body

  // findings_found:
  driftedFindings = sortFindings(outcome.findings.filter(f => f.result.verdict === 'drifted'))
  uncertainFindings = outcome.findings.filter(f => f.result.verdict === 'uncertain')

  body += "Found **" + driftedFindings.length + " documentation issue(s)** in this PR:\n\n"
  body += formatHealthLine(payload.health_score) + "\n\n"

  // 4. Findings summary table (max 25)
  body += buildFindingsTable(driftedFindings, 25) + "\n\n"
  body += "---\n\n"

  // 5. Detailed findings (max 25 in summary)
  shown = driftedFindings.slice(0, 25)
  for finding in shown:
    body += formatFinding(finding) + "\n---\n\n"

  if driftedFindings.length > 25:
    body += "and " + (driftedFindings.length - 25) + " more findings not shown.\n\n---\n\n"

  // 6. Uncertain claims in collapsible section
  if uncertainFindings.length > 0:
    body += buildUncertainSection(uncertainFindings) + "\n\n---\n\n"

  // 7. Footer
  body += "Commit: `" + scanRun.commit_sha + "` | Scanned at " + now().toISOString() + "\n"
  body += "Repo health: " + formatPct(payload.health_score.score) + " (" + payload.health_score.verified + "/" + (payload.health_score.verified + payload.health_score.drifted) + " claims verified)"
  body += " | [Dismiss all](" + buildDismissUrl(payload) + ")\n\n"
  body += "> React with :+1: or :-1: on individual review comments to improve future checks.\n"

  return body
```

### G.3 buildReviewComment

Builds a single review comment object for the Pull Request Review API.

```typescript
function buildReviewComment(
  finding: Finding,
  scanRunId: string
): { path: string; line: number; start_line?: number; body: string } {
  const severity = (finding.result.severity ?? 'low').toUpperCase();
  const mismatch = sanitizeForMarkdown(finding.result.specific_mismatch ?? 'Documentation drift detected');
  const claimText = sanitizeForMarkdown(finding.claim.claim_text);
  const reasoning = sanitizeForMarkdown(finding.result.reasoning ?? '');
  const evidenceFiles = finding.result.evidence_files.map(f => '`' + sanitizeForMarkdown(f) + '`').join(', ');

  let body = `**DocAlign: ${severity}** -- ${truncate(mismatch, 80)}\n\n`;
  body += `**Claim:** "${truncate(claimText, 200)}"\n`;
  if (evidenceFiles) {
    body += `**Evidence:** ${evidenceFiles}\n`;
  }
  if (reasoning) {
    body += `\n${reasoning}\n`;
  }

  // Add suggestion block if fix available
  if (finding.fix) {
    const fixText = sanitizeForCodeBlock(finding.fix.new_text);
    body += `\n\`\`\`suggestion\n${fixText}\n\`\`\`\n`;
  }

  // Add tracking marker
  body += `\n<!-- docalign-review-comment claim-id=${finding.claim.id} scan-run-id=${scanRunId} -->`;

  const result: { path: string; line: number; start_line?: number; body: string } = {
    path: finding.claim.source_file,
    line: finding.fix?.line_end ?? finding.claim.line_number,
    body
  };

  // Multi-line suggestion: set start_line
  if (finding.fix && finding.fix.line_start !== finding.fix.line_end) {
    result.start_line = finding.fix.line_start;
  }

  return result;
}
```

### G.4 parseReviewCommentMarker

Parses the hidden HTML marker from an existing review comment body.

```typescript
function parseReviewCommentMarker(body: string): ExistingReviewComment | null {
  const markerRegex = /<!-- docalign-review-comment claim-id=(\S+) scan-run-id=(\S+)(?:\s+resolved-by=(\S+))? -->/;
  const match = body.match(markerRegex);
  if (!match) return null;

  return {
    comment_id: 0,   // filled by caller
    claim_id: match[1],
    scan_run_id: match[2],
    body,
    resolved: !!match[3]
  };
}
```

### G.5 buildDismissUrl

Generates the HMAC-signed dismiss-all URL.

```typescript
function buildDismissUrl(payload: PRCommentPayload): string {
  const repoId = /* from scan_run lookup */;
  const prNumber = /* from caller context */;
  const hmac = crypto
    .createHmac('sha256', DOCALIGN_API_SECRET)
    .update(repoId + ':' + prNumber + ':' + payload.scan_run_id)
    .digest('hex');

  return DOCALIGN_BASE_URL + '/api/dismiss'
    + '?repo=' + repoId
    + '&pr=' + prNumber
    + '&scan_run_id=' + payload.scan_run_id
    + '&token=' + hmac;
}
```

### G.6 truncateSummaryComment

Truncates the summary comment to fit within GitHub's 65,535 character limit.

```typescript
function truncateSummaryComment(body: string, payload: PRCommentPayload): string {
  // Strategy: remove individual finding details, keep table and header
  // 1. Keep everything up to and including the findings table
  // 2. Remove detailed finding blocks until under limit
  // 3. Append truncation note

  const MAX_LENGTH = 65000;
  const TRUNCATION_NOTE = "\n\n---\n\nShowing partial results. Full details available in review comments on individual lines.\n";

  if (body.length <= MAX_LENGTH) return body;

  // Find the end of the findings table (after first ---)
  const tableEnd = body.indexOf('\n---\n', body.indexOf('| Severity |'));
  if (tableEnd === -1) {
    // Fallback: hard truncate
    return body.slice(0, MAX_LENGTH - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
  }

  // Keep header + table + truncation note
  let truncated = body.slice(0, tableEnd + 5) + TRUNCATION_NOTE;

  // If still too long (enormous table), hard truncate
  if (truncated.length > MAX_LENGTH) {
    truncated = truncated.slice(0, MAX_LENGTH - 100) + "\n\n(Truncated due to size. See review comments for details.)\n";
  }

  log(WARN, "DOCALIGN_E107", {
    prNumber: payload.scan_run_id,
    originalLength: body.length,
    truncatedLength: truncated.length
  });

  return truncated;
}
```

### G.7 formatPct

```typescript
function formatPct(score: number): string {
  return Math.round(score * 100) + '%';
}
```

### G.8 formatHealthLine

```typescript
function formatHealthLine(hs: HealthScore): string {
  const pct = (hs.verified + hs.drifted) > 0
    ? formatPct(hs.score)
    : 'Scanning...';
  return `**${hs.verified} verified** | **${hs.drifted} drifted** | **${hs.uncertain} uncertain** -- **${pct} health**`;
}
```

---

## Appendix H: Cross-TDD Decisions

The following decisions made in this TDD are logged to `phase4-decisions.md`:

### TDD5-001: Review Comments Only for Drifted Findings

**Decision:** Review comments (line-level, with suggestion blocks) are posted only for findings with `verdict: 'drifted'`. Uncertain findings appear only in the summary comment's collapsible `<details>` section.

**Rationale:** Uncertain findings lack sufficient confidence for a line-level suggestion. Posting review comments for uncertain findings would generate noise and erode developer trust. The collapsible summary section keeps them visible without being intrusive.

**Affects:** L4 (must separate drifted from uncertain findings before calling postPRComment), L7 (feedback reactions are only collected from review comments, so uncertain findings do not generate feedback signals).

### TDD5-002: Dismiss-All Includes scan_run_id in HMAC

**Decision:** The dismiss-all URL includes `scan_run_id` in both the URL parameters and the HMAC payload. Dismissal is scoped to the current scan's findings only.

**Rationale:** Without `scan_run_id` scoping, clicking dismiss-all on an old comment could dismiss findings from a newer scan. Including it ensures temporal correctness. The HMAC prevents parameter tampering.

**Affects:** API server dismiss endpoint (must validate `scan_run_id` and only dismiss findings from that specific scan run).

### TDD5-003: Non-Diff Lines Fall Back to Summary-Only

**Decision:** When a finding targets a documentation file that was NOT part of the PR diff, L5 does not post a review comment for that finding. The finding appears in the summary comment only.

**Rationale:** GitHub rejects review comments on lines outside the diff. Rather than attempting and handling the 422 error, L5 proactively avoids the API call. This is expected for findings triggered by code changes where the affected documentation was not modified in the PR.

**Affects:** L4 (should provide the list of changed files to L5 so it can determine which findings can have review comments).
