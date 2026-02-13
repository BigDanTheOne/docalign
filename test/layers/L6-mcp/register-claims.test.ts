import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocalTools } from '../../../src/layers/L6-mcp/tool-handlers';
import type { CliPipeline } from '../../../src/cli/local-pipeline';
import { loadClaimsForFile } from '../../../src/cli/semantic-store';

let tmpDir: string;

describe('register_claims tool', () => {
  let server: McpServer;
  let registerClaimsHandler: (params: { claims: Array<{
    source_file: string;
    line_number: number;
    claim_text: string;
    claim_type: 'behavior' | 'architecture' | 'config';
    keywords: string[];
    evidence_entities?: Array<{ symbol: string; file: string }>;
    evidence_assertions?: Array<{ pattern: string; scope: string; expect: 'exists' | 'absent'; description: string }>;
    verification?: { verdict: 'verified' | 'drifted' | 'uncertain'; confidence: number; reasoning: string };
  }> }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  const mockPipeline: CliPipeline = {
    checkFile: vi.fn().mockResolvedValue({ claims: [], results: [], fixes: [], durationMs: 10 }),
    checkSection: vi.fn().mockResolvedValue({
      claims: [], results: [], fixes: [], durationMs: 10,
      section: { heading: 'Test', level: 1, startLine: 1, endLine: 10 },
    }),
    listSections: vi.fn().mockReturnValue([]),
    scanRepo: vi.fn().mockResolvedValue({
      files: [], totalClaims: 0, totalVerified: 0, totalDrifted: 0, totalUncertain: 0, durationMs: 10,
    }),
    getStoredFixes: vi.fn().mockResolvedValue([]),
    markFixesApplied: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-reg-'));

    server = {
      tool: vi.fn(),
    } as unknown as McpServer;

    registerLocalTools(server, mockPipeline, tmpDir);

    const call = (server.tool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'register_claims',
    );
    registerClaimsHandler = call![3];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers claims and returns IDs', async () => {
    // Create the doc file first
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Auth\nUses JWT for authentication');

    const result = await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'Uses JWT for authentication',
        claim_type: 'behavior',
        keywords: ['jwt', 'auth'],
      }],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.registered).toBe(1);
    expect(parsed.claim_ids).toHaveLength(1);
    expect(parsed.claim_ids[0]).toMatch(/^sem-/);
  });

  it('persists claims to .docalign/semantic/', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Title\nContent here');

    await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'Content is about X',
        claim_type: 'behavior',
        keywords: ['content'],
      }],
    });

    const loaded = loadClaimsForFile(tmpDir, 'README.md');
    expect(loaded).not.toBeNull();
    expect(loaded!.claims).toHaveLength(1);
    expect(loaded!.claims[0].claim_text).toBe('Content is about X');
  });

  it('preserves existing claims when adding new ones', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Title\nFirst claim\n\n## Section 2\nSecond claim');

    // Register first claim
    await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'First claim',
        claim_type: 'behavior',
        keywords: ['first'],
      }],
    });

    // Register second claim
    await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 5,
        claim_text: 'Second claim',
        claim_type: 'architecture',
        keywords: ['second'],
      }],
    });

    const loaded = loadClaimsForFile(tmpDir, 'README.md');
    expect(loaded!.claims).toHaveLength(2);
  });

  it('persists verification when provided', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Auth\nUses JWT');

    await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'Uses JWT',
        claim_type: 'behavior',
        keywords: ['jwt'],
        verification: {
          verdict: 'verified',
          confidence: 0.95,
          reasoning: 'JWT library found in dependencies',
        },
      }],
    });

    const loaded = loadClaimsForFile(tmpDir, 'README.md');
    expect(loaded!.claims[0].last_verification).not.toBeNull();
    expect(loaded!.claims[0].last_verification!.verdict).toBe('verified');
    expect(loaded!.claims[0].last_verification!.confidence).toBe(0.95);
  });

  it('handles claims with evidence', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Arch\nServices communicate via queues');

    await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 2,
        claim_text: 'Services communicate via queues',
        claim_type: 'architecture',
        keywords: ['queues', 'services'],
        evidence_entities: [{ symbol: 'QueueService', file: 'src/queue.ts' }],
        evidence_assertions: [{
          pattern: 'BullMQ|bullmq',
          scope: 'src/**/*.ts',
          expect: 'exists',
          description: 'Queue library imported',
        }],
      }],
    });

    const loaded = loadClaimsForFile(tmpDir, 'README.md');
    expect(loaded!.claims[0].evidence_entities).toHaveLength(1);
    expect(loaded!.claims[0].evidence_assertions).toHaveLength(1);
  });

  it('handles multiple files in one call', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Title\nClaim A');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs/api.md'), '# API\nClaim B');

    const result = await registerClaimsHandler({
      claims: [
        {
          source_file: 'README.md',
          line_number: 2,
          claim_text: 'Claim A',
          claim_type: 'behavior',
          keywords: ['a'],
        },
        {
          source_file: 'docs/api.md',
          line_number: 2,
          claim_text: 'Claim B',
          claim_type: 'config',
          keywords: ['b'],
        },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.registered).toBe(2);

    const readme = loadClaimsForFile(tmpDir, 'README.md');
    const api = loadClaimsForFile(tmpDir, 'docs/api.md');
    expect(readme!.claims).toHaveLength(1);
    expect(api!.claims).toHaveLength(1);
  });

  it('computes section heading from line number', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Intro\nFirst\n\n## Auth\nAuth claim here');

    await registerClaimsHandler({
      claims: [{
        source_file: 'README.md',
        line_number: 5,
        claim_text: 'Auth claim here',
        claim_type: 'behavior',
        keywords: ['auth'],
      }],
    });

    const loaded = loadClaimsForFile(tmpDir, 'README.md');
    expect(loaded!.claims[0].section_heading).toBe('Auth');
  });
});
