/**
 * LocalPipeline — Concrete CliPipeline wiring L0-L3 layers.
 * Runs entirely in-memory against the local filesystem.
 * No database required.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  Claim,
  VerificationResult,
} from '../shared/types';
import type { CliPipeline, CheckResult, ScanResult, ScanFileResult, DocFix } from './local-pipeline';
import { InMemoryIndex } from './local-index';

// L1: Claim extraction (pure functions)
import { discoverDocFiles } from '../layers/L1-claim-extractor/syntactic';
import { preProcess, detectFormat, isBinaryContent } from '../layers/L1-claim-extractor/preprocessing';
import {
  extractPaths,
  extractApiRoutes,
  extractCommands,
  extractDependencyVersions,
  extractCodeExamples,
  deduplicateWithinFile,
  isValidPath,
} from '../layers/L1-claim-extractor/extractors';
import { rawToClaim } from '../layers/L1-claim-extractor/claim-store';

// L3: Verification (exported tier functions)
import { verifyPathReference } from '../layers/L3-verifier/tier1-path-reference';
import { verifyApiRoute } from '../layers/L3-verifier/tier1-api-route';
import { verifyDependencyVersion } from '../layers/L3-verifier/tier1-dependency-version';
import { verifyCommand } from '../layers/L3-verifier/tier1-command';
import { verifyCodeExample } from '../layers/L3-verifier/tier1-code-example';
import { verifyTier2 } from '../layers/L3-verifier/tier2-patterns';

const MAX_FILE_SIZE = 100 * 1024; // 100KB

export class LocalPipeline implements CliPipeline {
  private index: InMemoryIndex;
  private initialized = false;
  private knownPackages = new Set<string>();
  private fixCache: DocFix[] = [];

  constructor(private repoRoot: string) {
    this.index = new InMemoryIndex(repoRoot);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.index.build();
    this.knownPackages = this.index.getKnownPackages();
    this.initialized = true;
  }

  async checkFile(filePath: string, _verbose?: boolean): Promise<CheckResult> {
    const startTime = Date.now();
    await this.ensureInitialized();

    const absPath = path.resolve(this.repoRoot, filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const claims = this.extractClaimsInMemory(filePath, content);
    const results: VerificationResult[] = [];

    for (const claim of claims) {
      const result = await this.verifyClaim(claim);
      if (result) results.push(result);
    }

    const durationMs = Date.now() - startTime;
    return { claims, results, fixes: [], durationMs };
  }

  async scanRepo(onProgress?: (current: number, total: number) => void, exclude?: string[]): Promise<ScanResult> {
    const startTime = Date.now();
    await this.ensureInitialized();

    const fileTree = await this.index.getFileTree('local');
    let docFiles = discoverDocFiles(fileTree);

    // Apply user-specified exclusions
    if (exclude && exclude.length > 0) {
      docFiles = docFiles.filter((f) =>
        !exclude.some((pattern) => f === pattern || f.endsWith('/' + pattern)),
      );
    }

    const files: ScanFileResult[] = [];
    let totalClaims = 0;
    let totalVerified = 0;
    let totalDrifted = 0;
    let totalUncertain = 0;

    for (let i = 0; i < docFiles.length; i++) {
      const docFile = docFiles[i];
      if (onProgress) onProgress(i + 1, docFiles.length);

      const absPath = path.join(this.repoRoot, docFile);
      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue; // Skip unreadable files
      }

      const claims = this.extractClaimsInMemory(docFile, content);
      const results: VerificationResult[] = [];

      for (const claim of claims) {
        const result = await this.verifyClaim(claim);
        if (result) results.push(result);
      }

      totalClaims += claims.length;
      for (const r of results) {
        if (r.verdict === 'verified') totalVerified++;
        else if (r.verdict === 'drifted') totalDrifted++;
        else totalUncertain++;
      }

      files.push({ file: docFile, claims, results, fixes: [] });
    }

    const durationMs = Date.now() - startTime;
    return { files, totalClaims, totalVerified, totalDrifted, totalUncertain, durationMs };
  }

  async getStoredFixes(targetFile?: string): Promise<DocFix[]> {
    if (targetFile) {
      return this.fixCache.filter((f) => f.file === targetFile);
    }
    return this.fixCache;
  }

  async markFixesApplied(_fixIds: string[]): Promise<void> {
    // No-op for local CLI
  }

  // === Private helpers ===

  /**
   * Extract claims from a doc file using L1 pure functions.
   * Replicates extractSyntactic pipeline without ClaimStore.
   */
  private extractClaimsInMemory(docFile: string, content: string): Claim[] {
    if (isBinaryContent(content)) return [];
    if (content.length > MAX_FILE_SIZE || content.length === 0) return [];

    const format = detectFormat(docFile);
    if (format === 'rst') return [];

    const preprocessed = preProcess(content, format);

    const rawExtractions = [
      ...extractPaths(preprocessed, docFile),
      ...extractCommands(preprocessed),
      ...extractDependencyVersions(preprocessed, this.knownPackages),
      ...extractApiRoutes(preprocessed),
      ...extractCodeExamples(preprocessed),
    ];

    const filtered = rawExtractions.filter((e) => {
      if (e.claim_type !== 'path_reference') return true;
      return isValidPath(e.extracted_value.path as string);
    });

    const deduped = deduplicateWithinFile(filtered);

    // Convert to Claim objects (no database)
    return deduped.map((extraction) => {
      const insert = rawToClaim('local', docFile, extraction);
      return {
        ...insert,
        id: randomUUID(),
        verification_status: 'pending',
        last_verified_at: null,
        embedding: null,
        last_verification_result_id: null,
        parent_claim_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });
  }

  /**
   * Verify a claim using L3 tier1/tier2 functions.
   * Replicates verifyDeterministic without the VerifierService.
   */
  private async verifyClaim(claim: Claim): Promise<VerificationResult | null> {
    const startTime = Date.now();

    // TIER 1: Syntactic verification
    if (claim.testability === 'syntactic') {
      let result: VerificationResult | null = null;

      switch (claim.claim_type) {
        case 'path_reference':
          result = await verifyPathReference(claim, this.index);
          break;
        case 'command':
          result = await verifyCommand(claim, this.index);
          break;
        case 'dependency_version':
          result = await verifyDependencyVersion(claim, this.index);
          break;
        case 'api_route':
          result = await verifyApiRoute(claim, this.index);
          break;
        case 'code_example':
          result = await verifyCodeExample(claim, this.index);
          break;
      }

      if (result) {
        result.duration_ms = Date.now() - startTime;
        result.tier = 1;
        result.confidence = 1.0;
        result.token_cost = null;
        result.verification_path = null;
        result.post_check_result = null;
        return result;
      }
    }

    // TIER 2: Pattern verification
    if (claim.claim_type === 'convention' || claim.claim_type === 'environment') {
      const result = await verifyTier2(claim, this.index);
      if (result) {
        result.duration_ms = Date.now() - startTime;
        result.tier = 2;
        result.token_cost = null;
        result.verification_path = null;
        result.post_check_result = null;
        return result;
      }
    }

    // Claims that can't be verified deterministically are skipped in CLI
    return null;
  }
}
