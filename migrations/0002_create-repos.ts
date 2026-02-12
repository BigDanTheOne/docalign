import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('repos', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    github_owner: { type: 'text', notNull: true },
    github_repo: { type: 'text', notNull: true },
    github_installation_id: { type: 'integer', notNull: true },
    default_branch: { type: 'text', notNull: true, default: 'main' },
    status: {
      type: 'text',
      notNull: true,
      default: 'onboarding',
      check: "status IN ('onboarding','awaiting_setup','scanning','active','partial','error')",
    },
    last_indexed_commit: { type: 'text' },
    last_full_scan_at: { type: 'timestamptz' },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    health_score: { type: 'real' },
    total_claims: { type: 'integer', notNull: true, default: 0 },
    verified_claims: { type: 'integer', notNull: true, default: 0 },
    token_hash: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Unique constraint on (github_owner, github_repo)
  pgm.addConstraint('repos', 'repos_owner_repo_unique', {
    unique: ['github_owner', 'github_repo'],
  });

  // Indexes per Appendix A.1
  pgm.createIndex('repos', 'github_installation_id');
  pgm.createIndex('repos', ['github_owner', 'github_repo']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('repos', { cascade: true });
}
