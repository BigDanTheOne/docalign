/**
 * IE-02: Semantic Drift End-to-End Integration Test.
 * Implements: phase5-integration-examples.md IE-02.
 *
 * Simulates the full flow:
 * dispatch → poll → P-EXTRACT (3 claims) → P-VERIFY Path 1 (drifted, 0.97, high)
 * → P-FIX (corrected text) → submit results
 */
import { describe, it, expect, vi } from 'vitest';
import { createTaskProcessor } from '../../src/task-processor';
import type { ActionConfig } from '../../src/config';
import type { LLMClient, LLMResponse } from '../../src/llm-client';
import type { TaskDetailResponse } from '../../src/api-client';

function makeConfig(): ActionConfig {
  return {
    docalignToken: 'token',
    serverUrl: 'https://api.test',
    anthropicApiKey: 'sk-test',
    openaiApiKey: null,
    scanRunId: 'ie02-scan',
    repoId: 'ie02-repo',
    maxTasks: 100,
    pollIntervalMs: 100,
    actionRunId: 'ie02-run',
    llm: {
      verificationModel: 'claude-sonnet-4-5-20250929',
      extractionModel: 'claude-sonnet-4-5-20250929',
      triageModel: 'claude-haiku-3-5-20241022',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
    },
    verification: { maxClaimsPerPr: 50, autoFix: false, autoFixThreshold: 0.9 },
    mapping: { path1MaxEvidenceTokens: 8000, maxAgentFilesPerClaim: 10 },
    agent: { concurrency: 5, timeoutSeconds: 120, command: undefined },
  };
}

describe('IE-02: Semantic Drift End-to-End', () => {
  it('full flow: extract → verify (drifted) → fix', async () => {
    let callIndex = 0;

    const llm: LLMClient = {
      complete: vi.fn().mockImplementation((_system: string, user: string): Promise<LLMResponse> => {
        callIndex++;

        // Call 1: Triage (DRIFTED → proceed to full verify)
        if (callIndex === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              classification: 'DRIFTED',
              explanation: 'Code uses argon2, not bcrypt.',
            }),
            model: 'claude-haiku-3-5-20241022',
            inputTokens: 400,
            outputTokens: 30,
          });
        }

        // Call 2: P-VERIFY Path 1 (drifted, high severity)
        if (callIndex === 2) {
          return Promise.resolve({
            content: JSON.stringify({
              verdict: 'drifted',
              confidence: 0.97,
              severity: 'high',
              reasoning: 'The code uses argon2id (via @node-rs/argon2) for password hashing, not bcrypt as claimed.',
              specific_mismatch: 'Documentation says bcrypt with 12 salt rounds but code uses argon2id with memoryCost: 65536.',
              suggested_fix: 'Authentication uses argon2id with 64MB memory cost for password hashing.',
              evidence_files: ['src/auth/password.ts'],
            }),
            model: 'claude-sonnet-4-5-20250929',
            inputTokens: 800,
            outputTokens: 200,
          });
        }

        return Promise.reject(new Error(`Unexpected LLM call #${callIndex}`));
      }),
    };

    const config = makeConfig();
    const processor = createTaskProcessor(config, llm);

    // Step 1: Simulate verification task (bcrypt claim against argon2 code)
    const verifyTask: TaskDetailResponse = {
      id: 'ie02-verify-1',
      repo_id: 'ie02-repo',
      scan_run_id: 'ie02-scan',
      type: 'verification',
      status: 'in_progress',
      payload: {
        type: 'verification',
        verification_path: 1,
        claim: {
          id: 'claim-1',
          claim_text: 'Authentication uses bcrypt with 12 salt rounds for password hashing.',
          claim_type: 'behavior',
          source_file: 'README.md',
          source_line: 45,
        },
        evidence: {
          formatted_evidence: `--- File: src/auth/password.ts ---

// Imports
import { hash, verify } from '@node-rs/argon2';

// Entity: hashPassword (lines 5-8)
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
}`,
          code_file: 'src/auth/password.ts',
          start_line: 1,
          end_line: 8,
        },
        routing_reason: 'single_entity_mapped',
      },
      claimed_by: 'ie02-run',
      error: null,
      expires_at: '2026-02-12T01:00:00Z',
      created_at: '2026-02-12T00:00:00Z',
      completed_at: null,
    };

    const verifyResult = await processor.processTask(verifyTask);

    // Verify: drifted, high severity, 0.97 confidence
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.data).toMatchObject({
      type: 'verification',
      verdict: 'drifted',
      confidence: 0.97,
      severity: 'high',
    });
    expect((verifyResult.data as { evidence_files: string[] }).evidence_files).toContain('src/auth/password.ts');
    expect((verifyResult.data as { specific_mismatch: string }).specific_mismatch).toContain('bcrypt');
    expect(verifyResult.metadata?.model_used).toBe('claude-sonnet-4-5-20250929');
    expect(verifyResult.metadata?.tokens_used).toBeGreaterThan(0);

    // Step 2: Simulate fix generation task
    callIndex = 0;
    (llm.complete as ReturnType<typeof vi.fn>).mockImplementation((): Promise<LLMResponse> => {
      return Promise.resolve({
        content: JSON.stringify({
          suggested_fix: {
            file_path: 'README.md',
            line_start: 45,
            line_end: 45,
            new_text: 'Authentication uses argon2id with 64MB memory cost for password hashing.',
            explanation: 'Replaced bcrypt reference with argon2id, the actual hashing algorithm in use.',
          },
        }),
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 400,
        outputTokens: 100,
      });
    });

    const fixTask: TaskDetailResponse = {
      id: 'ie02-fix-1',
      repo_id: 'ie02-repo',
      scan_run_id: 'ie02-scan',
      type: 'fix_generation',
      status: 'in_progress',
      payload: {
        type: 'fix_generation',
        finding: {
          claim_text: 'Authentication uses bcrypt with 12 salt rounds for password hashing.',
          source_file: 'README.md',
          source_line: 45,
          verdict: 'drifted',
          mismatch_description: 'Documentation says bcrypt with 12 salt rounds but code uses argon2id.',
          evidence_files: ['src/auth/password.ts'],
        },
      },
      claimed_by: 'ie02-run',
      error: null,
      expires_at: '2026-02-12T01:00:00Z',
      created_at: '2026-02-12T00:00:00Z',
      completed_at: null,
    };

    const fixResult = await processor.processTask(fixTask);

    expect(fixResult.success).toBe(true);
    const fix = (fixResult.data as { suggested_fix: { new_text: string; file_path: string } }).suggested_fix;
    expect(fix).not.toBeNull();
    expect(fix.file_path).toBe('README.md');
    expect(fix.new_text).toContain('argon2id');
    expect(fix.new_text).not.toContain('bcrypt');
  });

  it('extraction task produces correct claim format', async () => {
    const llm: LLMClient = {
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          type: 'claim_extraction',
          claims: [
            {
              claim_text: 'The AuthService validates email format before creating a user.',
              claim_type: 'behavior',
              source_file: 'docs/architecture.md',
              source_line: 45,
              confidence: 0.9,
              keywords: ['AuthService', 'email', 'validation'],
            },
            {
              claim_text: 'The system uses Redis for session storage.',
              claim_type: 'architecture',
              source_file: 'docs/architecture.md',
              source_line: 52,
              confidence: 0.85,
              keywords: ['Redis', 'session', 'storage'],
            },
            {
              claim_text: 'Default timeout is 30 seconds.',
              claim_type: 'config',
              source_file: 'docs/architecture.md',
              source_line: 60,
              confidence: 0.95,
              keywords: ['timeout', 'default'],
            },
          ],
        }),
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 800,
        outputTokens: 400,
      }),
    };

    const config = makeConfig();
    const processor = createTaskProcessor(config, llm);

    const extractTask: TaskDetailResponse = {
      id: 'ie02-extract-1',
      repo_id: 'ie02-repo',
      scan_run_id: 'ie02-scan',
      type: 'claim_extraction',
      status: 'in_progress',
      payload: {
        type: 'claim_extraction',
        project_context: { language: 'TypeScript', frameworks: ['Express', 'Redis'] },
        doc_files: [{
          source_file: 'docs/architecture.md',
          chunk_heading: 'Authentication',
          start_line: 45,
          content: 'The AuthService validates email format before creating a user.\nThe system uses Redis for session storage.\nDefault timeout is 30 seconds.',
        }],
      },
      claimed_by: 'ie02-run',
      error: null,
      expires_at: '2026-02-12T01:00:00Z',
      created_at: '2026-02-12T00:00:00Z',
      completed_at: null,
    };

    const result = await processor.processTask(extractTask);

    expect(result.success).toBe(true);
    const claims = (result.data as { claims: Array<{ claim_type: string; confidence: number }> }).claims;
    expect(claims).toHaveLength(3);
    expect(claims.every((c) => ['behavior', 'architecture', 'config', 'convention', 'environment'].includes(c.claim_type))).toBe(true);
    expect(claims.every((c) => c.confidence >= 0 && c.confidence <= 1)).toBe(true);
  });
});
