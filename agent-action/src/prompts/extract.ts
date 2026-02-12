/**
 * P-EXTRACT: Semantic Claim Extraction prompt.
 * Implements: phase4b-prompt-specs.md Section 2.
 */
import { PExtractOutputSchema, type PExtractOutput } from './schemas';

const SYSTEM_PROMPT = `You are a documentation claim extractor for a code verification system. Your job is to identify every factual claim about the codebase in a documentation section that could be verified by examining source code.

You extract ONLY semantic claims -- claims about behavior, architecture, configuration, conventions, or environment that require reasoning to verify. The following claim types are handled separately by deterministic extraction and you must NOT extract them:
- File paths (e.g., "see src/config.ts")
- CLI commands (e.g., "npm run build")
- Dependency versions (e.g., "requires React 18+")
- API routes (e.g., "GET /api/users")
- Code examples (fenced code blocks)

Rules:
1. ONLY extract claims about what the code IS or DOES right now. Skip aspirational statements ("we plan to", "in the future"), opinions, and generic advice.
2. Each claim must be independently verifiable against source code.
3. Each claim must reference a specific code construct: a function, module, service, pattern, data flow, configuration, or convention.
4. Do NOT extract duplicate claims. If the same fact is stated multiple times, extract it once.
5. Be conservative: if a sentence is vague and would be impossible to verify against any code, skip it.
6. Do NOT invent or assume code references that are not explicitly stated in the documentation text.

Classify each claim into exactly one type:
- "behavior": How a specific function, module, or service behaves
- "architecture": How components connect, data flows between services, system structure
- "config": What configuration keys exist and their values/defaults
- "convention": Project-wide coding patterns and standards
- "environment": Runtime environment requirements

Return a JSON object matching the schema. If no verifiable claims exist, return an empty claims array.`;

/**
 * Build the P-EXTRACT prompt messages from a claim_extraction payload.
 */
export function buildExtractPrompt(payload: Record<string, unknown>): {
  system: string;
  user: string;
} {
  const projectContext = payload.project_context as { language?: string; frameworks?: string[] } || {};
  const docFiles = payload.doc_files as Array<{
    source_file?: string;
    chunk_heading?: string;
    start_line?: number;
    content?: string;
  }> || [];

  // Build user prompt from the first doc chunk (tasks are per-chunk)
  const doc = docFiles[0] || {};
  const language = projectContext.language || 'Unknown';
  const frameworks = Array.isArray(projectContext.frameworks) ? projectContext.frameworks.join(', ') : '';

  const user = `Project context:
- Language: ${language}
- Frameworks: ${frameworks}

Documentation file: ${doc.source_file || 'unknown'}
Chunk heading: ${doc.chunk_heading || ''}
Start line: ${doc.start_line || 1}

---
${doc.content || ''}
---

Extract all verifiable semantic claims from this documentation section. Return a JSON object matching the schema exactly.`;

  return { system: SYSTEM_PROMPT, user };
}

/**
 * Parse and validate P-EXTRACT LLM response.
 */
export function parseExtractResponse(raw: string): PExtractOutput {
  const parsed = JSON.parse(raw);
  return PExtractOutputSchema.parse(parsed);
}
