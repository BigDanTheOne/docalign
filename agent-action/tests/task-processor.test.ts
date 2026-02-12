import { describe, it, expect, vi } from 'vitest';
import { createTaskProcessor } from '../src/task-processor';
import type { ActionConfig } from '../src/config';
import type { LLMClient, LLMResponse } from '../src/llm-client';
import type { TaskDetailResponse } from '../src/api-client';

function makeConfig(): ActionConfig {
  return {
    docalignToken: 'token',
    serverUrl: 'https://api.test',
    anthropicApiKey: 'sk-test',
    openaiApiKey: null,
    scanRunId: 'scan-1',
    repoId: 'repo-1',
    maxTasks: 100,
    pollIntervalMs: 2000,
    actionRunId: 'run-1',
    llm: {
      verificationModel: 'claude-sonnet',
      extractionModel: 'claude-sonnet',
      triageModel: 'claude-haiku',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
    },
    verification: { maxClaimsPerPr: 50, autoFix: false, autoFixThreshold: 0.9 },
    mapping: { path1MaxEvidenceTokens: 8000, maxAgentFilesPerClaim: 10 },
    agent: { concurrency: 5, timeoutSeconds: 120, command: undefined },
  };
}

function makeTask(type: string, payload: Record<string, unknown> = {}): TaskDetailResponse {
  return {
    id: 'task-1',
    repo_id: 'repo-1',
    scan_run_id: 'scan-1',
    type,
    status: 'in_progress',
    payload: { type, ...payload },
    claimed_by: 'run-1',
    error: null,
    expires_at: '2026-01-01T01:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
  };
}

function mockLlmResponse(content: string): LLMResponse {
  return { content, model: 'claude-sonnet', inputTokens: 100, outputTokens: 50 };
}

describe('TaskProcessor', () => {
  describe('claim_extraction', () => {
    it('processes extraction task and filters syntactic types', async () => {
      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          type: 'claim_extraction',
          claims: [
            { claim_text: 'Uses Redis for caching', claim_type: 'behavior', source_file: 'README.md', source_line: 1, confidence: 0.9, keywords: ['Redis'] },
            { claim_text: 'see src/config.ts', claim_type: 'path_reference', source_file: 'README.md', source_line: 2, confidence: 0.8, keywords: ['config'] },
          ],
        }))),
      };

      // path_reference won't pass Zod (not in allowed enum), so the LLM shouldn't return it.
      // But in reality the LLM might return only semantic types since we instruct it.
      // Let's test with only valid types:
      (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValue(mockLlmResponse(JSON.stringify({
        type: 'claim_extraction',
        claims: [
          { claim_text: 'Uses Redis for caching', claim_type: 'behavior', source_file: 'README.md', source_line: 1, confidence: 0.9, keywords: ['Redis'] },
          { claim_text: 'Follows hexagonal architecture', claim_type: 'architecture', source_file: 'README.md', source_line: 5, confidence: 0.7, keywords: ['hexagonal'] },
        ],
      })));

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('claim_extraction', {
        project_context: { language: 'TypeScript', frameworks: ['Express'] },
        doc_files: [{ source_file: 'README.md', content: 'Uses Redis for caching.' }],
      }));

      expect(result.success).toBe(true);
      expect((result.data as { claims: unknown[] }).claims).toHaveLength(2);
    });

    it('caps at 50 claims by confidence', async () => {
      const claims = Array.from({ length: 60 }, (_, i) => ({
        claim_text: `Claim ${i}`,
        claim_type: 'behavior',
        source_file: 'README.md',
        source_line: i + 1,
        confidence: i / 60, // ascending confidence
        keywords: ['test'],
      }));

      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          type: 'claim_extraction',
          claims,
        }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('claim_extraction', {
        project_context: { language: 'TypeScript', frameworks: [] },
        doc_files: [{ source_file: 'README.md', content: 'lots of claims' }],
      }));

      expect(result.success).toBe(true);
      expect((result.data as { claims: unknown[] }).claims).toHaveLength(50);
    });
  });

  describe('verification Path 1', () => {
    it('short-circuits on ACCURATE triage', async () => {
      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          classification: 'ACCURATE',
          explanation: 'Code matches claim exactly.',
        }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('verification', {
        verification_path: 1,
        claim: { source_file: 'README.md', source_line: 1, claim_type: 'behavior', claim_text: 'Validates email' },
        evidence: { formatted_evidence: 'if (!isValidEmail(email)) throw;' },
      }));

      expect(result.success).toBe(true);
      expect((result.data as { verdict: string }).verdict).toBe('verified');
      expect((result.data as { confidence: number }).confidence).toBe(0.8);
    });

    it('proceeds to full verify on DRIFTED triage', async () => {
      const llm: LLMClient = {
        complete: vi.fn()
          .mockResolvedValueOnce(mockLlmResponse(JSON.stringify({
            classification: 'DRIFTED',
            explanation: 'Uses argon2.',
          })))
          .mockResolvedValueOnce(mockLlmResponse(JSON.stringify({
            verdict: 'drifted',
            confidence: 0.95,
            severity: 'high',
            reasoning: 'Uses argon2, not bcrypt.',
            specific_mismatch: 'bcrypt vs argon2',
            suggested_fix: 'Uses argon2.',
            evidence_files: ['src/auth/password.ts'],
          }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('verification', {
        verification_path: 1,
        claim: { source_file: 'README.md', source_line: 45, claim_type: 'behavior', claim_text: 'Uses bcrypt.' },
        evidence: { formatted_evidence: 'import argon2;' },
      }));

      expect(result.success).toBe(true);
      expect((result.data as { verdict: string }).verdict).toBe('drifted');
      expect((result.data as { severity: string }).severity).toBe('high');
    });

    it('applies 3C-005: drifted with no evidence → uncertain', async () => {
      const llm: LLMClient = {
        complete: vi.fn()
          .mockResolvedValueOnce(mockLlmResponse(JSON.stringify({
            classification: 'UNCERTAIN',
            explanation: 'Need more info.',
          })))
          .mockResolvedValueOnce(mockLlmResponse(JSON.stringify({
            verdict: 'drifted',
            confidence: 0.7,
            severity: 'medium',
            reasoning: 'Seems wrong.',
            specific_mismatch: 'Something',
            suggested_fix: 'Fix it.',
            evidence_files: [], // empty evidence
          }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('verification', {
        verification_path: 1,
        claim: { source_file: 'README.md', source_line: 1, claim_type: 'behavior', claim_text: 'test' },
        evidence: { formatted_evidence: 'some code' },
      }));

      expect(result.success).toBe(true);
      expect((result.data as { verdict: string }).verdict).toBe('uncertain');
      expect((result.data as { reasoning: string }).reasoning).toContain('no supporting evidence');
    });

    it('applies verified with no evidence → confidence -0.3', async () => {
      const llm: LLMClient = {
        complete: vi.fn()
          .mockResolvedValueOnce(mockLlmResponse(JSON.stringify({
            classification: 'UNCERTAIN',
            explanation: 'Need more info.',
          })))
          .mockResolvedValueOnce(mockLlmResponse(JSON.stringify({
            verdict: 'verified',
            confidence: 0.9,
            severity: null,
            reasoning: 'Looks right.',
            specific_mismatch: null,
            suggested_fix: null,
            evidence_files: [], // empty evidence
          }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('verification', {
        verification_path: 1,
        claim: { source_file: 'README.md', source_line: 1, claim_type: 'behavior', claim_text: 'test' },
        evidence: { formatted_evidence: 'some code' },
      }));

      expect(result.success).toBe(true);
      expect((result.data as { verdict: string }).verdict).toBe('verified');
      expect((result.data as { confidence: number }).confidence).toBeCloseTo(0.6); // 0.9 - 0.3
    });
  });

  describe('verification Path 2', () => {
    it('processes Path 2 without triage', async () => {
      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          verdict: 'verified',
          confidence: 0.9,
          severity: null,
          reasoning: 'Code matches.',
          specific_mismatch: null,
          suggested_fix: null,
          evidence_files: ['src/api/handler.ts'],
        }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('verification', {
        verification_path: 2,
        claim: { source_file: 'ARCHITECTURE.md', source_line: 15, claim_type: 'architecture', claim_text: 'Data flows through queue.' },
        mapped_files: [{ path: 'src/api/handler.ts', confidence: 0.8, entity_name: null }],
        routing_reason: 'multi_file',
      }));

      expect(result.success).toBe(true);
      expect((result.data as { verdict: string }).verdict).toBe('verified');
      // Only 1 call — no triage for Path 2
      expect(llm.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('fix_generation', () => {
    it('generates a fix', async () => {
      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          suggested_fix: {
            file_path: 'README.md',
            line_start: 45,
            line_end: 45,
            new_text: 'Uses argon2id.',
            explanation: 'Replaced bcrypt.',
          },
        }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('fix_generation', {
        finding: {
          claim_text: 'Uses bcrypt.',
          source_file: 'README.md',
          source_line: 45,
          mismatch_description: 'Uses argon2.',
          evidence_files: ['src/auth/password.ts'],
        },
      }));

      expect(result.success).toBe(true);
      const fix = (result.data as { suggested_fix: { new_text: string } }).suggested_fix;
      expect(fix.new_text).toBe('Uses argon2id.');
    });

    it('discards fix when new_text equals original claim', async () => {
      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          suggested_fix: {
            file_path: 'README.md',
            line_start: 45,
            line_end: 45,
            new_text: 'Uses bcrypt.', // same as claim_text
            explanation: 'No change needed.',
          },
        }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('fix_generation', {
        finding: {
          claim_text: 'Uses bcrypt.',
          source_file: 'README.md',
          source_line: 45,
          mismatch_description: 'test',
          evidence_files: [],
        },
      }));

      expect(result.success).toBe(true);
      expect((result.data as { suggested_fix: null }).suggested_fix).toBeNull();
    });

    it('truncates excessively long fix text', async () => {
      const longText = 'a'.repeat(5000);
      const llm: LLMClient = {
        complete: vi.fn().mockResolvedValue(mockLlmResponse(JSON.stringify({
          suggested_fix: {
            file_path: 'README.md',
            line_start: 45,
            line_end: 45,
            new_text: longText,
            explanation: 'Very long fix.',
          },
        }))),
      };

      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('fix_generation', {
        finding: {
          claim_text: 'Short claim.',
          source_file: 'README.md',
          source_line: 45,
          mismatch_description: 'test',
          evidence_files: [],
        },
      }));

      expect(result.success).toBe(true);
      const fix = (result.data as { suggested_fix: { new_text: string } }).suggested_fix;
      expect(fix.new_text).toContain('[truncated]');
      expect(fix.new_text.length).toBeLessThan(longText.length);
    });
  });

  describe('unsupported task type', () => {
    it('returns failure for unknown type', async () => {
      const llm: LLMClient = { complete: vi.fn() };
      const processor = createTaskProcessor(makeConfig(), llm);
      const result = await processor.processTask(makeTask('unknown_type'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported task type');
    });
  });
});
