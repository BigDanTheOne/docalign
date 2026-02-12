import type {
  RepoRow,
  RepoStatus,
  ScanRunRow,
  ScanStatus,
  AgentTaskRow,
  AgentTaskStatus,
  AgentTaskType,
  TriggerType,
} from './types';

// === Create data types (fields without auto-generated defaults) ===

export interface CreateRepoData {
  github_owner: string;
  github_repo: string;
  github_installation_id: number;
  default_branch?: string;
  status?: RepoStatus;
  token_hash?: string | null;
  config?: Record<string, unknown>;
}

export interface CreateScanRunData {
  repo_id: string;
  trigger_type: TriggerType;
  trigger_ref?: string | null;
  commit_sha: string;
  status?: ScanStatus;
}

export interface CreateAgentTaskData {
  repo_id: string;
  scan_run_id: string;
  type: AgentTaskType;
  payload: Record<string, unknown>;
  expires_at: Date;
  status?: AgentTaskStatus;
}

// === Update data types ===

export interface UpdateRepoData {
  github_owner?: string;
  github_repo?: string;
  github_installation_id?: number;
  default_branch?: string;
  status?: RepoStatus;
  last_indexed_commit?: string | null;
  last_full_scan_at?: Date | null;
  config?: Record<string, unknown>;
  health_score?: number | null;
  total_claims?: number;
  verified_claims?: number;
  token_hash?: string | null;
}

export interface UpdateScanRunData {
  status?: ScanStatus;
  trigger_ref?: string | null;
  claims_checked?: number;
  claims_drifted?: number;
  claims_verified?: number;
  claims_uncertain?: number;
  total_token_cost?: number;
  total_duration_ms?: number;
  comment_posted?: boolean;
  check_run_id?: number | null;
  started_at?: Date | null;
  completed_at?: Date | null;
}

export interface UpdateAgentTaskData {
  status?: AgentTaskStatus;
  claimed_by?: string | null;
  error?: string | null;
  expires_at?: Date;
  completed_at?: Date | null;
}

// === StorageAdapter interface ===

export interface StorageAdapter {
  // Repos
  createRepo(data: CreateRepoData): Promise<RepoRow>;
  getRepoById(id: string): Promise<RepoRow | null>;
  updateRepo(id: string, data: UpdateRepoData): Promise<RepoRow | null>;
  deleteRepo(id: string): Promise<boolean>;

  // Scan Runs
  createScanRun(data: CreateScanRunData): Promise<ScanRunRow>;
  getScanRunById(id: string): Promise<ScanRunRow | null>;
  updateScanRun(id: string, data: UpdateScanRunData): Promise<ScanRunRow | null>;
  deleteScanRun(id: string): Promise<boolean>;

  // Agent Tasks
  createAgentTask(data: CreateAgentTaskData): Promise<AgentTaskRow>;
  getAgentTaskById(id: string): Promise<AgentTaskRow | null>;
  updateAgentTask(id: string, data: UpdateAgentTaskData): Promise<AgentTaskRow | null>;
  deleteAgentTask(id: string): Promise<boolean>;
}
