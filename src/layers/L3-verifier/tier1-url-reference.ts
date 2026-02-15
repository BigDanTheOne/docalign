import type { Claim, VerificationResult, Severity } from '../../shared/types';
import { makeResult } from './result-helpers';

/**
 * Per-domain rate limiting state.
 * Prevents excessive requests to the same domain during a scan.
 */
const domainRequestCounts = new Map<string, number>();
const MAX_PER_DOMAIN = 5;

export function resetDomainCounts(): void {
  domainRequestCounts.clear();
}

/**
 * Tier 1: Verify url_reference claims by checking HTTP status.
 * TDD-3 GAP-1.
 */
export async function verifyUrlReference(
  claim: Claim,
  _index: unknown,
  httpClient?: typeof globalThis.fetch,
): Promise<VerificationResult | null> {
  const url = claim.extracted_value.url as string;
  if (!url) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  // Rate limiting per domain
  const count = domainRequestCounts.get(hostname) ?? 0;
  if (count >= MAX_PER_DOMAIN) {
    return makeResult(claim, {
      verdict: 'uncertain',
      evidence_files: [],
      reasoning: `Rate limit reached for domain '${hostname}'. Skipping URL check.`,
    });
  }
  domainRequestCounts.set(hostname, count + 1);

  const fetchFn = httpClient ?? globalThis.fetch;

  try {
    // Try HEAD first (lighter), fall back to GET on 405
    let response = await fetchFn(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 405) {
      response = await fetchFn(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
    }

    if (response.status >= 200 && response.status < 400) {
      return makeResult(claim, {
        verdict: 'verified',
        evidence_files: [url],
        reasoning: `URL returns HTTP ${response.status}.`,
      });
    }

    if (response.status === 404 || response.status === 410) {
      return makeResult(claim, {
        verdict: 'drifted',
        severity: 'high' as Severity,
        evidence_files: [],
        reasoning: `URL returns HTTP ${response.status}.`,
        specific_mismatch: `URL '${url}' returns ${response.status}.`,
      });
    }

    // 5xx or other errors — not our fault
    return makeResult(claim, {
      verdict: 'uncertain',
      evidence_files: [],
      reasoning: `URL returns HTTP ${response.status}. Server error, cannot determine validity.`,
    });
  } catch {
    // Network error, timeout
    return makeResult(claim, {
      verdict: 'uncertain',
      evidence_files: [],
      reasoning: `URL '${url}' could not be reached (network error or timeout).`,
    });
  }
}
