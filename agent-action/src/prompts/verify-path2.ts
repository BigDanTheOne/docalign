/**
 * P-VERIFY Path 2: Agent-delegated exploration verification.
 * Implements: phase4b-prompt-specs.md Section 4B.
 */
import type { ActionConfig } from '../config';

const SYSTEM_PROMPT = `You are a documentation accuracy verifier operating as a code exploration agent. You have access to read files in a repository. Your job is to determine whether a documentation claim is accurate by exploring relevant code.

Rules:
1. Start with the provided file hints as starting points, but you are NOT limited to them. Follow imports, search for related files, and examine tests if useful.
2. Focus on FACTUAL accuracy only, not style, completeness, or code quality.
3. The documentation does not need to describe everything -- it just needs to be correct about what it DOES describe.
4. Minor simplifications in documentation language are acceptable.
5. If the claim is partially accurate (some parts true, some false), classify as DRIFTED.
6. If you cannot find enough evidence to make a determination, classify as UNCERTAIN.
7. ONLY reference files and code you have actually read. Do NOT hallucinate file contents.
8. List ALL files you actually examined in evidence_files.
9. Severity: HIGH = completely wrong or misleading. MEDIUM = outdated detail, general idea correct. LOW = minor inaccuracy.
10. Stay within the file and token constraints provided.

Respond with ONLY a JSON object matching the required schema. No other text.`;

/**
 * Build the P-VERIFY Path 2 prompt messages.
 */
export function buildVerifyPath2Prompt(
  payload: Record<string, unknown>,
  config: ActionConfig,
): {
  system: string;
  user: string;
} {
  const claim = payload.claim as {
    source_file?: string;
    source_line?: number;
    claim_type?: string;
    claim_text?: string;
  } || {};

  const routingReason = (payload.routing_reason as string) || 'unknown';
  const mappedFiles = (payload.mapped_files as Array<{
    path: string;
    confidence: number;
    entity_name: string | null;
  }>) || [];

  const maxFiles = config.mapping.maxAgentFilesPerClaim;
  const maxTokens = config.mapping.path1MaxEvidenceTokens;

  let fileHints = '';
  if (mappedFiles.length > 0) {
    fileHints = mappedFiles
      .map((f) => `- ${f.path} (confidence: ${f.confidence}${f.entity_name ? `, entity: ${f.entity_name}` : ''})`)
      .join('\n');
  } else {
    fileHints = '(no file hints available)';
  }

  const user = `Verify this documentation claim by exploring the codebase.

<claim file="${claim.source_file || ''}" line="${claim.source_line || 0}" type="${claim.claim_type || ''}">
${claim.claim_text || ''}
</claim>

<routing_context>
Routing reason: ${routingReason}
</routing_context>

<file_hints>
${fileHints}
</file_hints>

<constraints>
Maximum files to examine: ${maxFiles}
Maximum evidence tokens: ${maxTokens}
</constraints>

Explore the code and respond as JSON:
{
  "verdict": "verified" | "drifted" | "uncertain",
  "confidence": <0.0 to 1.0>,
  "severity": "high" | "medium" | "low" | null,
  "reasoning": "1-3 sentences with specific code references",
  "specific_mismatch": "what exactly is wrong (null if verified or uncertain)",
  "suggested_fix": "corrected documentation text (null if verified or uncertain)",
  "evidence_files": ["all files you actually examined"]
}`;

  return { system: SYSTEM_PROMPT, user };
}
