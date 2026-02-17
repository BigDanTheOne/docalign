import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import {
  createAnthropicClient,
  llmCallWithRetry,
  getLLMApiKey,
} from '../../src/cli/llm-client';
import type { LLMClient } from '../../src/cli/llm-client';

describe('getLLMApiKey', () => {
  const origEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = origEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('returns null when env var not set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getLLMApiKey()).toBeNull();
  });

  it('returns key when env var is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    expect(getLLMApiKey()).toBe('sk-test-key');
  });
});

describe('createAnthropicClient', () => {
  it('returns an object with a complete method', () => {
    const client = createAnthropicClient('sk-test');
    expect(typeof client.complete).toBe('function');
  });
});

describe('llmCallWithRetry', () => {
  const TestSchema = z.object({
    verdict: z.enum(['verified', 'drifted']),
    score: z.number(),
  });

  function mockClient(responses: Array<{ content: string; throw?: boolean }>): LLMClient {
    let callIndex = 0;
    return {
      complete: vi.fn().mockImplementation(async () => {
        const resp = responses[callIndex++];
        if (resp?.throw) throw new Error('API error');
        return {
          content: resp?.content ?? '{}',
          model: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
        };
      }),
    };
  }

  it('parses valid JSON response on first attempt', async () => {
    const client = mockClient([{ content: '{"verdict": "verified", "score": 0.9}' }]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).not.toBeNull();
    expect(result!.result.verdict).toBe('verified');
    expect(result!.result.score).toBe(0.9);
    expect(result!.tokens.input).toBe(100);
    expect(result!.tokens.output).toBe(50);
  });

  it('retries on invalid JSON and succeeds on second attempt', async () => {
    const client = mockClient([
      { content: 'not json' },
      { content: '{"verdict": "drifted", "score": 0.7}' },
    ]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).not.toBeNull();
    expect(result!.result.verdict).toBe('drifted');
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it('returns null after two failures', async () => {
    const client = mockClient([
      { content: 'bad' },
      { content: 'still bad' },
    ]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).toBeNull();
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it('returns null on API error then parse error', async () => {
    const client = mockClient([
      { content: '', throw: true },
      { content: 'invalid' },
    ]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).toBeNull();
  });

  it('strips markdown code fences from response', async () => {
    const client = mockClient([
      { content: '```json\n{"verdict": "verified", "score": 0.95}\n```' },
    ]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).not.toBeNull();
    expect(result!.result.verdict).toBe('verified');
    expect(result!.result.score).toBe(0.95);
  });

  it('retries on Zod validation failure', async () => {
    const client = mockClient([
      { content: '{"verdict": "invalid_value", "score": 0.5}' },
      { content: '{"verdict": "verified", "score": 0.8}' },
    ]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).not.toBeNull();
    expect(result!.result.verdict).toBe('verified');
  });

  it('accumulates token counts across retries', async () => {
    const client = mockClient([
      { content: 'bad' },
      { content: '{"verdict": "verified", "score": 1.0}' },
    ]);
    const result = await llmCallWithRetry(client, 'sys', 'user', {
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    }, TestSchema);

    expect(result).not.toBeNull();
    expect(result!.tokens.input).toBe(200); // 100 + 100
    expect(result!.tokens.output).toBe(100); // 50 + 50
  });
});
