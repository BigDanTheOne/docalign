/**
 * P-FIX: Fix Generation prompt.
 * Implements: phase4b-prompt-specs.md Section 5.
 */
import { PFixOutputSchema, type PFixOutput } from './schemas';

const SYSTEM_PROMPT = `You are a documentation editor for a software project. Given a documentation claim that has been identified as inaccurate (drifted from code reality), generate the corrected text.

Rules:
1. Preserve the original documentation's tone, style, and level of detail. Do not over-explain.
2. The fix should be a drop-in replacement for the original text -- same scope, same audience.
3. ONLY use information from the provided mismatch description and evidence. Do NOT hallucinate code details.
4. If the mismatch is about a specific value (version, function name, library), replace only that value.
5. If the claim is fundamentally wrong, write a brief replacement that accurately describes current behavior.
6. Keep the fix concise. Do not expand a one-sentence claim into a paragraph.
7. The output text should be ready to insert into the documentation file as-is.

Respond with ONLY a JSON object. No other text.`;

/**
 * Build the P-FIX prompt messages from a fix_generation payload.
 */
export function buildFixPrompt(payload: Record<string, unknown>): {
  system: string;
  user: string;
} {
  const finding = payload.finding as {
    claim_text?: string;
    source_file?: string;
    source_line?: number;
    mismatch_description?: string;
    evidence_files?: string[];
  } || {};

  const evidenceFiles = Array.isArray(finding.evidence_files)
    ? finding.evidence_files.join(', ')
    : '';

  const user = `Generate corrected documentation for this drifted claim.

<finding>
  <claim file="${finding.source_file || ''}" line="${finding.source_line || 0}">${finding.claim_text || ''}</claim>
  <mismatch>${finding.mismatch_description || ''}</mismatch>
  <evidence_files>${evidenceFiles}</evidence_files>
</finding>

Respond as JSON:
{
  "suggested_fix": {
    "file_path": "${finding.source_file || ''}",
    "line_start": ${finding.source_line || 1},
    "line_end": ${finding.source_line || 1},
    "new_text": "the corrected documentation text",
    "explanation": "brief explanation of what changed"
  }
}`;

  return { system: SYSTEM_PROMPT, user };
}

/**
 * Parse and validate P-FIX LLM response.
 */
export function parseFixResponse(raw: string): PFixOutput {
  const parsed = JSON.parse(raw);
  return PFixOutputSchema.parse(parsed);
}
