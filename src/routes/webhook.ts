import { Router } from 'express';
import express from 'express';
import { verifyWebhookSignature } from '../layers/L4-triggers/webhook-verify';
import { handlePRWebhook } from '../layers/L4-triggers/pr-webhook';
import { handlePushWebhook } from '../layers/L4-triggers/push-webhook';
import type { StorageAdapter } from '../shared/storage-adapter';
import type { TriggerService } from '../layers/L4-triggers/trigger-service';
import type {
  PRWebhookPayload,
  PushWebhookPayload,
  InstallationCreatedPayload,
  InstallationRepositoriesPayload,
  IssueCommentPayload,
} from '../shared/types';
import logger from '../shared/logger';

export interface WebhookRouteDeps {
  webhookSecret: string;
  webhookSecretOld?: string;
  storage: StorageAdapter;
  triggerService?: TriggerService;
  // GitHub API callbacks (injected to decouple from Octokit)
  addReaction?: (owner: string, repo: string, commentId: number, reaction: string, installationId: number) => Promise<void>;
  getPRHeadSha?: (owner: string, repo: string, prNumber: number, installationId: number) => Promise<string>;
}

export function createWebhookRoute(deps: WebhookRouteDeps): Router {
  const router = Router();

  router.post(
    '/',
    express.raw({ type: 'application/json', limit: '25mb' }),
    async (req, res) => {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const eventType = req.headers['x-github-event'] as string | undefined;
      const deliveryId = req.headers['x-github-delivery'] as string | undefined;
      const contentType = req.headers['content-type'];

      // 1. Validate required headers
      if (!signature || !eventType || !deliveryId) {
        logger.warn({ deliveryId }, 'webhook_missing_headers');
        res.status(401).json({});
        return;
      }

      if (contentType !== 'application/json') {
        res.status(415).json({ error: 'Unsupported content type' });
        return;
      }

      // 2. Verify signature (try current, fall back to old)
      const rawBody = req.body as Buffer;

      let valid = verifyWebhookSignature(rawBody, signature, deps.webhookSecret);
      if (!valid && deps.webhookSecretOld) {
        valid = verifyWebhookSignature(rawBody, signature, deps.webhookSecretOld);
      }

      if (!valid) {
        logger.error(
          { deliveryId, code: 'DOCALIGN_E105', remoteIp: req.headers['x-forwarded-for'] },
          'Invalid webhook signature',
        );
        res.status(401).json({});
        return;
      }

      // 3. Parse payload
      const payload = JSON.parse(rawBody.toString('utf-8'));

      // 4. Route by event type
      try {
        const result = await routeEvent(eventType, payload, deliveryId, deps);
        res.status(result.status).json(result.body);
      } catch (err) {
        logger.error({ err, deliveryId, eventType }, 'Webhook handler error');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  return router;
}

async function routeEvent(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
  deps: WebhookRouteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  switch (eventType) {
    case 'pull_request': {
      const prPayload = payload as unknown as PRWebhookPayload;
      if (prPayload.action === 'opened' || prPayload.action === 'synchronize') {
        return handlePRWebhook(prPayload, deliveryId, deps);
      }
      // pull_request.closed — acknowledge, no scan
      return { status: 200, body: { received: true } };
    }

    case 'push': {
      const pushPayload = payload as unknown as PushWebhookPayload;
      const defaultBranch = pushPayload.repository.default_branch;
      const pushedRef = `refs/heads/${defaultBranch}`;
      if (pushPayload.ref !== pushedRef) {
        // Non-default branch push — no scan
        return { status: 200, body: { received: true } };
      }
      return handlePushWebhook(pushPayload, deliveryId);
    }

    case 'installation': {
      return handleInstallationEvent(payload, deliveryId, deps);
    }

    case 'installation_repositories': {
      return handleInstallationRepositoriesEvent(payload, deliveryId, deps);
    }

    case 'issue_comment': {
      return handleIssueCommentEvent(payload, deliveryId, deps);
    }

    default:
      logger.debug({ eventType, deliveryId }, 'webhook_ignored');
      return { status: 200, body: { received: true } };
  }
}

/**
 * Handle installation.created and installation.deleted events.
 * E4-11: Creates repo records and enqueues full scans for onboarding.
 */
async function handleInstallationEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
  deps: WebhookRouteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const action = payload.action as string;

  if (action === 'created') {
    const installPayload = payload as unknown as InstallationCreatedPayload;
    const installationId = installPayload.installation.id;
    const owner = installPayload.installation.account.login;

    logger.info(
      { deliveryId, installationId, repoCount: installPayload.repositories.length },
      'Installation created',
    );

    for (const repo of installPayload.repositories) {
      const [, repoName] = repo.full_name.split('/');
      const repoRow = await deps.storage.createRepo({
        github_owner: owner,
        github_repo: repoName,
        github_installation_id: installationId,
        status: 'onboarding',
      });

      // Enqueue full scan for onboarding
      if (deps.triggerService) {
        try {
          await deps.triggerService.enqueueFullScan(repoRow.id, installationId);
          logger.info({ deliveryId, repoId: repoRow.id }, 'Onboarding full scan enqueued');
        } catch (err) {
          logger.error({ err, deliveryId, repoId: repoRow.id }, 'Failed to enqueue onboarding scan');
        }
      }
    }

    return { status: 200, body: { received: true } };
  }

  if (action === 'deleted') {
    const installationId = (payload as { installation: { id: number } }).installation.id;
    logger.info({ deliveryId, installationId }, 'Installation deleted');
    // Mark repos as suspended (future: deactivate by installation_id)
    return { status: 200, body: { received: true } };
  }

  return { status: 200, body: { received: true } };
}

/**
 * Handle installation_repositories.added and installation_repositories.removed events.
 * E4-11: Handles repos added/removed after initial installation.
 */
async function handleInstallationRepositoriesEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
  deps: WebhookRouteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const reposPayload = payload as unknown as InstallationRepositoriesPayload;
  const installationId = reposPayload.installation.id;
  const owner = reposPayload.installation.account.login;

  if (reposPayload.action === 'added' && reposPayload.repositories_added) {
    logger.info(
      { deliveryId, installationId, count: reposPayload.repositories_added.length },
      'Repositories added to installation',
    );

    for (const repo of reposPayload.repositories_added) {
      const [, repoName] = repo.full_name.split('/');
      const repoRow = await deps.storage.createRepo({
        github_owner: owner,
        github_repo: repoName,
        github_installation_id: installationId,
        status: 'onboarding',
      });

      if (deps.triggerService) {
        try {
          await deps.triggerService.enqueueFullScan(repoRow.id, installationId);
        } catch (err) {
          logger.error({ err, deliveryId, repoId: repoRow.id }, 'Failed to enqueue scan for added repo');
        }
      }
    }
  }

  if (reposPayload.action === 'removed' && reposPayload.repositories_removed) {
    logger.info(
      { deliveryId, installationId, count: reposPayload.repositories_removed.length },
      'Repositories removed from installation',
    );
    // Future: mark repos as suspended/deleted
  }

  return { status: 200, body: { received: true } };
}

/**
 * Handle issue_comment.created events for @docalign review command.
 * E4-01: Detects the command, adds :eyes: reaction, enqueues PR scan.
 */
async function handleIssueCommentEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
  deps: WebhookRouteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const commentPayload = payload as unknown as IssueCommentPayload;

  // Only process created comments
  if (commentPayload.action !== 'created') {
    return { status: 200, body: { received: true } };
  }

  const body = commentPayload.comment?.body ?? '';

  // Check for @docalign review command (flexible whitespace, case-insensitive)
  const reviewRegex = /(?<!\w)@docalign\s+review\b/i;
  if (!reviewRegex.test(body)) {
    return { status: 200, body: { received: true } };
  }

  // Must be a PR comment (not a regular issue)
  if (!commentPayload.issue.pull_request) {
    logger.info({ deliveryId }, '@docalign review on non-PR issue, ignoring');
    return { status: 200, body: { received: true, scan_enqueued: false } };
  }

  const owner = commentPayload.repository.owner.login;
  const repoName = commentPayload.repository.name;
  const prNumber = commentPayload.issue.number;
  const installationId = commentPayload.installation.id;
  const commentId = commentPayload.comment.id;

  logger.info({ deliveryId, owner, repoName, prNumber }, '@docalign review detected');

  // Add :eyes: reaction (best-effort, don't fail the webhook)
  if (deps.addReaction) {
    try {
      await deps.addReaction(owner, repoName, commentId, 'eyes', installationId);
    } catch (err) {
      logger.warn({ err, deliveryId }, 'Failed to add :eyes: reaction');
    }
  }

  // Look up repo in our DB
  const repo = await deps.storage.getRepoByOwnerAndName(owner, repoName);
  if (!repo) {
    logger.warn({ deliveryId, owner, repoName }, 'Repo not found for @docalign review');
    return { status: 200, body: { received: true, scan_enqueued: false } };
  }

  // Need trigger service and head SHA to enqueue
  if (!deps.getPRHeadSha || !deps.triggerService) {
    logger.warn({ deliveryId }, '@docalign review: missing triggerService or getPRHeadSha deps');
    return { status: 200, body: { received: true, scan_enqueued: false } };
  }

  try {
    const headSha = await deps.getPRHeadSha(owner, repoName, prNumber, installationId);
    const scanRunId = await deps.triggerService.enqueuePRScan(
      repo.id, prNumber, headSha, installationId, deliveryId,
    );
    logger.info({ deliveryId, scanRunId, prNumber }, '@docalign review scan enqueued');
    return { status: 200, body: { received: true, scan_enqueued: true, scan_run_id: scanRunId } };
  } catch (err) {
    logger.error({ err, deliveryId }, 'Failed to enqueue scan from @docalign review');
    return { status: 200, body: { received: true, scan_enqueued: false } };
  }
}
