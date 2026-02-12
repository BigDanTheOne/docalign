import type {
  Claim,
  ClaimMapping,
  FormattedEvidence,
  VerificationPath,
} from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';
import type { VerifierConfig } from './routing';
import { DEFAULT_VERIFIER_CONFIG } from './routing';

/**
 * Build Path 1 evidence for a claim.
 * TDD-3 Section 4.3, Appendix E.
 */
export async function buildPath1Evidence(
  claim: Claim,
  mappings: ClaimMapping[],
  index: CodebaseIndexService,
  config: VerifierConfig = DEFAULT_VERIFIER_CONFIG,
): Promise<FormattedEvidence> {
  // Use the primary entity mapping (highest confidence with entity)
  const entityMapping = mappings
    .filter((m) => m.code_entity_id != null)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (!entityMapping || !entityMapping.code_entity_id) {
    throw new Error('buildPath1Evidence called without entity mapping');
  }

  const filePath = entityMapping.code_file;

  // Step 1: Get all entities in the file
  const allEntities = await index.getEntityByFile(claim.repo_id, filePath);
  const targetEntity = allEntities.find((e) => e.id === entityMapping.code_entity_id);

  if (!targetEntity) {
    throw new Error('Mapped entity not found in file');
  }

  const entityCode = targetEntity.raw_code || targetEntity.signature;
  const entityLines: [number, number] = [targetEntity.line_number, targetEntity.end_line_number];
  const entityTokenEstimate = Math.ceil(entityCode.length / config.chars_per_token);

  // Step 2: Extract imports (entities with type 'config' or at file top)
  const importEntities = allEntities.filter(
    (e) => e.line_number <= config.path1_max_import_lines && e.id !== targetEntity.id,
  );
  const importsText = importEntities
    .map((e) => e.signature || e.raw_code)
    .filter(Boolean)
    .join('\n')
    .slice(0, config.path1_max_import_lines * 80); // Rough line length limit
  const importsTokenEstimate = Math.ceil(importsText.length / config.chars_per_token);

  // Step 3: Extract same-file type signatures referenced by target entity
  const typeEntities = allEntities
    .filter(
      (e) =>
        e.entity_type === 'type' &&
        e.id !== targetEntity.id &&
        (targetEntity.raw_code.includes(e.name) || targetEntity.signature.includes(e.name)),
    )
    .slice(0, config.path1_max_type_signatures);

  let typeSignaturesText = typeEntities.map((e) => e.signature).join('\n');
  const typeLines = typeSignaturesText.split('\n');
  if (typeLines.length > config.path1_max_type_lines) {
    typeSignaturesText = typeLines.slice(0, config.path1_max_type_lines).join('\n');
  }

  // Step 4: Format evidence
  const parts: string[] = [`--- File: ${filePath} ---`, ''];
  if (importsText) {
    parts.push('// Imports');
    parts.push(importsText);
    parts.push('');
  }
  if (typeSignaturesText) {
    parts.push('// Type Signatures');
    parts.push(typeSignaturesText);
    parts.push('');
  }
  parts.push(`// Entity: ${targetEntity.name} (lines ${entityLines[0]}-${entityLines[1]})`);
  parts.push(entityCode);

  const formatted_evidence = parts.join('\n');
  const totalTokenEstimate =
    entityTokenEstimate +
    importsTokenEstimate +
    Math.ceil(typeSignaturesText.length / config.chars_per_token);

  return {
    formatted_evidence,
    metadata: {
      path: 1 as VerificationPath,
      file_path: filePath,
      entity_name: targetEntity.name,
      entity_lines: entityLines,
      entity_token_estimate: entityTokenEstimate,
      imports_token_estimate: importsTokenEstimate,
      total_token_estimate: totalTokenEstimate,
    },
  };
}
