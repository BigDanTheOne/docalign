import { describe, it, expect, beforeAll } from 'vitest';
import {
  detectLanguage,
  isSupportedCodeFile,
  isManifestFile,
  initParser,
  parseFile,
  EXTENSION_MAP,
} from '../../../src/layers/L0-codebase-index/ast-parser';

describe('ast-parser', () => {
  describe('detectLanguage', () => {
    it('detects TypeScript files', () => {
      expect(detectLanguage('app.ts')).toBe('typescript');
      expect(detectLanguage('component.tsx')).toBe('typescript');
    });

    it('detects JavaScript files', () => {
      expect(detectLanguage('index.js')).toBe('javascript');
      expect(detectLanguage('page.jsx')).toBe('javascript');
      expect(detectLanguage('util.mjs')).toBe('javascript');
      expect(detectLanguage('config.cjs')).toBe('javascript');
    });

    it('detects Python files', () => {
      expect(detectLanguage('main.py')).toBe('python');
    });

    it('returns null for unsupported extensions', () => {
      expect(detectLanguage('main.rs')).toBeNull();
      expect(detectLanguage('app.go')).toBeNull();
      expect(detectLanguage('README.md')).toBeNull();
      expect(detectLanguage('package.json')).toBeNull();
    });

    it('handles paths with directories', () => {
      expect(detectLanguage('/src/layers/index.ts')).toBe('typescript');
      expect(detectLanguage('lib/utils/helper.py')).toBe('python');
    });
  });

  describe('EXTENSION_MAP', () => {
    it('covers all 7 extensions from TDD-0', () => {
      expect(Object.keys(EXTENSION_MAP)).toHaveLength(7);
      expect(EXTENSION_MAP['.ts']).toBe('typescript');
      expect(EXTENSION_MAP['.tsx']).toBe('typescript');
      expect(EXTENSION_MAP['.js']).toBe('javascript');
      expect(EXTENSION_MAP['.jsx']).toBe('javascript');
      expect(EXTENSION_MAP['.mjs']).toBe('javascript');
      expect(EXTENSION_MAP['.cjs']).toBe('javascript');
      expect(EXTENSION_MAP['.py']).toBe('python');
    });
  });

  describe('isSupportedCodeFile', () => {
    it('returns true for supported files', () => {
      expect(isSupportedCodeFile('app.ts')).toBe(true);
      expect(isSupportedCodeFile('main.py')).toBe(true);
    });

    it('returns false for unsupported files', () => {
      expect(isSupportedCodeFile('README.md')).toBe(false);
      expect(isSupportedCodeFile('Makefile')).toBe(false);
    });
  });

  describe('isManifestFile', () => {
    it('identifies manifest files', () => {
      expect(isManifestFile('package.json')).toBe(true);
      expect(isManifestFile('package-lock.json')).toBe(true);
      expect(isManifestFile('yarn.lock')).toBe(true);
      expect(isManifestFile('pnpm-lock.yaml')).toBe(true);
      expect(isManifestFile('requirements.txt')).toBe(true);
      expect(isManifestFile('pyproject.toml')).toBe(true);
      expect(isManifestFile('Cargo.toml')).toBe(true);
      expect(isManifestFile('go.mod')).toBe(true);
      expect(isManifestFile('Makefile')).toBe(true);
    });

    it('handles paths', () => {
      expect(isManifestFile('/project/package.json')).toBe(true);
    });

    it('returns false for non-manifest files', () => {
      expect(isManifestFile('app.ts')).toBe(false);
      expect(isManifestFile('tsconfig.json')).toBe(false);
    });
  });

  describe('initParser + parseFile', () => {
    beforeAll(async () => {
      await initParser();
    }, 30_000);

    it('initializes tree-sitter WASM runtime', async () => {
      // initParser already called in beforeAll; should not throw on second call
      await expect(initParser()).resolves.toBeUndefined();
    });

    describe('TypeScript extraction', () => {
      it('extracts exported functions', async () => {
        const code = `export function hello(name: string): string {\n  return \`Hello \${name}\`;\n}\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        expect(result!.entities).toHaveLength(1);
        expect(result!.entities[0].name).toBe('hello');
        expect(result!.entities[0].entity_type).toBe('function');
        expect(result!.entities[0].line_number).toBe(1);
      });

      it('extracts exported arrow functions', async () => {
        const code = `export const greet = (name: string) => {\n  return name;\n};\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        expect(result!.entities).toHaveLength(1);
        expect(result!.entities[0].name).toBe('greet');
        expect(result!.entities[0].entity_type).toBe('function');
      });

      it('extracts exported classes', async () => {
        const code = `export class UserService {\n  getUser() {}\n}\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        const cls = result!.entities.find((e) => e.entity_type === 'class');
        expect(cls).toBeDefined();
        expect(cls!.name).toBe('UserService');
      });

      it('extracts exported interfaces', async () => {
        const code = `export interface UserData {\n  id: string;\n  name: string;\n}\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        const iface = result!.entities.find((e) => e.entity_type === 'type');
        expect(iface).toBeDefined();
        expect(iface!.name).toBe('UserData');
      });

      it('extracts exported type aliases', async () => {
        const code = `export type UserId = string;\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        const ta = result!.entities.find((e) => e.entity_type === 'type');
        expect(ta).toBeDefined();
        expect(ta!.name).toBe('UserId');
      });

      it('extracts route definitions', async () => {
        const code = `import { Router } from 'express';\nconst router = Router();\nrouter.get('/users', handler);\nrouter.post('/users', handler);\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        const routes = result!.entities.filter((e) => e.entity_type === 'route');
        expect(routes).toHaveLength(2);
        expect(routes[0].name).toBe('GET /users');
        expect(routes[1].name).toBe('POST /users');
      });

      it('does not extract non-exported functions', async () => {
        const code = `function internal() {}\nexport function external() {}\n`;
        const result = await parseFile('test.ts', code);
        expect(result).not.toBeNull();
        expect(result!.entities).toHaveLength(1);
        expect(result!.entities[0].name).toBe('external');
      });

      it('handles empty files', async () => {
        const result = await parseFile('empty.ts', '');
        expect(result).not.toBeNull();
        expect(result!.entities).toHaveLength(0);
        expect(result!.has_errors).toBe(false);
      });
    });

    describe('JavaScript extraction', () => {
      it('extracts exported functions from .js', async () => {
        const code = `export function add(a, b) {\n  return a + b;\n}\n`;
        const result = await parseFile('math.js', code);
        expect(result).not.toBeNull();
        expect(result!.language).toBe('javascript');
        expect(result!.entities).toHaveLength(1);
        expect(result!.entities[0].name).toBe('add');
      });
    });

    describe('Python extraction', () => {
      it('extracts top-level functions', async () => {
        const code = `def hello(name):\n    return f"Hello {name}"\n`;
        const result = await parseFile('app.py', code);
        expect(result).not.toBeNull();
        expect(result!.language).toBe('python');
        expect(result!.entities).toHaveLength(1);
        expect(result!.entities[0].name).toBe('hello');
        expect(result!.entities[0].entity_type).toBe('function');
      });

      it('extracts classes', async () => {
        const code = `class UserModel:\n    def __init__(self):\n        pass\n`;
        const result = await parseFile('models.py', code);
        expect(result).not.toBeNull();
        const cls = result!.entities.find((e) => e.entity_type === 'class');
        expect(cls).toBeDefined();
        expect(cls!.name).toBe('UserModel');
      });

      it('extracts Flask routes', async () => {
        const code = `from flask import Flask\napp = Flask(__name__)\n\n@app.get('/users')\ndef get_users():\n    return []\n`;
        const result = await parseFile('routes.py', code);
        expect(result).not.toBeNull();
        const routes = result!.entities.filter((e) => e.entity_type === 'route');
        expect(routes).toHaveLength(1);
        expect(routes[0].name).toBe('GET /users');
        // The function itself should also be extracted
        const fns = result!.entities.filter((e) => e.entity_type === 'function');
        expect(fns).toHaveLength(1);
        expect(fns[0].name).toBe('get_users');
      });

      it('extracts signature with return type', async () => {
        const code = `def greet(name: str) -> str:\n    return f"Hi {name}"\n`;
        const result = await parseFile('greet.py', code);
        expect(result).not.toBeNull();
        expect(result!.entities[0].signature).toContain('def greet');
        expect(result!.entities[0].signature).toContain('-> str');
      });
    });

    describe('unsupported files', () => {
      it('returns null for unsupported extensions', async () => {
        const result = await parseFile('main.go', 'package main');
        expect(result).toBeNull();
      });
    });

    describe('ParsedFileResult fields', () => {
      it('includes parse_duration_ms', async () => {
        const result = await parseFile('test.ts', 'export function a() {}');
        expect(result).not.toBeNull();
        expect(result!.parse_duration_ms).toBeGreaterThanOrEqual(0);
      });

      it('includes file_path', async () => {
        const result = await parseFile('src/app.ts', 'export function a() {}');
        expect(result!.file_path).toBe('src/app.ts');
      });

      it('includes language', async () => {
        const result = await parseFile('test.py', 'def a(): pass');
        expect(result!.language).toBe('python');
      });
    });
  });
});
