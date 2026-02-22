import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const EXAMPLE_PATH = resolve(__dirname, '../../../../.github/workflows/docalign.yml.example');

describe('QA contract: GitHub Actions workflow example', () => {
  it('example workflow file exists', () => {
    expect(existsSync(EXAMPLE_PATH)).toBe(true);
  });

  it('is valid YAML', () => {
    const content = readFileSync(EXAMPLE_PATH, 'utf-8');
    const parsed = parseYaml(content);
    expect(parsed).toBeDefined();
    expect(parsed).toHaveProperty('name');
    expect(parsed).toHaveProperty('on');
    expect(parsed).toHaveProperty('jobs');
  });

  it('triggers on pull_request', () => {
    const content = readFileSync(EXAMPLE_PATH, 'utf-8');
    const parsed = parseYaml(content);
    const trigger = parsed.on;
    expect(trigger).toHaveProperty('pull_request');
  });

  it('references ./action as the action', () => {
    const content = readFileSync(EXAMPLE_PATH, 'utf-8');
    expect(content).toContain('./action');
  });

  it('demonstrates key inputs from action.yml', () => {
    const content = readFileSync(EXAMPLE_PATH, 'utf-8');
    // Must reference these inputs
    expect(content).toContain('anthropic-api-key');
    expect(content).toContain('min-severity');
    expect(content).toContain('fail-on-drift');
  });

  it('uses secrets pattern, not hardcoded keys', () => {
    const content = readFileSync(EXAMPLE_PATH, 'utf-8');
    expect(content).toContain('secrets.');
    // Should not contain actual API key patterns
    expect(content).not.toMatch(/sk-ant-[a-zA-Z0-9]/);
  });
});
