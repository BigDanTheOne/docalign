import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEmbeddingClient } from '../src/embeddings';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

describe('EmbeddingClient', () => {
  it('generates embeddings for a single text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
      }),
    });

    const client = createEmbeddingClient('sk-test');
    const results = await client.generateEmbeddings(['Hello world']);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Hello world');
    expect(results[0].embedding).toHaveLength(1536);
  });

  it('returns empty array for empty input', async () => {
    const client = createEmbeddingClient('sk-test');
    const results = await client.generateEmbeddings([]);
    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('batches requests at 100 texts max', async () => {
    mockFetch.mockImplementation((_url: string, options: { body: string }) => {
      const body = JSON.parse(options.body);
      const batchSize = body.input.length;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: Array.from({ length: batchSize }, (_, i) => ({
            embedding: [0.1],
            index: i,
          })),
        }),
      });
    });

    const texts = Array.from({ length: 150 }, (_, i) => `Text ${i}`);
    const client = createEmbeddingClient('sk-test', 'text-embedding-3-small', 1);
    const results = await client.generateEmbeddings(texts);

    expect(mockFetch).toHaveBeenCalledTimes(2); // 100 + 50
    expect(results).toHaveLength(150);
  });

  it('uses correct model and dimensions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ embedding: [0.1, 0.2], index: 0 }],
      }),
    });

    const client = createEmbeddingClient('sk-test', 'custom-model', 768);
    await client.generateEmbeddings(['test']);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('custom-model');
    expect(body.dimensions).toBe(768);
  });

  it('handles API errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
      headers: new Map(),
    });

    const client = createEmbeddingClient('sk-test');
    await expect(client.generateEmbeddings(['test'])).rejects.toThrow('OpenAI Embeddings API error 400');
  });

  it('retries on rate limit (429)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '1' },
        text: () => Promise.resolve('Rate limited'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ embedding: [0.1], index: 0 }],
        }),
      });

    const client = createEmbeddingClient('sk-test', 'text-embedding-3-small', 1);
    const results = await client.generateEmbeddings(['test']);

    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('preserves order when results come out of order', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { embedding: [0.2], index: 1 },
          { embedding: [0.1], index: 0 },
        ],
      }),
    });

    const client = createEmbeddingClient('sk-test', 'text-embedding-3-small', 1);
    const results = await client.generateEmbeddings(['first', 'second']);

    expect(results[0].text).toBe('first');
    expect(results[0].embedding).toEqual([0.1]);
    expect(results[1].text).toBe('second');
    expect(results[1].embedding).toEqual([0.2]);
  });
});
