# Gate 4.1 Cross-Layer Function Call Consistency Report (L4-L7 + Infra)

**Date:** 2026-02-11
**Scope:** L4 (Triggers), L5 (Reporter), L6 (MCP), L7 (Learning), Infra
**Method:** Compare every cross-layer function call in the caller's Section 2 + Section 4 against the callee's Section 4 signature.

---

## L4 (Triggers) Calls

### L4.processPRScan → L0.updateFromDiff
**Caller says:** `L0.updateFromDiff(data.repo_id, diffFiles)` — `(repoId: string, changedFiles: FileChange[])`
**Callee defines:** `updateFromDiff(repoId: string, changedFiles: FileChange[]): Promise<IndexUpdateResult>`
**Match:** YES

---

### L4.processPRScan → L0.getFileTree
**Caller says (Section 2):** `getFileTree(repoId)` — used in scope resolution to classify doc vs code files
**Callee defines:** `getFileTree(repoId: string): Promise<string[]>`
**Match:** YES

---

### L4.processPRScan → L1.reExtract
**Caller says:** `L1.reExtract(data.repo_id, docFile.filename, content)` — `(repoId, docFile, content)`
**Callee defines:** `reExtract(repoId: string, docFile: string, content: string): Promise<{ added: Claim[]; updated: Claim[]; removed: string[] }>`
**Match:** YES

---

### L4.processPRScan → L1.deleteClaimsForFile
**Caller says:** `L1.deleteClaimsForFile(data.repo_id, docFile.filename)` — `(repoId, docFile)`
**Callee defines:** `deleteClaimsForFile(repoId: string, docFile: string): Promise<number>`
**Match:** YES

---

### L4.processFullScan → L1.getClaimsByRepo
**Caller says:** `L1.getClaimsByRepo(data.repo_id)` — `(repoId)`
**Callee defines:** `getClaimsByRepo(repoId: string): Promise<Claim[]>`
**Match:** YES

---

### L4.resolveScope → L1.getClaimsByFile
**Caller says:** `L1.getClaimsByFile(repoId, docFile)` — `(repoId, sourceFile)`
**Callee defines:** `getClaimsByFile(repoId: string, sourceFile: string): Promise<Claim[]>`
**Match:** YES

---

### L4.resolveScope → L2.findClaimsByCodeFiles
**Caller says:** `L2.findClaimsByCodeFiles(repoId, changedCodeFiles)` — `(repoId, codeFiles)`
**Callee defines:** `findClaimsByCodeFiles(repoId: string, codeFiles: string[]): Promise<Claim[]>`
**Match:** YES

---

### L4.processPRScan → L2.mapClaim
**Caller says:** `L2.mapClaim(data.repo_id, claim)` — `(repoId, claim)`
**Callee defines:** `mapClaim(repoId: string, claim: Claim): Promise<ClaimMapping[]>`
**Match:** YES

---

### L4.processPRScan → L2.updateCodeFilePaths
**Caller says:** `L2.updateCodeFilePaths(data.repo_id, classified.renames)` — `(repoId, renames)`
**Callee defines:** `updateCodeFilePaths(repoId: string, renames: Array<{ from: string; to: string }>): Promise<number>`
**Match:** YES

---

### L4.processPRScan → L2.removeMappingsForFiles
**Caller says:** `L2.removeMappingsForFiles(data.repo_id, classified.deletions)` — `(repoId, deletedFiles)`
**Callee defines:** `removeMappingsForFiles(repoId: string, deletedFiles: string[]): Promise<number>`
**Match:** PARTIAL
**Issue:** L4 passes `classified.deletions` which is a `FileChange[]` array (objects with `filename`, `status`, etc.), but L2 expects `string[]` (plain file paths). L4 needs to map to `classified.deletions.map(f => f.filename)` before calling. The PR scan code does `classified.code_files.map(f => f.filename)` for resolveScope but does NOT show this mapping for the `removeMappingsForFiles` call. The push scan similarly passes `classified.deletions` directly.

---

### L4.processPRScan → L2.getMappingsForClaim
**Caller says:** `L2.getMappingsForClaim(claim.id)` — `(claimId)`
**Callee defines:** `getMappingsForClaim(claimId: string): Promise<ClaimMapping[]>`
**Match:** YES

---

### L4.processPRScan → L3.verifyDeterministic
**Caller says:** `L3.verifyDeterministic(claim, mappings)` — `(claim, mappings)`
**Callee defines:** `verifyDeterministic(claim: Claim, mappings: ClaimMapping[]): Promise<VerificationResult | null>`
**Match:** YES

---

### L4.processPRScan → L3.storeResult
**Caller says:** `L3.storeResult(deterministicResult)` — `(result)`
**Callee defines:** `storeResult(result: VerificationResult): Promise<void>`
**Match:** YES

---

### L4.processPRScan → L3.routeClaim
**Caller says:** `L3.routeClaim(claim, mappings)` — `(claim, mappings)`
**Callee defines:** `routeClaim(claim: Claim, mappings: ClaimMapping[]): Promise<RoutingDecision>`
**Match:** YES

---

### L4.processPRScan → L3.buildPath1Evidence
**Caller says:** `L3.buildPath1Evidence(claim, mappings)` — `(claim, mappings)`
**Callee defines:** `buildPath1Evidence(claim: Claim, mappings: ClaimMapping[]): Promise<FormattedEvidence>`
**Match:** YES

---

### L4.processPRScan → L3.mergeResults
**Caller says:** `L3.mergeResults(scanRunId)` — `(scanRunId)`
**Callee defines:** `mergeResults(scanRunId: string): Promise<VerificationResult[]>`
**Match:** YES

---

### L4.processPRScan → L5.postPRComment
**Caller says:** `L5.postPRComment(owner, repo, data.pr_number, payload, data.installation_id)` — `(owner, repo, prNumber, payload, installationId)`
**Callee defines:** `postPRComment(owner: string, repo: string, prNumber: number, payload: PRCommentPayload, installationId: number): Promise<{ comment_id: number; review_id: number }>`
**Match:** YES

---

### L4.processPRScan → L5.markResolved
**Caller says:** `L5.markResolved(owner, repo, data.pr_number, resolvedClaimIds, scanRunId, data.installation_id)` — `(owner, repo, prNumber, resolvedClaimIds, scanRunId, installationId)`
**Callee defines:** `markResolved(owner: string, repo: string, prNumber: number, resolvedClaimIds: string[], scanRunId: string, installationId: number): Promise<number>`
**Match:** YES

---

### L4.processPRScan → L5.calculateHealthScore
**Caller says:** `L5.calculateHealthScore(data.repo_id)` — `(repoId)`
**Callee defines:** `calculateHealthScore(repoId: string): Promise<HealthScore>`
**Match:** YES

---

### L4.processPRScan → L7.isClaimSuppressed
**Caller says:** `L7.isClaimSuppressed(claim)` — `(claim)`
**Callee defines:** `isClaimSuppressed(claim: Claim): Promise<boolean>`
**Match:** YES

---

### L4.processPRScan → L7.recordCoChanges
**Caller says:** `L7.recordCoChanges(data.repo_id, codeFilePaths, docFilePaths, data.head_sha)` — `(repoId, codeFiles, docFiles, sha)`
**Callee defines:** `recordCoChanges(repoId: string, codeFiles: string[], docFiles: string[], commitSha: string): Promise<void>`
**Match:** YES

---

### L4.processPRScan → Infra.createAgentTasks
**Caller says:** Uses `createAgentTask({repo_id, scan_run_id, type, payload})` (singular, object arg) to build an array, then `batchInsertAgentTasks(agentTasks)` to persist.
**Callee defines:** `createAgentTasks(repoId: string, scanRunId: string, tasks: Array<{ type: AgentTaskType; payload: AgentTaskPayload }>): Promise<string[]>`
**Match:** NO
**Issue:** L4's pseudocode uses two helpers (`createAgentTask` singular + `batchInsertAgentTasks`) that do not match Infra's single `createAgentTasks` function. The Infra function takes `(repoId, scanRunId, tasks[])` as three separate positional args, while L4 constructs task objects with `repo_id` and `scan_run_id` embedded in each task object. This is an API shape mismatch:
- L4 builds: `{ repo_id, scan_run_id, type, payload }`
- Infra expects: `createAgentTasks(repoId, scanRunId, [{ type, payload }])`
The `repo_id` and `scan_run_id` should be lifted out of each task object and passed as top-level args.

---

## L5 (Reporter) Calls

### L5 → L7.isClaimSuppressed (declared in Section 2, not used in Section 4)
**Caller says (Section 2):** `isClaimSuppressed(claim)` — "Filter suppressed claims before formatting"
**Callee defines:** `isClaimSuppressed(claim: Claim): Promise<boolean>`
**Match:** PARTIAL (WARNING)
**Issue:** L5's Section 2 dependency table claims L5 directly calls `L7.isClaimSuppressed`, but none of L5's five public API functions (Section 4) actually invoke it. L5 receives findings that are already filtered by L4. The Section 2 dependency entry appears to be stale/incorrect — suppression filtering happens in L4, not L5.

---

## L6 (MCP) Calls

### L6 → L5.calculateHealthScore (declared in L5, denied in L6)
**L5 Section 2.2 says:** L6 MCP Server calls `calculateHealthScore(repoId)` for `get_doc_health` tool.
**L6 Section 2.3 says:** "L1-L5, L7 service APIs | MCP is decoupled; queries the database directly"
**L6 Section 4.2 algorithm says:** `get_doc_health` computes health by querying claims + verification_results DB tables directly (inline SQL).
**Match:** NO (dependency conflict)
**Issue:** L5 believes L6 calls `calculateHealthScore`. L6 explicitly states it does NOT consume L5 APIs and instead queries the database directly. Additionally, the health score formulas differ:
- L5 `calculateHealthScore`: `score = verified / (verified + drifted)` (uncertain/pending excluded from denominator)
- L6 `get_doc_health`: `score = verified / (total_claims - pending)` (uncertain IS in denominator)
This means the same "health score" concept produces different numbers depending on whether it comes from L5 (PR comment, cached in repos table) or L6 (MCP tool response). This is both a dependency inconsistency and a semantic divergence.

---

## L7 (Learning) Calls

### L7.checkCountBasedExclusion → L1.updateVerificationStatus
**Caller says:** `L1.updateVerificationStatus(claimId, 'pending')` — `(claimId, status)`
**Callee defines:** `updateVerificationStatus(claimId: string, status: Verdict | 'pending'): Promise<void>`
**Match:** YES

---

## Infra Calls

### Infra.handleWebhook → L4.enqueuePRScan
**Caller says (Section 2.2):** `TriggerService.enqueuePRScan` — enqueues on `pull_request.opened` / `pull_request.synchronize`
**Callee defines:** `enqueuePRScan(repoId: string, prNumber: number, headSha: string, installationId: number, deliveryId: string): Promise<string>`
**Match:** YES (Infra's handleWebhook algorithm references this generically; parameter passing is implicit in the event routing)

---

### Infra.handleWebhook → L4.enqueuePushScan
**Caller says (Section 2.2):** `TriggerService.enqueuePushScan` — enqueues on `push` to default branch
**Callee defines:** `enqueuePushScan(repoId: string, commitSha: string, installationId: number): Promise<string>`
**Match:** YES

---

### Infra.handleWebhook → L4.enqueueFullScan
**Caller says (Section 2.2):** `TriggerService.enqueueFullScan` — enqueues on `installation.created`, manual trigger
**Callee defines:** `enqueueFullScan(repoId: string, installationId: number): Promise<string>`
**Match:** YES

---

## Summary

| Category | Count |
|----------|-------|
| **Matches (YES)** | 22 |
| **Mismatches (NO)** | 2 |
| **Warnings (PARTIAL)** | 2 |

### Mismatches requiring resolution before implementation:

1. **L4 → Infra.createAgentTasks** — L4 uses `createAgentTask` (singular) + `batchInsertAgentTasks` helpers that do not exist in Infra. Infra defines `createAgentTasks(repoId, scanRunId, tasks[])` with a different parameter shape. L4's pseudocode must be updated to call Infra's actual API, or Infra must expose the helpers L4 expects.

2. **L5 ↔ L6 health score divergence** — L5's Section 2.2 claims L6 calls `calculateHealthScore`, but L6 explicitly bypasses all service-layer APIs and queries the DB directly with a *different formula*. Either L6 should reuse L5's `calculateHealthScore`, or the formulas must be reconciled and both TDDs updated to reflect the actual architecture.

### Warnings requiring clarification:

3. **L5 Section 2 phantom dependency on L7.isClaimSuppressed** — L5 lists this dependency but never calls it in any Section 4 algorithm. Should be removed from L5's Section 2 dependency table (suppression filtering is L4's responsibility).

4. **L4 → L2.removeMappingsForFiles type mismatch** — L4 passes `classified.deletions` (a `FileChange[]`) but L2 expects `string[]`. L4's pseudocode should explicitly map to filenames: `classified.deletions.map(f => f.filename)`.
