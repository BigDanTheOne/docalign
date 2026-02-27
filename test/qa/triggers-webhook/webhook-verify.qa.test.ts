import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature } from '../../../src/layers/L4-triggers/webhook-verify';

const SECRET = 'test-secret-key';

function sign(body: string, secret: string = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    const body = '{"action":"opened"}';
    const sig = sign(body);
    expect(verifyWebhookSignature(Buffer.from(body), sig, SECRET)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    const body = '{"action":"opened"}';
    expect(verifyWebhookSignature(Buffer.from(body), 'sha256=invalid', SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{"action":"opened"}';
    const sig = sign(body, 'wrong-secret');
    expect(verifyWebhookSignature(Buffer.from(body), sig, SECRET)).toBe(false);
  });

  it('returns false for empty signature', () => {
    const body = '{"action":"opened"}';
    expect(verifyWebhookSignature(Buffer.from(body), '', SECRET)).toBe(false);
  });

  it('returns false for missing sha256= prefix', () => {
    const body = '{"action":"opened"}';
    const hash = crypto.createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex');
    expect(verifyWebhookSignature(Buffer.from(body), hash, SECRET)).toBe(false);
  });
});
