# Epic E5: GitHub Action + LLM Pipeline

**Repository:** `docalign/agent-action/` (separate from main server repo)
**Depends on:** E1 (Agent Task API), E4 (repository dispatch trigger, task creation)

## Story S5.1: Action Scaffold + Task Polling

### Task E5-01: Action Scaffold -- action.yml + Workflow Template + Dispatch Handler
- **Files:** `agent-action/action.yml`, `agent-action/src/index.ts`, `agent-action/src/config.ts`, `agent-action/.github/workflows/docalign-scan.yml`
- **Implements:** phase6-epics.md E5 Key Deliverable 1; phase4b-prompt-specs.md Section 1.1; phase4-api-contracts.md Section 11.1 (RepositoryDispatchPayload)
- **Types used:** `RepositoryDispatchPayload`, `DocAlignConfig` (llm section), `AgentTaskType`
- **Tests:** action.yml input parsing, config loading from `.docalign.yml`, dispatch payload extraction, env var validation
- **Done when:** action.yml declares inputs; workflow template handles repository_dispatch; config reads .docalign.yml; entry point parses payload and validates env vars
- **Estimated effort:** 3 hours

### Task E5-02: Task Polling Loop -- Claim + Process + Submit
- **Files:** `agent-action/src/polling.ts`, `agent-action/src/api-client.ts`
- **Implements:** tdd-infra.md Sections 4.3-4.6 (client-side contract)
- **Types used:** `TaskListResponse`, `TaskDetailResponse`, `AgentTask`, `AgentTaskPayload`, `AgentTaskResult`, `AgentTaskResultData`, `TaskResultMetadata`, `TaskResultResponse`, `APIErrorResponse`
- **Tests:** Poll, claim, route by type, submit, handle 409/410/404, retry on 500/503, FIFO order, metadata population
- **Done when:** api-client implements getPendingTasks/claimTask/submitTaskResult; polling processes tasks sequentially; error handling correct; metadata populated
- **Estimated effort:** 4 hours

## Story S5.2: Prompt Implementations

### Task E5-03: P-EXTRACT Prompt Implementation
- **Files:** `agent-action/src/prompts/extract.ts`, `agent-action/src/prompts/schemas.ts`
- **Implements:** phase4b-prompt-specs.md Section 2 (system prompt 2.2, user template 2.3, output schema 2.4, failure modes 2.6, retry 2.8)
- **Types used:** `ClaimExtractionPayload`, `ClaimExtractionResult`, `AgentTaskResult`, `TaskResultMetadata`, `ClaimType`
- **Tests:** Prompt building, JSON parsing, Zod validation, syntactic type filtering, 50-claim cap, extracted_value post-processing, correct model/temperature
- **Done when:** System/user prompts match spec; output validated; syntactic types filtered; 50-claim cap; response format uses json_schema
- **Estimated effort:** 3 hours

### Task E5-04: P-TRIAGE Prompt Implementation
- **Files:** `agent-action/src/prompts/triage.ts`
- **Implements:** phase4b-prompt-specs.md Section 3
- **Types used:** `VerificationPayload`, `FormattedEvidence`, `Verdict`
- **Tests:** Prompt from truncated evidence, ACCURATE->verified short-circuit, DRIFTED/UNCERTAIN->proceed, Path 2 skip, Haiku model, parse failure fallback
- **Done when:** Uses Haiku; evidence truncated to 500 tokens; classification-to-verdict mapping correct; only Path 1 claims
- **Estimated effort:** 2 hours

### Task E5-05: P-VERIFY Path 1 Prompt Implementation
- **Files:** `agent-action/src/prompts/verify-path1.ts`
- **Implements:** phase4b-prompt-specs.md Section 4A
- **Types used:** `VerificationPayload`, `VerificationResultData`, `FormattedEvidence`, `Verdict`, `Severity`
- **Tests:** Prompt building, verified/drifted/uncertain parsing, Zod validation, evidence_files, Sonnet model, 3C-005 downgrade
- **Done when:** System/user prompts match spec; drifted+empty evidence -> uncertain (3C-005); verified+empty evidence -> confidence -0.3
- **Estimated effort:** 3 hours

### Task E5-06: P-VERIFY Path 2 Prompt Implementation
- **Files:** `agent-action/src/prompts/verify-path2.ts`
- **Implements:** phase4b-prompt-specs.md Section 4B
- **Types used:** `VerificationPayload`, `MappedFileHint`, `VerificationResultData`, `RoutingReason`, `Verdict`, `Severity`
- **Tests:** Prompt with routing reasons, empty mapped_files, evidence_files validation, max_files warning, Sonnet model, same post-processing as Path 1
- **Done when:** All Path 2 placeholders filled; default max_files=10/max_tokens=8000; same post-processing as E5-05
- **Estimated effort:** 3 hours

### Task E5-07: P-FIX Prompt Implementation
- **Files:** `agent-action/src/prompts/fix.ts`
- **Implements:** phase4b-prompt-specs.md Section 5
- **Types used:** `FixGenerationPayload`, `FixGenerationResult`, `FindingSummary`
- **Tests:** Prompt building, valid fix parsing, empty new_text rejection, identical text discard, excessive length truncation, temperature 0.3, failure handling
- **Done when:** Temperature 0.3; client-side validation (identical text, excessive length); on failure finding posted without fix
- **Estimated effort:** 2 hours

## Story S5.3: Supporting Features + IE-02 Integration

### Task E5-08: Embedding Generation
- **Files:** `agent-action/src/embeddings.ts`
- **Implements:** phase4b-prompt-specs.md Section 1.2 (text-embedding-3-small, 1536 dims)
- **Types used:** `ClaimExtractionResult`, `CodeEntity`, `TaskResultMetadata`
- **Tests:** OpenAI API call, batch processing (max 100), 1536 dimensions, rate limit backoff, empty input, configurable model
- **Done when:** Calls text-embedding-3-small; batch max 100; rate limit handling; all tests pass
- **Estimated effort:** 2 hours

### Task E5-09: Agent Adapter -- Claude Code Custom-Command for Path 2
- **Files:** `agent-action/src/agent-adapter.ts`, `agent-action/src/prompts/verify-path2.ts` (integration)
- **Implements:** phase6-epics.md E5 Key Deliverable 11; ADR-1 (agent-first)
- **Types used:** `VerificationPayload`, `MappedFileHint`, `VerificationResultData`
- **Tests:** Subprocess invocation, --max-turns, stdout capture, Zod validation, timeout (30 min), non-zero exit -> uncertain, repo_root as working dir
- **Done when:** Spawns `claude -p` with Path 2 prompt; timeout enforced; fallback to uncertain on failure
- **Estimated effort:** 3 hours

### Task E5-10: Retry/Fallback Protocol
- **Files:** `agent-action/src/retry.ts`, all prompt files (integration)
- **Implements:** phase4b-prompt-specs.md Section 10 (parse failure flow, JSON-only suffix, per-prompt fallback, alerting)
- **Types used:** `AgentTaskResult`, `DocAlignError`
- **Tests:** JSON.parse failure retry, Zod failure retry, JSON-only suffix text, per-prompt fallbacks (0 claims/skip/uncertain/no fix), WARN logging, >10% threshold alerting, metadata on success+failure
- **Done when:** executeWithRetry wraps all prompts; fallbacks match Section 10.3 table; threshold alerting at >10%
- **Estimated effort:** 3 hours

### Task E5-11: IE-02 Integration Test -- Semantic Drift End-to-End
- **Files:** `agent-action/tests/integration/ie-02.test.ts`, `agent-action/tests/fixtures/ie-02/`
- **Implements:** phase5-integration-examples.md IE-02
- **Types used:** All payload and result types
- **Tests:** Full end-to-end: dispatch -> poll -> P-EXTRACT (3 claims) -> P-VERIFY Path 1 (drifted, 0.97, high) -> P-FIX (corrected text) -> submit results; all results conform to Section 10.3 types
- **Done when:** IE-02 scenario reproduces exact flow with mocked LLM + mocked API; all task results conform to contracts
- **Estimated effort:** 4 hours

## Summary

| Task | Title | Est. Hours |
|------|-------|:----------:|
| E5-01 | Action Scaffold | 3 |
| E5-02 | Task Polling Loop | 4 |
| E5-03 | P-EXTRACT | 3 |
| E5-04 | P-TRIAGE | 2 |
| E5-05 | P-VERIFY Path 1 | 3 |
| E5-06 | P-VERIFY Path 2 | 3 |
| E5-07 | P-FIX | 2 |
| E5-08 | Embedding Generation | 2 |
| E5-09 | Agent Adapter (Claude Code) | 3 |
| E5-10 | Retry/Fallback Protocol | 3 |
| E5-11 | IE-02 Integration Test | 4 |
| **Total** | | **32** |

## Execution Order
1. E5-01 (scaffold) -- no internal dependencies
2. E5-02 (polling) -- depends on E5-01
3. E5-03 through E5-07 (prompts) -- parallelizable, depend on E5-02
4. E5-10 (retry) -- depends on E5-03 through E5-07
5. E5-08 (embeddings) -- independent of prompts, depends on E5-02
6. E5-09 (agent adapter) -- depends on E5-06 (Path 2)
7. E5-11 (IE-02) -- depends on all above
