import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enable pgvector extension (idempotent)
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector');

  pgm.createTable('code_entities', {
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
    line_number: { type: 'integer', notNull: true },
    end_line_number: { type: 'integer', notNull: true },
    entity_type: {
      type: 'text',
      notNull: true,
      check: "entity_type IN ('function','class','route','type','config')",
    },
    name: { type: 'text', notNull: true },
    signature: { type: 'text' },
    raw_code: { type: 'text' },
    embedding: { type: 'vector(1536)' },
    last_commit_sha: { type: 'text' },
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

  // Indexes per TDD-0 Section 4
  pgm.createIndex('code_entities', 'repo_id');
  pgm.createIndex('code_entities', ['repo_id', 'file_path']);
  pgm.createIndex('code_entities', ['repo_id', 'name']);
  pgm.createIndex('code_entities', ['repo_id', 'entity_type']);

  // HNSW index on embedding for cosine similarity search
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS code_entities_embedding_hnsw_idx
    ON code_entities
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('code_entities', { cascade: true });
}
