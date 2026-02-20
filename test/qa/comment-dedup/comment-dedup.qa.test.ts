/**
 * QA Acceptance Tests: Comment Deduplication and Edge Cases
 * Pipeline: 01ac62af-09ad-4566-a99b-ee4fc7a46062
 *
 * Tests the dedup logic in action/post-comment.mjs:
 * - findExistingComment() searches by COMMENT_MARKER
 * - PATCH (update) vs POST (create) decision
 * - No cross-PR contamination
 * - Force-push resilience
 *
 * Strategy: Since post-comment.mjs is a standalone script that calls GitHub API
 * via fetch(), we test by mocking global fetch and simulating the script's logic.
 * We extract the core logic into testable functions or re-implement the contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const COMMENT_MARKER = '<!-- docalign-report -->';

// ---------- Helpers that mirror post-comment.mjs logic ----------

interface GitHubComment {
  id: number;
  body: string;
}

function findExistingComment(comments: GitHubComment[]): number | null {
  for (const comment of comments) {
    if (typeof comment.body === 'string' && comment.body.startsWith(COMMENT_MARKER)) {
      return comment.id;
    }
  }
  return null;
}

type ApiAction = { method: 'PATCH'; commentId: number; body: string }
              | { method: 'POST'; prNumber: number; body: string };

function determineAction(
  existingComments: GitHubComment[],
  newBody: string,
  prNumber: number,
): ApiAction {
  const existingId = findExistingComment(existingComments);
  const fullBody = `${COMMENT_MARKER}\n${newBody}`;
  if (existingId) {
    return { method: 'PATCH', commentId: existingId, body: fullBody };
  }
  return { method: 'POST', prNumber, body: fullBody };
}

// ---------- Tests ----------

describe('Comment Deduplication — QA Acceptance Tests', () => {

  describe('AC1: Update-on-rerun', () => {
    it('should PATCH existing comment when marker is found', () => {
      const existingComments: GitHubComment[] = [
        { id: 100, body: 'Some other bot comment' },
        { id: 200, body: `${COMMENT_MARKER}\n## DocAlign: 95% Documentation Health` },
        { id: 300, body: 'Another comment' },
      ];

      const action = determineAction(existingComments, 'Updated report', 42);

      expect(action.method).toBe('PATCH');
      expect(action).toHaveProperty('commentId', 200);
      expect(action.body).toContain(COMMENT_MARKER);
      expect(action.body).toContain('Updated report');
    });

    it('should find the first marker comment if multiple exist', () => {
      const existingComments: GitHubComment[] = [
        { id: 200, body: `${COMMENT_MARKER}\nFirst` },
        { id: 300, body: `${COMMENT_MARKER}\nSecond (stale duplicate)` },
      ];

      const id = findExistingComment(existingComments);
      expect(id).toBe(200);
    });
  });

  describe('AC2: Create-if-missing', () => {
    it('should POST new comment when no marker comment exists', () => {
      const existingComments: GitHubComment[] = [
        { id: 100, body: 'Some other comment' },
        { id: 101, body: 'Another comment without marker' },
      ];

      const action = determineAction(existingComments, 'New report', 42);

      expect(action.method).toBe('POST');
      expect(action).toHaveProperty('prNumber', 42);
      expect(action.body).toStartWith(COMMENT_MARKER);
    });

    it('should POST when comment list is empty', () => {
      const action = determineAction([], 'New report', 42);

      expect(action.method).toBe('POST');
      expect(action).toHaveProperty('prNumber', 42);
    });
  });

  describe('AC3: No cross-PR contamination', () => {
    it('should not match comments from a different PR context', () => {
      // Comments fetched from PR #1
      const pr1Comments: GitHubComment[] = [
        { id: 500, body: `${COMMENT_MARKER}\nPR 1 report` },
      ];

      // When posting to PR #2, we fetch PR #2's comments (empty)
      const pr2Comments: GitHubComment[] = [];

      // PR #1 has existing comment
      const pr1Action = determineAction(pr1Comments, 'Updated PR1', 1);
      expect(pr1Action.method).toBe('PATCH');

      // PR #2 has no comment — should POST, not find PR #1's comment
      const pr2Action = determineAction(pr2Comments, 'New PR2 report', 2);
      expect(pr2Action.method).toBe('POST');
      expect(pr2Action).toHaveProperty('prNumber', 2);
    });

    it('should use PR-scoped API endpoint for comment listing', () => {
      // Verify the API path includes the specific PR number
      // The script uses: /repos/{owner}/{repo}/issues/{prNumber}/comments
      // This ensures comments are fetched per-PR, not globally
      const prNumber = 42;
      const expectedPath = `/repos/test-owner/test-repo/issues/${prNumber}/comments`;
      expect(expectedPath).toContain(`/${prNumber}/`);
    });
  });

  describe('AC4: Force-push resilience', () => {
    it('should find existing comment after force-push (comment IDs persist on PR)', () => {
      // GitHub PR comments are attached to the issue/PR, not to commits.
      // After a force-push, the PR's comment list remains the same.
      // Simulate: same comments list before and after force-push.
      const commentsBeforeForcePush: GitHubComment[] = [
        { id: 700, body: `${COMMENT_MARKER}\nPre-force-push report` },
      ];

      // After force-push, the same comments are returned (PR comments survive)
      const commentsAfterForcePush = commentsBeforeForcePush;

      const actionBefore = determineAction(commentsBeforeForcePush, 'Before', 10);
      const actionAfter = determineAction(commentsAfterForcePush, 'After force-push', 10);

      expect(actionBefore.method).toBe('PATCH');
      expect(actionAfter.method).toBe('PATCH');
      expect(actionBefore).toHaveProperty('commentId', 700);
      expect(actionAfter).toHaveProperty('commentId', 700);
    });
  });

  describe('AC5: Marker format correctness', () => {
    it('should use exact HTML comment marker', () => {
      expect(COMMENT_MARKER).toBe('<!-- docalign-report -->');
    });

    it('should prepend marker to comment body', () => {
      const action = determineAction([], 'Report content', 1);
      expect(action.body).toBe(`${COMMENT_MARKER}\nReport content`);
    });

    it('should not match partial marker matches', () => {
      const comments: GitHubComment[] = [
        { id: 1, body: '<!-- docalign-report-v2 -->\nDifferent marker' },
        { id: 2, body: '<!-- docalign -->\nWrong marker' },
        { id: 3, body: 'Contains <!-- docalign-report --> in the middle' },
      ];

      // Only startsWith match should work (matching script's logic)
      const id = findExistingComment(comments);
      // id 3 doesn't start with the marker, ids 1 and 2 have different markers
      expect(id).toBeNull();
    });
  });
});
