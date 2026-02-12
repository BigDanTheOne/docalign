import { describe, it, expect, vi } from 'vitest';
import { applyFixes } from '../../../src/server/fix/apply';
import type { DocFix } from '../../../src/shared/types';

function makeFix(overrides: Partial<DocFix> = {}): DocFix {
  return {
    file: 'README.md',
    line_start: 45,
    line_end: 45,
    old_text: 'Uses bcrypt for password hashing.',
    new_text: 'Uses argon2id for password hashing.',
    reason: 'bcrypt vs argon2id',
    claim_id: 'claim-1',
    confidence: 0.95,
    ...overrides,
  };
}

describe('applyFixes', () => {
  it('applies a single fix successfully', async () => {
    const fix = makeFix();
    const getContent = vi.fn().mockResolvedValue('# Auth\nUses bcrypt for password hashing.\n');

    const { result, modifiedFiles } = await applyFixes([fix], getContent);

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(modifiedFiles.get('README.md')).toContain('argon2id');
    expect(modifiedFiles.get('README.md')).not.toContain('bcrypt');
  });

  it('reports failure when old_text not found', async () => {
    const fix = makeFix({ old_text: 'This text does not exist' });
    const getContent = vi.fn().mockResolvedValue('# Auth\nSome other content.\n');

    const { result } = await applyFixes([fix], getContent);

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('old_text not found');
  });

  it('reports failure when file not found', async () => {
    const fix = makeFix();
    const getContent = vi.fn().mockResolvedValue(null);

    const { result } = await applyFixes([fix], getContent);

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('File not found');
  });

  it('rejects path traversal in fix file', async () => {
    const fix = makeFix({ file: '../../../etc/passwd' });
    const getContent = vi.fn();

    const { result } = await applyFixes([fix], getContent);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('path traversal');
    expect(getContent).not.toHaveBeenCalled();
  });

  it('rejects absolute path in fix file', async () => {
    const fix = makeFix({ file: '/etc/passwd' });
    const getContent = vi.fn();

    const { result } = await applyFixes([fix], getContent);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('path traversal');
  });

  it('applies multiple fixes to same file sequentially', async () => {
    const fixes = [
      makeFix({ old_text: 'Uses bcrypt.', new_text: 'Uses argon2id.', line_start: 10, claim_id: 'c1' }),
      makeFix({ old_text: 'Default timeout is 30s.', new_text: 'Default timeout is 60s.', line_start: 20, claim_id: 'c2' }),
    ];
    const getContent = vi.fn().mockResolvedValue('Uses bcrypt.\nOther stuff.\nDefault timeout is 30s.\n');

    const { result, modifiedFiles } = await applyFixes(fixes, getContent);

    expect(result.applied).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    const content = modifiedFiles.get('README.md')!;
    expect(content).toContain('argon2id');
    expect(content).toContain('60s');
    // Only fetched file once
    expect(getContent).toHaveBeenCalledTimes(1);
  });

  it('handles $-pattern safely in new_text', async () => {
    // CRITICAL: $1, $&, $$, $' in new_text must not be interpreted
    const testCases = [
      { new_text: 'Cost is $100', label: '$-number' },
      { new_text: 'Match $& here', label: '$&' },
      { new_text: 'Dollar $$ sign', label: '$$' },
      { new_text: "Before $' after", label: "$'" },
      { new_text: 'Backtick $` here', label: '$`' },
    ];

    for (const { new_text, label } of testCases) {
      const fix = makeFix({ new_text });
      const getContent = vi.fn().mockResolvedValue('Uses bcrypt for password hashing.');

      const { result, modifiedFiles } = await applyFixes([fix], getContent);

      expect(result.applied).toHaveLength(1);
      expect(modifiedFiles.get('README.md')).toBe(new_text);
    }
  });

  it('handles partial failure (one succeeds, one fails)', async () => {
    const fixes = [
      makeFix({ old_text: 'First text', new_text: 'Updated first', claim_id: 'c1' }),
      makeFix({ old_text: 'Not in file', new_text: 'Should fail', claim_id: 'c2' }),
    ];
    const getContent = vi.fn().mockResolvedValue('First text\nSecond text');

    const { result } = await applyFixes(fixes, getContent);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].claim_id).toBe('c1');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].claim_id).toBe('c2');
  });

  it('applies fixes across different files', async () => {
    const fixes = [
      makeFix({ file: 'README.md', old_text: 'old readme', new_text: 'new readme', claim_id: 'c1' }),
      makeFix({ file: 'docs/api.md', old_text: 'old api', new_text: 'new api', claim_id: 'c2' }),
    ];
    const getContent = vi.fn().mockImplementation(async (path: string) => {
      if (path === 'README.md') return 'old readme content';
      if (path === 'docs/api.md') return 'old api docs';
      return null;
    });

    const { result, modifiedFiles } = await applyFixes(fixes, getContent);

    expect(result.applied).toHaveLength(2);
    expect(modifiedFiles.size).toBe(2);
    expect(modifiedFiles.get('README.md')).toContain('new readme');
    expect(modifiedFiles.get('docs/api.md')).toContain('new api');
  });
});
