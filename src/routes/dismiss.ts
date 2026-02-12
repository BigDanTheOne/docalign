import { Router } from 'express';
import crypto from 'crypto';
import type { DatabaseClient } from '../shared/db';
import logger from '../shared/logger';

export interface DismissRouteDeps {
  db: DatabaseClient;
  apiSecret: string;
}

/**
 * Generate an HMAC dismiss token for a dismiss link.
 */
export function generateDismissToken(
  apiSecret: string,
  repoId: string,
  prNumber: number,
  scanRunId: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `${repoId}:${prNumber}:${scanRunId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', apiSecret).update(data).digest('hex');
  return `${timestamp}.${hmac}`;
}

/**
 * Validate an HMAC dismiss token. Returns true if valid and not expired (7 days).
 */
export function validateDismissToken(
  token: string,
  apiSecret: string,
  repoId: string,
  prNumber: number,
  scanRunId: string,
): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [timestampStr, receivedHmac] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check expiry (7 days)
  const now = Math.floor(Date.now() / 1000);
  const sevenDays = 7 * 24 * 60 * 60;
  if (now - timestamp > sevenDays) return false;

  // Recompute HMAC
  const data = `${repoId}:${prNumber}:${scanRunId}:${timestamp}`;
  const expected = crypto.createHmac('sha256', apiSecret).update(data).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function createDismissRoute(deps: DismissRouteDeps): Router {
  const router = Router();

  // GET /api/dismiss?token=...&claim_id=...&scan_run_id=...&repo_id=...&pr_number=...
  router.get('/', async (req, res) => {
    const { token, claim_id, scan_run_id, repo_id, pr_number } = req.query as Record<
      string,
      string | undefined
    >;

    if (!token || !claim_id || !scan_run_id || !repo_id || !pr_number) {
      res.status(400).json({ error: 'Missing required query parameters' });
      return;
    }

    const prNum = parseInt(pr_number, 10);
    if (isNaN(prNum)) {
      res.status(400).json({ error: 'Invalid pr_number' });
      return;
    }

    // 1. Validate HMAC dismiss token
    const valid = validateDismissToken(token, deps.apiSecret, repo_id, prNum, scan_run_id);
    if (!valid) {
      res.status(400).json({ error: 'Invalid or expired dismiss token.' });
      return;
    }

    // 2. Look up repo
    const repoResult = await deps.db.query<{ github_owner: string; github_repo: string }>(
      'SELECT github_owner, github_repo FROM repos WHERE id = $1',
      [repo_id],
    );
    if (repoResult.rows.length === 0) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    // 3. Record feedback
    try {
      await deps.db.query(
        `INSERT INTO feedback (repo_id, claim_id, feedback_type, pr_number)
         VALUES ($1, $2, $3, $4)`,
        [repo_id, claim_id, 'all_dismissed', prNum],
      );
    } catch (err) {
      // Feedback table might not exist yet (migration pending) — log but don't fail
      logger.warn({ err, repo_id, claim_id }, 'Failed to record dismiss feedback');
    }

    // 4. Redirect to PR
    const { github_owner, github_repo } = repoResult.rows[0];
    const redirectUrl = `https://github.com/${github_owner}/${github_repo}/pull/${pr_number}`;

    res.redirect(302, redirectUrl);
  });

  return router;
}
