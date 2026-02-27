import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

// QA-FIX: Original had 4 parent traversals but test file is only 3 levels deep from repo root
const ROOT = resolve(__dirname, '..', '..', '..');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
const actionYml = parseYaml(readFileSync(resolve(ROOT, 'agent-action', 'action.yml'), 'utf-8'));

describe('CI/CD Usage Section', () => {
  it('README has a CI/CD section heading', () => {
    expect(readme).toMatch(/^##\s+CI\/CD/m);
  });

  it('CI/CD section appears after Quick Start', () => {
    const qsIndex = readme.search(/^##\s+Quick Start/m);
    const ciIndex = readme.search(/^##\s+CI\/CD/m);
    // If Quick Start doesn't exist yet, just verify CI/CD exists
    if (qsIndex !== -1) {
      expect(ciIndex).toBeGreaterThan(qsIndex);
    }
    expect(ciIndex).not.toBe(-1);
  });

  it('contains a GitHub Actions workflow YAML code block', () => {
    // Extract the CI/CD section
    const ciMatch = readme.match(/^##\s+CI\/CD[\s\S]*?(?=^## |\Z)/m);
    expect(ciMatch).not.toBeNull();
    const section = ciMatch![0];
    // Should have a yaml code fence
    expect(section).toMatch(/```ya?ml/);
  });

  it('workflow YAML is valid parseable YAML', () => {
    const ciSection = readme.match(/^##\s+CI\/CD[\s\S]*?(?=^## |\Z)/m)![0];
    const yamlMatch = ciSection.match(/```ya?ml\n([\s\S]*?)```/);
    expect(yamlMatch).not.toBeNull();
    const parsed = parseYaml(yamlMatch![1]);
    expect(parsed).toBeDefined();
  });

  it('workflow YAML is ≤25 lines', () => {
    const ciSection = readme.match(/^##\s+CI\/CD[\s\S]*?(?=^## |\Z)/m)![0];
    const yamlMatch = ciSection.match(/```ya?ml\n([\s\S]*?)```/);
    expect(yamlMatch).not.toBeNull();
    const lines = yamlMatch![1].trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(25);
  });

  it('references only inputs that exist in action.yml', () => {
    const ciSection = readme.match(/^##\s+CI\/CD[\s\S]*?(?=^## |\Z)/m)![0];
    const yamlMatch = ciSection.match(/```ya?ml\n([\s\S]*?)```/);
    expect(yamlMatch).not.toBeNull();
    const workflow = yamlMatch![1];
    // Extract "with:" inputs from the workflow
    const withMatch = workflow.match(/with:\s*\n((?:\s+\w+:.*\n?)*)/);
    if (withMatch) {
      const inputLines = withMatch[1].match(/^\s+(\w+):/gm) || [];
      const validInputs = Object.keys(actionYml.inputs);
      for (const line of inputLines) {
        const inputName = line.trim().replace(':', '');
        expect(validInputs).toContain(inputName);
      }
    }
  });

  it('mentions --format=github-pr', () => {
    const ciSection = readme.match(/^##\s+CI\/CD[\s\S]*?(?=^## |\Z)/m)![0];
    expect(ciSection).toContain('--format=github-pr');
  });

  it('mentions ANTHROPIC_API_KEY', () => {
    const ciSection = readme.match(/^##\s+CI\/CD[\s\S]*?(?=^## |\Z)/m)![0];
    expect(ciSection).toContain('ANTHROPIC_API_KEY');
  });
});
