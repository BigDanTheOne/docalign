import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('repo_manifests', {
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
    file_path: { type: 'text', notNull: true },
    dependencies: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    dev_dependencies: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    scripts: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    source: {
      type: 'text',
      notNull: true,
      check: "source IN ('lockfile','manifest')",
    },
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

  pgm.addConstraint('repo_manifests', 'repo_manifests_repo_path_unique', {
    unique: ['repo_id', 'file_path'],
  });

  pgm.createIndex('repo_manifests', 'repo_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('repo_manifests', { cascade: true });
}
