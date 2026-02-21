/**
 * QA: T1 — Validate Existing Implementation
 * Gate task: ensures build, typecheck, tests, and lint pass on feature/90f449b1
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

const REPO_ROOT = process.env.REPO_ROOT || process.cwd();

function run(cmd: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e: any) {
    return { exitCode: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('T1: Validate Existing Implementation', () => {
  it('TypeScript compilation succeeds (tsc --noEmit)', () => {
    const result = run('npx tsc --noEmit');
    expect(result.exitCode, `TypeCheck failed:\n${result.stderr}\n${result.stdout}`).toBe(0);
  });

  it('npm run build succeeds', () => {
    const result = run('npm run build');
    expect(result.exitCode, `Build failed:\n${result.stderr}\n${result.stdout}`).toBe(0);
  });

  it('unit tests pass (npm test)', () => {
    const result = run('npx vitest run --exclude "test/qa/**"');
    expect(result.exitCode, `Tests failed:\n${result.stderr}\n${result.stdout}`).toBe(0);
  });

  it('existing QA tests pass', () => {
    const result = run('npx vitest run test/qa/ --reporter=verbose');
    expect(result.exitCode, `QA tests failed:\n${result.stderr}\n${result.stdout}`).toBe(0);
  });

  it('lint passes', () => {
    const result = run('npm run lint');
    expect(result.exitCode, `Lint failed:\n${result.stderr}\n${result.stdout}`).toBe(0);
  });
});
