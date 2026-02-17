import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'INTERNAL_SERVER_ERROR';
  const message = err.message ?? 'An unexpected error occurred';

  logger.error(
    {
      err,
      method: req.method,
      url: req.url,
      statusCode,
      code,
    },
    'Request error'
  );

  const body: ErrorResponse = {
    code,
    message,
  };

  if (err.details !== undefined) {
    body.details = err.details;
  }

  res.status(statusCode).json(body);
}

export function createError(
  message: string,
  statusCode = 500,
  code = 'INTERNAL_SERVER_ERROR',
  details?: unknown
): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  err.details = details;
  return err;
}
