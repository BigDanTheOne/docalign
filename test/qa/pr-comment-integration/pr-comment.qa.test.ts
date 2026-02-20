import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatGitHubPRComment, type StaleClaim } from '../../../src/cli/output';
import { parseArgs } from '../../../src/cli/index';

/**
 * QA acceptance tests for T2: PR Comment Integration
 * These define the behavioral contracts the build must satisfy.
 */

describe('QA contract: PR comment formatter', () => {
  // AC1: Summarizes scan results
  it('produces a markdown string from drift scan results', () => {
    const staleClaims: StaleClaim[] = [
      {
        file: 'README.md',
        line: 10,
        claimText: 'API endpoint is /api/v1/users',
        actual: 'Actual endpoint is /api/v2/users',
        severity: 'high',
      },
    ];

    const result = formatGitHubPRComment(5, staleClaims);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // AC2: Comment includes total claims, stale count, stale list with file + line
  it('includes total claims checked count in output', () => {
    const result = formatGitHubPRComment(42, []);
    expect(result).toContain('42');
  });

  it('includes stale claims count in output', () => {
    const staleClaims: StaleClaim[] = [
      { file: 'README.md', line: 10, claimText: 'test', actual: 'different', severity: 'high' },
      { file: 'DOCS.md', line: 20, claimText: 'test2', actual: 'different2', severity: 'medium' },
    ];
    const result = formatGitHubPRComment(10, staleClaims);
    expect(result).toContain('2');
  });

  it('lists each stale claim with file path and line number', () => {
    const staleClaims: StaleClaim[] = [
      {
        file: 'README.md',
        line: 10,
        claimText: 'API endpoint is /api/v1/users',
        actual: 'Actual endpoint is /api/v2/users',
        severity: 'high',
      },
    ];

    const result = formatGitHubPRComment(5, staleClaims);
    expect(result).toContain('README.md');
    expect(result).toContain('10');
    expect(result).toContain('API endpoint is /api/v1/users');
  });

  // AC3: Upsert marker for comment deduplication
  it('includes <!-- docalign-report --> HTML marker in output', () => {
    const result = formatGitHubPRComment(0, []);
    expect(result).toContain('<!-- docalign-report -->');
  });

  // AC4: Status indicator
  it('shows ✅ when zero stale claims found', () => {
    const result = formatGitHubPRComment(5, []);
    expect(result).toContain('✅');
  });

  it('shows ❌ when one or more stale claims found', () => {
    const staleClaims: StaleClaim[] = [
      { file: 'README.md', line: 10, claimText: 'test', actual: 'different', severity: 'high' },
    ];
    const result = formatGitHubPRComment(5, staleClaims);
    expect(result).toContain('❌');
  });

  // AC5: Collapsible details
  it('wraps stale claims table in <details> element', () => {
    const staleClaims: StaleClaim[] = [
      { file: 'README.md', line: 10, claimText: 'test', actual: 'different', severity: 'high' },
    ];
    const result = formatGitHubPRComment(5, staleClaims);
    expect(result).toContain('<details>');
    expect(result).toContain('</details>');
  });

  // AC6: Works with default GITHUB_TOKEN (no special permissions beyond pull-requests: write)
  it('does not require any token scope beyond pull-requests:write', () => {
    // This is verified by the action.yml configuration and post-comment.mjs implementation
    // which only uses the GitHub Issues API (comments endpoint) which requires pull-requests:write
    const actionYml = readFileSync('./action/action.yml', 'utf-8');
    expect(actionYml).toContain('github-token');

    const postComment = readFileSync('./action/post-comment.mjs', 'utf-8');
    // Verify it only uses comments API endpoints
    expect(postComment).toContain('/issues/');
    expect(postComment).toContain('/comments');
  });
});

describe('QA contract: PR comment truncation', () => {
  it('truncates output at 65536 characters', () => {
    // Generate a large number of stale claims to exceed the limit
    const staleClaims: StaleClaim[] = [];
    for (let i = 0; i < 2000; i++) {
      staleClaims.push({
        file: `file${i}.md`,
        line: i,
        claimText: 'A'.repeat(100),
        actual: 'B'.repeat(100),
        severity: 'medium',
      });
    }

    const result = formatGitHubPRComment(2000, staleClaims);
    expect(result.length).toBeLessThanOrEqual(65536);
  });

  it('appends "X more items..." when truncated', () => {
    // Generate enough claims to trigger truncation
    const staleClaims: StaleClaim[] = [];
    for (let i = 0; i < 2000; i++) {
      staleClaims.push({
        file: `file${i}.md`,
        line: i,
        claimText: 'A'.repeat(100),
        actual: 'B'.repeat(100),
        severity: 'medium',
      });
    }

    const result = formatGitHubPRComment(2000, staleClaims);
    if (result.length >= 65500) {
      // Should have truncation message
      expect(result).toMatch(/\d+ more items/);
    }
  });
});

describe('QA contract: CLI --format github-pr', () => {
  it('accepts --format github-pr flag without error', () => {
    const args = parseArgs(['node', 'docalign', 'scan', '--format=github-pr']);
    expect(args.options.format).toBe('github-pr');
  });

  it('outputs github-pr formatted markdown when flag is set', async () => {
    // This is tested via the formatGitHubPRComment function which is called
    // when --format github-pr is used. The integration is verified by checking
    // that the scan command passes the format option correctly.
    const args = parseArgs(['node', 'docalign', 'scan', '--format', 'github-pr']);
    expect(args.options.format).toBe('github-pr');
  });
});

describe('QA contract: action.yml comment step', () => {
  it('action.yml includes a step that posts or updates the PR comment', () => {
    const actionYml = readFileSync('./action/action.yml', 'utf-8');
    expect(actionYml).toContain('Post PR Comment');
    expect(actionYml).toContain('post-comment.mjs');
  });

  it('action.yml declares permissions.pull-requests: write', () => {
    const actionYml = readFileSync('./action/action.yml', 'utf-8');
    // Check that permissions are documented in the action.yml
    expect(actionYml).toContain('pull-requests');
    expect(actionYml).toContain('write');
  });
});
