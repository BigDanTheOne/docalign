import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execSync: vi.fn(),
}));

import * as child_process from 'child_process';
import {
  isClaudeAvailable,
  resetClaudeAvailableCache,
  invokeClaudeStructured,
  extractResultFromOutput,
} from '../../src/cli/claude-bridge';

const mockedExecFile = child_process.execFile as unknown as ReturnType<typeof vi.fn>;
const mockedExecSync = child_process.execSync as unknown as ReturnType<typeof vi.fn>;

const TestSchema = z.object({
  claims: z.array(z.object({
    text: z.string(),
    type: z.string(),
  })),
});

/** Helper: mock return for execFile — includes stdin.end stub */
function mockChildProcess() {
  return { on: vi.fn(), stdin: { end: vi.fn() } };
}

describe('claude-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeAvailableCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isClaudeAvailable', () => {
    it('returns true when claude --version succeeds', () => {
      mockedExecSync.mockReturnValue('claude 1.0.0\n');
      expect(isClaudeAvailable()).toBe(true);
    });

    it('returns false when claude --version fails', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('not found'); });
      expect(isClaudeAvailable()).toBe(false);
    });

    it('caches result per process', () => {
      mockedExecSync.mockReturnValue('claude 1.0.0\n');
      isClaudeAvailable();
      isClaudeAvailable();
      expect(mockedExecSync).toHaveBeenCalledTimes(1);
    });

    it('resets cache with resetClaudeAvailableCache', () => {
      mockedExecSync.mockReturnValue('claude 1.0.0\n');
      isClaudeAvailable();
      resetClaudeAvailableCache();
      isClaudeAvailable();
      expect(mockedExecSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('invokeClaudeStructured', () => {
    it('parses JSON array output format (current claude -p)', async () => {
      const jsonArray = JSON.stringify([
        { type: 'system', subtype: 'init', tools: [] },
        { type: 'assistant', message: { content: [{ text: '...' }] } },
        { type: 'result', result: JSON.stringify({ claims: [{ text: 'Array', type: 'behavior' }] }) },
      ]);

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonArray, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.claims[0].text).toBe('Array');
      }
    });

    it('strips markdown code fences from result', async () => {
      const fencedResult = '```json\n{"claims": [{"text": "Fenced", "type": "config"}]}\n```';
      const jsonArray = JSON.stringify([
        { type: 'system', subtype: 'init' },
        { type: 'result', result: fencedResult },
      ]);

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonArray, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.claims[0].text).toBe('Fenced');
      }
    });

    it('parses JSON-lines output format', async () => {
      const jsonLines = [
        JSON.stringify({ type: 'system', subtype: 'init', tools: [] }),
        JSON.stringify({ type: 'assistant', message: { content: [{ text: '...' }] } }),
        JSON.stringify({ type: 'result', result: JSON.stringify({ claims: [{ text: 'Uses JWT', type: 'behavior' }] }) }),
      ].join('\n');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonLines, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test prompt', TestSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.claims).toHaveLength(1);
        expect(result.data.claims[0].text).toBe('Uses JWT');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('parses legacy single-object envelope', async () => {
      const envelope = JSON.stringify({
        result: JSON.stringify({ claims: [{ text: 'Legacy', type: 'behavior' }] }),
      });

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, envelope, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.claims[0].text).toBe('Legacy');
      }
    });

    it('handles direct JSON result (no envelope wrapping)', async () => {
      const directJson = JSON.stringify({
        claims: [{ text: 'Direct', type: 'config' }],
      });

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, directJson, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.claims[0].text).toBe('Direct');
      }
    });

    it('returns parse_error for invalid JSON', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, 'not json at all', '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('parse_error');
      }
    });

    it('returns validation_error for wrong schema', async () => {
      const jsonLines = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'result', result: JSON.stringify({ wrong_field: true }) }),
      ].join('\n');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonLines, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('validation_error');
      }
    });

    it('returns timeout error when process is killed', async () => {
      const timeoutError = Object.assign(new Error('timeout'), { killed: true });

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
          cb(timeoutError, '', '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema, { timeoutMs: 1000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('timeout');
      }
    });

    it('returns not_installed when ENOENT', async () => {
      const enoentError = Object.assign(new Error('not found'), { code: 'ENOENT' });

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
          cb(enoentError, '', '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('not_installed');
      }
    });

    it('returns quota_exceeded for rate limit errors', async () => {
      const exitError = new Error('exit code 1');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
          cb(exitError, '', 'Error: quota exceeded');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('quota_exceeded');
      }
    });

    it('returns exit_error for generic failures', async () => {
      const exitError = new Error('something went wrong');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
          cb(exitError, '', '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('exit_error');
      }
    });

    it('passes tools and appendSystemPrompt as args, prompt via stdin', async () => {
      const jsonLines = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'result', result: JSON.stringify({ claims: [] }) }),
      ].join('\n');

      const childProc = mockChildProcess();
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonLines, '');
          return childProc;
        },
      );

      await invokeClaudeStructured('test prompt text', TestSchema, {
        allowedTools: ['Read', 'Glob', 'Grep'],
        appendSystemPrompt: 'Be helpful',
        cwd: '/my/repo',
      });

      const callArgs = mockedExecFile.mock.calls[0];
      expect(callArgs[0]).toBe('claude');
      const argList = callArgs[1] as string[];
      expect(argList).toContain('--tools');
      expect(argList).toContain('Read,Glob,Grep');
      expect(argList).toContain('--model');
      expect(argList).toContain('sonnet');
      expect(argList).toContain('--no-session-persistence');
      expect(argList).toContain('--disable-slash-commands');
      expect(argList).toContain('--append-system-prompt');
      expect(argList).toContain('Be helpful');
      expect(callArgs[2].cwd).toBe('/my/repo');

      // Prompt is sent via stdin, not as a positional arg
      expect(argList).not.toContain('test prompt text');
      expect(childProc.stdin.end).toHaveBeenCalledWith('test prompt text');
    });

    it('returns parse_error when no result line in output', async () => {
      const jsonLines = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'assistant', message: {} }),
      ].join('\n');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonLines, '');
          return mockChildProcess();
        },
      );

      const result = await invokeClaudeStructured('test', TestSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('parse_error');
      }
    });

    it('uses no timeout by default', async () => {
      const jsonLines = [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'result', result: JSON.stringify({ claims: [] }) }),
      ].join('\n');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, jsonLines, '');
          return mockChildProcess();
        },
      );

      await invokeClaudeStructured('test', TestSchema);

      const opts = mockedExecFile.mock.calls[0][2];
      expect(opts.timeout).toBe(0);
    });
  });

  describe('extractResultFromOutput', () => {
    it('extracts result from JSON array format', () => {
      const output = JSON.stringify([
        { type: 'system', subtype: 'init', tools: [] },
        { type: 'assistant', message: { content: [] } },
        { type: 'result', result: '{"claims":[]}' },
      ]);

      expect(extractResultFromOutput(output)).toBe('{"claims":[]}');
    });

    it('extracts result from JSON-lines format', () => {
      const output = [
        JSON.stringify({ type: 'system', subtype: 'init', tools: [] }),
        JSON.stringify({ type: 'assistant', message: { content: [] } }),
        JSON.stringify({ type: 'result', result: '{"claims":[]}' }),
      ].join('\n');

      expect(extractResultFromOutput(output)).toBe('{"claims":[]}');
    });

    it('extracts result from legacy single-object envelope', () => {
      const output = JSON.stringify({ result: '{"data":"ok"}' });
      expect(extractResultFromOutput(output)).toBe('{"data":"ok"}');
    });

    it('handles result field as object (not string)', () => {
      const output = JSON.stringify([
        { type: 'system', subtype: 'init' },
        { type: 'result', result: { claims: [{ text: 'hi' }] } },
      ]);

      const parsed = JSON.parse(extractResultFromOutput(output)!);
      expect(parsed.claims[0].text).toBe('hi');
    });

    it('returns null for completely invalid output', () => {
      expect(extractResultFromOutput('garbage data here')).toBeNull();
    });

    it('returns null for JSON array with no result item', () => {
      const output = JSON.stringify([
        { type: 'system', subtype: 'init' },
        { type: 'assistant', message: {} },
      ]);
      expect(extractResultFromOutput(output)).toBeNull();
    });

    it('handles direct JSON data (no envelope, no type field)', () => {
      const output = JSON.stringify({ claims: [{ text: 'direct', type: 'b' }] });
      const parsed = JSON.parse(extractResultFromOutput(output)!);
      expect(parsed.claims[0].text).toBe('direct');
    });
  });
});
