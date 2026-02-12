# Spike C: Learning Generalization

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 2: Research & Design Spikes

## 1. Problem Statement

**Context:** DocAlign posts verification findings on PRs when documentation drifts from code reality. Developers give feedback via GitHub reactions: thumbs up (good finding) or thumbs down (not useful). The learning system (Layer 7) must use this feedback to improve over time.

**The core challenge:** A thumbs-down is an ambiguous signal. The developer is saying "stop showing me this," but the system must determine *why* and decide *what corrective action* to take:

- **Under-correct:** Developer dismisses "README says bcrypt, code uses argon2" on PR #42. System suppresses only that exact finding. PR #43 shows the same finding. Repeat. Alert fatigue. Developer stops engaging.
- **Over-correct:** Developer dismisses a convention finding. System suppresses ALL convention findings. A legitimate violation is silently swallowed. Trust destroyed.

**The founder's insight:** Instead of guessing why from counts, *ask the developer why*. When a developer dismisses a finding, prompt them for a brief explanation. If they provide one, pass it to an AI agent that interprets the explanation and takes corrective action autonomously. If they do not, fall back to simple count-based suppression.

**Five questions this spike answers:**

1. How do we collect developer explanations without adding friction?
2. How does the AI agent interpret explanations and decide corrective actions?
3. What actions can the agent take, and what is the scope of each?
4. How does count-based suppression work as a fallback for silent dismissals?
5. How do we detect and recover from agent mistakes?

**Key design decision:** The AI agent acts immediately and autonomously. No developer approval gate. Speed of learning is prioritized over caution. Safety valves (expiration, spot-checks, undo) bound the risk.

---

## 2. Prior Art Survey

### 2.1 Bayesian Spam Filtering

Spam filters learn from "not spam" / "is spam" signals by updating token probabilities mechanically. They face the same ambiguous-negative-signal problem: marking "not spam" could mean "this sender is legitimate" or "this specific email was fine." The filter does not try to infer intent -- it lets aggregate statistics drive classification.

**Limitations:** Spam filters need thousands of signals to converge. DocAlign gets 5-50 dismissals per repo per month. At that volume, statistical convergence is too slow.

**Takeaway:** Pure statistical inference from counts works at scale but is too slow for low-volume feedback. Asking the developer for explicit intent accelerates learning: one explained dismissal gives what 5-10 unexplained dismissals would eventually reveal.

### 2.2 Alert Fatigue in Monitoring (PagerDuty, Datadog)

Monitoring systems use explicit suppression rules (user-defined), auto-muting (contextual signals like terminated resources), and scheduled downtimes. The key insight: rules are the most reliable mechanism, but operators write them manually.

**Takeaway:** Explicit rules are the right primitives layer. Instead of the developer writing rules manually, the developer explains their intent in natural language and an AI agent translates that into concrete suppression rules. This is the key innovation: natural-language-to-rule translation.

### 2.3 Implicit Feedback in Recommendation Systems

Recommendation systems learn from implicit signals (skips, short views) using confidence-weighted models and multi-granular negative feedback (dislike content vs. dislike creator vs. dislike format). The multi-granular approach maps directly to our quick-pick reasons: instead of inferring granularity from patterns, we ask directly.

**Takeaway:** Explicit reasons from the developer are strictly superior to implicit statistical inference at our data volumes. Count-based fallback is the mechanism of last resort.

### 2.4 Static Analysis False Positive Management (SonarQube, Semgrep)

Static analysis tools use per-issue resolution ("false positive," "won't fix") and inline suppression comments. They do NOT generalize from individual dismissals -- each dismissal is scoped exactly to that finding. This prevents over-suppression but forces developers to dismiss the same false positive repeatedly.

**Takeaway:** Start with the proven per-finding resolution model. Layer AI-driven generalization on top: the agent interprets the developer's reason and creates broader rules. SonarQube's safety with recommendation-system-level learning speed.

### 2.5 ML-Based Alert Prioritization (Security Operations)

SecOps uses ML to featurize alerts and learn dismissal patterns. One framework suppressed 54% of false positives while maintaining 95.1% detection. But this requires thousands of labeled examples and dedicated ML infrastructure.

**Takeaway:** At our data volume, an AI agent interpreting a natural-language explanation is more effective than training a model. The agent performs "one-shot learning" from a single explained dismissal.

---

## 3. Options Analysis

### 3.1 Option: Rule-Based Threshold Suppression (Counting Only)

Track dismissal counts per-claim, per-file, per-type. Suppress when thresholds are crossed.

**Pros:** Simple, deterministic, no LLM cost, tunable.
**Cons:** Cannot learn novel patterns. Requires multiple dismissals (slow). Cannot distinguish "false positive" from "migration in progress." Broad-scope suppression is risky from counts alone.
**Complexity:** 3-4 days | **Cost:** $0

### 3.2 Option: LLM-Inferred Rules from Raw Dismissals

Send finding context to an LLM on every dismissal, ask it to infer why and propose a rule. No developer input beyond thumbs-down.

**Pros:** Learns from every dismissal without developer effort.
**Cons:** Inference from a bare thumbs-down is highly ambiguous (LLM is guessing). May hallucinate overly broad rules. Expensive, non-deterministic. Developers cannot predict what rules will be created.
**Complexity:** 5-7 days | **Cost:** ~$0.002-0.005/finding

### 3.3 Option: Explanation-Driven + Agent Auto-Fix (Count-Based Fallback)

Prompt the developer "Why isn't this useful?" with quick-picks and optional free-text. If explanation provided, pass to AI agent that auto-applies corrective actions. If no explanation, fall back to per-claim count-based suppression (threshold = 2). **No approval gate.**

**Pros:** Developer intent is explicit. Quick-picks are one-click. Agent can take multiple actions. Learning happens on first explained dismissal. Count-based fallback handles lazy dismissals.
**Cons:** Some developers will never explain. Agent may occasionally over-correct. LLM cost per free-text explanation (~$0.003-0.01). No approval gate means wrong actions applied immediately.
**Complexity:** 5-6 days | **Cost:** ~$0.003-0.01 per explained dismissal, $0 for count fallback

### 3.4 Option: Same as 3.3 but with Developer Approval Gate

Agent proposes actions, developer must approve before they take effect.

**Pros:** No risk of wrong auto-applied actions.
**Cons:** Adds friction (many will ignore proposals). Learning delayed until approval, which may never come. Defeats the purpose of asking "why" if developer then has to review the fix too.
**Complexity:** 6-7 days | **Cost:** Same as 3.3

---

## 4. Recommendation

**Recommended: Option 3.3 -- Explanation-Driven + Agent Auto-Fix (Count-Based Fallback)**

1. **Direct intent beats statistical inference.** At 5-50 dismissals/month, counting needs weeks to converge. One explained dismissal gives the agent the same information immediately.

2. **Quick-picks make explanation zero-friction.** One click. Same effort as a bare thumbs-down.

3. **No approval gate because speed matters more than perfection.** Wrong actions are bounded by: 90-180 day expiration, monthly spot-checks, positive-feedback revocation, and developer undo.

4. **Count-based fallback is the safety net.** Developers who never explain still get per-claim suppression after 2 dismissals. Broader scopes require an explanation.

5. **The agent is the same configurable agent from Spike B.** No new infrastructure.

| Path | Trigger | Mechanism | Action scope |
|------|---------|-----------|--------------|
| **Explanation-driven** | Quick-pick or free-text | AI agent interprets, auto-applies | Any: suppress claim, mark file stale, update rule, suggest doc fix |
| **Count-based fallback** | Bare thumbs-down, no explanation | Deterministic counting (threshold = 2) | Per-claim only |

---

## 5. Detailed Specification

### 5.1 Feedback Collection UX

When a developer reacts thumbs-down, DocAlign shows a follow-up prompt (inline or collapsible):

```
Thanks for the feedback. Why isn't this useful? (optional -- pick one or explain)

> [ ] Migration in progress -- we know, it's temporary
> [ ] This doc file is known-stale -- we'll update it later
> [ ] We don't care about this type of check
> [ ] The finding is wrong (false positive)
> [ ] Other: _______________
```

| Quick-pick | Typical agent action |
|------------|---------------------|
| "Migration in progress" | Suppress this claim for 90 days |
| "Doc file is known-stale" | Lower severity for all findings in this file, 90-day expiry |
| "Don't care about this check" | Suppress this claim category repo-wide, 180 days |
| "Finding is wrong" | Suppress this claim for 180 days, flag for extraction review |

- Prompt appears only after thumbs-down. Thumbs-up triggers no prompt.
- Developer can ignore the prompt (no response = silent dismissal after 48h).
- Free-text is passed to the full AI agent with finding context.

### 5.2 Agent Corrective Action Interface

When the developer provides an explanation, DocAlign constructs a request to the AI agent (same configurable agent as Spike B).

```typescript
interface LearningCorrectionRequest {
  finding: {
    claim_id: string; claim_text: string; claim_type: string;
    source_file: string; code_files: string[];
    mismatch_description: string; severity: string;
  };
  explanation: {
    type: 'quick_pick' | 'free_text';
    quick_pick_id?: 'migration_in_progress' | 'doc_known_stale'
      | 'dont_care_about_check' | 'finding_is_wrong';
    free_text?: string;
  };
  repo: {
    repo_id: string;
    existing_suppression_rules: SuppressionRule[];
    recent_feedback_history: FeedbackSummary[];
  };
}

interface LearningCorrectionResponse {
  actions: CorrectionAction[];
  reasoning: string;  // stored for auditability
}

type CorrectionAction =
  | { type: 'suppress_claim'; claim_id: string;
      duration_days: number; reason: string }
  | { type: 'suppress_claim_type'; claim_type: string;
      scope: 'repo' | 'file_pattern'; file_pattern?: string;
      duration_days: number; reason: string }
  | { type: 'mark_file_stale'; source_file: string;
      duration_days: number; reason: string }
  | { type: 'update_static_rule'; rule_id: string;
      change_description: string; new_rule_spec: string; reason: string }
  | { type: 'suggest_doc_update'; source_file: string;
      suggested_text: string; reason: string }
  | { type: 'adjust_extraction'; source_file: string;
      adjustment: string; reason: string };
```

**v1 fast path:** Quick-picks use deterministic handling (no agent call). Only free-text invokes the full AI agent. This keeps cost near zero for the common case.

```typescript
function quickPickFastPath(pick: string, finding: FindingContext): CorrectionAction[] {
  switch (pick) {
    case 'migration_in_progress':
      return [{ type: 'suppress_claim', claim_id: finding.claim_id,
        duration_days: 90, reason: `Migration in progress (PR #${finding.pr_number})` }];
    case 'doc_known_stale':
      return [{ type: 'mark_file_stale', source_file: finding.source_file,
        duration_days: 90, reason: `Doc known-stale (PR #${finding.pr_number})` }];
    case 'dont_care_about_check':
      return [{ type: 'suppress_claim_type', claim_type: finding.claim_type,
        scope: 'repo', duration_days: 180,
        reason: `Team does not care about ${finding.claim_type} checks` }];
    case 'finding_is_wrong':
      return [{ type: 'suppress_claim', claim_id: finding.claim_id,
        duration_days: 180, reason: `False positive (PR #${finding.pr_number})` }];
  }
}
```

### 5.3 Count-Based Fallback (for Silent Dismissals)

When a developer gives a bare thumbs-down and ignores the prompt (or 48h expires), it is a silent dismissal.

| Scope | Threshold | Effect | Expiry |
|-------|-----------|--------|--------|
| Per-claim | 2 silent dismissals | **Permanently exclude** this specific claim from checking | None (permanent). Claim re-enters checking only if claim text changes (doc updated → fresh extraction). |

**No broader scopes from counts alone.** Per-file, per-type, and per-pattern suppression require an explanation. Two bare thumbs-downs on the same claim is moderate evidence that *this claim* is not useful, but says nothing about the file or claim type.

**Dismiss-all:** Gets 0x weight — does not count toward exclusion thresholds. Dismiss-all is a UI convenience for clearing a PR comment, not a meaningful learning signal. Only individual per-finding thumbs-down dismissals count.

```
FUNCTION onSilentDismissal(claim_id, weight, pr_number):
  IF weight == 0:
    RETURN  // dismiss-all, not a learning signal
  tracker = getOrCreate(claim_id)
  tracker.count += weight
  IF tracker.count >= 2.0 AND claim.status != 'excluded':
    markClaimExcluded(claim_id, {
      origin: 'count_based_fallback',
      reason: "Silently dismissed {tracker.count} times" })
    // Claim permanently excluded. Re-enters checking only if
    // claim text changes (doc updated → fresh extraction creates new claim).
```

### 5.4 Safety Valves

**Valve 1: Rule Expiration.** All auto-created rules expire. No permanent suppression without explicit developer configuration.

| Rule origin | Default expiry |
|-------------|---------------|
| Quick-pick: migration / doc-stale | 90 days |
| Quick-pick: don't care / false positive | 180 days |
| Agent-created (free-text) | 90-180 days (agent decides) |
| Count-based fallback | 180 days |

**Valve 2: Periodic Spot-Check.** Agent-created rules: every 14 days. Count-based rules: every 30 days. Both configurable. Un-suppress one finding and show with a `[Spot check]` marker. Developer thumbs-down confirms rule. Thumbs-up challenges it (increments revocation counter). No reaction = no change.

**Valve 3: Positive Feedback Override.** A thumbs-up on a finding that would have been suppressed increments `revocation_signals`. At 2 positive signals, the rule is revoked. Threshold of 2 prevents accidental thumbs-up from destroying valid rules.

**Valve 4: Developer Visibility and Undo.** Suppressed findings visible in collapsible section at bottom of PR comment with reason and days remaining. Developer can click "Undo" to deactivate any rule immediately.

### 5.5 Data Structures

```typescript
interface SuppressionRule {
  id: string; repo_id: string;
  scope: SuppressionScope;
  origin: 'explanation_quick_pick' | 'explanation_agent'
    | 'count_based_fallback' | 'developer_explicit';
  triggering_feedback_id: string;
  developer_explanation: string | null;
  agent_reasoning: string | null;
  created_at: Date; expires_at: Date | null;
  active: boolean; reason: string;
  suppression_count: number; revocation_signals: number;
  last_spot_check_at: Date | null;
  deactivated_reason: string | null;
}

type SuppressionScope =
  | { level: 'claim'; claim_id: string }
  | { level: 'claim_type'; claim_type: string; file_pattern?: string }
  | { level: 'file'; source_file: string }
  | { level: 'extraction'; source_file: string; adjustment: string };

interface FeedbackRecord {
  id: string; repo_id: string; claim_id: string;
  verification_result_id: string;
  feedback_type: 'thumbs_up' | 'thumbs_down' | 'fix_accepted'
    | 'fix_dismissed' | 'all_dismissed';
  timestamp: Date; github_user: string; pr_number: number;
  explanation: {
    type: 'quick_pick' | 'free_text';
    quick_pick_id?: string; free_text?: string;
    provided_at: Date;
  } | null;
  finding_snapshot: {
    claim_text: string; claim_type: string; source_file: string;
    code_files: string[]; mismatch_description: string; severity: string;
  };
  actions_taken: CorrectionAction[];
}

interface AppliedCorrection {
  id: string; feedback_id: string; repo_id: string;
  action: CorrectionAction; rule_id: string | null;
  applied_at: Date;
  status: 'active' | 'expired' | 'revoked' | 'undone_by_developer';
}

interface SuppressionCheckResult {
  suppressed: boolean; suppressed_by: string | null;
  suppression_level: string | null;
  reason: string | null; expires_at: Date | null;
}
```

### 5.6 Flow Diagram

```
Developer gives thumbs-down on PR finding
                |
                v
     +-------------------------+
     | Record feedback          |
     | Show explanation prompt  |
     +------------+------------+
                  |
         response within 48h?
         /                 \
       YES                  NO
        |                    |
   explanation type?    Silent dismissal
   /           \        count-based path
  quick-pick  free-text      |
   |            |        count >= 2?
   v            v        /        \
+----------+ +-------+ YES       NO
| Fast-path| | AI    | |         |
| lookup   | | agent | v         v
+-----+----+ +--+----+ Create   Wait for
      |          |      per-     more
      v          v      claim    signals
  +-------------------+ rule
  | Auto-apply actions|<--+
  | Create rules       |
  | No approval needed |
  +--------+-----------+
           |
           v
  Future findings checked against active rules
  Suppressed = stored but not displayed
```

```
SAFETY VALVE: Spot-check flow

Monthly per active rule:
                  |
                  v
     +---------------------------+
     | Pick one suppressed       |
     | finding, show on next PR  |
     | with [Spot check] marker  |
     +-------------+-------------+
                   |
          developer reaction?
          /        |         \
    thumbs-down  thumbs-up  no reaction
         |          |           |
         v          v           v
   +---------+ +----------+ +----------+
   | Rule    | | Increment| | No       |
   | is      | | revoke   | | change   |
   | correct | | counter  | |          |
   +---------+ +-----+----+ +----------+
                     |
                counter >= 2?
                /         \
              YES          NO
               |            |
               v            v
         +----------+  +----------+
         | Revoke   |  | Flag for |
         | rule     |  | review   |
         +----------+  +----------+
```

**Core invariant:** No finding is ever deleted. Suppression means the finding is computed but not displayed. The suppressed finding is stored with a `suppressed_by` reference. If the rule is later revoked, the finding can be retroactively surfaced.

---

## 6. Worked Example

**Repository:** `acme/payments-api` with claims C1 ("bcrypt," actually argon2), C4 ("All endpoints return JSON," /health returns plain text), C8 ("Bearer tokens," webhooks use HMAC).

### Week 1: Explanation-Driven Fix (C1)

**PR #101:** DocAlign finds drift on C1 ("bcrypt" but code uses argon2).

```
Finding: C1 is DRIFTED -- docs say bcrypt, code imports argon2.
Developer reaction: thumbs-down
```

DocAlign shows the explanation prompt. Developer selects "Migration in progress."

Quick-pick fast path executes (no agent call):

```
CorrectionAction {
  type: 'suppress_claim',
  claim_id: 'C1',
  duration_days: 90,
  reason: "Migration in progress (PR #101)"
}
```

Rule created immediately. **One dismissal was sufficient.** C1 will not appear for 90 days.

### Week 2: Silent Dismissal Fallback (C4)

**PR #107:** DocAlign finds drift on C4 ("All endpoints return JSON" -- /health returns plain text).

```
Finding: C4 DRIFTED -- /health endpoint returns plain text
Developer reaction: thumbs-down
```

DocAlign shows the explanation prompt. Developer ignores it (no response within 48 hours).

Silent dismissal recorded: `claim_dismissals[C4].count = 1.0`. Threshold not met (1.0 < 2.0). **No rule created.** Finding will reappear.

**PR #110:** C4 flagged again. Developer thumbs-down, ignores prompt again.

Silent count updated to 2.0. Threshold met. Count-based rule created:

```
SuppressionRule {
  scope: { level: 'claim', claim_id: 'C4' },
  origin: 'count_based_fallback',
  reason: "Silently dismissed 2 times (PRs: 107, 110)",
  expires_at: 2026-08-12 (180 days)
}
```

**Contrast:** C1 resolved in 1 PR with a clear reason. C4 required 2 PRs across 2 weeks and can only suppress at per-claim level.

### Week 2: Free-Text Triggers Agent (C8)

**PR #108:** DocAlign finds drift on C8 ("Authentication uses Bearer tokens" -- /webhooks endpoint uses API key).

Developer thumbs-down with free-text: "Webhooks are a special case -- they use HMAC signatures, not Bearer tokens. The rest of the API is Bearer. We should update the docs to say 'all endpoints except webhooks.'"

Free-text invokes the AI agent. Agent receives the finding context, explanation, and existing rules. Agent responds:

```json
{
  "actions": [
    {
      "type": "suppress_claim",
      "claim_id": "C8",
      "duration_days": 180,
      "reason": "Webhooks use HMAC, not Bearer. Drift is by design."
    },
    {
      "type": "suggest_doc_update",
      "source_file": "docs/api-reference.md",
      "suggested_text": "Authentication uses Bearer tokens for all endpoints except /webhooks, which uses HMAC signature verification.",
      "reason": "Developer indicated docs should clarify the webhook exception."
    }
  ],
  "reasoning": "Developer explained webhooks are intentionally different. The claim is technically drifted but by design. Suppressing and suggesting a doc update."
}
```

Both actions auto-applied. **One explained dismissal produced a suppression AND a doc update suggestion.** Count-based suppression could never do this.

### Week 5: Spot-Check Catches Stale Rule (C1)

30 days after C1 rule creation, spot-check triggers. The docs still say "bcrypt." Spot-check shows:

```
[Spot check] Claim: "All passwords are hashed with bcrypt"
Reality: Code uses argon2. Suppressed: migration in progress (62 days left)
```

**Scenario A:** Migration still in progress. Developer thumbs-down. Rule confirmed.
**Scenario B:** Migration completed, docs not updated. Developer thumbs-up. Revocation counter = 1. One more positive signal revokes the rule.
**Scenario C:** Migration abandoned. Developer thumbs-up. Rule challenged. Finding resurfaces.

### Final State

| Rule | Origin | Scope | Expires |
|------|--------|-------|---------|
| R1 | explanation_quick_pick | claim: C1 | 2026-05-11 |
| R2 | count_based_fallback | claim: C4 | 2026-08-12 |
| R3 | explanation_agent | claim: C8 | 2026-08-09 |

Pending: doc update suggestion for `docs/api-reference.md` (from C8).

---

## 7. Adversarial Examples

### 7.1 Developer Explains Poorly, Agent Over-Corrects

**Scenario:** Developer dismisses a test-file naming convention finding with free-text: "We don't follow this convention." Agent interprets broadly, suppresses ALL convention findings repo-wide -- including production code where the team does care.

**Detection:** Spot-check at 30 days surfaces a production convention finding. Developer thumbs-up. After 2 positive signals, repo-wide rule revoked.

**Mitigations:** (1) Agent prompt instructs narrow scoping by default. (2) Spot-check catches within 30 days. (3) Developer can see and undo in suppressed section. (4) Rule expires at 90-180 days.

**Residual risk:** Up to 30 days of over-suppression. Accepted cost of no-approval-gate design.

### 7.2 "Dismiss All" Abuse

**Scenario:** Developer clicks "Dismiss all" on PRs with 15 findings repeatedly. 8 of 15 are legitimate.

**What happens:** 0x weight — dismiss-all does not count toward suppression thresholds at all. The 15 findings remain active. The developer must individually dismiss specific findings (with or without explanations) for suppression rules to be created. Dismiss-all is treated as a UI convenience, not a learning signal.

**Residual risk:** If developer also dismisses spot-checks, system cannot help. Product-engagement problem, not learning-system problem.

### 7.3 Contradictory Feedback from Different Team Members

**Scenario:** Developer A selects "Don't care about this check" (creates repo-wide claim-type suppression). Developer B encounters spot-check, clicks thumbs-up.

**What happens:** B's thumbs-up increments revocation counter. After 2 positive signals from B, rule revoked. Convention findings resurface. A may dismiss and re-explain.

**Correct behavior.** Contradictory feedback should not result in stable suppression. Oscillation forces team convergence. v2 enhancement: detect oscillation and suggest team discussion.

### 7.4 Agent Modifies Static Analysis Rule Incorrectly

**Scenario:** Developer dismisses a gRPC finding with free-text: "The monitoring service uses HTTP because Prometheus requires it." Agent updates static rule to exclude monitoring service but uses too-broad glob (`*monitor*`), accidentally excluding `services/billing-monitor/`.

**Mitigations:** (1) Rule modification logged with exact change. (2) Modified rule expires at 90 days, original reinstated. (3) System runs modified rule immediately and logs coverage diff -- if unexpected files excluded, flags for developer review. This is the ONE case where we surface a review request despite auto-apply.

---

## 8. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Agent over-corrects from vague explanation | Medium | Medium | Agent prompt defaults to narrow scope. Spot-check at 30d. Expiry 90-180d. Undo button. |
| 2 | Developers never provide explanations | Medium | Low | Quick-picks are one-click. Track rate; if <20%, make prompt more prominent. |
| 3 | Agent cost accumulates from free-text | Low | Low | Quick-pick fast path avoids agent call. ~$0.15-0.50/month at 50 calls. |
| 4 | Dismiss-all gaming | Low | Low | 0x weight — dismiss-all does not count toward suppression. No broad scopes from counts. Dashboard warning at >70%. |
| 5 | Stale suppression rules | Medium | Medium | All rules expire. Claim text changes bypass old rules. Spot-checks. |
| 6 | Conflicting rules at different scopes | Low | Low | Narrower scope evaluated first. All applicable rules shown in UI. |
| 7 | Explanation prompt adds friction | Medium | Medium | Labeled "optional." One-click. 48h timeout. Track correlation with feedback volume. |
| 8 | Agent changes static rule incorrectly | Low | High | Log changes. Diff coverage. 90-day expiry. Flag large diffs for review. |

---

## 9. Founder Decisions

1. **Quick-pick categories:** Keep the four proposed quick-picks as-is. Four options + free-text is the right balance.

2. **Agent cost tolerance:** No cap. Accept uncapped agent cost for free-text interpretation. At ~$0.15-0.50/month for 50 calls, capping adds complexity for negligible savings.

3. **Agent aggressiveness:** Constrain agent to narrowest applicable scope by default. Prompt instructs "prefer the narrowest suppression that addresses the developer's concern." But allow broader scopes when the explanation clearly warrants it (e.g., "we don't follow any naming conventions" → repo-wide claim-type suppression).

4. **Spot-check frequency:** Agent-created rules get 14-day spot-checks. Count-based rules get 30-day spot-checks. Both configurable by the team.

5. **Dismiss-all weight:** 0x — dismiss-all does not count toward per-claim suppression thresholds at all. Only individual per-finding dismissals count. Dismiss-all is a UI convenience, not a signal.

6. **Explanation prompt format:** Reply-based prompt (cleaner, less noise). DocAlign replies to its own PR comment thread with the explanation prompt after a thumbs-down.

7. **Scope:** Repo-level suppression for v1. All rules apply to all developers in the repo. Per-developer suppression is out of scope for v1 — will be added later if needed.

8. **Doc update suggestions:** GitHub suggestion comment with one-button accept. When the agent generates a doc fix, DocAlign posts it as a GitHub suggestion comment on the relevant file. Developer clicks "Accept suggestion" to apply — one-button action, no separate PR or issue needed.
