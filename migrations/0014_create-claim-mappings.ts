import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('claim_mappings', {
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
    code_file: { type: 'text', notNull: true },
    code_entity_id: {
      type: 'uuid',
      references: 'code_entities(id)',
      onDelete: 'SET NULL',
    },
    confidence: { type: 'real', notNull: true, default: 0.0 },
    co_change_boost: { type: 'real', notNull: true, default: 0.0 },
    mapping_method: {
      type: 'text',
      notNull: true,
      check: "mapping_method IN ('direct_reference','symbol_search','semantic_search','llm_assisted','manual','co_change')",
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    last_validated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Indexes per TDD-2 Appendix C
  pgm.createIndex('claim_mappings', 'claim_id');
  pgm.createIndex('claim_mappings', ['repo_id', 'code_file']);
  pgm.createIndex('claim_mappings', 'code_entity_id');
  pgm.createIndex('claim_mappings', ['repo_id', 'claim_id'], { unique: false });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('claim_mappings', { cascade: true });
}
