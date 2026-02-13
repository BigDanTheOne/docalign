import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import {
  getChangedFilesSince,
  getCurrentCommitSha,
  getWorkingTreeChanges,
} from '../../src/cli/git-utils';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = child_process.execSync as unknown as ReturnType<typeof vi.fn>;

describe('git-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getChangedFilesSince', () => {
    it('returns changed files', () => {
      mockedExecSync.mockReturnValue('src/app.ts\nsrc/auth.ts\n');
      const result = getChangedFilesSince('/repo', 'abc123');
      expect(result).toEqual(['src/app.ts', 'src/auth.ts']);
      expect(mockedExecSync).toHaveBeenCalledWith(
        'git diff --name-only abc123 HEAD',
        expect.objectContaining({ cwd: '/repo' }),
      );
    });

    it('returns empty array for no changes', () => {
      mockedExecSync.mockReturnValue('');
      const result = getChangedFilesSince('/repo', 'abc123');
      expect(result).toEqual([]);
    });

    it('returns null on error', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
      const result = getChangedFilesSince('/repo', 'abc123');
      expect(result).toBeNull();
    });
  });

  describe('getCurrentCommitSha', () => {
    it('returns SHA', () => {
      mockedExecSync.mockReturnValue('abc123def456\n');
      const result = getCurrentCommitSha('/repo');
      expect(result).toBe('abc123def456');
    });

    it('returns null on error', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
      const result = getCurrentCommitSha('/repo');
      expect(result).toBeNull();
    });
  });

  describe('getWorkingTreeChanges', () => {
    it('returns changed files', () => {
      mockedExecSync.mockReturnValue('src/modified.ts\n');
      const result = getWorkingTreeChanges('/repo');
      expect(result).toEqual(['src/modified.ts']);
    });

    it('returns empty array for clean tree', () => {
      mockedExecSync.mockReturnValue('');
      const result = getWorkingTreeChanges('/repo');
      expect(result).toEqual([]);
    });

    it('returns null on error', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('fail'); });
      const result = getWorkingTreeChanges('/repo');
      expect(result).toBeNull();
    });
  });
});
