import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { verifyUrlReference, resetDomainCounts } from '../../../src/layers/L3-verifier/tier1-url-reference';
import type { Claim } from '../../../src/shared/types';
import type { CodebaseIndexService } from '../../../src/layers/L0-codebase-index';

function makeMockIndex(): CodebaseIndexService {
  return {
    fileExists: async () => false,
    getFileTree: async () => [],
    findSymbol: async () => [],
    getEntityByFile: async () => [],
    getEntityById: async () => null,
    findRoute: async () => null,
    searchRoutes: async () => [],
    getDependencyVersion: async () => null,
    scriptExists: async () => false,
    getAvailableScripts: async () => [],
    searchSemantic: async () => [],
    updateFromDiff: async () => ({ entities_added: 0, entities_updated: 0, entities_removed: 0, files_skipped: [] }),
    readFileContent: async () => null,
    getManifestMetadata: async () => null,
    getHeadings: async () => [],
  };
}

function makeClaim(url: string): Claim {
  return {
    id: randomUUID(),
    repo_id: 'repo-1',
    source_file: 'README.md',
    line_number: 1,
    claim_text: `See ${url}`,
    claim_type: 'url_reference',
    testability: 'syntactic',
    extracted_value: { url },
    keywords: [],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'pending',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('verifyUrlReference', () => {
  const index = makeMockIndex();

  beforeEach(() => {
    resetDomainCounts();
  });

  it('returns verified for 200 response', async () => {
    const mockFetch = async () => new Response('OK', { status: 200 });
    const result = await verifyUrlReference(makeClaim('https://example.com/docs'), index, mockFetch);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
  });

  it('returns drifted for 404 response', async () => {
    const mockFetch = async () => new Response('Not Found', { status: 404 });
    const result = await verifyUrlReference(makeClaim('https://example.com/missing'), index, mockFetch);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('drifted');
    expect(result!.severity).toBe('high');
  });

  it('returns uncertain for 500 response', async () => {
    const mockFetch = async () => new Response('Error', { status: 500 });
    const result = await verifyUrlReference(makeClaim('https://example.com/error'), index, mockFetch);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('uncertain');
  });

  it('returns uncertain for network error', async () => {
    const mockFetch = async () => { throw new Error('Network error'); };
    const result = await verifyUrlReference(makeClaim('https://example.com'), index, mockFetch);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('uncertain');
  });

  it('returns null when no URL in claim', async () => {
    const claim = makeClaim('');
    claim.extracted_value = {};
    const result = await verifyUrlReference(claim, index);
    expect(result).toBeNull();
  });

  it('fallback to GET on 405 Method Not Allowed', async () => {
    let callCount = 0;
    const mockFetch = async (_url: string, opts?: RequestInit) => {
      callCount++;
      if (opts?.method === 'HEAD') {
        return new Response('', { status: 405 });
      }
      return new Response('OK', { status: 200 });
    };
    const result = await verifyUrlReference(makeClaim('https://example.com/api'), index, mockFetch);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('verified');
    expect(callCount).toBe(2); // HEAD then GET
  });
});
