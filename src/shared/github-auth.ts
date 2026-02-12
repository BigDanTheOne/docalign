import jwt from 'jsonwebtoken';
import { DocAlignError } from './types';
import logger from './logger';

interface CachedInstallationToken {
  token: string;
  expiresAt: Date;
  installationId: number;
}

interface GitHubAuthConfig {
  appId: string;
  privateKey: string;
}

// Token exchange function type (injectable for testing)
type TokenExchangeFn = (
  jwtToken: string,
  installationId: number,
) => Promise<{ token: string; expires_at: string }>;

export class GitHubAppAuth {
  private cache = new Map<number, CachedInstallationToken>();
  private config: GitHubAuthConfig;
  private exchangeToken: TokenExchangeFn;

  constructor(config: GitHubAuthConfig, exchangeToken?: TokenExchangeFn) {
    this.config = config;
    this.exchangeToken = exchangeToken ?? defaultTokenExchange;
  }

  /**
   * Generate a JWT for GitHub App authentication (RS256).
   */
  generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);

    try {
      return jwt.sign(
        {
          iat: now - 60, // issued 60s ago (clock drift)
          exp: now + 10 * 60, // expires in 10 minutes
          iss: this.config.appId,
        },
        this.config.privateKey,
        { algorithm: 'RS256' },
      );
    } catch (err) {
      throw new DocAlignError({
        code: 'DOCALIGN_E103',
        severity: 'critical',
        message: 'Failed to generate GitHub App JWT',
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /**
   * Get an installation access token, using cache when available.
   * Cache hit returns same token if >5min from expiry.
   * Cache miss or near-expiry triggers fresh exchange.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    // 1. Check cache
    const cached = this.cache.get(installationId);
    if (cached) {
      const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
      if (cached.expiresAt > fiveMinFromNow) {
        return cached.token;
      }
    }

    // 2. Generate JWT and exchange for installation token
    const jwtToken = this.generateJWT();

    try {
      const response = await this.exchangeToken(jwtToken, installationId);

      // 3. Cache the token
      const entry: CachedInstallationToken = {
        token: response.token,
        expiresAt: new Date(response.expires_at),
        installationId,
      };
      this.cache.set(installationId, entry);

      logger.info({ installationId }, 'Installation token fetched and cached');
      return response.token;
    } catch (err) {
      // Retry once on 401 (private key may have been refreshed)
      if (err instanceof Error && err.message.includes('401')) {
        this.cache.delete(installationId);
        try {
          const freshJwt = this.generateJWT();
          const response = await this.exchangeToken(freshJwt, installationId);
          const entry: CachedInstallationToken = {
            token: response.token,
            expiresAt: new Date(response.expires_at),
            installationId,
          };
          this.cache.set(installationId, entry);
          return response.token;
        } catch (retryErr) {
          throw new DocAlignError({
            code: 'DOCALIGN_E103',
            severity: 'critical',
            message: 'Failed to exchange JWT for installation token after retry',
            cause: retryErr instanceof Error ? retryErr : undefined,
          });
        }
      }

      throw new DocAlignError({
        code: 'DOCALIGN_E101',
        severity: 'high',
        message: 'Failed to fetch installation token from GitHub',
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /**
   * Clear cache entry for an installation (useful on auth errors).
   */
  clearCache(installationId: number): void {
    this.cache.delete(installationId);
  }

  /**
   * Get cache size (for testing).
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Default token exchange using fetch (GitHub REST API).
 */
async function defaultTokenExchange(
  jwtToken: string,
  installationId: number,
): Promise<{ token: string; expires_at: string }> {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  }

  return response.json();
}
