import { describe, it, expect } from 'vitest';
import { validateFixPath } from '../../../src/server/fix/path-validation';

describe('validateFixPath', () => {
  it('accepts a simple relative path', () => {
    expect(validateFixPath('README.md')).toBe('README.md');
  });

  it('accepts a nested path', () => {
    expect(validateFixPath('docs/api.md')).toBe('docs/api.md');
  });

  it('accepts deeply nested path', () => {
    expect(validateFixPath('src/layers/L0/index.ts')).toBe('src/layers/L0/index.ts');
  });

  it('rejects absolute paths', () => {
    expect(validateFixPath('/etc/passwd')).toBeNull();
  });

  it('rejects path traversal with ..', () => {
    expect(validateFixPath('../etc/passwd')).toBeNull();
  });

  it('rejects path traversal mid-path', () => {
    expect(validateFixPath('docs/../../../etc/passwd')).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(validateFixPath('file\0.txt')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateFixPath('')).toBeNull();
  });

  it('rejects whitespace only', () => {
    expect(validateFixPath('   ')).toBeNull();
  });

  it('normalizes redundant separators', () => {
    const result = validateFixPath('docs//api.md');
    expect(result).toBe('docs/api.md');
  });

  it('normalizes ./prefix', () => {
    const result = validateFixPath('./README.md');
    expect(result).toBe('README.md');
  });
});
