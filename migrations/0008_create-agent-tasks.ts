import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('agent_tasks', {
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
    scan_run_id: {
      type: 'uuid',
      notNull: true,
      references: 'scan_runs(id)',
      onDelete: 'CASCADE',
    },
    type: {
      type: 'text',
      notNull: true,
      check: "type IN ('claim_extraction','verification','claim_classification','fix_generation','post_check','feedback_interpretation')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','in_progress','completed','failed','expired')",
    },
    payload: { type: 'jsonb', notNull: true },
    claimed_by: { type: 'text' },
    error: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    completed_at: { type: 'timestamptz' },
  });

  // Indexes per Appendix A.7
  pgm.createIndex('agent_tasks', ['repo_id', 'status'], {
    where: "status = 'pending'",
    name: 'agent_tasks_pending_idx',
  });
  pgm.createIndex('agent_tasks', 'scan_run_id');
  pgm.createIndex('agent_tasks', 'expires_at', {
    where: "status IN ('pending','in_progress')",
    name: 'agent_tasks_expiry_idx',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('agent_tasks', { cascade: true });
}
