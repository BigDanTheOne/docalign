function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const;

export function validateConfig(): void {
  requireEnv('DATABASE_URL');
  requireEnv('JWT_SECRET');
}

export type Config = typeof config;
