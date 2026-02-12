import { z } from 'zod';

const claimTypeEnum = z.enum([
  'path_reference',
  'dependency_version',
  'command',
  'api_route',
  'code_example',
  'behavior',
  'architecture',
  'config',
  'convention',
  'environment',
]);

const severityEnum = z.enum(['high', 'medium', 'low']);

export const docAlignConfigSchema = z
  .object({
    doc_patterns: z
      .object({
        include: z.array(z.string().min(1)).max(100).optional(),
        exclude: z.array(z.string().min(1)).max(100).optional(),
      })
      .optional(),

    code_patterns: z
      .object({
        include: z.array(z.string().min(1)).max(100).optional(),
        exclude: z.array(z.string().min(1)).max(100).optional(),
      })
      .optional(),

    verification: z
      .object({
        min_severity: severityEnum.optional(),
        max_claims_per_pr: z.number().int().min(1).max(200).optional(),
        auto_fix: z.boolean().optional(),
        auto_fix_threshold: z.number().min(0.5).max(1.0).optional(),
      })
      .optional(),

    claim_types: z
      .object({
        path_reference: z.boolean().optional(),
        dependency_version: z.boolean().optional(),
        command: z.boolean().optional(),
        api_route: z.boolean().optional(),
        code_example: z.boolean().optional(),
        behavior: z.boolean().optional(),
        architecture: z.boolean().optional(),
        config: z.boolean().optional(),
        convention: z.boolean().optional(),
        environment: z.boolean().optional(),
      })
      .optional(),

    suppress: z
      .array(
        z
          .object({
            file: z.string().min(1).optional(),
            pattern: z.string().min(1).optional(),
            claim_type: claimTypeEnum.optional(),
            package: z.string().min(1).optional(),
          })
          .refine((obj) => Object.keys(obj).length >= 1, {
            message: 'Suppression rule must have at least one field',
          }),
      )
      .max(200)
      .optional(),

    schedule: z
      .object({
        full_scan: z.enum(['daily', 'weekly', 'monthly', 'never']).optional(),
        full_scan_day: z.string().optional(),
      })
      .optional(),

    agent: z
      .object({
        concurrency: z.number().int().min(1).max(20).optional(),
        timeout_seconds: z.number().int().min(30).max(600).optional(),
        command: z.string().min(1).max(500).optional(),
      })
      .optional(),

    trigger: z
      .object({
        on_pr_open: z.boolean().optional(),
        on_push: z.boolean().optional(),
        on_ready_for_review: z.boolean().optional(),
        on_command: z.boolean().optional(),
      })
      .optional(),

    llm: z
      .object({
        verification_model: z.string().min(1).max(100).optional(),
        extraction_model: z.string().min(1).max(100).optional(),
        embedding_model: z.string().min(1).max(100).optional(),
        embedding_dimensions: z.number().int().min(64).max(4096).optional(),
      })
      .optional(),

    check: z
      .object({
        min_severity_to_block: severityEnum.optional(),
      })
      .optional(),

    mapping: z
      .object({
        semantic_threshold: z.number().min(0).max(1).optional(),
        path1_max_evidence_tokens: z.number().int().min(100).max(100000).optional(),
        max_agent_files_per_claim: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
  })
  .strict();

export type DocAlignConfigInput = z.input<typeof docAlignConfigSchema>;
