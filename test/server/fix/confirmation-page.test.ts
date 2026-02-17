import { describe, it, expect } from 'vitest';
import { buildConfirmationPage, buildErrorPage } from '../../../src/server/fix/confirmation-page';

describe('buildConfirmationPage', () => {
  it('renders fix count, PR, and repo name', () => {
    const html = buildConfirmationPage({
      fixCount: 2,
      prNumber: 47,
      repoFullName: 'acme/webapp',
      fixes: [
        { file: 'README.md', line_start: 45, line_end: 45, old_text: 'old', new_text: 'new', reason: 'Update version', claim_id: 'c1', confidence: 0.9 },
        { file: 'docs/api.md', line_start: 201, line_end: 201, old_text: 'old', new_text: 'new', reason: 'Fix pagination', claim_id: 'c2', confidence: 0.85 },
      ],
      hiddenFields: { repo: 'repo-id', scan_run_id: 'scan-id', token: 'token-val' },
      postAction: '/api/fix/apply',
    });

    expect(html).toContain('2 fixes');
    expect(html).toContain('#47');
    expect(html).toContain('acme/webapp');
    expect(html).toContain('README.md');
    expect(html).toContain('docs/api.md');
    expect(html).toContain('Update version');
    expect(html).toContain('Fix pagination');
  });

  it('includes hidden form fields', () => {
    const html = buildConfirmationPage({
      fixCount: 1,
      prNumber: 10,
      repoFullName: 'test/repo',
      fixes: [{ file: 'f.md', line_start: 1, line_end: 1, old_text: 'a', new_text: 'b', reason: 'r', claim_id: 'c', confidence: 0.9 }],
      hiddenFields: { repo: 'r-id', scan_run_id: 's-id', token: 't-val' },
      postAction: '/api/fix/apply',
    });

    expect(html).toContain('name="repo" value="r-id"');
    expect(html).toContain('name="scan_run_id" value="s-id"');
    expect(html).toContain('name="token" value="t-val"');
    expect(html).toContain('method="POST"');
    expect(html).toContain('action="/api/fix/apply"');
  });

  it('escapes HTML in user-provided content', () => {
    const html = buildConfirmationPage({
      fixCount: 1,
      prNumber: 1,
      repoFullName: '<script>alert("xss")</script>',
      fixes: [{ file: 'f.md', line_start: 1, line_end: 1, old_text: 'a', new_text: 'b', reason: '<img onerror=alert(1)>', claim_id: 'c', confidence: 0.9 }],
      hiddenFields: { repo: 'r', scan_run_id: 's', token: 't' },
      postAction: '/api/fix/apply',
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('has no third-party resource references', () => {
    const html = buildConfirmationPage({
      fixCount: 1,
      prNumber: 1,
      repoFullName: 'a/b',
      fixes: [{ file: 'f.md', line_start: 1, line_end: 1, old_text: 'a', new_text: 'b', reason: 'r', claim_id: 'c', confidence: 0.9 }],
      hiddenFields: { repo: 'r', scan_run_id: 's', token: 't' },
      postAction: '/api/fix/apply',
    });

    // No external URLs
    expect(html).not.toMatch(/https?:\/\//);
    // No CDN references
    expect(html).not.toContain('cdn.');
    expect(html).not.toContain('googleapis');
  });

  it('uses singular fix for count 1', () => {
    const html = buildConfirmationPage({
      fixCount: 1,
      prNumber: 1,
      repoFullName: 'a/b',
      fixes: [{ file: 'f.md', line_start: 1, line_end: 1, old_text: 'a', new_text: 'b', reason: 'r', claim_id: 'c', confidence: 0.9 }],
      hiddenFields: { repo: 'r', scan_run_id: 's', token: 't' },
      postAction: '/api/fix/apply',
    });

    expect(html).toContain('1 fix</strong>');
    expect(html).not.toContain('1 fixes');
  });
});

describe('buildErrorPage', () => {
  it('renders title and message', () => {
    const html = buildErrorPage('Not Found', 'The page was not found.');
    expect(html).toContain('Not Found');
    expect(html).toContain('The page was not found.');
  });

  it('escapes HTML in error content', () => {
    const html = buildErrorPage('<script>xss</script>', 'safe');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
