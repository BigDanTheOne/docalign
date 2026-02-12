/**
 * P-VERIFY Path 1: Evidence-provided deep semantic verification.
 * Implements: phase4b-prompt-specs.md Section 4A.
 */
import { PVerifyOutputSchema, type PVerifyOutput } from './schemas';

const SYSTEM_PROMPT = `You are a documentation accuracy verifier for a software project. Your job is to compare a documentation claim against actual source code evidence and determine whether the claim is still accurate.

Rules:
1. Focus on FACTUAL accuracy only, not style, completeness, or code quality.
2. The documentation does not need to describe everything -- it just needs to be correct about what it DOES describe.
3. Minor simplifications in documentation language are acceptable (e.g., "handles authentication" for a function named processAuthRequest is fine).
4. If the claim is partially accurate (some parts true, some false), classify as DRIFTED and specify which parts are wrong.
5. If you cannot determine accuracy from the provided evidence, classify as UNCERTAIN. Do NOT guess.
6. ONLY reference code that has been provided to you below. Do NOT hallucinate file paths, function names, or code that was not shown.
7. When the verdict is DRIFTED:
   - severity HIGH = completely wrong or misleading (could cause errors if a developer follows the docs)
   - severity MEDIUM = outdated detail but general idea is correct
   - severity LOW = minor inaccuracy unlikely to cause issues
   - Provide a specific_mismatch: exactly what is wrong
   - Provide a suggested_fix: corrected documentation text

Respond with ONLY a JSON object matching the required schema. No other text.`;

/**
 * Build the P-VERIFY Path 1 prompt messages.
 */
export function buildVerifyPath1Prompt(payload: Record<string, unknown>): {
  system: string;
  user: string;
} {
  const claim = payload.claim as {
    source_file?: string;
    source_line?: number;
    claim_type?: string;
    claim_text?: string;
  } || {};

  const evidence = payload.evidence as {
    formatted_evidence?: string;
  } || {};

  const user = `Verify this documentation claim against the source code evidence.

<claim file="${claim.source_file || ''}" line="${claim.source_line || 0}" type="${claim.claim_type || ''}">
${claim.claim_text || ''}
</claim>

<evidence>
${evidence.formatted_evidence || ''}
</evidence>

Respond as JSON:
{
  "verdict": "verified" | "drifted" | "uncertain",
  "confidence": <0.0 to 1.0>,
  "severity": "high" | "medium" | "low" | null,
  "reasoning": "1-2 sentence explanation of your verdict",
  "specific_mismatch": "what exactly is wrong (null if verified or uncertain)",
  "suggested_fix": "corrected documentation text (null if verified or uncertain)",
  "evidence_files": ["files examined"]
}`;

  return { system: SYSTEM_PROMPT, user };
}

/**
 * Parse and validate P-VERIFY LLM response (both Path 1 and Path 2).
 */
export function parseVerifyResponse(raw: string): PVerifyOutput {
  const parsed = JSON.parse(raw);
  return PVerifyOutputSchema.parse(parsed);
}
