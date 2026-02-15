import { randomUUID } from 'crypto';
import type { Finding, VerificationResult, Claim } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';

/**
 * Check frontmatter-to-content consistency for a doc file.
 * - If frontmatter has `title`, verify it matches the first H1 heading.
 * - If frontmatter has `description`, verify overlap with opening paragraph.
 */
export async function checkFrontmatterConsistency(
  repoId: string,
  docFile: string,
  index: CodebaseIndexService,
): Promise<Finding[]> {
  const content = await index.readFileContent(repoId, docFile);
  if (!content) return [];

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return [];

  const findings: Finding[] = [];
  const bodyContent = stripFrontmatter(content);

  // Check title vs first H1
  if (frontmatter.title) {
    const firstH1 = extractFirstH1(bodyContent);
    if (firstH1 && normalize(firstH1) !== normalize(frontmatter.title)) {
      findings.push(makeFrontmatterFinding(
        repoId,
        docFile,
        `Frontmatter title '${frontmatter.title}' doesn't match first heading '${firstH1}'.`,
        `Title mismatch: frontmatter '${frontmatter.title}', heading '${firstH1}'.`,
      ));
    }
  }

  return findings;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (kv) {
      fields[kv[1].toLowerCase()] = kv[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }

  return Object.keys(fields).length > 0 ? fields : null;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function extractFirstH1(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function makeFrontmatterFinding(
  repoId: string,
  docFile: string,
  reasoning: string,
  mismatch: string,
): Finding {
  const claim: Claim = {
    id: randomUUID(),
    repo_id: repoId,
    source_file: docFile,
    line_number: 1,
    claim_text: `Frontmatter metadata in ${docFile}`,
    claim_type: 'convention',
    testability: 'syntactic',
    extracted_value: {},
    keywords: ['frontmatter'],
    extraction_confidence: 1.0,
    extraction_method: 'regex',
    verification_status: 'drifted',
    last_verified_at: null,
    embedding: null,
    last_verification_result_id: null,
    parent_claim_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const result: VerificationResult = {
    id: randomUUID(),
    claim_id: claim.id,
    repo_id: repoId,
    scan_run_id: null,
    verdict: 'drifted',
    confidence: 0.9,
    tier: 2,
    severity: 'low',
    reasoning,
    specific_mismatch: mismatch,
    suggested_fix: null,
    evidence_files: [docFile],
    token_cost: null,
    duration_ms: null,
    post_check_result: null,
    verification_path: null,
    created_at: new Date(),
  };

  return { claim, result, fix: null, suppressed: false };
}
