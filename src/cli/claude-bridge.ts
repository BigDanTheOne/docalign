/**
 * Claude CLI bridge — wraps `claude -p` for structured output.
 *
 * Uses `execFile` (no shell injection), Zod validation,
 * and typed error handling.
 */

import { execFile } from 'child_process';
import { execSync } from 'child_process';
import type { ZodSchema } from 'zod';

// === Types ===

export type ClaudeBridgeErrorType =
  | 'not_installed'
  | 'timeout'
  | 'quota_exceeded'
  | 'parse_error'
  | 'validation_error'
  | 'exit_error';

export interface ClaudeBridgeError {
  type: ClaudeBridgeErrorType;
  message: string;
  raw?: string;
}

export type ClaudeBridgeResult<T> =
  | { ok: true; data: T; durationMs: number }
  | { ok: false; error: ClaudeBridgeError };

export interface ClaudeBridgeOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  allowedTools?: string[];
  appendSystemPrompt?: string;
  cwd?: string;
  /** Transform parsed JSON before Zod validation (e.g., normalize array → object) */
  preprocess?: (data: unknown) => unknown;
}

// === Constants ===

const DEFAULT_TIMEOUT_MS = 0; // No timeout — let claude -p take as long as it needs
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

/**
 * Build a clean env for spawning `claude -p`.
 * Strips CLAUDECODE to avoid the nesting guard — `claude -p` is stateless
 * (single prompt → JSON output → exit) so there's no resource conflict
 * with the parent Claude Code session.
 */
function buildClaudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

// === Availability check (cached per process) ===

let claudeAvailableCache: boolean | null = null;

export function isClaudeAvailable(): boolean {
  if (claudeAvailableCache !== null) return claudeAvailableCache;

  try {
    execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
      env: buildClaudeEnv(),
    });
    claudeAvailableCache = true;
  } catch {
    claudeAvailableCache = false;
  }

  return claudeAvailableCache;
}

/** Reset the cache (for testing). */
export function resetClaudeAvailableCache(): void {
  claudeAvailableCache = null;
}

// === Main invocation ===

/**
 * Invoke `claude -p` with structured JSON output and Zod validation.
 *
 * @param prompt - User prompt text
 * @param schema - Zod schema to validate the parsed output
 * @param options - Timeout, allowed tools, system prompt, etc.
 * @returns Validated data or typed error
 */
export function invokeClaudeStructured<T>(
  prompt: string,
  schema: ZodSchema<T>,
  options: ClaudeBridgeOptions = {},
): Promise<ClaudeBridgeResult<T>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBuffer = DEFAULT_MAX_BUFFER,
    allowedTools,
    appendSystemPrompt,
    cwd,
    preprocess,
  } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();

    // Build args — optimize for minimal context and fast startup
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', 'sonnet',              // Sonnet is faster + cheaper for extraction
      '--no-session-persistence',        // Don't save session to disk
      '--disable-slash-commands',        // Skip loading skills
    ];

    if (allowedTools && allowedTools.length > 0) {
      // Use --tools (restricts built-in tool set) instead of --allowedTools
      args.push('--tools', allowedTools.join(','));
    }

    if (appendSystemPrompt) {
      args.push('--append-system-prompt', appendSystemPrompt);
    }

    // Prompt is sent via stdin (not as a positional arg) because --tools
    // can consume trailing arguments. Stdin is closed immediately after
    // writing so claude -p processes the prompt without blocking.

    const child = execFile(
      'claude',
      args,
      {
        timeout: timeoutMs,
        maxBuffer,
        encoding: 'utf-8',
        cwd,
        env: buildClaudeEnv(),
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;

        // Handle exec errors
        if (error) {
          // Check for timeout
          if (error.killed || (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
            resolve({
              ok: false,
              error: { type: 'timeout', message: `Claude CLI timed out after ${timeoutMs}ms` },
            });
            return;
          }

          // Check for not installed
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            resolve({
              ok: false,
              error: { type: 'not_installed', message: 'Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code' },
            });
            return;
          }

          // Check for quota errors in stderr
          const allOutput = (stderr ?? '') + (stdout ?? '');
          if (allOutput.includes('quota') || allOutput.includes('rate limit') || allOutput.includes('429')) {
            resolve({
              ok: false,
              error: { type: 'quota_exceeded', message: 'Claude API quota exceeded or rate limited', raw: allOutput },
            });
            return;
          }

          // Generic exit error
          resolve({
            ok: false,
            error: {
              type: 'exit_error',
              message: `Claude CLI exited with error: ${error.message}`,
              raw: allOutput,
            },
          });
          return;
        }

        // Parse output — claude -p --output-format json emits JSON-lines:
        //   {"type":"system","subtype":"init",...}
        //   {"type":"assistant","message":{...},...}  (may repeat for tool-use turns)
        //   {"type":"result","result":"..."}
        // We need the "result" field from the last line with type "result".
        const resultText = extractResultFromOutput(stdout);
        if (resultText === null) {
          resolve({
            ok: false,
            error: { type: 'parse_error', message: 'No result found in Claude CLI output', raw: stdout.slice(0, 2000) },
          });
          return;
        }

        // Parse the inner JSON (Claude's structured output)
        // Strip markdown code fences if present (claude -p often wraps JSON in ```json...```)
        // Extract JSON from the result text.
        // Claude may return: raw JSON, markdown-fenced JSON, or prose + fenced JSON.
        let innerParsed: unknown;

        // First try: parse as raw JSON directly
        try {
          innerParsed = JSON.parse(resultText);
        } catch {
          // Second try: extract JSON from markdown code fence (```json ... ```)
          const fenceMatch = resultText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
          if (fenceMatch) {
            try {
              innerParsed = JSON.parse(fenceMatch[1].trim());
            } catch {
              innerParsed = resultText;
            }
          } else {
            innerParsed = resultText;
          }
        }

        // Optional preprocessing (e.g., normalize bare array → wrapped object)
        if (preprocess) {
          innerParsed = preprocess(innerParsed);
        }

        // Validate with Zod
        const validation = schema.safeParse(innerParsed);
        if (!validation.success) {
          resolve({
            ok: false,
            error: {
              type: 'validation_error',
              message: `Output validation failed: ${validation.error.message}`,
              raw: resultText,
            },
          });
          return;
        }

        resolve({ ok: true, data: validation.data, durationMs });
      },
    );

    // Send prompt via stdin and close so claude -p starts processing
    child.stdin?.end(prompt);

    // Ensure child process is cleaned up on timeout
    child.on('error', () => {
      // Already handled in callback
    });
  });
}

/**
 * Extract the result text from `claude -p --output-format json` output.
 *
 * Handles three formats:
 * 1. JSON array: `[{type:"system",...},{type:"assistant",...},{type:"result",result:"..."}]`
 * 2. JSON-lines: one JSON object per line, look for type:"result"
 * 3. Legacy single object: `{result: "..."}`
 */
export function extractResultFromOutput(stdout: string): string | null {
  const trimmed = stdout.trim();

  // Try parsing the entire output as JSON first
  try {
    const parsed = JSON.parse(trimmed);

    // Format 1: JSON array of message objects (current claude -p behavior)
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object' && item.type === 'result' && 'result' in item) {
          return typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
        }
      }
      return null; // Array but no result item found
    }

    // Format 3: Legacy single object with "result" key
    if (typeof parsed === 'object' && parsed !== null && 'result' in parsed) {
      const envelope = parsed as { result: unknown };
      return typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result);
    }

    // Plain JSON object (no envelope) — return as-is
    return JSON.stringify(parsed);
  } catch {
    // Not valid JSON as a single blob — try JSON-lines
  }

  // Format 2: JSON-lines (one JSON object per line)
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 1) {
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object' && obj.type === 'result' && 'result' in obj) {
          return typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result);
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return null;
}
