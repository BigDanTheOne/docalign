import type { Request, Response, NextFunction } from 'express';
import { DocAlignError } from '../shared/types';
import type { APIErrorResponse } from '../shared/types';
import logger from '../shared/logger';

const HTTP_STATUS_BY_CODE: Record<string, number> = {
  DOCALIGN_E103: 401, // GitHub auth error
  DOCALIGN_E105: 401, // Invalid webhook signature
  DOCALIGN_E108: 400, // JSON parse failure
};

function getHttpStatus(err: DocAlignError): number {
  if (err.code in HTTP_STATUS_BY_CODE) {
    return HTTP_STATUS_BY_CODE[err.code];
  }
  switch (err.severity) {
    case 'critical':
    case 'high':
      return 500;
    case 'medium':
    case 'low':
      return 400;
    default:
      return 500;
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof DocAlignError) {
    const status = getHttpStatus(err);
    const response: APIErrorResponse = {
      error: err.code,
      message: err.userMessage ?? err.message,
    };
    if (err.context && Object.keys(err.context).length > 0) {
      response.details = err.context;
    }
    logger.error({ err, code: err.code, severity: err.severity }, err.message);
    res.status(status).json(response);
  } else {
    logger.error({ err }, 'Unhandled error');
    const response: APIErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
}
