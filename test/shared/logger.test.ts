import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import { createRootLogger, createLogger } from '../../src/shared/logger';

describe('logger', () => {
  it('creates child loggers with context', () => {
    const child = createLogger({ requestId: 'test-123', repoId: 'repo-456' });
    expect(child).toBeDefined();
    const bindings = child.bindings();
    expect(bindings).toEqual(
      expect.objectContaining({ requestId: 'test-123', repoId: 'repo-456' }),
    );
  });

  it('outputs structured JSON to stdout', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    const testLogger = createRootLogger(stream);
    testLogger.info({ action: 'test' }, 'hello world');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = Buffer.concat(chunks).toString();
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello world');
    expect(parsed.action).toBe('test');
  });

  it('redacts sensitive fields', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    const testLogger = createRootLogger(stream);
    testLogger.info({ token: 'super-secret-value', safe: 'visible' }, 'redaction test');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = Buffer.concat(chunks).toString();
    expect(output).not.toContain('super-secret-value');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('visible');
  });

  it('redacts multiple sensitive fields', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    const testLogger = createRootLogger(stream);
    testLogger.info(
      {
        token: 'secret-token',
        apiKey: 'secret-api-key',
        password: 'secret-password',
        github_private_key: 'secret-pem',
        safe_field: 'this-is-fine',
      },
      'multi-redact test',
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = Buffer.concat(chunks).toString();
    const parsed = JSON.parse(output);
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.apiKey).toBe('[REDACTED]');
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.github_private_key).toBe('[REDACTED]');
    expect(parsed.safe_field).toBe('this-is-fine');
  });
});
