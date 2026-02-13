import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../src/cli/local-pipeline';
import { saveClaimsForFile, type SemanticClaimFile } from '../../../src/cli/semantic-store';

let tmpDir: string;

describe('deep_check tool', () => {
  let server: McpServer;
  let deepCheckHandler: (params: { file: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  const mockPipeline: CliPipeline = {
    checkFile: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 10,
    }),
    checkSection: vi.fn().mockResolvedValue({
      claims: [],
      results: [],
      fixes: [],
      durationMs: 10,
      section: { heading: 'Test', level: 1, startLine: 1, endLine: 10 },
    }),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn().mockResolvedValue({
      files: [],
      totalClaims: 0,
      totalVerified: 0,
      totalDrifted: 0,
      totalUncertain: 0,
      durationMs: 10,
    }),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-deep-'));

    server = {
      tool: vi.fn(),
    } as unknown as McpServer;

    registerLocalTools(server, mockPipeline, tmpDir);

    // Find the deep_check handler
    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'deep_check',
    );
    deepCheckHandler = call![3];
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns response with all expected sections', async () => {
    // Create a doc file
    const docContent = '# Title\nSome content\n\n## Setup\nSetup info';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), docContent);

    const result = await deepCheckHandler({ file: 'README.md' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.file).toBe('README.md');
    expect(parsed.syntactic).toBeDefined();
    expect(parsed.semantic).toBeDefined();
    expect(parsed.unchecked_sections).toBeDefined();
    expect(parsed.coverage).toBeDefined();
    expect(parsed.warnings).toBeDefined();
  });

  it('shows warning when no semantic claims stored', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Title\nContent');

    const result = await deepCheckHandler({ file: 'README.md' });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.warnings).toBeInstanceOf(Array);
    expect(parsed.warnings).toContain('No semantic claims stored. Run `docalign extract` first.');
  });

  it('includes semantic claims when stored', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Title\nContent');

    const claimData: SemanticClaimFile = {
      version: 1,
      source_file: 'README.md',
      last_extracted_at: '2025-01-01T00:00:00.000Z',
      claims: [{
        id: 'sem-test000000000000',
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'Uses JWT for auth',
        claim_type: 'behavior',
        keywords: ['jwt'],
        section_content_hash: 'abc',
        section_heading: 'Title',
        extracted_at: '2025-01-01T00:00:00.000Z',
        evidence_entities: [],
        evidence_assertions: [],
        last_verification: {
          verdict: 'verified',
          confidence: 0.9,
          reasoning: 'Found JWT usage',
          verified_at: '2025-01-01T00:00:00.000Z',
        },
      }],
    };
    saveClaimsForFile(tmpDir, 'README.md', claimData);

    const result = await deepCheckHandler({ file: 'README.md' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.semantic.total_claims).toBe(1);
    expect(parsed.semantic.findings[0].claim_text).toBe('Uses JWT for auth');
    expect(parsed.semantic.findings[0].verification.verdict).toBe('verified');
    expect(parsed.warnings).not.toContain('No semantic claims stored.');
  });

  it('calculates coverage correctly', async () => {
    const content = '# Section A\nContent A\n\n## Section B\nContent B\n\n## Section C\nContent C';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), content);

    // Mock checkFile to return a claim in Section A
    (mockPipeline.checkFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      claims: [{
        id: 'claim-1',
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'test',
        claim_type: 'path_reference',
        extraction_method: 'regex',
      }],
      results: [],
      fixes: [],
      durationMs: 5,
    });

    const result = await deepCheckHandler({ file: 'README.md' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.coverage.total_sections).toBe(3);
    expect(parsed.unchecked_sections.length).toBeGreaterThan(0);
  });

  it('returns error for non-existent file', async () => {
    (mockPipeline.checkFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('File not found: nonexistent.md'),
    );

    const result = await deepCheckHandler({ file: 'nonexistent.md' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('File not found');
  });
});
