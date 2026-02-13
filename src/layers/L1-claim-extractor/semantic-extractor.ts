/**
 * Semantic claim extraction via Claude CLI (`claude -p`).
 *
 * One call per doc file. Claude gets tools (Read, Glob, Grep) to explore
 * the codebase and populate evidence for each claim.
 */

import { z } from 'zod';
import { invokeClaudeStructured, type ClaudeBridgeOptions, type ClaudeBridgeError } from '../../cli/claude-bridge';
import { hashContent, generateClaimId, type SemanticClaimRecord } from '../../cli/semantic-store';
import { parseHeadings } from '../../cli/local-pipeline';
import { SEMANTIC_EXTRACT_SYSTEM_PROMPT, buildSemanticExtractPrompt } from '../../cli/prompts/semantic-extract';

// === Output schema ===

const EvidenceEntitySchema = z.object({
  symbol: z.string(),
  file: z.string(),
});

const EvidenceAssertionSchema = z.object({
  pattern: z.string(),
  scope: z.string(),
  expect: z.enum(['exists', 'absent']),
  description: z.string(),
});

export const SemanticExtractionOutputSchema = z.object({
  claims: z.array(z.object({
    claim_text: z.string(),
    claim_type: z.enum(['behavior', 'architecture', 'config']),
    keywords: z.array(z.string()),
    line_number: z.number().int().positive(),
    evidence_entities: z.array(EvidenceEntitySchema).optional().default([]),
    evidence_assertions: z.array(EvidenceAssertionSchema).optional().default([]),
  })),
});

export type SemanticExtractionOutput = z.infer<typeof SemanticExtractionOutputSchema>;

// === Section types ===

export interface DocSection {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
}

// === Public API ===

export interface ExtractionResult {
  claims: SemanticClaimRecord[];
  errors: Array<{ file: string; error: ClaudeBridgeError }>;
}

/**
 * Build sections from a doc file's content.
 * Splits by headings, computes content hashes per section.
 */
export function buildDocSections(file: string, content: string): DocSection[] {
  const lines = content.split('\n');
  const headings = parseHeadings(lines);

  if (headings.length === 0) {
    // No headings — treat entire file as one section
    return [{
      heading: '(document)',
      level: 0,
      startLine: 1,
      endLine: lines.length,
      content,
      contentHash: hashContent(content),
    }];
  }

  const sections: DocSection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeadingLine = i + 1 < headings.length ? headings[i + 1].line : lines.length + 1;
    const endLine = nextHeadingLine - 1;
    const sectionContent = lines.slice(heading.line - 1, endLine).join('\n');

    sections.push({
      heading: heading.text,
      level: heading.level,
      startLine: heading.line,
      endLine,
      content: sectionContent,
      contentHash: hashContent(sectionContent),
    });
  }

  return sections;
}

/**
 * Build the extraction prompt for one doc file's changed sections.
 */
export function buildExtractionPrompt(sections: DocSection[], repoPath: string): string {
  const sectionText = sections.map((s) =>
    `### Section: "${s.heading}" (lines ${s.startLine}-${s.endLine})\n\n${s.content}`,
  ).join('\n\n---\n\n');

  return buildSemanticExtractPrompt(sectionText, repoPath);
}

/**
 * Extract semantic claims from a doc file's changed sections.
 * One `claude -p` call per file with tool access.
 */
export async function extractSemanticClaims(
  sourceFile: string,
  sections: DocSection[],
  repoPath: string,
  options?: ClaudeBridgeOptions,
): Promise<ExtractionResult> {
  if (sections.length === 0) {
    return { claims: [], errors: [] };
  }

  const prompt = buildExtractionPrompt(sections, repoPath);

  const result = await invokeClaudeStructured(
    prompt,
    SemanticExtractionOutputSchema,
    {
      allowedTools: ['Read', 'Glob', 'Grep'],
      appendSystemPrompt: SEMANTIC_EXTRACT_SYSTEM_PROMPT,
      cwd: repoPath,
      // Normalize common Claude output quirks before Zod validation:
      // 1. Bare array → {claims: [...]}
      // 2. "not_exists" → "absent" (Claude sometimes invents enum values)
      preprocess: (data: unknown) => {
        const normalized = Array.isArray(data) ? { claims: data } : data;
        // Fix invented enum values in evidence_assertions
        if (normalized && typeof normalized === 'object' && 'claims' in normalized) {
          const obj = normalized as { claims: unknown[] };
          for (const claim of obj.claims) {
            if (claim && typeof claim === 'object' && 'evidence_assertions' in claim) {
              const c = claim as { evidence_assertions: Array<{ expect: string }> };
              for (const a of c.evidence_assertions) {
                if (a.expect === 'not_exists') a.expect = 'absent';
              }
            }
          }
        }
        return normalized;
      },
      ...options,
    },
  );

  if (!result.ok) {
    return {
      claims: [],
      errors: [{ file: sourceFile, error: result.error }],
    };
  }

  // Convert raw extraction to SemanticClaimRecords
  const claims: SemanticClaimRecord[] = result.data.claims.map((raw) => {
    // Find which section this claim belongs to
    const section = sections.find(
      (s) => raw.line_number >= s.startLine && raw.line_number <= s.endLine,
    ) ?? sections[0];

    return {
      id: generateClaimId(sourceFile, raw.claim_text),
      source_file: sourceFile,
      line_number: raw.line_number,
      claim_text: raw.claim_text,
      claim_type: raw.claim_type,
      keywords: raw.keywords,
      section_content_hash: section.contentHash,
      section_heading: section.heading,
      extracted_at: new Date().toISOString(),
      evidence_entities: (raw.evidence_entities ?? []).map((e) => ({
        ...e,
        content_hash: '', // Will be populated during verification
      })),
      evidence_assertions: raw.evidence_assertions ?? [],
      last_verification: null,
    };
  });

  return { claims, errors: [] };
}
