import type { PRWebhookPayload } from '../../shared/types';
import logger from '../../shared/logger';

/**
 * Stub handler for pull_request events.
 * Will be implemented in E4 (L4 triggers).
 */
export async function handlePRWebhook(
  payload: PRWebhookPayload,
  deliveryId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  logger.info(
    { deliveryId, action: payload.action, pr: payload.number },
    'PR webhook received (stub)',
  );
  return { status: 200, body: { received: true } };
}
