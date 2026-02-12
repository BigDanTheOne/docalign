import { describe, it, expect } from 'vitest';
import { parseManifest } from '../../../src/layers/L0-codebase-index/manifest-parser';

describe('manifest-parser', () => {
  describe('package.json', () => {
    it('parses dependencies and devDependencies', () => {
      const content = JSON.stringify({
        dependencies: { express: '^4.18.0', zod: '3.22.0' },
        devDependencies: { vitest: '^2.0.0' },
        scripts: { build: 'tsc', test: 'vitest' },
      });
      const result = parseManifest('package.json', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies).toEqual({ express: '^4.18.0', zod: '3.22.0' });
      expect(result!.dev_dependencies).toEqual({ vitest: '^2.0.0' });
      expect(result!.scripts).toEqual({ build: 'tsc', test: 'vitest' });
      expect(result!.source).toBe('manifest');
    });

    it('handles empty dependencies', () => {
      const result = parseManifest('package.json', JSON.stringify({}));
      expect(result).not.toBeNull();
      expect(result!.dependencies).toEqual({});
      expect(result!.scripts).toEqual({});
    });

    it('returns null for invalid JSON', () => {
      const result = parseManifest('package.json', '{ invalid');
      expect(result).toBeNull();
    });

    it('skips non-string versions', () => {
      const content = JSON.stringify({
        dependencies: { a: '^1.0', b: { version: '2.0' }, c: 3 },
      });
      const result = parseManifest('package.json', content);
      expect(result!.dependencies).toEqual({ a: '^1.0' });
    });
  });

  describe('package-lock.json', () => {
    it('parses v3 lock format', () => {
      const content = JSON.stringify({
        packages: {
          '': { dependencies: { express: '^4.18' }, devDependencies: { vitest: '^2.0' } },
          'node_modules/express': { version: '4.18.2' },
          'node_modules/vitest': { version: '2.1.9' },
        },
      });
      const result = parseManifest('package-lock.json', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies['express']).toBe('^4.18');
      expect(result!.dependencies['vitest']).toBe('^2.0');
      expect(result!.source).toBe('lockfile');
    });

    it('returns null for invalid JSON', () => {
      expect(parseManifest('package-lock.json', 'bad')).toBeNull();
    });
  });

  describe('requirements.txt', () => {
    it('parses pinned versions', () => {
      const content = 'flask==2.3.0\nrequests>=2.28.0\nnumpy~=1.24\n';
      const result = parseManifest('requirements.txt', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies['flask']).toBe('==2.3.0');
      expect(result!.dependencies['requests']).toBe('>=2.28.0');
      expect(result!.dependencies['numpy']).toBe('~=1.24');
    });

    it('handles bare package names', () => {
      const result = parseManifest('requirements.txt', 'pandas\nscipy\n');
      expect(result!.dependencies['pandas']).toBe('*');
      expect(result!.dependencies['scipy']).toBe('*');
    });

    it('ignores comments and flags', () => {
      const content = '# comment\n-r other.txt\nflask==2.0\n';
      const result = parseManifest('requirements.txt', content);
      expect(Object.keys(result!.dependencies)).toEqual(['flask']);
    });

    it('strips environment markers', () => {
      const content = 'pywin32==306 ; sys_platform == "win32"\n';
      const result = parseManifest('requirements.txt', content);
      expect(result!.dependencies['pywin32']).toBe('==306');
    });
  });

  describe('pyproject.toml', () => {
    it('parses [project] dependencies', () => {
      const content = `[project]
name = "myapp"
dependencies = [
  "flask>=2.3",
  "pydantic>=2.0"
]
`;
      const result = parseManifest('pyproject.toml', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies['flask']).toBe('>=2.3');
      expect(result!.dependencies['pydantic']).toBe('>=2.0');
    });

    it('parses [tool.poetry.dependencies]', () => {
      const content = `[tool.poetry.dependencies]
python = "^3.11"
fastapi = "0.100.0"
`;
      const result = parseManifest('pyproject.toml', content);
      expect(result!.dependencies['python']).toBe('^3.11');
      expect(result!.dependencies['fastapi']).toBe('0.100.0');
    });

    it('parses scripts', () => {
      const content = `[project.scripts]
serve = "myapp.main:run"
`;
      const result = parseManifest('pyproject.toml', content);
      expect(result!.scripts['serve']).toBe('myapp.main:run');
    });
  });

  describe('Makefile', () => {
    it('parses targets', () => {
      const content = `build:\n\tgo build ./...\n\ntest:\n\tgo test ./...\n`;
      const result = parseManifest('Makefile', content);
      expect(result).not.toBeNull();
      expect(result!.scripts['build']).toBe('go build ./...');
      expect(result!.scripts['test']).toBe('go test ./...');
    });

    it('handles targets without commands', () => {
      const content = `clean:\n\nall: build test\n`;
      const result = parseManifest('Makefile', content);
      expect(result!.scripts).toHaveProperty('clean');
    });
  });

  describe('yarn.lock', () => {
    it('parses v1 format', () => {
      const content = `"express@^4.18.0":\n  version "4.18.2"\n  resolved "..."\n\n"zod@^3.22":\n  version "3.22.4"\n`;
      const result = parseManifest('yarn.lock', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies['express']).toBe('4.18.2');
      expect(result!.dependencies['zod']).toBe('3.22.4');
      expect(result!.source).toBe('lockfile');
    });
  });

  describe('Cargo.toml', () => {
    it('parses [dependencies] and [dev-dependencies]', () => {
      const content = `[dependencies]\nserde = "1.0"\ntokio = { version = "1.28", features = ["full"] }\n\n[dev-dependencies]\ncriterion = "0.5"\n`;
      const result = parseManifest('Cargo.toml', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies['serde']).toBe('1.0');
      expect(result!.dependencies['tokio']).toBe('1.28');
      expect(result!.dev_dependencies['criterion']).toBe('0.5');
    });
  });

  describe('go.mod', () => {
    it('parses require blocks', () => {
      const content = `module github.com/user/proj\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgithub.com/lib/pq v1.10.9\n)\n`;
      const result = parseManifest('go.mod', content);
      expect(result).not.toBeNull();
      expect(result!.dependencies['github.com/gin-gonic/gin']).toBe('v1.9.1');
      expect(result!.dependencies['github.com/lib/pq']).toBe('v1.10.9');
    });

    it('parses single require statements', () => {
      const content = `module mymod\n\ngo 1.21\n\nrequire github.com/pkg/errors v0.9.1\n`;
      const result = parseManifest('go.mod', content);
      expect(result!.dependencies['github.com/pkg/errors']).toBe('v0.9.1');
    });
  });

  describe('unknown files', () => {
    it('returns null for unsupported files', () => {
      expect(parseManifest('tsconfig.json', '{}')).toBeNull();
      expect(parseManifest('.gitignore', 'node_modules')).toBeNull();
    });
  });
});
