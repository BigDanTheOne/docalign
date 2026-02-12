import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('repo_files', {
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
    path: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.addConstraint('repo_files', 'repo_files_repo_path_unique', {
    unique: ['repo_id', 'path'],
  });

  pgm.createIndex('repo_files', 'repo_id');
  pgm.createIndex('repo_files', ['repo_id', 'path']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('repo_files', { cascade: true });
}
