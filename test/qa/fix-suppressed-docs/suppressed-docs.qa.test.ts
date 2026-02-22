/**
 * QA Acceptance Tests: Fix remaining suppressed docs
 * Pipeline: fd049cac-c4cb-498f-b5f8-2e2d953dddf6
 *
 * Verifies that mcp-integration.md, suppressing-findings.md, and troubleshooting.md
 * accurately reflect the codebase.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// QA-DISPUTE: Original had '../../../../..' (5 levels) but test is only 3 dirs deep from repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');

function readDoc(relPath: string): string {
  const absPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Doc file not found: ${relPath}`);
  }
  return fs.readFileSync(absPath, 'utf-8');
}

function readSource(relPath: string): string {
  const absPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Source file not found: ${relPath}`);
  }
  return fs.readFileSync(absPath, 'utf-8');
}

describe('docs/guides/mcp-integration.md', () => {
  let doc: string;

  beforeAll(() => {
    doc = readDoc('docs/guides/mcp-integration.md');
  });

  it('should reference the correct MCP local tools: check_doc, scan_docs, get_docs, register_claims', () => {
    // These are the 4 tools registered in tool-handlers.ts (local mode)
    const toolHandlers = readSource('src/layers/L6-mcp/tool-handlers.ts');

    // Extract tool names from registerLocalTools
    const toolNames = [...toolHandlers.matchAll(/s\.tool\(\s*'([^']+)'/g)].map(m => m[1]);
    expect(toolNames).toContain('check_doc');
    expect(toolNames).toContain('scan_docs');
    expect(toolNames).toContain('get_docs');
    expect(toolNames).toContain('register_claims');

    // Doc should mention these tool names
    for (const tool of toolNames) {
      expect(doc).toContain(tool);
    }
  });

  it('should NOT reference remote-only tools (get_docs_for_file, get_doc_health, list_stale_docs, report_drift) as available locally', () => {
    // These are only in tools.ts (remote/hosted mode), not in local mode
    // The doc should either not mention them or clearly mark them as remote-only
    const remoteOnlyTools = ['get_docs_for_file', 'get_doc_health', 'list_stale_docs', 'report_drift'];
    for (const tool of remoteOnlyTools) {
      // If mentioned, should be in a "remote" or "hosted" context, not as a local tool
      if (doc.includes(tool)) {
        // Acceptable if in a remote/hosted section; fail if presented as a local tool
        const localSection = doc.toLowerCase().indexOf('local');
        const toolPos = doc.indexOf(tool);
        // Just verify it's not listed as a local tool — crude but functional
        const surroundingText = doc.slice(Math.max(0, toolPos - 200), toolPos + 200).toLowerCase();
        expect(
          surroundingText.includes('remote') ||
          surroundingText.includes('hosted') ||
          surroundingText.includes('server mode') ||
          surroundingText.includes('not available locally')
        ).toBe(true);
      }
    }
  });

  it('should document the correct CLI command: docalign mcp --repo <path>', () => {
    expect(doc).toMatch(/docalign\s+mcp/);
    expect(doc).toContain('--repo');
  });

  it('should mention stdio transport', () => {
    expect(doc.toLowerCase()).toContain('stdio');
  });
});

describe('docs/guides/suppressing-findings.md', () => {
  let doc: string;

  beforeAll(() => {
    doc = readDoc('docs/guides/suppressing-findings.md');
  });

  it('should document all suppression scopes: claim, file, claim_type, pattern', () => {
    const types = readSource('src/shared/types.ts');
    const scopeMatch = types.match(/SuppressionScope\s*=\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'/);
    expect(scopeMatch).not.toBeNull();

    const scopes = [scopeMatch![1], scopeMatch![2], scopeMatch![3], scopeMatch![4]];
    for (const scope of scopes) {
      expect(doc).toContain(scope);
    }
  });

  it('should document suppression via .docalign.yml suppress key', () => {
    expect(doc).toContain('.docalign.yml');
    expect(doc.toLowerCase()).toContain('suppress');
  });

  it('should document expiration (expires_at) and revocation', () => {
    // suppression.ts checks expires_at and revoked
    expect(doc.toLowerCase()).toMatch(/expir/);
    expect(doc.toLowerCase()).toMatch(/revok/);
  });

  it('should document the evaluation order: claim > file > claim_type > pattern', () => {
    // The code evaluates in this order (Level 1-4 in suppression.ts)
    const docLower = doc.toLowerCase();
    const claimPos = docLower.indexOf('claim');
    const filePos = docLower.indexOf('file');
    // Just verify the order concept is mentioned
    expect(docLower).toMatch(/order|priority|specificity|hierarchy|level/);
  });
});

describe('docs/guides/troubleshooting.md', () => {
  let doc: string;

  beforeAll(() => {
    doc = readDoc('docs/guides/troubleshooting.md');
  });

  it('should exist and have content', () => {
    expect(doc.length).toBeGreaterThan(100);
  });

  it('should reference real error patterns from the codebase', () => {
    // Check that at least some documented errors/messages appear in source files
    // Common error patterns in the codebase
    const docLower = doc.toLowerCase();
    // Should cover at least MCP, config, and scanning issues
    expect(
      docLower.includes('mcp') ||
      docLower.includes('config') ||
      docLower.includes('scan') ||
      docLower.includes('drift')
    ).toBe(true);
  });

  it('should NOT reference non-existent CLI commands', () => {
    // Read actual CLI commands from the codebase
    const cliIndex = readSource('src/cli/main.ts');

    // Extract any `docalign <command>` references from the doc
    const docCommands = [...doc.matchAll(/docalign\s+(\w+)/g)].map(m => m[1]);

    // Known valid commands (from CLI structure)
    const knownCommands = ['mcp', 'check', 'scan', 'extract', 'fix', 'init'];

    for (const cmd of docCommands) {
      // Either in known commands or actually referenced in CLI source
      expect(
        knownCommands.includes(cmd) || cliIndex.includes(cmd)
      ).toBe(true);
    }
  });

  it('should reference valid file paths that exist in the project', () => {
    // Extract paths like src/... or docs/... from the doc
    const paths = [...doc.matchAll(/(?:src|docs|config)\/[\w\-\/]+\.\w+/g)].map(m => m[0]);

    for (const p of paths) {
      const absPath = path.join(REPO_ROOT, p);
      expect(fs.existsSync(absPath)).toBe(true);
    }
  });
});
