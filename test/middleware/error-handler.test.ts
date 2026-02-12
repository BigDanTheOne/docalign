import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { DocAlignError } from '../../src/shared/types';
import type { APIErrorResponse } from '../../src/shared/types';
import { errorHandler } from '../../src/middleware/error-handler';
import type { Server } from 'http';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();

  app.get('/docalign-error', (_req, _res, next) => {
    next(
      new DocAlignError({
        code: 'DOCALIGN_E105',
        severity: 'high',
        message: 'Invalid webhook signature',
        userMessage: 'Webhook signature verification failed',
      }),
    );
  });

  app.get('/medium-error', (_req, _res, next) => {
    next(
      new DocAlignError({
        code: 'DOCALIGN_E200',
        severity: 'medium',
        message: 'Validation failed',
        userMessage: 'Invalid input',
        context: { repoId: 'test-repo' },
      }),
    );
  });

  app.get('/unknown-error', (_req, _res, next) => {
    next(new Error('Something went wrong'));
  });

  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('errorHandler middleware', () => {
  it('maps DocAlignError with known code to correct HTTP status', async () => {
    const res = await fetch(`${baseUrl}/docalign-error`);
    expect(res.status).toBe(401);

    const body: APIErrorResponse = await res.json();
    expect(body.error).toBe('DOCALIGN_E105');
    expect(body.message).toBe('Webhook signature verification failed');
  });

  it('maps DocAlignError with medium severity to 400', async () => {
    const res = await fetch(`${baseUrl}/medium-error`);
    expect(res.status).toBe(400);

    const body: APIErrorResponse = await res.json();
    expect(body.error).toBe('DOCALIGN_E200');
    expect(body.message).toBe('Invalid input');
    expect(body.details).toEqual({ repoId: 'test-repo' });
  });

  it('maps unknown errors to 500 with generic message', async () => {
    const res = await fetch(`${baseUrl}/unknown-error`);
    expect(res.status).toBe(500);

    const body: APIErrorResponse = await res.json();
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('An unexpected error occurred');
  });
});
