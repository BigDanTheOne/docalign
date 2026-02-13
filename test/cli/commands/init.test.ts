import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We need to mock process.cwd() for the init command
let tmpDir: string;

describe('runInit', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-init-'));
    // Create a .git directory to simulate a git repo
    fs.mkdirSync(path.join(tmpDir, '.git'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates settings.local.json with MCP config', async () => {
    const { runInit } = await import('../../../src/cli/commands/init');

    const output: string[] = [];
    const code = await runInit((msg) => output.push(msg));

    expect(code).toBe(0);

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.mcpServers?.docalign).toBeDefined();
    expect(settings.mcpServers.docalign.command).toBe('npx');
    expect(settings.permissions.allow).toContain('mcp__docalign__*');
  });

  it('creates SKILL.md with all 8 tools documented', async () => {
    const { runInit } = await import('../../../src/cli/commands/init');

    await runInit(() => {});

    const skillPath = path.join(tmpDir, '.claude', 'skills', 'docalign', 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);

    const skillContent = fs.readFileSync(skillPath, 'utf-8');
    expect(skillContent).toContain('check_doc');
    expect(skillContent).toContain('check_section');
    expect(skillContent).toContain('get_doc_health');
    expect(skillContent).toContain('list_drift');
    expect(skillContent).toContain('get_docs_for_file');
    expect(skillContent).toContain('get_docs');
    expect(skillContent).toContain('fix_doc');
    expect(skillContent).toContain('report_drift');
  });

  it('adds PostToolUse hook for git commit', async () => {
    const { runInit } = await import('../../../src/cli/commands/init');

    await runInit(() => {});

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse).toHaveLength(1);

    const hook = settings.hooks.PostToolUse[0];
    expect(hook.matcher).toBe('Bash');
    expect(hook.hooks).toBeDefined();
    expect(hook.hooks).toHaveLength(1);
    expect(hook.hooks[0].type).toBe('command');
    expect(hook.hooks[0].command).toContain('DocAlign');
  });

  it('preserves existing hooks when merging', async () => {
    const { runInit } = await import('../../../src/cli/commands/init');

    // Pre-create settings with existing hooks (new format)
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const existingSettings = {
      hooks: {
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "tests done"' }] },
        ],
      },
    };
    fs.writeFileSync(
      path.join(claudeDir, 'settings.local.json'),
      JSON.stringify(existingSettings),
    );

    await runInit(() => {});

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // Both hooks should be present
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('echo "tests done"');
    expect(settings.hooks.PostToolUse[1].hooks[0].command).toContain('DocAlign');
  });

  it('does not duplicate hook on re-run', async () => {
    const { runInit } = await import('../../../src/cli/commands/init');

    await runInit(() => {});
    await runInit(() => {});

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // Should not have duplicate hooks
    const docalignHooks = settings.hooks.PostToolUse.filter(
      (h: { hooks?: Array<{ command: string }> }) => h.hooks?.some((hk) => hk.command.includes('DocAlign')),
    );
    expect(docalignHooks).toHaveLength(1);
  });

  it('returns error code 2 when not a git repo', async () => {
    // Remove .git directory
    fs.rmSync(path.join(tmpDir, '.git'), { recursive: true });
    const { runInit } = await import('../../../src/cli/commands/init');

    const output: string[] = [];
    const code = await runInit((msg) => output.push(msg));

    expect(code).toBe(2);
    expect(output.join(' ')).toContain('Not a git repository');
  });

  it('SKILL.md includes Search and Verify workflow', async () => {
    const { runInit } = await import('../../../src/cli/commands/init');

    await runInit(() => {});

    const skillPath = path.join(tmpDir, '.claude', 'skills', 'docalign', 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Workflow 7: Search and Verify');
    expect(content).toContain('Workflow 6: Post-Implementation Check');
    expect(content).toContain('Workflow 8: Report and Track Drift');
  });
});
