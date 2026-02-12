import crypto from 'crypto';
import type { DatabaseClient } from './db';

export interface TokenGeneration {
  token: string;
  hash: string;
}

/**
 * Generate a DOCALIGN_TOKEN: docalign_ prefix + 64 hex chars = 73 total chars.
 * Returns the raw token (for the user) and its SHA-256 hash (for storage).
 */
export function generateRepoToken(): TokenGeneration {
  const randomBytes = crypto.randomBytes(32);
  const token = 'docalign_' + randomBytes.toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Validate a DOCALIGN_TOKEN against a repo's stored hash.
 * Returns true if the token matches the repo's stored token_hash.
 */
export async function validateToken(
  token: string,
  repoId: string,
  db: DatabaseClient,
): Promise<boolean> {
  // 1. Format check
  if (!token.startsWith('docalign_')) {
    return false;
  }

  // 2. Length check (prefix 9 + 64 hex = 73)
  if (token.length !== 73) {
    return false;
  }

  // 3. Hash the token
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  // 4. Compare against stored hash
  const result = await db.query<{ id: string }>(
    'SELECT id FROM repos WHERE id = $1 AND token_hash = $2',
    [repoId, hash],
  );

  return result.rows.length > 0;
}
