import type { Pool } from 'pg';
import type {
  Claim,
  ClaimRow,
  ClaimType,
  Verdict,
  RawExtraction,
} from '../../shared/types';
import { generateKeywords } from './extractors';

// === 4.2 getClaimsByFile ===

export class ClaimStore {
  constructor(private pool: Pool) {}

  async getClaimsByFile(repoId: string, sourceFile: string): Promise<Claim[]> {
    const result = await this.pool.query(
      'SELECT * FROM claims WHERE repo_id = $1 AND source_file = $2 ORDER BY line_number',
      [repoId, sourceFile],
    );
    return result.rows.map(rowToClaim);
  }

  // === 4.3 getClaimsByRepo ===

  async getClaimsByRepo(repoId: string): Promise<Claim[]> {
    const result = await this.pool.query(
      'SELECT * FROM claims WHERE repo_id = $1 ORDER BY source_file, line_number',
      [repoId],
    );
    return result.rows.map(rowToClaim);
  }

  // === 4.4 getClaimById ===

  async getClaimById(claimId: string): Promise<Claim | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM claims WHERE id = $1',
        [claimId],
      );
      if (result.rowCount === 0) return null;
      return rowToClaim(result.rows[0]);
    } catch {
      return null;
    }
  }

  // === 4.7 updateVerificationStatus ===

  async updateVerificationStatus(
    claimId: string,
    status: Verdict | 'pending',
    verificationResultId?: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE claims SET
        verification_status = $2,
        last_verified_at = CASE WHEN $2 != 'pending' THEN NOW() ELSE last_verified_at END,
        last_verification_result_id = COALESCE($3, last_verification_result_id),
        updated_at = NOW()
       WHERE id = $1`,
      [claimId, status, verificationResultId ?? null],
    );
  }

  // === Batch insert claims ===

  async batchInsertClaims(claims: ClaimInsert[]): Promise<Claim[]> {
    if (claims.length === 0) return [];

    const inserted: Claim[] = [];
    for (const claim of claims) {
      const result = await this.pool.query(
        `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
          extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          claim.repo_id,
          claim.source_file,
          claim.line_number,
          claim.claim_text,
          claim.claim_type,
          claim.testability,
          JSON.stringify(claim.extracted_value),
          claim.keywords,
          claim.extraction_confidence,
          claim.extraction_method,
          'pending',
        ],
      );
      inserted.push(rowToClaim(result.rows[0]));
    }
    return inserted;
  }

  // === 4.5 reExtract ===

  async reExtract(
    repoId: string,
    docFile: string,
    newExtractions: RawExtraction[],
  ): Promise<{ added: Claim[]; updated: Claim[]; removed: string[] }> {
    // Load existing syntactic claims
    const existingResult = await this.pool.query(
      `SELECT * FROM claims
       WHERE repo_id = $1 AND source_file = $2
       AND extraction_method IN ('regex', 'heuristic')
       ORDER BY line_number`,
      [repoId, docFile],
    );
    const existingClaims = existingResult.rows.map(rowToClaim);

    // Compute diff
    const diff = computeClaimDiff(existingClaims, newExtractions);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert added
      const addedClaims: Claim[] = [];
      for (const extraction of diff.added) {
        const claim = rawToClaim(repoId, docFile, extraction);
        const result = await client.query(
          `INSERT INTO claims (repo_id, source_file, line_number, claim_text, claim_type, testability,
            extracted_value, keywords, extraction_confidence, extraction_method, verification_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            claim.repo_id, claim.source_file, claim.line_number, claim.claim_text,
            claim.claim_type, claim.testability, JSON.stringify(claim.extracted_value),
            claim.keywords, claim.extraction_confidence, claim.extraction_method, 'pending',
          ],
        );
        addedClaims.push(rowToClaim(result.rows[0]));
      }

      // Update changed claims (preserve ID and verification history)
      const updatedClaims: Claim[] = [];
      for (const update of diff.updated) {
        const keywords = generateKeywords(update.new_extraction);
        const result = await client.query(
          `UPDATE claims SET
            claim_text = $2, line_number = $3, extracted_value = $4,
            keywords = $5, updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            update.existing_id,
            update.new_extraction.claim_text,
            update.new_extraction.line_number,
            JSON.stringify(update.new_extraction.extracted_value),
            keywords,
          ],
        );
        if (result.rowCount && result.rowCount > 0) {
          updatedClaims.push(rowToClaim(result.rows[0]));
        }
      }

      // Remove deleted claims
      const removedIds = diff.removed;
      if (removedIds.length > 0) {
        await client.query(
          'DELETE FROM claims WHERE id = ANY($1::uuid[])',
          [removedIds],
        );
      }

      await client.query('COMMIT');
      return { added: addedClaims, updated: updatedClaims, removed: removedIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // === 4.6 deleteClaimsForFile ===

  async deleteClaimsForFile(repoId: string, docFile: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM claims WHERE repo_id = $1 AND source_file = $2',
      [repoId, docFile],
    );
    return result.rowCount ?? 0;
  }
}

// === Helper types ===

export interface ClaimInsert {
  repo_id: string;
  source_file: string;
  line_number: number;
  claim_text: string;
  claim_type: ClaimType;
  testability: 'syntactic' | 'semantic' | 'untestable';
  extracted_value: Record<string, unknown>;
  keywords: string[];
  extraction_confidence: number;
  extraction_method: 'regex' | 'heuristic' | 'llm';
}

// === Helper functions ===

function rowToClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    repo_id: row.repo_id,
    source_file: row.source_file,
    line_number: row.line_number,
    claim_text: row.claim_text,
    claim_type: row.claim_type,
    testability: row.testability,
    extracted_value: row.extracted_value,
    keywords: row.keywords,
    extraction_confidence: row.extraction_confidence,
    extraction_method: row.extraction_method,
    verification_status: row.verification_status,
    last_verified_at: row.last_verified_at,
    embedding: row.embedding,
    last_verification_result_id: row.last_verification_result_id,
    parent_claim_id: row.parent_claim_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rawToClaim(repoId: string, docFile: string, extraction: RawExtraction): ClaimInsert {
  return {
    repo_id: repoId,
    source_file: docFile,
    line_number: extraction.line_number,
    claim_text: extraction.claim_text,
    claim_type: extraction.claim_type,
    testability: 'syntactic',
    extracted_value: extraction.extracted_value,
    keywords: generateKeywords(extraction),
    extraction_confidence: 1.0,
    extraction_method: 'regex',
  };
}

// === Claim Diff ===

interface ClaimDiff {
  added: RawExtraction[];
  updated: Array<{ existing_id: string; new_extraction: RawExtraction }>;
  removed: string[];
}

function getClaimIdentityKey(claimType: ClaimType, extractedValue: Record<string, unknown>): string {
  switch (claimType) {
    case 'path_reference':
      return 'path:' + (extractedValue.path as string);
    case 'command':
      return 'cmd:' + (extractedValue.runner as string) + ':' + (extractedValue.script as string);
    case 'dependency_version':
      return 'dep:' + (extractedValue.package as string);
    case 'api_route':
      return 'route:' + (extractedValue.method as string) + ':' + (extractedValue.path as string);
    case 'code_example':
      return 'code:' + (extractedValue.language ?? 'unknown');
    case 'environment': {
      const envVar = extractedValue.env_var as string | undefined;
      const runtime = extractedValue.runtime as string | undefined;
      if (envVar) return 'env:var:' + envVar;
      if (runtime) return 'env:runtime:' + runtime;
      return 'env:' + JSON.stringify(extractedValue);
    }
    case 'convention': {
      const convention = extractedValue.convention as string | undefined;
      const fw = extractedValue.framework as string | undefined;
      if (convention) return 'conv:' + convention;
      if (fw) return 'conv:fw:' + (fw as string).toLowerCase();
      return 'conv:' + JSON.stringify(extractedValue);
    }
    default:
      return claimType + ':' + JSON.stringify(extractedValue);
  }
}

function computeClaimDiff(existing: Claim[], newExtractions: RawExtraction[]): ClaimDiff {
  const diff: ClaimDiff = { added: [], updated: [], removed: [] };

  // Build existing map by identity key
  const existingMap = new Map<string, Claim>();
  for (const claim of existing) {
    const key = getClaimIdentityKey(claim.claim_type, claim.extracted_value);
    existingMap.set(key, claim);
  }

  const matchedKeys = new Set<string>();
  for (const extraction of newExtractions) {
    const key = getClaimIdentityKey(extraction.claim_type, extraction.extracted_value);
    const existingClaim = existingMap.get(key);

    if (existingClaim) {
      matchedKeys.add(key);
      // Check if anything changed
      const textChanged = existingClaim.claim_text !== extraction.claim_text;
      const lineChanged = existingClaim.line_number !== extraction.line_number;
      const valueChanged = JSON.stringify(existingClaim.extracted_value) !== JSON.stringify(extraction.extracted_value);

      if (textChanged || lineChanged || valueChanged) {
        diff.updated.push({ existing_id: existingClaim.id, new_extraction: extraction });
      }
    } else {
      diff.added.push(extraction);
    }
  }

  // Claims in existing but not in new extractions are removed
  for (const [key, claim] of existingMap) {
    if (!matchedKeys.has(key)) {
      diff.removed.push(claim.id);
    }
  }

  return diff;
}
