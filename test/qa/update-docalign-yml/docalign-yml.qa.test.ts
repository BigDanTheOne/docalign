import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(ROOT, '.docalign.yml');

describe('.docalign.yml update and validation', () => {
  let config: any;

  it('should be valid YAML', () => {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    config = parseYaml(content);
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  it('should have suppress section as array or be absent', () => {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    config = parseYaml(content);
    if (config.suppress !== undefined) {
      expect(Array.isArray(config.suppress)).toBe(true);
    }
  });

  it('should have at most 3 remaining suppressions (≥50% reduction from 6)', () => {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    config = parseYaml(content);
    const suppressCount = config.suppress ? config.suppress.length : 0;
    expect(suppressCount).toBeLessThanOrEqual(3);
  });

  it('should preserve required config sections', () => {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    config = parseYaml(content);
    expect(config.doc_patterns).toBeDefined();
    expect(config.verification).toBeDefined();
    expect(config.claim_types).toBeDefined();
  });
});
