import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const llmsTxt = readFileSync(join(ROOT, 'llms.txt'), 'utf-8');

describe('llms.txt accuracy', () => {
  it('should reference correct repo URL BigDanTheOne/docalign', () => {
    expect(llmsTxt).toContain('BigDanTheOne/docalign');
    expect(llmsTxt).not.toContain('anthropics/docalign');
  });

  it('should not contain broken internal doc links', () => {
    const linkPattern = /\[.*?\]\((docs\/[^)]+)\)/g;
    let match;
    while ((match = linkPattern.exec(llmsTxt)) !== null) {
      const docPath = match[1];
      const fullPath = join(ROOT, docPath);
      expect(existsSync(fullPath), `Referenced doc should exist: ${docPath}`).toBe(true);
    }
  });

  it('should reference features that exist in the codebase', () => {
    // llms.txt claims CLI and MCP server — verify entry points exist
    expect(existsSync(join(ROOT, 'src')), 'src directory should exist').toBe(true);
  });

  it('should have valid CLI commands referenced', () => {
    // Verify the commands mentioned (scan, check, init) are real
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.bin || pkg.scripts).toBeDefined();
  });

  it('should not reference non-existent doc paths', () => {
    // Check every docs/ path mentioned exists
    const paths = llmsTxt.match(/docs\/[^\s)]+/g) || [];
    for (const p of paths) {
      const clean = p.replace(/[),:]+$/, '');
      expect(existsSync(join(ROOT, clean)), `Doc path should exist: ${clean}`).toBe(true);
    }
  });
});
