/**
 * Semantic claim persistence — per-doc-file JSON storage.
 *
 * Each doc file gets its own JSON in `.docalign/semantic/`:
 *   README.md        → .docalign/semantic/README.md.json
 *   docs/api.md      → .docalign/semantic/docs--api.md.json
 *
 * No monolithic file = no merge conflicts when committed to git.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

// === Evidence types ===

export interface EvidenceEntity {
  symbol: string;
  file: string;
  content_hash: string;
}

export interface EvidenceAssertion {
  pattern: string;
  scope: string;
  expect: 'exists' | 'absent';
  description: string;
}

export interface SemanticVerification {
  verdict: 'verified' | 'drifted' | 'uncertain';
  confidence: number;
  reasoning: string;
  verified_at: string;
}

export interface SemanticClaimRecord {
  id: string;
  source_file: string;
  line_number: number;
  claim_text: string;
  claim_type: 'behavior' | 'architecture' | 'config';
  keywords: string[];
  section_content_hash: string;
  section_heading: string;
  extracted_at: string;

  evidence_entities: EvidenceEntity[];
  evidence_assertions: EvidenceAssertion[];

  last_verification: SemanticVerification | null;
}

export interface SemanticClaimFile {
  version: 1;
  source_file: string;
  last_extracted_at: string;
  claims: SemanticClaimRecord[];
}

// === Constants ===

const SEMANTIC_DIR = '.docalign/semantic';

// === Public API ===

/**
 * Convert doc file path to storage path.
 * `docs/api.md` → `.docalign/semantic/docs--api.md.json`
 */
export function docFileToStorePath(repoRoot: string, docFile: string): string {
  const encoded = docFile.replace(/\//g, '--');
  return path.join(repoRoot, SEMANTIC_DIR, `${encoded}.json`);
}

/** SHA-256 truncated to 16 hex chars. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Deterministic claim ID: sem-{sha256(file:normalizedText)[0:16]} */
export function generateClaimId(file: string, claimText: string): string {
  const normalized = claimText.trim().toLowerCase().replace(/\s+/g, ' ');
  const input = `${file}:${normalized}`;
  return `sem-${hashContent(input)}`;
}

/** Load semantic claims for a single doc file. Returns null if not stored. */
export function loadClaimsForFile(repoRoot: string, docFile: string): SemanticClaimFile | null {
  const filePath = docFileToStorePath(repoRoot, docFile);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as SemanticClaimFile;
    if (data.version !== 1 || !Array.isArray(data.claims)) return null;
    // Normalize claims: default missing array fields to [] to guard against
    // hand-written or agent-generated JSON that omits optional array fields.
    data.claims = data.claims.map((c) => ({
      ...c,
      evidence_entities: Array.isArray(c.evidence_entities) ? c.evidence_entities : [],
      evidence_assertions: Array.isArray(c.evidence_assertions) ? c.evidence_assertions : [],
      keywords: Array.isArray(c.keywords) ? c.keywords : [],
    }));
    return data;
  } catch {
    return null;
  }
}

/** Save semantic claims for a single doc file. Atomic write via rename. */
export function saveClaimsForFile(repoRoot: string, docFile: string, data: SemanticClaimFile): void {
  const filePath = docFileToStorePath(repoRoot, docFile);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Atomic write: write to temp, then rename
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
}

/** Load all semantic claims across all doc files. */
export function loadAllClaims(repoRoot: string): SemanticClaimFile[] {
  const dir = path.join(repoRoot, SEMANTIC_DIR);
  if (!fs.existsSync(dir)) return [];

  const results: SemanticClaimFile[] = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const data = JSON.parse(raw) as SemanticClaimFile;
      if (data.version === 1 && Array.isArray(data.claims)) {
        results.push(data);
      }
    } catch {
      // Skip corrupted files
    }
  }

  return results;
}

/** Search across all files for a claim by ID. */
export function getClaimById(repoRoot: string, id: string): SemanticClaimRecord | null {
  const allFiles = loadAllClaims(repoRoot);
  for (const f of allFiles) {
    const claim = f.claims.find((c) => c.id === id);
    if (claim) return claim;
  }
  return null;
}

/**
 * Upsert claims into a claim file.
 * - New claims (by ID) are added
 * - Existing claims are updated (preserving last_verification if section unchanged)
 * - Claims from sections that were re-extracted are replaced
 * - Claims from sections NOT in extractedSectionHeadings are kept as-is
 */
export function upsertClaims(
  data: SemanticClaimFile,
  newClaims: SemanticClaimRecord[],
  extractedSectionHeadings: string[],
): SemanticClaimFile {
  const headingSet = new Set(extractedSectionHeadings.map((h) => h.toLowerCase()));

  // Keep claims from sections that were NOT re-extracted
  const keptClaims = data.claims.filter(
    (c) => !headingSet.has(c.section_heading.toLowerCase()),
  );

  // Merge: kept claims + new claims (new claims take precedence by ID)
  const claimMap = new Map<string, SemanticClaimRecord>();
  for (const c of keptClaims) {
    claimMap.set(c.id, c);
  }
  for (const c of newClaims) {
    claimMap.set(c.id, c);
  }

  return {
    ...data,
    last_extracted_at: new Date().toISOString(),
    claims: Array.from(claimMap.values()),
  };
}

export interface SectionHash {
  heading: string;
  contentHash: string;
}

/**
 * Find sections whose content has changed since last extraction.
 * Returns headings of changed sections.
 */
export function findChangedSections(
  data: SemanticClaimFile | null,
  currentSections: SectionHash[],
): string[] {
  if (!data) {
    // No prior data — all sections are "changed"
    return currentSections.map((s) => s.heading);
  }

  // Build map of stored section hashes (from claims)
  const storedHashes = new Map<string, string>();
  for (const claim of data.claims) {
    const key = claim.section_heading.toLowerCase();
    if (!storedHashes.has(key)) {
      storedHashes.set(key, claim.section_content_hash);
    }
  }

  const changed: string[] = [];
  for (const section of currentSections) {
    const storedHash = storedHashes.get(section.heading.toLowerCase());
    if (!storedHash || storedHash !== section.contentHash) {
      changed.push(section.heading);
    }
  }

  return changed;
}
