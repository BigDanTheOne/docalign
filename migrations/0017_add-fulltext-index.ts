import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // GIN index for full-text search on claims.claim_text
  // Used by MCP get_docs tool (TDD-6 Appendix F.1)
  pgm.sql(`
    CREATE INDEX idx_claims_fulltext
      ON claims USING GIN (to_tsvector('english', claim_text))
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS idx_claims_fulltext');
}
