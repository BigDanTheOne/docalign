/**
 * Shared Zod schemas for prompt output validation.
 * Implements: phase4b-prompt-specs.md output schemas.
 */
import { z } from 'zod';

/**
 * P-EXTRACT output schema (Section 2.4).
 */
export const PExtractOutputSchema = z.object({
  type: z.literal('claim_extraction'),
  claims: z.array(z.object({
    claim_text: z.string().min(1),
    claim_type: z.enum(['behavior', 'architecture', 'config', 'convention', 'environment']),
    source_file: z.string().min(1),
    source_line: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    keywords: z.array(z.string()).min(1).max(5),
  })),
});
export type PExtractOutput = z.infer<typeof PExtractOutputSchema>;

/**
 * P-TRIAGE output schema (Section 3.4).
 */
export const PTriageOutputSchema = z.object({
  classification: z.enum(['ACCURATE', 'DRIFTED', 'UNCERTAIN']),
  explanation: z.string().min(1).max(500),
});
export type PTriageOutput = z.infer<typeof PTriageOutputSchema>;

/**
 * P-VERIFY output schema (Section 4A.4, 4B.4).
 */
export const PVerifyOutputSchema = z.object({
  verdict: z.enum(['verified', 'drifted', 'uncertain']),
  confidence: z.number().min(0).max(1),
  severity: z.enum(['high', 'medium', 'low']).nullable(),
  reasoning: z.string().min(1).max(1000),
  specific_mismatch: z.string().nullable(),
  suggested_fix: z.string().nullable(),
  evidence_files: z.array(z.string()),
});
export type PVerifyOutput = z.infer<typeof PVerifyOutputSchema>;

/**
 * P-FIX output schema (Section 5.4).
 */
export const PFixOutputSchema = z.object({
  suggested_fix: z.object({
    file_path: z.string().min(1),
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive(),
    new_text: z.string().min(1),
    explanation: z.string().min(1).max(500),
  }),
});
export type PFixOutput = z.infer<typeof PFixOutputSchema>;
