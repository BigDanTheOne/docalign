# Phase 4B: Prompt Specifications

> Part of [DocAlign Workflow](../WORKFLOW.md) -- Phase 4B: Prompt Specifications (Track B)
>
> **Inputs:** phase4-api-contracts.md, tdd-1-claim-extractor.md, tdd-3-verifier.md, tdd-5-reporter.md, spike-a-vague-claim-mapping.md, spike-b-evidence-assembly.md, spike-c-learning-generalization.md, phase3-error-handling.md, technical-reference.md
>
> **Purpose:** Complete, implementation-ready specifications for every LLM prompt in the DocAlign system. Every field, every placeholder, every output schema is defined here. No ambiguity remains for the implementing agent.
>
> **Date:** 2026-02-11
>
> **Working title:** "DocAlign" is a placeholder name. See phase4c-ux-specs.md header for the full list of strings to replace when the final name is decided.

---

## Table of Contents

1. [Global Prompt Conventions](#1-global-prompt-conventions)
2. [P-EXTRACT: Semantic Claim Extraction](#2-p-extract-semantic-claim-extraction) -- MVP Active
3. [P-TRIAGE: Quick LLM Triage](#3-p-triage-quick-llm-triage) -- MVP Active
4. [P-VERIFY: Deep Semantic Verification](#4-p-verify-deep-semantic-verification) -- MVP Active
   - 4A. [P-VERIFY Path 1 (Evidence Provided)](#4a-p-verify-path-1-evidence-provided)
   - 4B. [P-VERIFY Path 2 (Agent Explores)](#4b-p-verify-path-2-agent-explores)
5. [P-FIX: Fix Generation](#5-p-fix-fix-generation) -- MVP Active
6. [P-MAP-LLM: LLM-Assisted Mapping](#6-p-map-llm-llm-assisted-mapping) -- v2-deferred
7. [P-DECOMPOSE: Vague Claim Decomposition](#7-p-decompose-vague-claim-decomposition) -- v2-deferred
8. [P-POSTCHECK: Post-Check Verification Script](#8-p-postcheck-post-check-verification-script) -- v2-deferred
9. [P-LEARN: Feedback Interpretation](#9-p-learn-feedback-interpretation) -- v2-deferred
10. [Cross-Cutting: Retry and Fallback Protocol](#10-cross-cutting-retry-and-fallback-protocol)
11. [Cost Estimation Summary](#11-cost-estimation-summary)
12. [Appendix A: Prompt-to-Task Type Mapping](#appendix-a-prompt-to-task-type-mapping)
13. [Appendix B: Output Type Conformance Matrix](#appendix-b-output-type-conformance-matrix)

---

## 1. Global Prompt Conventions

### 1.1 Execution Model

ALL LLM calls execute **client-side** in the GitHub Action. DocAlign's server makes ZERO LLM calls and never sees client code. The Action uses the client's own API key. Default models are `claude-sonnet-4-5-20250929` (verification, extraction, fix generation) and `claude-haiku-3-5-20241022` (triage only), configurable via `.docalign.yml`.

### 1.2 Default Parameters

| Parameter | Default Value | Configurable? |
|-----------|---------------|---------------|
| Model (most prompts) | `claude-sonnet-4-5-20250929` | Yes, via `.docalign.yml` `llm.verification_model` / `llm.extraction_model` |
| Model (P-TRIAGE only) | `claude-haiku-3-5-20241022` | Yes, via `.docalign.yml` `llm.triage_model` |
| Temperature | `0` (except P-FIX: `0.3`) | No |
| Response format | `{ type: 'json_schema', json_schema: { ... } }` | No |
| Top-p | `1.0` (default) | No |
| Stop sequences | None | No |

### 1.3 Token Budget Defaults

| Prompt | Max output tokens |
|--------|-------------------|
| P-EXTRACT | 2000 |
| P-TRIAGE | 150 |
| P-VERIFY Path 1 | 1000 |
| P-VERIFY Path 2 | 1500 |
| P-FIX | 500 |
| P-MAP-LLM (v2) | 800 |
| P-DECOMPOSE (v2) | 1000 |
| P-POSTCHECK (v2) | 300 |
| P-LEARN (v2) | 600 |

### 1.4 JSON Schema Enforcement

All prompts use `response_format: { type: 'json_schema', json_schema: { name: '<prompt_id>_response', strict: true, schema: { ... } } }`. This ensures the LLM returns valid JSON matching the declared schema. All output types conform exactly to the corresponding `AgentTaskResultData` variant from `phase4-api-contracts.md` Section 10.3.

### 1.5 No-Hallucination Constraint

Every prompt includes an explicit instruction: the model must NOT hallucinate code references it has not been shown. For P-VERIFY Path 2 (agent explores), the model may reference files it reads during exploration, but must not invent file paths or function names.

### 1.6 Error Handling Convention

Every prompt caller must:
1. Parse the JSON response with `JSON.parse()`. On failure: `DOCALIGN_E201`.
2. Validate with the Zod schema for that prompt. On failure: `DOCALIGN_E202`.
3. On either error: retry once with the JSON-only suffix appended (see Section 10.2).
4. On second failure: mark task `failed`, apply per-prompt fallback (see Section 10.3).
5. Log `model_used`, `tokens_used`, `cost_usd`, and `duration_ms` in `TaskResultMetadata`.

### 1.7 Placeholder Notation

In prompt templates below, placeholders are written as `{{placeholder_name}}`. These map to fields from the corresponding `AgentTaskPayload` type in `phase4-api-contracts.md` Section 10.2. Runtime code replaces them with actual values. Handlebars-style `{{#each}}` denotes iteration.

---

## 2. P-EXTRACT: Semantic Claim Extraction

### 2.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-EXTRACT` |
| **Purpose** | Extract semantic (behavior, architecture, config, convention, environment) claims from documentation chunks. Syntactic claims (path_reference, command, dependency_version, api_route, code_example) are handled deterministically server-side -- this prompt only handles the 5 semantic types. |
| **Used in** | Layer 1 (Claim Extractor), `claim_extraction` agent task type |
| **MVP Status** | **Active** |
| **Model** | Claude Sonnet (`claude-sonnet-4-5-20250929`) |
| **Temperature** | 0 |
| **Max tokens** | 2000 |
| **Top-p** | 1.0 |

### 2.2 System Prompt

```
You are a documentation claim extractor for a code verification system. Your job is to identify every factual claim about the codebase in a documentation section that could be verified by examining source code.

You extract ONLY semantic claims -- claims about behavior, architecture, configuration, conventions, or environment that require reasoning to verify. The following claim types are handled separately by deterministic extraction and you must NOT extract them:
- File paths (e.g., "see src/config.ts")
- CLI commands (e.g., "npm run build")
- Dependency versions (e.g., "requires React 18+")
- API routes (e.g., "GET /api/users")
- Code examples (fenced code blocks)

Rules:
1. ONLY extract claims about what the code IS or DOES right now. Skip aspirational statements ("we plan to", "in the future"), opinions, and generic advice.
2. Each claim must be independently verifiable against source code.
3. Each claim must reference a specific code construct: a function, module, service, pattern, data flow, configuration, or convention.
4. Do NOT extract duplicate claims. If the same fact is stated multiple times, extract it once.
5. Be conservative: if a sentence is vague and would be impossible to verify against any code, skip it.
6. Do NOT invent or assume code references that are not explicitly stated in the documentation text.

Classify each claim into exactly one type:
- "behavior": How a specific function, module, or service behaves (e.g., "The auth middleware validates JWT tokens", "Passwords are hashed with bcrypt")
- "architecture": How components connect, data flows between services, system structure (e.g., "Events are published to Redis and consumed by the worker", "The API gateway routes to three microservices")
- "config": What configuration keys exist and their values/defaults (e.g., "The default timeout is 30 seconds", "Logging level defaults to 'info'")
- "convention": Project-wide coding patterns and standards (e.g., "All API handlers follow the controller-service pattern", "Strict TypeScript is enforced")
- "environment": Runtime environment requirements (e.g., "Requires PostgreSQL 15", "Uses Docker for development")

Return a JSON object matching the schema. If no verifiable claims exist, return an empty claims array.
```

### 2.3 User Prompt Template

```
Project context:
- Language: {{project_context.language}}
- Frameworks: {{project_context.frameworks | join(", ")}}

Documentation file: {{source_file}}
Chunk heading: {{chunk_heading}}
Start line: {{start_line}}

---
{{chunk_content}}
---

Extract all verifiable semantic claims from this documentation section. Return a JSON object matching the schema exactly.
```

### 2.4 Output JSON Schema

```json
{
  "name": "p_extract_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "const": "claim_extraction" },
      "claims": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "claim_text": { "type": "string", "description": "The exact sentence or phrase making the claim" },
            "claim_type": { "type": "string", "enum": ["behavior", "architecture", "config", "convention", "environment"] },
            "source_file": { "type": "string", "description": "Documentation file path" },
            "source_line": { "type": "integer", "description": "Line number in the source file" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "keywords": {
              "type": "array",
              "items": { "type": "string" },
              "minItems": 1,
              "maxItems": 5,
              "description": "Code-relevant keywords for symbol search in the mapper"
            }
          },
          "required": ["claim_text", "claim_type", "source_file", "source_line", "confidence", "keywords"],
          "additionalProperties": false
        }
      }
    },
    "required": ["type", "claims"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PExtractOutputSchema = z.object({
  type: z.literal('claim_extraction'),
  claims: z.array(z.object({
    claim_text: z.string().min(1),
    claim_type: z.enum(['behavior', 'architecture', 'config', 'convention', 'environment']),
    source_file: z.string().min(1),
    source_line: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    keywords: z.array(z.string()).min(1).max(5),
  })),
});
```

Maps to `ClaimExtractionResult` from `phase4-api-contracts.md` Section 10.3.

**Note on `extracted_value`:** The LLM does NOT return `extracted_value`. The Action constructs it after receiving the LLM response: `{ type: <claim_type>, description: <claim_text> }` for behavior/architecture/convention/environment, or `{ type: 'config', key: <parsed_key>, value: <parsed_value> }` for config claims. This is a post-processing step, not part of the LLM output schema.

### 2.5 Examples

**Example 1: Standard extraction from an architecture doc**

Input:
```
project_context: { language: "TypeScript", frameworks: ["Express", "Redis"] }
source_file: "docs/architecture.md"
chunk_heading: "Authentication"
start_line: 45
chunk_content: |
  The AuthService handles password reset via email. It generates a one-time
  token using crypto.randomUUID() and stores it in Redis with a 15-minute TTL.
  The password reset flow is rate-limited to 3 attempts per hour per user.
```

Output:
```json
{
  "type": "claim_extraction",
  "claims": [
    {
      "claim_text": "The AuthService handles password reset via email.",
      "claim_type": "behavior",
      "source_file": "docs/architecture.md",
      "source_line": 45,
      "confidence": 0.9,
      "keywords": ["AuthService", "password", "reset", "email"]
    },
    {
      "claim_text": "It generates a one-time token using crypto.randomUUID() and stores it in Redis with a 15-minute TTL.",
      "claim_type": "behavior",
      "source_file": "docs/architecture.md",
      "source_line": 46,
      "confidence": 0.95,
      "keywords": ["crypto", "randomUUID", "Redis", "TTL", "token"]
    },
    {
      "claim_text": "The password reset flow is rate-limited to 3 attempts per hour per user.",
      "claim_type": "behavior",
      "source_file": "docs/architecture.md",
      "source_line": 47,
      "confidence": 0.85,
      "keywords": ["rate-limit", "password", "reset"]
    }
  ]
}
```

**Example 2: Architecture flow claims**

Input:
```
project_context: { language: "TypeScript", frameworks: ["NestJS"] }
source_file: "ARCHITECTURE.md"
chunk_heading: "Data Flow"
start_line: 12
chunk_content: |
  The application follows a hexagonal architecture. Inbound adapters receive
  HTTP requests and publish domain events to an internal event bus. Outbound
  adapters handle persistence via PostgreSQL and notification delivery via SendGrid.
```

Output:
```json
{
  "type": "claim_extraction",
  "claims": [
    {
      "claim_text": "The application follows a hexagonal architecture.",
      "claim_type": "architecture",
      "source_file": "ARCHITECTURE.md",
      "source_line": 12,
      "confidence": 0.75,
      "keywords": ["hexagonal", "adapter", "port"]
    },
    {
      "claim_text": "Inbound adapters receive HTTP requests and publish domain events to an internal event bus.",
      "claim_type": "architecture",
      "source_file": "ARCHITECTURE.md",
      "source_line": 12,
      "confidence": 0.85,
      "keywords": ["adapter", "event", "bus", "HTTP"]
    },
    {
      "claim_text": "Outbound adapters handle persistence via PostgreSQL and notification delivery via SendGrid.",
      "claim_type": "architecture",
      "source_file": "ARCHITECTURE.md",
      "source_line": 13,
      "confidence": 0.9,
      "keywords": ["PostgreSQL", "SendGrid", "persistence", "adapter"]
    }
  ]
}
```

**Example 3: Edge case -- no verifiable claims (opinions only)**

Input:
```
project_context: { language: "TypeScript", frameworks: ["Express"] }
source_file: "README.md"
chunk_heading: "Philosophy"
start_line: 5
chunk_content: |
  We believe in clean code and test-driven development. Good documentation
  is important. We aim to keep our codebase maintainable and readable for
  new contributors.
```

Output:
```json
{
  "type": "claim_extraction",
  "claims": []
}
```

Rationale: All statements are opinions or aspirational. No specific, verifiable code construct is referenced.

**Example 4: Failure mode -- model returns markdown wrapper**

LLM output (invalid):
```markdown
Here are the claims:
```json
{ "type": "claim_extraction", "claims": [...] }
```
```

Handling: `JSON.parse()` fails because of the markdown code fence wrapper. Error code `DOCALIGN_E201`. Retry once with JSON-only suffix. On second failure: task marked failed, this chunk produces zero claims. Other chunks proceed independently.

### 2.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Detection | Fallback Behavior |
|--------------|-----------|-----------|-------------------|
| Unparseable JSON (markdown wrapping, code fences, commentary) | DOCALIGN_E201 | `JSON.parse()` throws | Retry once. On 2nd failure: task failed, chunk = 0 claims. |
| Valid JSON but wrong schema (missing `claim_type`, confidence out of range) | DOCALIGN_E202 | Zod `.safeParse()` returns `{ success: false }` | Retry once. On 2nd failure: task failed, chunk = 0 claims. |
| Model extracts syntactic claims (file paths, commands) despite instructions | N/A | Action-side filter: reject claims where `claim_type` not in the 5 semantic types | Filter out silently. Log warning if >30% filtered. |
| Excessive claims (>50 per chunk) | N/A | Action-side cap | Keep top 50 by confidence. Log WARN. |
| Model invents keywords not in the doc text | N/A | Not detected at validation time | Acceptable. Keywords are mapper hints, not ground truth. False keywords cause failed mappings (benign). |
| Empty response on content-rich chunk | N/A | Zero claims from a chunk with >200 words of factual content | Informational log. No retry (may be genuinely opinion-only). |

### 2.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~300 tokens |
| User prompt (template + project context) | ~100 tokens |
| Chunk content (average) | ~400-800 tokens |
| **Total input** | **~800-1,200 tokens** |
| **Output (typical: 3-8 claims)** | **~200-600 tokens** |
| **Max output** | 2,000 tokens |
| **Cost per invocation** | ~$0.003-0.006 (Claude Sonnet) |

### 2.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` (unparseable JSON): Retry once with JSON-only suffix appended to user message.
2. On `DOCALIGN_E202` (Zod validation failure): Retry once with JSON-only suffix.
3. On second failure of either type: Mark `agent_tasks.status = 'failed'`, `agent_tasks.error = '<error_code>: <context>'`. This chunk produces zero claims. Other chunks in the same file proceed independently.
4. Alert threshold: If >50% of chunks for a single doc file fail, log at ERROR with `DOCALIGN_E201_THRESHOLD`.
5. The scan continues regardless. Missing semantic claims from failed chunks are not blocking -- syntactic claims from the same file were already extracted server-side.

---

## 3. P-TRIAGE: Quick LLM Triage

### 3.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-TRIAGE` |
| **Purpose** | Cheap, fast classification for borderline cases where Tiers 1-2 (deterministic) cannot decide but the answer is likely obvious to an LLM with minimal context. Short-circuits ACCURATE verdicts to avoid the cost of full P-VERIFY. |
| **Used in** | Layer 3 (Verification Engine), invoked by the Action before P-VERIFY for claims that pass deterministic checks without a result |
| **MVP Status** | **Active** |
| **Model** | Claude Haiku (`claude-haiku-3-5-20241022`) |
| **Temperature** | 0 |
| **Max tokens** | 150 |
| **Top-p** | 1.0 |

### 3.2 System Prompt

```
You are a documentation accuracy triage classifier. Given a documentation claim and a brief code snippet, quickly determine whether the claim clearly matches the code, clearly contradicts it, or requires deeper analysis.

Rules:
1. Only reference code that has been provided to you. Do not assume or invent code content.
2. Be conservative: if there is any ambiguity, classify as UNCERTAIN.
3. ACCURATE means the claim is obviously correct based on the evidence shown.
4. DRIFTED means the claim obviously contradicts the evidence shown.
5. UNCERTAIN means you cannot determine from this evidence alone -- deeper analysis needed.
6. Do NOT attempt nuanced reasoning. This is a fast classification. If it requires thought, return UNCERTAIN.

Respond with ONLY a JSON object. No other text.
```

### 3.3 User Prompt Template

```
Classify this documentation claim:

<claim file="{{source_file}}" line="{{line_number}}" type="{{claim_type}}">
{{claim_text}}
</claim>

<code file="{{code_file}}" lines="{{start_line}}-{{end_line}}">
{{code_snippet}}
</code>

Respond as JSON:
{
  "classification": "ACCURATE" | "DRIFTED" | "UNCERTAIN",
  "explanation": "one sentence explanation"
}
```

The `{{code_snippet}}` is the same `FormattedEvidence.formatted_evidence` used for Path 1, but may be truncated to the first 500 tokens for cost efficiency. If the claim was routed to Path 2 (no compact evidence available), triage is SKIPPED entirely and the claim goes directly to P-VERIFY Path 2.

### 3.4 Output JSON Schema

```json
{
  "name": "p_triage_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "classification": { "type": "string", "enum": ["ACCURATE", "DRIFTED", "UNCERTAIN"] },
      "explanation": { "type": "string", "maxLength": 500 }
    },
    "required": ["classification", "explanation"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PTriageOutputSchema = z.object({
  classification: z.enum(['ACCURATE', 'DRIFTED', 'UNCERTAIN']),
  explanation: z.string().min(1).max(500),
});
```

**Mapping to internal types:**
- `ACCURATE` -> `verdict: 'verified'`, `confidence: 0.8`, `tier: 4` (triage-derived). Claim is resolved -- no P-VERIFY call needed.
- `DRIFTED` -> Claim proceeds to full P-VERIFY for severity, mismatch detail, and suggested fix. Triage DRIFTED does NOT short-circuit.
- `UNCERTAIN` -> Claim proceeds to full P-VERIFY.

### 3.5 Examples

**Example 1: Obviously accurate**

Input:
```
source_file: "README.md"
line_number: 30
claim_type: "behavior"
claim_text: "The UserService validates email format before creating a user."
code_file: "src/services/user-service.ts"
start_line: 15
end_line: 28
code_snippet: |
  // Entity: createUser (lines 15-28)
  async createUser(dto: CreateUserDto): Promise<User> {
    if (!isValidEmail(dto.email)) {
      throw new ValidationError('Invalid email format');
    }
    return this.repo.create(dto);
  }
```

Output:
```json
{
  "classification": "ACCURATE",
  "explanation": "The createUser function explicitly validates email format using isValidEmail() before creating the user."
}
```

Result: Claim is marked `verified` with confidence 0.8. No P-VERIFY call needed.

**Example 2: Obviously drifted**

Input:
```
source_file: "docs/auth.md"
line_number: 45
claim_type: "behavior"
claim_text: "Authentication uses bcrypt with 12 salt rounds for password hashing."
code_file: "src/auth/password.ts"
start_line: 3
end_line: 8
code_snippet: |
  // Imports
  import { hash, verify } from '@node-rs/argon2';

  // Entity: hashPassword (lines 5-8)
  export async function hashPassword(password: string): Promise<string> {
    return hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }
```

Output:
```json
{
  "classification": "DRIFTED",
  "explanation": "Code imports and uses argon2 for password hashing, not bcrypt as documented."
}
```

Result: Claim proceeds to full P-VERIFY Path 1 for severity assessment, specific mismatch detail, and suggested fix text.

**Example 3: Uncertain -- insufficient evidence**

Input:
```
source_file: "ARCHITECTURE.md"
line_number: 88
claim_type: "architecture"
claim_text: "All API responses are cached in Redis for 5 minutes."
code_file: "src/api/handler.ts"
start_line: 1
end_line: 15
code_snippet: |
  // Imports
  import { Router } from 'express';
  import { UserService } from '../services/user-service';

  // Entity: getUsers (lines 5-10)
  const router = Router();
  router.get('/users', async (req, res) => {
    const users = await userService.findAll();
    res.json(users);
  });
```

Output:
```json
{
  "classification": "UNCERTAIN",
  "explanation": "The code shows a basic route handler but no caching logic. Redis caching may be in middleware or the service layer."
}
```

Result: Claim proceeds to P-VERIFY for deeper analysis.

**Example 4: Failure mode -- model returns plain letter**

LLM output (invalid): `B - the claim is drifted`

Handling: `JSON.parse()` fails. `DOCALIGN_E201`. Retry once. On second failure: skip triage, claim proceeds directly to P-VERIFY (safe fallback -- triage is an optimization, not a requirement).

### 3.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Detection | Fallback Behavior |
|--------------|-----------|-----------|-------------------|
| Unparseable JSON (plain text, letter-only) | DOCALIGN_E201 | `JSON.parse()` throws | Retry once. On 2nd failure: skip triage, proceed to P-VERIFY. |
| Wrong schema (e.g., `classification: "MAYBE"`) | DOCALIGN_E202 | Zod `.safeParse()` fails | Retry once. On 2nd failure: skip triage, proceed to P-VERIFY. |
| Model is too conservative (always returns UNCERTAIN) | N/A | Monitor: if ACCURATE rate < 20% across a scan | Consider disabling triage (config flag) and routing all to P-VERIFY. Log metric. |
| Model is too aggressive (returns ACCURATE for ambiguous cases) | N/A | Not detectable at runtime | Mitigated by: triage-derived verified claims get lower confidence (0.8 vs 0.95+), and full scans re-verify all claims. |
| Model says DRIFTED but cannot explain why | N/A | `explanation` is vague | Acceptable -- DRIFTED triage always proceeds to P-VERIFY for detail. |

### 3.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~150 tokens |
| User prompt (template + claim) | ~80 tokens |
| Code snippet | ~100-400 tokens (truncated to 500 tokens max) |
| **Total input** | **~330-630 tokens** |
| **Output** | **~20-50 tokens** |
| **Max output** | 150 tokens |
| **Cost per invocation** | ~$0.0002-0.0004 (Claude Haiku) |

### 3.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once with JSON-only suffix.
2. On second failure: Skip triage entirely. Claim proceeds to P-VERIFY (Path 1 or Path 2 per routing).
3. Triage failure is MEDIUM severity -- the claim still gets verified, just without the cost optimization.
4. Triage is only invoked for Path 1 claims (compact evidence available). Path 2 claims skip triage entirely.

---

## 4. P-VERIFY: Deep Semantic Verification

P-VERIFY has **two variants** corresponding to the two verification paths from `tdd-3-verifier.md`:

- **Path 1:** Evidence is pre-assembled server-side (entity code + imports + type signatures via `buildPath1Evidence()`). The LLM receives a compact, focused context.
- **Path 2:** The LLM acts as an exploration agent. It receives file hints (from the mapper) and constraints, then reads files to assemble its own evidence.

Both paths produce the same output schema.

---

### 4A. P-VERIFY Path 1 (Evidence Provided)

#### 4A.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-VERIFY` (Path 1 variant) |
| **Purpose** | Deep semantic verification of a documentation claim against pre-assembled code evidence |
| **Used in** | Layer 3 (Verification Engine), `verification` agent task (where `verification_path: 1`) |
| **MVP Status** | **Active** |
| **Model** | Claude Sonnet (`claude-sonnet-4-5-20250929`) |
| **Temperature** | 0 |
| **Max tokens** | 1000 |
| **Top-p** | 1.0 |

#### 4A.2 System Prompt

```
You are a documentation accuracy verifier for a software project. Your job is to compare a documentation claim against actual source code evidence and determine whether the claim is still accurate.

Rules:
1. Focus on FACTUAL accuracy only, not style, completeness, or code quality.
2. The documentation does not need to describe everything -- it just needs to be correct about what it DOES describe.
3. Minor simplifications in documentation language are acceptable (e.g., "handles authentication" for a function named processAuthRequest is fine).
4. If the claim is partially accurate (some parts true, some false), classify as DRIFTED and specify which parts are wrong.
5. If you cannot determine accuracy from the provided evidence, classify as UNCERTAIN. Do NOT guess.
6. ONLY reference code that has been provided to you below. Do NOT hallucinate file paths, function names, or code that was not shown.
7. When the verdict is DRIFTED:
   - severity HIGH = completely wrong or misleading (could cause errors if a developer follows the docs)
   - severity MEDIUM = outdated detail but general idea is correct
   - severity LOW = minor inaccuracy unlikely to cause issues
   - Provide a specific_mismatch: exactly what is wrong
   - Provide a suggested_fix: corrected documentation text

Respond with ONLY a JSON object matching the required schema. No other text.
```

#### 4A.3 User Prompt Template

```
Verify this documentation claim against the source code evidence.

<claim file="{{source_file}}" line="{{source_line}}" type="{{claim_type}}">
{{claim_text}}
</claim>

<evidence>
{{formatted_evidence}}
</evidence>

Respond as JSON:
{
  "verdict": "verified" | "drifted" | "uncertain",
  "confidence": <0.0 to 1.0>,
  "severity": "high" | "medium" | "low" | null,
  "reasoning": "1-2 sentence explanation of your verdict",
  "specific_mismatch": "what exactly is wrong (null if verified or uncertain)",
  "suggested_fix": "corrected documentation text (null if verified or uncertain)",
  "evidence_files": ["files examined"]
}
```

`{{formatted_evidence}}` is filled by `FormattedEvidence.formatted_evidence` from `buildPath1Evidence()` (tdd-3-verifier.md Section 4.3). Format:

```
--- File: src/services/order-service.ts ---

// Imports
import { OrderRepository } from '../repositories/order-repository';
import { EventPublisher } from '../queue/publisher';

// Entity: createOrder (lines 24-42)
async createOrder(dto: CreateOrderDto): Promise<Order> {
  // ... entity code ...
}

// Type signatures referenced:
interface CreateOrderDto { ... }
```

#### 4A.4 Output JSON Schema

```json
{
  "name": "p_verify_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "verdict": { "type": "string", "enum": ["verified", "drifted", "uncertain"] },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "severity": { "type": ["string", "null"], "enum": ["high", "medium", "low", null] },
      "reasoning": { "type": "string" },
      "specific_mismatch": { "type": ["string", "null"] },
      "suggested_fix": { "type": ["string", "null"] },
      "evidence_files": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["verdict", "confidence", "severity", "reasoning", "specific_mismatch", "suggested_fix", "evidence_files"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PVerifyOutputSchema = z.object({
  verdict: z.enum(['verified', 'drifted', 'uncertain']),
  confidence: z.number().min(0).max(1),
  severity: z.enum(['high', 'medium', 'low']).nullable(),
  reasoning: z.string().min(1).max(1000),
  specific_mismatch: z.string().nullable(),
  suggested_fix: z.string().nullable(),
  evidence_files: z.array(z.string()),
});
```

Maps to `VerificationResultData` from `phase4-api-contracts.md` Section 10.3.

#### 4A.5 Examples

**Example 1: Verified**

Input:
```
source_file: "docs/order.md", source_line: 23, claim_type: "behavior"
claim_text: "The createOrder function validates input and publishes order.created event."
formatted_evidence: |
  --- File: src/services/order-service.ts ---

  // Imports
  import { OrderRepository } from '../repositories/order-repository';
  import { EventPublisher } from '../queue/publisher';
  import { Order, CreateOrderDto } from '../types/order';
  import { ValidationError } from '../errors';

  // Entity: createOrder (lines 24-42)
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    if (!dto.items || dto.items.length === 0) {
      throw new ValidationError('Order must have at least one item');
    }
    const order = await this.repo.create({ ...dto, status: 'pending' });
    await this.publisher.publish('order.created', { orderId: order.id });
    return order;
  }
```

Output:
```json
{
  "verdict": "verified",
  "confidence": 0.95,
  "severity": null,
  "reasoning": "The createOrder function validates input (checks for empty items array, throws ValidationError) and publishes an 'order.created' event via this.publisher.publish().",
  "specific_mismatch": null,
  "suggested_fix": null,
  "evidence_files": ["src/services/order-service.ts"]
}
```

**Example 2: Drifted (HIGH severity)**

Input:
```
source_file: "README.md", source_line: 45, claim_type: "behavior"
claim_text: "Authentication uses bcrypt with 12 salt rounds for password hashing."
formatted_evidence: |
  --- File: src/auth/password.ts ---

  // Imports
  import { hash, verify } from '@node-rs/argon2';

  // Entity: hashPassword (lines 5-8)
  export async function hashPassword(password: string): Promise<string> {
    return hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }
```

Output:
```json
{
  "verdict": "drifted",
  "confidence": 0.98,
  "severity": "high",
  "reasoning": "The code uses argon2 (via @node-rs/argon2) for password hashing, not bcrypt as claimed. The parameters specify memoryCost, timeCost, and parallelism, which are argon2-specific.",
  "specific_mismatch": "Documentation says 'bcrypt with 12 salt rounds' but code uses argon2id with memoryCost: 65536, timeCost: 3, parallelism: 1.",
  "suggested_fix": "Authentication uses argon2id with 64MB memory cost for password hashing.",
  "evidence_files": ["src/auth/password.ts"]
}
```

**Example 3: Uncertain**

Input:
```
source_file: "docs/api.md", source_line: 67, claim_type: "behavior"
claim_text: "All API responses include pagination metadata with total, page, and pageSize fields."
formatted_evidence: |
  --- File: src/controllers/user-controller.ts ---

  // Imports
  import { Controller, Get, Query } from '@nestjs/common';
  import { UserService } from '../services/user-service';

  // Entity: findAll (lines 12-18)
  @Get()
  async findAll(@Query('page') page: number, @Query('size') size: number) {
    return this.userService.findAll({ page, size });
  }
```

Output:
```json
{
  "verdict": "uncertain",
  "confidence": 0.4,
  "severity": null,
  "reasoning": "The controller accepts pagination parameters but the response format is not visible. Pagination metadata fields may be added in the service layer or by a response interceptor.",
  "specific_mismatch": null,
  "suggested_fix": null,
  "evidence_files": ["src/controllers/user-controller.ts"]
}
```

**Example 4: Drifted (MEDIUM severity -- partial accuracy)**

Input:
```
source_file: "docs/config.md", source_line: 15, claim_type: "config"
claim_text: "The default database connection pool size is 10."
formatted_evidence: |
  --- File: src/config/database.ts ---

  // Entity: createPool (lines 5-12)
  export function createPool() {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }
```

Output:
```json
{
  "verdict": "drifted",
  "confidence": 0.95,
  "severity": "medium",
  "reasoning": "The default pool size is configured as max: 20, not 10 as documented. The general concept (configurable pool) is correct, but the specific value is wrong.",
  "specific_mismatch": "Documentation says pool size is 10, code sets max: 20.",
  "suggested_fix": "The default database connection pool size is 20.",
  "evidence_files": ["src/config/database.ts"]
}
```

---

### 4B. P-VERIFY Path 2 (Agent Explores)

#### 4B.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-VERIFY` (Path 2 variant) |
| **Purpose** | Agent-delegated verification for claims where compact evidence cannot be pre-assembled (multi-file, no entity mapping, evidence too large, file-only mapping) |
| **Used in** | Layer 3 (Verification Engine), `verification` agent task (where `verification_path: 2`) |
| **MVP Status** | **Active** |
| **Model** | Claude Sonnet (`claude-sonnet-4-5-20250929`) |
| **Temperature** | 0 |
| **Max tokens** | 1500 |
| **Top-p** | 1.0 |

#### 4B.2 System Prompt (Agent Instruction)

```
You are a documentation accuracy verifier operating as a code exploration agent. You have access to read files in a repository. Your job is to determine whether a documentation claim is accurate by exploring relevant code.

Rules:
1. Start with the provided file hints as starting points, but you are NOT limited to them. Follow imports, search for related files, and examine tests if useful.
2. Focus on FACTUAL accuracy only, not style, completeness, or code quality.
3. The documentation does not need to describe everything -- it just needs to be correct about what it DOES describe.
4. Minor simplifications in documentation language are acceptable.
5. If the claim is partially accurate (some parts true, some false), classify as DRIFTED.
6. If you cannot find enough evidence to make a determination, classify as UNCERTAIN.
7. ONLY reference files and code you have actually read. Do NOT hallucinate file contents.
8. List ALL files you actually examined in evidence_files.
9. Severity: HIGH = completely wrong or misleading. MEDIUM = outdated detail, general idea correct. LOW = minor inaccuracy.
10. Stay within the file and token constraints provided.

Respond with ONLY a JSON object matching the required schema. No other text.
```

#### 4B.3 User Prompt Template

```
Verify this documentation claim by exploring the codebase.

<claim file="{{source_file}}" line="{{source_line}}" type="{{claim_type}}">
{{claim_text}}
</claim>

<routing_context>
Routing reason: {{routing_reason}}
</routing_context>

<file_hints>
{{#each mapped_files}}
- {{this.path}} (confidence: {{this.confidence}}{{#if this.entity_name}}, entity: {{this.entity_name}}{{/if}})
{{/each}}
</file_hints>

<constraints>
Maximum files to examine: {{max_files}}
Maximum evidence tokens: {{max_tokens}}
Repository root: {{repo_root}}
</constraints>

Explore the code and respond as JSON:
{
  "verdict": "verified" | "drifted" | "uncertain",
  "confidence": <0.0 to 1.0>,
  "severity": "high" | "medium" | "low" | null,
  "reasoning": "1-3 sentences with specific code references",
  "specific_mismatch": "what exactly is wrong (null if verified or uncertain)",
  "suggested_fix": "corrected documentation text (null if verified or uncertain)",
  "evidence_files": ["all files you actually examined"]
}
```

Placeholder values (from tdd-3-verifier.md, spike-b-evidence-assembly.md):
- `{{max_files}}`: Default 10 (configurable via `.docalign.yml` `verification.path2_max_files`).
- `{{max_tokens}}`: Default 8000 (configurable via `.docalign.yml` `verification.path2_max_tokens`).
- `{{routing_reason}}`: One of the `RoutingReason` values from api-contracts Section 5.1: `evidence_too_large | multi_file | no_mapping | file_only_mapping`.
- `{{mapped_files}}`: Array of `MappedFileHint` objects from `VerificationPayload`.

#### 4B.4 Output JSON Schema

Same schema as Path 1 (Section 4A.4). Both paths produce identical `VerificationResultData`.

#### 4B.5 Examples

**Example 1: Multi-file architecture claim (verified)**

Input:
```
source_file: "ARCHITECTURE.md", source_line: 15, claim_type: "architecture"
claim_text: "Data flows from the API handler through a job queue to background workers."
routing_reason: "multi_file"
mapped_files:
  - { path: "src/api/handler.ts", confidence: 0.8, entity_name: null }
  - { path: "src/queue/worker.ts", confidence: 0.75, entity_name: null }
max_files: 10, max_tokens: 8000
```

Output:
```json
{
  "verdict": "verified",
  "confidence": 0.9,
  "severity": null,
  "reasoning": "The API handler in src/api/handler.ts enqueues jobs via BullMQ (queue.add('process-order', data)). The worker in src/queue/worker.ts creates a BullMQ Worker that processes these jobs. The data flow matches the documented pattern.",
  "specific_mismatch": null,
  "suggested_fix": null,
  "evidence_files": ["src/api/handler.ts", "src/queue/worker.ts", "src/queue/config.ts"]
}
```

**Example 2: No mapping -- agent explores (drifted)**

Input:
```
source_file: "README.md", source_line: 88, claim_type: "convention"
claim_text: "All database queries use parameterized statements to prevent SQL injection."
routing_reason: "no_mapping"
mapped_files: []
max_files: 10, max_tokens: 8000
```

Output:
```json
{
  "verdict": "drifted",
  "confidence": 0.85,
  "severity": "high",
  "reasoning": "Most queries use Knex query builder (parameterized). However, src/reports/custom-report.ts line 45 contains raw SQL with string interpolation: `db.raw(`SELECT * FROM reports WHERE name = '${name}'`)`, which is vulnerable to SQL injection.",
  "specific_mismatch": "src/reports/custom-report.ts uses string interpolation in a raw SQL query instead of parameterized statements.",
  "suggested_fix": "Most database queries use parameterized statements. See src/reports/custom-report.ts for a known exception that should be migrated.",
  "evidence_files": ["src/repositories/user-repo.ts", "src/repositories/order-repo.ts", "src/reports/custom-report.ts", "knexfile.ts"]
}
```

**Example 3: Evidence too large -- agent reads selectively (drifted, MEDIUM)**

Input:
```
source_file: "docs/services.md", source_line: 34, claim_type: "behavior"
claim_text: "The PaymentService retries failed Stripe charges up to 3 times with exponential backoff."
routing_reason: "evidence_too_large"
mapped_files:
  - { path: "src/services/payment-service.ts", confidence: 0.95, entity_name: "processPayment" }
max_files: 10, max_tokens: 8000
```

Output:
```json
{
  "verdict": "drifted",
  "confidence": 0.92,
  "severity": "medium",
  "reasoning": "The PaymentService does retry failed charges, but uses a fixed 2-second delay between retries (not exponential backoff) and retries up to 5 times (not 3 as documented).",
  "specific_mismatch": "Documentation says '3 times with exponential backoff' but code retries 5 times with 2-second fixed delay.",
  "suggested_fix": "The PaymentService retries failed Stripe charges up to 5 times with a 2-second delay between attempts.",
  "evidence_files": ["src/services/payment-service.ts", "src/config/retry.ts"]
}
```

### 4C. Known Failure Modes (Both Paths)

| Failure Mode | Error Code | Detection | Fallback Behavior |
|--------------|-----------|-----------|-------------------|
| Unparseable JSON | DOCALIGN_E201 | `JSON.parse()` throws | Retry once. On 2nd failure: claim marked `uncertain`, reasoning = `'llm_parse_error'`. |
| Wrong schema (e.g., `verdict: "maybe"`) | DOCALIGN_E202 | Zod `.safeParse()` fails | Retry once. On 2nd failure: claim marked `uncertain`. |
| Model hallucinates file paths not in the repo | N/A | Action validates `evidence_files` against file tree | Log warning for unknown paths. Accept verdict (files are informational, not blocking). |
| Path 2 agent exceeds file/token limits | N/A | Action monitors agent context | Accept verdict. Log warning if `evidence_files.length > max_files`. |
| Model returns `verified` with confidence < 0.5 | N/A | Action checks | Accept as-is. Low-confidence verified claims may be re-verified on next full scan. |
| Path 1 evidence assembly fails (entity deleted) | DOCALIGN_E401 | `buildPath1Evidence` throws | L4 falls back to creating a Path 2 task instead. |
| Path 2 agent timeout (30 min) | DOCALIGN_E203 | Task expiration | Claim marked `uncertain`. |

### 4D. Token Budget & Cost

**Path 1:**

| Component | Estimate |
|-----------|----------|
| System prompt | ~280 tokens |
| User prompt (template + claim) | ~100 tokens |
| Evidence (entity + imports + types) | ~200-800 tokens |
| **Total input** | **~580-1,180 tokens** |
| **Output** | **~100-300 tokens** |
| **Cost per invocation** | ~$0.002-0.005 (Claude Sonnet) |

**Path 2:**

| Component | Estimate |
|-----------|----------|
| System prompt | ~300 tokens |
| User prompt (template + hints + constraints) | ~200 tokens |
| Agent-read code context (tool-use) | ~2,000-6,000 tokens |
| **Total input** | **~2,500-6,500 tokens** |
| **Output** | **~200-400 tokens** |
| **Cost per invocation** | ~$0.01-0.03 (Claude Sonnet) |

### 4E. Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once with JSON-only suffix.
2. On second failure: Task `failed`. Claim `verdict = 'uncertain'`, `reasoning = 'llm_parse_error'`.
3. If Path 1 evidence assembly fails (`DOCALIGN_E401`): L4 Worker falls back to Path 2 task creation.
4. If Path 2 agent times out (30 min, Scenario 11): Task expired. Claim `uncertain`.
5. If >10% of verification tasks in a scan fail with E201/E202: log `DOCALIGN_E201_THRESHOLD` at ERROR.

---

## 5. P-FIX: Fix Generation

### 5.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-FIX` |
| **Purpose** | Generate corrected documentation text for claims verified as drifted |
| **Used in** | Layer 5 (Report & Fix Generation), `fix_generation` agent task type |
| **MVP Status** | **Active** |
| **Model** | Claude Sonnet (`claude-sonnet-4-5-20250929`) |
| **Temperature** | 0.3 (slight creativity for natural-sounding text) |
| **Max tokens** | 500 |
| **Top-p** | 1.0 |

### 5.2 System Prompt

```
You are a documentation editor for a software project. Given a documentation claim that has been identified as inaccurate (drifted from code reality), generate the corrected text.

Rules:
1. Preserve the original documentation's tone, style, and level of detail. Do not over-explain.
2. The fix should be a drop-in replacement for the original text -- same scope, same audience.
3. ONLY use information from the provided mismatch description and evidence. Do NOT hallucinate code details.
4. If the mismatch is about a specific value (version, function name, library), replace only that value.
5. If the claim is fundamentally wrong, write a brief replacement that accurately describes current behavior.
6. Keep the fix concise. Do not expand a one-sentence claim into a paragraph.
7. The output text should be ready to insert into the documentation file as-is.

Respond with ONLY a JSON object. No other text.
```

### 5.3 User Prompt Template

```
Generate corrected documentation for this drifted claim.

<finding>
  <claim file="{{source_file}}" line="{{source_line}}">{{claim_text}}</claim>
  <mismatch>{{mismatch_description}}</mismatch>
  <evidence_files>{{evidence_files}}</evidence_files>
</finding>

Respond as JSON:
{
  "suggested_fix": {
    "file_path": "{{source_file}}",
    "line_start": {{source_line}},
    "line_end": {{source_line}},
    "new_text": "the corrected documentation text",
    "explanation": "brief explanation of what changed"
  }
}
```

### 5.4 Output JSON Schema

```json
{
  "name": "p_fix_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "suggested_fix": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" },
          "line_start": { "type": "integer" },
          "line_end": { "type": "integer" },
          "new_text": { "type": "string" },
          "explanation": { "type": "string" }
        },
        "required": ["file_path", "line_start", "line_end", "new_text", "explanation"],
        "additionalProperties": false
      }
    },
    "required": ["suggested_fix"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PFixOutputSchema = z.object({
  suggested_fix: z.object({
    file_path: z.string().min(1),
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive(),
    new_text: z.string().min(1),
    explanation: z.string().min(1).max(500),
  }),
});
```

Maps to `FixGenerationResult` from `phase4-api-contracts.md` Section 10.3. The server constructs the full `DocFix` object (api-contracts Section 7.1) by combining LLM output with the finding context:

```typescript
const docFix: DocFix = {
  file: result.suggested_fix.file_path,
  line_start: result.suggested_fix.line_start,
  line_end: result.suggested_fix.line_end,
  old_text: payload.finding.claim_text,
  new_text: result.suggested_fix.new_text,
  reason: result.suggested_fix.explanation,
  claim_id: claimId,
  confidence: verificationResult.confidence,  // from the verification step
};
```

### 5.5 Examples

**Example 1: Simple value replacement**

Input:
```
source_file: "README.md", source_line: 45
claim_text: "Authentication uses bcrypt with 12 salt rounds for password hashing."
mismatch_description: "Documentation says 'bcrypt with 12 salt rounds' but code uses argon2id with memoryCost: 65536."
evidence_files: ["src/auth/password.ts"]
```

Output:
```json
{
  "suggested_fix": {
    "file_path": "README.md",
    "line_start": 45,
    "line_end": 45,
    "new_text": "Authentication uses argon2id with 64MB memory cost for password hashing.",
    "explanation": "Replaced bcrypt reference with argon2id, the actual hashing algorithm in use."
  }
}
```

**Example 2: Version update**

Input:
```
source_file: "docs/setup.md", source_line: 12
claim_text: "Requires Node.js 16 or higher."
mismatch_description: "Documentation says 'Node.js 16' but .nvmrc specifies 20 and package.json engines requires >=20."
evidence_files: [".nvmrc", "package.json"]
```

Output:
```json
{
  "suggested_fix": {
    "file_path": "docs/setup.md",
    "line_start": 12,
    "line_end": 12,
    "new_text": "Requires Node.js 20 or higher.",
    "explanation": "Updated minimum Node.js version from 16 to 20 per .nvmrc and package.json engines."
  }
}
```

**Example 3: Feature no longer exists**

Input:
```
source_file: "docs/api.md", source_line: 88
claim_text: "The /api/v1/export endpoint generates CSV reports on demand."
mismatch_description: "Route /api/v1/export does not exist. Found /api/v2/reports returning JSON."
evidence_files: ["src/routes/reports.ts"]
```

Output:
```json
{
  "suggested_fix": {
    "file_path": "docs/api.md",
    "line_start": 88,
    "line_end": 88,
    "new_text": "The /api/v2/reports endpoint returns report data in JSON format.",
    "explanation": "The v1 export endpoint was replaced by /api/v2/reports with JSON output instead of CSV."
  }
}
```

**Example 4: Edge case -- ambiguous mismatch, low confidence fix**

Input:
```
source_file: "ARCHITECTURE.md", source_line: 22
claim_text: "The system processes events asynchronously using RabbitMQ."
mismatch_description: "No RabbitMQ dependency found. BullMQ (Redis-based) found instead. Unclear if this is a full replacement."
evidence_files: ["package.json", "src/queue/config.ts"]
```

Output:
```json
{
  "suggested_fix": {
    "file_path": "ARCHITECTURE.md",
    "line_start": 22,
    "line_end": 22,
    "new_text": "The system processes events asynchronously using BullMQ (Redis-based job queue).",
    "explanation": "Replaced RabbitMQ with BullMQ based on package.json dependencies. Note: confidence is lower because RabbitMQ may be used in a different deployment context."
  }
}
```

### 5.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Detection | Fallback Behavior |
|--------------|-----------|-----------|-------------------|
| Unparseable JSON | DOCALIGN_E201 | `JSON.parse()` throws | Retry once. On 2nd failure: finding posted without fix suggestion. |
| Wrong schema | DOCALIGN_E202 | Zod `.safeParse()` fails | Retry once. On 2nd failure: finding posted without fix. |
| `new_text` is empty | N/A | Zod rejects (`min(1)`) | Treated as DOCALIGN_E202. Retry. |
| `new_text` identical to `claim_text` | N/A | Action-side check | Discard fix, log warning. Finding posted without fix. |
| Fix is excessively long (>5x original) | N/A | Action-side check | Truncate to 5x original length, append "[truncated]". Log warning. |

### 5.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~220 tokens |
| User prompt (template + finding) | ~100 tokens |
| Claim text + mismatch | ~50-150 tokens |
| **Total input** | **~370-470 tokens** |
| **Output** | **~60-150 tokens** |
| **Max output** | 500 tokens |
| **Cost per invocation** | ~$0.001-0.002 (Claude Sonnet) |

### 5.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once with JSON-only suffix.
2. On second failure: Task `failed`. Finding is still reported in the PR comment but without a suggested fix. `Finding.fix` is `null` in the `PRCommentPayload`.
3. P-FIX failure does NOT affect the verdict, severity, or reasoning. The finding is valid regardless.
4. PR review comments are still posted with the mismatch description even without a fix suggestion.

---

## 6. P-MAP-LLM: LLM-Assisted Mapping

> **MVP Status: v2-deferred**
>
> **Activation trigger:** Implemented when Step 4 of the L2 mapper pipeline is built (see `tdd-2-mapper.md`). Currently, claims that fail Steps 1-3 are marked `mapping_method: 'manual'` and skip verification. This prompt is invoked as part of the `claim_classification` agent task.

### 6.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-MAP-LLM` |
| **Purpose** | Map architecture/universal claims to relevant code files using LLM reasoning over a filtered file tree |
| **Used in** | Layer 2 (Mapper), embedded within the `claim_classification` agent task flow |
| **MVP Status** | **v2-deferred** |
| **Model** | Claude Sonnet |
| **Temperature** | 0 |
| **Max tokens** | 800 |
| **Top-p** | 1.0 |

### 6.2 System Prompt

```
You are a code architecture analyst. Given a documentation claim about a software project and a filtered file tree, identify which source files are most relevant to verifying or disproving the claim.

Rules:
1. Return up to 5 file paths, ranked by relevance.
2. ONLY return file paths from the provided file tree. Do NOT invent paths.
3. For architecture claims, prefer files that implement the described pattern (not test files or configs).
4. For convention claims, select representative files that would demonstrate whether the convention holds.
5. Include a confidence score (0.0-1.0) and brief reason for each file.
6. If no files in the tree are relevant, return an empty array.

Respond with ONLY a JSON object. No other text.
```

### 6.3 User Prompt Template

```
Map this documentation claim to relevant code files.

<claim type="{{claim_type}}">
{{claim_text}}
</claim>

<project_context>
Language: {{project_context.language}}
Frameworks: {{project_context.frameworks | join(", ")}}
</project_context>

<file_tree>
{{filtered_file_tree}}
</file_tree>

Respond as JSON:
{
  "mapped_files": [
    { "path": "src/...", "confidence": 0.9, "reason": "brief reason" }
  ],
  "reasoning": "why these files are relevant to the claim"
}
```

The `{{filtered_file_tree}}` is pre-filtered by the server using claim keywords to reduce the full file tree to relevant directories (max 200 entries).

### 6.4 Output JSON Schema

```json
{
  "name": "p_map_llm_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "mapped_files": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "reason": { "type": "string" }
          },
          "required": ["path", "confidence", "reason"],
          "additionalProperties": false
        },
        "maxItems": 5
      },
      "reasoning": { "type": "string" }
    },
    "required": ["mapped_files", "reasoning"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PMapLlmOutputSchema = z.object({
  mapped_files: z.array(z.object({
    path: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(200),
  })).max(5),
  reasoning: z.string().min(1).max(500),
});
```

The `mapped_files` are used to create `ClaimMapping` records with `mapping_method: 'llm_assisted'` (api-contracts Section 4.1).

### 6.5 Examples

**Example 1: Flow claim mapping**

Input:
```
claim_type: "architecture"
claim_text: "Data flows from the API handler through a BullMQ job queue to background workers."
project_context: { language: "TypeScript", frameworks: ["Express", "BullMQ"] }
filtered_file_tree: |
  src/api/handler.ts
  src/api/routes.ts
  src/queue/config.ts
  src/queue/producer.ts
  src/queue/worker.ts
  src/queue/processors/email-processor.ts
```

Output:
```json
{
  "mapped_files": [
    { "path": "src/api/handler.ts", "confidence": 0.85, "reason": "API handler that initiates the data flow" },
    { "path": "src/queue/producer.ts", "confidence": 0.9, "reason": "Queue producer that enqueues jobs from the API" },
    { "path": "src/queue/worker.ts", "confidence": 0.9, "reason": "Background worker that processes queued jobs" }
  ],
  "reasoning": "This is a flow claim: API -> queue -> worker. The key files are the handler (entry point), producer (bridge), and worker (execution)."
}
```

**Example 2: Convention claim -- representative sampling**

Input:
```
claim_type: "convention"
claim_text: "All API endpoints validate input using Zod schemas."
project_context: { language: "TypeScript", frameworks: ["Express"] }
filtered_file_tree: |
  src/api/routes/users.ts
  src/api/routes/orders.ts
  src/api/routes/products.ts
  src/api/middleware/validate.ts
  src/api/schemas/user.ts
  src/api/schemas/order.ts
```

Output:
```json
{
  "mapped_files": [
    { "path": "src/api/middleware/validate.ts", "confidence": 0.95, "reason": "Validation middleware likely applies Zod schemas" },
    { "path": "src/api/routes/users.ts", "confidence": 0.8, "reason": "Sample route to check Zod validation usage" },
    { "path": "src/api/routes/orders.ts", "confidence": 0.75, "reason": "Second sample route to verify pattern consistency" }
  ],
  "reasoning": "Universal claim: sampling the middleware and two routes to verify the validation pattern is applied."
}
```

**Example 3: No relevant files found**

Input:
```
claim_type: "architecture"
claim_text: "The mobile app communicates with the backend via GraphQL."
project_context: { language: "Python", frameworks: ["Django"] }
filtered_file_tree: |
  src/views/users.py
  src/views/orders.py
  src/models/user.py
  src/serializers/user.py
```

Output:
```json
{
  "mapped_files": [],
  "reasoning": "The filtered file tree shows a Django REST-style structure with views and serializers but no GraphQL-related files. The claim may reference a different repository or the mobile app codebase."
}
```

### 6.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Fallback Behavior |
|--------------|-----------|-------------------|
| Unparseable JSON | DOCALIGN_E201 | Retry once. On 2nd failure: claim marked `mapping_method: 'manual'`, skipped. |
| File path not in repo | N/A | Filter out invalid paths. If all invalid, treat as unmapped. |
| Model returns >5 files | N/A | Zod rejects (`maxItems: 5`). Treated as E202. |

### 6.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~180 tokens |
| User prompt + context | ~100 tokens |
| Filtered file tree | ~200-600 tokens |
| **Total input** | **~480-880 tokens** |
| **Output** | **~150-300 tokens** |
| **Cost per invocation** | ~$0.002-0.004 (Claude Sonnet) |

### 6.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once with JSON-only suffix.
2. On second failure: Claim remains unmapped (`mapping_method: 'manual'`). Claim is skipped for verification in this scan. May be retried on next full scan.

---

## 7. P-DECOMPOSE: Vague Claim Decomposition

> **MVP Status: v2-deferred**
>
> **Activation trigger:** Implemented when Spike A Mechanism B (claim decomposition for flow claims) is built into L2. Currently, flow claims that fail mapper Steps 1-3 are marked unmappable. This prompt is part of the `claim_classification` agent task, invoked after P-MAP-LLM determines the claim is a "flow" type.

### 7.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-DECOMPOSE` |
| **Purpose** | Classify a vague semantic claim (universal vs flow vs untestable) and, for flow claims, decompose into 2-5 localizable sub-claims |
| **Used in** | Layer 2 (Mapper) / Layer 1, `claim_classification` agent task type |
| **MVP Status** | **v2-deferred** |
| **Model** | Claude Sonnet |
| **Temperature** | 0 |
| **Max tokens** | 1000 |
| **Top-p** | 1.0 |

### 7.2 System Prompt

```
You are a software documentation analyst for a code verification system. Given a high-level documentation claim that cannot be mapped to specific code files, you must:

1. CLASSIFY the claim into one of three categories:
   - "universal": Asserts a property across ALL matching components (e.g., "All services use gRPC", "Every endpoint validates input"). These require static analysis rules, not decomposition.
   - "flow": Describes a multi-component data or control flow (e.g., "Data flows from API to queue to worker"). These can be decomposed into sub-claims.
   - "untestable": Too vague, abstract, or subjective to verify against code (e.g., "The codebase is well-organized").

2. For "flow" claims ONLY: Decompose into 2-5 specific, localizable sub-claims that together cover the original.

3. For "universal" claims: Generate a static analysis rule specification (scope glob, checks).

4. For "untestable" claims: Explain why verification is not possible.

Rules:
- Each sub-claim must describe a SPECIFIC, OBSERVABLE code property.
- Sub-claims should cover the original: if all verified, the original is verified.
- Do NOT invent file paths or function names. Use generic descriptions.
- Provide search_hints (keywords) for each sub-claim to help the mapper.

Respond with ONLY a JSON object. No other text.
```

### 7.3 User Prompt Template

```
Classify and optionally decompose this documentation claim.

<claim type="{{claim_type}}">
{{claim_text}}
</claim>

<project_context>
Language: {{project_context.language}}
Frameworks: {{project_context.frameworks | join(", ")}}
Dependencies: {{dependencies | keys | join(", ")}}
</project_context>

Respond as JSON:
{
  "classification": "universal" | "flow" | "untestable",
  "reasoning": "why this classification",
  "static_rule": { ... } | null,
  "sub_claims": [ ... ] | null,
  "untestable_reason": "..." | null
}
```

### 7.4 Output JSON Schema

```json
{
  "name": "p_decompose_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "classification": { "type": "string", "enum": ["universal", "flow", "untestable"] },
      "reasoning": { "type": "string" },
      "static_rule": {
        "type": ["object", "null"],
        "properties": {
          "scope": { "type": "string", "description": "Glob pattern for files in scope" },
          "scope_exclude": { "type": "array", "items": { "type": "string" } },
          "checks": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": { "type": "string", "enum": [
                  "require_any_import", "forbid_import", "require_dependency",
                  "forbid_dependency", "require_pattern", "forbid_pattern",
                  "require_file_exists", "require_ast_node", "min_file_count"
                ]},
                "values": {},
                "name": {},
                "regex": {},
                "paths": {},
                "node_type": {},
                "count": {}
              },
              "required": ["type"]
            }
          }
        },
        "required": ["scope", "checks"]
      },
      "sub_claims": {
        "type": ["array", "null"],
        "items": {
          "type": "object",
          "properties": {
            "sub_claim_text": { "type": "string" },
            "expected_evidence_type": { "type": "string", "enum": ["dependency", "symbol", "file", "pattern", "behavior"] },
            "search_hints": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 5 }
          },
          "required": ["sub_claim_text", "expected_evidence_type", "search_hints"]
        },
        "maxItems": 5
      },
      "untestable_reason": { "type": ["string", "null"] }
    },
    "required": ["classification", "reasoning", "static_rule", "sub_claims", "untestable_reason"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PDecomposeOutputSchema = z.object({
  classification: z.enum(['universal', 'flow', 'untestable']),
  reasoning: z.string().min(1).max(500),
  static_rule: z.object({
    scope: z.string(),
    scope_exclude: z.array(z.string()).optional(),
    checks: z.array(z.object({
      type: z.enum([
        'require_any_import', 'forbid_import', 'require_dependency',
        'forbid_dependency', 'require_pattern', 'forbid_pattern',
        'require_file_exists', 'require_ast_node', 'min_file_count',
      ]),
    }).passthrough()),
  }).nullable(),
  sub_claims: z.array(z.object({
    sub_claim_text: z.string().min(1),
    expected_evidence_type: z.enum(['dependency', 'symbol', 'file', 'pattern', 'behavior']),
    search_hints: z.array(z.string()).min(1).max(5),
  })).max(5).nullable(),
  untestable_reason: z.string().nullable(),
});
```

Maps to `ClaimClassificationResult` from `phase4-api-contracts.md` Section 10.3. Classification maps to `VagueClaimClassification` type. Static rules use the `StaticAnalysisRule` schema from `spike-a-vague-claim-mapping.md` Section 5.1.1.

### 7.5 Examples

**Example 1: Universal claim -- generates static rule**

Input:
```
claim_type: "convention"
claim_text: "All services communicate via gRPC."
project_context: { language: "TypeScript", frameworks: ["NestJS"], dependencies: { "@grpc/grpc-js": "1.9" } }
```

Output:
```json
{
  "classification": "universal",
  "reasoning": "The claim uses 'all services' quantifier. This requires checking every service file for gRPC usage, including future ones.",
  "static_rule": {
    "scope": "src/services/**/*.ts",
    "scope_exclude": ["src/services/**/*.spec.ts", "src/services/**/*.test.ts"],
    "checks": [
      { "type": "require_any_import", "values": ["@grpc/grpc-js", "@nestjs/microservices"] }
    ]
  },
  "sub_claims": null,
  "untestable_reason": null
}
```

**Example 2: Flow claim -- decomposes into sub-claims**

Input:
```
claim_type: "architecture"
claim_text: "Data flows from the API layer through a job queue to background workers."
project_context: { language: "TypeScript", frameworks: ["Express", "BullMQ"] }
```

Output:
```json
{
  "classification": "flow",
  "reasoning": "The claim describes a three-stage data flow (API -> queue -> worker) with specific components to verify at each stage.",
  "static_rule": null,
  "sub_claims": [
    {
      "sub_claim_text": "An API endpoint exists that enqueues jobs to a queue.",
      "expected_evidence_type": "behavior",
      "search_hints": ["queue", "add", "enqueue", "bullmq"]
    },
    {
      "sub_claim_text": "A queue consumer/worker exists that processes jobs.",
      "expected_evidence_type": "symbol",
      "search_hints": ["Worker", "processor", "bullmq"]
    },
    {
      "sub_claim_text": "The API code imports or references the queue client.",
      "expected_evidence_type": "pattern",
      "search_hints": ["import", "bullmq", "Queue"]
    }
  ],
  "untestable_reason": null
}
```

**Example 3: Untestable claim**

Input:
```
claim_type: "architecture"
claim_text: "The codebase has good separation of concerns."
project_context: { language: "TypeScript", frameworks: ["Express"] }
```

Output:
```json
{
  "classification": "untestable",
  "reasoning": "The claim 'good separation of concerns' is subjective. Different developers disagree on what constitutes 'good' separation.",
  "static_rule": null,
  "sub_claims": null,
  "untestable_reason": "Subjective quality judgment that cannot be decomposed into mechanically verifiable properties."
}
```

### 7.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Fallback Behavior |
|--------------|-----------|-------------------|
| Unparseable JSON | DOCALIGN_E201 | Retry once. On 2nd failure: claim marked unmappable. |
| Static rule with invalid check type | DOCALIGN_E202 | Zod enum rejects. Retry once. On 2nd failure: unmappable. |
| 0 sub-claims for a "flow" classification | N/A | Treated as untestable. Log warning. |
| Sub-claims too vague to map | N/A | Each goes through mapper Steps 1-3. If <50% map, claim is `partially_mapped` (confidence 0.3). |

### 7.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~350 tokens |
| User prompt + context | ~100 tokens |
| Claim text | ~30-80 tokens |
| **Total input** | **~480-530 tokens** |
| **Output** | **~200-400 tokens** |
| **Cost per invocation** | ~$0.002-0.003 (Claude Sonnet) |

### 7.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once with JSON-only suffix.
2. On second failure: Claim marked unmappable. Classification defaults to `untestable`.
3. Claim will not be verified in this scan. May be retried on next full scan.

---

## 8. P-POSTCHECK: Post-Check Verification Script

> **MVP Status: v2-deferred**
>
> **Activation trigger:** Implemented when Tier 5 (post-check verification) is built in L3. Currently Tier 5 is stubbed; all `PostCheckOutcome` values are `'skipped'`.

### 8.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-POSTCHECK` |
| **Purpose** | Generate a safe, read-only shell command to independently confirm a drifted finding |
| **Used in** | Layer 3 (Verification Engine), `post_check` agent task type |
| **MVP Status** | **v2-deferred** |
| **Model** | Claude Sonnet |
| **Temperature** | 0 |
| **Max tokens** | 300 |
| **Top-p** | 1.0 |

### 8.2 System Prompt

```
You are a verification engineer. Given a documentation claim identified as drifted, generate a shell command that independently confirms the finding.

Rules:
1. SAFE COMMANDS ONLY: grep, find, cat, ls, head, tail, wc, jq, test, stat. No write ops, no rm, no curl, no network calls, no process execution.
2. The command must run from the repository root directory.
3. Design the command so that:
   - Non-empty stdout (or exit code 0) means the finding is CONFIRMED.
   - Empty stdout (or non-zero exit code) means the finding may be WRONG.
4. Use standard Unix utilities available in GitHub Actions Ubuntu runners.
5. If no simple verification command exists for this finding, return is_skip: true.
6. Prefer grep -r for text searches, find for file existence, jq for JSON queries.

Respond with ONLY a JSON object. No other text.
```

### 8.3 User Prompt Template

```
Generate a shell command to confirm this finding.

<finding>
  <claim>{{claim_text}}</claim>
  <mismatch>{{mismatch_description}}</mismatch>
  <evidence_files>{{evidence_files | join(", ")}}</evidence_files>
</finding>

Respond as JSON:
{
  "command": "the shell command (or 'SKIP')",
  "expected_behavior": "what the output means",
  "is_skip": true | false
}
```

### 8.4 Output JSON Schema

```json
{
  "name": "p_postcheck_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "command": { "type": "string" },
      "expected_behavior": { "type": "string" },
      "is_skip": { "type": "boolean" }
    },
    "required": ["command", "expected_behavior", "is_skip"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PPostcheckOutputSchema = z.object({
  command: z.string().min(1),
  expected_behavior: z.string().min(1).max(300),
  is_skip: z.boolean(),
});
```

The Action validates the command against an allow-list of safe commands (`grep`, `find`, `cat`, `ls`, `head`, `tail`, `wc`, `jq`, `test`, `stat`) before execution. If the command passes the allow-list, it runs with a 10-second timeout. The result maps to `PostCheckResult` (api-contracts Section 10.3):
- Non-empty output -> `outcome: 'confirmed'`
- Empty output -> `outcome: 'contradicted'`
- `is_skip: true` -> `outcome: 'skipped'` (no command executed)

### 8.5 Examples

**Example 1: Library not found**

Input:
```
claim_text: "Authentication uses bcrypt for password hashing."
mismatch_description: "Code uses argon2, not bcrypt."
evidence_files: ["src/auth/password.ts"]
```

Output:
```json
{
  "command": "grep -r 'bcrypt' src/ --include='*.ts' --include='*.js' -l",
  "expected_behavior": "If bcrypt is truly absent (finding correct), output is empty. If bcrypt is still used somewhere, matching files are listed.",
  "is_skip": false
}
```

**Example 2: File existence check**

Input:
```
claim_text: "See config/default.yaml for configuration."
mismatch_description: "File config/default.yaml does not exist. Found config/default.toml."
evidence_files: ["config/default.toml"]
```

Output:
```json
{
  "command": "test -f config/default.yaml && echo 'EXISTS' || echo 'NOT_FOUND'",
  "expected_behavior": "If the finding is correct (file missing), prints 'NOT_FOUND'. If file exists, prints 'EXISTS'.",
  "is_skip": false
}
```

**Example 3: Skip -- no simple command possible**

Input:
```
claim_text: "The system handles race conditions in concurrent order processing."
mismatch_description: "No locking or mutex patterns found in order processing."
evidence_files: ["src/services/order-service.ts"]
```

Output:
```json
{
  "command": "SKIP",
  "expected_behavior": "Race condition handling cannot be confirmed by a simple shell command.",
  "is_skip": true
}
```

### 8.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Fallback Behavior |
|--------------|-----------|-------------------|
| Unparseable JSON | DOCALIGN_E201 | Retry once. On 2nd failure: `PostCheckOutcome = 'skipped'`. |
| Command fails allow-list (unsafe command) | N/A | Reject command, `outcome = 'skipped'`. Log WARN. |
| Command times out (>10s) | N/A | Kill process, `outcome = 'skipped'`. Log WARN. |

### 8.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~200 tokens |
| User prompt + finding | ~80-150 tokens |
| **Total input** | **~280-350 tokens** |
| **Output** | **~40-80 tokens** |
| **Cost per invocation** | ~$0.001 (Claude Sonnet) |

### 8.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once.
2. On second failure: `PostCheckOutcome = 'skipped'`. Finding proceeds to reporting without post-check confirmation.
3. Post-check failure does NOT change the verdict, severity, or suggested fix.

---

## 9. P-LEARN: Feedback Interpretation

> **MVP Status: v2-deferred**
>
> **Activation trigger:** Implemented when L7 Learning System's agent-interpreted path is built. Currently, only quick-pick deterministic handling (server-side, no LLM) and count-based fallback are active. P-LEARN is invoked only for free-text developer explanations via the `feedback_interpretation` agent task.

### 9.1 Identification

| Field | Value |
|-------|-------|
| **Prompt ID** | `P-LEARN` |
| **Purpose** | Interpret a developer's free-text dismissal explanation and generate appropriate suppression or corrective actions |
| **Used in** | Layer 7 (Learning System), `feedback_interpretation` agent task type |
| **MVP Status** | **v2-deferred** |
| **Model** | Claude Sonnet |
| **Temperature** | 0 |
| **Max tokens** | 600 |
| **Top-p** | 1.0 |

### 9.2 System Prompt

```
You are a learning system for a documentation-code alignment tool called DocAlign. A developer has dismissed a finding (a documentation claim flagged as drifted) and provided a free-text explanation. Your job is to interpret the explanation and decide what corrective actions to take.

Available actions (prefer narrow scope over broad):
1. suppress_claim: Suppress this specific claim for N days. Use when the finding is wrong or irrelevant for this specific claim.
2. suppress_file: Reduce priority for all findings from a specific doc file. Use when the developer says the file is known-stale.
3. suppress_type: Suppress a category of claims (e.g., all "convention" checks) repo-wide. Use ONLY when the developer explicitly says they do not care about an entire category.
4. update_rule: Modify a static analysis rule's scope or checks. Use when the developer explains the rule is misconfigured.
5. suggest_doc_update: The finding is correct but the developer will fix the docs. No suppression needed.
6. no_action: The explanation is too vague or contradictory to act on.

Rules:
1. Prefer suppress_claim over suppress_type. Narrow scope first.
2. Duration: 90 days for temporary situations (migrations). 180 days for persistent preferences.
3. Do NOT suppress_type unless the developer EXPLICITLY says they don't care about an entire category.
4. Check existing_rules to avoid creating duplicates.
5. If ambiguous, choose no_action with an explanation.
6. You may return multiple actions (e.g., suppress_claim + suggest_doc_update).

Respond with ONLY a JSON object. No other text.
```

### 9.3 User Prompt Template

```
Interpret this developer's dismissal explanation.

<finding>
  <claim id="{{claim_id}}" type="{{claim_type}}" file="{{source_file}}">
    {{claim_text}}
  </claim>
  <mismatch>{{mismatch_description}}</mismatch>
  <evidence_files>{{evidence_files | join(", ")}}</evidence_files>
</finding>

<developer_explanation>
{{free_text_explanation}}
</developer_explanation>

<existing_rules>
{{#each existing_rules}}
- Scope: {{this.scope}}, Target: {{this.target}}, Reason: {{this.reason}}
{{/each}}
{{#unless existing_rules}}(none){{/unless}}
</existing_rules>

Respond as JSON:
{
  "actions": [
    {
      "action_type": "suppress_claim" | "suppress_file" | "suppress_type" | "update_rule" | "suggest_doc_update" | "no_action",
      "target_id": "claim or rule ID (if applicable, else omit)",
      "target_path": "file path (if applicable, else omit)",
      "duration_days": <number, if applicable>,
      "reason": "why this action was chosen",
      "details": { ... }
    }
  ],
  "reasoning": "overall interpretation of the developer's intent"
}
```

### 9.4 Output JSON Schema

```json
{
  "name": "p_learn_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "actions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "action_type": { "type": "string", "enum": ["suppress_claim", "suppress_file", "suppress_type", "update_rule", "suggest_doc_update", "no_action"] },
            "target_id": { "type": "string" },
            "target_path": { "type": "string" },
            "duration_days": { "type": "integer", "minimum": 1, "maximum": 365 },
            "reason": { "type": "string" },
            "details": { "type": "object" }
          },
          "required": ["action_type", "reason"]
        },
        "minItems": 1
      },
      "reasoning": { "type": "string" }
    },
    "required": ["actions", "reasoning"],
    "additionalProperties": false
  }
}
```

Zod equivalent:

```typescript
const PLearnOutputSchema = z.object({
  actions: z.array(z.object({
    action_type: z.enum([
      'suppress_claim', 'suppress_file', 'suppress_type',
      'update_rule', 'suggest_doc_update', 'no_action',
    ]),
    target_id: z.string().optional(),
    target_path: z.string().optional(),
    duration_days: z.number().int().min(1).max(365).optional(),
    reason: z.string().min(1).max(500),
    details: z.record(z.unknown()).optional(),
  })).min(1),
  reasoning: z.string().min(1).max(500),
});
```

Maps to `FeedbackInterpretationResult` from `phase4-api-contracts.md` Section 10.3. Each action creates a `SuppressionRule` (api-contracts Section 9.1) with `source: 'agent_interpreted'`.

### 9.5 Examples

**Example 1: Migration in progress**

Input:
```
claim_id: "claim-001", claim_type: "behavior", source_file: "docs/auth.md"
claim_text: "Authentication uses bcrypt with 12 salt rounds."
mismatch_description: "Code uses argon2, not bcrypt."
evidence_files: ["src/auth/password.ts"]
free_text_explanation: "We're migrating from bcrypt to argon2. The docs PR is in progress."
existing_rules: []
```

Output:
```json
{
  "actions": [
    {
      "action_type": "suppress_claim",
      "target_id": "claim-001",
      "duration_days": 90,
      "reason": "Migration from bcrypt to argon2 in progress. Suppressed for 90 days."
    },
    {
      "action_type": "suggest_doc_update",
      "target_path": "docs/auth.md",
      "reason": "Developer confirms the finding is correct and docs need updating."
    }
  ],
  "reasoning": "Developer acknowledges drift is real but temporary. Suppress claim and note doc update needed."
}
```

**Example 2: Developer does not care about convention checks**

Input:
```
claim_id: "claim-042", claim_type: "convention", source_file: "CONTRIBUTING.md"
claim_text: "All test files follow the *.spec.ts naming convention."
mismatch_description: "12 test files use *.test.ts instead of *.spec.ts."
evidence_files: ["src/services/__tests__/user.test.ts"]
free_text_explanation: "We use both .test.ts and .spec.ts. Don't flag us for this."
existing_rules: []
```

Output:
```json
{
  "actions": [
    {
      "action_type": "suppress_type",
      "target_id": "convention",
      "duration_days": 180,
      "reason": "Team intentionally uses mixed naming conventions. Convention checks not wanted."
    }
  ],
  "reasoning": "Developer explicitly says they don't want convention-type checks. The naming divergence is intentional."
}
```

**Example 3: Vague explanation -- no action**

Input:
```
claim_id: "claim-099", claim_type: "behavior", source_file: "README.md"
claim_text: "The API validates all input using Joi schemas."
mismatch_description: "Code uses Zod, not Joi."
evidence_files: ["src/api/middleware/validate.ts"]
free_text_explanation: "idk this seems fine"
existing_rules: []
```

Output:
```json
{
  "actions": [
    {
      "action_type": "no_action",
      "reason": "Explanation is too vague to determine intent. The Joi-vs-Zod drift appears genuine."
    }
  ],
  "reasoning": "Developer's response does not indicate whether the finding is wrong, the docs are aspirational, or they don't care. Defaulting to no action."
}
```

**Example 4: Duplicate rule detection**

Input:
```
claim_id: "claim-055", claim_type: "behavior", source_file: "docs/cache.md"
claim_text: "Redis cache TTL is set to 5 minutes."
mismatch_description: "Cache TTL is 15 minutes in config."
evidence_files: ["src/config/cache.ts"]
free_text_explanation: "Already dismissed this. TTL is configurable per environment."
existing_rules:
  - { scope: "claim", target: "claim-055", reason: "TTL is environment-configurable" }
```

Output:
```json
{
  "actions": [
    {
      "action_type": "no_action",
      "reason": "Existing suppression rule already covers claim-055 with the same rationale."
    }
  ],
  "reasoning": "Existing rule matches. No additional action needed."
}
```

### 9.6 Known Failure Modes & Mitigations

| Failure Mode | Error Code | Fallback Behavior |
|--------------|-----------|-------------------|
| Unparseable JSON | DOCALIGN_E201 | Retry once. On 2nd failure: no corrective action. Feedback enters count-based fallback. |
| Wrong schema (empty actions array) | DOCALIGN_E202 | Zod rejects (`minItems: 1`). Retry. On 2nd failure: count-based fallback. |
| Agent creates overly broad suppression | N/A | Safety valves: all rules expire (90-180 days), spot-checks every 14 days, positive-feedback revocation at 2 signals. |

### 9.7 Token Budget & Cost

| Component | Estimate |
|-----------|----------|
| System prompt | ~350 tokens |
| User prompt + finding + explanation | ~200-350 tokens |
| Existing rules | ~50-200 tokens |
| **Total input** | **~600-900 tokens** |
| **Output** | **~100-250 tokens** |
| **Cost per invocation** | ~$0.003-0.005 (Claude Sonnet) |

### 9.8 Retry/Fallback Strategy

1. On `DOCALIGN_E201` or `DOCALIGN_E202`: Retry once with JSON-only suffix.
2. On second failure: No corrective action taken. Feedback recorded as a bare dismissal in `FeedbackRecord`. Enters count-based fallback path (per-claim suppression at threshold = 2 dismissals).
3. Developer's explanation text is preserved in `FeedbackRecord.free_text` for future manual review.

---

## 10. Cross-Cutting: Retry and Fallback Protocol

### 10.1 Parse Failure Flow (All Prompts)

```
1. LLM returns raw output
2. JSON.parse(output)
   - Success -> step 3
   - Failure (DOCALIGN_E201):
     a. Log WARN: { code: "DOCALIGN_E201", taskId, claimId, rawOutputLength, attempt: 1 }
     b. Re-send: original prompt + JSON-only suffix
     c. JSON.parse(retry_output)
        - Success -> step 3
        - Failure -> mark task failed, apply per-prompt fallback (10.3), STOP

3. Zod validate(output)
   - Success -> accept result
   - Failure (DOCALIGN_E202):
     a. Log WARN: { code: "DOCALIGN_E202", taskId, claimId, zodErrors, attempt: 1 }
     b. Re-send: original prompt + JSON-only suffix
     c. Zod validate(retry_output)
        - Success -> accept result
        - Failure -> mark task failed, apply per-prompt fallback (10.3), STOP
```

### 10.2 JSON-Only Retry Suffix

Appended to the **user message** (not system prompt) on retry:

```
IMPORTANT: Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the required schema. No markdown code fences, no commentary, no explanatory text. Start with { and end with }.
```

### 10.3 Per-Prompt Fallback Summary

| Prompt | On Final Failure |
|--------|-----------------|
| P-EXTRACT | Chunk produces zero claims. Other chunks proceed. |
| P-TRIAGE | Skip triage. Claim goes directly to P-VERIFY. |
| P-VERIFY (Path 1 or 2) | Claim `verdict = 'uncertain'`, `reasoning = 'llm_parse_error'`. |
| P-FIX | Finding posted without suggested fix (`DocFix = null`). |
| P-MAP-LLM | Claim `mapping_method: 'manual'`, skipped for verification. |
| P-DECOMPOSE | Claim marked unmappable, `classification: 'untestable'`. |
| P-POSTCHECK | `PostCheckOutcome = 'skipped'`. |
| P-LEARN | No corrective action. Feedback enters count-based fallback. |

### 10.4 Alerting Threshold

Per `phase3-error-handling.md` Scenario 1: If >10% of agent tasks in a single scan fail with `DOCALIGN_E201` or `DOCALIGN_E202`, log at ERROR:

```json
{ "code": "DOCALIGN_E201_THRESHOLD", "scanRunId": "...", "failureRate": 0.15, "totalTasks": 40 }
```

This indicates a systemic issue (model degradation, API changes, prompt regression) requiring investigation.

---

## 11. Cost Estimation Summary

### 11.1 Per-Invocation Costs

| Prompt | Model | Avg Input | Avg Output | Avg Cost | Frequency |
|--------|-------|-----------|------------|----------|-----------|
| P-EXTRACT | Sonnet | ~1,000 tok | ~400 tok | ~$0.004 | Per doc chunk (5-20/file) |
| P-TRIAGE | Haiku | ~480 tok | ~35 tok | ~$0.0003 | Per semantic claim with Path 1 evidence |
| P-VERIFY P1 | Sonnet | ~900 tok | ~200 tok | ~$0.003 | Per Path 1 semantic claim |
| P-VERIFY P2 | Sonnet | ~4,500 tok | ~300 tok | ~$0.02 | Per Path 2 semantic claim |
| P-FIX | Sonnet | ~420 tok | ~100 tok | ~$0.002 | Per drifted finding |
| P-MAP-LLM (v2) | Sonnet | ~680 tok | ~225 tok | ~$0.003 | Per unmappable claim |
| P-DECOMPOSE (v2) | Sonnet | ~500 tok | ~300 tok | ~$0.003 | Per vague claim |
| P-POSTCHECK (v2) | Sonnet | ~315 tok | ~60 tok | ~$0.001 | Per drifted finding |
| P-LEARN (v2) | Sonnet | ~750 tok | ~175 tok | ~$0.004 | Per free-text dismissal |

### 11.2 Per-PR Scan (MVP, typical)

Assumptions: 50 claims affected by PR changes. 20 syntactic (free). 30 semantic.

| Step | Count | Unit Cost | Total |
|------|-------|-----------|-------|
| P-EXTRACT (re-extract changed doc chunks) | 5 chunks | $0.004 | $0.02 |
| P-TRIAGE (Path 1 claims only) | 15 | $0.0003 | $0.005 |
| P-VERIFY Path 1 | 15 | $0.003 | $0.045 |
| P-VERIFY Path 2 | 10 | $0.02 | $0.20 |
| P-FIX (drifted findings) | 5 | $0.002 | $0.01 |
| **Total per PR** | | | **~$0.28** |

### 11.3 Full Scan (500 claims, 50 doc files)

| Step | Count | Unit Cost | Total |
|------|-------|-----------|-------|
| P-EXTRACT | 75 chunks | $0.004 | $0.30 |
| P-TRIAGE | 60 | $0.0003 | $0.02 |
| P-VERIFY Path 1 | 60 | $0.003 | $0.18 |
| P-VERIFY Path 2 | 40 | $0.02 | $0.80 |
| P-FIX | 15 | $0.002 | $0.03 |
| **Total full scan** | | | **~$1.33** |

### 11.4 Monthly Estimates

| Repo Activity | PRs/Month | Full Scans/Month | Monthly Cost |
|--------------|-----------|-----------------|-------------|
| Low (solo dev) | 20 | 4 | ~$11 |
| Medium (small team) | 80 | 4 | ~$28 |
| High (active team) | 200 | 4 | ~$61 |

---

## Appendix A: Prompt-to-Task Type Mapping

| Prompt ID | Layer | MVP Status | Agent Task Type | Trigger |
|-----------|-------|------------|-----------------|---------|
| P-EXTRACT | L1 | Active | `claim_extraction` | Doc file changed or full scan |
| P-TRIAGE | L3 | Active | Inline within `verification` task | Semantic claim with Path 1 evidence, before P-VERIFY |
| P-VERIFY P1 | L3 | Active | `verification` (path=1) | Claim passes triage as DRIFTED or UNCERTAIN |
| P-VERIFY P2 | L3 | Active | `verification` (path=2) | Claim routed to Path 2 by `routeClaim()` |
| P-FIX | L5 | Active | `fix_generation` | Claim verified as drifted |
| P-POSTCHECK | L3 | v2-deferred | `post_check` | Drifted verdict from Tier 4 |
| P-MAP-LLM | L2 | v2-deferred | Part of `claim_classification` | Unmappable claim after Steps 1-3 |
| P-DECOMPOSE | L2/L1 | v2-deferred | `claim_classification` | Claim classified as flow or universal |
| P-LEARN | L7 | v2-deferred | `feedback_interpretation` | Free-text developer dismissal explanation |

## Appendix B: Output Type Conformance Matrix

Every prompt output maps to an `AgentTaskResultData` variant from `phase4-api-contracts.md` Section 10.3:

| Prompt ID | Result Type | Key Fields |
|-----------|-------------|------------|
| P-EXTRACT | `ClaimExtractionResult` | `type: 'claim_extraction'`, `claims[]` with `claim_text`, `claim_type`, `source_file`, `source_line`, `confidence`, `keywords` |
| P-TRIAGE | N/A (inline, not a separate task result) | `classification`, `explanation` mapped to verdict internally |
| P-VERIFY P1 | `VerificationResultData` | `type: 'verification'`, `verdict`, `confidence`, `reasoning`, `evidence_files`, `specific_mismatch`, `suggested_fix` |
| P-VERIFY P2 | `VerificationResultData` | Same as P-VERIFY P1 |
| P-FIX | `FixGenerationResult` | `type: 'fix_generation'`, `suggested_fix.{file_path, line_start, line_end, new_text, explanation}` |
| P-POSTCHECK | `PostCheckResult` | `type: 'post_check'`, `outcome`, `reasoning` |
| P-DECOMPOSE | `ClaimClassificationResult` | `type: 'claim_classification'`, `classification`, `reasoning`, `static_rule?`, `sub_claims?`, `untestable_reason?` |
| P-MAP-LLM | Embedded in `ClaimClassificationResult` flow | `mapped_files[]` with `path`, `confidence`, `reason` |
| P-LEARN | `FeedbackInterpretationResult` | `type: 'feedback_interpretation'`, `actions[]` with `action_type`, `target_id?`, `target_path?`, `duration_days?`, `reason`, `details?` |
