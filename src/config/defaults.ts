import { z } from 'zod';
import type { ServerConfig } from '../shared/types';

const serverConfigSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
  GITHUB_PRIVATE_KEY: z.string().min(1, 'GITHUB_PRIVATE_KEY is required'),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  GITHUB_WEBHOOK_SECRET_OLD: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  DOCALIGN_API_SECRET: z.string().min(1, 'DOCALIGN_API_SECRET is required'),
  DOCALIGN_TOKEN_TTL_DAYS: z.coerce.number().default(365),
  SCAN_TIMEOUT_MINUTES: z.coerce.number().default(10),
  AGENT_TASK_TIMEOUT_MINUTES: z.coerce.number().default(30),
  RETRY_PER_CALL_MAX: z.coerce.number().default(2),
  RETRY_PER_JOB_MAX: z.coerce.number().default(3),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const result = serverConfigSchema.safeParse(env);

  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    console.error(`Missing or invalid environment variables: ${missing}`);
    process.exit(1);
  }

  const parsed = result.data;

  return {
    port: parsed.PORT,
    node_env: parsed.NODE_ENV,
    log_level: parsed.LOG_LEVEL,
    github_app_id: parsed.GITHUB_APP_ID,
    github_private_key: parsed.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    github_webhook_secret: parsed.GITHUB_WEBHOOK_SECRET,
    github_webhook_secret_old: parsed.GITHUB_WEBHOOK_SECRET_OLD,
    database_url: parsed.DATABASE_URL,
    redis_url: parsed.REDIS_URL,
    docalign_api_secret: parsed.DOCALIGN_API_SECRET,
    docalign_token_ttl_days: parsed.DOCALIGN_TOKEN_TTL_DAYS,
    scan_timeout_minutes: parsed.SCAN_TIMEOUT_MINUTES,
    agent_task_timeout_minutes: parsed.AGENT_TASK_TIMEOUT_MINUTES,
    retry_per_call_max: parsed.RETRY_PER_CALL_MAX,
    retry_per_job_max: parsed.RETRY_PER_JOB_MAX,
  };
}
