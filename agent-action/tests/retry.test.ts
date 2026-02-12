import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry } from '../src/retry';
import type { LLMResponse } from '../src/llm-client';

function mockResponse(content: string): LLMResponse {
  return {
    content,
    model: 'test-model',
    inputTokens: 100,
    outputTokens: 50,
  };
}

describe('executeWithRetry', () => {
  it('succeeds on first attempt', async () => {
    const llmCall = vi.fn().mockResolvedValue(mockResponse('{"result": "ok"}'));
    const parse = vi.fn().mockReturnValue({ result: 'ok' });

    const result = await executeWithRetry(llmCall, parse, 'TEST');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ result: 'ok' });
    expect(result.metadata?.model_used).toBe('test-model');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries on JSON.parse failure and succeeds', async () => {
    const llmCall = vi.fn()
      .mockResolvedValueOnce(mockResponse('not json'))
      .mockResolvedValueOnce(mockResponse('{"result": "ok"}'));
    const parse = vi.fn()
      .mockImplementationOnce((raw: string) => { JSON.parse(raw); })
      .mockReturnValue({ result: 'ok' });

    const result = await executeWithRetry(llmCall, parse, 'TEST');

    expect(result.success).toBe(true);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('retries on Zod validation failure and succeeds', async () => {
    const llmCall = vi.fn()
      .mockResolvedValue(mockResponse('{"bad": true}'));
    const parse = vi.fn()
      .mockImplementationOnce(() => { throw new Error('Zod validation failed'); })
      .mockReturnValue({ result: 'ok' });

    const result = await executeWithRetry(llmCall, parse, 'TEST');

    expect(result.success).toBe(true);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('fails after two attempts', async () => {
    const llmCall = vi.fn().mockResolvedValue(mockResponse('bad'));
    const parse = vi.fn().mockImplementation(() => { throw new Error('Parse failed'); });

    const result = await executeWithRetry(llmCall, parse, 'TEST');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Parse failed');
    expect(result.data).toBeNull();
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('calculates metadata from LLM response', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      content: '{}',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 1000,
      outputTokens: 200,
    });
    const parse = vi.fn().mockReturnValue({});

    const result = await executeWithRetry(llmCall, parse, 'TEST');

    expect(result.metadata?.model_used).toBe('claude-sonnet-4-5-20250929');
    expect(result.metadata?.tokens_used).toBe(1200);
    expect(result.metadata?.cost_usd).toBeGreaterThan(0);
  });

  it('passes retry suffix on second attempt', async () => {
    const calls: (string | undefined)[] = [];
    const llmCall = vi.fn().mockImplementation((suffix?: string) => {
      calls.push(suffix);
      return Promise.resolve(mockResponse('{"ok": true}'));
    });
    const parse = vi.fn()
      .mockImplementationOnce(() => { throw new Error('fail'); })
      .mockReturnValue({ ok: true });

    await executeWithRetry(llmCall, parse, 'TEST');

    expect(calls[0]).toBeUndefined();
    expect(calls[1]).toContain('IMPORTANT');
  });

  it('includes metadata even on failure', async () => {
    const llmCall = vi.fn().mockResolvedValue(mockResponse('bad'));
    const parse = vi.fn().mockImplementation(() => { throw new Error('fail'); });

    const result = await executeWithRetry(llmCall, parse, 'TEST');

    expect(result.success).toBe(false);
    expect(result.metadata?.model_used).toBe('test-model');
  });
});
