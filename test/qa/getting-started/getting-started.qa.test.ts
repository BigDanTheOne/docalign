import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DOCS_ROOT = resolve(__dirname, '../../../../docs');
const GUIDE_PATH = resolve(DOCS_ROOT, 'getting-started.md');

describe('QA contract: getting-started.md guide', () => {
  it('file exists', () => {
    expect(existsSync(GUIDE_PATH)).toBe(true);
  });

  it('has docalign.monitored frontmatter', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8');
    expect(content).toMatch(/docalign[\s\S]*monitored:\s*true/);
  });

  it('is ≤500 lines', () => {
    const lines = readFileSync(GUIDE_PATH, 'utf-8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it('covers the full onboarding flow sections', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8').toLowerCase();
    expect(content).toMatch(/install/);
    expect(content).toMatch(/init/);
    expect(content).toMatch(/scan/);
    expect(content).toMatch(/reading results|understanding output/);
  });

  it('has Understanding Output subsection with verdict, severity, health score', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8').toLowerCase();
    expect(content).toMatch(/verdict/);
    expect(content).toMatch(/severity/);
    expect(content).toMatch(/health.?score/);
  });

  it('has MCP Integration subsection', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8').toLowerCase();
    expect(content).toMatch(/mcp/);
  });

  it('has troubleshooting section', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8').toLowerCase();
    expect(content).toMatch(/troubleshoot/);
  });

  it('links to reference and guide docs', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8');
    expect(content).toMatch(/cli\.md/);
    expect(content).toMatch(/mcp-integration\.md/);
    expect(content).toMatch(/how-it-works\.md/);
  });

  it('does not contain placeholder paths or fake output markers', () => {
    const content = readFileSync(GUIDE_PATH, 'utf-8');
    expect(content).not.toMatch(/\/path\/to\//);
    expect(content).not.toMatch(/TODO/i);
    expect(content).not.toMatch(/PLACEHOLDER/i);
  });
});
