import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('verification_results', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    claim_id: {
      type: 'uuid',
      notNull: true,
      references: 'claims(id)',
      onDelete: 'CASCADE',
    },
    repo_id: {
      type: 'uuid',
      notNull: true,
      references: 'repos(id)',
      onDelete: 'CASCADE',
    },
    scan_run_id: {
      type: 'uuid',
      references: 'scan_runs(id)',
      onDelete: 'SET NULL',
    },
    verdict: {
      type: 'text',
      notNull: true,
      check: "verdict IN ('verified','drifted','uncertain')",
    },
    confidence: { type: 'real', notNull: true },
    tier: { type: 'integer', notNull: true },
    severity: { type: 'text' },
    reasoning: { type: 'text' },
    specific_mismatch: { type: 'text' },
    suggested_fix: { type: 'text' },
    evidence_files: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    token_cost: { type: 'integer' },
    duration_ms: { type: 'integer' },
    post_check_result: { type: 'text' },
    verification_path: { type: 'integer' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Indexes per TDD-3 Section 2.4
  pgm.createIndex('verification_results', 'claim_id');
  pgm.createIndex('verification_results', 'scan_run_id');
  pgm.createIndex('verification_results', ['repo_id', 'claim_id']);

  // Add FK from claims.last_verification_result_id now that verification_results exists
  pgm.addConstraint('claims', 'fk_claims_last_verification_result', {
    foreignKeys: {
      columns: 'last_verification_result_id',
      references: 'verification_results(id)',
      onDelete: 'SET NULL',
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('claims', 'fk_claims_last_verification_result', { ifExists: true });
  pgm.dropTable('verification_results', { cascade: true });
}
