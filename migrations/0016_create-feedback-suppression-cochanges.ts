import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // === feedback table ===
  pgm.createTable('feedback', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    repo_id: { type: 'uuid', notNull: true, references: 'repos(id)', onDelete: 'CASCADE' },
    claim_id: { type: 'uuid', notNull: true },
    verification_result_id: { type: 'uuid' },
    feedback_type: {
      type: 'text',
      notNull: true,
      check: "feedback_type IN ('thumbs_up','thumbs_down','fix_accepted','fix_dismissed','all_dismissed')",
    },
    quick_pick_reason: {
      type: 'text',
      check:
        "quick_pick_reason IN ('not_relevant_to_this_file','intentionally_different','will_fix_later','docs_are_aspirational','this_is_correct')",
    },
    free_text: { type: 'text' },
    github_user: { type: 'text' },
    pr_number: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('feedback', 'claim_id');
  pgm.createIndex('feedback', ['repo_id', 'claim_id']);
  pgm.createIndex('feedback', ['claim_id', 'feedback_type']);

  // === suppression_rules table ===
  pgm.createTable('suppression_rules', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    repo_id: { type: 'uuid', notNull: true, references: 'repos(id)', onDelete: 'CASCADE' },
    scope: {
      type: 'text',
      notNull: true,
      check: "scope IN ('claim','file','claim_type','pattern')",
    },
    target_claim_id: { type: 'uuid' },
    target_file: { type: 'text' },
    target_claim_type: { type: 'text' },
    target_pattern: { type: 'text' },
    reason: { type: 'text', notNull: true },
    source: {
      type: 'text',
      notNull: true,
      check: "source IN ('quick_pick','count_based','agent_interpreted')",
    },
    expires_at: { type: 'timestamptz' },
    revoked: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('suppression_rules', ['repo_id', 'scope', 'target_claim_id'], {
    where: 'revoked = false',
    name: 'idx_suppression_repo_claim',
  });
  pgm.createIndex('suppression_rules', ['repo_id', 'scope', 'target_file'], {
    where: 'revoked = false',
    name: 'idx_suppression_repo_file',
  });
  pgm.createIndex('suppression_rules', ['repo_id', 'scope', 'target_claim_type'], {
    where: 'revoked = false',
    name: 'idx_suppression_repo_type',
  });

  // === co_changes table ===
  pgm.createTable('co_changes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    repo_id: { type: 'uuid', notNull: true, references: 'repos(id)', onDelete: 'CASCADE' },
    code_file: { type: 'text', notNull: true },
    doc_file: { type: 'text', notNull: true },
    commit_sha: { type: 'text', notNull: true },
    committed_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('co_changes', ['repo_id', 'code_file', 'doc_file', 'commit_sha'], {
    unique: true,
    name: 'idx_co_changes_dedup',
  });
  pgm.createIndex('co_changes', ['repo_id', 'code_file', 'doc_file']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('co_changes');
  pgm.dropTable('suppression_rules');
  pgm.dropTable('feedback');
}
