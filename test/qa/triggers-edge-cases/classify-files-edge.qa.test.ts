import { describe, it, expect } from 'vitest';
import { classifyFiles } from '../../../src/layers/L4-triggers/classify-files';
import type { FileChange } from '../../../src/shared/types';

function makeChange(filename: string, status: FileChange['status'] = 'modified'): FileChange {
  return { filename, status, additions: 1, deletions: 0 };
}

describe('classifyFiles – edge cases', () => {
  it('handles empty array without throwing', () => {
    const result = classifyFiles([]);
    expect(result.code_files).toHaveLength(0);
    expect(result.doc_files).toHaveLength(0);
    expect(result.renames).toHaveLength(0);
    expect(result.deletions).toHaveLength(0);
  });

  it('handles files with no extension', () => {
    const result = classifyFiles([makeChange('Makefile'), makeChange('LICENSE')]);
    // Files without recognized doc extensions should land in code_files
    expect(result.code_files.length).toBeGreaterThanOrEqual(1);
    expect(result.doc_files).toHaveLength(0);
  });

  it('handles files with unknown extensions', () => {
    const result = classifyFiles([makeChange('data.xyz'), makeChange('config.toml')]);
    // Unknown extensions should not throw and should be classified as code
    expect(result.code_files.length).toBeGreaterThanOrEqual(1);
    expect(result.doc_files).toHaveLength(0);
  });
});
