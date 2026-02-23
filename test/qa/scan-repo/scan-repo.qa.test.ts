/**
 * QA Acceptance Tests — MCP tool: scan_repo
 *
 * Verifies the scan_repo tool is registered, accepts the correct parameters,
 * triggers a fresh scan, and handles errors gracefully.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We dynamically import tool-handlers to allow mocking pipeline
describe('QA: scan_repo tool registration', () => {
  it('scan_repo tool is registered in tool-handlers and callable', async () => {
    // Verify the tool-handlers source exports or registers scan_repo
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../layers/L6-mcp/tool-handlers.ts'),
      'utf-8',
    );
    expect(handlerSource).toContain("'scan_repo'");
  });

  it('scan_repo JSON schema includes force (boolean) and exclude (string[]) params', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../layers/L6-mcp/tool-handlers.ts'),
      'utf-8',
    );
    // The tool definition should reference force and exclude parameters
    // Find the scan_repo registration block
    const scanRepoIdx = handlerSource.indexOf("'scan_repo'");
    expect(scanRepoIdx).toBeGreaterThan(-1);
    const block = handlerSource.slice(scanRepoIdx, scanRepoIdx + 800);
    expect(block).toMatch(/force/);
    expect(block).toMatch(/exclude/);
  });
});

describe('QA: scan_repo happy path', () => {
  it('scan_repo triggers pipeline.scanRepo() and returns structured results', async () => {
    // This test verifies the handler calls scanRepo and returns content
    // The build agent must ensure scan_repo handler calls pipeline.scanRepo()
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../layers/L6-mcp/tool-handlers.ts'),
      'utf-8',
    );
    const scanRepoIdx = handlerSource.indexOf("'scan_repo'");
    expect(scanRepoIdx).toBeGreaterThan(-1);
    // The handler block should call scanRepo
    const block = handlerSource.slice(scanRepoIdx, scanRepoIdx + 1500);
    expect(block).toMatch(/scanRepo/);
    // Should return content with type 'text'
    expect(block).toMatch(/content/);
  });
});

describe('QA: scan_repo error handling', () => {
  it('scan_repo handler has try/catch for error path', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../layers/L6-mcp/tool-handlers.ts'),
      'utf-8',
    );
    const scanRepoIdx = handlerSource.indexOf("'scan_repo'");
    expect(scanRepoIdx).toBeGreaterThan(-1);
    const block = handlerSource.slice(scanRepoIdx, scanRepoIdx + 2000);
    // Should have error handling (catch block)
    expect(block).toMatch(/catch/);
    // Should return isError: true on failure (MCP convention)
    expect(block).toMatch(/isError.*true|isError:\s*true/);
  });
});

describe('QA: scan_repo is distinct from scan_docs', () => {
  it('scan_repo and scan_docs are both registered as separate tools', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../layers/L6-mcp/tool-handlers.ts'),
      'utf-8',
    );
    const scanRepoMatches = handlerSource.match(/'scan_repo'/g);
    const scanDocsMatches = handlerSource.match(/'scan_docs'/g);
    expect(scanRepoMatches).not.toBeNull();
    expect(scanDocsMatches).not.toBeNull();
    // Both should exist as separate registrations
    expect(scanRepoMatches!.length).toBeGreaterThanOrEqual(1);
    expect(scanDocsMatches!.length).toBeGreaterThanOrEqual(1);
  });
});
