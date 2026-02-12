/**
 * P-TRIAGE: Quick LLM Triage prompt.
 * Implements: phase4b-prompt-specs.md Section 3.
 */
import { PTriageOutputSchema, type PTriageOutput } from './schemas';

const SYSTEM_PROMPT = `You are a documentation accuracy triage classifier. Given a documentation claim and a brief code snippet, quickly determine whether the claim clearly matches the code, clearly contradicts it, or requires deeper analysis.

Rules:
1. Only reference code that has been provided to you. Do not assume or invent code content.
2. Be conservative: if there is any ambiguity, classify as UNCERTAIN.
3. ACCURATE means the claim is obviously correct based on the evidence shown.
4. DRIFTED means the claim obviously contradicts the evidence shown.
5. UNCERTAIN means you cannot determine from this evidence alone -- deeper analysis needed.
6. Do NOT attempt nuanced reasoning. This is a fast classification. If it requires thought, return UNCERTAIN.

Respond with ONLY a JSON object. No other text.`;

/**
 * Build the P-TRIAGE prompt messages from a verification payload.
 */
export function buildTriagePrompt(payload: Record<string, unknown>): {
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
    code_file?: string;
    start_line?: number;
    end_line?: number;
  } || {};

  // Truncate evidence to ~500 tokens for cost efficiency
  let codeSnippet = evidence.formatted_evidence || '';
  if (codeSnippet.length > 2000) {
    codeSnippet = codeSnippet.slice(0, 2000) + '\n... [truncated]';
  }

  const user = `Classify this documentation claim:

<claim file="${claim.source_file || ''}" line="${claim.source_line || 0}" type="${claim.claim_type || ''}">
${claim.claim_text || ''}
</claim>

<code file="${evidence.code_file || ''}" lines="${evidence.start_line || 0}-${evidence.end_line || 0}">
${codeSnippet}
</code>

Respond as JSON:
{
  "classification": "ACCURATE" | "DRIFTED" | "UNCERTAIN",
  "explanation": "one sentence explanation"
}`;

  return { system: SYSTEM_PROMPT, user };
}

/**
 * Parse and validate P-TRIAGE LLM response.
 */
export function parseTriageResponse(raw: string): PTriageOutput {
  const parsed = JSON.parse(raw);
  return PTriageOutputSchema.parse(parsed);
}
