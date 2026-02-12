import crypto from 'crypto';

/**
 * Generate an HMAC fix token for a fix-apply link.
 * GATE42-019, GATE42-024.
 *
 * Token format: `{timestamp}.{hmac_hex}`
 * HMAC payload: `fix:${repoId}:${prNumber}:${scanRunId}:${timestamp}`
 */
export function generateFixToken(
  apiSecret: string,
  repoId: string,
  prNumber: number,
  scanRunId: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `fix:${repoId}:${prNumber}:${scanRunId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', apiSecret).update(data).digest('hex');
  return `${timestamp}.${hmac}`;
}

/**
 * Validate an HMAC fix token. Returns true if valid and not expired (7 days).
 * GATE42-025.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateFixToken(
  token: string,
  apiSecret: string,
  repoId: string,
  prNumber: number,
  scanRunId: string,
): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [timestampStr, receivedHmac] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check expiry (7 days)
  const now = Math.floor(Date.now() / 1000);
  const sevenDays = 7 * 24 * 60 * 60;
  if (now - timestamp > sevenDays) return false;

  // Recompute HMAC
  const data = `fix:${repoId}:${prNumber}:${scanRunId}:${timestamp}`;
  const expected = crypto.createHmac('sha256', apiSecret).update(data).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(expected));
  } catch {
    return false;
  }
}
