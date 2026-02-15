import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('repo_manifests', {
    name: { type: 'text' },
    version: { type: 'text' },
    engines: { type: 'jsonb' },
    license: { type: 'text' },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('repo_manifests', ['name', 'version', 'engines', 'license']);
}
