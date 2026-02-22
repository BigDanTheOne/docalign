import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// QA-DISPUTE: original had '../../../..' (4 levels up) but test is only 3 dirs deep from repo root
const repoRoot = resolve(__dirname, '../../..');

describe('QA contract: fix-doc-drift — suppressing-findings.md and troubleshooting.md', () => {
  it('docalign check docs/guides/suppressing-findings.md returns 0 drifted claims', () => {
    const result = execSync('npx tsx src/cli/index.ts check docs/guides/suppressing-findings.md', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    // Should report 0 drifted claims (exit code 0 means success)
    expect(result).not.toMatch(/drifted/i);
  });

  it('docalign check docs/troubleshooting.md returns 0 drifted claims', () => {
    const result = execSync('npx tsx src/cli/index.ts check docs/troubleshooting.md', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    expect(result).not.toMatch(/drifted/i);
  });

  it('troubleshooting.md does not reference .claude/mcp.json', () => {
    const content = readFileSync(resolve(repoRoot, 'docs/troubleshooting.md'), 'utf-8');
    expect(content).not.toContain('.claude/mcp.json');
  });

  it('suppressing-findings.md has no malformed docalign:skip nesting', () => {
    const content = readFileSync(resolve(repoRoot, 'docs/guides/suppressing-findings.md'), 'utf-8');
    // Check that every docalign:skip has a matching docalign:end-skip
    const opens = (content.match(/docalign:skip/g) || []).length;
    const closes = (content.match(/docalign:end-skip/g) || []).length;
    expect(opens).toBe(closes);
    // No nested skip blocks (skip inside skip)
    const lines = content.split('\n');
    let depth = 0;
    for (const line of lines) {
      if (line.includes('docalign:skip')) depth++;
      if (line.includes('docalign:end-skip')) depth--;
      expect(depth).toBeLessThanOrEqual(1);
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  });
});
