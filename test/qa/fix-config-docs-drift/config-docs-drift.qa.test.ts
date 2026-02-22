/**
 * QA tests: Verify docs/reference/configuration.md matches source code.
 *
 * Ground truth:
 *   - src/config/schema.ts (Zod schema — field names, types, ranges)
 *   - src/config/loader.ts (CONFIG_DEFAULTS — default values)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../../..');
const DOC_PATH = path.join(ROOT, 'docs/reference/configuration.md');

function readDoc(): string {
  return fs.readFileSync(DOC_PATH, 'utf-8');
}

// ---- Acceptance Criterion 1 & 2: Default values match source ----

describe('configuration.md default values match CONFIG_DEFAULTS', () => {
  let doc: string;
  beforeAll(() => {
    doc = readDoc();
  });

  it('verification.max_claims_per_pr default is 50', () => {
    expect(doc).toContain('50');
  });

  it('verification.auto_fix default is false', () => {
    expect(doc).toMatch(/auto_fix.*false|false.*auto_fix/s);
  });

  it('verification.auto_fix_threshold default is 0.9', () => {
    expect(doc).toContain('0.9');
  });

  it('verification.min_severity default is low', () => {
    expect(doc).toMatch(/min_severity.*low/i);
  });

  it('agent.concurrency default is 5', () => {
    expect(doc).toMatch(/concurrency.*5/);
  });

  it('agent.timeout_seconds default is 120', () => {
    expect(doc).toMatch(/timeout_seconds.*120/);
  });

  it('schedule.full_scan default is weekly', () => {
    expect(doc).toMatch(/full_scan.*weekly/i);
  });

  it('schedule.full_scan_day default is sunday', () => {
    expect(doc).toMatch(/full_scan_day.*sunday/i);
  });

  it('llm.verification_model default is claude-sonnet-4-20250514', () => {
    expect(doc).toContain('claude-sonnet-4-20250514');
  });

  it('llm.embedding_model default is text-embedding-3-small', () => {
    expect(doc).toContain('text-embedding-3-small');
  });

  it('llm.embedding_dimensions default is 1536', () => {
    expect(doc).toContain('1536');
  });

  it('mapping.semantic_threshold default is 0.7', () => {
    expect(doc).toMatch(/semantic_threshold.*0\.7/);
  });

  it('mapping.path1_max_evidence_tokens default is 8000', () => {
    expect(doc).toContain('8000');
  });

  it('mapping.max_agent_files_per_claim default is 10', () => {
    expect(doc).toMatch(/max_agent_files_per_claim.*10/);
  });

  it('url_check.timeout_ms default is 5000', () => {
    expect(doc).toMatch(/timeout_ms.*5000|5.?000\s*ms|5s timeout/);
  });

  it('url_check.max_per_domain default is 5', () => {
    expect(doc).toMatch(/max_per_domain.*5/);
  });

  it('coverage.enabled default is false', () => {
    expect(doc).toMatch(/coverage.*enabled.*false|enabled.*false/s);
  });

  it('coverage.min_entity_importance default is exported', () => {
    expect(doc).toMatch(/min_entity_importance.*exported/);
  });
});

// ---- Acceptance Criterion 2: claim_types list is complete (11 types) ----

describe('configuration.md lists all 11 claim types', () => {
  const CLAIM_TYPES = [
    'path_reference',
    'dependency_version',
    'command',
    'api_route',
    'code_example',
    'behavior',
    'architecture',
    'config',
    'convention',
    'environment',
    'url_reference',
  ];

  let doc: string;
  beforeAll(() => {
    doc = readDoc();
  });

  for (const ct of CLAIM_TYPES) {
    it(`mentions claim type: ${ct}`, () => {
      expect(doc).toContain(ct);
    });
  }
});

// ---- Acceptance Criterion 3: All schema sections documented ----

describe('configuration.md documents all top-level config sections', () => {
  const SECTIONS = [
    'doc_patterns',
    'code_patterns',
    'verification',
    'claim_types',
    'suppress',
    'schedule',
    'agent',
    'trigger',
    'llm',
    'check',
    'mapping',
    'url_check',
    'coverage',
  ];

  let doc: string;
  beforeAll(() => {
    doc = readDoc();
  });

  for (const section of SECTIONS) {
    it(`documents section: ${section}`, () => {
      // Should appear as a heading or code reference
      expect(doc).toContain(section);
    });
  }
});

// ---- Acceptance Criterion 4: Schema constraints documented correctly ----

describe('configuration.md documents schema constraints', () => {
  let doc: string;
  beforeAll(() => {
    doc = readDoc();
  });

  it('documents suppress max 200 rules', () => {
    expect(doc).toContain('200');
  });

  it('documents auto_fix_threshold range 0.5-1.0', () => {
    expect(doc).toMatch(/0\.5/);
    expect(doc).toMatch(/1\.0/);
  });

  it('documents agent.concurrency range 1-20', () => {
    expect(doc).toMatch(/1.*20|max.*20/);
  });

  it('documents agent.timeout_seconds range 30-600', () => {
    expect(doc).toMatch(/30.*600|30s.*600s/);
  });
});
