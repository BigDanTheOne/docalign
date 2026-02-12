/**
 * Lightweight LLM client for CLI — uses raw fetch, no SDK dependency.
 * Opt-in: only active when ANTHROPIC_API_KEY env var is set.
 */

import { z } from 'zod';

export interface LLMCompletionOptions {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMClient {
  complete(system: string, user: string, options: LLMCompletionOptions): Promise<LLMResponse>;
}

const JSON_RETRY_SUFFIX = `\n\nIMPORTANT: Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the required schema. No markdown code fences, no commentary, no explanatory text. Start with { and end with }.`;

/**
 * Create a fetch-based Anthropic LLM client.
 */
export function createAnthropicClient(apiKey: string): LLMClient {
  return {
    async complete(system: string, user: string, options: LLMCompletionOptions): Promise<LLMResponse> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${body}`);
      }

      const data = await response.json() as {
        content: Array<{ type: string; text: string }>;
        model: string;
        usage: { input_tokens: number; output_tokens: number };
      };

      const textContent = data.content.find((c) => c.type === 'text');
      if (!textContent) {
        throw new Error('No text content in Anthropic API response');
      }

      return {
        content: textContent.text,
        model: data.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      };
    },
  };
}

/**
 * Execute an LLM call with JSON parsing, validation, and retry.
 * Returns null on unrecoverable failure.
 */
export async function llmCallWithRetry<T>(
  client: LLMClient,
  system: string,
  user: string,
  options: LLMCompletionOptions,
  schema: z.ZodType<T>,
): Promise<{ result: T; tokens: { input: number; output: number } } | null> {
  let totalInput = 0;
  let totalOutput = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    const userMsg = attempt === 0 ? user : user + JSON_RETRY_SUFFIX;

    try {
      const response = await client.complete(system, userMsg, options);
      totalInput += response.inputTokens;
      totalOutput += response.outputTokens;

      // Strip markdown code fences if present
      let content = response.content.trim();
      if (content.startsWith('```')) {
        const firstNewline = content.indexOf('\n');
        const lastFence = content.lastIndexOf('```');
        if (firstNewline !== -1 && lastFence > firstNewline) {
          content = content.slice(firstNewline + 1, lastFence).trim();
        }
      }

      const parsed = JSON.parse(content);
      const validated = schema.parse(parsed);
      return { result: validated, tokens: { input: totalInput, output: totalOutput } };
    } catch {
      // First attempt: retry with JSON suffix
      // Second attempt: give up
      if (attempt === 1) return null;
    }
  }

  return null;
}

/**
 * Check if LLM is available (API key set in environment).
 */
export function getLLMApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}
