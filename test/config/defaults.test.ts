import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config/defaults';

const validEnv: Record<string, string> = {
  PORT: '3000',
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  GITHUB_APP_ID: '12345',
  GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\nfake\\n-----END RSA PRIVATE KEY-----',
  GITHUB_WEBHOOK_SECRET: 'webhook-secret',
  DATABASE_URL: 'postgres://localhost:5432/docalign_test',
  REDIS_URL: 'redis://localhost:6379',
  DOCALIGN_API_SECRET: 'api-secret',
};

describe('loadConfig', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses valid environment variables', () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(3000);
    expect(config.node_env).toBe('test');
    expect(config.log_level).toBe('debug');
    expect(config.github_app_id).toBe('12345');
    expect(config.github_webhook_secret).toBe('webhook-secret');
    expect(config.database_url).toBe('postgres://localhost:5432/docalign_test');
    expect(config.redis_url).toBe('redis://localhost:6379');
    expect(config.docalign_api_secret).toBe('api-secret');
  });

  it('uses default values for optional variables', () => {
    const config = loadConfig(validEnv);
    expect(config.docalign_token_ttl_days).toBe(365);
    expect(config.scan_timeout_minutes).toBe(10);
    expect(config.agent_task_timeout_minutes).toBe(30);
    expect(config.retry_per_call_max).toBe(2);
    expect(config.retry_per_job_max).toBe(3);
  });

  it('uses default port when PORT is not set', () => {
    const { PORT: _, ...envWithoutPort } = validEnv;
    const config = loadConfig(envWithoutPort);
    expect(config.port).toBe(8080);
  });

  it('uses default NODE_ENV when not set', () => {
    const { NODE_ENV: _, ...envWithoutNodeEnv } = validEnv;
    const config = loadConfig(envWithoutNodeEnv);
    expect(config.node_env).toBe('production');
  });

  it('uses default LOG_LEVEL when not set', () => {
    const { LOG_LEVEL: _, ...envWithoutLogLevel } = validEnv;
    const config = loadConfig(envWithoutLogLevel);
    expect(config.log_level).toBe('info');
  });

  it('exits with code 1 when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...envWithoutDb } = validEnv;
    expect(() => loadConfig(envWithoutDb)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when GITHUB_APP_ID is missing', () => {
    const { GITHUB_APP_ID: _, ...envWithout } = validEnv;
    expect(() => loadConfig(envWithout)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when REDIS_URL is missing', () => {
    const { REDIS_URL: _, ...envWithout } = validEnv;
    expect(() => loadConfig(envWithout)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when GITHUB_WEBHOOK_SECRET is missing', () => {
    const { GITHUB_WEBHOOK_SECRET: _, ...envWithout } = validEnv;
    expect(() => loadConfig(envWithout)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when DOCALIGN_API_SECRET is missing', () => {
    const { DOCALIGN_API_SECRET: _, ...envWithout } = validEnv;
    expect(() => loadConfig(envWithout)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('converts escaped newlines in GITHUB_PRIVATE_KEY', () => {
    const config = loadConfig(validEnv);
    expect(config.github_private_key).toContain('\n');
    expect(config.github_private_key).not.toContain('\\n');
  });

  it('allows GITHUB_WEBHOOK_SECRET_OLD as optional', () => {
    const envWithOldSecret = { ...validEnv, GITHUB_WEBHOOK_SECRET_OLD: 'old-secret' };
    const config = loadConfig(envWithOldSecret);
    expect(config.github_webhook_secret_old).toBe('old-secret');
  });

  it('sets github_webhook_secret_old to undefined when not provided', () => {
    const config = loadConfig(validEnv);
    expect(config.github_webhook_secret_old).toBeUndefined();
  });

  it('overrides optional numeric defaults when provided', () => {
    const envWithOverrides = {
      ...validEnv,
      DOCALIGN_TOKEN_TTL_DAYS: '90',
      SCAN_TIMEOUT_MINUTES: '20',
      AGENT_TASK_TIMEOUT_MINUTES: '60',
      RETRY_PER_CALL_MAX: '5',
      RETRY_PER_JOB_MAX: '10',
    };
    const config = loadConfig(envWithOverrides);
    expect(config.docalign_token_ttl_days).toBe(90);
    expect(config.scan_timeout_minutes).toBe(20);
    expect(config.agent_task_timeout_minutes).toBe(60);
    expect(config.retry_per_call_max).toBe(5);
    expect(config.retry_per_job_max).toBe(10);
  });
});
