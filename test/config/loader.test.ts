import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { loadDocAlignConfig, CONFIG_DEFAULTS } from '../../src/config/loader';

vi.mock('fs');

const mockReadFileSync = vi.mocked(fs.readFileSync);

describe('loadDocAlignConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Missing / Empty file → defaults ---

  it('returns defaults when file is missing (GATE42-015)', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const { config, warnings } = loadDocAlignConfig();

    expect(warnings).toHaveLength(0);
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  it('returns defaults when file is empty', () => {
    mockReadFileSync.mockReturnValue('');

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  it('returns defaults when file is only whitespace', () => {
    mockReadFileSync.mockReturnValue('   \n  \n  ');

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  it('returns defaults when file is only YAML comments', () => {
    mockReadFileSync.mockReturnValue('# just a comment\n# another comment\n');

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  // --- Valid YAML ---

  it('parses valid YAML and merges with defaults', () => {
    const yaml = `
verification:
  min_severity: "high"
  max_claims_per_pr: 100
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config.verification.min_severity).toBe('high');
    expect(config.verification.max_claims_per_pr).toBe(100);
    // Defaults preserved for unset fields
    expect(config.verification.auto_fix).toBe(false);
    expect(config.verification.auto_fix_threshold).toBe(0.9);
    // Other sections use defaults
    expect(config.doc_patterns).toEqual(CONFIG_DEFAULTS.doc_patterns);
    expect(config.code_patterns).toEqual(CONFIG_DEFAULTS.code_patterns);
  });

  it('parses valid YAML with custom doc_patterns', () => {
    const yaml = `
doc_patterns:
  include:
    - "README.md"
    - "docs/**/*.md"
  exclude:
    - "docs/archive/**"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config.doc_patterns.include).toEqual(['README.md', 'docs/**/*.md']);
    expect(config.doc_patterns.exclude).toEqual(['docs/archive/**']);
  });

  it('parses valid YAML with suppress rules', () => {
    const yaml = `
suppress:
  - file: "README.md"
    pattern: "badge"
  - claim_type: "dependency_version"
    package: "typescript"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config.suppress).toHaveLength(2);
    expect(config.suppress[0]).toEqual({ file: 'README.md', pattern: 'badge' });
    expect(config.suppress[1]).toEqual({ claim_type: 'dependency_version', package: 'typescript' });
  });

  it('parses valid YAML with all sections', () => {
    const yaml = `
verification:
  min_severity: "medium"
  max_claims_per_pr: 30
claim_types:
  architecture: false
  convention: false
schedule:
  full_scan: "daily"
agent:
  concurrency: 10
  timeout_seconds: 180
llm:
  verification_model: "claude-sonnet-4-20250514"
check:
  min_severity_to_block: "medium"
mapping:
  semantic_threshold: 0.65
  path1_max_evidence_tokens: 6000
  max_agent_files_per_claim: 20
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config.verification.min_severity).toBe('medium');
    expect(config.claim_types.architecture).toBe(false);
    expect(config.claim_types.convention).toBe(false);
    // Other claim types remain true (defaults)
    expect(config.claim_types.path_reference).toBe(true);
    expect(config.schedule.full_scan).toBe('daily');
    expect(config.agent.concurrency).toBe(10);
    expect(config.llm.verification_model).toBe('claude-sonnet-4-20250514');
    expect(config.check.min_severity_to_block).toBe('medium');
    expect(config.mapping.semantic_threshold).toBe(0.65);
    expect(config.mapping.path1_max_evidence_tokens).toBe(6000);
    expect(config.mapping.max_agent_files_per_claim).toBe(20);
  });

  // --- Invalid YAML → E501 ---

  it('returns E501 warning and defaults for invalid YAML syntax', () => {
    mockReadFileSync.mockReturnValue('invalid: yaml: [unterminated');

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const yamlWarning = warnings.find((w) => w.message.includes('E501'));
    expect(yamlWarning).toBeDefined();
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  it('returns E501 for YAML that parses to non-object (array)', () => {
    mockReadFileSync.mockReturnValue('- item1\n- item2\n');

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const yamlWarning = warnings.find((w) => w.message.includes('E501'));
    expect(yamlWarning).toBeDefined();
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  // --- Unknown key → E502 with "did you mean?" ---

  it('warns E502 for unknown key with "did you mean?" suggestion', () => {
    const yaml = `
verificationn:
  min_severity: "high"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const unknownKeyWarning = warnings.find(
      (w) => w.message.includes('E502') && w.message.includes('verificationn'),
    );
    expect(unknownKeyWarning).toBeDefined();
    expect(unknownKeyWarning!.message).toContain('Did you mean');
    expect(unknownKeyWarning!.message).toContain('verification');
    // Defaults applied (unknown key ignored)
    expect(config.verification).toEqual(CONFIG_DEFAULTS.verification);
  });

  it('warns E502 for unknown key "checks" suggesting "check"', () => {
    const yaml = `
checks:
  min_severity_to_block: "high"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { warnings } = loadDocAlignConfig('.docalign.yml');

    const unknownKeyWarning = warnings.find(
      (w) => w.message.includes('checks') && w.message.includes('check'),
    );
    expect(unknownKeyWarning).toBeDefined();
  });

  it('warns E502 for completely unknown key without suggestion', () => {
    const yaml = `
zzzzz: true
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const unknownKeyWarning = warnings.find(
      (w) => w.message.includes('E502') && w.message.includes('zzzzz'),
    );
    expect(unknownKeyWarning).toBeDefined();
    expect(unknownKeyWarning!.message).not.toContain('Did you mean');
  });

  // --- Invalid values → E502 + field default ---

  it('warns E502 for invalid enum value and uses field default', () => {
    const yaml = `
verification:
  min_severity: "critical"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const enumWarning = warnings.find((w) => w.message.includes('E502'));
    expect(enumWarning).toBeDefined();
    // Falls back to default for this field
    expect(config.verification.min_severity).toBe(CONFIG_DEFAULTS.verification.min_severity);
  });

  it('warns E502 for type mismatch (string where number expected)', () => {
    const yaml = `
agent:
  concurrency: "five"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const typeWarning = warnings.find((w) => w.message.includes('E502'));
    expect(typeWarning).toBeDefined();
    // Falls back to defaults
    expect(config.agent.concurrency).toBe(CONFIG_DEFAULTS.agent.concurrency);
  });

  it('warns E502 for range violation (max_claims_per_pr > 200)', () => {
    const yaml = `
verification:
  max_claims_per_pr: 500
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const rangeWarning = warnings.find((w) => w.message.includes('E502'));
    expect(rangeWarning).toBeDefined();
    expect(config.verification.max_claims_per_pr).toBe(CONFIG_DEFAULTS.verification.max_claims_per_pr);
  });

  // --- Invalid regex in suppress ---

  it('warns E502 for invalid regex in suppress pattern', () => {
    const yaml = `
suppress:
  - file: "README.md"
    pattern: "[invalid("
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const regexWarning = warnings.find(
      (w) => w.message.includes('E502') && w.message.includes('regex'),
    );
    expect(regexWarning).toBeDefined();
  });

  // --- Multiple errors reported ---

  it('reports multiple errors all at once', () => {
    const yaml = `
verificationn:
  min_severity: "high"
zzzzz: true
agent:
  concurrency: "ten"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    // Should have at least warnings for: verificationn (unknown), zzzzz (unknown), concurrency (type)
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    const unknownWarnings = warnings.filter((w) => w.message.includes('Unknown key'));
    expect(unknownWarnings.length).toBeGreaterThanOrEqual(2);
    // Config falls back to defaults for invalid fields
    expect(config.agent.concurrency).toBe(CONFIG_DEFAULTS.agent.concurrency);
  });

  // --- Zod strict mode ---

  it('rejects additional properties via Zod strict mode', () => {
    const yaml = `
extra_field: true
verification:
  min_severity: "high"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const strictWarning = warnings.find(
      (w) => w.message.includes('extra_field'),
    );
    expect(strictWarning).toBeDefined();
    // Valid fields still work
    expect(config.verification.min_severity).toBe('high');
  });

  // --- Deep merge behavior ---

  it('deep merges nested objects (partial verification)', () => {
    const yaml = `
verification:
  auto_fix: true
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    expect(config.verification.auto_fix).toBe(true);
    // Other verification defaults preserved
    expect(config.verification.min_severity).toBe('low');
    expect(config.verification.max_claims_per_pr).toBe(50);
    expect(config.verification.auto_fix_threshold).toBe(0.9);
  });

  it('replaces arrays entirely (does not merge)', () => {
    const yaml = `
doc_patterns:
  include:
    - "custom/**/*.md"
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { config, warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    // Array replaced entirely, not merged with defaults
    expect(config.doc_patterns.include).toEqual(['custom/**/*.md']);
    // Exclude still gets default because it wasn't specified
    expect(config.doc_patterns.exclude).toEqual(CONFIG_DEFAULTS.doc_patterns.exclude);
  });

  // --- Custom file path ---

  it('reads from custom file path', () => {
    mockReadFileSync.mockReturnValue('verification:\n  min_severity: "high"\n');

    const { config } = loadDocAlignConfig('/custom/path/.docalign.yml');

    expect(mockReadFileSync).toHaveBeenCalledWith('/custom/path/.docalign.yml', 'utf-8');
    expect(config.verification.min_severity).toBe('high');
  });

  // --- trigger section in schema ---

  it('parses trigger section from YAML', () => {
    const yaml = `
trigger:
  on_pr_open: true
  on_push: true
`;
    mockReadFileSync.mockReturnValue(yaml);

    const { warnings } = loadDocAlignConfig('.docalign.yml');

    expect(warnings).toHaveLength(0);
    // trigger is in the schema but not in CONFIG_DEFAULTS type,
    // so we just verify it doesn't cause warnings
  });
});

describe('CONFIG_DEFAULTS', () => {
  it('has all required top-level sections', () => {
    expect(CONFIG_DEFAULTS.doc_patterns).toBeDefined();
    expect(CONFIG_DEFAULTS.code_patterns).toBeDefined();
    expect(CONFIG_DEFAULTS.verification).toBeDefined();
    expect(CONFIG_DEFAULTS.claim_types).toBeDefined();
    expect(CONFIG_DEFAULTS.suppress).toBeDefined();
    expect(CONFIG_DEFAULTS.schedule).toBeDefined();
    expect(CONFIG_DEFAULTS.agent).toBeDefined();
    expect(CONFIG_DEFAULTS.llm).toBeDefined();
    expect(CONFIG_DEFAULTS.check).toBeDefined();
    expect(CONFIG_DEFAULTS.mapping).toBeDefined();
  });

  it('has correct default verification values', () => {
    expect(CONFIG_DEFAULTS.verification.min_severity).toBe('low');
    expect(CONFIG_DEFAULTS.verification.max_claims_per_pr).toBe(50);
    expect(CONFIG_DEFAULTS.verification.auto_fix).toBe(false);
    expect(CONFIG_DEFAULTS.verification.auto_fix_threshold).toBe(0.9);
  });

  it('has all 10 claim types enabled by default', () => {
    const claimTypes = CONFIG_DEFAULTS.claim_types;
    expect(claimTypes.path_reference).toBe(true);
    expect(claimTypes.dependency_version).toBe(true);
    expect(claimTypes.command).toBe(true);
    expect(claimTypes.api_route).toBe(true);
    expect(claimTypes.code_example).toBe(true);
    expect(claimTypes.behavior).toBe(true);
    expect(claimTypes.architecture).toBe(true);
    expect(claimTypes.config).toBe(true);
    expect(claimTypes.convention).toBe(true);
    expect(claimTypes.environment).toBe(true);
  });

  it('has empty suppress array by default', () => {
    expect(CONFIG_DEFAULTS.suppress).toEqual([]);
  });

  it('has correct schedule defaults', () => {
    expect(CONFIG_DEFAULTS.schedule.full_scan).toBe('weekly');
    expect(CONFIG_DEFAULTS.schedule.full_scan_day).toBe('sunday');
  });

  it('has correct LLM defaults', () => {
    expect(CONFIG_DEFAULTS.llm.verification_model).toBe('claude-sonnet-4-20250514');
    expect(CONFIG_DEFAULTS.llm.extraction_model).toBe('claude-sonnet-4-20250514');
    expect(CONFIG_DEFAULTS.llm.embedding_model).toBe('text-embedding-3-small');
    expect(CONFIG_DEFAULTS.llm.embedding_dimensions).toBe(1536);
  });
});
