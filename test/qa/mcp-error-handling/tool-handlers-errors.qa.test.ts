/**
 * QA acceptance tests: MCP tool-handlers error paths.
 * Every tool must gracefully return isError:true when dependencies throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../../src/cli/local-pipeline';

describe('tool-handlers error paths', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolHandlers: Record<string, (...args: any[]) => Promise<any>> = {};
  let mockPipeline: CliPipeline;

  beforeEach(() => {
    Object.keys(toolHandlers).forEach((k) => delete toolHandlers[k]);

    mockPipeline = {
      checkFile: vi.fn(),
      checkSection: vi.fn(),
      listSections: vi.fn().mockReturnValue([]),
      scanRepo: vi.fn(),
    } as unknown as CliPipeline;

    const server = {
      tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: unknown) => {
        toolHandlers[name] = handler as typeof toolHandlers[string];
      }),
    } as unknown as McpServer;

    registerLocalTools(server, mockPipeline, '/tmp/test-repo');
  });

  // --- check_doc ---

  describe('check_doc', () => {
    it('returns isError when checkFile throws', async () => {
      (mockPipeline.checkFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('file not found'),
      );

      const result = await toolHandlers['check_doc']({ file: 'nonexistent.md' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('file not found');
    });

    it('returns isError when checkSection throws', async () => {
      (mockPipeline.checkSection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('section not found'),
      );

      const result = await toolHandlers['check_doc']({ file: 'README.md', section: 'Missing' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('section not found');
    });

    it('returns isError when non-Error is thrown', async () => {
      (mockPipeline.checkFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

      const result = await toolHandlers['check_doc']({ file: 'test.md' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('string error');
    });
  });

  // --- scan_docs ---

  describe('scan_docs', () => {
    it('returns isError when scanRepo throws', async () => {
      (mockPipeline.scanRepo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('permission denied'),
      );

      const result = await toolHandlers['scan_docs']({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('permission denied');
    });
  });

  // --- get_docs ---

  describe('get_docs', () => {
    it('returns isError when no query or code_file provided', async () => {
      const result = await toolHandlers['get_docs']({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide at least one of');
    });
  });

  // --- register_claims ---

  describe('register_claims', () => {
    it('returns isError when claim registration fails', async () => {
      // register_claims reads files via fs — mock fs to cause failure
      const result = await toolHandlers['register_claims']({
        file: '/nonexistent/path/file.md',
        claims: [{ text: 'test claim', type: 'api', line: 1 }],
      });
      expect(result.isError).toBe(true);
    });
  });
});
