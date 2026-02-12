import { describe, it, expect } from 'vitest';
import { buildExtractPrompt, parseExtractResponse } from '../src/prompts/extract';
import { buildTriagePrompt, parseTriageResponse } from '../src/prompts/triage';
import { buildVerifyPath1Prompt, parseVerifyResponse } from '../src/prompts/verify-path1';
import { buildFixPrompt, parseFixResponse } from '../src/prompts/fix';
import { PExtractOutputSchema, PTriageOutputSchema, PVerifyOutputSchema, PFixOutputSchema } from '../src/prompts/schemas';

describe('P-EXTRACT', () => {
  it('builds prompt with project context', () => {
    const { system, user } = buildExtractPrompt({
      project_context: { language: 'TypeScript', frameworks: ['Express', 'Redis'] },
      doc_files: [{
        source_file: 'docs/architecture.md',
        chunk_heading: 'Authentication',
        start_line: 45,
        content: 'The AuthService handles password reset via email.',
      }],
    });

    expect(system).toContain('documentation claim extractor');
    expect(user).toContain('TypeScript');
    expect(user).toContain('Express, Redis');
    expect(user).toContain('docs/architecture.md');
    expect(user).toContain('Authentication');
    expect(user).toContain('AuthService handles password reset');
  });

  it('parses valid extract response', () => {
    const raw = JSON.stringify({
      type: 'claim_extraction',
      claims: [{
        claim_text: 'The AuthService validates tokens',
        claim_type: 'behavior',
        source_file: 'README.md',
        source_line: 10,
        confidence: 0.9,
        keywords: ['AuthService', 'token'],
      }],
    });
    const parsed = parseExtractResponse(raw);
    expect(parsed.type).toBe('claim_extraction');
    expect(parsed.claims).toHaveLength(1);
  });

  it('rejects syntactic claim types', () => {
    const raw = JSON.stringify({
      type: 'claim_extraction',
      claims: [{
        claim_text: 'see src/config.ts',
        claim_type: 'path_reference', // syntactic, should be rejected by Zod
        source_file: 'README.md',
        source_line: 1,
        confidence: 0.9,
        keywords: ['config'],
      }],
    });
    expect(() => parseExtractResponse(raw)).toThrow();
  });

  it('accepts empty claims array', () => {
    const raw = JSON.stringify({ type: 'claim_extraction', claims: [] });
    const parsed = parseExtractResponse(raw);
    expect(parsed.claims).toHaveLength(0);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseExtractResponse('not json')).toThrow();
  });

  it('validates confidence range', () => {
    const raw = JSON.stringify({
      type: 'claim_extraction',
      claims: [{
        claim_text: 'test',
        claim_type: 'behavior',
        source_file: 'test.md',
        source_line: 1,
        confidence: 1.5, // out of range
        keywords: ['test'],
      }],
    });
    expect(() => parseExtractResponse(raw)).toThrow();
  });
});

describe('P-TRIAGE', () => {
  it('builds triage prompt with claim and evidence', () => {
    const { system, user } = buildTriagePrompt({
      claim: {
        source_file: 'README.md',
        source_line: 30,
        claim_type: 'behavior',
        claim_text: 'Validates email before creating user.',
      },
      evidence: {
        formatted_evidence: 'async createUser(dto) { if (!isValidEmail(dto.email)) throw; }',
        code_file: 'src/services/user-service.ts',
        start_line: 15,
        end_line: 28,
      },
    });

    expect(system).toContain('triage classifier');
    expect(user).toContain('Validates email');
    expect(user).toContain('isValidEmail');
  });

  it('truncates long evidence', () => {
    const longEvidence = 'x'.repeat(3000);
    const { user } = buildTriagePrompt({
      claim: { claim_text: 'test' },
      evidence: { formatted_evidence: longEvidence },
    });
    expect(user).toContain('[truncated]');
    expect(user.length).toBeLessThan(longEvidence.length + 1000);
  });

  it('parses ACCURATE classification', () => {
    const raw = JSON.stringify({ classification: 'ACCURATE', explanation: 'Matches code.' });
    const parsed = parseTriageResponse(raw);
    expect(parsed.classification).toBe('ACCURATE');
  });

  it('parses DRIFTED classification', () => {
    const raw = JSON.stringify({ classification: 'DRIFTED', explanation: 'Uses argon2.' });
    const parsed = parseTriageResponse(raw);
    expect(parsed.classification).toBe('DRIFTED');
  });

  it('parses UNCERTAIN classification', () => {
    const raw = JSON.stringify({ classification: 'UNCERTAIN', explanation: 'Cannot determine.' });
    const parsed = parseTriageResponse(raw);
    expect(parsed.classification).toBe('UNCERTAIN');
  });

  it('rejects invalid classification', () => {
    const raw = JSON.stringify({ classification: 'MAYBE', explanation: 'Perhaps' });
    expect(() => parseTriageResponse(raw)).toThrow();
  });
});

describe('P-VERIFY Path 1', () => {
  it('builds verify prompt with claim and evidence', () => {
    const { system, user } = buildVerifyPath1Prompt({
      claim: {
        source_file: 'README.md',
        source_line: 45,
        claim_type: 'behavior',
        claim_text: 'Authentication uses bcrypt.',
      },
      evidence: {
        formatted_evidence: '--- File: src/auth/password.ts ---\nimport { hash } from argon2;\n',
      },
    });

    expect(system).toContain('documentation accuracy verifier');
    expect(user).toContain('bcrypt');
    expect(user).toContain('argon2');
  });

  it('parses verified response', () => {
    const raw = JSON.stringify({
      verdict: 'verified',
      confidence: 0.95,
      severity: null,
      reasoning: 'Code matches.',
      specific_mismatch: null,
      suggested_fix: null,
      evidence_files: ['src/auth/password.ts'],
    });
    const parsed = parseVerifyResponse(raw);
    expect(parsed.verdict).toBe('verified');
    expect(parsed.confidence).toBe(0.95);
  });

  it('parses drifted response with severity', () => {
    const raw = JSON.stringify({
      verdict: 'drifted',
      confidence: 0.98,
      severity: 'high',
      reasoning: 'Uses argon2, not bcrypt.',
      specific_mismatch: 'bcrypt vs argon2',
      suggested_fix: 'Uses argon2.',
      evidence_files: ['src/auth/password.ts'],
    });
    const parsed = parseVerifyResponse(raw);
    expect(parsed.verdict).toBe('drifted');
    expect(parsed.severity).toBe('high');
    expect(parsed.specific_mismatch).toBe('bcrypt vs argon2');
  });

  it('rejects invalid verdict', () => {
    const raw = JSON.stringify({
      verdict: 'maybe',
      confidence: 0.5,
      severity: null,
      reasoning: 'Unsure.',
      specific_mismatch: null,
      suggested_fix: null,
      evidence_files: [],
    });
    expect(() => parseVerifyResponse(raw)).toThrow();
  });
});

describe('P-FIX', () => {
  it('builds fix prompt', () => {
    const { system, user } = buildFixPrompt({
      finding: {
        claim_text: 'Uses bcrypt.',
        source_file: 'README.md',
        source_line: 45,
        mismatch_description: 'Uses argon2, not bcrypt.',
        evidence_files: ['src/auth/password.ts'],
      },
    });

    expect(system).toContain('documentation editor');
    expect(user).toContain('Uses bcrypt');
    expect(user).toContain('argon2');
  });

  it('parses valid fix response', () => {
    const raw = JSON.stringify({
      suggested_fix: {
        file_path: 'README.md',
        line_start: 45,
        line_end: 45,
        new_text: 'Uses argon2id for password hashing.',
        explanation: 'Replaced bcrypt with argon2id.',
      },
    });
    const parsed = parseFixResponse(raw);
    expect(parsed.suggested_fix.new_text).toBe('Uses argon2id for password hashing.');
  });

  it('rejects empty new_text', () => {
    const raw = JSON.stringify({
      suggested_fix: {
        file_path: 'README.md',
        line_start: 45,
        line_end: 45,
        new_text: '', // empty
        explanation: 'Removed.',
      },
    });
    expect(() => parseFixResponse(raw)).toThrow();
  });
});

describe('Zod schemas', () => {
  it('PExtractOutputSchema validates correct input', () => {
    const result = PExtractOutputSchema.safeParse({
      type: 'claim_extraction',
      claims: [{ claim_text: 'test', claim_type: 'behavior', source_file: 'f', source_line: 1, confidence: 0.9, keywords: ['k'] }],
    });
    expect(result.success).toBe(true);
  });

  it('PTriageOutputSchema rejects missing fields', () => {
    const result = PTriageOutputSchema.safeParse({ classification: 'ACCURATE' });
    expect(result.success).toBe(false);
  });

  it('PVerifyOutputSchema handles nullable severity', () => {
    const result = PVerifyOutputSchema.safeParse({
      verdict: 'verified',
      confidence: 0.9,
      severity: null,
      reasoning: 'OK',
      specific_mismatch: null,
      suggested_fix: null,
      evidence_files: [],
    });
    expect(result.success).toBe(true);
  });

  it('PFixOutputSchema requires all fix fields', () => {
    const result = PFixOutputSchema.safeParse({
      suggested_fix: { file_path: 'f', line_start: 1, line_end: 1, new_text: 't' },
    });
    expect(result.success).toBe(false); // missing explanation
  });
});
