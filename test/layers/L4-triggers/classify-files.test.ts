import { describe, it, expect } from 'vitest';
import { classifyFiles, isDocFile } from '../../../src/layers/L4-triggers/classify-files';
import type { FileChange } from '../../../src/shared/types';

function makeChange(filename: string, status: FileChange['status'] = 'modified'): FileChange {
  return { filename, status, additions: 1, deletions: 0 };
}

describe('classifyFiles', () => {
  it('classifies .md as doc, .ts as code', () => {
    const changes: FileChange[] = [
      makeChange('README.md'),
      makeChange('src/app.ts'),
    ];
    const result = classifyFiles(changes);
    expect(result.doc_files).toHaveLength(1);
    expect(result.doc_files[0].filename).toBe('README.md');
    expect(result.code_files).toHaveLength(1);
    expect(result.code_files[0].filename).toBe('src/app.ts');
  });

  it('classifies all doc extensions', () => {
    const changes: FileChange[] = [
      makeChange('doc.md'),
      makeChange('doc.mdx'),
      makeChange('doc.rst'),
      makeChange('doc.txt'),
      makeChange('doc.adoc'),
    ];
    const result = classifyFiles(changes);
    expect(result.doc_files).toHaveLength(5);
    expect(result.code_files).toHaveLength(0);
  });

  it('tracks renames separately', () => {
    const changes: FileChange[] = [
      { filename: 'new.ts', status: 'renamed', previous_filename: 'old.ts', additions: 0, deletions: 0 },
    ];
    const result = classifyFiles(changes);
    expect(result.renames).toHaveLength(1);
    expect(result.renames[0].previous_filename).toBe('old.ts');
    // Renamed files also get classified as code/doc
    expect(result.code_files).toHaveLength(1);
  });

  it('tracks deletions and excludes them from code/doc', () => {
    const changes: FileChange[] = [
      makeChange('deleted.ts', 'removed'),
      makeChange('kept.ts'),
    ];
    const result = classifyFiles(changes);
    expect(result.deletions).toHaveLength(1);
    expect(result.deletions[0].filename).toBe('deleted.ts');
    expect(result.code_files).toHaveLength(1);
    expect(result.code_files[0].filename).toBe('kept.ts');
  });

  it('applies exclude patterns', () => {
    const changes: FileChange[] = [
      makeChange('src/app.ts'),
      makeChange('vendor/lib.js'),
      makeChange('README.md'),
    ];
    const result = classifyFiles(changes, ['vendor/**']);
    expect(result.code_files).toHaveLength(1);
    expect(result.code_files[0].filename).toBe('src/app.ts');
    expect(result.doc_files).toHaveLength(1);
  });

  it('handles empty input', () => {
    const result = classifyFiles([]);
    expect(result.code_files).toHaveLength(0);
    expect(result.doc_files).toHaveLength(0);
    expect(result.renames).toHaveLength(0);
    expect(result.deletions).toHaveLength(0);
  });

  it('handles files without extensions as code', () => {
    const changes: FileChange[] = [makeChange('Makefile')];
    const result = classifyFiles(changes);
    expect(result.code_files).toHaveLength(1);
  });

  it('handles case-insensitive extensions', () => {
    const changes: FileChange[] = [makeChange('DOC.MD')];
    const result = classifyFiles(changes);
    expect(result.doc_files).toHaveLength(1);
  });
});

describe('isDocFile', () => {
  it('returns true for doc extensions', () => {
    expect(isDocFile('README.md')).toBe(true);
    expect(isDocFile('guide.rst')).toBe(true);
    expect(isDocFile('notes.txt')).toBe(true);
    expect(isDocFile('page.mdx')).toBe(true);
    expect(isDocFile('doc.adoc')).toBe(true);
  });

  it('returns false for code files', () => {
    expect(isDocFile('app.ts')).toBe(false);
    expect(isDocFile('main.py')).toBe(false);
    expect(isDocFile('index.js')).toBe(false);
  });

  it('returns false for no extension', () => {
    expect(isDocFile('Makefile')).toBe(false);
  });
});
