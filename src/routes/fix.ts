import { Router } from 'express';
import type { DatabaseClient } from '../shared/db';
import type { DocFix } from '../shared/types';
import { validateFixToken } from '../server/fix/hmac';
import { buildConfirmationPage, buildErrorPage } from '../server/fix/confirmation-page';
import { applyFixes } from '../server/fix/apply';
import { createFixCommit, type GitHubClient } from '../server/fix/git-trees';
import logger from '../shared/logger';

export interface FixRouteDeps {
  db: DatabaseClient;
  apiSecret: string;
  getGitHubClient: (installationId: number) => Promise<GitHubClient>;
  getPRState: (owner: string, repo: string, prNumber: number, installationId: number) => Promise<'open' | 'closed' | 'merged'>;
  getPRBranch: (owner: string, repo: string, prNumber: number, installationId: number) => Promise<string>;
  getFileContent: (owner: string, repo: string, filePath: string, ref: string, installationId: number) => Promise<string | null>;
  postComment: (owner: string, repo: string, prNumber: number, body: string, installationId: number) => Promise<void>;
}

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
};

export function createFixRoute(deps: FixRouteDeps): Router {
  const router = Router();

  // GET /api/fix/apply — Confirmation page (GATE42-029)
  router.get('/apply', async (req, res) => {
    const { repo: repoId, scan_run_id: scanRunId, token, pr_number: prNumberStr } = req.query as Record<string, string | undefined>;

    if (!repoId || !scanRunId || !token || !prNumberStr) {
      res.set(SECURITY_HEADERS).status(400).type('html').send(
        buildErrorPage('Bad Request', 'Missing required query parameters.'),
      );
      return;
    }

    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber)) {
      res.set(SECURITY_HEADERS).status(400).type('html').send(
        buildErrorPage('Bad Request', 'Invalid PR number.'),
      );
      return;
    }

    // Validate HMAC
    if (!validateFixToken(token, deps.apiSecret, repoId, prNumber, scanRunId)) {
      res.set(SECURITY_HEADERS).status(403).type('html').send(
        buildErrorPage('Forbidden', 'Invalid or expired fix token.'),
      );
      return;
    }

    // Look up repo
    const repoResult = await deps.db.query<{
      github_owner: string;
      github_repo: string;
      github_installation_id: number;
    }>(
      'SELECT github_owner, github_repo, github_installation_id FROM repos WHERE id = $1',
      [repoId],
    );
    if (repoResult.rows.length === 0) {
      res.set(SECURITY_HEADERS).status(404).type('html').send(
        buildErrorPage('Not Found', 'Repository not found.'),
      );
      return;
    }

    const { github_owner: owner, github_repo: repo, github_installation_id: installationId } = repoResult.rows[0];

    // Look up scan run
    const scanResult = await deps.db.query<{ id: string }>(
      'SELECT id FROM scan_runs WHERE id = $1 AND repo_id = $2',
      [scanRunId, repoId],
    );
    if (scanResult.rows.length === 0) {
      res.set(SECURITY_HEADERS).status(404).type('html').send(
        buildErrorPage('Not Found', 'Scan run not found.'),
      );
      return;
    }

    // Check PR state (GATE42-028)
    const prState = await deps.getPRState(owner, repo, prNumber, installationId);
    if (prState !== 'open') {
      res.set(SECURITY_HEADERS).status(400).type('html').send(
        buildErrorPage('PR Closed', 'This PR is no longer open. Fixes cannot be applied.'),
      );
      return;
    }

    // Fetch fixes for this scan
    const fixesResult = await deps.db.query<DocFix>(
      `SELECT vr.suggested_fix->>'file_path' AS file,
              (vr.suggested_fix->>'line_start')::int AS line_start,
              (vr.suggested_fix->>'line_end')::int AS line_end,
              vr.suggested_fix->>'old_text' AS old_text,
              vr.suggested_fix->>'new_text' AS new_text,
              COALESCE(vr.reasoning, 'Documentation drift detected') AS reason,
              vr.claim_id,
              vr.confidence
       FROM verification_results vr
       WHERE vr.scan_run_id = $1
         AND vr.repo_id = $2
         AND vr.verdict = 'drifted'
         AND vr.suggested_fix IS NOT NULL
         AND vr.suggested_fix->>'new_text' IS NOT NULL`,
      [scanRunId, repoId],
    );

    const fixes = fixesResult.rows;

    // GATE42-036: No fixes → no confirmation page
    if (fixes.length === 0) {
      res.set(SECURITY_HEADERS).status(404).type('html').send(
        buildErrorPage('No Fixes', 'No applicable fixes found for this scan.'),
      );
      return;
    }

    // Build and return confirmation page
    const html = buildConfirmationPage({
      fixCount: fixes.length,
      prNumber,
      repoFullName: `${owner}/${repo}`,
      fixes,
      hiddenFields: {
        repo: repoId,
        scan_run_id: scanRunId,
        token,
      },
      postAction: '/api/fix/apply',
    });

    res.set(SECURITY_HEADERS).status(200).type('html').send(html);
  });

  // POST /api/fix/apply — Apply fixes (GATE42-022, GATE42-023)
  router.post('/apply', async (req, res) => {
    const { repo: repoId, scan_run_id: scanRunId, token } = req.body as Record<string, string | undefined>;

    if (!repoId || !scanRunId || !token) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Look up repo for PR number
    const repoResult = await deps.db.query<{
      github_owner: string;
      github_repo: string;
      github_installation_id: number;
    }>(
      'SELECT github_owner, github_repo, github_installation_id FROM repos WHERE id = $1',
      [repoId],
    );
    if (repoResult.rows.length === 0) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const { github_owner: owner, github_repo: repo, github_installation_id: installationId } = repoResult.rows[0];

    // Get scan run for PR number
    const scanResult = await deps.db.query<{ trigger_ref: string | null }>(
      'SELECT trigger_ref FROM scan_runs WHERE id = $1 AND repo_id = $2',
      [scanRunId, repoId],
    );
    if (scanResult.rows.length === 0) {
      res.status(404).json({ error: 'Scan run not found' });
      return;
    }

    const prNumber = parseInt(scanResult.rows[0].trigger_ref || '', 10);
    if (isNaN(prNumber)) {
      res.status(400).json({ error: 'Scan run has no associated PR' });
      return;
    }

    // Re-validate HMAC (GATE42-025)
    if (!validateFixToken(token, deps.apiSecret, repoId, prNumber, scanRunId)) {
      res.status(403).json({ error: 'Invalid or expired fix token' });
      return;
    }

    // Re-check PR state (GATE42-028)
    const prState = await deps.getPRState(owner, repo, prNumber, installationId);
    if (prState !== 'open') {
      res.status(400).json({ error: 'This PR is no longer open. Fixes cannot be applied.' });
      return;
    }

    // Fetch fixes
    const fixesResult = await deps.db.query<DocFix>(
      `SELECT vr.suggested_fix->>'file_path' AS file,
              (vr.suggested_fix->>'line_start')::int AS line_start,
              (vr.suggested_fix->>'line_end')::int AS line_end,
              vr.suggested_fix->>'old_text' AS old_text,
              vr.suggested_fix->>'new_text' AS new_text,
              COALESCE(vr.reasoning, 'Documentation drift detected') AS reason,
              vr.claim_id,
              vr.confidence
       FROM verification_results vr
       WHERE vr.scan_run_id = $1
         AND vr.repo_id = $2
         AND vr.verdict = 'drifted'
         AND vr.suggested_fix IS NOT NULL
         AND vr.suggested_fix->>'new_text' IS NOT NULL`,
      [scanRunId, repoId],
    );

    const fixes = fixesResult.rows;
    if (fixes.length === 0) {
      res.status(400).json({ error: 'No applicable fixes found' });
      return;
    }

    // Get PR branch
    const branch = await deps.getPRBranch(owner, repo, prNumber, installationId);

    // Apply fixes in-memory
    const { result, modifiedFiles } = await applyFixes(
      fixes,
      (filePath) => deps.getFileContent(owner, repo, filePath, branch, installationId),
    );

    // Empty commit prevention: if all fixes failed, no commit
    if (result.applied.length === 0) {
      const failedSummary = result.failed
        .map((f) => `- \`${f.file}\` line ${f.line_start}: ${f.reason}`)
        .join('\n');

      try {
        await deps.postComment(
          owner,
          repo,
          prNumber,
          `### DocAlign: Could not apply fixes\n\nAll ${result.failed.length} fix(es) failed:\n${failedSummary}`,
          installationId,
        );
      } catch (err) {
        logger.warn({ err, owner, repo, prNumber }, 'Failed to post fix failure comment');
      }

      res.status(200).json({
        status: 'no_fixes_applied',
        applied: 0,
        failed: result.failed.length,
        details: result.failed,
      });
      return;
    }

    // Create commit via Git Trees API
    const githubClient = await deps.getGitHubClient(installationId);
    const commitMessage = `docs: fix ${result.applied.length} documentation drift${result.applied.length !== 1 ? 's' : ''}\n\nApplied by DocAlign`;
    const commitResult = await createFixCommit(
      githubClient,
      owner,
      repo,
      branch,
      modifiedFiles,
      commitMessage,
    );

    if ('error' in commitResult) {
      res.status(422).json({
        error: 'Branch has been updated since this page was loaded. Please retry.',
      });
      return;
    }

    // Post comment
    const shortSha = commitResult.sha.slice(0, 7);
    let commentBody: string;

    if (result.failed.length === 0) {
      // Full success
      commentBody = `### DocAlign: Applied ${result.applied.length} fix${result.applied.length !== 1 ? 'es' : ''} in commit ${shortSha}\n\n` +
        result.applied.map((a) => `- \`${a.file}\` line ${a.line_start}`).join('\n');
    } else {
      // Partial success
      const appliedList = result.applied.map((a) => `- ✅ \`${a.file}\` line ${a.line_start}`).join('\n');
      const failedList = result.failed.map((f) => `- ❌ \`${f.file}\` line ${f.line_start}: ${f.reason}`).join('\n');
      commentBody = `### DocAlign: Partially applied fixes in commit ${shortSha}\n\n**Applied (${result.applied.length}):**\n${appliedList}\n\n**Failed (${result.failed.length}):**\n${failedList}`;
    }

    try {
      await deps.postComment(owner, repo, prNumber, commentBody, installationId);
    } catch (err) {
      logger.warn({ err, owner, repo, prNumber }, 'Failed to post fix comment');
    }

    res.status(200).json({
      status: result.failed.length === 0 ? 'all_applied' : 'partial',
      commit_sha: commitResult.sha,
      applied: result.applied.length,
      failed: result.failed.length,
    });
  });

  return router;
}
