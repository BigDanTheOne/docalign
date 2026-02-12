/**
 * Embedding generation using OpenAI text-embedding-3-small.
 * Implements: phase4b-prompt-specs.md Section 1.2.
 */

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export interface EmbeddingClient {
  generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]>;
}

/**
 * Create an OpenAI embeddings client.
 */
export function createEmbeddingClient(
  apiKey: string,
  model = 'text-embedding-3-small',
  dimensions = 1536,
): EmbeddingClient {
  return {
    async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
      if (texts.length === 0) return [];

      const results: EmbeddingResult[] = [];
      const batchSize = 100; // Max 100 per API call

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await callEmbeddingApi(apiKey, batch, model, dimensions);
        results.push(...batchResults);
      }

      return results;
    },
  };
}

async function callEmbeddingApi(
  apiKey: string,
  texts: string[],
  model: string,
  dimensions: number,
  retryCount = 0,
): Promise<EmbeddingResult[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      dimensions,
    }),
  });

  // Rate limit backoff
  if (response.status === 429 && retryCount < 3) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
    const delay = Math.min(retryAfter * 1000, 30000);
    console.warn(`[embeddings] Rate limited, retrying after ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return callEmbeddingApi(apiKey, texts, model, dimensions, retryCount + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Embeddings API error ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain order
  const sorted = data.data.sort((a, b) => a.index - b.index);

  return sorted.map((item, idx) => ({
    text: texts[idx],
    embedding: item.embedding,
  }));
}
