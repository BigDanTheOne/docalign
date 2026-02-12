import crypto from 'crypto';

/**
 * Verify GitHub webhook HMAC-SHA256 signature using timing-safe comparison.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // timingSafeEqual throws if lengths differ
    return false;
  }
}
