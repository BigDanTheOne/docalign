import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('scan_runs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    repo_id: {
      type: 'uuid',
      notNull: true,
      references: 'repos(id)',
      onDelete: 'CASCADE',
    },
    trigger_type: {
      type: 'text',
      notNull: true,
      check: "trigger_type IN ('pr','push','scheduled','manual','agent_report')",
    },
    trigger_ref: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'queued',
      check: "status IN ('queued','running','completed','partial','failed','cancelled')",
    },
    commit_sha: { type: 'text', notNull: true },
    claims_checked: { type: 'integer', notNull: true, default: 0 },
    claims_drifted: { type: 'integer', notNull: true, default: 0 },
    claims_verified: { type: 'integer', notNull: true, default: 0 },
    claims_uncertain: { type: 'integer', notNull: true, default: 0 },
    total_token_cost: { type: 'integer', notNull: true, default: 0 },
    total_duration_ms: { type: 'integer', notNull: true, default: 0 },
    comment_posted: { type: 'boolean', notNull: true, default: false },
    check_run_id: { type: 'bigint' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Indexes per Appendix A.2
  pgm.createIndex('scan_runs', 'repo_id');
  pgm.createIndex('scan_runs', 'status', {
    where: "status IN ('queued','running')",
    name: 'scan_runs_active_status_idx',
  });
  pgm.createIndex('scan_runs', ['repo_id', 'trigger_type', { name: 'started_at', sort: 'DESC' }], {
    name: 'scan_runs_repo_trigger_started_idx',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('scan_runs', { cascade: true });
}
