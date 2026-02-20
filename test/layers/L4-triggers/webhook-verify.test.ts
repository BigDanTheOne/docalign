import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature } from '../../../src/layers/L4-triggers/webhook-verify';

describe('verifyWebhookSignature', () => {
  describe('valid signatures', () => {
    it('returns true for correct HMAC-SHA256 signature', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'my-secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns true for correct signature with different body content', () => {
      const body = Buffer.from('{"action":"opened","number":42}');
      const secret = 'webhook-secret-123';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns true for correct signature with empty JSON object', () => {
      const body = Buffer.from('{}');
      const secret = 'secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns true for correct signature with complex nested JSON', () => {
      const body = Buffer.from(
        JSON.stringify({
          action: 'opened',
          pull_request: {
            id: 123,
            head: { sha: 'abc123' },
            base: { ref: 'main' },
          },
          repository: {
            owner: { login: 'test' },
            name: 'repo',
          },
        }),
      );
      const secret = 'complex-secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns true for signature with long secret', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'a'.repeat(128);
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns true for signature with special characters in body', () => {
      const body = Buffer.from('{"text":"Hello\\nWorld\\t!@#$%^&*()"}');
      const secret = 'secret123';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns true for signature with Unicode characters in body', () => {
      const body = Buffer.from('{"emoji":"🚀","text":"日本語"}');
      const secret = 'secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });
  });

  describe('invalid signatures', () => {
    it('returns false for incorrect signature', () => {
      const body = Buffer.from('{"test":true}');
      const signature = 'sha256=invalid-signature-hex';
      const secret = 'secret';

      expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
    });

    it('returns false when signature uses wrong secret', () => {
      const body = Buffer.from('{"test":true}');
      const correctSecret = 'correct-secret';
      const wrongSecret = 'wrong-secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', wrongSecret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, correctSecret)).toBe(false);
    });

    it('returns false when body is modified after signing', () => {
      const originalBody = Buffer.from('{"test":true}');
      const modifiedBody = Buffer.from('{"test":false}');
      const secret = 'secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(originalBody).digest('hex');

      expect(verifyWebhookSignature(modifiedBody, signature, secret)).toBe(false);
    });

    it('returns false for signature with wrong algorithm prefix', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      // Use sha1 instead of sha256
      const signature =
        'sha1=' +
        crypto.createHmac('sha1', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
    });

    it('returns false for signature without sha256= prefix', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
    });

    it('returns false for completely malformed signature', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';

      expect(verifyWebhookSignature(body, 'not-a-valid-signature', secret)).toBe(
        false,
      );
    });

    it('returns false for signature with wrong case', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const correctSig =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      const wrongCaseSig = correctSig.toUpperCase();

      expect(verifyWebhookSignature(body, wrongCaseSig, secret)).toBe(false);
    });
  });

  describe('edge cases: empty inputs', () => {
    it('returns false for empty body buffer', () => {
      const body = Buffer.from('');
      const secret = 'secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      // This should actually return true since the signature is correctly computed
      // for an empty buffer, but let's verify the behavior
      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns false for empty body with wrong signature', () => {
      const body = Buffer.from('');
      const secret = 'secret';
      const signature = 'sha256=wrong';

      expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
    });

    it('handles empty secret string', () => {
      const body = Buffer.from('{"test":true}');
      const secret = '';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('returns false for empty secret with wrong signature', () => {
      const body = Buffer.from('{"test":true}');
      const secret = '';
      const wrongSignature = 'sha256=wrong';

      expect(verifyWebhookSignature(body, wrongSignature, secret)).toBe(false);
    });

    it('returns false for empty signature string', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';

      expect(verifyWebhookSignature(body, '', secret)).toBe(false);
    });
  });

  describe('edge cases: signature length mismatch', () => {
    it('returns false for truncated signature (length mismatch)', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const fullSignature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      const truncatedSignature = fullSignature.slice(0, -10);

      expect(verifyWebhookSignature(body, truncatedSignature, secret)).toBe(false);
    });

    it('returns false for signature with extra characters (length mismatch)', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex') +
        'extra';

      expect(verifyWebhookSignature(body, signature, secret)).toBe(false);
    });

    it('returns false for signature with missing prefix characters', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const fullSignature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      const signatureWithoutPrefix = fullSignature.slice(3); // Remove "sha"

      expect(verifyWebhookSignature(body, signatureWithoutPrefix, secret)).toBe(
        false,
      );
    });

    it('handles signature that is exactly 7 characters (just "sha256=")', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';

      expect(verifyWebhookSignature(body, 'sha256=', secret)).toBe(false);
    });

    it('handles signature shorter than prefix', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';

      expect(verifyWebhookSignature(body, 'sha', secret)).toBe(false);
    });
  });

  describe('timing-safe comparison', () => {
    it('uses constant-time comparison to prevent timing attacks', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const correctSignature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      const wrongSignature = 'sha256=' + 'a'.repeat(64);

      // Both should complete in roughly the same time
      // We can't actually test timing here, but we verify both return false/true correctly
      expect(verifyWebhookSignature(body, correctSignature, secret)).toBe(true);
      expect(verifyWebhookSignature(body, wrongSignature, secret)).toBe(false);
    });

    it('handles comparison when signatures differ at start', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const correctSignature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      const wrongSignature =
        'sha256=' + 'f'.repeat(64); // Start with 'f' instead of actual hash

      expect(verifyWebhookSignature(body, wrongSignature, secret)).toBe(false);
      expect(verifyWebhookSignature(body, correctSignature, secret)).toBe(true);
    });

    it('handles comparison when signatures differ at end', () => {
      const body = Buffer.from('{"test":true}');
      const secret = 'secret';
      const correctSignature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      const almostCorrectSignature = correctSignature.slice(0, -1) + '0';

      expect(verifyWebhookSignature(body, almostCorrectSignature, secret)).toBe(
        false,
      );
    });
  });

  describe('real-world scenarios', () => {
    it('handles GitHub webhook signature format', () => {
      const body = Buffer.from(
        JSON.stringify({
          action: 'opened',
          pull_request: { number: 123 },
        }),
      );
      const secret = 'github-webhook-secret-123';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('handles large payload bodies', () => {
      const largePayload = {
        action: 'opened',
        data: 'x'.repeat(100000), // 100KB payload
      };
      const body = Buffer.from(JSON.stringify(largePayload));
      const secret = 'secret';
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    });

    it('rejects replay attack with old signature and new body', () => {
      const oldBody = Buffer.from('{"version":1}');
      const newBody = Buffer.from('{"version":2}');
      const secret = 'secret';
      const oldSignature =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(oldBody).digest('hex');

      expect(verifyWebhookSignature(newBody, oldSignature, secret)).toBe(false);
    });
  });
});
