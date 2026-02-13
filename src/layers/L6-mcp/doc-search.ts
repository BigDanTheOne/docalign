/**
 * DocSearchIndex — Multi-signal ranked search over documentation sections.
 *
 * Signals:
 *   1. MiniSearch (BM25-like text search over doc sections)
 *   2. Code entity graph traversal (query → findSymbol → claims → doc sections)
 *   3. Query intent classifier (keyword → claim_type boost)
 *   4. Verification status (verified = boost, drifted = penalty)
 *   5. Optional embedding similarity (when API key configured — not implemented in v1)
 *
 * Results are combined via Reciprocal Rank Fusion (RRF).
 */

import MiniSearch from 'minisearch';
import fs from 'fs';
import path from 'path';
import type { ClaimType } from '../../shared/types';
import type { CliPipeline, ScanResult } from '../../cli/local-pipeline';
import { listHeadings } from '../../cli/local-pipeline';
import { classifyIntent } from './query-intent';

// === Types ===

export interface DocSection {
  id: string;
  file: string;
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
}

export interface SearchResult {
  file: string;
  heading: string;
  content_preview: string;
  verification_status: 'verified' | 'drifted' | 'mixed' | 'unchecked';
  health_score: number | null;
  claims_total: number;
  claims_verified: number;
  claims_drifted: number;
  relevance_score: number;
}

export interface SearchResponse {
  sections: SearchResult[];
  total_matches: number;
  signals_used: string[];
}

// === DocSearchIndex ===

export class DocSearchIndex {
  private miniSearch: MiniSearch<DocSection>;
  private sections: Map<string, DocSection> = new Map();
  private scanResult: ScanResult | null = null;
  private built = false;

  constructor() {
    this.miniSearch = new MiniSearch<DocSection>({
      fields: ['heading', 'content'],
      storeFields: ['file', 'heading', 'startLine', 'endLine'],
      idField: 'id',
      searchOptions: {
        boost: { heading: 2 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  /**
   * Build the search index from the pipeline's scan results.
   * Must be called before searching.
   */
  async build(pipeline: CliPipeline, repoRoot: string): Promise<void> {
    this.scanResult = await pipeline.scanRepo();
    this.sections.clear();

    // Split docs into sections and index them
    const sectionsToAdd: DocSection[] = [];

    for (const scanFile of this.scanResult.files) {
      const absPath = path.resolve(repoRoot, scanFile.file);
      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }

      const fileSections = splitIntoSections(scanFile.file, content);
      for (const section of fileSections) {
        this.sections.set(section.id, section);
        sectionsToAdd.push(section);
      }
    }

    if (sectionsToAdd.length > 0) {
      this.miniSearch.addAll(sectionsToAdd);
    }

    this.built = true;
  }

  /**
   * Search for docs matching the query using multi-signal ranking.
   */
  search(
    query: string,
    options: {
      verified_only?: boolean;
      max_results?: number;
    } = {},
  ): SearchResponse {
    if (!this.built || !this.scanResult) {
      return { sections: [], total_matches: 0, signals_used: [] };
    }

    const maxResults = options.max_results ?? 10;
    const signalsUsed: string[] = [];

    // Signal 1: MiniSearch text search
    const textResults = this.textSearch(query);
    if (textResults.length > 0) signalsUsed.push('text');

    // Signal 2: Entity graph traversal
    const graphResults = this.entityGraphSearch(query);
    if (graphResults.length > 0) signalsUsed.push('entity_graph');

    // Signal 3: Query intent boost
    const intentTypes = classifyIntent(query);
    const intentResults = intentTypes.length > 0
      ? this.intentBoostSearch(intentTypes)
      : [];
    if (intentResults.length > 0) signalsUsed.push('intent_boost');

    // Combine with RRF
    const allSignals: Array<Array<{ id: string; rank: number }>> = [];
    if (textResults.length > 0) allSignals.push(textResults);
    if (graphResults.length > 0) allSignals.push(graphResults);
    if (intentResults.length > 0) allSignals.push(intentResults);

    if (allSignals.length === 0) {
      return { sections: [], total_matches: 0, signals_used: [] };
    }

    const rrfScores = reciprocalRankFusion(allSignals);

    // Signal 4: Verification status adjustment
    const adjustedScores = this.applyVerificationBoost(rrfScores);
    signalsUsed.push('verification_boost');

    // Sort by score descending
    const sorted = [...adjustedScores.entries()]
      .sort((a, b) => b[1] - a[1]);

    // Convert to SearchResult
    const results: SearchResult[] = [];
    for (const [sectionId, score] of sorted) {
      const section = this.sections.get(sectionId);
      if (!section) continue;

      const stats = this.getSectionStats(section);

      // Apply verified_only filter
      if (options.verified_only && stats.status !== 'verified') continue;

      results.push({
        file: section.file,
        heading: section.heading,
        content_preview: section.content.slice(0, 300),
        verification_status: stats.status,
        health_score: stats.healthScore,
        claims_total: stats.total,
        claims_verified: stats.verified,
        claims_drifted: stats.drifted,
        relevance_score: Math.round(score * 1000) / 1000,
      });

      if (results.length >= maxResults) break;
    }

    return {
      sections: results,
      total_matches: sorted.length,
      signals_used: signalsUsed,
    };
  }

  // === Signal 1: Text search ===

  private textSearch(query: string): Array<{ id: string; rank: number }> {
    const results = this.miniSearch.search(query);
    return results.map((r, i) => ({ id: String(r.id), rank: i + 1 }));
  }

  // === Signal 2: Entity graph traversal ===

  private entityGraphSearch(query: string): Array<{ id: string; rank: number }> {
    if (!this.scanResult) return [];

    // Tokenize query into keywords
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (keywords.length === 0) return [];

    // Find claims whose evidence_files or claim_text match query keywords
    const sectionScores = new Map<string, number>();

    for (const scanFile of this.scanResult.files) {
      for (let ci = 0; ci < scanFile.claims.length; ci++) {
        const claim = scanFile.claims[ci];
        const result = scanFile.results.find((r) => r.claim_id === claim.id);

        // Check if any keyword matches claim keywords, entity names in evidence
        let matchScore = 0;

        for (const keyword of keywords) {
          // Check claim keywords
          if (claim.keywords?.some((k) => k.toLowerCase().includes(keyword))) {
            matchScore += 2;
          }
          // Check claim text
          if (claim.claim_text.toLowerCase().includes(keyword)) {
            matchScore += 1;
          }
          // Check evidence files
          if (result?.evidence_files?.some((ef) => {
            const basename = ef.split('/').pop()?.toLowerCase() ?? '';
            return basename.includes(keyword);
          })) {
            matchScore += 1.5;
          }
        }

        if (matchScore > 0) {
          // Map claim to its section
          const sectionId = this.findSectionForClaim(scanFile.file, claim.line_number);
          if (sectionId) {
            sectionScores.set(
              sectionId,
              (sectionScores.get(sectionId) ?? 0) + matchScore,
            );
          }
        }
      }
    }

    // Rank by score
    const sorted = [...sectionScores.entries()]
      .sort((a, b) => b[1] - a[1]);

    return sorted.map(([id], i) => ({ id, rank: i + 1 }));
  }

  // === Signal 3: Intent boost ===

  private intentBoostSearch(intentTypes: ClaimType[]): Array<{ id: string; rank: number }> {
    if (!this.scanResult) return [];

    const sectionScores = new Map<string, number>();

    for (const scanFile of this.scanResult.files) {
      for (const claim of scanFile.claims) {
        if (intentTypes.includes(claim.claim_type)) {
          const sectionId = this.findSectionForClaim(scanFile.file, claim.line_number);
          if (sectionId) {
            sectionScores.set(
              sectionId,
              (sectionScores.get(sectionId) ?? 0) + 1,
            );
          }
        }
      }
    }

    const sorted = [...sectionScores.entries()]
      .sort((a, b) => b[1] - a[1]);

    return sorted.map(([id], i) => ({ id, rank: i + 1 }));
  }

  // === Signal 4: Verification boost ===

  private applyVerificationBoost(scores: Map<string, number>): Map<string, number> {
    const adjusted = new Map<string, number>();

    for (const [sectionId, score] of scores) {
      const stats = this.getSectionStatsById(sectionId);
      let boost = 0;

      if (stats.total > 0) {
        if (stats.drifted === 0 && stats.verified > 0) {
          // All verified — small positive boost
          boost = 0.01;
        } else if (stats.drifted > 0) {
          // Has drifted claims — small penalty (still returned)
          boost = -0.005;
        }
      }

      adjusted.set(sectionId, score + boost);
    }

    return adjusted;
  }

  // === Helpers ===

  private findSectionForClaim(file: string, lineNumber: number): string | null {
    for (const [id, section] of this.sections) {
      if (section.file === file && lineNumber >= section.startLine && lineNumber <= section.endLine) {
        return id;
      }
    }
    // Fallback: return the full document section
    const fallback = `${file}#_full`;
    if (this.sections.has(fallback)) return fallback;
    return null;
  }

  private getSectionStats(section: DocSection): {
    status: 'verified' | 'drifted' | 'mixed' | 'unchecked';
    healthScore: number | null;
    total: number;
    verified: number;
    drifted: number;
  } {
    return this.getSectionStatsById(section.id);
  }

  private getSectionStatsById(sectionId: string): {
    status: 'verified' | 'drifted' | 'mixed' | 'unchecked';
    healthScore: number | null;
    total: number;
    verified: number;
    drifted: number;
  } {
    const section = this.sections.get(sectionId);
    if (!section || !this.scanResult) {
      return { status: 'unchecked', healthScore: null, total: 0, verified: 0, drifted: 0 };
    }

    const scanFile = this.scanResult.files.find((f) => f.file === section.file);
    if (!scanFile) {
      return { status: 'unchecked', healthScore: null, total: 0, verified: 0, drifted: 0 };
    }

    // Get claims in this section's line range
    const sectionClaims = scanFile.claims.filter(
      (c) => c.line_number >= section.startLine && c.line_number <= section.endLine,
    );

    if (sectionClaims.length === 0) {
      return { status: 'unchecked', healthScore: null, total: 0, verified: 0, drifted: 0 };
    }

    let verified = 0;
    let drifted = 0;
    for (const claim of sectionClaims) {
      const result = scanFile.results.find((r) => r.claim_id === claim.id);
      if (result) {
        if (result.verdict === 'verified') verified++;
        else if (result.verdict === 'drifted') drifted++;
      }
    }

    const total = sectionClaims.length;
    const scored = verified + drifted;
    const healthScore = scored > 0 ? Math.round((verified / scored) * 100) / 100 : null;

    let status: 'verified' | 'drifted' | 'mixed' | 'unchecked';
    if (scored === 0) status = 'unchecked';
    else if (drifted === 0) status = 'verified';
    else if (verified === 0) status = 'drifted';
    else status = 'mixed';

    return { status, healthScore, total, verified, drifted };
  }
}

// === Section splitting ===

export function splitIntoSections(file: string, content: string): DocSection[] {
  const lines = content.split('\n');
  const headings = listHeadings(content);

  if (headings.length === 0) {
    // No headings — treat entire file as one section
    return [{
      id: `${file}#_full`,
      file,
      heading: 'Full Document',
      content: content.slice(0, 5000),
      startLine: 1,
      endLine: lines.length,
    }];
  }

  const sections: DocSection[] = [];

  const usedIds = new Set<string>();
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextHeadingIdx = headings.findIndex(
      (next, idx) => idx > i && next.level <= h.level,
    );
    const endLine = nextHeadingIdx >= 0 ? headings[nextHeadingIdx].line - 1 : lines.length;
    const sectionLines = lines.slice(h.line - 1, endLine);
    const sectionContent = sectionLines.join('\n').slice(0, 5000);

    // Ensure unique IDs (same heading can appear multiple times in a file)
    let id = `${file}#${h.text}`;
    if (usedIds.has(id)) {
      id = `${file}#${h.text}:L${h.line}`;
    }
    usedIds.add(id);

    sections.push({
      id,
      file,
      heading: h.text,
      content: sectionContent,
      startLine: h.line,
      endLine: Math.max(endLine, h.line),
    });
  }

  return sections;
}

// === RRF Fusion ===

export function reciprocalRankFusion(
  resultSets: Array<Array<{ id: string; rank: number }>>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const results of resultSets) {
    for (const { id, rank } of results) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return scores;
}
