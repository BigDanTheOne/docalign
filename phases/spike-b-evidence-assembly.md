# Spike B: Evidence Assembly for Verification

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 2: Research & Design Spikes

## 1. Problem Statement

**Context:** DocAlign's Layer 3 (Verification Engine) uses LLM-based verification for Tiers 3/4, which requires sending the right code context (evidence) alongside the claim. Verdict quality depends almost entirely on whether the LLM sees the relevant code.

**Spike A (completed):** Universal claims use static analysis rules (no evidence assembly). Flow claims are decomposed into sub-claims, each individually mapped.

**Spike B's scope:** Evidence assembly for (a) regular entity-mapped and file-mapped claims, and (b) decomposed sub-claims from Spike A.

**Founder directive:** Use AI agents for edge cases instead of hand-crafted retrieval heuristics. No token budgets. The agent figures out its own context and can also fix upstream rules.

**This spike answers three questions:**

1. **What is the simplest path for claims with a clear entity mapping?** When the mapper says "this claim is about `UserService.authenticate()`," what is the fastest, cheapest way to get evidence?
2. **What happens when entity extraction is insufficient?** File-mapped claims, large entities (>500 lines), multi-file claims, uncertain mappings -- how do we handle them?
3. **What is the interface contract between DocAlign and an external verification agent?** What goes in, what comes out, how is the agent configured?

---

## 2. Prior Art Survey

### 2.1 AST-Aware Code Chunking (tree-sitter)

**Summary:** The cAST paper (CMU, 2025) demonstrates that AST-aware chunking for code RAG significantly outperforms naive line/token-based chunking by preserving semantic integrity -- function bodies are never split mid-statement.

**Relevance:** DocAlign already uses tree-sitter (Layer 0). The entity boundary = tree-sitter node span. For Path 1 (direct entity extraction), tree-sitter gives us the exact function/class body deterministically. No scoring or ranking needed.

**Limitations:** AST chunking gives the entity but does not tell you which parts of a 500-line class are relevant to a specific claim. That is now the agent's problem (Path 2), not ours.

### 2.2 "Lost in the Middle" -- Position Bias in LLM Contexts

**Summary:** Liu et al. (TACL 2024) showed LLMs attend best to beginning/end of context, with up to 30% accuracy loss for middle-positioned information.

**Relevance:** For Path 1, evidence is compact (entity + imports) so position bias is irrelevant. For Path 2, the agent controls its own context via tool-use (reading files on demand), sidestepping the issue entirely. Informs prompt design: put claim text and entity code at the top of the verification prompt.

### 2.3 Sourcegraph Cody -- Multi-Signal Ranking

**Summary:** Cody uses keyword + embedding + import-graph traversal, ranking snippets up to ~28 KB/request. Precision matters more than recall (arXiv 2408.05344).

**Relevance:** Cody's multi-signal approach is what we are deliberately NOT building. Path 1 uses a single signal (mapper's entity). Cody's complexity is what the Path 2 agent does natively.

### 2.4 Cursor -- Import Tracing

**Summary:** Cursor follows imports from the active file, feeds ~8,000 lines/request.

**Relevance:** Path 1 borrows Cursor's insight: entity code + imports. For anything more complex, the Path 2 agent follows the graph natively.

### 2.5 AI Agent-Based Code Understanding (Claude Code, Aider, Cursor Agent)

**Summary:** Modern AI coding agents receive a task, then autonomously read files, follow imports, search for patterns, and assemble their own context. They manage their own token budget internally.

**Relevance:** Directly applicable to Path 2. Instead of building bespoke retrieval, delegate verification to an agent. DocAlign provides "what to verify"; the agent handles "how to find evidence."

**Limitations:** Expensive ($0.01-0.50/invocation), slow (10-60s), non-deterministic. Cost controlled by routing Path 1 for the majority.

### 2.6 Maximum Effective Context Window Research

**Summary:** Multiple studies (2024-2025) show effective context windows are 2,000-6,000 tokens for structured comparison tasks, with diminishing/negative returns beyond.

**Relevance:** Validates Path 1: compact evidence (200-800 tokens) is optimal. More context hurts, not helps. Path 2 agents sidestep this via tool-use.

---

## 3. Options Analysis

### 3.1 Option: Fixed Budget Per Tier (PRD Status Quo)

2000 tokens (Tier 3), 4000 tokens (Tier 4). Same budget for all claim types.

**Pros:** Simple. Predictable. | **Cons:** Insufficient for multi-file claims. Requires keyword extraction/relevance scoring for large entities -- complexity that still produces mediocre results. Hard cases unsolved.
**Complexity:** 5-7 days | **Cost:** ~$0.012/claim

### 3.2 Option: Claim-Complexity-Adaptive Budget (Three Tiers)

Budgets S/M/L (2000/4000/6000) based on mapping metadata. Keyword scoring for intra-entity selection.

**Pros:** Better cost distribution. | **Cons:** Three code paths + keyword extraction + relevance scoring + proportional allocation. Still fails for multi-file claims and semantically wrong keyword matches.
**Complexity:** 7-9 days | **Cost:** ~$0.008/claim average

### 3.3 Option: Agent-Delegated Verification for Edge Cases

Two paths: (1) Direct entity extraction for simple claims. (2) Delegate ENTIRE verification to an AI agent for hard cases.

**Pros:** Path 1 trivially simple (~2 days). Path 2 eliminates all retrieval complexity. Agent handles multi-file reasoning, import following, large-entity exploration natively. Can fix upstream rules. Configurable. | **Cons:** Path 2 expensive ($0.02-0.20/claim), slow (10-60s), non-deterministic.
**Complexity:** 3-4 days | **Cost:** ~$0.005/claim average (65% Path 1 at ~$0.002, 35% Path 2 at ~$0.10)

### 3.4 Option: Iterative Retrieval with Relevance Feedback

Start at 1000 tokens; if LLM returns "uncertain," double budget and retry (up to 3x).

**Pros:** Auto-adapts. | **Cons:** Up to 3 LLM round-trips (3-6x latency). Cannot distinguish "insufficient context" from "genuinely ambiguous." Multi-file unsolved.
**Complexity:** 6-8 days | **Cost:** ~$0.010 avg, high variance

---

## 4. Recommendation

**Recommended: Option 3.3 -- Two-Path System (Direct Entity Extraction + Agent-Delegated Verification).**

**Path 1 (~60-70% of claims):** When the mapper provides a specific entity, extract it via tree-sitter + imports. Deterministic, <100ms, free. No keyword extraction, no scoring, no budget tiers.

**Path 2 (~30-40% of claims):** Delegate entire verification to an AI agent. Agent receives claim + file hints, explores codebase, produces verdict directly. Handles all the hard cases (large entities, multi-file, uncertain mappings) that budget-based approaches fail on.

| Criterion | Budget tiers (3.1/3.2) | Two-Path (3.3) |
|-----------|----------------------|----------------|
| Simple claims | Adequate | Equivalent |
| Large entities | Keyword scoring (mediocre) | Agent explores class |
| Multi-file / uncertain | Limited or unsolved | Agent follows imports / searches |
| Complexity | 7-9 days | 3-4 days |
| Self-improving | No | Agent can fix Spike A rules |

**Key insight:** Building sophisticated evidence retrieval is building a worse version of what agents already do. Delegate to an actual agent. Focus engineering on routing and the simple path.

**Spike A interaction:** Universal claims use static rules (no change). Flow sub-claims with entity mappings go through Path 1; file-only or uncertain sub-claims go through Path 2.

---

## 5. Detailed Specification

### 5.1 Path 1: Direct Entity Extraction

Path 1 is the default for claims with a specific entity mapping. Deterministic, zero LLM calls for evidence assembly.

```
INPUT:  claim: Claim, mapping: ClaimMapping (entity_name != null)

STEP 1: EXTRACT ENTITY CODE
  entity_code = treeSitter.extractNode(mapping.file_path, mapping.entity_name)
  // Complete AST node: function/class body, decorators, JSDoc, type annotations.

STEP 2: EXTRACT IMPORTS
  imports = treeSitter.extractImports(mapping.file_path)
  // All import/require statements. Capped at 30 lines.

STEP 3: EXTRACT REFERENCED TYPE SIGNATURES (optional)
  type_refs = treeSitter.extractReferencedTypeSignatures(mapping.file_path, mapping.entity_name)
  // Same-file type signatures only (interface/type declarations, not bodies).

STEP 4: COMPOSE EVIDENCE
  evidence = formatEvidence({ file_path, imports, entity_code, type_signatures, line_range })

OUTPUT: EvidencePackage --> sent to verification LLM with claim text.
```

**Characteristics:** <5ms latency, $0 cost, 100% deterministic. Typical size: 100-800 tokens.

### 5.2 Path 2: Agent-Delegated Verification

Path 2 handles claims that cannot be resolved by simple entity extraction. Instead of assembling evidence and then calling a verification LLM, DocAlign delegates the ENTIRE verification task to an external AI agent. The agent explores the codebase, assembles its own context, and returns a verdict.

**Agent input** (see `AgentVerificationRequest` in Section 5.4): The claim text, mapped file hints (starting points, not limits), repository root path, verification instructions (defining verified/drifted/uncertain semantics), and optional parent claim context for Spike A sub-claims.

**Agent behavior** (its own autonomy -- DocAlign does not control this):
1. Reads the mapped files as a starting point.
2. Follows imports, searches for related code, reads tests if useful.
3. Produces a structured JSON verdict with reasoning and evidence summary.
4. Optionally proposes fixes to upstream rules or mappings.

**Agent output** (see `AgentVerificationResponse` in Section 5.4): verdict, confidence, reasoning, files examined, evidence summary, and optional rule_fixes / mapping_issues / doc_suggestions.

**Invocation flow:**
1. DocAlign constructs `AgentVerificationRequest` (standard format).
2. `AgentAdapter` translates to agent-specific format (Claude Code: spawns `claude` CLI; custom: calls user-configured command/API).
3. Agent runs (10-60 seconds typical).
4. Adapter parses output into `AgentVerificationResponse`.
5. DocAlign uses the verdict as the final verification result.

**The agent IS the verifier for Path 2.** There is no separate "evidence assembly" step followed by a "verification" step. The agent does both. This eliminates an entire pipeline stage for hard claims.

### 5.3 Routing Logic

The router is deterministic, based on mapping metadata -- no LLM call.

```
FUNCTION routeClaim(claim, mappings):
  if mappings.length == 0:
    return { path: 2, reason: "no_mappings" }

  primary = mappings[0]  // highest-confidence mapping

  if mappings.length == 1 AND primary.entity_name != null AND primary.entity_line_count <= 500:
    return { path: 1, reason: "single_entity_mapped" }

  if mappings.length == 1 AND primary.entity_name != null AND primary.entity_line_count > 500:
    return { path: 2, reason: "large_entity" }

  if mappings.length == 1 AND primary.entity_name == null:
    return { path: 2, reason: "file_mapped_no_entity" }

  if mappings.length > 1:
    return { path: 2, reason: "multi_file" }

  return { path: 2, reason: "unmatched_case" }  // safe fallback
```

**Expected distribution (based on mapper output analysis from Spike A):**

| Route Reason | % of Claims | Path |
|-------------|-------------|------|
| `single_entity_mapped` | 60-70% | 1 |
| `file_mapped_no_entity` | 10-15% | 2 |
| `large_entity` | 5-8% | 2 |
| `multi_file` | 8-12% | 2 |
| `no_mappings` | 2-5% | 2 |

### 5.4 Data Structures

```typescript
// --- Path 1: Direct Entity Extraction ---

interface EntityEvidencePackage {
  formatted_evidence: string;
  metadata: {
    path: 1;
    file_path: string;
    entity_name: string;
    entity_lines: [number, number];
    entity_token_estimate: number;
    imports_token_estimate: number;
    total_token_estimate: number;
    type_signatures_included: string[];
    assembly_time_ms: number;
  };
}

// --- Path 2: Agent-Delegated Verification ---

interface AgentVerificationRequest {
  claim: {
    id: string;
    claim_text: string;
    claim_type: string;
    parent_claim_id: string | null;
    parent_claim_text: string | null;
  };
  /** File hints from mapper (agent starts here, not limited to these) */
  mapped_files: Array<{
    file_path: string;
    entity_name: string | null;
    confidence: number;
  }>;
  repo_root: string;       // absolute path to repository root
  instructions: string;    // verification prompt template
}

interface AgentVerificationResponse {
  verdict: 'verified' | 'drifted' | 'uncertain';
  confidence: number;                   // 0.0-1.0, agent's self-assessed
  reasoning: string;                    // human-readable explanation
  evidence_files_examined: string[];    // files the agent actually read
  evidence_summary: string;             // key code evidence (summary, not full files)
  rule_fixes?: RuleFix[];               // optional: fixes to Spike A rules
  mapping_issues?: MappingIssue[];      // optional: problems with mapper output
  doc_suggestions?: string[];           // optional: suggested doc updates
}

interface RuleFix {
  rule_id: string;
  problem: string;
  proposed_rule: { check_type: string; scope: string; pattern?: string; expected?: string };
}

interface MappingIssue {
  file_path: string;
  issue: string;
  suggestion: string;
}

// --- Routing ---

type RoutePath = 1 | 2;
type RouteReason = 'single_entity_mapped' | 'file_mapped_no_entity' | 'large_entity'
  | 'multi_file' | 'no_mappings' | 'unmatched_case';
interface RouteDecision { path: RoutePath; reason: RouteReason; }

// --- Agent Adapter (configurable per user) ---

interface AgentAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  /** Timeout is enforced by DocAlign, not the agent. */
  verify(request: AgentVerificationRequest): Promise<AgentVerificationResponse>;
}

interface AgentConfig {
  adapter: 'claude-code' | 'custom-command' | 'disabled';
  command?: string;                  // for 'custom-command': shell command to run
  timeout_seconds: number;           // default: 120
  max_agent_claims_per_pr: number;   // default: 20
  fallback: 'uncertain' | 'skip';   // default: 'uncertain'
}

interface EvidenceAssemblyConfig {
  path1_max_entity_lines: number;           // default: 500
  path1_max_import_lines: number;           // default: 30
  path1_include_type_signatures: boolean;   // default: true
  agent: AgentConfig;
}
```

### 5.5 Flow Diagram

```
Claim + Mappings (from Layer 2)
    |
    v
[Router: Determine Path]
    |
    |--- single_entity_mapped (60-70%)
    |       |
    |       v
    |    [Path 1: Direct Entity Extraction]
    |       |
    |       |-- tree-sitter extract entity code
    |       |-- tree-sitter extract imports
    |       |-- tree-sitter extract type signatures
    |       |-- format evidence (<5ms)
    |       |
    |       v
    |    EvidencePackage --> Verification LLM --> Verdict
    |
    |--- file_mapped_no_entity (10-15%)
    |--- large_entity (5-8%)
    |--- multi_file (8-12%)
    |--- no_mappings (2-5%)
            |
            v
         [Path 2: Agent-Delegated Verification]
            |
            |-- Construct AgentVerificationRequest
            |-- Select AgentAdapter (from config)
            |-- Invoke agent (10-60s)
            |-- Parse AgentVerificationResponse
            |
            v
         Verdict (direct from agent)
            |
            +-- optional: RuleFixes --> feed back to Spike A rule store
            +-- optional: MappingIssues --> log for mapper improvement
```

Path 2 does NOT produce an `EvidencePackage`. The agent IS the verifier -- it reads code, reasons, and returns the verdict directly.

---

## 6. Worked Examples

### 6.1 Path 1 Example: Single-Entity Claim

**Claim:**
```json
{
  "id": "claim-001",
  "claim_text": "The createOrder function validates the input DTO and publishes an order.created event to the message queue",
  "claim_type": "behavior"
}
```

**Mapping:**
```json
[{
  "file_path": "src/services/order-service.ts",
  "entity_name": "createOrder",
  "entity_start_line": 24,
  "entity_end_line": 42,
  "confidence": 0.95,
  "mapping_method": "symbol_search"
}]
```

**Routing decision:**
- `mappings.length == 1` -- yes
- `entity_name != null` -- yes (`createOrder`)
- `entity_line_count = 42 - 24 + 1 = 19` -- well under 500
- **Result: Path 1, reason: `single_entity_mapped`**

**Path 1 execution:**

Step 1 -- tree-sitter extracts the entity code (19 lines, ~180 tokens):
```typescript
async createOrder(dto: CreateOrderDto): Promise<Order> {
  if (!dto.items || dto.items.length === 0) {
    throw new ValidationError('Order must have at least one item');
  }
  if (!dto.customerId) {
    throw new ValidationError('Customer ID is required');
  }
  const order = await this.repo.create({
    customerId: dto.customerId, items: dto.items, status: 'pending', createdAt: new Date(),
  });
  await this.publisher.publish('order.created', {
    orderId: order.id, customerId: order.customerId, itemCount: order.items.length,
  });
  return order;
}
```

Step 2 -- tree-sitter extracts imports (4 lines, ~42 tokens):
```typescript
import { OrderRepository } from '../repositories/order-repository';
import { EventPublisher } from '../queue/publisher';
import { Order, CreateOrderDto } from '../types/order';
import { ValidationError } from '../errors';
```

Step 3 -- No same-file type signatures referenced (all types are imported).

Step 4 -- Compose: imports + entity code + delimiters = **~222 tokens total**.

**Result:** The verification LLM sees the complete `createOrder` method with its validation logic and `publisher.publish('order.created', ...)` call. Exactly what it needs. Time: <5ms. Cost: $0.

### 6.2 Path 2 Example: Large Entity (520-line class)

**Claim:**
```json
{
  "id": "claim-002",
  "claim_text": "The UserService class handles password hashing using bcrypt before storing user records",
  "claim_type": "behavior"
}
```

**Mapping:**
```json
[{
  "file_path": "src/services/user-service.ts",
  "entity_name": "UserService",
  "entity_start_line": 15,
  "entity_end_line": 534,
  "confidence": 0.91,
  "mapping_method": "symbol_search"
}]
```

**Routing decision:**
- `mappings.length == 1` -- yes
- `entity_name != null` -- yes (`UserService`)
- `entity_line_count = 534 - 15 + 1 = 520` -- exceeds 500 threshold
- **Result: Path 2, reason: `large_entity`**

**Path 2 execution:**

DocAlign constructs `AgentVerificationRequest` with the claim, `mapped_files: [{ file_path: "src/services/user-service.ts", entity_name: "UserService", confidence: 0.91 }]`, repo root, and verification instructions.

The agent (e.g., Claude Code) autonomously:
1. Opens `src/services/user-service.ts`, reads the `UserService` class.
2. Identifies `hashPassword()`, `createUser()`, `changePassword()` methods as relevant.
3. Sees `import { hash, compare } from 'bcrypt'` at the top.
4. Reads `createUser()` and confirms it calls `this.hashPassword(plain)` before `this.repo.create(...)`.
5. Follows the import to confirm `bcrypt` is the actual library (not a wrapper).

Agent returns:
```json
{
  "verdict": "verified",
  "confidence": 0.95,
  "reasoning": "UserService.createUser() calls this.hashPassword(password) on line 67, which uses bcrypt.hash() (imported from 'bcrypt' package). This happens before this.repo.create() on line 72, confirming password is hashed before storage. changePassword() follows the same pattern on line 145.",
  "evidence_files_examined": [
    "src/services/user-service.ts",
    "package.json"
  ],
  "evidence_summary": "createUser() -> hashPassword() -> bcrypt.hash() -> repo.create(). bcrypt@5.1.1 in package.json dependencies."
}
```

**Result:** The agent examined a 520-line class, focused on the 3 relevant methods, followed the bcrypt import, and verified the claim. DocAlign did not need to build keyword extraction, relevance scoring, or section selection. Time: ~15 seconds. Cost: ~$0.03.

### 6.3 Path 2 Example: Agent Fixes an Upstream Rule

**Claim:** `"All API endpoints validate request bodies using Zod schemas"` (universal, handled by Spike A)

**Spike A generated rule:** `{ check_type: "import_present", scope: "src/api/**/*.ts", pattern: "zod" }`

**Trigger:** PR adds `src/api/webhooks/stripe-handler.ts`. The static rule fails -- file imports `@company/validation` (a Zod wrapper), not `zod` directly. DocAlign routes to Path 2 for deeper verification.

**Agent explores:**
1. Reads `stripe-handler.ts` -- sees `import { validateBody } from '@company/validation'`.
2. Reads `src/lib/validation/index.ts` -- sees `import { z } from 'zod'`. Wrapper uses Zod internally.

**Agent returns:**
```json
{
  "verdict": "verified",
  "confidence": 0.90,
  "reasoning": "stripe-handler.ts uses @company/validation wrapper which internally uses Zod.",
  "evidence_files_examined": ["src/api/webhooks/stripe-handler.ts", "src/lib/validation/index.ts"],
  "evidence_summary": "stripe-handler.ts -> @company/validation -> zod. Wrapper calls z.object().parse().",
  "rule_fixes": [{
    "rule_id": "rule-003",
    "problem": "Rule checks for direct 'zod' import but project uses @company/validation wrapper",
    "proposed_rule": { "check_type": "import_present", "scope": "src/api/**/*.ts", "pattern": "zod|@company/validation" }
  }]
}
```

**Result:** Agent verified correctly (avoiding false positive) AND fixed the Spike A rule. Future files importing the wrapper pass the static check without agent invocation. This feedback loop reduces Path 2 volume over time.

---

## 7. Adversarial Examples

### 7.1 Adversarial: Agent Produces Wrong Verdict Due to Hallucination

**Claim:** "The payment module uses Stripe webhooks with signature verification"
**Mapped file:** `src/webhooks/stripe.ts`
**Route:** Path 2 (file-mapped, no entity)

**Problem:** The agent reads the webhook handler file, sees `stripe.webhooks.constructEvent(body, sig, secret)` and returns `verified`. But the function is defined but never actually called -- the webhook route in `src/routes/api.ts` uses a different handler that skips verification. The agent did not check the route registration.

**Impact:** False "verified" verdict. The documentation claims signature verification exists, and the code has the function, but it is not wired up.

**Mitigation:**
1. The agent instructions should explicitly state: "For behavior claims, verify not just that the code exists but that it is reachable/invoked in the expected context."
2. Accept that agents are imperfect -- they are still better than keyword-based evidence selection for this type of cross-file reasoning.
3. Track agent confidence scores. Verdicts with confidence < 0.7 get flagged for human review.
4. Over time, improve agent instructions based on failure patterns.

**Severity:** Medium. Agents are susceptible to "code exists but is not called" patterns. Mitigated by prompt engineering and confidence thresholds.

### 7.2 Adversarial: Agent Cost Explosion on Large Monorepo

**Claim:** "The system uses event-driven communication between all microservices"
**Mapped files:** 12 files across 8 services | **Route:** Path 2 (multi_file)

**Problem:** The agent follows imports across services, reads event handlers, message queue configs, Docker Compose, Kubernetes manifests... 80+ files, $0.50+ per claim. 20 such claims = $10+ per PR.

**Mitigation:**
1. `max_agent_claims_per_pr` caps Path 2 invocations (default: 20).
2. `timeout_seconds` kills the agent (default: 120). Verdict becomes `uncertain`.
3. Universal/quantified claims ("all microservices") should be routed to Spike A static rules, not Path 2. If one reaches Path 2, mark as `uncertain` rather than spawning an expensive agent.
4. Cost monitoring: log per-claim and per-PR costs. Alert on threshold.

**Severity:** High if unmitigated. Max claims + timeout + proper Spike A routing makes it manageable.

### 7.3 Adversarial: Agent Is Unavailable (Rate Limit, Network, Not Configured)

**Claim:** "Database migrations use the up/down pattern for reversibility"
**Route:** Path 2 (file_mapped_no_entity) | **Problem:** Agent is rate-limited or API is down.

**Impact:** 30-40% of claims unverifiable. Noisy "uncertain" block in PR report.

**Mitigation:**
1. `fallback` config: `'uncertain'` (default) reports "unable to verify (agent unavailable)" with distinct status. `'skip'` omits them with a footer note.
2. PR report groups agent-unavailable claims separately with retry instructions.
3. Path 1 claims (60-70%) are completely unaffected. Core value still works.
4. Optional `fallback_adapter` config for a backup agent provider.

**Severity:** Medium. Clear UX grouping + retry mechanism + Path 1 independence.

### 7.4 Adversarial: Non-Deterministic Verdicts Across Runs

**Claim:** "The cache layer uses Redis with a 5-minute TTL for user sessions"
**Route:** Path 2 (file-mapped, no entity)

**Problem:** Run 1: agent finds `TTL = 300`, returns `verified`. Run 2: agent notices `TTL = process.env.SESSION_TTL || 300`, returns `drifted` (TTL is configurable). Both interpretations are reasonable.

**Impact:** Flaky verdicts undermine trust.

**Mitigation:**
1. Agent instructions are explicit: "If code uses a configurable value with a default matching the claim, verdict is `verified` with a note about configurability."
2. Cache agent verdicts per claim+code hash. If code has not changed, reuse previous verdict.
3. Log all agent reasoning. Verdict flips produce a reasoning diff for debugging.
4. Accept some non-determinism as inherent to LLM-based verification. Path 1 is fully deterministic.

**Severity:** Medium. Caching + instruction specificity eliminates most flakiness.

---

## 8. Risks and Mitigations

| Risk | L | I | Mitigation |
|------|---|---|------------|
| **Agent cost exceeds budget** -- 35% of claims at $0.10-0.20 each = $1.70-3.40 per 50-claim PR | H | M | `max_agent_claims_per_pr` (default: 20). Priority ordering: most critical claims first, rest `uncertain`. Log + alert on threshold. |
| **Agent latency** -- 17 agent calls at 10-60s each, even parallelized | H | M | Parallelize (concurrency default: 5). 17 claims = 40-70s. `timeout_seconds` kills stalled agents. Acceptable within 1-5min PR window. |
| **Malformed agent output** -- free-text instead of JSON, schema mismatch | M | L | Validate against schema. Malformed = `uncertain`. Log raw output. Retry once. |
| **Agent hallucination** -- confident wrong verdict (misread code, invented detail) | M | H | (1) Instructions require quoting specific code. (2) `evidence_summary` enables spot-checking. (3) Confidence < 0.7 flagged for review. (4) Golden test set for regression. |
| **Agent unavailability** -- rate limits, downtime, not configured | M | M | Fallback `uncertain` with distinct status. Path 1 (60-70%) unaffected. Separate grouping in report. Optional fallback adapter. |
| **Path 1 routing too conservative** -- too many claims go to Path 2 unnecessarily | M | M | `path1_max_entity_lines` configurable. Analyze routing distribution after 100 PRs. Future: Path 1.5 for multi-file claims with clear entities. |
| **Agent proposes wrong rule fixes** -- broadens Spike A rule, causes false negatives | L | M | Rule fixes are PROPOSALS, not auto-applied. User approval required. Auto-apply only after N consistent identical proposals. |
| **Vendor lock-in** -- only Claude Code adapter well-tested | M | L | `AgentAdapter` is simple (string in, JSON out). `custom-command` adapter wraps any tool. |

---

## 9. Founder Decisions

All questions resolved on 2026-02-10.

1. **Agent cost per PR:** ✅ No cap. Client pays via their own API key. No count-based or cost-based limit. Users can abort if they think the agent is stuck.

2. **Agent timeout:** ✅ No timeout. The user will abort the agent's work if they find it stuck. No hard ceiling imposed by DocAlign.

3. **Rule fix auto-application:** ✅ Auto-apply immediately. Consistent with Spike C's no-approval-gate principle. If the fix is wrong, the next PR will surface bad results and the developer can override in `.docalign.yml`.

4. **Fallback when agent unavailable:** ✅ Skip with footer note. Claims that needed an agent are silently skipped, with a footer: "N claims skipped (agent unavailable)." Less noisy than showing "uncertain" entries.

5. **Agent adapter for v1:** ✅ Claude Code + custom-command adapter. Good out-of-box experience with Claude Code, flexible for users who prefer other agents.

6. **Path 1.5 for multi-file claims:** ✅ Defer to v2. 5% reduction in Path 2 volume isn't worth the additional routing logic in v1.

7. **Parallel agent concurrency:** ✅ Default 5, user-configurable up to 20 via `.docalign.yml`.
