/**
 * Zod schemas for LLM prompt output validation.
 * Mirrors agent-action/src/prompts/schemas.ts for CLI use.
 */
import { z } from 'zod';

/**
 * P-VERIFY output schema.
 */
export const PVerifyOutputSchema = z.object({
  verdict: z.enum(['verified', 'drifted', 'uncertain']),
  confidence: z.number().min(0).max(1),
  severity: z.enum(['high', 'medium', 'low']).nullable(),
  reasoning: z.string().min(1),
  specific_mismatch: z.string().nullable(),
  suggested_fix: z.string().nullable(),
  evidence_files: z.array(z.string()),
});
export type PVerifyOutput = z.infer<typeof PVerifyOutputSchema>;

/**
 * P-FIX output schema.
 */
export const PFixOutputSchema = z.object({
  suggested_fix: z.object({
    file_path: z.string().min(1),
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive(),
    new_text: z.string().min(1),
    explanation: z.string().min(1),
  }),
});
export type PFixOutput = z.infer<typeof PFixOutputSchema>;
