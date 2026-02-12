# Phase 4: API Contracts — Canonical Cross-Layer TypeScript Interfaces

> Part of [DocAlign Workflow](../WORKFLOW.md) — Phase 4 Prerequisite
>
> **Inputs:** Phase 3A-3E (approved), Spikes A-C, PRD, Technical Reference
>
> **Purpose:** Single source of truth for how layers communicate. Every TDD must conform to the types defined here. Every cross-layer function call must match a signature in this file.
>
> **Date:** 2026-02-11

---

## 1. Shared Enums and Literals

```typescript
// === Claim Types ===
type ClaimType =
  | 'path_reference'
  | 'dependency_version'
  | 'command'
  | 'api_route'
  | 'code_example'
  | 'behavior'
  | 'architecture'
  | 'config'
  | 'convention'
  | 'environment';

type Testability = 'syntactic' | 'semantic' | 'untestable';

type ExtractionMethod = 'regex' | 'heuristic' | 'llm';

// === Verification ===
type Verdict = 'verified' | 'drifted' | 'uncertain';

type Severity = 'high' | 'medium' | 'low';

/** Path 1 = entity-extracted evidence + single LLM call. Path 2 = agent-delegated exploration. */
type VerificationPath = 1 | 2;

type PostCheckOutcome = 'confirmed' | 'contradicted' | 'skipped';

// === Mapping ===
type MappingMethod =
  | 'direct_reference'
  | 'symbol_search'
  | 'semantic_search'
  | 'llm_assisted'
  | 'manual'
  | 'co_change';

// === Scan ===
type ScanType = 'pr' | 'full' | 'push';

type TriggerType = 'pr' | 'push' | 'scheduled' | 'manual' | 'agent_report';

type ScanStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

// === Repo ===
type RepoStatus = 'onboarding' | 'awaiting_setup' | 'scanning' | 'active' | 'partial' | 'error';

// === Agent Tasks ===
type AgentTaskType =
  | 'claim_extraction'
  | 'verification'
  | 'claim_classification'
  | 'fix_generation'
  | 'post_check'
  | 'feedback_interpretation';

type AgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'expired';

// === Feedback ===
type FeedbackType =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'fix_accepted'
  | 'fix_dismissed'
  | 'all_dismissed';

// === Quick-Pick Reasons (L7 learning) ===
type QuickPickReason =
  | 'not_relevant_to_this_file'
  | 'intentionally_different'
  | 'will_fix_later'
  | 'docs_are_aspirational'
  | 'this_is_correct';

// === Suppression ===
type SuppressionScope = 'claim' | 'file' | 'claim_type' | 'pattern';

// === Claim Classification (Spike A, v2) ===
type VagueClaimClassification = 'universal' | 'flow' | 'untestable';

// === Code Entity Types ===
type EntityType = 'function' | 'class' | 'route' | 'type' | 'config';
```

---

## 2. Layer 0: Codebase Index

### 2.1 Data Types

```typescript
interface CodeEntity {
  id: string;                  // UUID
  repo_id: string;
  file_path: string;
  line_number: number;
  end_line_number: number;     // for line count calculation
  entity_type: EntityType;
  name: string;
  signature: string;           // human-readable signature
  embedding: number[] | null;  // VECTOR(1536), null if not yet embedded
  raw_code: string;            // source code for verification context
  last_commit_sha: string;
  created_at: Date;
  updated_at: Date;
}

interface FileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  previous_filename?: string;  // only for renamed
  additions: number;
  deletions: number;
  patch?: string;
}

interface DependencyVersion {
  version: string;
  source: 'lockfile' | 'manifest';  // 3B-D3: enables correct comparison
}

interface RouteEntity {
  id: string;
  file_path: string;
  line_number: number;
  method: string;              // GET, POST, etc.
  path: string;                // /api/v2/users
}

interface ScriptInfo {
  name: string;
  command: string;
  file_path: string;           // package.json, Makefile, etc.
}
```

### 2.2 Public API (consumed by L1, L2, L3, L4)

```typescript
interface CodebaseIndexService {
  // File operations
  fileExists(repoId: string, path: string): Promise<boolean>;
  getFileTree(repoId: string): Promise<string[]>;

  // Entity lookup
  findSymbol(repoId: string, name: string): Promise<CodeEntity[]>;
  getEntityByFile(repoId: string, filePath: string): Promise<CodeEntity[]>;
  getEntityById(entityId: string): Promise<CodeEntity | null>;

  // Route lookup
  findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null>;
  searchRoutes(repoId: string, path: string): Promise<Array<{
    method: string;
    path: string;
    file: string;
    line: number;
    similarity: number;
  }>>;

  // Dependency lookup
  getDependencyVersion(repoId: string, packageName: string): Promise<DependencyVersion | null>;

  // Script lookup
  scriptExists(repoId: string, scriptName: string): Promise<boolean>;
  getAvailableScripts(repoId: string): Promise<ScriptInfo[]>;

  // Semantic search
  searchSemantic(repoId: string, query: string, topK: number): Promise<Array<CodeEntity & { similarity: number }>>;

  // Incremental update (called by L4 on PR/push)
  updateFromDiff(repoId: string, changedFiles: FileChange[]): Promise<IndexUpdateResult>;
}

interface IndexUpdateResult {
  entities_added: number;
  entities_updated: number;
  entities_removed: number;
  files_skipped: string[];     // unparseable files
}
```

---

## 3. Layer 1: Claim Extractor

### 3.1 Data Types

```typescript
interface Claim {
  id: string;                        // UUID
  repo_id: string;
  source_file: string;
  line_number: number;
  claim_text: string;
  claim_type: ClaimType;
  testability: Testability;
  extracted_value: ExtractedValue;   // per-type structured data (JSONB)
  keywords: string[];
  extraction_confidence: number;     // 0-1
  extraction_method: ExtractionMethod;
  verification_status: Verdict | 'pending';
  last_verified_at: Date | null;
  embedding: number[] | null;        // VECTOR(1536)
  parent_claim_id: string | null;    // non-null for sub-claims (Spike A decomposition)
  created_at: Date;
  updated_at: Date;
}

// Per-type extracted_value JSONB discriminated union
type ExtractedValue =
  | { type: 'path_reference'; path: string }
  | { type: 'dependency_version'; package: string; version: string }
  | { type: 'command'; runner: string; script: string }
  | { type: 'api_route'; method: string; path: string }
  | { type: 'code_example'; language: string | null; imports: string[]; symbols: string[]; commands: string[] }
  | { type: 'behavior'; description: string }
  | { type: 'architecture'; description: string }
  | { type: 'config'; key: string; value: string }
  | { type: 'convention'; description: string }
  | { type: 'environment'; description: string };
```

### 3.2 Public API (consumed by L2, L3, L4, L5, L7)

```typescript
interface ClaimExtractorService {
  // Syntactic extraction (deterministic, server-side)
  extractSyntactic(repoId: string, docFile: string, content: string): Promise<Claim[]>;

  // Query claims
  getClaimsByFile(repoId: string, sourceFile: string): Promise<Claim[]>;
  getClaimsByRepo(repoId: string): Promise<Claim[]>;
  getClaimById(claimId: string): Promise<Claim | null>;

  // Re-extraction on doc file change
  reExtract(repoId: string, docFile: string, content: string): Promise<{
    added: Claim[];
    updated: Claim[];
    removed: string[];           // claim IDs removed
  }>;

  // Delete claims for a removed doc file
  deleteClaimsForFile(repoId: string, docFile: string): Promise<number>;

  // Update verification status
  updateVerificationStatus(claimId: string, status: Verdict | 'pending'): Promise<void>;
}
```

---

## 4. Layer 2: Code-to-Claim Mapper

### 4.1 Data Types

```typescript
interface ClaimMapping {
  id: string;                     // UUID
  claim_id: string;
  repo_id: string;
  code_file: string;
  code_entity_id: string | null;  // null = whole-file mapping
  confidence: number;             // 0-1 (includes co_change_boost)
  co_change_boost: number;        // 0-1, default 0.0 (3C-001)
  mapping_method: MappingMethod;
  created_at: Date;
  last_validated_at: Date;
}
```

### 4.2 Public API (consumed by L3, L4, L5, L7)

```typescript
interface MapperService {
  // Map a single claim through the 4-step progressive pipeline
  mapClaim(repoId: string, claim: Claim): Promise<ClaimMapping[]>;

  // Reverse index: which claims are affected by code file changes?
  findClaimsByCodeFiles(repoId: string, codeFiles: string[]): Promise<Claim[]>;

  // Get mappings for a claim
  getMappingsForClaim(claimId: string): Promise<ClaimMapping[]>;

  // Refresh mappings for a claim (re-run Steps 1-3)
  refreshMapping(claimId: string): Promise<ClaimMapping[]>;

  // Maintenance: update file paths on rename
  updateCodeFilePaths(repoId: string, renames: Array<{ from: string; to: string }>): Promise<number>;

  // Maintenance: remove mappings for deleted code files
  removeMappingsForFiles(repoId: string, deletedFiles: string[]): Promise<number>;

  // Get entity line count for routing (3B-D1: computed via JOIN, not stored)
  getEntityLineCount(mappingId: string): Promise<number | null>;
}
```

---

## 5. Layer 3: Verification Engine

### 5.1 Data Types

```typescript
interface VerificationResult {
  id: string;                            // UUID
  claim_id: string;
  repo_id: string;
  scan_run_id: string;
  verdict: Verdict;
  confidence: number;                    // 0-1
  tier: 1 | 2 | 4 | 5;                  // Tier 3 (triage) removed per ADR-3
  severity: Severity | null;             // null if verdict is 'verified'
  reasoning: string | null;
  specific_mismatch: string | null;
  suggested_fix: string | null;
  evidence_files: string[];
  token_cost: number | null;             // LLM tokens used (null for deterministic tiers)
  duration_ms: number;
  post_check_result: PostCheckOutcome | null;
  verification_path: VerificationPath | null; // null for deterministic tiers
  created_at: Date;
}

/** Routing decision made by the server before task creation */
interface RoutingDecision {
  claim_id: string;
  path: VerificationPath;
  reason: RoutingReason;
  entity_token_estimate: number | null;  // Path 1 only
}

type RoutingReason =
  | 'single_entity_mapped'       // Path 1: claim maps to exactly one entity
  | 'multi_entity_small'         // Path 1: maps to multiple entities, total tokens < cap
  | 'evidence_too_large'         // Path 2: entity tokens exceed path1_max_evidence_tokens
  | 'multi_file'                 // Path 2: claim maps to multiple files
  | 'no_mapping'                 // Path 2: no code mapping found
  | 'file_only_mapping';         // Path 2: maps to file but no specific entity
```

### 5.2 Public API (consumed by L4, L5, L7)

```typescript
interface VerifierService {
  // Deterministic verification (Tiers 1-2, server-side)
  verifyDeterministic(claim: Claim, mappings: ClaimMapping[]): Promise<VerificationResult | null>;

  // Route a claim to Path 1 or Path 2
  routeClaim(claim: Claim, mappings: ClaimMapping[]): Promise<RoutingDecision>;

  // Build Path 1 evidence payload (server-side, from L0 index)
  buildPath1Evidence(claim: Claim, mappings: ClaimMapping[]): Promise<FormattedEvidence>;

  // Store verification result
  storeResult(result: VerificationResult): Promise<void>;

  // Merge deterministic + agent results for a scan
  mergeResults(scanRunId: string): Promise<VerificationResult[]>;

  // Get latest result for a claim
  getLatestResult(claimId: string): Promise<VerificationResult | null>;
}

interface FormattedEvidence {
  formatted_evidence: string;    // Human-readable code snippet for LLM
  metadata: {
    path: 1;
    file_path: string;
    entity_name: string;
    entity_lines: [number, number];
    entity_token_estimate: number;
    imports_token_estimate: number;
    total_token_estimate: number;
  };
}
```

---

## 6. Layer 4: Change Triggers

### 6.1 Data Types

```typescript
interface ScanRun {
  id: string;                    // UUID
  repo_id: string;
  trigger_type: TriggerType;
  trigger_ref: string | null;    // PR number or commit SHA
  status: ScanStatus;
  commit_sha: string;            // HEAD at scan start (for force push detection)
  claims_checked: number;
  claims_drifted: number;
  claims_verified: number;
  claims_uncertain: number;
  total_token_cost: number;
  total_duration_ms: number;
  comment_posted: boolean;       // 3C-006: prevent duplicate comments
  check_run_id: number | null;   // GitHub Check Run ID
  started_at: Date;
  completed_at: Date | null;
}
```

### 6.2 Public API (consumed by API Server, Worker)

```typescript
interface TriggerService {
  // Enqueue a scan job
  enqueuePRScan(repoId: string, prNumber: number, headSha: string, installationId: number, deliveryId: string): Promise<string>; // returns scan_run_id
  enqueuePushScan(repoId: string, commitSha: string, installationId: number): Promise<string>;
  enqueueFullScan(repoId: string, installationId: number): Promise<string>;

  // Scope resolution: which claims need verification?
  resolveScope(repoId: string, changedCodeFiles: string[], changedDocFiles: string[]): Promise<Claim[]>;

  // Cancel active scan for a repo
  cancelScan(scanRunId: string): Promise<void>;

  // Update scan status
  updateScanStatus(scanRunId: string, status: ScanStatus, stats?: Partial<Pick<ScanRun, 'claims_checked' | 'claims_drifted' | 'claims_verified' | 'claims_uncertain' | 'total_token_cost' | 'total_duration_ms'>>): Promise<void>;
}
```

---

## 7. Layer 5: Report & Fix Generation

### 7.1 Data Types

```typescript
interface DocFix {
  file: string;
  line_start: number;
  line_end: number;
  old_text: string;
  new_text: string;
  reason: string;
  claim_id: string;
  confidence: number;
}

interface HealthScore {
  total_claims: number;
  verified: number;
  drifted: number;
  uncertain: number;
  pending: number;
  score: number;                     // 0-1
  by_file: Record<string, FileHealth>;
  by_type: Record<ClaimType, number>;
  hotspots: string[];                // file paths with most drift
}

interface FileHealth {
  total: number;
  verified: number;
  drifted: number;
  uncertain: number;
}

interface PRCommentPayload {
  findings: Finding[];
  health_score: HealthScore;
  scan_run_id: string;
  agent_unavailable_pct: number;     // for >20% banner (3A 11.7)
}

interface Finding {
  claim: Claim;
  result: VerificationResult;
  fix: DocFix | null;
  suppressed: boolean;
}
```

### 7.2 Public API (consumed by L4 worker, L7)

```typescript
interface ReporterService {
  // Format and post PR comment
  postPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    payload: PRCommentPayload,
    installationId: number
  ): Promise<{ comment_id: number; review_id: number }>;

  // Mark old comments as resolved
  markResolved(
    owner: string,
    repo: string,
    prNumber: number,
    resolvedClaimIds: string[],
    scanRunId: string,
    installationId: number
  ): Promise<number>; // count of resolved

  // Calculate health score
  calculateHealthScore(repoId: string): Promise<HealthScore>;

  // Format a single finding for PR comment (internal, used in formatting)
  formatFinding(finding: Finding): string;

  // Sanitize text for markdown output (3E-004)
  sanitizeForMarkdown(text: string): string;
}
```

---

## 8. Layer 6: MCP Server (v2)

### 8.1 MCP Tool Request/Response Types

```typescript
// get_docs
interface GetDocsRequest { query: string; verified_only?: boolean }
interface GetDocsResponse {
  sections: Array<{
    file: string;
    section: string;
    content: string;
    verification_status: Verdict | 'pending';
    last_verified: string;        // ISO 8601
    claims_in_section: number;
    verified_claims: number;
    health_score: number;
  }>;
}

// get_doc_health
interface GetDocHealthRequest { path?: string }
interface GetDocHealthResponse { health: HealthScore }

// report_drift (v3)
interface ReportDriftRequest {
  doc_file: string;
  line_number?: number;
  claim_text: string;
  actual_behavior: string;
  evidence_files?: string[];
}
interface ReportDriftResponse { acknowledged: boolean; claim_id: string }

// list_stale_docs
interface ListStaleDocsRequest { max_results?: number }
interface ListStaleDocsResponse {
  stale_docs: Array<{
    file: string;
    drifted_claims: number;
    uncertain_claims: number;
    last_verified: string;
  }>;
}
```

---

## 9. Layer 7: Learning System

### 9.1 Data Types

```typescript
interface FeedbackRecord {
  id: string;
  repo_id: string;
  claim_id: string;
  verification_result_id: string | null;
  feedback_type: FeedbackType;
  quick_pick_reason: QuickPickReason | null;
  free_text: string | null;             // v2: free-text explanation
  github_user: string | null;
  pr_number: number | null;
  created_at: Date;
}

interface SuppressionRule {
  id: string;
  repo_id: string;
  scope: SuppressionScope;
  target_claim_id: string | null;       // scope=claim
  target_file: string | null;           // scope=file
  target_claim_type: ClaimType | null;  // scope=claim_type
  target_pattern: string | null;        // scope=pattern (v2)
  reason: string;
  source: 'quick_pick' | 'count_based' | 'agent_interpreted'; // how rule was created
  expires_at: Date | null;              // null = no expiry
  revoked: boolean;
  created_at: Date;
}

interface CoChangeRecord {
  id: string;
  repo_id: string;
  code_file: string;
  doc_file: string;
  commit_sha: string;
  committed_at: Date;
  created_at: Date;
}
```

### 9.2 Public API (consumed by L2, L3, L4, L5)

```typescript
interface LearningService {
  // Feedback recording
  recordFeedback(feedback: Omit<FeedbackRecord, 'id' | 'created_at'>): Promise<FeedbackRecord>;

  // Quick-pick processing (deterministic, server-side)
  processQuickPick(claimId: string, reason: QuickPickReason, repoId: string): Promise<SuppressionRule | null>;

  // Count-based exclusion check
  checkCountBasedExclusion(claimId: string): Promise<boolean>; // true if claim should be excluded

  // Suppression check: is this claim suppressed?
  isClaimSuppressed(claim: Claim): Promise<boolean>;

  // Get active suppression rules for a repo
  getActiveRules(repoId: string): Promise<SuppressionRule[]>;

  // Co-change tracking
  recordCoChanges(repoId: string, codeFiles: string[], docFiles: string[], commitSha: string): Promise<void>;
  getCoChangeBoost(repoId: string, codeFile: string, docFile: string): Promise<number>; // 0 to 0.1

  // Confidence decay
  getEffectiveConfidence(result: VerificationResult): number;
}
```

---

## 10. Agent Task API Contracts

These types define the contract between the DocAlign server and the GitHub Action.

### 10.1 Agent Task (Database + API)

```typescript
interface AgentTask {
  id: string;                    // UUID
  repo_id: string;
  scan_run_id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  payload: AgentTaskPayload;     // discriminated by type
  claimed_by: string | null;     // action_run_id
  error: string | null;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
}
```

### 10.2 Task Payloads (server → Action)

```typescript
type AgentTaskPayload =
  | ClaimExtractionPayload
  | VerificationPayload
  | ClaimClassificationPayload
  | FixGenerationPayload
  | PostCheckPayload
  | FeedbackInterpretationPayload;

interface ClaimExtractionPayload {
  type: 'claim_extraction';
  doc_files: string[];
  project_context: ProjectContext;
}

interface VerificationPayload {
  type: 'verification';
  verification_path: VerificationPath;
  claim: ClaimSummary;
  evidence?: FormattedEvidence;              // Path 1 only
  mapped_files?: MappedFileHint[];           // Path 2 only
  routing_reason: RoutingReason;
}

interface ClaimClassificationPayload {
  type: 'claim_classification';
  claim: ClaimSummary;
  project_context: ProjectContext;
}

interface FixGenerationPayload {
  type: 'fix_generation';
  finding: FindingSummary;
}

interface PostCheckPayload {
  type: 'post_check';
  finding: FindingSummary;
}

interface FeedbackInterpretationPayload {
  type: 'feedback_interpretation';
  finding: FindingSummary & { claim_id: string; claim_type: ClaimType };
  explanation: { type: 'free_text'; value: string };
  existing_rules: Array<{ scope: string; target: string; reason: string }>;
}

// Shared sub-types for payloads
interface ProjectContext {
  language: string;
  frameworks: string[];
  dependencies: Record<string, string>;
}

interface ClaimSummary {
  id: string;
  claim_text: string;
  claim_type: ClaimType;
  source_file: string;
  source_line: number;
}

interface MappedFileHint {
  path: string;
  confidence: number;
  entity_name: string | null;
}

interface FindingSummary {
  claim_text: string;
  source_file: string;
  source_line: number;
  verdict?: Verdict;
  mismatch_description: string;
  evidence_files: string[];
}
```

### 10.3 Task Results (Action → server)

```typescript
interface AgentTaskResult {
  task_id: string;
  success: boolean;
  error?: string;
  data: AgentTaskResultData;
  metadata: TaskResultMetadata;
}

type AgentTaskResultData =
  | ClaimExtractionResult
  | VerificationResultData
  | ClaimClassificationResult
  | FixGenerationResult
  | PostCheckResult
  | FeedbackInterpretationResult;

interface ClaimExtractionResult {
  type: 'claim_extraction';
  claims: Array<{
    claim_text: string;
    claim_type: ClaimType;
    source_file: string;
    source_line: number;
    confidence: number;
    keywords?: string[];
    extracted_value?: unknown;
  }>;
}

interface VerificationResultData {
  type: 'verification';
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  evidence_files: string[];
  specific_mismatch?: string | null;
  suggested_fix?: string | null;
  rule_fixes?: Array<{
    rule_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    reason: string;
  }>;
}

interface ClaimClassificationResult {
  type: 'claim_classification';
  classification: VagueClaimClassification;
  static_rule?: {
    scope: string;
    scope_exclude?: string[];
    checks: Array<{ type: string; [key: string]: unknown }>;
  };
  sub_claims?: Array<{
    sub_claim_text: string;
    expected_evidence_type: string;
    search_hints: string[];
  }>;
  untestable_reason?: string;
  reasoning: string;
}

interface PostCheckResult {
  type: 'post_check';
  outcome: 'confirmed' | 'contradicted';
  reasoning: string;
}

interface FixGenerationResult {
  type: 'fix_generation';
  suggested_fix: {
    file_path: string;
    line_start: number;
    line_end: number;
    new_text: string;
    explanation: string;
  };
}

interface FeedbackInterpretationResult {
  type: 'feedback_interpretation';
  actions: Array<{
    action_type: 'suppress_claim' | 'suppress_file' | 'suppress_type' | 'update_rule' | 'suggest_doc_update' | 'no_action';
    target_id?: string;
    target_path?: string;
    duration_days?: number;
    reason: string;
    details?: Record<string, unknown>;
  }>;
}

interface TaskResultMetadata {
  duration_ms: number;
  model_used?: string;
  tokens_used?: number;
  cost_usd?: number;
}
```

---

## 11. Infrastructure & Server API Contracts

### 11.1 Repository Dispatch Payload

```typescript
interface RepositoryDispatchPayload {
  repo_id: string;
  scan_run_id: string;
  scan_type: ScanType;
  trigger_ref: string;          // PR number or commit SHA
  task_ids: string[];
}
```

### 11.2 Webhook Payloads (consumed types)

```typescript
interface PRWebhookPayload {
  action: 'opened' | 'synchronize' | 'closed';
  number: number;
  pull_request: {
    head: { sha: string; ref: string };
    base: { ref: string };
  };
  repository: {
    id: number;
    full_name: string;
    owner: { login: string };
    name: string;
  };
  installation: { id: number };
}

interface PushWebhookPayload {
  ref: string;
  after: string;
  before: string;
  commits: Array<{
    id: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
  };
  installation: { id: number };
}

interface InstallationCreatedPayload {
  action: 'created';
  installation: {
    id: number;
    account: { login: string; type: 'User' | 'Organization' };
  };
  repositories: Array<{
    id: number;
    full_name: string;
    private: boolean;
  }>;
}
```

### 11.3 Server API Responses

```typescript
// GET /api/tasks/pending
interface TaskListResponse {
  tasks: Array<{
    id: string;
    type: AgentTaskType;
    status: AgentTaskStatus;
    created_at: string;
    expires_at: string;
  }>;
}

// GET /api/tasks/{id} (claim + return)
interface TaskDetailResponse extends AgentTask {
  // Full task including payload
}

// POST /api/tasks/{id}/result
interface TaskResultResponse {
  status: 'accepted';
  task_id: string;
}

// Error responses
interface APIErrorResponse {
  error: string;              // DOCALIGN_E{category}{seq} code
  message: string;
  details?: unknown;          // Zod errors for validation failures
}

// GET /health
interface HealthResponse {
  status: 'ok' | 'degraded';
  redis: boolean;
  queue_depth: number;
  active_jobs: number;
  waiting_jobs: number;
  uptime_seconds: number;
}

// GET /api/dismiss
interface DismissEndpoint {
  // Query params: token (HMAC signed), claim_id, scan_run_id
  // Returns: redirect to PR page
}
```

### 11.4 DOCALIGN_TOKEN

```typescript
// Token format (XREF-001): "docalign_" + crypto.randomBytes(32).toString('hex')
// Server stores SHA-256(token) in repos.token_hash
// Token validation: hash incoming token, compare to stored hash, check repo_id match

interface TokenValidation {
  generateRepoToken(): { token: string; hash: string };
  validateToken(token: string, repoId: string): Promise<boolean>;
}
```

---

## 12. Database Row Types

These map 1:1 to PostgreSQL tables. Column names use snake_case. Application types above use camelCase. Mapping between them is handled by a thin data access layer.

```typescript
// repos
interface RepoRow {
  id: string;
  github_owner: string;
  github_repo: string;
  github_installation_id: number;
  default_branch: string;
  status: RepoStatus;
  last_indexed_commit: string | null;
  last_full_scan_at: Date | null;
  config: Record<string, unknown>;   // JSONB
  health_score: number | null;
  total_claims: number;
  verified_claims: number;
  token_hash: string | null;         // SHA-256 of DOCALIGN_TOKEN
  created_at: Date;
  updated_at: Date;
}

// code_entities
interface CodeEntityRow {
  id: string;
  repo_id: string;
  file_path: string;
  line_number: number;
  end_line_number: number;
  entity_type: EntityType;
  name: string;
  signature: string | null;
  raw_code: string | null;
  embedding: number[] | null;        // VECTOR(1536)
  last_commit_sha: string | null;
  created_at: Date;
  updated_at: Date;
}

// claims
interface ClaimRow {
  id: string;
  repo_id: string;
  source_file: string;
  line_number: number;
  claim_text: string;
  claim_type: ClaimType;
  testability: Testability;
  extracted_value: Record<string, unknown>; // JSONB
  keywords: string[];                       // TEXT[]
  extraction_confidence: number;
  extraction_method: ExtractionMethod;
  verification_status: string;              // 'pending' | Verdict
  last_verified_at: Date | null;
  embedding: number[] | null;
  last_verification_result_id: string | null;
  parent_claim_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// claim_mappings
interface ClaimMappingRow {
  id: string;
  claim_id: string;
  repo_id: string;
  code_file: string;
  code_entity_id: string | null;
  confidence: number;
  co_change_boost: number;           // REAL, default 0.0
  mapping_method: MappingMethod;
  created_at: Date;
  last_validated_at: Date;
}

// verification_results
interface VerificationResultRow {
  id: string;
  claim_id: string;
  repo_id: string;
  scan_run_id: string | null;
  verdict: Verdict;
  confidence: number;
  tier: number;
  severity: Severity | null;
  reasoning: string | null;
  specific_mismatch: string | null;
  suggested_fix: string | null;
  evidence_files: string[];          // TEXT[]
  token_cost: number | null;
  duration_ms: number | null;
  post_check_result: PostCheckOutcome | null;
  verification_path: VerificationPath | null;
  created_at: Date;
}

// scan_runs
interface ScanRunRow {
  id: string;
  repo_id: string;
  trigger_type: TriggerType;
  trigger_ref: string | null;
  status: ScanStatus;
  commit_sha: string;
  claims_checked: number;
  claims_drifted: number;
  claims_verified: number;
  claims_uncertain: number;
  total_token_cost: number;
  total_duration_ms: number;
  comment_posted: boolean;
  check_run_id: number | null;
  started_at: Date;
  completed_at: Date | null;
}

// agent_tasks
interface AgentTaskRow {
  id: string;
  repo_id: string;
  scan_run_id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  payload: Record<string, unknown>; // JSONB
  claimed_by: string | null;
  error: string | null;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
}

// feedback
interface FeedbackRow {
  id: string;
  repo_id: string;
  claim_id: string;
  verification_result_id: string | null;
  feedback_type: FeedbackType;
  quick_pick_reason: QuickPickReason | null;
  free_text: string | null;
  github_user: string | null;
  pr_number: number | null;
  created_at: Date;
}

// co_changes
interface CoChangeRow {
  id: string;
  repo_id: string;
  code_file: string;
  doc_file: string;
  commit_sha: string;
  committed_at: Date;
  created_at: Date;
}

// suppression_rules
interface SuppressionRuleRow {
  id: string;
  repo_id: string;
  scope: SuppressionScope;
  target_claim_id: string | null;
  target_file: string | null;
  target_claim_type: ClaimType | null;
  target_pattern: string | null;
  reason: string;
  source: string;
  expires_at: Date | null;
  revoked: boolean;
  created_at: Date;
}

// agent_drift_reports (v2/v3)
interface AgentDriftReportRow {
  id: string;
  repo_id: string;
  claim_id: string | null;
  doc_file: string;
  line_number: number | null;
  claim_text: string;
  actual_behavior: string;
  evidence_files: string[];
  agent_type: string | null;
  verification_status: string;
  created_at: Date;
}
```

---

## 13. Error Types

```typescript
interface DocAlignError {
  code: string;              // e.g., "DOCALIGN_E101"
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  userMessage?: string;
  context: {
    repoId?: string;
    scanRunId?: string;
    claimId?: string;
    taskId?: string;
    prNumber?: number;
  };
  cause?: Error;
  retryable: boolean;
  timestamp: string;         // ISO 8601
}

// Error code categories (from 3C Section 2):
// E1xx = GitHub API Errors
// E2xx = Agent Task Errors
// E3xx = Database Errors
// E4xx = Internal Logic Errors
// E5xx = Configuration Errors
// E6xx = Redis / Queue Errors
```

---

## 14. Configuration Types

```typescript
/** Parsed .docalign.yml structure */
interface DocAlignConfig {
  doc_patterns?: {
    include?: string[];
    exclude?: string[];
  };
  code_patterns?: {
    include?: string[];
    exclude?: string[];
  };
  verification?: {
    min_severity?: Severity;
    max_claims_per_pr?: number;      // default 50, hard cap 200
    auto_fix?: boolean;
    auto_fix_threshold?: number;
  };
  claim_types?: Partial<Record<ClaimType, boolean>>;
  suppress?: Array<{
    file?: string;
    pattern?: string;
    claim_type?: ClaimType;
    package?: string;
  }>;
  schedule?: {
    full_scan?: 'daily' | 'weekly' | 'monthly' | 'never';
    full_scan_day?: string;
  };
  agent?: {
    concurrency?: number;            // default 5, max 20
    timeout_seconds?: number;        // default 120
    command?: string;                 // custom agent command
  };
  llm?: {
    verification_model?: string;     // default "claude-sonnet-4-20250514"
    extraction_model?: string;
    embedding_model?: string;        // default "text-embedding-3-small"
    embedding_dimensions?: number;   // default 1536
  };
  check?: {
    min_severity_to_block?: Severity; // default "high"
  };
  mapping?: {
    semantic_threshold?: number;     // default 0.7
    path1_max_evidence_tokens?: number; // default 4000
    max_agent_files_per_claim?: number; // default 15
  };
}
```

---

## 15. Cross-Layer Function Call Index

Every cross-layer function call in the system, with caller and callee.

| Caller | Callee | Function | When |
|--------|--------|----------|------|
| L4 (Worker) | L0 | `updateFromDiff(repoId, changedFiles)` | PR/push scan: index update |
| L4 (Worker) | L1 | `reExtract(repoId, docFile, content)` | Doc file changed in PR |
| L4 (Worker) | L1 | `deleteClaimsForFile(repoId, docFile)` | Doc file deleted in PR |
| L4 (Worker) | L2 | `findClaimsByCodeFiles(repoId, codeFiles)` | Reverse index lookup |
| L4 (Worker) | L2 | `mapClaim(repoId, claim)` | New claims need mapping |
| L4 (Worker) | L2 | `updateCodeFilePaths(repoId, renames)` | File renames in diff |
| L4 (Worker) | L2 | `removeMappingsForFiles(repoId, files)` | File deletions in diff |
| L4 (Worker) | L3 | `verifyDeterministic(claim, mappings)` | Tiers 1-2 server-side |
| L4 (Worker) | L3 | `routeClaim(claim, mappings)` | Routing decision before task creation |
| L4 (Worker) | L3 | `buildPath1Evidence(claim, mappings)` | Build evidence for Path 1 tasks |
| L4 (Worker) | L3 | `mergeResults(scanRunId)` | After all agent tasks complete |
| L4 (Worker) | L5 | `postPRComment(owner, repo, prNumber, payload, installationId)` | Post findings |
| L4 (Worker) | L5 | `markResolved(...)` | Mark old comments resolved |
| L4 (Worker) | L5 | `calculateHealthScore(repoId)` | Update cached health score |
| L4 (Worker) | L7 | `isClaimSuppressed(claim)` | Filter suppressed claims before verification |
| L4 (Worker) | L7 | `recordCoChanges(repoId, codeFiles, docFiles, sha)` | Push scan: track co-changes |
| L2 | L0 | `fileExists(repoId, path)` | Step 1: direct reference |
| L2 | L0 | `findSymbol(repoId, name)` | Step 2: symbol search |
| L2 | L0 | `searchSemantic(repoId, query, topK)` | Step 3: semantic search |
| L2 | L0 | `findRoute(repoId, method, path)` | Step 1: route mapping |
| L2 | L0 | `getDependencyVersion(repoId, pkg)` | Step 1: dependency mapping |
| L2 | L0 | `scriptExists(repoId, name)` | Step 1: command mapping |
| L2 | L7 | `getCoChangeBoost(repoId, codeFile, docFile)` | Boost mapping confidence |
| L3 | L0 | `findSymbol(repoId, name)` | Tier 2: pattern verification |
| L3 | L0 | `fileExists(repoId, path)` | Tier 1: path verification |
| L3 | L0 | `getDependencyVersion(repoId, pkg)` | Tier 1: version verification |
| L3 | L0 | `findRoute(repoId, method, path)` | Tier 1: route verification |
| L3 | L0 | `scriptExists(repoId, name)` | Tier 1: command verification |
| L3 | L0 | `getEntityByFile(repoId, file)` | Build Path 1 evidence |
| L5 | L7 | `isClaimSuppressed(claim)` | Filter before formatting |
| L7 | L1 | `updateVerificationStatus(claimId, status)` | After count-based exclusion |
| API | L4 | `enqueuePRScan(...)` | Webhook → job |
| API | L4 | `enqueuePushScan(...)` | Webhook → job |
| API | L4 | `enqueueFullScan(...)` | Installation → job |

---

## 16. Versioning and Stability

- This file is **frozen** before TDD authoring begins. Changes require Technical Architect approval and notification to all active TDD authors.
- Types use the `interface` keyword (not `type`) for named structures to enable extension in TDDs.
- TDDs may add layer-internal types but must NOT redefine any type in this file.
- If a TDD author finds this file insufficient, they MUST propose the addition via `phases/phase4-decisions.md` BEFORE using a custom type.
