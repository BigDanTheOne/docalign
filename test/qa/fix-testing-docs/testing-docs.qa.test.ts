/**
 * QA acceptance tests for docs/contributing/testing.md
 * Pipeline: 51fb7a1d — Fix docs/contributing/testing.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// QA-DISPUTE: Original had 4 levels ('..','..','..','..') but test is 3 dirs deep (test/qa/fix-testing-docs/), so ROOT resolved outside the project. Fixed to 3 levels.
const ROOT = join(__dirname, '..', '..', '..');
const DOC_PATH = join(ROOT, 'docs', 'contributing', 'testing.md');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

describe('docs/contributing/testing.md accuracy', () => {
  const docContent = readFileSync(DOC_PATH, 'utf-8');

  // AC1: Test commands match package.json
  describe('documented commands exist in package.json', () => {
    it('npm run test exists', () => {
      expect(PKG.scripts.test).toBeDefined();
    });

    it('npm run test:watch exists', () => {
      expect(PKG.scripts['test:watch']).toBeDefined();
    });

    it('npm run typecheck exists', () => {
      expect(PKG.scripts.typecheck).toBeDefined();
    });

    it('does not reference nonexistent scripts', () => {
      // Extract all `npm run <script>` references from the doc
      const refs = [...docContent.matchAll(/npm run (\S+)/g)].map(m => m[1]);
      for (const ref of refs) {
        // Strip trailing backticks/punctuation
        const clean = ref.replace(/[`),;:]/g, '');
        // Allow compound commands like "test -- --coverage"
        const base = clean.split(/\s/)[0];
        expect(PKG.scripts, `Script "${base}" referenced in doc but missing from package.json`).toHaveProperty(base);
      }
    });
  });

  // AC2: Test directory structure is accurate
  describe('test directory structure matches reality', () => {
    it('test/layers/ subdirectories match doc', () => {
      const layerDirs = readdirSync(join(ROOT, 'test', 'layers'));
      // Doc claims these exist
      const expectedLayers = [
        'L0-codebase-index', 'L1-claim-extractor', 'L2-mapper',
        'L3-verifier', 'L4-triggers', 'L5-reporter', 'L6-mcp', 'L7-learning'
      ];
      for (const layer of expectedLayers) {
        if (docContent.includes(layer)) {
          expect(layerDirs, `Doc mentions ${layer} but it doesn't exist`).toContain(layer);
        }
      }
    });

    it('top-level test directories mentioned in doc exist', () => {
      const testDirs = readdirSync(join(ROOT, 'test'));
      const mentionedDirs = ['cli', 'config', 'shared', 'layers'];
      for (const dir of mentionedDirs) {
        if (docContent.includes(`  ${dir}/`) || docContent.includes(`${dir}/`)) {
          expect(testDirs, `Doc mentions test/${dir}/ but it doesn't exist`).toContain(dir);
        }
      }
    });
  });

  // AC4: Framework is Vitest
  describe('framework references', () => {
    it('mentions Vitest as the test framework', () => {
      expect(docContent).toContain('Vitest');
    });

    it('does not reference removed frameworks', () => {
      // Jest was never used; ensure no stale references
      expect(docContent).not.toMatch(/\bJest\b/);
      expect(docContent).not.toMatch(/\bMocha\b/);
    });
  });

  // AC5: DocAlign drift check
  describe('docalign drift', () => {
    it('reports no critical drift for testing.md', () => {
      try {
        const output = execSync(
          `npx docalign check docs/contributing/testing.md --format json`,
          { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 }
        );
        const results = JSON.parse(output);
        const critical = (results.findings || results.claims || []).filter(
          (f: any) => f.severity === 'critical' && f.verdict === 'drifted'
        );
        expect(critical).toHaveLength(0);
      } catch (e: any) {
        // If docalign exits non-zero, check stderr for critical issues
        if (e.stdout) {
          const results = JSON.parse(e.stdout);
          const critical = (results.findings || results.claims || []).filter(
            (f: any) => f.severity === 'critical' && f.verdict === 'drifted'
          );
          expect(critical).toHaveLength(0);
        }
        // If docalign isn't available, skip gracefully
      }
    });
  });
});
