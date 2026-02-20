import { describe, it, expect } from 'vitest';
import {
  extractRemoteUrl,
  parseGitRemoteUrl,
} from '../../../src/layers/L6-mcp/repo-resolver';

describe('extractRemoteUrl', () => {
  it('extracts HTTPS remote from git config', () => {
    const config = `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = https://github.com/testowner/testrepo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin`;

    expect(extractRemoteUrl(config)).toBe('https://github.com/testowner/testrepo.git');
  });

  it('extracts SSH remote from git config', () => {
    const config = `[remote "origin"]
\turl = git@github.com:testowner/testrepo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*`;

    expect(extractRemoteUrl(config)).toBe('git@github.com:testowner/testrepo.git');
  });

  it('returns null when no origin remote', () => {
    const config = `[core]
\trepositoryformatversion = 0
[remote "upstream"]
\turl = https://github.com/other/repo.git`;

    expect(extractRemoteUrl(config)).toBeNull();
  });

  it('returns null for empty config', () => {
    expect(extractRemoteUrl('')).toBeNull();
  });

  it('stops at next section boundary', () => {
    const config = `[remote "origin"]
\turl = https://github.com/owner/repo.git
[remote "upstream"]
\turl = https://github.com/other/repo.git`;

    expect(extractRemoteUrl(config)).toBe('https://github.com/owner/repo.git');
  });
});

describe('parseGitRemoteUrl', () => {
  it('parses HTTPS URL with .git suffix', () => {
    const result = parseGitRemoteUrl('https://github.com/testowner/testrepo.git');
    expect(result).toEqual({ owner: 'testowner', repo: 'testrepo' });
  });

  it('parses HTTPS URL without .git suffix', () => {
    const result = parseGitRemoteUrl('https://github.com/testowner/testrepo');
    expect(result).toEqual({ owner: 'testowner', repo: 'testrepo' });
  });

  it('parses SSH git@ URL', () => {
    const result = parseGitRemoteUrl('git@github.com:testowner/testrepo.git');
    expect(result).toEqual({ owner: 'testowner', repo: 'testrepo' });
  });

  it('parses SSH git@ URL without .git suffix', () => {
    const result = parseGitRemoteUrl('git@github.com:testowner/testrepo');
    expect(result).toEqual({ owner: 'testowner', repo: 'testrepo' });
  });

  it('parses ssh:// URL', () => {
    const result = parseGitRemoteUrl('ssh://git@github.com/testowner/testrepo.git');
    expect(result).toEqual({ owner: 'testowner', repo: 'testrepo' });
  });

  it('parses ssh:// URL without .git suffix', () => {
    const result = parseGitRemoteUrl('ssh://git@github.com/testowner/testrepo');
    expect(result).toEqual({ owner: 'testowner', repo: 'testrepo' });
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseGitRemoteUrl('https://gitlab.com/owner/repo.git')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseGitRemoteUrl('not-a-url')).toBeNull();
  });

  it('handles repos with hyphens and dots', () => {
    const result = parseGitRemoteUrl('https://github.com/my-org/my-repo');
    expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' });
  });
});

describe('Error handling', () => {
  describe('extractRemoteUrl', () => {
    it('handles malformed git config', () => {
      const malformed = `[remote "origin"
\turl = incomplete line`;
      // Should return null instead of throwing
      expect(extractRemoteUrl(malformed)).toBeNull();
    });

    it('handles config with no url field', () => {
      const noUrl = `[remote "origin"]
\tfetch = +refs/heads/*:refs/remotes/origin/*`;
      expect(extractRemoteUrl(noUrl)).toBeNull();
    });

    it('handles invalid UTF-8 or binary data', () => {
      const invalid = '\x00\x01\x02[remote "origin"]\x00';
      expect(() => extractRemoteUrl(invalid)).not.toThrow();
    });
  });

  describe('parseGitRemoteUrl', () => {
    it('handles empty string gracefully', () => {
      expect(parseGitRemoteUrl('')).toBeNull();
    });

    it('handles malformed URLs', () => {
      expect(parseGitRemoteUrl('https://')).toBeNull();
      expect(parseGitRemoteUrl('git@')).toBeNull();
      expect(parseGitRemoteUrl('://invalid')).toBeNull();
    });

    it('handles URLs with missing owner or repo', () => {
      expect(parseGitRemoteUrl('https://github.com/')).toBeNull();
      expect(parseGitRemoteUrl('https://github.com/owner')).toBeNull();
      expect(parseGitRemoteUrl('git@github.com:')).toBeNull();
    });

    it('handles non-GitHub hosts correctly', () => {
      expect(parseGitRemoteUrl('https://bitbucket.org/owner/repo')).toBeNull();
      expect(parseGitRemoteUrl('git@gitlab.com:owner/repo.git')).toBeNull();
    });
  });
});
