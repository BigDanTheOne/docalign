import pino from 'pino';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = randomUUID();
  const startTime = Date.now();

  (req as Request & { requestId: string }).requestId = requestId;

  const child = logger.child({ requestId });
  (req as Request & { log: typeof child }).log = child;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    child.info({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      requestId,
      duration,
    }, `${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });

  next();
}
