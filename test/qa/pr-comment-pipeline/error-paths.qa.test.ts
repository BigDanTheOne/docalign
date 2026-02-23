/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QA: Error path coverage for PR comment posting.
 * Tests: missing token, API errors (403, 422, 5xx), network failures.
 */
import { describe, it, expect, vi } from 'vitest';

// Simulates the githubApi helper from post-comment.mjs
async function githubApi(
  fetchFn: typeof globalThis.fetch,
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!token) {
    throw new Error('No GitHub token available');
  }

  const url = `https://api.github.com${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'docalign-action/0.1.0',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const resp = await fetchFn(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GitHub API ${method} ${path}: ${resp.status} ${text.slice(0, 200)}`);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

describe('QA: Error paths', () => {
  describe('missing GitHub token', () => {
    it('throws when token is undefined', async () => {
      const mockFetch = vi.fn();
      await expect(
        githubApi(mockFetch as any, undefined, 'GET', '/repos/o/r/issues/1/comments'),
      ).rejects.toThrow('No GitHub token available');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when token is empty string', async () => {
      const mockFetch = vi.fn();
      await expect(
        githubApi(mockFetch as any, '', 'GET', '/repos/o/r/issues/1/comments'),
      ).rejects.toThrow('No GitHub token available');
    });
  });

  describe('API error: 403 Forbidden', () => {
    it('throws with status 403 and error message', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 }),
      );
      await expect(
        githubApi(mockFetch as any, 'token-123', 'POST', '/repos/o/r/issues/1/comments', { body: 'test' }),
      ).rejects.toThrow('403');
    });
  });

  describe('API error: 422 Unprocessable Entity', () => {
    it('throws with status 422 for validation errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Validation Failed', errors: [{ code: 'too_long' }] }), { status: 422 }),
      );
      await expect(
        githubApi(mockFetch as any, 'token-123', 'PATCH', '/repos/o/r/issues/comments/42', { body: 'x'.repeat(70000) }),
      ).rejects.toThrow('422');
    });
  });

  describe('API error: 5xx Server Error', () => {
    it('throws with status 500', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );
      await expect(
        githubApi(mockFetch as any, 'token-123', 'GET', '/repos/o/r/issues/1/comments'),
      ).rejects.toThrow('500');
    });

    it('throws with status 502 Bad Gateway', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Bad Gateway', { status: 502 }),
      );
      await expect(
        githubApi(mockFetch as any, 'token-123', 'GET', '/repos/o/r/issues/1/comments'),
      ).rejects.toThrow('502');
    });

    it('throws with status 503 Service Unavailable', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      );
      await expect(
        githubApi(mockFetch as any, 'token-123', 'POST', '/repos/o/r/issues/1/comments', { body: 'test' }),
      ).rejects.toThrow('503');
    });
  });

  describe('network failure', () => {
    it('propagates fetch TypeError for network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      await expect(
        githubApi(mockFetch as any, 'token-123', 'GET', '/repos/o/r/issues/1/comments'),
      ).rejects.toThrow('fetch failed');
    });
  });

  describe('graceful exit behavior (post-comment.mjs pattern)', () => {
    it('action should not throw on comment failure — catches and logs', async () => {
      // Mirrors the try/catch in post-comment.mjs main block
      let errorMessage = '';
      try {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response('Forbidden', { status: 403 }),
        );
        await githubApi(mockFetch as any, 'token-123', 'POST', '/repos/o/r/issues/1/comments', { body: 'test' });
      } catch (err: any) {
        errorMessage = err.message;
        // In post-comment.mjs this is console.error + no process.exit(1)
      }
      expect(errorMessage).toContain('403');
    });
  });
});
