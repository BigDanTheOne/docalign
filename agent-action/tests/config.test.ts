import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadActionConfig, requireEnv } from '../src/config';
import fs from 'fs';

vi.mock('fs');

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('File not found');
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function setRequiredEnvVars() {
    process.env.INPUT_DOCALIGN_TOKEN = 'docalign_test123';
    process.env.INPUT_DOCALIGN_SERVER_URL = 'https://api.docalign.dev';
    process.env.INPUT_ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.INPUT_SCAN_RUN_ID = 'scan-123';
    process.env.INPUT_REPO_ID = 'repo-456';
  }

  describe('requireEnv', () => {
    it('returns value when set', () => {
      process.env.TEST_VAR = 'hello';
      expect(requireEnv('TEST_VAR')).toBe('hello');
    });

    it('throws when not set', () => {
      delete process.env.MISSING_VAR;
      expect(() => requireEnv('MISSING_VAR')).toThrow('Required environment variable MISSING_VAR is not set');
    });
  });

  describe('loadActionConfig', () => {
    it('loads config from env vars with defaults', () => {
      setRequiredEnvVars();
      const config = loadActionConfig();

      expect(config.docalignToken).toBe('docalign_test123');
      expect(config.serverUrl).toBe('https://api.docalign.dev');
      expect(config.anthropicApiKey).toBe('sk-ant-test');
      expect(config.openaiApiKey).toBeNull();
      expect(config.scanRunId).toBe('scan-123');
      expect(config.repoId).toBe('repo-456');
      expect(config.maxTasks).toBe(100);
      expect(config.pollIntervalMs).toBe(2000);
    });

    it('strips trailing slash from server URL', () => {
      setRequiredEnvVars();
      process.env.INPUT_DOCALIGN_SERVER_URL = 'https://api.docalign.dev/';
      const config = loadActionConfig();
      expect(config.serverUrl).toBe('https://api.docalign.dev');
    });

    it('uses default LLM config when no .docalign.yml', () => {
      setRequiredEnvVars();
      const config = loadActionConfig();

      expect(config.llm.verificationModel).toBe('claude-sonnet-4-5-20250929');
      expect(config.llm.extractionModel).toBe('claude-sonnet-4-5-20250929');
      expect(config.llm.triageModel).toBe('claude-haiku-3-5-20241022');
      expect(config.llm.embeddingModel).toBe('text-embedding-3-small');
      expect(config.llm.embeddingDimensions).toBe(1536);
    });

    it('reads LLM config from .docalign.yml', () => {
      setRequiredEnvVars();
      vi.mocked(fs.readFileSync).mockReturnValue(`
llm:
  verification_model: claude-custom-model
  triage_model: claude-custom-triage
`);
      const config = loadActionConfig();

      expect(config.llm.verificationModel).toBe('claude-custom-model');
      expect(config.llm.triageModel).toBe('claude-custom-triage');
      expect(config.llm.extractionModel).toBe('claude-sonnet-4-5-20250929'); // default
    });

    it('uses custom max_tasks and poll_interval_ms', () => {
      setRequiredEnvVars();
      process.env.INPUT_MAX_TASKS = '50';
      process.env.INPUT_POLL_INTERVAL_MS = '5000';
      const config = loadActionConfig();

      expect(config.maxTasks).toBe(50);
      expect(config.pollIntervalMs).toBe(5000);
    });

    it('reads OpenAI API key when provided', () => {
      setRequiredEnvVars();
      process.env.INPUT_OPENAI_API_KEY = 'sk-openai-test';
      const config = loadActionConfig();
      expect(config.openaiApiKey).toBe('sk-openai-test');
    });

    it('throws when required env vars are missing', () => {
      expect(() => loadActionConfig()).toThrow('Required environment variable');
    });

    it('handles empty .docalign.yml', () => {
      setRequiredEnvVars();
      vi.mocked(fs.readFileSync).mockReturnValue('');
      const config = loadActionConfig();
      expect(config.llm.verificationModel).toBe('claude-sonnet-4-5-20250929');
    });

    it('handles invalid YAML gracefully', () => {
      setRequiredEnvVars();
      vi.mocked(fs.readFileSync).mockReturnValue('{{invalid yaml');
      const config = loadActionConfig();
      expect(config.llm.verificationModel).toBe('claude-sonnet-4-5-20250929');
    });

    it('uses GITHUB_RUN_ID for action_run_id', () => {
      setRequiredEnvVars();
      process.env.GITHUB_RUN_ID = 'run-789';
      const config = loadActionConfig();
      expect(config.actionRunId).toBe('run-789');
    });
  });
});
