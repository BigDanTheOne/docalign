import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runStatus } from '../../src/cli/commands/status';

describe('runStatus', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-status-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects git repository', async () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('git repo detected');
  });

  it('reports when not a git repo', async () => {
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('NOT a git repo');
  });

  it('reports no config file when absent', async () => {
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('none (using defaults)');
  });

  it('reports config file when present', async () => {
    fs.writeFileSync(path.join(tmpDir, '.docalign.yml'), 'verification:\n  min_severity: medium\n');
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('.docalign.yml found');
  });

  it('reports Claude Code MCP not configured', async () => {
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('Claude Code MCP:   not configured');
  });

  it('reports Claude Code MCP as configured', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.local.json'),
      JSON.stringify({ mcpServers: { docalign: { command: 'npx', args: [] } } }),
    );
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('Claude Code MCP:   configured');
  });

  it('reports skill not installed', async () => {
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('Claude Code Skill: not installed');
  });

  it('reports skill as installed', async () => {
    const skillDir = path.join(tmpDir, '.claude', 'skills', 'docalign');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill');
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('Claude Code Skill: installed');
  });

  it('suggests docalign init when not configured', async () => {
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('docalign init');
  });

  it('discovers doc files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello');
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('Doc files found:');
    expect(text).toContain('README.md');
  });

  it('returns exit code 0', async () => {
    const code = await runStatus(() => {});
    expect(code).toBe(0);
  });

  it('suggests docalign scan', async () => {
    const output: string[] = [];
    await runStatus((msg) => output.push(msg));
    const text = output.join('\n');
    expect(text).toContain('docalign scan');
  });
});
