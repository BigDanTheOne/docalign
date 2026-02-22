/**
 * QA acceptance tests for docs/guides/mcp-integration.md
 * Verifies documentation accuracy against source code.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs/guides/mcp-integration.md');
const toolHandlersPath = path.join(repoRoot, 'src/layers/L6-mcp/tool-handlers.ts');
const initPath = path.join(repoRoot, 'src/cli/commands/init.ts');

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

describe('MCP Integration Doc Accuracy', () => {
  let doc: string;
  let toolHandlers: string;
  let initSrc: string;

  beforeAll(() => {
    doc = readFile(docPath);
    toolHandlers = readFile(toolHandlersPath);
    initSrc = readFile(initPath);
  });

  it('should reference exactly 4 MCP tools (matching tool-handlers.ts)', () => {
    // Count s.tool() calls in source
    const toolCalls = toolHandlers.match(/s\.tool\(/g);
    expect(toolCalls).toHaveLength(4);

    // Doc should NOT claim 10 tools
    expect(doc).not.toMatch(/\b10\b.*tools?\b.*available/i);
    expect(doc).not.toMatch(/All 10 tools/i);

    // Doc should reference 4 tools
    expect(doc).toMatch(/\b4\b.*tools?/i);
  });

  it('should list the correct tool names', () => {
    const expectedTools = ['check_doc', 'scan_docs', 'get_docs', 'register_claims'];
    for (const tool of expectedTools) {
      expect(doc).toContain(tool);
    }
  });

  it('should NOT reference .claude/mcp.json for manual setup config path', () => {
    // init.ts uses `claude mcp add --scope user`, not .claude/mcp.json
    // The manual setup should reference the correct config location
    expect(doc).not.toMatch(/\.claude\/mcp\.json/);
  });

  it('should describe init steps matching actual init.ts behavior', () => {
    // init.ts registers via `claude mcp add --scope user`
    expect(initSrc).toContain('claude mcp add --scope user');

    // Doc should mention global/user-scope registration
    expect(doc).toMatch(/claude mcp add/i);

    // init.ts installs skills to .claude/skills/
    expect(initSrc).toContain('.claude/skills/');

    // init.ts writes .claude/settings.local.json
    expect(initSrc).toContain('settings.local.json');
  });

  it('should have consistent tool count between frontmatter and body', () => {
    // Extract any numeric tool count claims from frontmatter description
    const frontmatterMatch = doc.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).toBeTruthy();
    const frontmatter = frontmatterMatch![1];

    // Frontmatter mentions "4 available MCP tools"
    if (frontmatter.match(/\d+.*(?:MCP )?tools?/i)) {
      const countMatch = frontmatter.match(/(\d+).*(?:MCP )?tools?/i);
      expect(countMatch![1]).toBe('4');
    }

    // Body should not contradict
    const bodyToolCounts = [...doc.matchAll(/\b(\d+)\s+(?:documentation |MCP )?tools?\b/gi)];
    for (const match of bodyToolCounts) {
      expect(match[1]).toBe('4');
    }
  });
});
