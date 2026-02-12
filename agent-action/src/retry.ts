/**
 * Retry/Fallback Protocol.
 * Implements: phase4b-prompt-specs.md Section 10.
 */
import type { LLMResponse } from './llm-client';

const JSON_ONLY_SUFFIX = `
IMPORTANT: Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the required schema. No markdown code fences, no commentary, no explanatory text. Start with { and end with }.`;

export interface RetryResult<T> {
  success: boolean;
  data: T;
  error?: string;
  metadata?: {
    model_used?: string;
    tokens_used?: number;
    cost_usd?: number;
  };
}

/**
 * Execute an LLM call with the standard retry protocol:
 * 1. Call LLM
 * 2. JSON.parse() → on failure, retry with JSON-only suffix
 * 3. Zod validate → on failure, retry with JSON-only suffix
 * 4. On second failure, return per-prompt fallback
 */
export async function executeWithRetry<T>(
  llmCall: (retrySuffix?: string) => Promise<LLMResponse>,
  parseAndValidate: (raw: string) => T,
  promptId: string,
): Promise<RetryResult<T>> {
  let lastResponse: LLMResponse | null = null;

  // Attempt 1
  try {
    lastResponse = await llmCall();
    const parsed = parseAndValidate(lastResponse.content);
    return {
      success: true,
      data: parsed,
      metadata: responseToMetadata(lastResponse),
    };
  } catch (err) {
    const errorCode = isJsonParseError(err) ? 'DOCALIGN_E201' : 'DOCALIGN_E202';
    console.warn(`[${promptId}] ${errorCode} on attempt 1:`, err instanceof Error ? err.message : err);
  }

  // Attempt 2 (with JSON-only suffix)
  try {
    lastResponse = await llmCall(JSON_ONLY_SUFFIX);
    const parsed = parseAndValidate(lastResponse.content);
    return {
      success: true,
      data: parsed,
      metadata: responseToMetadata(lastResponse),
    };
  } catch (err) {
    const errorCode = isJsonParseError(err) ? 'DOCALIGN_E201' : 'DOCALIGN_E202';
    console.error(`[${promptId}] ${errorCode} on attempt 2 (final):`, err instanceof Error ? err.message : err);

    return {
      success: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: null as any,
      error: `${errorCode}: ${err instanceof Error ? err.message : String(err)}`,
      metadata: lastResponse ? responseToMetadata(lastResponse) : undefined,
    };
  }
}

function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError;
}

function responseToMetadata(response: LLMResponse) {
  // Estimate cost based on Claude Sonnet pricing
  const inputCost = (response.inputTokens / 1_000_000) * 3;
  const outputCost = (response.outputTokens / 1_000_000) * 15;
  return {
    model_used: response.model,
    tokens_used: response.inputTokens + response.outputTokens,
    cost_usd: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
  };
}
