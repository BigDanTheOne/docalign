# TDD-7: Learning System (Layer 7)

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4A: Technical Design Documents
>
> **Inputs:** phase4-api-contracts.md (Section 9), prd/L7-learning-system.md, technical-reference.md (Sections 3.7, 4.6-4.7), spike-c-learning-generalization.md, phase3-decisions.md (3C-001), phase3-error-handling.md
>
> **Date:** 2026-02-11

---

## 1. Overview

Layer 7 (Learning System) improves DocAlign's verification accuracy over time using four signal types: developer feedback on findings (quick-pick and count-based paths), co-change patterns between code and documentation files, agent drift reports (v2/v3), and confidence decay on stale verification results. The learning system is entirely server-side and mostly deterministic -- only the v2 free-text interpretation path invokes an AI agent.

**Boundaries:** L7 does NOT extract claims (L1), map claims to code (L2), verify claims (L3), trigger scans (L4), format PR comments (L5), or serve docs via MCP (L6). L7 receives feedback signals and co-change data, and produces suppression rules and confidence adjustments consumed by other layers.

**MVP scope:** Quick-pick fast-path (deterministic, no LLM cost), count-based permanent exclusion for silent dismissals, co-change boost calculation, confidence decay, and suppression rule evaluation. Free-text agent interpretation (Path C) is a v2 feature -- the `feedback_interpretation` agent task type is defined in the API contracts but not invoked by MVP server code.

**Key design decisions:**
- Quick-pick actions are deterministic lookups (no agent call, zero LLM cost).
- Count-based exclusion threshold = 2 silent thumbs-down on the same claim (permanent, re-enters only on claim text change).
- `dismiss_all` carries 0x weight -- it is a UI convenience, not a learning signal.
- Co-change boost is denormalized into `claim_mappings.confidence` at mapping creation time (3C-001). L7 provides the boost value; L2 applies it.
- Suppression rules have expiration dates (90-180 days). No permanent suppression without explicit developer configuration.
- Suppression evaluation order: claim > file > claim_type > pattern (narrowest scope wins, checked first).

---

## 2. Dependencies

### 2.1 Consumes from

| Source | What | When |
|--------|------|------|
| L1 (ClaimExtractorService) | `updateVerificationStatus(claimId, status)` | After count-based exclusion marks a claim excluded |
| L4 (Worker) | Push scan data: `codeFiles[]`, `docFiles[]`, `commitSha` | `recordCoChanges` called during push scans |
| L5 (ReporterService) | Suppression check requests via `isClaimSuppressed` | Before formatting PR comment (filter suppressed findings) |
| PostgreSQL | `feedback`, `suppression_rules`, `co_changes`, `verification_results`, `claims` tables | All CRUD operations |
| GitHub webhook | Feedback reactions (thumbs up/down), suggestion accept/dismiss | Triggers `recordFeedback` via API endpoint |

### 2.2 Exposes to

| Consumer | Functions Called | When |
|----------|----------------|------|
| L2 (Mapper) | `getCoChangeBoost(repoId, codeFile, docFile)` | Boost mapping confidence at mapping creation/refresh |
| L4 (Worker) | `isClaimSuppressed(claim)` | Filter suppressed claims before verification |
| L4 (Worker) | `recordCoChanges(repoId, codeFiles, docFiles, commitSha)` | Push scan: record co-change patterns |
| L5 (Reporter) | `isClaimSuppressed(claim)` | Filter before formatting PR comment |
| API Server | `recordFeedback(feedback)` | Webhook/API endpoint for developer feedback |
| API Server | `processQuickPick(claimId, reason, repoId)` | After developer selects a quick-pick reason |
| API Server | `getActiveRules(repoId)` | Dashboard display, agent context for free-text interpretation |
| API Server | `getEffectiveConfidence(result)` | Display decayed confidence in reports/dashboard |
| L3 (Verifier) | `getEffectiveConfidence(result)` | Evaluate whether a prior verification result is still fresh |

Cross-layer call index (from phase4-api-contracts.md Section 15):
- L7 -> L1: `updateVerificationStatus` (after count-based exclusion)
- L2 -> L7: `getCoChangeBoost`
- L4 -> L7: `isClaimSuppressed`, `recordCoChanges`
- L5 -> L7: `isClaimSuppressed`

---

## 3. TypeScript Interfaces (conforming to phase4-api-contracts.md)

All types below are defined in `phase4-api-contracts.md` Section 9. This TDD references them; it does NOT redefine them.

**Referenced data types:**
- `FeedbackRecord` (Section 9.1) -- a single feedback event from a developer
- `SuppressionRule` (Section 9.1) -- a rule that suppresses specific claims/files/types from PR output
- `CoChangeRecord` (Section 9.1) -- a single co-change observation between a code file and doc file
- `FeedbackType` (Section 1) -- `'thumbs_up' | 'thumbs_down' | 'fix_accepted' | 'fix_dismissed' | 'all_dismissed'`
- `QuickPickReason` (Section 1) -- `'not_relevant_to_this_file' | 'intentionally_different' | 'will_fix_later' | 'docs_are_aspirational' | 'this_is_correct'`
- `SuppressionScope` (Section 1) -- `'claim' | 'file' | 'claim_type' | 'pattern'`
- `Claim` (Section 3.1) -- input claim with `claim_type`, `source_file`, `id`
- `VerificationResult` (Section 5.1) -- verification result with `confidence`, `created_at`

**Referenced database row types:**
- `FeedbackRow` (Section 12) -- feedback table row
- `SuppressionRuleRow` (Section 12) -- suppression_rules table row
- `CoChangeRow` (Section 12) -- co_changes table row
- `VerificationResultRow` (Section 12) -- verification_results table row

**Referenced service interfaces:**
- `LearningService` (Section 9.2) -- the full public API surface
- `ClaimExtractorService` (Section 3.2) -- `updateVerificationStatus` consumed by L7

**Layer-internal types** (not in api-contracts, specific to L7 implementation):

```typescript
/** Tracks silent dismissal counts per claim for count-based exclusion */
interface DismissalTracker {
  claim_id: string;
  count: number;                   // weighted count of silent dismissals
  pr_numbers: number[];            // PRs where dismissals occurred
  last_dismissed_at: Date;
}

/** Quick-pick action mapping result */
interface QuickPickAction {
  scope: SuppressionScope;
  target_claim_id: string | null;
  target_file: string | null;
  target_claim_type: ClaimType | null;
  target_pattern: string | null;
  reason: string;
  duration_days: number;
  source: 'quick_pick';
}

/** Result of suppression evaluation with match details */
interface SuppressionEvaluation {
  suppressed: boolean;
  matched_rule: SuppressionRule | null;
  scope_level: SuppressionScope | null;
  reason: string | null;
  expires_at: Date | null;
}

/** Co-change count aggregation used for boost calculation */
interface CoChangeAggregation {
  code_file: string;
  doc_file: string;
  count: number;                   // number of co-change commits in retention window
  most_recent_at: Date;
}

/** Configuration for learning behavior, loaded from .docalign.yml or defaults */
interface LearningConfig {
  count_based_threshold: number;         // default 2
  co_change_boost_cap: number;           // default 0.1
  co_change_boost_per_commit: number;    // default 0.02
  co_change_retention_days: number;      // default 180
  confidence_decay_half_life_days: number; // default 180
  stale_threshold_days: number;          // default 30
  quick_pick_migration_expiry_days: number; // default 90
  quick_pick_stale_expiry_days: number;    // default 90
  quick_pick_dont_care_expiry_days: number; // default 180
  quick_pick_false_positive_expiry_days: number; // default 180
}
```

---

## 4. Public API

### 4.1 recordFeedback

#### Signature

```typescript
recordFeedback(feedback: Omit<FeedbackRecord, 'id' | 'created_at'>): Promise<FeedbackRecord>
```

#### Algorithm (pseudocode)

```
function recordFeedback(feedback):
  // Validate required fields
  if feedback.repo_id is null OR feedback.claim_id is null:
    throw DOCALIGN_E401 "repo_id and claim_id are required"
  if feedback.feedback_type is null OR feedback.feedback_type not in FeedbackType:
    throw DOCALIGN_E401 "Invalid feedback_type"

  // Create the record
  record = {
    id: generateUUID(),
    ...feedback,
    created_at: NOW()
  }

  INSERT INTO feedback VALUES (record)

  // Side effects based on feedback_type
  switch feedback.feedback_type:

    case 'thumbs_down':
      if feedback.quick_pick_reason is not null:
        // Developer selected a quick-pick -- handled separately via processQuickPick
        // This path records the raw feedback only; processQuickPick creates the rule
        // The API endpoint calls recordFeedback THEN processQuickPick
        pass
      else:
        // Silent dismissal (no reason given)
        // Increment count-based tracker
        await incrementDismissalCount(feedback.claim_id, feedback.pr_number)

    case 'all_dismissed':
      // 0x weight -- not a learning signal
      // Record only for audit trail, no further action
      pass

    case 'thumbs_up':
      // Positive signal -- check if this challenges any suppression rules
      await checkPositiveFeedbackRevocation(feedback.claim_id, feedback.repo_id)

    case 'fix_accepted':
      // Fix was applied -- positive signal about finding quality
      // No suppression action. Record only.
      pass

    case 'fix_dismissed':
      // Fix dismissed but finding acknowledged -- ambiguous signal
      // Treat same as bare thumbs_down for count purposes
      await incrementDismissalCount(feedback.claim_id, feedback.pr_number)

  return record
```

**Helper: `incrementDismissalCount`:** Queries `SELECT COUNT(*) FROM feedback WHERE claim_id = $1 AND feedback_type IN ('thumbs_down','fix_dismissed') AND quick_pick_reason IS NULL`. If count >= threshold (default 2), calls `checkCountBasedExclusion(claimId)`.

**Helper: `checkPositiveFeedbackRevocation`:** Finds active suppression rules for this claim (scope='claim', not revoked, not expired). For each rule, counts thumbs_up feedback since `rule.created_at`. If positive count >= 2, revokes the rule (`UPDATE suppression_rules SET revoked = true`).

#### Input/Output Example 1 (thumbs_down with quick-pick)

```
Input:  { repo_id: "repo-uuid-001", claim_id: "claim-uuid-042",
          verification_result_id: "vr-uuid-099", feedback_type: "thumbs_down",
          quick_pick_reason: "will_fix_later", free_text: null,
          github_user: "dev-alice", pr_number: 107 }

Output: { id: "fb-uuid-001", ...input, created_at: "2026-02-11T14:30:00Z" }

Side effect: None (quick-pick processing handled by separate processQuickPick call)
```

#### Input/Output Example 2 (silent thumbs_down, first dismissal)

```
Input:  { repo_id: "repo-uuid-001", claim_id: "claim-uuid-055",
          verification_result_id: "vr-uuid-110", feedback_type: "thumbs_down",
          quick_pick_reason: null, free_text: null,
          github_user: "dev-bob", pr_number: 112 }

Output: { id: "fb-uuid-002", ...input, created_at: "2026-02-11T15:00:00Z" }

Side effect: Dismissal count for claim-uuid-055 incremented to 1. Threshold (2) not met.
```

#### Negative Example (invalid feedback_type)

```
Input:
  feedback: {
    repo_id: "repo-uuid-001",
    claim_id: "claim-uuid-042",
    verification_result_id: "vr-uuid-099",
    feedback_type: "maybe",
    quick_pick_reason: null,
    free_text: null,
    github_user: "dev-alice",
    pr_number: 107
  }

Output: throws DocAlignError {
  code: "DOCALIGN_E401",
  message: "Invalid feedback_type: 'maybe'. Expected one of: thumbs_up, thumbs_down, fix_accepted, fix_dismissed, all_dismissed",
  retryable: false
}
```

#### Edge Cases

- **Rapid duplicate clicks:** API endpoint debounces by claim_id + pr_number + feedback_type within 5 seconds.
- **Feedback on deleted claim:** Recorded (orphaned but harmless). No FK CASCADE on feedback.
- **`all_dismissed` + individual thumbs_down:** `all_dismissed` is 0x weight; individual thumbs_down counts normally.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Missing repo_id or claim_id | DOCALIGN_E401 | Return validation error, do not persist |
| Invalid feedback_type enum value | DOCALIGN_E401 | Return validation error |
| Database insert failure | DOCALIGN_E301 | Retry per connection profile, then fail |
| claim_id references non-existent claim | N/A | Insert succeeds (no FK constraint on feedback.claim_id to enable recording feedback for deleted claims) |

---

### 4.2 processQuickPick

#### Signature

```typescript
processQuickPick(claimId: string, reason: QuickPickReason, repoId: string): Promise<SuppressionRule | null>
```

#### Algorithm (pseudocode)

```
function processQuickPick(claimId, reason, repoId):
  // Look up the claim for context
  claim = SELECT * FROM claims WHERE id = claimId
  if claim is null:
    return null  // claim was deleted; no-op

  // Determine action based on quick-pick reason (deterministic lookup)
  action = quickPickActionMap(reason, claim)
  if action is null:
    return null  // reason does not produce a suppression rule

  // Check for existing active rule with same scope and target
  existing = SELECT * FROM suppression_rules
    WHERE repo_id = repoId
    AND scope = action.scope
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      (action.scope = 'claim' AND target_claim_id = action.target_claim_id) OR
      (action.scope = 'file' AND target_file = action.target_file) OR
      (action.scope = 'claim_type' AND target_claim_type = action.target_claim_type)
    )

  if existing is not null:
    // Rule already exists -- extend expiry if the new one would expire later
    newExpiry = NOW() + action.duration_days days
    if existing.expires_at is null OR newExpiry > existing.expires_at:
      UPDATE suppression_rules SET expires_at = newExpiry WHERE id = existing.id
    return existing

  // Create new suppression rule
  rule = {
    id: generateUUID(),
    repo_id: repoId,
    scope: action.scope,
    target_claim_id: action.target_claim_id,
    target_file: action.target_file,
    target_claim_type: action.target_claim_type,
    target_pattern: action.target_pattern,
    reason: action.reason,
    source: 'quick_pick',
    expires_at: NOW() + action.duration_days days,
    revoked: false,
    created_at: NOW()
  }

  INSERT INTO suppression_rules VALUES (rule)
  return rule
```

**Quick-pick action mapping** (see Appendix A for full taxonomy):

```
function quickPickActionMap(reason, claim): QuickPickAction | null
  switch reason:
    case 'not_relevant_to_this_file':
      return { scope: 'claim', target_claim_id: claim.id,
        reason: "Not relevant to this file", duration_days: 180 }
    case 'intentionally_different':
      return { scope: 'claim', target_claim_id: claim.id,
        reason: "Intentionally different from docs", duration_days: 90 }
    case 'will_fix_later':
      return { scope: 'claim', target_claim_id: claim.id,
        reason: "Known issue, will fix later", duration_days: 90 }
    case 'docs_are_aspirational':
      return { scope: 'file', target_file: claim.source_file,
        reason: "Doc file is aspirational (not current reality)", duration_days: 90 }
    case 'this_is_correct':
      return { scope: 'claim', target_claim_id: claim.id,
        reason: "False positive -- docs are correct", duration_days: 180 }
  // All actions have source: 'quick_pick'. Null fields omitted for brevity.
```

#### Input/Output Example 1 (will_fix_later -- creates claim suppression)

```
Input:  claimId: "claim-uuid-042", reason: "will_fix_later", repoId: "repo-uuid-001"
  (claim lookup: { id: "claim-uuid-042", source_file: "README.md", claim_type: "dependency_version" })

Output: { id: "sr-uuid-001", repo_id: "repo-uuid-001", scope: "claim",
  target_claim_id: "claim-uuid-042", reason: "Known issue, will fix later",
  source: "quick_pick", expires_at: "2026-05-12T14:30:00Z", revoked: false }
```

#### Input/Output Example 2 (docs_are_aspirational -- creates file suppression)

```
Input:  claimId: "claim-uuid-088", reason: "docs_are_aspirational", repoId: "repo-uuid-001"
  (claim lookup: { id: "claim-uuid-088", source_file: "docs/future-api.md", claim_type: "api_route" })

Output: { id: "sr-uuid-002", repo_id: "repo-uuid-001", scope: "file",
  target_file: "docs/future-api.md", reason: "Doc file is aspirational (not current reality)",
  source: "quick_pick", expires_at: "2026-05-12T15:00:00Z", revoked: false }
```

#### Negative Example (deleted claim)

```
Input:
  claimId: "claim-uuid-999"   // claim was deleted by re-extraction
  reason: "will_fix_later"
  repoId: "repo-uuid-001"

Output: null

Explanation: Claim not found in database. No rule created. Returns null.
```

#### Edge Cases

- **Duplicate quick-pick on same claim:** If an active rule already covers this claim with the same scope, the expiry is extended (not duplicated). This prevents rule table bloat from repeated dismissals.
- **Quick-pick on already-suppressed claim:** If the claim is suppressed by a broader rule (e.g., file-level), the new claim-level rule is still created. Both rules are active. The claim-level rule provides more specific documentation of intent.
- **Quick-pick reason `docs_are_aspirational` on a file with 200 claims:** Creates one file-level suppression rule. All 200 claims are suppressed via `isClaimSuppressed` checking the file scope. No per-claim rules needed.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Database query failure | DOCALIGN_E301 | Retry per connection profile, then return null |
| Claim not found | N/A | Return null (no rule created) |
| Unknown quick_pick reason | DOCALIGN_E401 | Validated by Zod at API boundary; should not reach this function |

---

### 4.3 checkCountBasedExclusion

#### Signature

```typescript
checkCountBasedExclusion(claimId: string): Promise<boolean>
```

#### Algorithm (pseudocode)

```
function checkCountBasedExclusion(claimId):
  // Count silent thumbs-down and fix-dismissed on this claim
  // (no quick_pick_reason = silent dismissal)
  count = SELECT COUNT(*) FROM feedback
    WHERE claim_id = claimId
    AND feedback_type IN ('thumbs_down', 'fix_dismissed')
    AND quick_pick_reason IS NULL

  // Note: all_dismissed (feedback_type = 'all_dismissed') is excluded (0x weight)

  if count < config.count_based_threshold:  // default 2
    return false

  // Check if already excluded
  existing = SELECT * FROM suppression_rules
    WHERE target_claim_id = claimId
    AND scope = 'claim'
    AND source = 'count_based'
    AND revoked = false

  if existing is not null:
    return true  // already excluded

  // Get claim's repo_id for the rule
  claim = SELECT repo_id FROM claims WHERE id = claimId
  if claim is null:
    return false

  // Gather PR numbers for the reason string
  prNumbers = SELECT DISTINCT pr_number FROM feedback
    WHERE claim_id = claimId
    AND feedback_type IN ('thumbs_down', 'fix_dismissed')
    AND quick_pick_reason IS NULL
    AND pr_number IS NOT NULL

  // Create permanent suppression rule (no expiry)
  rule = {
    id: generateUUID(),
    repo_id: claim.repo_id,
    scope: 'claim',
    target_claim_id: claimId,
    target_file: null,
    target_claim_type: null,
    target_pattern: null,
    reason: "Silently dismissed {count} times (PRs: {prNumbers.join(', ')})",
    source: 'count_based',
    expires_at: null,  // permanent -- re-enters only on claim text change
    revoked: false,
    created_at: NOW()
  }

  INSERT INTO suppression_rules VALUES (rule)

  // Notify L1 to mark claim as excluded from verification
  await L1.updateVerificationStatus(claimId, 'pending')

  return true
```

#### Input/Output Example 1 (threshold met -- exclusion created)

```
Input:
  claimId: "claim-uuid-055"

  (feedback table has 2 rows for this claim:
    { feedback_type: "thumbs_down", quick_pick_reason: null, pr_number: 112 }
    { feedback_type: "thumbs_down", quick_pick_reason: null, pr_number: 118 })

Output: true

Side effect: SuppressionRule created with scope='claim', source='count_based',
  reason="Silently dismissed 2 times (PRs: 112, 118)", expires_at=null
```

#### Input/Output Example 2 (threshold not met)

```
Input:
  claimId: "claim-uuid-070"

  (feedback table has 1 row for this claim:
    { feedback_type: "thumbs_down", quick_pick_reason: null, pr_number: 115 })

Output: false

Side effect: None. Count is 1, threshold is 2.
```

#### Negative Example (dismiss-all does not count)

```
Input:
  claimId: "claim-uuid-080"

  (feedback table has 3 rows for this claim:
    { feedback_type: "all_dismissed", pr_number: 100 }
    { feedback_type: "all_dismissed", pr_number: 105 }
    { feedback_type: "thumbs_down", quick_pick_reason: null, pr_number: 110 })

Output: false

Explanation: Only 1 silent thumbs-down counts. The 2 all_dismissed have 0x weight.
Threshold (2) not met.
```

#### Edge Cases

- **Claim text changes:** L1 re-extraction creates a new claim ID. Old rule references old ID. New claim re-enters checking (intended behavior).
- **Mixed explained/unexplained dismissals:** Only `quick_pick_reason IS NULL` rows count. Explained dismissals handled separately by `processQuickPick`.
- **Both quick-pick and count-based rules:** Independent systems. Permanent count-based rule takes over when quick-pick rule expires.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Database query failure | DOCALIGN_E301 | Retry, return false on exhaustion (safe default: do not exclude) |
| L1.updateVerificationStatus fails | DOCALIGN_E301 | Log warning, continue. Rule is still created. Status update will happen on next scan. |

---

### 4.4 isClaimSuppressed

#### Signature

```typescript
isClaimSuppressed(claim: Claim): Promise<boolean>
```

#### Algorithm (pseudocode)

```
function isClaimSuppressed(claim):
  // Evaluate suppression rules in order of specificity (narrowest first)
  // See Appendix D for full evaluation order

  // === Level 1: Claim-level suppression ===
  claimRule = SELECT * FROM suppression_rules
    WHERE repo_id = claim.repo_id
    AND scope = 'claim'
    AND target_claim_id = claim.id
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1

  if claimRule is not null:
    return true

  // === Level 2: File-level suppression ===
  fileRule = SELECT * FROM suppression_rules
    WHERE repo_id = claim.repo_id
    AND scope = 'file'
    AND target_file = claim.source_file
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1

  if fileRule is not null:
    return true

  // === Level 3: Claim-type suppression ===
  typeRule = SELECT * FROM suppression_rules
    WHERE repo_id = claim.repo_id
    AND scope = 'claim_type'
    AND target_claim_type = claim.claim_type
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1

  if typeRule is not null:
    return true

  // === Level 4: Pattern suppression (v2) ===
  patternRules = SELECT * FROM suppression_rules
    WHERE repo_id = claim.repo_id
    AND scope = 'pattern'
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > NOW())

  for rule in patternRules:
    if claim.claim_text matches rule.target_pattern:
      return true

  return false
```

#### Input/Output Example 1 (claim suppressed by claim-level rule)

```
Input:  claim: { id: "claim-uuid-042", repo_id: "repo-uuid-001", source_file: "README.md",
          claim_type: "dependency_version", claim_text: "Uses React 17.0.2" }
  (rule exists: scope="claim", target_claim_id="claim-uuid-042", revoked=false, expires_at="2026-05-12")
Output: true
```

#### Input/Output Example 2 (claim not suppressed)

```
Input:  claim: { id: "claim-uuid-100", repo_id: "repo-uuid-001", source_file: "docs/api.md",
          claim_type: "api_route", claim_text: "POST /api/v2/users" }
  (no matching suppression_rules)
Output: false
```

#### Negative Example (expired rule does not suppress)

```
Input:  claim: { id: "claim-uuid-042", repo_id: "repo-uuid-001", ... }
  (rule exists: scope="claim", target_claim_id="claim-uuid-042", expires_at="2026-01-01") // expired
Output: false
```

#### Edge Cases

- **Multiple matching scopes:** Returns true on first match (claim-level checked first). Matched rule not exposed via boolean API.
- **Revoked rule:** `revoked = true` excluded from all queries permanently.
- **Pattern matching (v2):** No pattern rules in MVP. Query runs but returns zero matches.
- **High-volume repos (>100 rules):** Load all active rules once at scan start, evaluate in-memory.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Database query failure | DOCALIGN_E301 | Retry, return false on exhaustion (safe default: do not suppress -- show the finding) |
| claim.repo_id is null | DOCALIGN_E401 | Return false (cannot evaluate without repo scope) |

---

### 4.5 getActiveRules

#### Signature

```typescript
getActiveRules(repoId: string): Promise<SuppressionRule[]>
```

#### Algorithm (pseudocode)

```
function getActiveRules(repoId):
  rules = SELECT * FROM suppression_rules
    WHERE repo_id = repoId
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY scope ASC, created_at DESC

  return rules
```

#### Input/Output Example 1 (repo with active rules)

```
Input:  repoId: "repo-uuid-001"
Output: [
  { id: "sr-uuid-001", scope: "claim", target_claim_id: "claim-uuid-042",
    reason: "Known issue, will fix later", source: "quick_pick", expires_at: "2026-05-12" },
  { id: "sr-uuid-002", scope: "file", target_file: "docs/future-api.md",
    reason: "Doc file is aspirational", source: "quick_pick", expires_at: "2026-05-12" }
]
```

#### Input/Output Example 2 (empty)

```
Input:  repoId: "repo-uuid-002"
Output: []
```

#### Negative Example (revoked and expired rules excluded)

```
Input:  repoId: "repo-uuid-003"
  (3 rules: sr-1 revoked, sr-2 expired 2025-12-01, sr-3 active expires 2026-12-01)
Output: [ { id: "sr-3", ... } ]   // only sr-3 is active
```

#### Edge Cases

- **Repo with hundreds of rules:** Returns all active rules without pagination for MVP. If repos accumulate >500 active rules, add pagination in v2.
- **NULL expires_at:** Rules with `expires_at = null` are permanent (count-based exclusion) and always included.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Database query failure | DOCALIGN_E301 | Retry, return empty array on exhaustion |
| Invalid repoId | N/A | Returns empty array (no matching rows) |

---

### 4.6 recordCoChanges

#### Signature

```typescript
recordCoChanges(repoId: string, codeFiles: string[], docFiles: string[], commitSha: string): Promise<void>
```

#### Algorithm (pseudocode)

```
function recordCoChanges(repoId, codeFiles, docFiles, commitSha):
  // Only record if BOTH code and doc files changed in the same commit
  if codeFiles.length == 0 OR docFiles.length == 0:
    return  // no co-change to record

  // Create cross-product of code files x doc files
  records = []
  for codeFile in codeFiles:
    for docFile in docFiles:
      records.push({
        id: generateUUID(),
        repo_id: repoId,
        code_file: codeFile,
        doc_file: docFile,
        commit_sha: commitSha,
        committed_at: NOW(),
        created_at: NOW()
      })

  // Batch insert with ON CONFLICT DO NOTHING
  // (dedup on repo_id + code_file + doc_file + commit_sha)
  INSERT INTO co_changes VALUES (records...)
    ON CONFLICT (repo_id, code_file, doc_file, commit_sha) DO NOTHING
```

#### Input/Output Example 1 (code and docs changed together)

```
Input:
  repoId: "repo-uuid-001"
  codeFiles: ["src/auth/handler.ts", "src/auth/types.ts"]
  docFiles: ["docs/auth.md"]
  commitSha: "abc123def456"

Output: void (no return value)

Side effect: 2 rows inserted into co_changes:
  { code_file: "src/auth/handler.ts", doc_file: "docs/auth.md", commit_sha: "abc123def456" }
  { code_file: "src/auth/types.ts", doc_file: "docs/auth.md", commit_sha: "abc123def456" }
```

#### Input/Output Example 2 (only code files changed, no docs)

```
Input:
  repoId: "repo-uuid-001"
  codeFiles: ["src/api/routes.ts"]
  docFiles: []
  commitSha: "def789abc012"

Output: void

Side effect: No rows inserted. docFiles is empty, so no co-change exists.
```

#### Negative Example (duplicate commit SHA)

```
Input:
  repoId: "repo-uuid-001"
  codeFiles: ["src/auth/handler.ts"]
  docFiles: ["docs/auth.md"]
  commitSha: "abc123def456"  // same commit as Example 1

Output: void

Side effect: INSERT with ON CONFLICT DO NOTHING. No duplicate rows created.
```

#### Edge Cases

- **Large cross-product:** 20 code + 5 doc files = 100 records. Acceptable; 180-day purge bounds growth. Cap at 100 in v2 if needed.
- **Renamed files:** Uses new paths. Old paths cleaned by purge.
- **Code/doc overlap:** L4 classifies files before calling this function. No overlap expected.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Database insert failure | DOCALIGN_E301 | Retry, then log warning and return. Co-change recording is non-critical; scan continues. |
| Constraint violation (unique) | N/A | ON CONFLICT DO NOTHING handles this silently |

---

### 4.7 getCoChangeBoost

#### Signature

```typescript
getCoChangeBoost(repoId: string, codeFile: string, docFile: string): Promise<number>
```

#### Algorithm (pseudocode)

```
function getCoChangeBoost(repoId, codeFile, docFile):
  // Count co-change commits within retention window (180 days)
  count = SELECT COUNT(*) FROM co_changes
    WHERE repo_id = repoId
    AND code_file = codeFile
    AND doc_file = docFile
    AND committed_at > NOW() - INTERVAL '180 days'

  // Linear scaling: 0.02 per co-change commit, capped at 0.1
  // 0 co-changes = 0.0 boost
  // 1 co-change  = 0.02 boost
  // 3 co-changes = 0.06 boost
  // 5+ co-changes = 0.1 boost (cap)
  boost = min(count * config.co_change_boost_per_commit, config.co_change_boost_cap)

  return boost
```

**Formula:** `boost = min(count * 0.02, 0.1)` (see Appendix C for derivation)

#### Input/Output Example 1 (3 co-changes -- partial boost)

```
Input:
  repoId: "repo-uuid-001"
  codeFile: "src/auth/handler.ts"
  docFile: "docs/auth.md"

  (co_changes has 3 records for this pair within 180 days)

Output: 0.06
```

#### Input/Output Example 2 (7 co-changes -- capped at 0.1)

```
Input:
  repoId: "repo-uuid-001"
  codeFile: "src/api/routes.ts"
  docFile: "README.md"

  (co_changes has 7 records for this pair within 180 days)

Output: 0.1
```

#### Negative Example (no co-changes)

```
Input:
  repoId: "repo-uuid-001"
  codeFile: "src/utils/format.ts"
  docFile: "docs/auth.md"

  (co_changes has 0 records for this pair)

Output: 0.0
```

#### Edge Cases

- **Expired co-changes:** Records older than 180 days are excluded from the count. The weekly purge job deletes them, but the query also filters by `committed_at` for correctness even before purge runs.
- **Boost consumed at mapping creation (3C-001):** The boost value returned here is added to `ClaimMapping.confidence` by L2 at mapping creation time. It is NOT applied dynamically at verification time. If co-change count changes between mapping creation and verification, the mapping retains the old boost until refreshed.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| Database query failure | DOCALIGN_E301 | Retry, return 0.0 on exhaustion (safe default: no boost) |

---

### 4.8 getEffectiveConfidence

#### Signature

```typescript
getEffectiveConfidence(result: VerificationResult): number
```

#### Algorithm (pseudocode)

```
function getEffectiveConfidence(result):
  // Calculate days since verification
  daysSince = daysBetween(result.created_at, NOW())

  // Exponential decay with configurable half-life (default 180 days)
  // At 0 days: factor = 1.0
  // At 180 days (half-life): factor = 0.5
  // At 360 days: factor = 0.25
  halfLife = config.confidence_decay_half_life_days  // default 180
  decayFactor = Math.exp(-daysSince * Math.LN2 / halfLife)

  effectiveConfidence = result.confidence * decayFactor

  // Floor at 0.0 (no negative confidence)
  return max(effectiveConfidence, 0.0)
```

**Formula:** `effective = confidence * e^(-days * ln(2) / 180)` (see Appendix D for derivation)

#### Input/Output Example 1 (fresh result -- minimal decay)

```
Input:  result: { confidence: 0.95, created_at: "2026-02-10T10:00:00Z" }  // 1 day ago
Output: 0.9464   // decay factor = 0.9962
```

#### Input/Output Example 2 (180-day-old result -- half confidence)

```
Input:  result: { confidence: 0.90, created_at: "2025-08-15T10:00:00Z" }  // ~180 days ago
Output: 0.45     // decay factor = 0.5 (half-life)
```

#### Negative Example (very old result -- near-zero)

```
Input:  result: { confidence: 0.85, created_at: "2024-02-11T10:00:00Z" }  // ~730 days ago
Output: 0.051    // decay factor = 0.06
```

#### Edge Cases

- **Result from today:** Decay factor 1.0. Effective = raw confidence.
- **Confidence 0.0:** Always returns 0.0 regardless of age.
- **Null created_at:** Return `result.confidence` unmodified; log warning.
- **Stale threshold:** Caller (L4) checks if effective confidence is below threshold for re-verification priority.

#### Error Handling

| Error | Code | Handling |
|-------|------|----------|
| result.created_at is null | DOCALIGN_E401 | Log warning, return result.confidence unmodified |
| Negative daysSince (future date) | N/A | Treat as 0 days (no decay). Log warning. |

---

## 5. Performance Targets

| Operation | Target | Constraint |
|-----------|--------|------------|
| `recordFeedback` | < 50ms | Single INSERT, no complex joins |
| `processQuickPick` | < 100ms | 1 SELECT (claim lookup) + 1 SELECT (existing rule) + 1 INSERT |
| `checkCountBasedExclusion` | < 100ms | 1 COUNT query + conditional INSERT |
| `isClaimSuppressed` | < 20ms per claim | 3-4 indexed queries against suppression_rules. For batch use (L4 filtering 50 claims), < 500ms total via query batching |
| `getActiveRules` | < 100ms | Single indexed query |
| `recordCoChanges` | < 200ms for 100 records | Batch INSERT |
| `getCoChangeBoost` | < 10ms | Single COUNT query on indexed columns |
| `getEffectiveConfidence` | < 1ms | Pure computation, no database access |
| Suppression rule table growth | < 1000 active rules per repo | Expiration ensures natural cleanup |
| Co-change table growth | < 50,000 records per repo | 180-day retention purge |

**Batch optimization for `isClaimSuppressed`:** When L4 needs to check suppression for all claims in a scan (typically 20-50 claims), load all active rules for the repo once, then evaluate each claim in-memory. This reduces from N*4 queries to 1 query + N in-memory evaluations.

---

## 6. Required Framework Knowledge

### 6.1 PostgreSQL Query Patterns

- **Parameterized count:** `SELECT COUNT(*) FROM feedback WHERE claim_id = $1 AND feedback_type = ANY($2) AND quick_pick_reason IS NULL`
- **Upsert:** `INSERT INTO suppression_rules ... ON CONFLICT DO UPDATE SET expires_at = GREATEST(expires_at, EXCLUDED.expires_at)`
- **Idempotent batch insert:** `INSERT INTO co_changes ... ON CONFLICT DO NOTHING`
- **Retention filter:** `committed_at > NOW() - INTERVAL '180 days'`
- **Dedup index:** `CREATE UNIQUE INDEX idx_co_changes_dedup ON co_changes(repo_id, code_file, doc_file, commit_sha)`

### 6.2 Suppression Rule Indexes

Required indexes for efficient `isClaimSuppressed` evaluation:

```sql
CREATE INDEX idx_suppression_repo_claim ON suppression_rules(repo_id, scope, target_claim_id)
  WHERE revoked = false;
CREATE INDEX idx_suppression_repo_file ON suppression_rules(repo_id, scope, target_file)
  WHERE revoked = false;
CREATE INDEX idx_suppression_repo_type ON suppression_rules(repo_id, scope, target_claim_type)
  WHERE revoked = false;
```

Partial indexes (WHERE revoked = false) exclude revoked rules from the index, keeping it compact.

### 6.3 Co-change Purge Job

A weekly BullMQ scheduled job purges expired co-change records:

```sql
DELETE FROM co_changes WHERE committed_at < NOW() - INTERVAL '180 days';
```

This runs during low-traffic periods. The 180-day retention is configurable via `COCHANGE_RETENTION_DAYS` env var.

### 6.4 Exponential Decay Computation

The confidence decay uses `Math.exp()` (natural exponential) with the half-life formula. This is a pure computation with no framework dependencies. The key constant: `Math.LN2 / halfLifeDays` gives the decay rate constant.

### 6.5 Transaction Requirements

- `processQuickPick`: SELECT + conditional INSERT should use a transaction to prevent duplicate rules from concurrent requests.
- `checkCountBasedExclusion`: COUNT + conditional INSERT should use a transaction for the same reason.
- `recordCoChanges`: Batch INSERT does not need a transaction (ON CONFLICT DO NOTHING makes it idempotent).
- `recordFeedback`: Single INSERT does not need a transaction (side effects are triggered asynchronously).

---

## 7. Open Questions

### OQ-1: Spot-Check Scheduling Mechanism

How is the periodic spot-check triggered? **Current thinking:** BullMQ repeating job queries daily for rules due for spot-check (`next_spot_check_at` column). Selects one suppressed finding per eligible rule and marks for display on next PR scan with `[Spot check]` marker. **Impact:** Affects L4 and L5 integration; defer to TDD-4/TDD-5.

### OQ-2: Free-Text Agent Interpretation Integration (v2)

How does `feedback_interpretation` agent task result flow back into rule creation? **Current thinking:** Server creates task per phase4-api-contracts.md Section 10.2. Action returns `FeedbackInterpretationResult`. Server applies each action in the result handler. **Impact:** v2 only; types already defined in API contracts.

### OQ-3: Cross-TDD Suppression Cache Invalidation

What if rules change mid-scan? **Current thinking:** Accept eventual consistency. Rules created during a scan take effect on the next scan (1-10 minute window). **Impact:** None; document as known behavior.

### OQ-4: Suppression Rule Conflict Resolution

Should spot-check thumbs-up revoke on first signal or require 2? **Current thinking:** Maintain 2-signal threshold uniformly. Accidental thumbs-up should not destroy valid rules. Developer can click "Undo" for immediate revocation. **Impact:** None.

---

## Appendix A: Quick-Pick Reason Taxonomy

The five quick-pick reasons map to specific suppression actions. All quick-pick processing is deterministic (no LLM call).

| QuickPickReason | User-Facing Label | Suppression Scope | Duration | Rationale |
|-----------------|-------------------|-------------------|----------|-----------|
| `not_relevant_to_this_file` | "Not relevant to this file" | claim | 180 days | The claim-to-code mapping is wrong; the claim exists in the doc but does not relate to the flagged code file. Suppress the specific claim. |
| `intentionally_different` | "Intentionally different (migration, experiment)" | claim | 90 days | The code intentionally diverges from docs temporarily. Short expiry because the situation should resolve. |
| `will_fix_later` | "We know, will fix the docs later" | claim | 90 days | Team acknowledges the drift but cannot fix now. Short expiry to prompt eventual action. |
| `docs_are_aspirational` | "Docs describe planned behavior" | file | 90 days | The entire doc file describes future state, not current reality. File-level suppression. Short expiry because aspirational docs should eventually become accurate or be removed. |
| `this_is_correct` | "Finding is wrong (docs are correct)" | claim | 180 days | False positive. The verification was incorrect. Longer expiry because the extraction/verification logic needs improvement, not the docs. |

**Design notes:** Only `docs_are_aspirational` creates a file-level rule (inherently file-scoped). No quick-pick creates claim_type or pattern rules (those require free-text, v2). Duration values configurable via `LearningConfig`.

---

## Appendix B: Count-Based Exclusion Logic

### B.1 What Counts

| Feedback Type | Weight | Counts Toward Threshold? |
|---------------|--------|-------------------------|
| `thumbs_down` (no quick_pick_reason) | 1 | Yes |
| `fix_dismissed` | 1 | Yes (treating fix dismissal as disagreement with the finding) |
| `thumbs_down` (with quick_pick_reason) | 0 | No (handled by processQuickPick instead) |
| `thumbs_up` | 0 | No (positive signal, checked for revocation) |
| `fix_accepted` | 0 | No (positive signal) |
| `all_dismissed` | 0 | No (0x weight, UI convenience only) |

### B.2 Threshold and Permanence

- **Threshold:** 2 silent dismissals (configurable via `count_based_threshold`).
- **Permanence:** Count-based exclusion has `expires_at = null` (permanent). The claim re-enters checking only when:
  1. The claim text changes (L1 re-extraction creates a new claim ID; the old suppression rule references the old ID and does not apply).
  2. A developer explicitly revokes the rule via the "Undo" button.
  3. Two positive feedback signals (`thumbs_up`) on the same claim trigger automatic revocation.

### B.3 Why Permanent (Not Expiring)

Two unexplained dismissals are strong evidence the finding has no value. If the docs change, L1 re-extraction creates a new claim ID, making the old rule inert (natural re-entry). Adding an expiry would create a dismiss-resurface-redismiss cycle with no benefit.

---

## Appendix C: Co-Change Boost Formula

### C.1 Formula

```
boost = min(count * boost_per_commit, boost_cap)
```

Where:
- `count` = number of commits where both `code_file` and `doc_file` changed together within the retention window (180 days).
- `boost_per_commit` = 0.02 (configurable via `co_change_boost_per_commit`).
- `boost_cap` = 0.1 (configurable via `co_change_boost_cap`).

### C.2 Boost Curve

| Co-Change Count | Boost Value |
|-----------------|-------------|
| 0 | 0.00 |
| 1 | 0.02 |
| 2 | 0.04 |
| 3 | 0.06 |
| 4 | 0.08 |
| 5+ | 0.10 (cap) |

### C.3 Application Point (3C-001)

The boost is calculated by L7 (`getCoChangeBoost`) and applied by L2 (`mapClaim`) at mapping creation time:

```
final_confidence = min(base_confidence + co_change_boost, 1.0)
```

The boost is stored in `claim_mappings.co_change_boost` for auditability and in `claim_mappings.confidence` as the combined value.

### C.4 Retention and Purge

Co-change records older than 180 days are purged by a weekly BullMQ job:

```sql
DELETE FROM co_changes WHERE committed_at < NOW() - INTERVAL '180 days';
```

The purge does NOT affect already-computed boosts in `claim_mappings.confidence` (3C-001 denormalization). When a mapping is refreshed, the boost is recalculated from surviving co_changes records.

### C.5 Why Linear (Not Logarithmic)

Linear scaling chosen for simplicity. The range is small (0 to 0.1) so the difference from log is negligible. "5 co-changes = max boost" is easy to reason about. The cap prevents any single pair from dominating mapping confidence.

---

## Appendix D: Confidence Decay Formula

### D.1 Formula

```
effective_confidence = raw_confidence * e^(-days_since_verification * ln(2) / half_life_days)
```

Where:
- `raw_confidence` = `VerificationResult.confidence` (0 to 1).
- `days_since_verification` = calendar days between `VerificationResult.created_at` and now.
- `half_life_days` = 180 (configurable via `confidence_decay_half_life_days`).
- `ln(2)` = `Math.LN2` = 0.6931...

### D.2 Decay Curve

| Days Since Verification | Decay Factor | Effective Confidence (if raw = 0.90) |
|------------------------|-------------|--------------------------------------|
| 0 | 1.000 | 0.900 |
| 7 | 0.973 | 0.876 |
| 30 | 0.891 | 0.802 |
| 60 | 0.794 | 0.715 |
| 90 | 0.707 | 0.637 |
| 120 | 0.630 | 0.567 |
| 150 | 0.561 | 0.505 |
| 180 | 0.500 | 0.450 |
| 270 | 0.354 | 0.318 |
| 360 | 0.250 | 0.225 |

### D.3 Stale Threshold

Claims not verified in 30+ days are flagged for re-verification during the next scheduled full scan. The 30-day threshold is based on the decay curve: at 30 days, effective confidence drops to ~89% of raw confidence, which is the point where re-verification adds meaningful value.

The stale threshold is separate from the decay formula -- it is a binary flag used by L4's scope resolver during scheduled scans:

```
is_stale = days_since_verification > config.stale_threshold_days  // default 30
```

### D.4 Why Exponential Decay (Not Linear)

Exponential decay matches intuition: confidence drops quickly in the first weeks, then slowly over months. "Halves every 6 months" is easy to explain. Unlike linear decay, it never reaches zero -- old results retain residual confidence rather than abruptly becoming worthless.

---

## Appendix E: Suppression Rule Evaluation Order

When checking if a claim is suppressed, rules are evaluated from narrowest to broadest scope. The first matching rule wins.

### E.1 Evaluation Order

```
1. scope = 'claim'      AND target_claim_id = claim.id
2. scope = 'file'        AND target_file = claim.source_file
3. scope = 'claim_type'  AND target_claim_type = claim.claim_type
4. scope = 'pattern'     AND claim.claim_text MATCHES target_pattern
```

### E.2 Why Narrowest First

Claim-level rules are the most specific signal and use a direct index scan (fast). Narrower rules are also easier to trace back to the originating feedback event during debugging.

### E.3 Multiple Rules at Same Scope

If multiple rules exist at the same scope level, the most recently created rule is authoritative (ORDER BY created_at DESC LIMIT 1). In practice, `processQuickPick` extends existing rules rather than creating duplicates.

### E.4 Interaction Between Scopes

| Scenario | Behavior |
|----------|----------|
| Claim rule (suppress) + File rule (suppress) | Claim rule matches first. Both are active but claim rule is the reported reason. |
| Claim rule (revoked) + File rule (active) | Claim rule does not match (revoked). File rule matches. Claim is suppressed by file rule. |
| No claim rule + File rule (active) | File rule matches. Claim is suppressed. |
| Claim rule (active) + No file rule | Claim rule matches. Claim is suppressed. |

### E.5 Config-Based Suppression (from .docalign.yml)

Suppressions defined in `.docalign.yml` (`claim_types`, `suppress[]`) are evaluated by L4 BEFORE calling `isClaimSuppressed`. They are NOT stored in `suppression_rules`. Evaluation order: `0. config-based (L4)` then `1-4. database rules (isClaimSuppressed)`.
