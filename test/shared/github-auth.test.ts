import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { GitHubAppAuth } from '../../src/shared/github-auth';
import { DocAlignError } from '../../src/shared/types';

// Generate a test RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const TEST_APP_ID = '12345';

function createAuth(
  exchangeFn?: (
    jwtToken: string,
    installationId: number,
  ) => Promise<{ token: string; expires_at: string }>,
) {
  return new GitHubAppAuth(
    { appId: TEST_APP_ID, privateKey },
    exchangeFn,
  );
}

describe('GitHubAppAuth', () => {
  describe('generateJWT', () => {
    it('generates JWT with correct iss, iat, exp, and RS256 algorithm', () => {
      const auth = createAuth();
      const token = auth.generateJWT();

      // Verify the token with the public key
      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;

      expect(decoded.iss).toBe(TEST_APP_ID);

      const now = Math.floor(Date.now() / 1000);
      // iat should be roughly now - 60
      expect(decoded.iat).toBeGreaterThanOrEqual(now - 70);
      expect(decoded.iat).toBeLessThanOrEqual(now - 50);
      // exp should be roughly now + 600
      expect(decoded.exp).toBeGreaterThanOrEqual(now + 590);
      expect(decoded.exp).toBeLessThanOrEqual(now + 610);
    });

    it('throws DOCALIGN_E103 with invalid private key', () => {
      const auth = new GitHubAppAuth(
        { appId: TEST_APP_ID, privateKey: 'invalid-key' },
      );

      expect(() => auth.generateJWT()).toThrow(DocAlignError);
      try {
        auth.generateJWT();
      } catch (err) {
        expect(err).toBeInstanceOf(DocAlignError);
        expect((err as DocAlignError).code).toBe('DOCALIGN_E103');
      }
    });
  });

  describe('getInstallationToken', () => {
    it('fetches installation token and caches it', async () => {
      let callCount = 0;
      const mockExchange = async () => {
        callCount++;
        return {
          token: 'ghs_test_token_12345',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
        };
      };

      const auth = createAuth(mockExchange);
      const token = await auth.getInstallationToken(100);

      expect(token).toBe('ghs_test_token_12345');
      expect(callCount).toBe(1);
      expect(auth.getCacheSize()).toBe(1);
    });

    it('cache hit returns same token without API call', async () => {
      let callCount = 0;
      const mockExchange = async () => {
        callCount++;
        return {
          token: 'ghs_cached_token',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        };
      };

      const auth = createAuth(mockExchange);

      // First call — cache miss
      const token1 = await auth.getInstallationToken(200);
      expect(callCount).toBe(1);

      // Second call — cache hit
      const token2 = await auth.getInstallationToken(200);
      expect(callCount).toBe(1); // No additional API call
      expect(token2).toBe(token1);
    });

    it('cache miss when token <5min from expiry triggers refresh', async () => {
      let callCount = 0;
      const mockExchange = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            token: 'ghs_expiring_soon',
            expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(), // 3 min from now
          };
        }
        return {
          token: 'ghs_fresh_token',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        };
      };

      const auth = createAuth(mockExchange);

      // First call — gets token expiring in 3 min
      const token1 = await auth.getInstallationToken(300);
      expect(token1).toBe('ghs_expiring_soon');
      expect(callCount).toBe(1);

      // Second call — token is <5min from expiry, should refresh
      const token2 = await auth.getInstallationToken(300);
      expect(token2).toBe('ghs_fresh_token');
      expect(callCount).toBe(2);
    });
  });
});
