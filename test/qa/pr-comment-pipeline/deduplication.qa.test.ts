/**
 * QA: Comment deduplication with pagination.
 * Tests the findExistingComment logic from post-comment.mjs.
 */
import { describe, it, expect, vi } from 'vitest';

const COMMENT_MARKER = '<!-- docalign-report -->';
const SUMMARY_MARKER_PREFIX = '<!-- docalign-summary scan-run-id=';

/**
 * Extracted dedup logic matching post-comment.mjs.
 */
function findExistingComment(
  comments: Array<{ id: number; body: string }>,
  marker: string = COMMENT_MARKER,
): number | null {
  for (const comment of comments) {
    if (typeof comment.body === 'string' && comment.body.startsWith(marker)) {
      return comment.id;
    }
  }
  return null;
}

/**
 * Paginated search (simulates multi-page GitHub API responses).
 */
async function findExistingCommentPaginated(
  pages: Array<Array<{ id: number; body: string }>>,
  marker: string = COMMENT_MARKER,
): Promise<number | null> {
  for (const page of pages) {
    const found = findExistingComment(page, marker);
    if (found !== null) return found;
  }
  return null;
}

describe('QA: Comment deduplication', () => {
  it('finds existing comment by marker in first page', () => {
    const comments = [
      { id: 1, body: 'Some other bot comment' },
      { id: 2, body: `${COMMENT_MARKER}\n## DocAlign results` },
      { id: 3, body: 'Another comment' },
    ];
    expect(findExistingComment(comments)).toBe(2);
  });

  it('returns null when no marker comment exists', () => {
    const comments = [
      { id: 1, body: 'Random comment' },
      { id: 2, body: 'Another comment' },
    ];
    expect(findExistingComment(comments)).toBeNull();
  });

  it('returns null for empty comment list', () => {
    expect(findExistingComment([])).toBeNull();
  });

  it('handles null-safety: ignores comments with non-string body', () => {
    const comments = [
      { id: 1, body: null as unknown as string },
      { id: 2, body: undefined as unknown as string },
      { id: 3, body: `${COMMENT_MARKER}\nReal comment` },
    ];
    expect(findExistingComment(comments)).toBe(3);
  });

  it('finds marker only at start of body (not embedded)', () => {
    const comments = [
      { id: 1, body: `Some text before ${COMMENT_MARKER}` },
    ];
    expect(findExistingComment(comments)).toBeNull();
  });

  it('returns first match when multiple marker comments exist', () => {
    const comments = [
      { id: 10, body: `${COMMENT_MARKER}\nFirst` },
      { id: 20, body: `${COMMENT_MARKER}\nSecond` },
    ];
    expect(findExistingComment(comments)).toBe(10);
  });

  describe('pagination', () => {
    it('finds comment in second page', async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, body: `Comment ${i}` }));
      const page2 = [
        { id: 51, body: 'More comments' },
        { id: 52, body: `${COMMENT_MARKER}\nDocAlign result` },
      ];
      const result = await findExistingCommentPaginated([page1, page2]);
      expect(result).toBe(52);
    });

    it('returns null across all pages when not found', async () => {
      const page1 = [{ id: 1, body: 'a' }];
      const page2 = [{ id: 2, body: 'b' }];
      expect(await findExistingCommentPaginated([page1, page2])).toBeNull();
    });

    it('returns early when found in first page', async () => {
      const page1 = [{ id: 1, body: `${COMMENT_MARKER}\nFound` }];
      const page2 = [{ id: 2, body: `${COMMENT_MARKER}\nNever reached` }];
      expect(await findExistingCommentPaginated([page1, page2])).toBe(1);
    });
  });

  describe('summary marker dedup (comment-formatter style)', () => {
    it('finds comment with docalign-summary marker', () => {
      const comments = [
        { id: 5, body: `${SUMMARY_MARKER_PREFIX}scan-123 -->\n## DocAlign Scan Results` },
      ];
      expect(findExistingComment(comments, SUMMARY_MARKER_PREFIX)).toBe(5);
    });
  });
});
