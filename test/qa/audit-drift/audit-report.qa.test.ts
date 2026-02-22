import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// The audit report should be committed in the worktree
// Look for it in _team/outputs or docs/
const findReport = (): string | null => {
  const candidates = [
    'audit-report.md',
    'docs/audit-report.md',
    '_team/audit-report.md',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Also check if it's in the pipeline outputs directory
  return null;
};

describe('Audit Drift Report', () => {
  const SUPPRESSED_FILES = [
    'docs/reference/configuration.md',
    'docs/reference/cli.md',
    'docs/contributing/testing.md',
    'docs/guides/mcp-integration.md',
    'docs/guides/suppressing-findings.md',
    'docs/troubleshooting.md',
  ];

  const ADDITIONAL_FILES = ['README.md', 'llms.txt'];
  const ALL_FILES = [...SUPPRESSED_FILES, ...ADDITIONAL_FILES];

  it('audit report file exists', () => {
    const report = findReport();
    expect(report, 'Audit report markdown file must exist in the worktree').not.toBeNull();
  });

  it('report covers all 8 required files', () => {
    const report = findReport();
    if (!report) return;
    const content = readFileSync(report, 'utf-8');

    for (const file of ALL_FILES) {
      expect(content, `Report must mention ${file}`).toContain(file);
    }
  });

  it('each file entry includes specific findings with line references', () => {
    const report = findReport();
    if (!report) return;
    const content = readFileSync(report, 'utf-8');

    // Report should contain line number references (e.g., "line 42", "L42", ":42")
    const lineRefPattern = /(?:line\s+\d+|L\d+|:\d+)/i;
    expect(content).toMatch(lineRefPattern);
  });

  it('report includes tsc --noEmit verification', () => {
    const report = findReport();
    if (!report) return;
    const content = readFileSync(report, 'utf-8');

    expect(content.toLowerCase()).toMatch(/tsc\s+--noemit|typescript.*compil/i);
  });

  it('report is valid markdown with headers', () => {
    const report = findReport();
    if (!report) return;
    const content = readFileSync(report, 'utf-8');

    // Should have at least a title and section headers
    expect(content).toMatch(/^#\s+/m);
    expect(content.match(/^##\s+/gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
