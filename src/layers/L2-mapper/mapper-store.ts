import type { Pool } from 'pg';
import type { ClaimMapping, ClaimMappingRow } from '../../shared/types';
import type { MappingCandidate } from './step1-direct';

/**
 * MapperStore: Database operations for claim_mappings.
 * TDD-2 Sections 4.2-4.7, Appendix C.
 */
export class MapperStore {
  constructor(private pool: Pool) {}

  /**
   * Persist mapping candidates for a claim, returning full ClaimMapping objects.
   */
  async persistMappings(
    repoId: string,
    claimId: string,
    candidates: MappingCandidate[],
  ): Promise<ClaimMapping[]> {
    if (candidates.length === 0) return [];

    const mappings: ClaimMapping[] = [];
    for (const c of candidates) {
      const result = await this.pool.query(
        `INSERT INTO claim_mappings (claim_id, repo_id, code_file, code_entity_id,
          confidence, co_change_boost, mapping_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [claimId, repoId, c.code_file, c.code_entity_id,
         c.confidence, c.co_change_boost, c.mapping_method],
      );
      mappings.push(rowToMapping(result.rows[0]));
    }
    return mappings;
  }

  /**
   * 4.2: Find claims that map to any of the given code files (reverse index).
   */
  async findClaimsByCodeFiles(
    repoId: string,
    codeFiles: string[],
  ): Promise<ClaimMapping[]> {
    if (codeFiles.length === 0) return [];
    const result = await this.pool.query(
      `SELECT * FROM claim_mappings
       WHERE repo_id = $1 AND code_file = ANY($2::text[])
       ORDER BY claim_id`,
      [repoId, codeFiles],
    );
    return result.rows.map(rowToMapping);
  }

  /**
   * 4.3: Get all mappings for a specific claim.
   */
  async getMappingsForClaim(claimId: string): Promise<ClaimMapping[]> {
    const result = await this.pool.query(
      'SELECT * FROM claim_mappings WHERE claim_id = $1 ORDER BY confidence DESC',
      [claimId],
    );
    return result.rows.map(rowToMapping);
  }

  /**
   * 4.5: Update code file paths after renames.
   */
  async updateCodeFilePaths(
    repoId: string,
    renames: Array<{ old_path: string; new_path: string }>,
  ): Promise<number> {
    let updated = 0;
    for (const { old_path, new_path } of renames) {
      const result = await this.pool.query(
        `UPDATE claim_mappings SET code_file = $3, last_validated_at = NOW()
         WHERE repo_id = $1 AND code_file = $2`,
        [repoId, old_path, new_path],
      );
      updated += result.rowCount ?? 0;
    }
    return updated;
  }

  /**
   * 4.6: Remove mappings for deleted code files.
   */
  async removeMappingsForFiles(
    repoId: string,
    codeFiles: string[],
  ): Promise<number> {
    if (codeFiles.length === 0) return 0;
    const result = await this.pool.query(
      'DELETE FROM claim_mappings WHERE repo_id = $1 AND code_file = ANY($2::text[])',
      [repoId, codeFiles],
    );
    return result.rowCount ?? 0;
  }

  /**
   * 4.7: Get entity line count for a mapping (used by L3 routing).
   * LEFT JOINs code_entities to get end_line_number - line_number + 1.
   */
  async getEntityLineCount(mappingId: string): Promise<number | null> {
    const result = await this.pool.query(
      `SELECT ce.end_line_number - ce.line_number + 1 as line_count
       FROM claim_mappings cm
       LEFT JOIN code_entities ce ON cm.code_entity_id = ce.id
       WHERE cm.id = $1`,
      [mappingId],
    );
    if (result.rowCount === 0) return null;
    return result.rows[0].line_count as number | null;
  }

  /**
   * Delete all mappings for a claim (used by refreshMapping).
   */
  async deleteMappingsForClaim(claimId: string): Promise<void> {
    await this.pool.query('DELETE FROM claim_mappings WHERE claim_id = $1', [claimId]);
  }
}

function rowToMapping(row: ClaimMappingRow): ClaimMapping {
  return {
    id: row.id,
    claim_id: row.claim_id,
    repo_id: row.repo_id,
    code_file: row.code_file,
    code_entity_id: row.code_entity_id,
    confidence: row.confidence,
    co_change_boost: row.co_change_boost,
    mapping_method: row.mapping_method,
    created_at: row.created_at,
    last_validated_at: row.last_validated_at,
  };
}
