import type { PRWebhookPayload } from '../../shared/types';
import type { StorageAdapter } from '../../shared/storage-adapter';
import type { TriggerService } from './trigger-service';
import logger from '../../shared/logger';

interface PRWebhookDeps {
  storage?: StorageAdapter;
  triggerService?: TriggerService;
}

/**
 * Handler for pull_request.opened and pull_request.synchronize events.
 * E4-01: Looks up repo, enqueues PR scan via TriggerService.
 */
export async function handlePRWebhook(
  payload: PRWebhookPayload,
  deliveryId: string,
  deps?: PRWebhookDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  logger.info(
    { deliveryId, action: payload.action, pr: payload.number },
    'PR webhook received',
  );

  // If trigger service is available, enqueue the scan
  if (deps?.storage && deps?.triggerService) {
    const owner = payload.repository.owner?.login;
    const repoName = payload.repository.name;
    const headSha = payload.pull_request.head.sha;
    const prNumber = payload.number;
    const installationId = payload.installation.id;

    if (!owner || !repoName) {
      logger.warn({ deliveryId }, 'PR webhook missing repository owner or name');
      return { status: 200, body: { received: true } };
    }

    const repo = await deps.storage.getRepoByOwnerAndName(owner, repoName);
    if (!repo) {
      logger.warn({ deliveryId, owner, repoName }, 'Repo not found for PR webhook');
      return { status: 200, body: { received: true, scan_enqueued: false } };
    }

    try {
      const scanRunId = await deps.triggerService.enqueuePRScan(
        repo.id, prNumber, headSha, installationId, deliveryId,
      );
      return { status: 200, body: { received: true, scan_enqueued: true, scan_run_id: scanRunId } };
    } catch (err) {
      logger.error({ err, deliveryId }, 'Failed to enqueue PR scan');
      return { status: 200, body: { received: true, scan_enqueued: false } };
    }
  }

  // No trigger service configured — acknowledge only
  return { status: 200, body: { received: true } };
}
