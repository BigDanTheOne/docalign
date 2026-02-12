# Spike A: Mapping Vague Architecture Claims to Code Evidence

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 2: Research & Design Spikes

## 1. Problem Statement

**Context:** DocAlign's Layer 2 (Code-to-Claim Mapper) uses a 4-step progressive strategy to map documentation claims to code files. Steps 1-3 (direct reference, symbol search, semantic search) handle ~80-90% of claims — those that mention specific files, symbols, or have behavioral descriptions similar to specific code entities.

**The problem:** 10-20% of semantic claims are architecture-level assertions that cannot be localized to a single file or entity. These come in two distinct flavors:

**Flavor A — Architecture flow claims:** Describe multi-component relationships.
- "Data flows from the API layer through a job queue to background workers"
- "The system uses an event-driven architecture with RabbitMQ"
- "The application follows a hexagonal architecture pattern"

**Flavor B — Universal/quantified claims:** Assert a property that must hold across ALL matching components, including ones that don't exist yet.
- "All services communicate via gRPC"
- "Every API endpoint validates input"
- "No module imports the deprecated legacy client"
- "Authentication is enforced at the middleware layer across all endpoints"

**Why the distinction matters:** These two flavors require fundamentally different solutions:

- **Flow claims** have a fixed set of components to verify (API → queue → worker). Decomposing the claim into sub-claims and mapping each one works well. When the components change, existing mappings trigger re-verification.

- **Universal claims** have an open-ended scope. "All services use gRPC" must catch a NEW service added next week that uses REST. Decomposition at extraction time only covers components that exist at that moment. A new file that violates the claim has no existing mapping, so no re-verification is triggered. **The current reactive model (code changes → check mapped claims) is structurally blind to new code that violates universal claims.**

**Why this matters:** Architecture claims are high-value for developers and agents — they describe the system's fundamental design. Universal claims are particularly dangerous when violated silently, because they create a false sense of consistency ("DocAlign said we're all gRPC, so this new REST service must be fine").

**Current PRD decision:** Skip unmappable claims in MVP (Option C). This spike designs the v2+ solution and validates the MVP skip.

**Spike A's output directly affects Spike B:** The decomposition strategy determines what "evidence per claim" looks like for architecture claims. For decomposed claims, evidence assembly is per-sub-claim (simpler). For static-rule claims, there is no evidence assembly — the rule evaluation IS the verification.

---

## 2. Prior Art Survey

### 2.1 Architecture Conformance Checking — Reflexion Models

**What it is:** Murphy et al. (1995/2001) introduced reflexion models: compare a developer's high-level architecture model against an automatically extracted concrete model from source code. The tool computes convergences (intended relationship exists in code), divergences (code relationship not in the model), and absences (model relationship not in code).

**Relevance:** DocAlign's problem is structurally identical — comparing a stated architecture (in documentation) against actual code. The convergence/divergence/absence framework maps directly to verified/drifted/uncertain verdicts.

**Limitations:** Reflexion models require a formal architecture specification (boxes and arrows with explicit module-to-source mappings). Documentation claims are natural language, not formal specs. The key missing step is: **natural language claim → formal architecture assertion**. This is exactly what claim decomposition must solve.

### 2.2 Architecture Test Libraries — ArchUnit, jQAssistant

**What they are:** ArchUnit (Java) lets developers write architecture rules as unit tests: "classes in package `service` should only depend on package `repository`." jQAssistant parses code into a Neo4j graph and queries it with Cypher to verify structural properties.

**Relevance:** These tools prove that structural architecture verification IS possible and useful. The pattern is: (1) express architectural property as a testable rule, (2) query the code model, (3) report violations. DocAlign needs step (1) to be automated from natural language. ArchUnit is the closest prior art for the static analysis rules approach — DocAlign auto-generates what ArchUnit requires developers to write manually.

**Limitations:** Rules must be manually written per architecture style. No natural language understanding. Java-only (ArchUnit) or heavyweight graph setup (jQAssistant). Not applicable to DocAlign's auto-detection requirement, but the rule → query → verify pattern is directly reusable.

### 2.3 Claim Decomposition — ProgramFC

**What it is:** Pan et al. (ACL 2023) proposed ProgramFC: decompose complex claims into sub-tasks solved by specialized "programs." An LLM generates a reasoning program: `fact_1 = Verify("queue library exists"); fact_2 = Verify("handlers publish to queue"); label = Predict(fact_1 AND fact_2)`. Each sub-task calls a specialized verifier. Outperforms 7 baselines on fact-checking benchmarks.

**Relevance:** Directly applicable to Flavor A (flow claims). DocAlign can decompose architecture claims into verification "programs" where each sub-claim is verified through the existing pipeline.

**Limitations:** Designed for natural language fact-checking against text corpora, not code. Decomposition produces a fixed set of sub-claims — does not handle the open-world nature of Flavor B (universal claims).

### 2.4 Policy Enforcement — OPA, Kubernetes Admission Controllers

**What they are:** Open Policy Agent (OPA) and Kubernetes admission controllers enforce universal policies ("all pods must have resource limits") by intercepting creation events and validating new resources against declarative rules. The policy doesn't maintain a "map of existing pods" — it evaluates each new resource at admission time.

**Relevance:** Directly applicable to Flavor B (universal claims). Instead of mapping universal claims to specific files, treat them as admission-style policies: when a new file is added to a PR, evaluate it against all applicable universal rules. This solves the "new file" blind spot by design.

**Limitations:** Requires a rule format expressive enough to capture architecture constraints. Rules must be safe to evaluate automatically (read-only, deterministic, bounded).

### 2.5 Structural Pattern Search — Semgrep / CodeQL

**What they are:** Semgrep uses code-like patterns for static analysis across 30+ languages. CodeQL transforms code into a queryable database with a purpose-built query language. Both excel at finding specific structural patterns.

**Relevance:** Semgrep's rule model (scope + pattern + assertion) maps cleanly to what DocAlign needs for universal claims. The key insight: DocAlign doesn't need Semgrep's implementation, just its declarative rule model — a restricted set of check types (import check, pattern match, file existence) that DocAlign evaluates with its own code.

**Limitations:** Rules must be hand-crafted per architecture style (unless auto-generated by LLM — our approach). Adding Semgrep/CodeQL as runtime dependencies is heavyweight and unnecessary.

---

## 3. Options Analysis

### 3.1 Option: Claim Decomposition + Re-Mapping

**Description:** Use an LLM to decompose vague architecture claims into 2-5 specific, localizable sub-claims. Map each sub-claim through existing Steps 1-3. Aggregate sub-claim mappings as the original claim's evidence.

**Best for:** Flavor A (architecture flow claims).

**Pros:**
- Reuses existing mapping infrastructure (no new search mechanisms)
- Sub-claims are individually testable and verifiable
- Decomposition is interpretable
- Incremental cost ($0.001 per decomposition)
- Follows ProgramFC pattern with proven effectiveness

**Cons:**
- Does NOT solve the universal claim problem (Flavor B) — decomposition only covers components that exist at decomposition time
- Decomposition quality depends on LLM understanding of software architecture
- Some claims genuinely resist decomposition ("good separation of concerns")

**Complexity:** 3-5 implementation days
**Cost:** ~$0.001 per decomposition (GPT-4o-mini, ~500 input tokens, ~200 output tokens)

### 3.2 Option: File-Tree + LLM Reasoning

**Description:** Filter the repo file tree to potentially relevant directories using claim keywords. Present the filtered tree to an LLM and ask it to select the most relevant files (up to 5).

**Best for:** Neither flavor well.

**Pros:**
- Simple implementation (single LLM call)

**Cons:**
- LLM sees only file paths, no code content
- High false positive rate
- Doesn't explain WHY files were selected
- Still doesn't solve universal claims (static snapshot)

**Complexity:** 2-3 implementation days
**Cost:** ~$0.001-0.005 per claim

### 3.3 Option: Iterative RAG Exploration

**Description:** Start with claim keywords → semantic search → follow imports/callers → build relevance graph → select most relevant files.

**Best for:** Flavor A (flow claims), but overkill.

**Pros:**
- Explores the codebase contextually
- Finds non-obvious connections

**Cons:**
- Complex to implement (5-8 days)
- Expensive ($0.002-0.005 per claim)
- Doesn't solve universal claims
- Hard to know when to stop

**Complexity:** 5-8 implementation days
**Cost:** ~$0.002-0.005 per claim

### 3.4 Option: Scope-Triggered LLM Verification

**Description:** Universal claims declare a scope pattern (glob). When a PR adds a new file matching the scope, verify the file against the claim using an LLM call.

**Best for:** Flavor B (universal claims), but expensive.

**Pros:**
- Catches new files automatically
- Scope patterns are inspectable

**Cons:**
- Requires an LLM call per (new file × matched universal claim) — cost scales with PR size
- LLM verification is non-deterministic (flaky results)
- Scope pattern extraction depends on LLM quality

**Complexity:** 3-4 implementation days
**Cost:** ~$0.003-0.02 per matched file (Tier 4 LLM verification)

### 3.5 Option: LLM-Generated Static Analysis Rules

**Description:** For universal claims, the LLM generates a declarative rule (structured data, not executable code) at claim extraction time. DocAlign has a fixed set of rule evaluators (import checks, pattern grep, AST queries, dependency checks) that it runs deterministically against all files matching the rule's scope pattern.

**Best for:** Flavor B (universal claims).

**Pros:**
- Catches new files automatically (scope glob runs at evaluation time against current repo)
- Deterministic after generation — zero LLM cost at verification time
- Safe by construction (rules are data, not code — no sandbox needed)
- Fast (~10ms per file)
- Inspectable and overridable by developers in `.docalign.yml`
- Follows ArchUnit's proven model, but auto-generated

**Cons:**
- Not all universal claims have clean static tests (~20-30% need semantic reasoning and still require LLM verification)
- Rule generation quality depends on LLM
- Static test rules can become stale as frameworks evolve (e.g., new gRPC import path)
- Limited to what the fixed rule types can express

**Complexity:** 4-6 implementation days (rule schema + evaluator + LLM generation prompt)
**Cost:** ~$0.001 per rule generation (one-time); $0 per evaluation

---

## 4. Recommendation

**Recommended: Dual mechanism — Option 3.5 (Static Analysis Rules) for universal claims + Option 3.1 (Decomposition) for architecture flow claims.**

The two flavors of vague claims need different solutions:

| Claim Flavor | Example | Solution | Verification Method |
|-------------|---------|----------|-------------------|
| Architecture flow | "Data flows from API to queue to worker" | Decomposition into sub-claims | LLM (Tier 4) per sub-claim |
| Universal/quantified | "All services use gRPC" | Static analysis rule | Deterministic rule evaluation |

**Rationale:**

1. **Different problems, different solutions.** Flow claims describe specific multi-component relationships (fixed scope, needs semantic understanding). Universal claims assert a property over an open set (dynamic scope, often checkable mechanically). Forcing both through decomposition leaves universal claims vulnerable to the "new file" blind spot.

2. **Static rules solve the new-file problem by construction.** The scope glob runs at evaluation time. A new `services/billing/api.ts` is automatically matched and checked against all applicable rules. No mapping needed. No LLM needed. No blind spot.

3. **Static rules are dramatically cheaper.** At verification time: $0 and ~10ms per file vs $0.003-0.02 and ~2s for LLM verification. For a repo with 50 universal claims and 5 new files per PR, this is 250 free evaluations vs 250 LLM calls ($0.75-5.00 per PR).

4. **Decomposition remains the right tool for flow claims.** "Data flows from API to queue to worker" can't be captured as an import check or grep pattern. It needs semantic understanding of how components interact. Decomposition + per-sub-claim LLM verification handles this well.

5. **The 70/30 split favors static rules.** Of universal claims that reach Step 4, roughly 70-80% can be expressed as static rules (import checks, dependency presence, pattern matching, file existence). The remaining 20-30% that require semantic reasoning fall through to decomposition + LLM verification.

**Claim routing at Step 4:**
```
Claim reaches Step 4 (failed Steps 1-3)
        |
   Is it universal/quantified?
   ("all", "every", "no", "always", "never")
    /              \
  YES               NO
   |                 |
   v                 v
Generate         Decompose into
Static Rule      sub-claims
   |                 |
   v                 v
Evaluate on      Map sub-claims
every PR         via Steps 1-3
(deterministic)  (then verify via
                  Layer 3 Tier 4)
```

**MVP validation:** The MVP decision to skip Step 4 (Option C) is confirmed as acceptable. However, the MVP SHOULD:
1. Track which claims fall through to Step 4 (store `mapping_method: 'skipped_flow'` or `'skipped_universal'`)
2. Classify skipped claims as flow vs universal to measure the distribution
3. This data directly informs v2 implementation priorities

---

## 5. Detailed Specification

### 5.1 Mechanism A: Static Analysis Rules (Universal Claims)

#### 5.1.1 Rule Schema

```typescript
/** A static analysis rule generated from a universal claim */
interface StaticAnalysisRule {
  /** ID of the claim this rule verifies */
  claim_id: string;

  /** Glob pattern defining which files are in scope */
  scope: string;

  /** Optional scope exclusions */
  scope_exclude?: string[];

  /** Checks to run against each file in scope (AND logic — all must pass) */
  checks: StaticCheck[];

  /** Whether the rule was auto-generated or user-defined */
  source: 'llm_generated' | 'user_defined';

  /** LLM generation cost tracking */
  generation_cost_usd?: number;
}

/** A single check within a rule */
type StaticCheck =
  | { type: 'require_any_import'; values: string[] }
  | { type: 'forbid_import'; values: string[] }
  | { type: 'require_dependency'; name: string; version?: string }
  | { type: 'forbid_dependency'; name: string }
  | { type: 'require_pattern'; regex: string }
  | { type: 'forbid_pattern'; regex: string }
  | { type: 'require_file_exists'; paths: string[] }
  | { type: 'require_ast_node'; node_type: string; name?: string }
  | { type: 'min_file_count'; count: number };
```

#### 5.1.2 Supported Rule Types

| Rule Type | What it checks | Example use case |
|-----------|---------------|-----------------|
| `require_any_import` | File must import at least one of these modules | "All services use gRPC" → require `@grpc/grpc-js` |
| `forbid_import` | File must NOT import any of these | "No service uses the legacy REST client" → forbid `axios`, `node-fetch` |
| `require_dependency` | Package manifest must contain this dependency | "The system uses PostgreSQL" → require `pg` |
| `forbid_dependency` | Package manifest must NOT contain this | "No module uses deprecated ORM" → forbid `sequelize` |
| `require_pattern` | Regex must match somewhere in file | "All endpoints use auth middleware" → require `@UseGuards(AuthGuard` |
| `forbid_pattern` | Regex must NOT appear in file | "No console.log in production code" → forbid `console\.log` |
| `require_file_exists` | These files/patterns must exist | "Every service has a Dockerfile" → require `Dockerfile` relative to scope |
| `require_ast_node` | AST must contain a specific node type | "All classes use injectable decorator" → require decorator `Injectable` |
| `min_file_count` | Scope must match at least N files | Sanity check: "at least 1 service exists" |

#### 5.1.3 Rule Generation Algorithm

```
INPUT: universal claim (contains "all", "every", "no", "always", "never" or similar quantifier)
       project_context (language, frameworks, dependencies from package manifest)

STEP 1: GENERATE RULE
  - Send claim + project context to LLM
  - LLM returns a StaticAnalysisRule (structured output, JSON mode)
  - Validate: scope is a valid glob, checks use only supported types,
    regex patterns compile without error, values are non-empty
  - If validation fails, retry once with error feedback

STEP 2: STORE
  - Store rule in DB linked to claim_id
  - Mark claim mapping_method = 'static_rule'

STEP 3: EVALUATE (on every PR and full scan)
  - Expand scope glob against current repo file tree
  - For each matched file:
    - Run all checks (AND logic)
    - If any check fails → file is a violation
  - If any file violates → claim verdict = 'drifted'
  - If all files pass → claim verdict = 'verified'
  - If scope matches 0 files → claim verdict = 'uncertain' (scope may be wrong)

OUTPUT: RuleEvaluationResult (verdict, violating files, scope match count)
```

#### 5.1.4 Rule Evaluation Flow Diagram

```
PR opened / Full scan triggered
        |
        v
+-------------------------+
| For each universal claim |
| with a static rule:      |
+------------+------------+
             |
             v
+-------------------------+
| Expand scope glob       |
| against current repo    |
| (includes NEW files)    |
+------------+------------+
             |
        matched files?
        /          \
      YES           NONE
       |              |
       v              v
+-------------+   UNCERTAIN
| For each    |   (bad scope?)
| matched file|
+------+------+
       |
  run all checks
       |
  all pass?
  /       \
YES        NO
 |          |
 v          v
VERIFIED   DRIFTED
           (list violations)
```

### 5.2 Mechanism B: Claim Decomposition (Architecture Flow Claims)

#### 5.2.1 Algorithm

```
INPUT: flow claim (architecture/behavior type, not universal/quantified)
       codebase_index (from Layer 0)

STEP 1: DECOMPOSE
  - Send claim to LLM with project context (language, frameworks, dependencies)
  - LLM returns 2-5 sub-claims, each with:
    - sub_claim_text: string (the localizable assertion)
    - expected_evidence_type: 'dependency' | 'symbol' | 'file' | 'pattern' | 'behavior'
    - search_hints: string[] (keywords, likely file patterns)
  - If LLM returns 0 sub-claims or says "not decomposable":
    mark original claim as unmappable, STOP

STEP 2: MAP SUB-CLAIMS
  For each sub-claim:
    - Route to appropriate mapper step based on expected_evidence_type:
      - 'dependency' → Step 1 (direct reference mapper, check package manifest)
      - 'symbol' → Step 2 (AST symbol search)
      - 'file' → Step 1 (file existence check)
      - 'pattern' → Step 3 (semantic search)
      - 'behavior' → Step 3 (semantic search)
    - Record mapping result (files found, confidence, method)

STEP 3: AGGREGATE
  - Count: how many sub-claims mapped successfully (confidence >= 0.7)?
  - If >= 50% of sub-claims mapped: original claim is "mappable"
    - Store all sub-claim mappings as child mappings of the original claim
    - Original claim's aggregate confidence = mean of mapped sub-claim confidences
    - Original claim's mapping_method = 'llm_assisted'
  - If < 50% mapped: original claim is "partially mappable"
    - Store whatever mapped, flag as low-confidence (confidence = 0.3)
  - If 0 sub-claims mapped: original claim is "unmappable"

OUTPUT: ClaimMapping[] (one per mapped sub-claim) + parent mapping record
```

#### 5.2.2 Data Structures

```typescript
/** Sub-claim produced by decomposition */
interface DecomposedSubClaim {
  id: string;
  parent_claim_id: string;
  sub_claim_text: string;
  expected_evidence_type: 'dependency' | 'symbol' | 'file' | 'pattern' | 'behavior';
  search_hints: string[];
  ordinal: number;
}

/** LLM decomposition output */
interface DecompositionResult {
  sub_claims: DecomposedSubClaim[];
  is_decomposable: boolean;
  reasoning: string;
  input_tokens: number;
  output_tokens: number;
}

/** Aggregated mapping result for flow claims */
interface FlowClaimMapping {
  claim_id: string;
  sub_claim_mappings: SubClaimMapping[];
  aggregate_confidence: number;
  status: 'mapped' | 'partially_mapped' | 'unmappable';
  cost_usd: number;
  duration_ms: number;
}

interface SubClaimMapping {
  sub_claim: DecomposedSubClaim;
  mapping: ClaimMapping | null;
  mapped: boolean;
}
```

### 5.3 Claim Classification (Routing)

At Step 4 entry, claims must be classified as universal vs flow to route to the correct mechanism. This classification happens in the decomposition/rule-generation LLM call — the LLM is asked to first classify, then produce the appropriate output.

```typescript
/** Classification of a vague claim */
type VagueClaimClassification =
  | { type: 'universal'; quantifier: string }   // → static rule
  | { type: 'flow'; components: string[] }       // → decomposition
  | { type: 'untestable'; reason: string };      // → mark unmappable
```

**Heuristic pre-filter (before LLM):** Claims containing "all", "every", "no ", "never", "always", "each", "any" (as whole words, case-insensitive) are likely universal. Claims containing flow language ("flows", "passes through", "sends to", "receives from", "connects to") are likely flow claims. These heuristics route to the LLM with a bias, but the LLM makes the final classification.

---

## 6. Worked Examples

### 6.1 Worked Example A: Static Rule (Universal Claim)

#### Input

**Claim (from `docs/architecture.md`, line 15):**
> "All services communicate via gRPC"

**Project context:** Node.js/TypeScript, dependencies include `@grpc/grpc-js`, `@nestjs/microservices`

**Repo structure:**
```
src/services/
  users/user-service.ts      # imports @grpc/grpc-js
  orders/order-service.ts    # imports @grpc/grpc-js
  billing/billing-service.ts # imports @grpc/grpc-js
package.json                 # @grpc/grpc-js: ^1.9.0
```

#### Processing

**Step 1: Classify** → Universal (contains "All services")

**Step 2: Generate rule** (LLM call)

```json
{
  "scope": "**/services/**/*.ts",
  "scope_exclude": ["**/*.test.ts", "**/*.spec.ts"],
  "checks": [
    {
      "type": "require_any_import",
      "values": ["@grpc/grpc-js", "@nestjs/microservices", "grpc"]
    },
    {
      "type": "forbid_import",
      "values": ["express", "fastify", "axios", "node-fetch", "@nestjs/platform-express"]
    }
  ],
  "source": "llm_generated"
}
```

**Step 3: Evaluate** (deterministic, on every PR)

| File | `require_any_import` | `forbid_import` | Result |
|------|---------------------|----------------|--------|
| `users/user-service.ts` | `@grpc/grpc-js` found | No forbidden imports | PASS |
| `orders/order-service.ts` | `@grpc/grpc-js` found | No forbidden imports | PASS |
| `billing/billing-service.ts` | `@grpc/grpc-js` found | No forbidden imports | PASS |

**Verdict:** All 3 files pass → claim is **verified**.

#### The "New Service" Scenario (why this matters)

**Next week, a developer opens a PR adding `src/services/notifications/notification-service.ts`:**

```typescript
import express from 'express';  // REST, not gRPC!
import { sendPushNotification } from './push-client';
// ...
```

**Rule evaluation on this PR:**

| File | `require_any_import` | `forbid_import` | Result |
|------|---------------------|----------------|--------|
| `notification-service.ts` | No gRPC import found | `express` found | **FAIL** |

**Verdict:** Claim is **drifted**. Violation: `src/services/notifications/notification-service.ts` — imports `express` (forbidden) and does not import any gRPC library (required).

**The new file was caught automatically** because the scope glob `**/services/**/*.ts` matches it at evaluation time. No mapping update needed. No re-decomposition. Zero LLM cost.

### 6.2 Worked Example B: Decomposition (Architecture Flow Claim)

#### Input

**Claim (from `docs/architecture.md`, line 42):**
> "The order processing system uses an event-driven architecture. When a new order is created via the API, an event is published to RabbitMQ, and a background worker processes the order asynchronously."

**Project context:** Node.js/TypeScript, dependencies include `amqplib`, `express`

**Repo structure:**
```
src/
  api/routes/orders.ts        # Express route handler
  services/order-service.ts   # Business logic
  queue/publisher.ts          # Publishes to RabbitMQ
  queue/consumer.ts           # Consumes from RabbitMQ
  workers/order-processor.ts  # Processes order events
package.json                  # amqplib: ^0.10.3
```

#### Processing

**Step 1: Classify** → Flow claim (describes API → queue → worker flow, no universal quantifier)

**Step 2: Decompose** (LLM call)

```json
{
  "is_decomposable": true,
  "reasoning": "3-component event-driven flow: API → message queue → worker. Each independently verifiable.",
  "sub_claims": [
    {
      "sub_claim_text": "An API endpoint exists for creating orders",
      "expected_evidence_type": "symbol",
      "search_hints": ["orders", "createOrder", "POST", "/api/orders"],
      "ordinal": 1
    },
    {
      "sub_claim_text": "RabbitMQ client library is a dependency",
      "expected_evidence_type": "dependency",
      "search_hints": ["amqplib", "rabbitmq"],
      "ordinal": 2
    },
    {
      "sub_claim_text": "Code publishes messages/events to a queue on order creation",
      "expected_evidence_type": "behavior",
      "search_hints": ["publish", "sendToQueue", "channel.publish"],
      "ordinal": 3
    },
    {
      "sub_claim_text": "A background worker consumes messages from the queue",
      "expected_evidence_type": "behavior",
      "search_hints": ["consume", "channel.consume", "worker", "processor"],
      "ordinal": 4
    }
  ]
}
```

**Step 3: Map each sub-claim via Steps 1-3**

| Sub-claim | Step | Result | Confidence |
|-----------|------|--------|------------|
| Order API endpoint | Step 2 (symbol) | `orders.ts` with `POST /api/orders` | 0.95 |
| RabbitMQ dependency | Step 1 (direct) | `amqplib: ^0.10.3` in package.json | 1.0 |
| Publish to queue | Step 3 (semantic) | `publisher.ts` — `publishOrderEvent()` | 0.87 |
| Worker consumes | Step 3 (semantic) | `consumer.ts` (0.84), `order-processor.ts` (0.81) | 0.84 |

**Step 4: Aggregate** — 4/4 mapped → status: `mapped`, confidence: mean(0.95, 1.0, 0.87, 0.84) = 0.915

**What Layer 3 receives:** Four independently verifiable sub-claims, each with specific code evidence.

---

## 7. Adversarial Examples

### 7.1 Adversarial: Scope pattern too narrow (static rule)

**Claim:** "All API endpoints validate input"
**Generated scope:** `**/routes/**/*.ts`
**Reality:** Some endpoints are in `**/controllers/**/*.ts` (developer used a different convention for a new module).

**Result:** Controller-based endpoints are not matched by the scope → violations are missed.

**Mitigation:** (a) The LLM should generate broader scope patterns when the claim uses generic terms ("endpoints" vs "routes"). Prompt engineering: "Prefer broader scopes that over-match rather than under-match." (b) Developer can correct the scope in `.docalign.yml`. (c) Periodic full reconciliation (weekly scheduled scan) can use LLM-based verification as a safety net for claims where static rules might miss files. (d) Track scope match count over time — if it suddenly drops or stays suspiciously low, flag for review.

### 7.2 Adversarial: Claim that resists both mechanisms

**Claim:** "The codebase follows the principle of least privilege throughout."

**What happens:** Classification → neither universal (no clear quantifier over a file set) nor flow (no components). LLM classifies as `untestable` — "principle of least privilege" is a design philosophy, not a verifiable structural property.

**Result:** Claim marked as `unmappable`. Correct behavior — this claim is genuinely not verifiable by automated static or semantic analysis.

**Mitigation:** Track unmappable claims. If >50% of architecture claims are unmappable, reconsider the claim type taxonomy (maybe split `architecture` into `structural` vs `philosophical`). Philosophical claims could be silently excluded from verification.

### 7.3 Adversarial: Static rule checks pass but claim is semantically wrong

**Claim:** "All services communicate via gRPC"
**Generated rule:** require import `@grpc/grpc-js`

**Reality:** `payment-service.ts` imports `@grpc/grpc-js` but ALSO imports `axios` and makes REST calls to an external payment provider. The service does use gRPC internally but also uses REST — is the claim violated?

**Result:** The `forbid_import` check catches `axios` and flags a violation. But the violation may be a false positive — the claim means "inter-service communication uses gRPC," not "services never use HTTP for anything."

**Mitigation:** (a) This is actually a valuable finding — it surfaces ambiguity in the documentation. The PR comment can say: "payment-service.ts imports both gRPC and axios. If the claim means all inter-service communication uses gRPC, this may be expected (external API calls via REST). Consider clarifying the documentation." (b) Developer can add a suppression rule or refine the claim. (c) The static rule approach makes this explicit — the developer sees exactly what check failed and can judge whether it's a real violation.

### 7.4 Adversarial: Decomposition with stale sub-claims

**Claim:** "The authentication system uses Passport.js with JWT strategy."

**What happens:** Decomposition produces sub-claims mapping to `passport` in package.json and `auth/jwt-strategy.ts`. Both exist. But the team migrated to a custom auth library — Passport.js is an unused dependency, and the old files are dead code.

**Result:** Sub-claims map to real but obsolete files. Verification against dead code may produce incorrect verdicts.

**Mitigation:** This is a verification challenge (Layer 3's responsibility), not a mapping failure. The mapper found relevant files. Layer 3's semantic verification should detect unused code patterns. Additionally, when the developer dismisses the finding, Layer 7 (learning system) suppresses it.

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Static rules: scope pattern too narrow** — misses files in unexpected directories | Medium | High — silent false negatives | LLM prompt biases toward broad scopes. Developer override in `.docalign.yml`. Track scope match counts. Weekly full scan as safety net. |
| **Static rules: stale rule types** — new import paths or framework conventions make checks obsolete | Low | Medium — false positives/negatives | Rule regeneration when claim text changes or on periodic schedule. Rule type library is extensible. |
| **Static rules: ~20-30% of universal claims can't be expressed as static rules** | High | Low — expected, handled by fallback | Claims that resist static rules fall through to decomposition + LLM verification. Track the split to calibrate. |
| **Decomposition: LLM produces irrelevant sub-claims** | Medium | Medium — wastes mapping budget | Structured output with validation. Reject sub-claims without actionable search hints. Calibrate prompt with 20+ examples. |
| **Decomposition: doesn't catch new components** (Flavor B blind spot) | High for universal claims | High — false negatives | This is exactly why universal claims use static rules instead. Decomposition is only used for flow claims where the component set is implicitly bounded. |
| **Classification: LLM mis-routes a universal claim as flow (or vice versa)** | Low | Medium — wrong mechanism applied | Heuristic pre-filter catches most universals. LLM classification has high accuracy for quantifier detection. Worst case: a universal claim gets decomposed (sub-optimal but not broken — it just doesn't catch new files). |
| **Rule generation cost at scale** | Low | Low | ~$0.001 per rule, one-time. 200 claims × 15% universal = 30 rules = $0.03. |

---

## 9. Founder Decisions

All questions resolved on 2026-02-10. Founder accepted all recommendations.

1. **MVP data collection:** ✅ Yes — MVP tracks Step 4 fallthrough with `mapping_method: 'skipped_flow'` / `'skipped_universal'` classification.

2. **Sub-claim storage:** ✅ First-class claims in the `claims` table with `parent_claim_id`. Enables independent verification, feedback, and reuse.

3. **Rule override UX:** ✅ Yes — developers can define/override static rules in `.docalign.yml`:
   ```yaml
   rules:
     - claim_pattern: "All services*gRPC"  # regex match on claim text
       scope: "**/services/**/*.ts"
       checks:
         - type: require_any_import
           values: ["@grpc/grpc-js"]
   ```

4. **Unmappable claim UX:** ✅ Silently omit in PR comments. Show count in health dashboard (v3).

5. **Rule evaluation frequency:** ✅ Both — run on every PR (primary gate) AND full scans (safety net).

6. **Scope expansion alert:** ✅ Log only. Alert only if a previously-passing rule now has violations.
