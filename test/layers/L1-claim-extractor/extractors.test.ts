import { describe, it, expect } from 'vitest';
import type { PreProcessedDoc, RawExtraction } from '../../../src/shared/types';
import {
  extractPaths,
  extractApiRoutes,
  extractCommands,
  extractDependencyVersions,
  extractCodeExamples,
  deduplicateWithinFile,
  getIdentityKey,
  generateKeywords,
  isValidPath,
} from '../../../src/layers/L1-claim-extractor/extractors';

// Helper: build a PreProcessedDoc from raw content
function makeDoc(content: string): PreProcessedDoc {
  const lines = content.split('\n');
  const lineMap: number[] = lines.map((_, i) => i + 1);
  return {
    cleaned_content: content,
    original_line_map: lineMap,
    format: 'markdown',
    frontmatter: null,
    heading_tree: [],
  };
}

describe('extractors', () => {
  // === B.1 File Path References ===
  describe('extractPaths', () => {
    it('extracts backtick-wrapped paths', () => {
      const doc = makeDoc('Check `src/auth/handler.ts` for details.');
      const results = extractPaths(doc, 'README.md');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const backtick = results.find((r) => r.pattern_name === 'backtick_path');
      expect(backtick).toBeDefined();
      expect(backtick!.extracted_value).toEqual({
        type: 'path_reference',
        path: 'src/auth/handler.ts',
      });
      expect(backtick!.claim_type).toBe('path_reference');
    });

    it('extracts markdown link paths', () => {
      const doc = makeDoc('Check [the docs](docs/api.md) for more info.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).path).toBe('docs/api.md');
    });

    it('extracts text reference paths', () => {
      const doc = makeDoc('See src/index.ts for the entry point.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).path).toBe('src/index.ts');
    });

    it('rejects URLs', () => {
      const doc = makeDoc('See `https://example.com/file.ts` for details.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('rejects image extensions', () => {
      const doc = makeDoc('See `logo.png` and `icon.svg` and `photo.jpg`.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('rejects style extensions', () => {
      const doc = makeDoc('See `styles.css` and `theme.scss` and `base.less`.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('rejects self-references', () => {
      const doc = makeDoc('See `README.md` for details.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('rejects anchor links', () => {
      const doc = makeDoc('See `#installation` for details.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('rejects paths that fail validation', () => {
      const doc = makeDoc('See `../../etc/passwd` for details.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('rejects config-key notation without slashes', () => {
      const doc = makeDoc('Set `doc_patterns.include` and `agent.adapter` in config.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(0);
    });

    it('accepts paths without slashes if extension is known', () => {
      const doc = makeDoc('See `tsconfig.json` and `Makefile.ts` for config.');
      const results = extractPaths(doc, 'README.md');
      const paths = results.map((r) => (r.extracted_value as Record<string, unknown>).path);
      expect(paths).toContain('tsconfig.json');
      expect(paths).toContain('Makefile.ts');
    });

    it('accepts paths with slashes regardless of extension', () => {
      const doc = makeDoc('Check `config/doc_patterns.include` for the pattern.');
      const results = extractPaths(doc, 'README.md');
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).path).toBe(
        'config/doc_patterns.include',
      );
    });

    it('handles nested paths with hyphens and underscores', () => {
      const doc = makeDoc('Check `src/auth/user-auth_handler.ts`.');
      const results = extractPaths(doc, 'README.md');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find(
        (r) => (r.extracted_value as Record<string, unknown>).path === 'src/auth/user-auth_handler.ts',
      );
      expect(found).toBeDefined();
    });

    it('extracts multiple paths from one line', () => {
      const doc = makeDoc('Check `src/a.ts` and `src/b.ts` for details.');
      const results = extractPaths(doc, 'README.md');
      const uniquePaths = new Set(
        results.map((r) => (r.extracted_value as Record<string, unknown>).path),
      );
      expect(uniquePaths.size).toBe(2);
      expect(uniquePaths.has('src/a.ts')).toBe(true);
      expect(uniquePaths.has('src/b.ts')).toBe(true);
    });

    it('sets line_number from original_line_map', () => {
      const doc = makeDoc('Line 1\nCheck `src/a.ts` here.\nLine 3');
      const results = extractPaths(doc, 'README.md');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // All matches on line 2 should have line_number 2
      expect(results[0].line_number).toBe(2);
    });
  });

  // === Appendix C: Path Validation ===
  describe('isValidPath', () => {
    it('accepts normal relative paths', () => {
      expect(isValidPath('src/auth/handler.ts')).toBe(true);
    });

    it('accepts paths starting with ./', () => {
      expect(isValidPath('./src/auth.ts')).toBe(true);
    });

    it('rejects paths with ..', () => {
      expect(isValidPath('../../etc/passwd')).toBe(false);
      expect(isValidPath('src/../secret.ts')).toBe(false);
    });

    it('rejects absolute paths', () => {
      expect(isValidPath('/usr/bin/file')).toBe(false);
    });

    it('rejects file:// URLs', () => {
      expect(isValidPath('file:///etc/passwd')).toBe(false);
    });

    it('rejects null bytes', () => {
      expect(isValidPath('path\0hidden')).toBe(false);
    });

    it('rejects empty after normalization', () => {
      expect(isValidPath('./')).toBe(false);
    });

    it('rejects paths longer than 500 chars', () => {
      const longPath = 'a/'.repeat(251) + 'file.ts';
      expect(isValidPath(longPath)).toBe(false);
    });

    it('accepts paths with dots in filename', () => {
      expect(isValidPath('v2.backup.ts')).toBe(true);
    });

    it('accepts paths with numbers', () => {
      expect(isValidPath('page1.tsx')).toBe(true);
    });
  });

  // === B.4 API Routes ===
  describe('extractApiRoutes', () => {
    it('extracts HTTP method + path', () => {
      const doc = makeDoc('Send a GET /api/v2/users request.');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(1);
      expect(results[0].extracted_value).toEqual({
        type: 'api_route',
        method: 'GET',
        path: '/api/v2/users',
      });
      expect(results[0].claim_type).toBe('api_route');
    });

    it('extracts POST routes', () => {
      const doc = makeDoc('POST /api/v2/users to create a user.');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).method).toBe('POST');
    });

    it('normalizes method to uppercase', () => {
      const doc = makeDoc('delete /api/items/{itemId}');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).method).toBe('DELETE');
    });

    it('extracts routes with parameters', () => {
      const doc = makeDoc('GET /users/:id returns a user.');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).path).toBe('/users/:id');
    });

    it('extracts backtick-wrapped routes', () => {
      const doc = makeDoc('Use `GET /users/:id` to fetch a user.');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(1);
    });

    it('extracts multiple routes', () => {
      const doc = makeDoc('GET /users\nPOST /users\nDELETE /users/:id');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(3);
    });

    it('returns empty for no routes', () => {
      const doc = makeDoc('This is just normal text.');
      const results = extractApiRoutes(doc);
      expect(results).toHaveLength(0);
    });
  });

  // === B.2 CLI Commands ===
  describe('extractCommands', () => {
    it('extracts commands from code blocks', () => {
      const doc = makeDoc('```bash\nnpm install express\nyarn build\n```');
      const results = extractCommands(doc);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const runners = results.map((r) => (r.extracted_value as Record<string, unknown>).runner);
      expect(runners).toContain('npm');
      expect(runners).toContain('yarn');
    });

    it('handles prompt-prefixed code blocks', () => {
      const doc = makeDoc('```bash\n$ npm install\n$ yarn build\nsome output\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(2);
    });

    it('skips comments in code blocks', () => {
      const doc = makeDoc('```bash\n# This is a comment\nnpm install\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(1);
      expect((blockResults[0].extracted_value as Record<string, unknown>).runner).toBe('npm');
    });

    it('extracts inline runner commands', () => {
      const doc = makeDoc('Run `npm run test` to execute tests.');
      const results = extractCommands(doc);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const cmd = results.find((r) => r.pattern_name === 'inline_runner_command');
      expect(cmd).toBeDefined();
      expect((cmd!.extracted_value as Record<string, unknown>).runner).toBe('npm');
      expect((cmd!.extracted_value as Record<string, unknown>).script).toBe('test');
    });

    it('extracts "run" pattern commands', () => {
      const doc = makeDoc('Execute `pnpm test:unit` to run unit tests.');
      const results = extractCommands(doc);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects known runners', () => {
      const runners = ['npm', 'npx', 'yarn', 'pnpm', 'pip', 'cargo', 'go', 'make', 'docker', 'kubectl'];
      for (const runner of runners) {
        const doc = makeDoc(`\`${runner} some-command\``);
        const results = extractCommands(doc);
        const found = results.find(
          (r) => (r.extracted_value as Record<string, unknown>).runner === runner,
        );
        expect(found, `Expected to find runner: ${runner}`).toBeDefined();
      }
    });

    it('uses "unknown" for unrecognized runners', () => {
      const doc = makeDoc('```bash\ncustom-tool build\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(1);
      expect((blockResults[0].extracted_value as Record<string, unknown>).runner).toBe('unknown');
    });

    it('returns empty for no commands', () => {
      const doc = makeDoc('This is just regular text with no commands.');
      const results = extractCommands(doc);
      expect(results).toHaveLength(0);
    });

    it('skips untagged code blocks (no language hint)', () => {
      const doc = makeDoc('```\n├── src/\n│   ├── app.ts\n└── test/\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(0);
    });

    it('skips ASCII art/tree structure in tagged code blocks', () => {
      const doc = makeDoc('```bash\nnpm install\n├── src/\n│   └── index.ts\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(1);
      expect((blockResults[0].extracted_value as Record<string, unknown>).runner).toBe('npm');
    });

    it('skips box-drawing diagram lines in code blocks', () => {
      const doc = makeDoc('```bash\nnpm test\n+-------+------+\n| Layer |\n+-------+------+\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(1);
      expect((blockResults[0].extracted_value as Record<string, unknown>).script).toBe('test');
    });

    it('strips inline comments from commands', () => {
      const doc = makeDoc('```bash\nnpm run build          # TypeScript compilation\nnpm run test           # Vitest\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(2);
      expect((blockResults[0].extracted_value as Record<string, unknown>).script).toBe('build');
      expect((blockResults[1].extracted_value as Record<string, unknown>).script).toBe('test');
    });

    it('strips run prefix from npm/yarn/pnpm commands', () => {
      const doc = makeDoc('```bash\nnpm run build\nyarn run test\npnpm run lint\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(3);
      expect((blockResults[0].extracted_value as Record<string, unknown>).script).toBe('build');
      expect((blockResults[1].extracted_value as Record<string, unknown>).script).toBe('test');
      expect((blockResults[2].extracted_value as Record<string, unknown>).script).toBe('lint');
    });

    it('preserves npm commands that are not run', () => {
      const doc = makeDoc('```bash\nnpm install\nnpm test\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(2);
      expect((blockResults[0].extracted_value as Record<string, unknown>).script).toBe('install');
      expect((blockResults[1].extracted_value as Record<string, unknown>).script).toBe('test');
    });

    it('splits chained commands on && in code blocks', () => {
      const doc = makeDoc('```bash\nnpm run build && npm run test\n```');
      const results = extractCommands(doc);
      const blockResults = results.filter((r) => r.pattern_name === 'code_block_command');
      expect(blockResults).toHaveLength(2);
      expect((blockResults[0].extracted_value as Record<string, unknown>).script).toBe('build');
      expect((blockResults[1].extracted_value as Record<string, unknown>).script).toBe('test');
    });

    it('splits chained inline commands on &&', () => {
      const doc = makeDoc('Run `npm run typecheck && npm run test` to verify.');
      const results = extractCommands(doc);
      const inlineResults = results.filter((r) => r.pattern_name === 'run_pattern_command');
      expect(inlineResults).toHaveLength(2);
      expect((inlineResults[0].extracted_value as Record<string, unknown>).script).toBe('typecheck');
      expect((inlineResults[1].extracted_value as Record<string, unknown>).script).toBe('test');
    });
  });

  // === B.3 Dependency Versions ===
  describe('extractDependencyVersions', () => {
    const knownPackages = new Set(['react', 'React', 'express', 'Express', 'lodash', 'flask', 'Flask']);

    it('extracts word + version pattern', () => {
      const doc = makeDoc('Uses React 18.2.0 for the frontend.');
      const results = extractDependencyVersions(doc, knownPackages);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const reactClaim = results.find(
        (r) => (r.extracted_value as Record<string, unknown>).package === 'React',
      );
      expect(reactClaim).toBeDefined();
      expect((reactClaim!.extracted_value as Record<string, unknown>).version).toBe('18.2.0');
    });

    it('extracts runtime versions', () => {
      const doc = makeDoc('Requires Node.js 18.0.0 or later.');
      const results = extractDependencyVersions(doc, new Set());
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects unknown packages', () => {
      const doc = makeDoc('Section 2.1 describes the API.');
      const results = extractDependencyVersions(doc, knownPackages);
      // "Section" is not a known package or runtime
      const sectionClaim = results.find(
        (r) => (r.extracted_value as Record<string, unknown>).package === 'Section',
      );
      expect(sectionClaim).toBeUndefined();
    });

    it('keeps known dependencies', () => {
      const doc = makeDoc('Express 4.18.0 is used for the server.');
      const results = extractDependencyVersions(doc, knownPackages);
      const claim = results.find(
        (r) =>
          ((r.extracted_value as Record<string, unknown>).package as string).toLowerCase() === 'express',
      );
      expect(claim).toBeDefined();
    });

    it('extracts Python runtime versions', () => {
      const doc = makeDoc('Requires Python 3.10 or later.');
      const results = extractDependencyVersions(doc, new Set());
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for no versions', () => {
      const doc = makeDoc('No version information here.');
      const results = extractDependencyVersions(doc, knownPackages);
      expect(results).toHaveLength(0);
    });
  });

  // === B.5 Code Example Blocks ===
  describe('extractCodeExamples', () => {
    it('extracts fenced code blocks', () => {
      const doc = makeDoc('```typescript\nimport express from "express";\nconst app = express();\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      expect(results[0].claim_type).toBe('code_example');
      expect((results[0].extracted_value as Record<string, unknown>).language).toBe('typescript');
    });

    it('extracts imports from code blocks', () => {
      const doc = makeDoc(
        '```js\nimport React from "react";\nconst { useState } = require("react");\n```',
      );
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      const imports = (results[0].extracted_value as Record<string, unknown>).imports as string[];
      expect(imports).toContain('react');
    });

    it('extracts Python imports', () => {
      const doc = makeDoc('```python\nfrom flask import Flask\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      const imports = (results[0].extracted_value as Record<string, unknown>).imports as string[];
      expect(imports).toContain('flask');
    });

    it('extracts PascalCase symbols', () => {
      const doc = makeDoc('```ts\nconst svc = new AuthService();\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      const symbols = (results[0].extracted_value as Record<string, unknown>).symbols as string[];
      expect(symbols).toContain('AuthService');
    });

    it('extracts camelCase symbols but skips keywords', () => {
      const doc = makeDoc('```ts\nhandleLogin();\nif (true) {}\nfor (;;) {}\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      const symbols = (results[0].extracted_value as Record<string, unknown>).symbols as string[];
      expect(symbols).toContain('handleLogin');
      expect(symbols).not.toContain('if');
      expect(symbols).not.toContain('for');
    });

    it('skips CLI-only blocks', () => {
      const doc = makeDoc('```bash\nnpm install\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(0);
    });

    it('handles blocks without language identifier', () => {
      const doc = makeDoc('```\nconst x = 1;\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      expect((results[0].extracted_value as Record<string, unknown>).language).toBeNull();
    });

    it('extracts commands from prompt lines', () => {
      const doc = makeDoc('```ts\n$ npm run build\nconst x = 1;\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      const commands = (results[0].extracted_value as Record<string, unknown>).commands as string[];
      expect(commands).toContain('npm run build');
    });

    it('extracts multiple code blocks', () => {
      const doc = makeDoc('```ts\nconst a = 1;\n```\nSome text\n```js\nconst b = 2;\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(2);
    });

    it('truncates claim_text to 200 chars', () => {
      const longCode = 'const x = ' + 'a'.repeat(300) + ';';
      const doc = makeDoc('```ts\n' + longCode + '\n```');
      const results = extractCodeExamples(doc);
      expect(results).toHaveLength(1);
      expect(results[0].claim_text.length).toBeLessThanOrEqual(200);
    });
  });

  // === Appendix E: Deduplication ===
  describe('deduplicateWithinFile', () => {
    it('keeps first occurrence of identical paths', () => {
      const extractions: RawExtraction[] = [
        {
          claim_text: 'line 1',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 1,
          pattern_name: 'backtick_path',
        },
        {
          claim_text: 'line 5',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 5,
          pattern_name: 'backtick_path',
        },
      ];
      const result = deduplicateWithinFile(extractions);
      expect(result).toHaveLength(1);
      expect(result[0].line_number).toBe(1);
    });

    it('keeps different paths', () => {
      const extractions: RawExtraction[] = [
        {
          claim_text: 'line 1',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 1,
          pattern_name: 'backtick_path',
        },
        {
          claim_text: 'line 2',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/b.ts' },
          line_number: 2,
          pattern_name: 'backtick_path',
        },
      ];
      const result = deduplicateWithinFile(extractions);
      expect(result).toHaveLength(2);
    });

    it('deduplicates identical commands', () => {
      const extractions: RawExtraction[] = [
        {
          claim_text: 'line 1',
          claim_type: 'command',
          extracted_value: { type: 'command', runner: 'npm', script: 'install' },
          line_number: 1,
          pattern_name: 'code_block_command',
        },
        {
          claim_text: 'line 5',
          claim_type: 'command',
          extracted_value: { type: 'command', runner: 'npm', script: 'install' },
          line_number: 5,
          pattern_name: 'inline_runner_command',
        },
      ];
      const result = deduplicateWithinFile(extractions);
      expect(result).toHaveLength(1);
    });

    it('keeps same value with different claim types', () => {
      const extractions: RawExtraction[] = [
        {
          claim_text: 'line 1',
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path: 'src/a.ts' },
          line_number: 1,
          pattern_name: 'backtick_path',
        },
        {
          claim_text: 'line 1',
          claim_type: 'command',
          extracted_value: { type: 'command', runner: 'npm', script: 'src/a.ts' },
          line_number: 1,
          pattern_name: 'inline_runner_command',
        },
      ];
      const result = deduplicateWithinFile(extractions);
      expect(result).toHaveLength(2);
    });

    it('deduplicates dependency by package name only', () => {
      const extractions: RawExtraction[] = [
        {
          claim_text: 'line 1',
          claim_type: 'dependency_version',
          extracted_value: { type: 'dependency_version', package: 'react', version: '18.2.0' },
          line_number: 1,
          pattern_name: 'word_version',
        },
        {
          claim_text: 'line 5',
          claim_type: 'dependency_version',
          extracted_value: { type: 'dependency_version', package: 'react', version: '18.3.0' },
          line_number: 5,
          pattern_name: 'explicit_version',
        },
      ];
      const result = deduplicateWithinFile(extractions);
      expect(result).toHaveLength(1);
      // First occurrence kept
      expect((result[0].extracted_value as Record<string, unknown>).version).toBe('18.2.0');
    });
  });

  // === getIdentityKey ===
  describe('getIdentityKey', () => {
    it('generates path key', () => {
      const key = getIdentityKey({
        claim_text: '',
        claim_type: 'path_reference',
        extracted_value: { type: 'path_reference', path: 'src/a.ts' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(key).toBe('path:src/a.ts');
    });

    it('generates command key', () => {
      const key = getIdentityKey({
        claim_text: '',
        claim_type: 'command',
        extracted_value: { type: 'command', runner: 'npm', script: 'install' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(key).toBe('cmd:npm:install');
    });

    it('generates dependency key', () => {
      const key = getIdentityKey({
        claim_text: '',
        claim_type: 'dependency_version',
        extracted_value: { type: 'dependency_version', package: 'react', version: '18' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(key).toBe('dep:react');
    });

    it('generates route key', () => {
      const key = getIdentityKey({
        claim_text: '',
        claim_type: 'api_route',
        extracted_value: { type: 'api_route', method: 'GET', path: '/users' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(key).toBe('route:GET:/users');
    });

    it('generates code_example key by line', () => {
      const key = getIdentityKey({
        claim_text: 'const x = 1',
        claim_type: 'code_example',
        extracted_value: { type: 'code_example', language: 'ts' },
        line_number: 42,
        pattern_name: 'x',
      });
      expect(key).toBe('code:42');
    });
  });

  // === Appendix F: Keyword Generation ===
  describe('generateKeywords', () => {
    it('generates keywords for path_reference', () => {
      const keywords = generateKeywords({
        claim_text: '',
        claim_type: 'path_reference',
        extracted_value: { type: 'path_reference', path: 'src/auth/handler.ts' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).toContain('handler');
      expect(keywords).toContain('src');
      expect(keywords).toContain('auth');
    });

    it('generates keywords for command', () => {
      const keywords = generateKeywords({
        claim_text: '',
        claim_type: 'command',
        extracted_value: { type: 'command', runner: 'pnpm', script: 'test:unit' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).toContain('pnpm');
      expect(keywords).toContain('test:unit');
    });

    it('generates keywords for dependency_version', () => {
      const keywords = generateKeywords({
        claim_text: '',
        claim_type: 'dependency_version',
        extracted_value: { type: 'dependency_version', package: 'Express.js', version: '4' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).toContain('Express.js');
      expect(keywords).toContain('Express');
    });

    it('generates keywords for api_route', () => {
      const keywords = generateKeywords({
        claim_text: '',
        claim_type: 'api_route',
        extracted_value: { type: 'api_route', method: 'GET', path: '/api/v2/users' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).toContain('GET');
      expect(keywords).toContain('api');
      expect(keywords).toContain('v2');
      expect(keywords).toContain('users');
    });

    it('skips param placeholders in api_route keywords', () => {
      const keywords = generateKeywords({
        claim_text: '',
        claim_type: 'api_route',
        extracted_value: { type: 'api_route', method: 'GET', path: '/users/:id' },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).not.toContain(':id');
      expect(keywords).toContain('users');
    });

    it('generates keywords for code_example', () => {
      const keywords = generateKeywords({
        claim_text: '',
        claim_type: 'code_example',
        extracted_value: {
          type: 'code_example',
          language: 'ts',
          imports: ['express', 'authMiddleware'],
          symbols: ['AuthService', 'handleLogin'],
          commands: ['npm run build'],
        },
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).toContain('express');
      expect(keywords).toContain('authMiddleware');
      expect(keywords).toContain('AuthService');
      expect(keywords).toContain('handleLogin');
      expect(keywords).toContain('npm');
    });

    it('returns empty for unknown claim types', () => {
      const keywords = generateKeywords({
        claim_text: 'test',
        claim_type: 'unknown_type' as never,
        extracted_value: {},
        line_number: 1,
        pattern_name: 'x',
      });
      expect(keywords).toHaveLength(0);
    });
  });
});
