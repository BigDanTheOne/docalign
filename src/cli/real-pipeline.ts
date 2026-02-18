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

// Semantic claim support
import {
  loadClaimsForFile,
  saveClaimsForFile,
  findChangedSections,
  upsertClaims,
  type SemanticClaimFile,
  type SemanticClaimRecord,
} from './semantic-store';
import { checkClaimStaleness, checkAssertionStaleness, verifyWithEvidence } from './staleness-checker';
import { z } from 'zod';
import { isClaudeAvailable, invokeClaudeStructured } from './claude-bridge';
import {
  buildDocSections,
  extractSemanticClaims,
} from '../layers/L1-claim-extractor/semantic-extractor';
import { writeSkipTagsToFile, stripSkipTags } from '../tags/writer';

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const DEFAULT_VERIFY_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_FIX_MODEL = 'claude-sonnet-4-5-20250929';

export interface ExtractSemanticResult {
  totalFiles: number;
  totalExtracted: number;
  totalSkipped: number;
  /** Total number of skip-tag pairs written to document files. */
  totalTagsWritten: number;
  errors: Array<{ file: string; message: string }>;
}

export class LocalPipeline implements CliPipeline {
  private index: InMemoryIndex;
  private initialized = false;
  private knownPackages = new Set<string>();
  private fixCache: DocFix[] = [];
  private llmClient: LLMClient | null = null;
  private semanticStoreCache = new Map<string, SemanticClaimFile | null>();

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

  /** Repo root accessor for extract command. */
  getRepoRoot(): string {
    return this.repoRoot;
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
    const syntacticClaims = this.extractClaimsInMemory(filePath, content);

    // Load stored semantic claims
    const semanticClaims = this.loadSemanticClaimsAsClaims(filePath);
    const claims = [...syntacticClaims, ...semanticClaims];

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

      const syntacticClaims = this.extractClaimsInMemory(docFile, content);
      const semanticClaims = this.loadSemanticClaimsAsClaims(docFile);
      const claims = [...syntacticClaims, ...semanticClaims];

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

  /**
   * Extract semantic claims from doc files using Claude CLI.
   * One `claude -p` call per file with changed sections.
   */
  async extractSemantic(
    onProgress?: (current: number, total: number, file: string, status: string) => void,
    options?: { force?: boolean; files?: string[] },
  ): Promise<ExtractSemanticResult> {
    if (!isClaudeAvailable()) {
      return {
        totalFiles: 0,
        totalExtracted: 0,
        totalSkipped: 0,
        totalTagsWritten: 0,
        errors: [{ file: '', message: 'Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code' }],
      };
    }

    await this.ensureInitialized();

    const fileTree = await this.index.getFileTree('local');
    let docFiles = options?.files ?? discoverDocFiles(fileTree);

    if (options?.files) {
      // Explicit file list: validate they exist
      docFiles = docFiles.filter((f) => {
        const absPath = path.join(this.repoRoot, f);
        return fs.existsSync(absPath);
      });
    } else {
      // Default: restrict to docs/ directory only.
      // Root-level planning/ops docs (EXEC_PLAN.md, PRD.md, etc.) and hidden
      // directories (.openclaw/, .entire/, etc.) are excluded — they contain
      // large planning content with lots of code examples that produce FPs and
      // take a long time to process with Claude.
      docFiles = docFiles.filter((f) => f.startsWith('docs/'));
    }

    let totalExtracted = 0;
    let totalSkipped = 0;
    let totalTagsWritten = 0;
    const errors: Array<{ file: string; message: string }> = [];

    // Process files concurrently with a bounded semaphore.
    // Each file spawns a Claude subprocess; limiting concurrency avoids
    // overwhelming the system while still cutting wall-clock time to ~1/N.
    const CONCURRENCY = 5;
    let semCount = CONCURRENCY;
    const semQueue: Array<() => void> = [];
    const acquireSem = (): Promise<void> => {
      if (semCount > 0) { semCount--; return Promise.resolve(); }
      return new Promise(resolve => semQueue.push(resolve));
    };
    const releaseSem = (): void => {
      const next = semQueue.shift();
      if (next) { next(); } else { semCount++; }
    };

    let completedCount = 0;

    await Promise.all(docFiles.map(async (docFile, i) => {
      if (onProgress) onProgress(i + 1, docFiles.length, docFile, 'analyzing');

      let content: string;
      try {
        content = fs.readFileSync(path.join(this.repoRoot, docFile), 'utf-8');
      } catch {
        totalSkipped++;
        return;
      }

      if (content.length === 0 || content.length > MAX_FILE_SIZE) {
        totalSkipped++;
        return;
      }

      // Strip existing skip tags so Claude always sees clean line numbers.
      // Skip tags shift line indices; without stripping, re-runs produce
      // duplicate or misaligned tags because Claude's output is relative to
      // the tagged (shifted) content rather than the original content.
      const cleanContent = stripSkipTags(content);
      const allSections = buildDocSections(docFile, cleanContent);
      const stored = this.getCachedSemanticStore(docFile);

      // Determine which sections need re-extraction
      let sectionsToExtract = allSections;
      if (!options?.force) {
        const changed = findChangedSections(
          stored,
          allSections.map((s) => ({ heading: s.heading, contentHash: s.contentHash })),
        );
        if (changed.length === 0) {
          totalSkipped++;
          if (onProgress) onProgress(i + 1, docFiles.length, docFile, 'skipped');
          return;
        }
        sectionsToExtract = allSections.filter((s) =>
          changed.some((c) => c.toLowerCase() === s.heading.toLowerCase()),
        );
      }

      // Acquire semaphore before spawning Claude subprocess
      await acquireSem();
      if (onProgress) onProgress(i + 1, docFiles.length, docFile, 'extracting');

      try {
        const result = await extractSemanticClaims(
          docFile,
          sectionsToExtract,
          this.repoRoot,
        );

        if (result.errors.length > 0) {
          for (const err of result.errors) {
            errors.push({ file: err.file, message: err.error.message });
          }
        }

        // Write skip tags to the document file (Phase 1 classification output)
        if (result.skipRegions.length > 0) {
          const absDocPath = path.join(this.repoRoot, docFile);
          try {
            const tagResult = await writeSkipTagsToFile(absDocPath, result.skipRegions);
            totalTagsWritten += tagResult.tagsWritten;
          } catch (tagErr) {
            // Tag writing failure is non-fatal — semantic claims still persist
            errors.push({
              file: docFile,
              message: `Failed to write skip tags: ${tagErr instanceof Error ? tagErr.message : String(tagErr)}`,
            });
          }
        }

        if (result.claims.length > 0 || sectionsToExtract.length > 0) {
          // Upsert into store
          const currentData = stored ?? {
            version: 1 as const,
            source_file: docFile,
            last_extracted_at: new Date().toISOString(),
            claims: [],
          };

          const updated = upsertClaims(
            currentData,
            result.claims,
            sectionsToExtract.map((s) => s.heading),
          );

          // Test assertions and let Claude correct failures
          const failedAssertions = this.findFailedAssertions(updated.claims);
          if (failedAssertions.length > 0) {
            if (onProgress) onProgress(i + 1, docFiles.length, docFile, 'correcting');
            await this.correctFailedAssertions(updated.claims, failedAssertions);
          }

          // Run initial evidence verification for newly extracted claims
          // Claude just explored the codebase, so we can verify immediately
          for (const claim of updated.claims) {
            if (!claim.last_verification) {
              const evidenceResult = await verifyWithEvidence(claim, this.index, this.repoRoot);
              claim.last_verification = evidenceResult.verification;
              for (const entity of claim.evidence_entities) {
                const key = `${entity.symbol}:${entity.file}`;
                const newHash = evidenceResult.entityContentHashes.get(key);
                if (newHash) {
                  entity.content_hash = newHash;
                }
              }
            }
          }

          saveClaimsForFile(this.repoRoot, docFile, updated);
          this.semanticStoreCache.set(docFile, updated);
          totalExtracted += result.claims.length;
        }
      } finally {
        releaseSem();
        completedCount++;
        if (onProgress) onProgress(completedCount, docFiles.length, docFile, 'done');
      }
    }));

    return { totalFiles: docFiles.length, totalExtracted, totalSkipped, totalTagsWritten, errors };
  }

  // === Assertion correction ===

  /**
   * Find assertions that fail their own check (pattern doesn't match scope).
   * Returns list of { claimId, assertion, reason } for each failure.
   */
  private findFailedAssertions(
    claims: SemanticClaimRecord[],
  ): Array<{ claimId: string; claimText: string; assertion: SemanticClaimRecord['evidence_assertions'][0]; reason: string }> {
    const failures: Array<{ claimId: string; claimText: string; assertion: SemanticClaimRecord['evidence_assertions'][0]; reason: string }> = [];
    for (const claim of claims) {
      if (claim.last_verification) continue; // Already verified, skip
      for (const assertion of claim.evidence_assertions) {
        const failed = checkAssertionStaleness(assertion, this.repoRoot);
        if (failed) {
          const action = assertion.expect === 'exists' ? 'not found' : 'unexpectedly found';
          failures.push({
            claimId: claim.id,
            claimText: claim.claim_text,
            assertion,
            reason: `Pattern "${assertion.pattern}" ${action} in ${assertion.scope}`,
          });
        }
      }
    }
    return failures;
  }

  /**
   * Send failed assertions back to Claude for correction.
   * Claude gets tools to re-read the code and produce correct patterns.
   */
  private async correctFailedAssertions(
    claims: SemanticClaimRecord[],
    failures: Array<{ claimId: string; claimText: string; assertion: SemanticClaimRecord['evidence_assertions'][0]; reason: string }>,
  ): Promise<void> {
    const failureList = failures.map((f, i) =>
      `${i + 1}. Claim: "${f.claimText}"
   Assertion: pattern="${f.assertion.pattern}" scope="${f.assertion.scope}" expect="${f.assertion.expect}"
   Failed: ${f.reason}`,
    ).join('\n\n');

    const prompt = `You previously extracted documentation claims with evidence assertions. Some assertions failed verification — the patterns don't match the actual code.

For each failed assertion below, use Grep to find the correct pattern in the scope file, then return corrected assertions.

## Failed assertions

${failureList}

## Instructions

1. For each failed assertion, Grep the scope file to find what pattern ACTUALLY matches
2. If the claim is genuinely drifted (the code really doesn't support it), keep expect: "exists" with a pattern describing what SHOULD exist
3. Return ONLY the corrected assertions, keyed by their index number

Return JSON:
{
  "corrections": [
    { "index": 1, "pattern": "corrected_pattern", "scope": "file.ts", "expect": "exists", "description": "updated description" }
  ]
}

If an assertion is correct and the code genuinely doesn't match (real drift), return it unchanged.`;

    const CorrectionSchema = z.object({
      corrections: z.array(z.object({
        index: z.number(),
        pattern: z.string(),
        scope: z.string(),
        expect: z.enum(['exists', 'absent']),
        description: z.string(),
      })),
    });

    const result = await invokeClaudeStructured(prompt, CorrectionSchema, {
      allowedTools: ['Grep', 'Read', 'Glob'],
      appendSystemPrompt: 'You fix grep patterns to match actual code. Verify each correction with Grep before returning. Return valid JSON.',
      cwd: this.repoRoot,
      preprocess: (data: unknown) => {
        // Normalize bare array
        if (Array.isArray(data)) return { corrections: data };
        return data;
      },
    });

    if (!result.ok) return; // Correction failed — proceed with original assertions

    // Apply corrections back to claims
    for (const correction of result.data.corrections) {
      const failure = failures[correction.index - 1];
      if (!failure) continue;

      const claim = claims.find((c) => c.id === failure.claimId);
      if (!claim) continue;

      const assertionIdx = claim.evidence_assertions.findIndex(
        (a) => a.pattern === failure.assertion.pattern && a.scope === failure.assertion.scope,
      );
      if (assertionIdx === -1) continue;

      claim.evidence_assertions[assertionIdx] = {
        pattern: correction.pattern,
        scope: correction.scope,
        expect: correction.expect,
        description: correction.description,
      };
    }
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

    // TIER 4: Semantic claims (cached verdict from staleness check)
    if (claim.testability === 'semantic') {
      const result = await this.verifySemanticClaim(claim);
      if (result) {
        result.duration_ms = Date.now() - startTime;
        return result;
      }
      // No cached verdict — fall through to LLM if available
      if (this.llmClient) {
        const llmResult = await this.verifyWithLLM(claim);
        if (llmResult) {
          llmResult.duration_ms = Date.now() - startTime;
          return llmResult;
        }
      }
      return null;
    }

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
   * Load semantic claims for a file, with caching.
   */
  private getCachedSemanticStore(docFile: string): SemanticClaimFile | null {
    if (this.semanticStoreCache.has(docFile)) {
      return this.semanticStoreCache.get(docFile) ?? null;
    }
    const data = loadClaimsForFile(this.repoRoot, docFile);
    this.semanticStoreCache.set(docFile, data);
    return data;
  }

  /**
   * Load stored semantic claims for a doc file and convert to Claim objects.
   */
  private loadSemanticClaimsAsClaims(docFile: string): Claim[] {
    const data = this.getCachedSemanticStore(docFile);
    if (!data) return [];
    return data.claims.map((sc) => this.semanticClaimToRegularClaim(sc));
  }

  /**
   * Convert a SemanticClaimRecord to the standard Claim type.
   */
  private semanticClaimToRegularClaim(sc: SemanticClaimRecord): Claim {
    return {
      id: sc.id,
      repo_id: 'local',
      source_file: sc.source_file,
      line_number: sc.line_number,
      claim_text: sc.claim_text,
      claim_type: sc.claim_type,
      testability: 'semantic',
      extracted_value: { keywords: sc.keywords },
      keywords: sc.keywords,
      extraction_confidence: 0.8,
      extraction_method: 'llm',
      verification_status: sc.last_verification?.verdict ?? 'pending',
      last_verified_at: sc.last_verification ? new Date(sc.last_verification.verified_at) : null,
      embedding: null,
      last_verification_result_id: null,
      parent_claim_id: null,
      created_at: new Date(sc.extracted_at),
      updated_at: new Date(sc.extracted_at),
    };
  }

  /**
   * Verify a semantic claim using evidence checks (assertions + entities).
   *
   * Flow:
   * 1. If cached verdict exists and evidence is fresh → return cached
   * 2. Otherwise, run evidence-based verification (deterministic, no LLM)
   * 3. Persist the result back to the semantic store
   */
  private async verifySemanticClaim(claim: Claim): Promise<VerificationResult | null> {
    const data = this.getCachedSemanticStore(claim.source_file);
    if (!data) return null;

    const semClaim = data.claims.find((c) => c.id === claim.id);
    if (!semClaim) return null;

    const staleness = await checkClaimStaleness(semClaim, this.index, this.repoRoot);

    if (staleness === 'fresh' && semClaim.last_verification) {
      // Return cached verification
      return this.semanticVerificationToResult(claim, semClaim);
    }

    // Stale or no cached verification — run evidence-based verification
    const evidenceResult = await verifyWithEvidence(semClaim, this.index, this.repoRoot);

    // Update the stored claim with new verification + entity content hashes
    semClaim.last_verification = evidenceResult.verification;
    for (const entity of semClaim.evidence_entities) {
      const key = `${entity.symbol}:${entity.file}`;
      const newHash = evidenceResult.entityContentHashes.get(key);
      if (newHash) {
        entity.content_hash = newHash;
      }
    }

    // Persist back to store
    saveClaimsForFile(this.repoRoot, claim.source_file, data);
    // Update cache
    this.semanticStoreCache.set(claim.source_file, data);

    return this.semanticVerificationToResult(claim, semClaim);
  }

  /** Convert a SemanticClaimRecord with verification to a VerificationResult. */
  private semanticVerificationToResult(claim: Claim, semClaim: SemanticClaimRecord): VerificationResult | null {
    if (!semClaim.last_verification) return null;

    return {
      id: randomUUID(),
      claim_id: claim.id,
      repo_id: 'local',
      scan_run_id: 'cli',
      verdict: semClaim.last_verification.verdict,
      confidence: semClaim.last_verification.confidence,
      tier: 4, // Semantic evidence tier
      severity: semClaim.last_verification.verdict === 'drifted' ? 'medium' : null,
      reasoning: semClaim.last_verification.reasoning,
      specific_mismatch: semClaim.last_verification.verdict === 'drifted' ? semClaim.last_verification.reasoning : null,
      suggested_fix: null,
      evidence_files: [
        ...semClaim.evidence_entities.map((e) => e.file),
      ],
      token_cost: null,
      duration_ms: 0,
      verification_path: null,
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
