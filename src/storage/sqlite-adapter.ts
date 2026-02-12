import Database from 'better-sqlite3';
import crypto from 'crypto';
import type {
  StorageAdapter,
  CreateRepoData,
  UpdateRepoData,
  CreateScanRunData,
  UpdateScanRunData,
  CreateAgentTaskData,
  UpdateAgentTaskData,
} from '../shared/storage-adapter';
import type { RepoRow, ScanRunRow, AgentTaskRow } from '../shared/types';

/**
 * SQLite implementation of StorageAdapter using better-sqlite3.
 * Designed for CLI / embedded mode. Uses in-memory DB for tests.
 */
export class SqliteAdapter implements StorageAdapter {
  readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        github_owner TEXT NOT NULL,
        github_repo TEXT NOT NULL,
        github_installation_id INTEGER NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'onboarding',
        last_indexed_commit TEXT,
        last_full_scan_at TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        health_score REAL,
        total_claims INTEGER NOT NULL DEFAULT 0,
        verified_claims INTEGER NOT NULL DEFAULT 0,
        token_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(github_owner, github_repo)
      );

      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        trigger_type TEXT NOT NULL,
        trigger_ref TEXT,
        commit_sha TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        claims_checked INTEGER NOT NULL DEFAULT 0,
        claims_drifted INTEGER NOT NULL DEFAULT 0,
        claims_verified INTEGER NOT NULL DEFAULT 0,
        claims_uncertain INTEGER NOT NULL DEFAULT 0,
        total_token_cost REAL NOT NULL DEFAULT 0,
        total_duration_ms INTEGER NOT NULL DEFAULT 0,
        comment_posted INTEGER NOT NULL DEFAULT 0,
        check_run_id INTEGER,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL DEFAULT '{}',
        claimed_by TEXT,
        error TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // === Repos ===

  async createRepo(data: CreateRepoData): Promise<RepoRow> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO repos (id, github_owner, github_repo, github_installation_id,
        default_branch, status, token_hash, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.github_owner,
      data.github_repo,
      data.github_installation_id,
      data.default_branch ?? 'main',
      data.status ?? 'onboarding',
      data.token_hash ?? null,
      JSON.stringify(data.config ?? {}),
      now,
      now,
    );

    return this.getRepoById(id) as Promise<RepoRow>;
  }

  async getRepoById(id: string): Promise<RepoRow | null> {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as SqliteRepoRow | undefined;
    return row ? mapRepoRow(row) : null;
  }

  async updateRepo(id: string, data: UpdateRepoData): Promise<RepoRow | null> {
    const { setClauses, values } = buildSqliteUpdateClauses(data, {
      config: (v) => JSON.stringify(v),
      last_full_scan_at: (v) => v instanceof Date ? v.toISOString() : v,
    });
    if (setClauses.length === 0) return this.getRepoById(id);

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(
      `UPDATE repos SET ${setClauses.join(', ')} WHERE id = ?`,
    ).run(...values);

    return this.getRepoById(id);
  }

  async deleteRepo(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM repos WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // === Scan Runs ===

  async createScanRun(data: CreateScanRunData): Promise<ScanRunRow> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO scan_runs (id, repo_id, trigger_type, trigger_ref, commit_sha, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.repo_id,
      data.trigger_type,
      data.trigger_ref ?? null,
      data.commit_sha,
      data.status ?? 'queued',
      now,
    );

    return this.getScanRunById(id) as Promise<ScanRunRow>;
  }

  async getScanRunById(id: string): Promise<ScanRunRow | null> {
    const row = this.db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(id) as SqliteScanRunRow | undefined;
    return row ? mapScanRunRow(row) : null;
  }

  async updateScanRun(id: string, data: UpdateScanRunData): Promise<ScanRunRow | null> {
    const { setClauses, values } = buildSqliteUpdateClauses(data, {
      started_at: (v) => v instanceof Date ? v.toISOString() : v,
      completed_at: (v) => v instanceof Date ? v.toISOString() : v,
    });
    if (setClauses.length === 0) return this.getScanRunById(id);

    values.push(id);

    this.db.prepare(
      `UPDATE scan_runs SET ${setClauses.join(', ')} WHERE id = ?`,
    ).run(...values);

    return this.getScanRunById(id);
  }

  async deleteScanRun(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM scan_runs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // === Agent Tasks ===

  async createAgentTask(data: CreateAgentTaskData): Promise<AgentTaskRow> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO agent_tasks (id, repo_id, scan_run_id, type, payload, expires_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.repo_id,
      data.scan_run_id,
      data.type,
      JSON.stringify(data.payload),
      data.expires_at.toISOString(),
      data.status ?? 'pending',
      now,
    );

    return this.getAgentTaskById(id) as Promise<AgentTaskRow>;
  }

  async getAgentTaskById(id: string): Promise<AgentTaskRow | null> {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as SqliteAgentTaskRow | undefined;
    return row ? mapAgentTaskRow(row) : null;
  }

  async updateAgentTask(id: string, data: UpdateAgentTaskData): Promise<AgentTaskRow | null> {
    const { setClauses, values } = buildSqliteUpdateClauses(data, {
      expires_at: (v) => v instanceof Date ? v.toISOString() : v,
      completed_at: (v) => v instanceof Date ? v.toISOString() : v,
    });
    if (setClauses.length === 0) return this.getAgentTaskById(id);

    values.push(id);

    this.db.prepare(
      `UPDATE agent_tasks SET ${setClauses.join(', ')} WHERE id = ?`,
    ).run(...values);

    return this.getAgentTaskById(id);
  }

  async deleteAgentTask(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

// === Internal row types (SQLite stores dates as TEXT, booleans as INTEGER) ===

interface SqliteRepoRow {
  id: string;
  github_owner: string;
  github_repo: string;
  github_installation_id: number;
  default_branch: string;
  status: string;
  last_indexed_commit: string | null;
  last_full_scan_at: string | null;
  config: string;
  health_score: number | null;
  total_claims: number;
  verified_claims: number;
  token_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface SqliteScanRunRow {
  id: string;
  repo_id: string;
  trigger_type: string;
  trigger_ref: string | null;
  commit_sha: string;
  status: string;
  claims_checked: number;
  claims_drifted: number;
  claims_verified: number;
  claims_uncertain: number;
  total_token_cost: number;
  total_duration_ms: number;
  comment_posted: number;
  check_run_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface SqliteAgentTaskRow {
  id: string;
  repo_id: string;
  scan_run_id: string;
  type: string;
  status: string;
  payload: string;
  claimed_by: string | null;
  error: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

// === Row mappers (SQLite TEXT → proper types) ===

function mapRepoRow(row: SqliteRepoRow): RepoRow {
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as unknown as RepoRow;
}

function mapScanRunRow(row: SqliteScanRunRow): ScanRunRow {
  return {
    ...row,
    comment_posted: Boolean(row.comment_posted),
  } as unknown as ScanRunRow;
}

function mapAgentTaskRow(row: SqliteAgentTaskRow): AgentTaskRow {
  return {
    ...row,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
  } as unknown as AgentTaskRow;
}

// === Helpers ===

function buildSqliteUpdateClauses<T extends object>(
  data: T,
  transforms?: Partial<Record<string, (v: unknown) => unknown>>,
): { setClauses: string[]; values: unknown[] } {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const transform = transforms?.[key];
    const finalValue = transform ? transform(value) : value;
    setClauses.push(`${key} = ?`);
    values.push(finalValue);
  }

  return { setClauses, values };
}
