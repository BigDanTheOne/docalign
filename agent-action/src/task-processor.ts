/**
 * Task processor: routes tasks to the appropriate prompt handler.
 */
import type { TaskDetailResponse } from './api-client';
import type { ActionConfig } from './config';
import type { LLMClient } from './llm-client';
import { executeWithRetry } from './retry';
import { buildExtractPrompt, parseExtractResponse } from './prompts/extract';
import { buildTriagePrompt, parseTriageResponse } from './prompts/triage';
import { buildVerifyPath1Prompt, parseVerifyResponse } from './prompts/verify-path1';
import { buildVerifyPath2Prompt } from './prompts/verify-path2';
import { buildFixPrompt, parseFixResponse } from './prompts/fix';

export interface TaskResult {
  success: boolean;
  error?: string;
  data: Record<string, unknown>;
  metadata?: {
    model_used?: string;
    tokens_used?: number;
    cost_usd?: number;
  };
}

export interface TaskProcessor {
  processTask(task: TaskDetailResponse): Promise<TaskResult>;
}

export function createTaskProcessor(config: ActionConfig, llm: LLMClient): TaskProcessor {
  return {
    async processTask(task: TaskDetailResponse): Promise<TaskResult> {
      const payload = task.payload;

      switch (task.type) {
        case 'claim_extraction':
          return processClaimExtraction(payload, config, llm);

        case 'verification':
          return processVerification(payload, config, llm);

        case 'fix_generation':
          return processFixGeneration(payload, config, llm);

        default:
          return {
            success: false,
            error: `Unsupported task type: ${task.type}`,
            data: { type: task.type },
          };
      }
    },
  };
}

async function processClaimExtraction(
  payload: Record<string, unknown>,
  config: ActionConfig,
  llm: LLMClient,
): Promise<TaskResult> {
  const { system, user } = buildExtractPrompt(payload);

  const result = await executeWithRetry(
    () => llm.complete(system, user, {
      model: config.llm.extractionModel,
      temperature: 0,
      maxTokens: 2000,
    }),
    parseExtractResponse,
    'P-EXTRACT',
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      data: { type: 'claim_extraction', claims: [] },
      metadata: result.metadata,
    };
  }

  // Post-processing: filter syntactic types, cap at 50
  const semanticTypes = new Set(['behavior', 'architecture', 'config', 'convention', 'environment']);
  let claims = result.data.claims.filter(
    (c: { claim_type: string }) => semanticTypes.has(c.claim_type),
  );

  if (claims.length > 50) {
    claims = claims
      .sort((a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence)
      .slice(0, 50);
  }

  return {
    success: true,
    data: { type: 'claim_extraction', claims },
    metadata: result.metadata,
  };
}

async function processVerification(
  payload: Record<string, unknown>,
  config: ActionConfig,
  llm: LLMClient,
): Promise<TaskResult> {
  const verificationPath = payload.verification_path as number;

  if (verificationPath === 1) {
    return processPath1Verification(payload, config, llm);
  } else {
    return processPath2Verification(payload, config, llm);
  }
}

async function processPath1Verification(
  payload: Record<string, unknown>,
  config: ActionConfig,
  llm: LLMClient,
): Promise<TaskResult> {
  // Step 1: Try triage first (cheap, fast classification)
  const triageResult = await tryTriage(payload, config, llm);
  if (triageResult) {
    return triageResult;
  }

  // Step 2: Full P-VERIFY Path 1
  const { system, user } = buildVerifyPath1Prompt(payload);

  const result = await executeWithRetry(
    () => llm.complete(system, user, {
      model: config.llm.verificationModel,
      temperature: 0,
      maxTokens: 1000,
    }),
    parseVerifyResponse,
    'P-VERIFY',
  );

  if (!result.success) {
    return {
      success: true,
      data: {
        type: 'verification',
        verdict: 'uncertain',
        confidence: 0,
        reasoning: 'llm_parse_error',
        evidence_files: [],
        specific_mismatch: null,
        suggested_fix: null,
      },
      metadata: result.metadata,
    };
  }

  // Post-processing: 3C-005 downgrade
  const data = applyVerificationPostProcessing(result.data);

  return {
    success: true,
    data: { type: 'verification', ...data },
    metadata: result.metadata,
  };
}

async function processPath2Verification(
  payload: Record<string, unknown>,
  config: ActionConfig,
  llm: LLMClient,
): Promise<TaskResult> {
  const { system, user } = buildVerifyPath2Prompt(payload, config);

  const result = await executeWithRetry(
    () => llm.complete(system, user, {
      model: config.llm.verificationModel,
      temperature: 0,
      maxTokens: 1500,
    }),
    parseVerifyResponse,
    'P-VERIFY',
  );

  if (!result.success) {
    return {
      success: true,
      data: {
        type: 'verification',
        verdict: 'uncertain',
        confidence: 0,
        reasoning: 'llm_parse_error',
        evidence_files: [],
        specific_mismatch: null,
        suggested_fix: null,
      },
      metadata: result.metadata,
    };
  }

  const data = applyVerificationPostProcessing(result.data);

  return {
    success: true,
    data: { type: 'verification', ...data },
    metadata: result.metadata,
  };
}

async function tryTriage(
  payload: Record<string, unknown>,
  config: ActionConfig,
  llm: LLMClient,
): Promise<TaskResult | null> {
  // Only triage Path 1 claims with evidence
  if (!payload.evidence) return null;

  const { system, user } = buildTriagePrompt(payload);

  const result = await executeWithRetry(
    () => llm.complete(system, user, {
      model: config.llm.triageModel,
      temperature: 0,
      maxTokens: 150,
    }),
    parseTriageResponse,
    'P-TRIAGE',
  );

  if (!result.success) {
    // Triage failure → skip triage, proceed to full verification
    return null;
  }

  const classification = result.data.classification as string;

  if (classification === 'ACCURATE') {
    // Short-circuit: verified with confidence 0.8
    return {
      success: true,
      data: {
        type: 'verification',
        verdict: 'verified',
        confidence: 0.8,
        reasoning: `Triage: ${result.data.explanation}`,
        evidence_files: [],
        specific_mismatch: null,
        suggested_fix: null,
      },
      metadata: result.metadata,
    };
  }

  // DRIFTED or UNCERTAIN → proceed to full P-VERIFY
  return null;
}

async function processFixGeneration(
  payload: Record<string, unknown>,
  config: ActionConfig,
  llm: LLMClient,
): Promise<TaskResult> {
  const { system, user } = buildFixPrompt(payload);

  const result = await executeWithRetry(
    () => llm.complete(system, user, {
      model: config.llm.verificationModel,
      temperature: 0.3,
      maxTokens: 500,
    }),
    parseFixResponse,
    'P-FIX',
  );

  if (!result.success) {
    return {
      success: true,
      data: { type: 'fix_generation', suggested_fix: null },
      metadata: result.metadata,
    };
  }

  // Post-processing: reject identical text, truncate excessive length
  const fix = result.data.suggested_fix as {
    file_path: string;
    line_start: number;
    line_end: number;
    new_text: string;
    explanation: string;
  };
  const finding = payload.finding as { claim_text?: string } | undefined;
  const originalText = finding?.claim_text || '';

  if (fix.new_text === originalText) {
    console.warn('[fix] Discarding fix: new_text identical to original claim_text');
    return {
      success: true,
      data: { type: 'fix_generation', suggested_fix: null },
      metadata: result.metadata,
    };
  }

  // Truncate if >5x original length
  const maxLen = Math.max(originalText.length * 5, 500);
  if (fix.new_text.length > maxLen) {
    fix.new_text = fix.new_text.slice(0, maxLen) + ' [truncated]';
    console.warn('[fix] Fix text truncated to 5x original length');
  }

  return {
    success: true,
    data: { type: 'fix_generation', suggested_fix: fix },
    metadata: result.metadata,
  };
}

/**
 * Apply post-processing rules per 3C-005.
 * - Drifted with empty evidence → uncertain
 * - Verified with empty evidence → confidence -0.3 (floor 0.2)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyVerificationPostProcessing(data: any): any {
  const { verdict, confidence, evidence_files } = data;
  const hasEvidence = Array.isArray(evidence_files) && evidence_files.length > 0;

  if (verdict === 'drifted' && !hasEvidence) {
    return {
      ...data,
      verdict: 'uncertain',
      reasoning: 'Drift reported but no supporting evidence provided.',
    };
  }

  if (verdict === 'verified' && !hasEvidence) {
    return {
      ...data,
      confidence: Math.max(0.2, (confidence || 0) - 0.3),
    };
  }

  return data;
}
