import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');

describe('Deployment Configuration', () => {
  describe('railway.toml', () => {
    const content = fs.readFileSync(path.join(ROOT, 'railway.toml'), 'utf-8');

    it('has correct build command', () => {
      expect(content).toContain('buildCommand = "npm run build && npm run migrate:up"');
    });

    it('has correct start command', () => {
      expect(content).toContain('startCommand = "node dist/app.js"');
    });

    it('has healthcheck at /health', () => {
      expect(content).toContain('healthcheckPath = "/health"');
    });

    it('has restart policy ON_FAILURE', () => {
      expect(content).toContain('restartPolicyType = "ON_FAILURE"');
    });
  });

  describe('.env.example', () => {
    const content = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf-8');

    const REQUIRED_VARS = [
      'DATABASE_URL',
      'REDIS_URL',
      'GITHUB_APP_ID',
      'GITHUB_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'DOCALIGN_API_SECRET',
    ];

    const OPTIONAL_VARS = [
      'PORT',
      'NODE_ENV',
      'LOG_LEVEL',
      'GITHUB_WEBHOOK_SECRET_OLD',
      'DOCALIGN_TOKEN_TTL_DAYS',
      'SCAN_TIMEOUT_MINUTES',
      'AGENT_TASK_TIMEOUT_MINUTES',
      'RETRY_PER_CALL_MAX',
      'RETRY_PER_JOB_MAX',
    ];

    for (const v of REQUIRED_VARS) {
      it(`lists required env var ${v}`, () => {
        expect(content).toContain(v);
      });
    }

    for (const v of OPTIONAL_VARS) {
      it(`lists optional env var ${v}`, () => {
        expect(content).toContain(v);
      });
    }
  });

  describe('docker-compose.yml', () => {
    const content = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf-8');

    it('uses pgvector/pgvector:pg16 image', () => {
      expect(content).toContain('pgvector/pgvector:pg16');
    });

    it('exposes PostgreSQL on port 5432', () => {
      expect(content).toContain('5432:5432');
    });

    it('uses redis:7-alpine image', () => {
      expect(content).toContain('redis:7-alpine');
    });

    it('exposes Redis on port 6379', () => {
      expect(content).toContain('6379:6379');
    });

    it('has PostgreSQL healthcheck', () => {
      expect(content).toContain('pg_isready');
    });

    it('has Redis healthcheck', () => {
      expect(content).toContain('redis-cli');
    });
  });

  describe('Procfile', () => {
    const content = fs.readFileSync(path.join(ROOT, 'Procfile'), 'utf-8');

    it('defines web process', () => {
      expect(content).toContain('web: node dist/app.js');
    });
  });
});
