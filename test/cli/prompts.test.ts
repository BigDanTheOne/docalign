import { describe, it, expect } from 'vitest';
import { buildVerifyPrompt } from '../../src/cli/prompts/verify';
import { buildFixPrompt } from '../../src/cli/prompts/fix';
import { PVerifyOutputSchema, PFixOutputSchema } from '../../src/cli/prompts/schemas';

describe('buildVerifyPrompt', () => {
  it('includes claim text in user prompt', () => {
    const { user } = buildVerifyPrompt({
      claimText: 'Uses Express for HTTP routing',
      claimType: 'behavior',
      sourceFile: 'README.md',
      sourceLine: 10,
      evidence: '--- File: src/app.ts ---\nconst app = express();',
      evidenceFiles: ['src/app.ts'],
    });

    expect(user).toContain('Uses Express for HTTP routing');
    expect(user).toContain('README.md');
    expect(user).toContain('behavior');
    expect(user).toContain('src/app.ts');
  });

  it('includes evidence in user prompt', () => {
    const { user } = buildVerifyPrompt({
      claimText: 'test',
      claimType: 'behavior',
      sourceFile: 'README.md',
      sourceLine: 1,
      evidence: 'function doStuff() { return true; }',
      evidenceFiles: ['src/stuff.ts'],
    });

    expect(user).toContain('function doStuff()');
  });

  it('has a system prompt about accuracy verification', () => {
    const { system } = buildVerifyPrompt({
      claimText: 'test',
      claimType: 'behavior',
      sourceFile: 'README.md',
      sourceLine: 1,
      evidence: '',
      evidenceFiles: [],
    });

    expect(system).toContain('documentation accuracy verifier');
    expect(system).toContain('FACTUAL accuracy');
    expect(system).toContain('JSON');
  });

  it('includes evidence files in the JSON schema hint', () => {
    const { user } = buildVerifyPrompt({
      claimText: 'test',
      claimType: 'behavior',
      sourceFile: 'README.md',
      sourceLine: 1,
      evidence: '',
      evidenceFiles: ['src/a.ts', 'src/b.ts'],
    });

    expect(user).toContain('"evidence_files"');
    expect(user).toContain('src/a.ts');
    expect(user).toContain('src/b.ts');
  });
});

describe('buildFixPrompt', () => {
  it('includes claim and mismatch in user prompt', () => {
    const { user } = buildFixPrompt({
      claimText: 'Requires Node 16',
      sourceFile: 'README.md',
      sourceLine: 5,
      mismatchDescription: 'Package.json requires Node 20',
      evidenceFiles: ['package.json'],
    });

    expect(user).toContain('Requires Node 16');
    expect(user).toContain('Package.json requires Node 20');
    expect(user).toContain('package.json');
  });

  it('has system prompt about documentation editing', () => {
    const { system } = buildFixPrompt({
      claimText: 'test',
      sourceFile: 'README.md',
      sourceLine: 1,
      mismatchDescription: 'wrong',
      evidenceFiles: [],
    });

    expect(system).toContain('documentation editor');
    expect(system).toContain('drop-in replacement');
  });
});

describe('PVerifyOutputSchema', () => {
  it('validates correct verify output', () => {
    const result = PVerifyOutputSchema.safeParse({
      verdict: 'drifted',
      confidence: 0.85,
      severity: 'medium',
      reasoning: 'The function was renamed',
      specific_mismatch: 'handleAuth was renamed to processAuth',
      suggested_fix: 'Replace handleAuth with processAuth',
      evidence_files: ['src/auth.ts'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    const result = PVerifyOutputSchema.safeParse({
      verdict: 'wrong',
      confidence: 0.5,
      severity: null,
      reasoning: 'test',
      specific_mismatch: null,
      suggested_fix: null,
      evidence_files: [],
    });

    expect(result.success).toBe(false);
  });

  it('allows null severity for verified verdict', () => {
    const result = PVerifyOutputSchema.safeParse({
      verdict: 'verified',
      confidence: 0.95,
      severity: null,
      reasoning: 'Matches code perfectly',
      specific_mismatch: null,
      suggested_fix: null,
      evidence_files: ['src/main.ts'],
    });

    expect(result.success).toBe(true);
  });
});

describe('PFixOutputSchema', () => {
  it('validates correct fix output', () => {
    const result = PFixOutputSchema.safeParse({
      suggested_fix: {
        file_path: 'README.md',
        line_start: 10,
        line_end: 10,
        new_text: 'Requires Node.js 20+',
        explanation: 'Updated Node version requirement',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing new_text', () => {
    const result = PFixOutputSchema.safeParse({
      suggested_fix: {
        file_path: 'README.md',
        line_start: 10,
        line_end: 10,
        new_text: '',
        explanation: 'test',
      },
    });

    expect(result.success).toBe(false);
  });
});
