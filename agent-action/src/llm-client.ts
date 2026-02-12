/**
 * LLM client abstraction for making Anthropic API calls.
 */

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

/**
 * Create a real Anthropic LLM client.
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
