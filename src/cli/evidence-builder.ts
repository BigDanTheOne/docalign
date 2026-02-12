/**
 * Evidence builder for LLM verification (Tier 3).
 * Assembles code context from the InMemoryIndex for P-VERIFY Path 1.
 */

import type { Claim, CodeEntity } from '../shared/types';
import type { CodebaseIndexService } from '../layers/L0-codebase-index';

const MAX_EVIDENCE_TOKENS = 4000; // ~4000 tokens ≈ ~16000 chars
const MAX_EVIDENCE_CHARS = 16000;
const MAX_FILES = 5;

export interface EvidenceResult {
  formattedEvidence: string;
  evidenceFiles: string[];
}

/**
 * Build formatted evidence for a claim by searching the codebase index.
 * Returns evidence text and the list of files used.
 */
export async function buildEvidence(
  claim: Claim,
  index: CodebaseIndexService,
  repoId: string = 'local',
): Promise<EvidenceResult> {
  const evidenceFiles: string[] = [];
  const evidenceParts: string[] = [];
  let totalChars = 0;

  // 1. Search by claim keywords
  const keywords = claim.keywords ?? [];
  const matchedEntities: CodeEntity[] = [];
  const seenEntityIds = new Set<string>();

  for (const keyword of keywords) {
    if (matchedEntities.length >= 20) break;
    const entities = await index.findSymbol(repoId, keyword);
    for (const entity of entities) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        matchedEntities.push(entity);
      }
    }
  }

  // 2. Also try semantic search as fallback
  if (matchedEntities.length === 0 && claim.claim_text) {
    const semanticResults = await index.searchSemantic(repoId, claim.claim_text, 10);
    for (const entity of semanticResults) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        matchedEntities.push(entity);
      }
    }
  }

  // 3. Group by file and format evidence
  const entitiesByFile = new Map<string, CodeEntity[]>();
  for (const entity of matchedEntities) {
    const existing = entitiesByFile.get(entity.file_path) ?? [];
    existing.push(entity);
    entitiesByFile.set(entity.file_path, existing);
  }

  // Take top files (sorted by number of matching entities)
  const sortedFiles = [...entitiesByFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_FILES);

  for (const [filePath, entities] of sortedFiles) {
    if (totalChars >= MAX_EVIDENCE_CHARS) break;

    const fileSection = formatFileEvidence(filePath, entities);
    if (totalChars + fileSection.length > MAX_EVIDENCE_CHARS) {
      // Try to fit a truncated version
      const remaining = MAX_EVIDENCE_CHARS - totalChars;
      if (remaining > 200) {
        evidenceParts.push(fileSection.slice(0, remaining) + '\n[truncated]');
        evidenceFiles.push(filePath);
      }
      break;
    }

    evidenceParts.push(fileSection);
    evidenceFiles.push(filePath);
    totalChars += fileSection.length;
  }

  // 4. If no entity matches, try to read files mentioned in the claim
  if (evidenceParts.length === 0) {
    const extractedValue = claim.extracted_value as Record<string, unknown>;
    const claimPath = extractedValue?.path as string | undefined;
    if (claimPath) {
      const content = await index.readFileContent(repoId, claimPath);
      if (content) {
        const truncated = content.slice(0, MAX_EVIDENCE_CHARS);
        evidenceParts.push(`--- File: ${claimPath} ---\n\n${truncated}`);
        evidenceFiles.push(claimPath);
      }
    }
  }

  return {
    formattedEvidence: evidenceParts.join('\n\n'),
    evidenceFiles,
  };
}

function formatFileEvidence(filePath: string, entities: CodeEntity[]): string {
  const parts: string[] = [`--- File: ${filePath} ---\n`];

  // Sort entities by line number
  const sorted = [...entities].sort((a, b) => a.line_number - b.line_number);

  for (const entity of sorted) {
    const lineRange = entity.end_line_number
      ? `lines ${entity.line_number}-${entity.end_line_number}`
      : `line ${entity.line_number}`;

    parts.push(`// ${entity.entity_type}: ${entity.name} (${lineRange})`);

    if (entity.signature) {
      parts.push(entity.signature);
    }

    if (entity.raw_code) {
      // Truncate very long code blocks
      const code = entity.raw_code.length > 2000
        ? entity.raw_code.slice(0, 2000) + '\n// ... [truncated]'
        : entity.raw_code;
      parts.push(code);
    }

    parts.push('');
  }

  return parts.join('\n');
}
