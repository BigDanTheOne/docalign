/**
 * Infrastructure availability guards for tests.
 *
 * Tests that need Redis or PostgreSQL should use these guards
 * so they gracefully skip when services are unavailable.
 *
 * Usage:
 *   import { POSTGRES_AVAILABLE, REDIS_AVAILABLE } from '../infra-guard';
 *   describe.skipIf(!POSTGRES_AVAILABLE)('my pg tests', () => { ... });
 */
import { execSync } from 'child_process';

function portOpen(port: number): boolean {
  try {
    execSync(
      `node -e "const s=require('net').createConnection(${port},'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));s.setTimeout(800,()=>{s.destroy();process.exit(1)})"`,
      { timeout: 2000, stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

export const POSTGRES_AVAILABLE = portOpen(5432);
export const REDIS_AVAILABLE = portOpen(6379);
