/**
 * QA Tests: T6 — README and Documentation Update
 * 
 * These tests verify that the README properly documents the GitHub Action,
 * CLI flags, and example workflow after the PR Comment Integration feature.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../../..');
const readme = () => readFileSync(resolve(ROOT, 'README.md'), 'utf-8');

describe('T6: README and Documentation Update', () => {
  
  describe('GitHub Action documentation', () => {
    it('should have a GitHub Action / CI section in README', () => {
      const content = readme();
      expect(content).toMatch(/github\s*action/i);
    });

    it('should document action inputs: github-token, anthropic-api-key, min-severity', () => {
      const content = readme();
      expect(content).toMatch(/github-token/);
      expect(content).toMatch(/anthropic-api-key/i);
      expect(content).toMatch(/min-severity/);
    });

    it('should document required permissions (pull-requests: write)', () => {
      const content = readme();
      expect(content).toMatch(/pull-requests:\s*write/);
    });

    it('should include a workflow YAML example', () => {
      const content = readme();
      // Should have a fenced code block with uses: and docalign
      expect(content).toMatch(/```ya?ml[\s\S]*?uses:[\s\S]*?```/);
    });
  });

  describe('CLI flags documentation', () => {
    it('should document --min-severity flag', () => {
      const content = readme();
      expect(content).toMatch(/--min-severity/);
    });

    it('should document --format github-pr', () => {
      const content = readme();
      expect(content).toMatch(/--format\s+github-pr|github-pr/);
    });
  });

  describe('Internal links', () => {
    it('should not reference non-existent doc files', () => {
      const content = readme();
      const linkPattern = /\[.*?\]\((docs\/[^)]+)\)/g;
      let match;
      while ((match = linkPattern.exec(content)) !== null) {
        const target = resolve(ROOT, match[1]);
        expect(existsSync(target), `Broken link: ${match[1]}`).toBe(true);
      }
    });
  });

  describe('action.yml exists and is valid', () => {
    it('should have action/action.yml in the repo', () => {
      expect(existsSync(resolve(ROOT, 'action/action.yml'))).toBe(true);
    });
  });
});
