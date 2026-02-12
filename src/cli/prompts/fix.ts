/**
 * P-FIX prompt builder for CLI.
 * Generates corrected documentation text for drifted claims.
 */

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

export interface FixPromptInput {
  claimText: string;
  sourceFile: string;
  sourceLine: number;
  mismatchDescription: string;
  evidenceFiles: string[];
}

export function buildFixPrompt(input: FixPromptInput): {
  system: string;
  user: string;
} {
  const evidenceFiles = input.evidenceFiles.join(', ');

  const user = `Generate corrected documentation for this drifted claim.

<finding>
  <claim file="${input.sourceFile}" line="${input.sourceLine}">${input.claimText}</claim>
  <mismatch>${input.mismatchDescription}</mismatch>
  <evidence_files>${evidenceFiles}</evidence_files>
</finding>

Respond as JSON:
{
  "suggested_fix": {
    "file_path": "${input.sourceFile}",
    "line_start": ${input.sourceLine},
    "line_end": ${input.sourceLine},
    "new_text": "the corrected documentation text",
    "explanation": "brief explanation of what changed"
  }
}`;

  return { system: SYSTEM_PROMPT, user };
}
