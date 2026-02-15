import type { Pool } from 'pg';
import type { CodeEntity } from '../../shared/types';

export interface UndocumentedEntity {
  entity: CodeEntity;
  suggested_doc_file: string;
}

/**
 * Find exported/public code entities that have no claim mapping.
 * These are candidates for missing documentation.
 */
export async function getUndocumentedEntities(
  pool: Pool,
  repoId: string,
): Promise<UndocumentedEntity[]> {
  const result = await pool.query(
    `SELECT ce.*
     FROM code_entities ce
     WHERE ce.repo_id = $1
       AND ce.id NOT IN (
         SELECT DISTINCT code_entity_id
         FROM claim_mappings
         WHERE code_entity_id IS NOT NULL AND repo_id = $1
       )
     ORDER BY ce.file_path, ce.line_number`,
    [repoId],
  );

  const entities = result.rows as CodeEntity[];

  // Filter to "important" entities — skip internal/private helpers
  const important = entities.filter((e) => {
    // Skip private/internal names
    if (e.name.startsWith('_')) return false;
    // Skip anonymous entities
    if (!e.name || e.name === '<anonymous>') return false;
    // Focus on exported functions, classes, interfaces, routes
    if (['function', 'class', 'interface', 'route', 'type'].includes(e.entity_type)) {
      return true;
    }
    return false;
  });

  return important.map((entity) => ({
    entity,
    suggested_doc_file: suggestDocFile(entity.file_path),
  }));
}

/**
 * Suggest the nearest doc file for a code entity based on path proximity.
 */
function suggestDocFile(codePath: string): string {
  const parts = codePath.split('/');
  // Look for README.md in the same directory or parent
  if (parts.length > 1) {
    const dir = parts.slice(0, -1).join('/');
    return `${dir}/README.md`;
  }
  return 'README.md';
}
