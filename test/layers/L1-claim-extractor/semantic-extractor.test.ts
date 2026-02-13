import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDocSections,
  buildExtractionPrompt,
  extractSemanticClaims,
  SemanticExtractionOutputSchema,
} from '../../../src/layers/L1-claim-extractor/semantic-extractor';

// Mock claude-bridge
vi.mock('../../../src/cli/claude-bridge', () => ({
  invokeClaudeStructured: vi.fn(),
}));

import { invokeClaudeStructured } from '../../../src/cli/claude-bridge';
const mockedInvoke = invokeClaudeStructured as unknown as ReturnType<typeof vi.fn>;

describe('semantic-extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildDocSections', () => {
    it('splits content by headings', () => {
      const content = `# Title
Some intro text

## Installation
Install with npm

## Usage
Use it like this`;

      const sections = buildDocSections('README.md', content);
      expect(sections).toHaveLength(3);
      expect(sections[0].heading).toBe('Title');
      expect(sections[1].heading).toBe('Installation');
      expect(sections[2].heading).toBe('Usage');
    });

    it('computes line ranges correctly', () => {
      const content = `# Title
line 2

## Section Two
line 5
line 6`;

      const sections = buildDocSections('README.md', content);
      expect(sections[0].startLine).toBe(1);
      expect(sections[0].endLine).toBe(3);
      expect(sections[1].startLine).toBe(4);
      expect(sections[1].endLine).toBe(6);
    });

    it('computes content hashes', () => {
      const content = `# Title\nContent`;
      const sections = buildDocSections('README.md', content);
      expect(sections[0].contentHash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('handles file with no headings', () => {
      const content = 'Just some text\nwith no headings';
      const sections = buildDocSections('README.md', content);
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe('(document)');
      expect(sections[0].startLine).toBe(1);
    });

    it('produces deterministic hashes', () => {
      const content = '# Title\nSame content';
      const a = buildDocSections('f.md', content);
      const b = buildDocSections('f.md', content);
      expect(a[0].contentHash).toBe(b[0].contentHash);
    });
  });

  describe('buildExtractionPrompt', () => {
    it('includes section content in prompt', () => {
      const sections = buildDocSections('README.md', '# Auth\nUses JWT tokens');
      const prompt = buildExtractionPrompt(sections, '/my/repo');
      expect(prompt).toContain('Uses JWT tokens');
      expect(prompt).toContain('/my/repo');
      expect(prompt).toContain('Auth');
    });

    it('includes line range info', () => {
      const sections = buildDocSections('README.md', '# Auth\nLine 2');
      const prompt = buildExtractionPrompt(sections, '/repo');
      expect(prompt).toContain('lines 1-2');
    });

    it('includes extraction instructions', () => {
      const sections = buildDocSections('README.md', '# Title\nContent');
      const prompt = buildExtractionPrompt(sections, '/repo');
      expect(prompt).toContain('behavior');
      expect(prompt).toContain('architecture');
      expect(prompt).toContain('config');
      expect(prompt).toContain('What NOT to extract');
    });
  });

  describe('SemanticExtractionOutputSchema', () => {
    it('validates correct output', () => {
      const output = {
        claims: [{
          claim_text: 'Uses JWT',
          claim_type: 'behavior',
          keywords: ['jwt'],
          line_number: 5,
          evidence_entities: [{ symbol: 'verifyJWT', file: 'src/auth.ts' }],
          evidence_assertions: [],
        }],
      };
      const result = SemanticExtractionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it('defaults optional arrays', () => {
      const output = {
        claims: [{
          claim_text: 'Uses JWT',
          claim_type: 'behavior',
          keywords: ['jwt'],
          line_number: 5,
        }],
      };
      const result = SemanticExtractionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claims[0].evidence_entities).toEqual([]);
        expect(result.data.claims[0].evidence_assertions).toEqual([]);
      }
    });

    it('rejects invalid claim_type', () => {
      const output = {
        claims: [{
          claim_text: 'text',
          claim_type: 'invalid',
          keywords: [],
          line_number: 1,
        }],
      };
      const result = SemanticExtractionOutputSchema.safeParse(output);
      expect(result.success).toBe(false);
    });
  });

  describe('extractSemanticClaims', () => {
    it('returns claims from successful extraction', async () => {
      mockedInvoke.mockResolvedValue({
        ok: true,
        data: {
          claims: [{
            claim_text: 'The system uses JWT for authentication',
            claim_type: 'behavior',
            keywords: ['jwt', 'authentication'],
            line_number: 2,
            evidence_entities: [{ symbol: 'verifyJWT', file: 'src/auth.ts' }],
            evidence_assertions: [{
              pattern: 'import.*jsonwebtoken',
              scope: 'src/**/*.ts',
              expect: 'exists',
              description: 'JWT library imported',
            }],
          }],
        },
        durationMs: 5000,
      });

      const sections = buildDocSections('README.md', '# Auth\nThe system uses JWT for authentication');
      const result = await extractSemanticClaims('README.md', sections, '/repo');

      expect(result.errors).toHaveLength(0);
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0].id).toMatch(/^sem-/);
      expect(result.claims[0].claim_text).toBe('The system uses JWT for authentication');
      expect(result.claims[0].claim_type).toBe('behavior');
      expect(result.claims[0].evidence_entities).toHaveLength(1);
      expect(result.claims[0].evidence_entities[0].content_hash).toBe(''); // Not yet verified
      expect(result.claims[0].evidence_assertions).toHaveLength(1);
      expect(result.claims[0].last_verification).toBeNull();
    });

    it('returns error on claude failure', async () => {
      mockedInvoke.mockResolvedValue({
        ok: false,
        error: { type: 'timeout', message: 'timed out' },
      });

      const sections = buildDocSections('README.md', '# Title\nContent');
      const result = await extractSemanticClaims('README.md', sections, '/repo');

      expect(result.claims).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error.type).toBe('timeout');
    });

    it('returns empty for no sections', async () => {
      const result = await extractSemanticClaims('README.md', [], '/repo');
      expect(result.claims).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(mockedInvoke).not.toHaveBeenCalled();
    });

    it('passes correct tools and cwd', async () => {
      mockedInvoke.mockResolvedValue({
        ok: true,
        data: { claims: [] },
        durationMs: 100,
      });

      const sections = buildDocSections('README.md', '# Title\nContent');
      await extractSemanticClaims('README.md', sections, '/my/repo');

      expect(mockedInvoke).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          allowedTools: ['Read', 'Glob', 'Grep'],
          cwd: '/my/repo',
        }),
      );
    });

    it('assigns correct section heading and hash', async () => {
      mockedInvoke.mockResolvedValue({
        ok: true,
        data: {
          claims: [{
            claim_text: 'Claim in setup',
            claim_type: 'config',
            keywords: ['setup'],
            line_number: 4,
            evidence_entities: [],
            evidence_assertions: [],
          }],
        },
        durationMs: 100,
      });

      const content = '# Intro\nIntro text\n\n## Setup\nClaim in setup';
      const sections = buildDocSections('README.md', content);
      const result = await extractSemanticClaims('README.md', sections, '/repo');

      expect(result.claims[0].section_heading).toBe('Setup');
    });
  });
});
