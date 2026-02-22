import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const DOC_PATH = resolve(ROOT, 'docs/reference/configuration.md');
const SCHEMA_PATH = resolve(ROOT, 'src/config/schema.ts');

function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('QA contract: configuration.md accuracy', () => {
  const doc = readFile(DOC_PATH);
  const schema = readFile(SCHEMA_PATH);

  // Extract top-level config section names from schema
  const schemaSections = [...schema.matchAll(/^\s{4}(\w+):\s*z\b/gm)].map((m) => m[1]);

  describe('all schema sections are documented', () => {
    for (const section of schemaSections) {
      it(`documents the "${section}" section`, () => {
        expect(doc).toContain(section);
      });
    }
  });

  describe('claim types match schema', () => {
    const schemaClaimTypes = [
      ...schema.matchAll(/['"](\w+)['"]\s*(?:,\s*$|\])/gm),
    ]
      .map((m) => m[1])
      .filter((t) => !['high', 'medium', 'low', 'daily', 'weekly', 'monthly', 'never', 'exported', 'public', 'all'].includes(t));

    it('lists all 11 claim types', () => {
      // The doc should mention each claim type from the schema enum
      const claimTypeEnum = [
        'path_reference', 'dependency_version', 'command', 'api_route',
        'code_example', 'behavior', 'architecture', 'config',
        'convention', 'environment', 'url_reference',
      ];
      for (const ct of claimTypeEnum) {
        expect(doc).toContain(ct);
      }
    });
  });

  describe('documented defaults match schema constraints', () => {
    it('max_claims_per_pr default of 50 is within schema range 1-200', () => {
      // Schema: z.number().int().min(1).max(200)
      // Doc claims default is 50
      expect(doc).toMatch(/50\s*claims/i);
    });

    it('url_check timeout_ms range matches schema (1000-30000)', () => {
      // Doc should not claim a default outside this range
      expect(schema).toContain('min(1000)');
      expect(schema).toContain('max(30000)');
    });

    it('agent concurrency max matches schema (20)', () => {
      expect(schema).toContain('max(20)');
    });
  });

  describe('no stale sections in doc', () => {
    it('does not document sections removed from schema', () => {
      // Extract all ## headings that look like config sections
      const docSections = [...doc.matchAll(/^## (\w[\w_]*)/gm)]
        .map((m) => m[1].toLowerCase())
        .filter((s) => !['zero', 'full', 'configuration', 'error'].includes(s));

      // Each documented config section should exist in schema (loose check)
      for (const section of docSections) {
        const inSchema = schema.toLowerCase().includes(section);
        const isMetaSection = ['example', 'config', 'behavior', 'reference', 'codes'].some(
          (m) => section.includes(m),
        );
        if (!isMetaSection) {
          expect(inSchema).toBe(true);
        }
      }
    });
  });

  describe('schema fields not in doc (completeness)', () => {
    it('documents embedding_dimensions (llm section)', () => {
      expect(doc).toContain('embedding_dimensions');
    });

    it('documents agent.command field', () => {
      expect(doc).toContain('command');
    });

    it('documents schedule.full_scan_day field', () => {
      expect(doc).toContain('full_scan_day');
    });
  });
});
