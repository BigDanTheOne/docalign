import type { DatabaseClient } from './db';
import type {
  StorageAdapter,
  CreateRepoData,
  UpdateRepoData,
  CreateScanRunData,
  UpdateScanRunData,
  CreateAgentTaskData,
  UpdateAgentTaskData,
} from './storage-adapter';
import type { RepoRow, ScanRunRow, AgentTaskRow } from './types';

export class PostgresAdapter implements StorageAdapter {
  constructor(private readonly db: DatabaseClient) {}

  // === Repos ===

  async createRepo(data: CreateRepoData): Promise<RepoRow> {
    const result = await this.db.query<RepoRow>(
      `INSERT INTO repos (
        github_owner, github_repo, github_installation_id,
        default_branch, status, token_hash, config
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        data.github_owner,
        data.github_repo,
        data.github_installation_id,
        data.default_branch ?? 'main',
        data.status ?? 'onboarding',
        data.token_hash ?? null,
        JSON.stringify(data.config ?? {}),
      ],
    );
    return result.rows[0];
  }

  async getRepoById(id: string): Promise<RepoRow | null> {
    const result = await this.db.query<RepoRow>(
      'SELECT * FROM repos WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getRepoByOwnerAndName(owner: string, repo: string): Promise<RepoRow | null> {
    const result = await this.db.query<RepoRow>(
      'SELECT * FROM repos WHERE github_owner = $1 AND github_repo = $2',
      [owner, repo],
    );
    return result.rows[0] ?? null;
  }

  async updateRepo(id: string, data: UpdateRepoData): Promise<RepoRow | null> {
    const { setClauses, values } = buildUpdateClauses(data, {
      config: (v) => JSON.stringify(v),
    });
    if (setClauses.length === 0) return this.getRepoById(id);

    setClauses.push(`updated_at = NOW()`);
    const idx = values.length + 1;
    values.push(id);

    const result = await this.db.query<RepoRow>(
      `UPDATE repos SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async deleteRepo(id: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM repos WHERE id = $1',
      [id],
    );
    return result.rowCount > 0;
  }

  // === Scan Runs ===

  async createScanRun(data: CreateScanRunData): Promise<ScanRunRow> {
    const result = await this.db.query<ScanRunRow>(
      `INSERT INTO scan_runs (
        repo_id, trigger_type, trigger_ref, commit_sha, status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        data.repo_id,
        data.trigger_type,
        data.trigger_ref ?? null,
        data.commit_sha,
        data.status ?? 'queued',
      ],
    );
    return result.rows[0];
  }

  async getScanRunById(id: string): Promise<ScanRunRow | null> {
    const result = await this.db.query<ScanRunRow>(
      'SELECT * FROM scan_runs WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async updateScanRun(id: string, data: UpdateScanRunData): Promise<ScanRunRow | null> {
    const { setClauses, values } = buildUpdateClauses(data);
    if (setClauses.length === 0) return this.getScanRunById(id);

    const idx = values.length + 1;
    values.push(id);

    const result = await this.db.query<ScanRunRow>(
      `UPDATE scan_runs SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async deleteScanRun(id: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM scan_runs WHERE id = $1',
      [id],
    );
    return result.rowCount > 0;
  }

  // === Agent Tasks ===

  async createAgentTask(data: CreateAgentTaskData): Promise<AgentTaskRow> {
    const result = await this.db.query<AgentTaskRow>(
      `INSERT INTO agent_tasks (
        repo_id, scan_run_id, type, payload, expires_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        data.repo_id,
        data.scan_run_id,
        data.type,
        JSON.stringify(data.payload),
        data.expires_at,
        data.status ?? 'pending',
      ],
    );
    return result.rows[0];
  }

  async getAgentTaskById(id: string): Promise<AgentTaskRow | null> {
    const result = await this.db.query<AgentTaskRow>(
      'SELECT * FROM agent_tasks WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async updateAgentTask(id: string, data: UpdateAgentTaskData): Promise<AgentTaskRow | null> {
    const { setClauses, values } = buildUpdateClauses(data);
    if (setClauses.length === 0) return this.getAgentTaskById(id);

    const idx = values.length + 1;
    values.push(id);

    const result = await this.db.query<AgentTaskRow>(
      `UPDATE agent_tasks SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async deleteAgentTask(id: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM agent_tasks WHERE id = $1',
      [id],
    );
    return result.rowCount > 0;
  }
}

// === Helpers ===

function buildUpdateClauses<T extends object>(
  data: T,
  transforms?: Partial<Record<keyof T & string, (v: unknown) => unknown>>,
): { setClauses: string[]; values: unknown[] } {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const transform = transforms?.[key as keyof T & string];
    const finalValue = transform ? transform(value) : value;
    setClauses.push(`${key} = $${paramIdx}`);
    values.push(finalValue);
    paramIdx++;
  }

  return { setClauses, values };
}
