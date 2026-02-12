// === Shared Enums and Literals (phase4-api-contracts.md Section 1) ===

export type ClaimType =
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

export type Testability = 'syntactic' | 'semantic' | 'untestable';

export type ExtractionMethod = 'regex' | 'heuristic' | 'llm';

export type Verdict = 'verified' | 'drifted' | 'uncertain';

export type Severity = 'high' | 'medium' | 'low';

export type VerificationPath = 1 | 2;

export type PostCheckOutcome = 'confirmed' | 'contradicted' | 'skipped';

export type MappingMethod =
  | 'direct_reference'
  | 'symbol_search'
  | 'semantic_search'
  | 'llm_assisted'
  | 'manual'
  | 'co_change';

export type ScanType = 'pr' | 'full' | 'push';

export type TriggerType = 'pr' | 'push' | 'scheduled' | 'manual' | 'agent_report';

export type ScanStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export type RepoStatus = 'onboarding' | 'awaiting_setup' | 'scanning' | 'active' | 'partial' | 'error';

export type AgentTaskType =
  | 'claim_extraction'
  | 'verification'
  | 'claim_classification'
  | 'fix_generation'
  | 'post_check'
  | 'feedback_interpretation';

export type AgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'expired';

export type FeedbackType =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'fix_accepted'
  | 'fix_dismissed'
  | 'all_dismissed';

export type QuickPickReason =
  | 'not_relevant_to_this_file'
  | 'intentionally_different'
  | 'will_fix_later'
  | 'docs_are_aspirational'
  | 'this_is_correct';

export type SuppressionScope = 'claim' | 'file' | 'claim_type' | 'pattern';

export type EntityType = 'function' | 'class' | 'route' | 'type' | 'config';

// === Database Row Types (phase4-api-contracts.md Section 12) ===

export interface RepoRow {
  id: string;
  github_owner: string;
  github_repo: string;
  github_installation_id: number;
  default_branch: string;
  status: RepoStatus;
  last_indexed_commit: string | null;
  last_full_scan_at: Date | null;
  config: Record<string, unknown>;
  health_score: number | null;
  total_claims: number;
  verified_claims: number;
  token_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ScanRunRow {
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
  created_at: Date;
}

export interface AgentTaskRow {
  id: string;
  repo_id: string;
  scan_run_id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  payload: Record<string, unknown>;
  claimed_by: string | null;
  error: string | null;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
}

// === API Response Types (phase4-api-contracts.md Section 11.3) ===

export interface HealthResponse {
  status: 'ok' | 'degraded';
  redis: boolean;
  queue_depth: number;
  active_jobs: number;
  waiting_jobs: number;
  uptime_seconds: number;
}

export interface TaskListResponse {
  tasks: Array<{
    id: string;
    type: AgentTaskType;
    status: AgentTaskStatus;
    created_at: string;
    expires_at: string;
  }>;
}

export interface TaskDetailResponse {
  id: string;
  repo_id: string;
  scan_run_id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  payload: Record<string, unknown>;
  claimed_by: string | null;
  error: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

export interface TaskResultResponse {
  status: 'accepted';
  task_id: string;
}

export interface APIErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

// === Webhook Payload Types (phase4-api-contracts.md Section 11.2) ===

export interface PRWebhookPayload {
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

export interface PushWebhookPayload {
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

export interface InstallationCreatedPayload {
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

// === Error Type (phase4-api-contracts.md Section 13) ===

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ErrorContext {
  repoId?: string;
  scanRunId?: string;
  claimId?: string;
  taskId?: string;
  prNumber?: number;
}

export class DocAlignError extends Error {
  readonly code: string;
  readonly severity: ErrorSeverity;
  readonly userMessage?: string;
  readonly context: ErrorContext;
  readonly cause?: Error;
  readonly retryable: boolean;
  readonly timestamp: string;

  constructor(opts: {
    code: string;
    severity: ErrorSeverity;
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    cause?: Error;
    retryable?: boolean;
  }) {
    super(opts.message);
    this.name = 'DocAlignError';
    this.code = opts.code;
    this.severity = opts.severity;
    this.userMessage = opts.userMessage;
    this.context = opts.context ?? {};
    this.cause = opts.cause;
    this.retryable = opts.retryable ?? false;
    this.timestamp = new Date().toISOString();
  }
}

// === Server Configuration (TDD-Infra §3) ===

export interface ServerConfig {
  port: number;
  node_env: string;
  log_level: string;
  github_app_id: string;
  github_private_key: string;
  github_webhook_secret: string;
  github_webhook_secret_old?: string;
  database_url: string;
  redis_url: string;
  docalign_api_secret: string;
  docalign_token_ttl_days: number;
  scan_timeout_minutes: number;
  agent_task_timeout_minutes: number;
  retry_per_call_max: number;
  retry_per_job_max: number;
}

// === DocAlign Config (.docalign.yml) (phase4-api-contracts.md Section 14) ===

export interface DocAlignConfig {
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
    max_claims_per_pr?: number;
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
    concurrency?: number;
    timeout_seconds?: number;
    command?: string;
  };
  llm?: {
    verification_model?: string;
    extraction_model?: string;
    embedding_model?: string;
    embedding_dimensions?: number;
  };
  check?: {
    min_severity_to_block?: Severity;
  };
  mapping?: {
    semantic_threshold?: number;
    path1_max_evidence_tokens?: number;
    max_agent_files_per_claim?: number;
  };
}
