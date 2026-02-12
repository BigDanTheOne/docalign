import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateFixToken, validateFixToken } from '../../../src/server/fix/hmac';

describe('Fix HMAC', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a token in {timestamp}.{hmac} format', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    expect(token).toMatch(/^\d+\.[0-9a-f]+$/);
  });

  it('validates a freshly generated token', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const valid = validateFixToken(token, 'secret', 'repo-1', 42, 'scan-1');
    expect(valid).toBe(true);
  });

  it('rejects token with wrong secret', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const valid = validateFixToken(token, 'wrong-secret', 'repo-1', 42, 'scan-1');
    expect(valid).toBe(false);
  });

  it('rejects token with wrong repoId', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const valid = validateFixToken(token, 'secret', 'repo-2', 42, 'scan-1');
    expect(valid).toBe(false);
  });

  it('rejects token with wrong prNumber', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const valid = validateFixToken(token, 'secret', 'repo-1', 99, 'scan-1');
    expect(valid).toBe(false);
  });

  it('rejects token with wrong scanRunId', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const valid = validateFixToken(token, 'secret', 'repo-1', 42, 'scan-2');
    expect(valid).toBe(false);
  });

  it('rejects expired token (>7 days)', () => {
    // Mock Date.now to return a timestamp 8 days ago for generation
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(eightDaysAgo);
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');

    // Validate at current time
    vi.restoreAllMocks();
    const valid = validateFixToken(token, 'secret', 'repo-1', 42, 'scan-1');
    expect(valid).toBe(false);
  });

  it('rejects malformed token (no dot)', () => {
    expect(validateFixToken('nodot', 'secret', 'repo-1', 42, 'scan-1')).toBe(false);
  });

  it('rejects malformed token (non-numeric timestamp)', () => {
    expect(validateFixToken('abc.def', 'secret', 'repo-1', 42, 'scan-1')).toBe(false);
  });

  it('rejects token with different length hmac (timing-safe)', () => {
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const [ts] = token.split('.');
    // Truncated HMAC
    const valid = validateFixToken(`${ts}.short`, 'secret', 'repo-1', 42, 'scan-1');
    expect(valid).toBe(false);
  });

  it('is deterministic for same timestamp', () => {
    const fixedTime = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
    const token1 = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const token2 = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    expect(token1).toBe(token2);
  });

  it('uses different prefix than dismiss tokens', async () => {
    // Fix tokens use "fix:" prefix, dismiss tokens do not
    const token = generateFixToken('secret', 'repo-1', 42, 'scan-1');
    const { generateDismissToken } = await import('../../../src/routes/dismiss');
    const dismissToken = generateDismissToken('secret', 'repo-1', 42, 'scan-1');
    expect(token).not.toBe(dismissToken);
  });
});
