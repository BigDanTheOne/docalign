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
import type { CliPipeline, CheckResult, ScanResult, ScanFileResult, DocFix, SectionInfo } from './local-pipeline';
import { InMemoryIndex } from './local-index';
import { findSection, listHeadings } from './local-pipeline';

// L1: Claim extraction (pure functions)
import { discoverDocFiles } from '../layers/L1-claim-extractor/syntactic';
import { preProcess, detectFormat, isBinaryContent } from '../layers/L1-claim-extractor/preprocessing';
import {
  extractPaths,
  extractApiRoutes,
  extractCommands,
  extractDependencyVersions,
  extractCodeExamples,
  extractEnvironmentClaims,
  extractConventionClaims,
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

// LLM: Tier 3 verification + fix generation
import type { LLMClient } from './llm-client';
import { createAnthropicClient, getLLMApiKey, llmCallWithRetry } from './llm-client';
import { buildEvidence } from './evidence-builder';
import { buildVerifyPrompt } from './prompts/verify';
import { buildFixPrompt } from './prompts/fix';
import { PVerifyOutputSchema } from './prompts/schemas';
import { PFixOutputSchema } from './prompts/schemas';

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const DEFAULT_VERIFY_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_FIX_MODEL = 'claude-sonnet-4-5-20250929';

export class LocalPipeline implements CliPipeline {
  private index: InMemoryIndex;
  private initialized = false;
  private knownPackages = new Set<string>();
  private fixCache: DocFix[] = [];
  private llmClient: LLMClient | null = null;

  constructor(private repoRoot: string, llmApiKey?: string) {
    this.index = new InMemoryIndex(repoRoot);
    const apiKey = llmApiKey ?? getLLMApiKey();
    if (apiKey) {
      this.llmClient = createAnthropicClient(apiKey);
    }
  }

  /** Whether LLM-based verification (Tier 3) is available. */
  get hasLLM(): boolean {
    return this.llmClient !== null;
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

    // Generate fixes for drifted claims (LLM)
    const fixes: DocFix[] = [];
    if (this.llmClient) {
      for (const result of results) {
        if (result.verdict === 'drifted') {
          const claim = claims.find((c) => c.id === result.claim_id);
          if (claim) {
            const fix = await this.generateFix(claim, result);
            if (fix) fixes.push(fix);
          }
        }
      }
      this.fixCache.push(...fixes);
    }

    const durationMs = Date.now() - startTime;
    return { claims, results, fixes, durationMs };
  }

  async checkSection(filePath: string, heading: string): Promise<CheckResult & { section: SectionInfo }> {
    const startTime = Date.now();
    await this.ensureInitialized();

    const absPath = path.resolve(this.repoRoot, filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const section = findSection(content, heading);
    if (!section) {
      const available = listHeadings(content).map((h) => h.text);
      throw new Error(
        `Section "${heading}" not found in ${filePath}. Available sections: ${available.join(', ') || '(none)'}`,
      );
    }

    // Extract all claims then filter to section range
    const allClaims = this.extractClaimsInMemory(filePath, content);
    const sectionClaims = allClaims.filter(
      (c) => c.line_number >= section.startLine && c.line_number <= section.endLine,
    );

    const results: VerificationResult[] = [];
    for (const claim of sectionClaims) {
      const result = await this.verifyClaim(claim);
      if (result) results.push(result);
    }

    // Generate fixes for drifted claims (LLM)
    const fixes: DocFix[] = [];
    if (this.llmClient) {
      for (const result of results) {
        if (result.verdict === 'drifted') {
          const claim = sectionClaims.find((c) => c.id === result.claim_id);
          if (claim) {
            const fix = await this.generateFix(claim, result);
            if (fix) fixes.push(fix);
          }
        }
      }
      this.fixCache.push(...fixes);
    }

    const durationMs = Date.now() - startTime;
    return { claims: sectionClaims, results, fixes, durationMs, section };
  }

  listSections(filePath: string): string[] {
    const absPath = path.resolve(this.repoRoot, filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    return listHeadings(content).map((h) => `${'#'.repeat(h.level)} ${h.text}`);
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

      // Generate fixes for drifted claims (LLM)
      const fixes: DocFix[] = [];
      if (this.llmClient) {
        for (const r of results) {
          if (r.verdict === 'drifted') {
            const claim = claims.find((c) => c.id === r.claim_id);
            if (claim) {
              const fix = await this.generateFix(claim, r);
              if (fix) fixes.push(fix);
            }
          }
        }
        this.fixCache.push(...fixes);
      }

      totalClaims += claims.length;
      for (const r of results) {
        if (r.verdict === 'verified') totalVerified++;
        else if (r.verdict === 'drifted') totalDrifted++;
        else totalUncertain++;
      }

      files.push({ file: docFile, claims, results, fixes });
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
      ...extractEnvironmentClaims(preprocessed),
      ...extractConventionClaims(preprocessed),
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
    if (claim.claim_type === 'convention' || claim.claim_type === 'environment' || claim.claim_type === 'config') {
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

    // TIER 3: LLM verification (requires API key)
    if (this.llmClient) {
      const result = await this.verifyWithLLM(claim);
      if (result) {
        result.duration_ms = Date.now() - startTime;
        return result;
      }
    }

    // Claims that can't be verified deterministically (and no LLM) are skipped
    return null;
  }

  /**
   * Verify a claim using LLM (Tier 3, Path 1 — evidence provided).
   */
  private async verifyWithLLM(claim: Claim): Promise<VerificationResult | null> {
    if (!this.llmClient) return null;

    // Build evidence from codebase
    const evidence = await buildEvidence(claim, this.index, 'local');
    if (!evidence.formattedEvidence) {
      // No evidence found — can't verify
      return null;
    }

    const promptInput = {
      claimText: claim.claim_text,
      claimType: claim.claim_type,
      sourceFile: claim.source_file,
      sourceLine: claim.line_number,
      evidence: evidence.formattedEvidence,
      evidenceFiles: evidence.evidenceFiles,
    };

    const { system, user } = buildVerifyPrompt(promptInput);
    const llmResult = await llmCallWithRetry(
      this.llmClient,
      system,
      user,
      { model: DEFAULT_VERIFY_MODEL, temperature: 0, maxTokens: 1000 },
      PVerifyOutputSchema,
    );

    if (!llmResult) return null;

    const output = llmResult.result;
    return {
      id: randomUUID(),
      claim_id: claim.id,
      repo_id: 'local',
      scan_run_id: 'cli',
      verdict: output.verdict as 'verified' | 'drifted' | 'uncertain',
      confidence: output.confidence,
      severity: output.severity,
      reasoning: output.reasoning,
      specific_mismatch: output.specific_mismatch,
      suggested_fix: output.suggested_fix,
      evidence_files: output.evidence_files,
      tier: 3,
      token_cost: llmResult.tokens.input + llmResult.tokens.output,
      duration_ms: 0,
      verification_path: 1,
      post_check_result: null,
      created_at: new Date(),
    };
  }

  /**
   * Generate a fix for a drifted claim using LLM.
   */
  private async generateFix(claim: Claim, result: VerificationResult): Promise<DocFix | null> {
    if (!this.llmClient || result.verdict !== 'drifted') return null;

    const { system, user } = buildFixPrompt({
      claimText: claim.claim_text,
      sourceFile: claim.source_file,
      sourceLine: claim.line_number,
      mismatchDescription: result.specific_mismatch ?? result.reasoning ?? 'Documentation does not match code',
      evidenceFiles: result.evidence_files ?? [],
    });

    const llmResult = await llmCallWithRetry(
      this.llmClient,
      system,
      user,
      { model: DEFAULT_FIX_MODEL, temperature: 0.3, maxTokens: 500 },
      PFixOutputSchema,
    );

    if (!llmResult) return null;

    const fix = llmResult.result.suggested_fix;
    return {
      file: fix.file_path,
      line_start: fix.line_start,
      line_end: fix.line_end,
      old_text: claim.claim_text,
      new_text: fix.new_text,
      reason: fix.explanation,
      claim_id: claim.id,
      confidence: result.confidence,
    };
  }
}
