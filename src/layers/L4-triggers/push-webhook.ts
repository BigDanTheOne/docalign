import type { PushWebhookPayload } from '../../shared/types';
import logger from '../../shared/logger';

/**
 * Stub handler for push events.
 * Will be implemented in E4 (L4 triggers).
 */
export async function handlePushWebhook(
  payload: PushWebhookPayload,
  deliveryId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  logger.info(
    { deliveryId, ref: payload.ref },
    'Push webhook received (stub)',
  );
  return { status: 200, body: { received: true } };
}
