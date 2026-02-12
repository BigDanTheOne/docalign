import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml } from 'yaml';
import { runConfigure } from '../../src/cli/commands/configure';

describe('runConfigure', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-configure-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readConfig(): Record<string, unknown> {
    const content = fs.readFileSync(path.join(tmpDir, '.docalign.yml'), 'utf-8');
    return parseYaml(content) as Record<string, unknown>;
  }

  describe('default creation', () => {
    it('creates .docalign.yml with defaults when no options provided', async () => {
      const output: string[] = [];
      const code = await runConfigure({}, (msg) => output.push(msg));
      expect(code).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, '.docalign.yml'))).toBe(true);
      expect(output.join('\n')).toContain('Created .docalign.yml with default settings');
    });

    it('includes default doc_patterns.exclude', async () => {
      await runConfigure({}, () => {});
      const config = readConfig();
      const docPatterns = config.doc_patterns as { exclude?: string[] };
      expect(docPatterns.exclude).toBeDefined();
      expect(docPatterns.exclude!.length).toBeGreaterThan(0);
    });

    it('includes default verification.min_severity', async () => {
      await runConfigure({}, () => {});
      const config = readConfig();
      const verification = config.verification as { min_severity?: string };
      expect(verification.min_severity).toBe('low');
    });

    it('shows edit hints for new config', async () => {
      const output: string[] = [];
      await runConfigure({}, (msg) => output.push(msg));
      const text = output.join('\n');
      expect(text).toContain('Edit this file to customize');
      expect(text).toContain('doc_patterns.exclude');
    });
  });

  describe('--exclude', () => {
    it('adds exclusion patterns to new config', async () => {
      const output: string[] = [];
      const code = await runConfigure({ exclude: ['CHANGELOG.md'] }, (msg) => output.push(msg));
      expect(code).toBe(0);
      const config = readConfig();
      const docPatterns = config.doc_patterns as { exclude?: string[] };
      expect(docPatterns.exclude).toContain('CHANGELOG.md');
      expect(output.join('\n')).toContain('Added doc exclusion: CHANGELOG.md');
    });

    it('adds exclusion to existing config', async () => {
      // Create initial config
      await runConfigure({}, () => {});
      // Add exclusion
      const output: string[] = [];
      await runConfigure({ exclude: ['CUSTOM.md'] }, (msg) => output.push(msg));
      const config = readConfig();
      const docPatterns = config.doc_patterns as { exclude?: string[] };
      expect(docPatterns.exclude).toContain('CUSTOM.md');
      expect(output.join('\n')).toContain('Added doc exclusion: CUSTOM.md');
    });

    it('reports already-excluded patterns', async () => {
      await runConfigure({ exclude: ['node_modules/**'] }, () => {});
      const output: string[] = [];
      await runConfigure({ exclude: ['node_modules/**'] }, (msg) => output.push(msg));
      expect(output.join('\n')).toContain('Already excluded: node_modules/**');
    });

    it('adds multiple exclusions at once', async () => {
      await runConfigure({ exclude: ['A.md', 'B.md'] }, () => {});
      const config = readConfig();
      const docPatterns = config.doc_patterns as { exclude?: string[] };
      expect(docPatterns.exclude).toContain('A.md');
      expect(docPatterns.exclude).toContain('B.md');
    });
  });

  describe('--min-severity', () => {
    it('sets min_severity in new config', async () => {
      const output: string[] = [];
      const code = await runConfigure({ minSeverity: 'medium' }, (msg) => output.push(msg));
      expect(code).toBe(0);
      const config = readConfig();
      const verification = config.verification as { min_severity?: string };
      expect(verification.min_severity).toBe('medium');
      expect(output.join('\n')).toContain('Set min_severity: medium');
    });

    it('updates min_severity in existing config', async () => {
      await runConfigure({}, () => {});
      await runConfigure({ minSeverity: 'high' }, () => {});
      const config = readConfig();
      const verification = config.verification as { min_severity?: string };
      expect(verification.min_severity).toBe('high');
    });

    it('rejects invalid severity level', async () => {
      const output: string[] = [];
      const code = await runConfigure({ minSeverity: 'critical' }, (msg) => output.push(msg));
      expect(code).toBe(2);
      expect(output.join('\n')).toContain('must be one of');
    });

    it('accepts all valid severity levels', async () => {
      for (const level of ['low', 'medium', 'high']) {
        const code = await runConfigure({ minSeverity: level }, () => {});
        expect(code).toBe(0);
      }
    });
  });

  describe('--reset', () => {
    it('creates config with defaults, overwriting existing', async () => {
      await runConfigure({ minSeverity: 'high' }, () => {});
      const output: string[] = [];
      const code = await runConfigure({ reset: true }, (msg) => output.push(msg));
      expect(code).toBe(0);
      const config = readConfig();
      const verification = config.verification as { min_severity?: string };
      expect(verification.min_severity).toBe('low');
      expect(output.join('\n')).toContain('Created .docalign.yml with default settings');
    });
  });

  describe('existing config without options', () => {
    it('shows guidance when config exists and no options given', async () => {
      await runConfigure({}, () => {});
      const output: string[] = [];
      await runConfigure({}, (msg) => output.push(msg));
      const text = output.join('\n');
      expect(text).toContain('already exists');
      expect(text).toContain('--exclude');
      expect(text).toContain('--min-severity');
      expect(text).toContain('--reset');
    });

    it('returns 0 when config exists and no options given', async () => {
      await runConfigure({}, () => {});
      const code = await runConfigure({}, () => {});
      expect(code).toBe(0);
    });
  });

  describe('YAML format', () => {
    it('includes header comment in output file', async () => {
      await runConfigure({}, () => {});
      const content = fs.readFileSync(path.join(tmpDir, '.docalign.yml'), 'utf-8');
      expect(content).toContain('# DocAlign Configuration');
    });
  });
});
