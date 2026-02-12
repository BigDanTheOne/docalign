import { Router } from 'express';
import express from 'express';
import { verifyWebhookSignature } from '../layers/L4-triggers/webhook-verify';
import { handlePRWebhook } from '../layers/L4-triggers/pr-webhook';
import { handlePushWebhook } from '../layers/L4-triggers/push-webhook';
import type { StorageAdapter } from '../shared/storage-adapter';
import type {
  PRWebhookPayload,
  PushWebhookPayload,
  InstallationCreatedPayload,
} from '../shared/types';
import logger from '../shared/logger';

export interface WebhookRouteDeps {
  webhookSecret: string;
  webhookSecretOld?: string;
  storage: StorageAdapter;
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
        return handlePRWebhook(prPayload, deliveryId);
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

    case 'issue_comment': {
      return handleIssueCommentEvent(payload, deliveryId);
    }

    default:
      logger.debug({ eventType, deliveryId }, 'webhook_ignored');
      return { status: 200, body: { received: true } };
  }
}

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
      await deps.storage.createRepo({
        github_owner: owner,
        github_repo: repoName,
        github_installation_id: installationId,
        status: 'onboarding',
      });
    }

    return { status: 200, body: { received: true } };
  }

  if (action === 'deleted') {
    const installationId = (payload as { installation: { id: number } }).installation.id;
    logger.info({ deliveryId, installationId }, 'Installation deleted');
    // In the future: delete repo records by installation_id
    // For now, acknowledge
    return { status: 200, body: { received: true } };
  }

  return { status: 200, body: { received: true } };
}

function handleIssueCommentEvent(
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const action = payload.action as string;
  const comment = payload.comment as { body?: string } | undefined;
  const body = comment?.body ?? '';

  if (action === 'created' && body.includes('@docalign review')) {
    logger.info({ deliveryId }, '@docalign review comment detected');
  }

  return Promise.resolve({ status: 200, body: { received: true } });
}
