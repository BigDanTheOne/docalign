> Part of [DocAlign PRD](../PRD.md)

## 11. Layer 7: Learning System

### 11.1 Purpose

Improve verification accuracy over time using signals from developer behavior, agent reports, and code/doc co-evolution patterns.

### 11.2 Functional Requirements

**Signal 1: Developer Feedback on Findings**
- Collection points: Review comment reactions (thumbs up/down per finding), explanation prompt (quick-pick or free-text after thumbs-down), suggestion accepted/dismissed
- **MVP — Quick-pick path:** Developer selects a reason → deterministic corrective action (no LLM cost)
- **MVP — Count-based fallback:** 2 bare thumbs-down on same claim → permanently exclude claim from checking. Claim re-enters only if claim text changes. Broader scopes require an explanation.
- **v2 — Free-text path:** Developer writes explanation → agent interprets and applies corrective actions
- Dismiss-all = 0x weight (not a learning signal)
- v2 suppression rules have expiration dates, periodic spot-checks, and positive-feedback revocation

**Signal 2: Co-Change Patterns**
- Track when code files and doc files change together in commits
- When mapping claims to code (Layer 2), boost mapping confidence for file pairs that have co-change history
- Scaling: 0 co-changes = no boost; 5+ co-changes = +0.1 confidence boost (capped)
- Co-change records retention: keep 6 months. Purge records older than 180 days via a weekly cleanup job.

**Signal 3: Agent Drift Reports**
- When an agent reports drift (via MCP `report_drift` tool), track whether the report is later confirmed or contradicted by verification
- Build agent report accuracy per repo to weight future reports

**Signal 4: Confidence Decay**
- All verification results have a freshness window
- A claim verified 30 days ago is less trustworthy than one verified today
- Decay function: exponential with 180-day half-life
- Claims not verified in 30+ days get flagged for re-verification in the next scheduled scan

### 11.3 Learning Generalization

**STATUS: Solved (see Spike C).** Explanation-driven learning with count-based fallback.

**MVP features:**

**Path A: Quick-Pick Fast-Path (developer selects a reason)**
- On thumbs-down, prompt developer "Why isn't this useful?" with 4 quick-picks + free-text
- Quick-picks: "Migration in progress" | "Doc file is known-stale" | "Don't care about this check" | "Finding is wrong"
- Quick-picks → deterministic corrective actions (no LLM cost, no agent call)

**Path B: Count-Based Permanent Exclusion (developer gives bare thumbs-down, no explanation)**
- After 2 silent dismissals (individual per-finding thumbs-down, not dismiss-all) on the same claim → permanently exclude claim from checking
- Claim re-enters checking only if claim text changes (doc file updated → fresh extraction)
- No broader scopes from counts alone — per-file/per-type requires an explanation
- Dismiss-all = 0x weight (UI convenience, not a learning signal)

**v2 features:**

**Path C: Free-Text Agent Interpretation**
- Free-text explanation → AI agent interprets and applies corrective actions autonomously
- Actions: suppress claim, suppress claim type, mark file stale, update static rule, suggest doc update
- Safety valves: rules expire (90-180 days), periodic spot-checks run on scheduled full scans only (not on PR scans; 14-day interval for agent rules, 30-day for count-based rules, configurable), positive feedback override (2 signals revokes rule), developer undo button

See `phases/spike-c-learning-generalization.md` for full specification.

### 11.4 Inputs and Outputs

**Inputs:**
- Developer feedback (reactions, suggestion accepts/dismisses)
- Commit history (co-change patterns)
- Agent drift reports
- Verification timestamps

**Outputs:**
- Suppression rules (which claims/types to stop flagging)
- Mapping confidence boosts (from co-change data)
- Agent reliability scores
- Re-verification queue (for stale claims)

### 11.5 Open Questions

- Learning generalization approach is defined (Spike C). Experiment 16.4 validates the approach with real usage data once available.

> Technical detail: see phases/technical-reference.md Section 3.8 (FeedbackRecord interface, co-change tracking, confidence decay function, generalization approaches)

