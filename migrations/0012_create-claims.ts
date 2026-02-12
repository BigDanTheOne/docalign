import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enable pgvector extension (idempotent, may already exist from code_entities)
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector');

  pgm.createTable('claims', {
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
    source_file: { type: 'text', notNull: true },
    line_number: { type: 'integer', notNull: true },
    claim_text: { type: 'text', notNull: true },
    claim_type: {
      type: 'text',
      notNull: true,
      check: "claim_type IN ('path_reference','dependency_version','command','api_route','code_example','behavior','architecture','config','convention','environment')",
    },
    testability: {
      type: 'text',
      notNull: true,
      check: "testability IN ('syntactic','semantic','untestable')",
    },
    extracted_value: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    keywords: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    extraction_confidence: { type: 'real', notNull: true, default: 1.0 },
    extraction_method: {
      type: 'text',
      notNull: true,
      check: "extraction_method IN ('regex','heuristic','llm')",
    },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'pending',
    },
    last_verified_at: { type: 'timestamptz' },
    embedding: { type: 'vector(1536)' },
    last_verification_result_id: { type: 'uuid' },
    parent_claim_id: {
      type: 'uuid',
      references: 'claims(id)',
      onDelete: 'SET NULL',
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

  // Indexes per TDD-1 Section 5
  pgm.createIndex('claims', 'repo_id');
  pgm.createIndex('claims', ['repo_id', 'source_file']);
  pgm.createIndex('claims', ['repo_id', 'claim_type']);
  pgm.createIndex('claims', 'parent_claim_id');
  pgm.createIndex('claims', ['repo_id', 'extraction_method']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('claims', { cascade: true });
}
