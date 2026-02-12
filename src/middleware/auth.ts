import type { Request, Response, NextFunction } from 'express';
import { validateToken } from '../shared/token';
import type { DatabaseClient } from '../shared/db';

// Extend Express Request to include repoId
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      repoId?: string;
    }
  }
}

/**
 * Auth middleware: validates Bearer DOCALIGN_TOKEN from Authorization header.
 * Extracts repo_id from query params (or task lookup for /api/tasks/:id).
 * On success, attaches req.repoId.
 */
export function createAuthMiddleware(db: DatabaseClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Invalid or missing DOCALIGN_TOKEN.' });
      return;
    }
    const token = authHeader.slice(7);

    // 2. Extract repo_id
    const repoId = req.query.repo_id as string | undefined;
    if (!repoId) {
      res.status(400).json({ error: 'Missing required query parameter: repo_id' });
      return;
    }

    // 3. Validate token
    try {
      const valid = await validateToken(token, repoId, db);
      if (!valid) {
        res.status(401).json({ error: 'Invalid or missing DOCALIGN_TOKEN.' });
        return;
      }
    } catch {
      res.status(503).json({ error: 'Service unavailable' });
      return;
    }

    // 4. Attach repo_id and proceed
    req.repoId = repoId;
    next();
  };
}
