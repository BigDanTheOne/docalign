/**
 * Documentation Mind Map — Step 0 of the semantic extraction pipeline.
 *
 * Before extracting claims from individual doc files, DocAlign asks Claude
 * to classify all doc files by type (reference, contributing, tutorial, etc.)
 * and produce per-file extraction hints.  These hints are injected into Phase 1
 * of the main extraction prompt so the skip classifier understands the document
 * context without needing to re-read the full content.
 *
 * Storage: .docalign/doc-map.json
 */

import fs from 'fs';
import path from 'path';

// === Types ===

export interface DocMapEntry {
  /** Relative path from repo root. */
  file: string;
  /**
   * Document type — how this document is used by its audience.
   * Drives how aggressively Phase 1 marks content as illustrative.
   */
  doc_type:
    | 'getting_started'   // First-time user guide
    | 'tutorial'          // Step-by-step task guide
    | 'reference'         // Command/API/config reference
    | 'explanation'       // Conceptual "how it works" doc
    | 'contributing'      // Developer contribution guide
    | 'runbook'           // Operations / incident runbook
    | 'convention'        // Code or project conventions
    | 'configuration'     // Config schema / options
    | 'troubleshooting'   // Problem-solution guide
    | 'unknown';          // Could not determine
  /** Primary audience for this document. */
  audience: 'developer' | 'user' | 'contributor' | 'mixed';
  /**
   * Short one-line summary of what this document covers.
   * Written back into the doc's frontmatter as `summary:`.
   */
  summary?: string;
  /**
   * List of specific situations when a developer should reach for this doc.
   * Written back into the doc's frontmatter as `read_when:`.
   */
  read_when?: string[];
  /**
   * Hint for Phase 1 skip classification.
   * Injected verbatim into the extraction prompt so the classifier knows
   * what kinds of content in this specific file are illustrative.
   * NOT written to the doc file (internal to doc-map.json).
   */
  skip_hint?: string;
  /**
   * Hint for Phase 2 semantic claim extraction.
   * Tells the extractor what categories of claims to look for (or avoid).
   * NOT written to the doc file (internal to doc-map.json).
   */
  extraction_notes?: string;
}

export interface DocMap {
  /** ISO 8601 timestamp when this map was generated. */
  generated_at: string;
  /** Absolute repo root used when generating. */
  repo_path: string;
  /** One entry per doc file classified. */
  entries: DocMapEntry[];
}

// === Constants ===

const DOC_MAP_FILENAME = 'doc-map.json';
const DOC_MAP_DIR = '.docalign';

// === Storage ===

export function docMapPath(repoRoot: string): string {
  return path.join(repoRoot, DOC_MAP_DIR, DOC_MAP_FILENAME);
}

export function loadDocMap(repoRoot: string): DocMap | null {
  const filePath = docMapPath(repoRoot);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as DocMap;
  } catch {
    return null;
  }
}

export function saveDocMap(repoRoot: string, docMap: DocMap): void {
  const dir = path.join(repoRoot, DOC_MAP_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(docMapPath(repoRoot), JSON.stringify(docMap, null, 2), 'utf-8');
}

export function getDocMapEntry(docMap: DocMap, file: string): DocMapEntry | undefined {
  return docMap.entries.find((e) => e.file === file);
}

/**
 * Write `summary` and `read_when` back into a doc file's frontmatter,
 * but only for fields that are not already present.
 *
 * Inserts the fields after the `title:` line if present, otherwise after
 * the opening `---` line. No-ops if no frontmatter block is found.
 */
export function writeFrontmatterFields(
  absPath: string,
  fields: { summary?: string; read_when?: string[] },
): void {
  if (!fields.summary && !fields.read_when?.length) return;

  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return; // File not readable — skip
  }

  // Find the frontmatter block
  const fmMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) return; // No frontmatter — skip

  const fmBody = fmMatch[2];
  const lines = fmBody.split('\n');

  // Determine which fields already exist in the frontmatter
  const hasSummary = /^summary:/m.test(fmBody);
  const hasReadWhen = /^read_when:/m.test(fmBody);

  // Build the lines to insert
  const insertLines: string[] = [];
  if (!hasSummary && fields.summary) {
    insertLines.push(`summary: "${fields.summary}"`);
  }
  if (!hasReadWhen && fields.read_when?.length) {
    insertLines.push('read_when:');
    for (const item of fields.read_when) {
      insertLines.push(`  - ${item}`);
    }
  }

  if (insertLines.length === 0) return; // Nothing to add

  // Find insertion point: after `title:` line if present, else after first line
  let insertIdx = 1; // Default: after first line
  for (let i = 0; i < lines.length; i++) {
    if (/^title:/.test(lines[i])) {
      insertIdx = i + 1;
      break;
    }
  }

  const newLines = [
    ...lines.slice(0, insertIdx),
    ...insertLines,
    ...lines.slice(insertIdx),
  ];

  const newFmBody = newLines.join('\n');
  const newContent = content.replace(fmMatch[0], `${fmMatch[1]}${newFmBody}${fmMatch[3]}`);

  fs.writeFileSync(absPath, newContent, 'utf-8');
}

// === Prompt input builder ===

/**
 * Extract frontmatter from a markdown file.
 * Handles both simple `key: value` pairs and YAML list values (`key:\n  - item`).
 * Returns {} if no frontmatter block is present.
 */
function extractFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string | string[]> = {};
  const lines = match[1].split('\n');
  let currentListKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of lines) {
    // Accumulate list items under the current list key
    if (currentListKey !== null && /^\s+- /.test(line)) {
      currentList!.push(line.replace(/^\s+- /, '').trim());
      continue;
    }

    // Flush accumulated list before processing next key
    if (currentListKey !== null && currentList !== null) {
      result[currentListKey] = currentList;
      currentListKey = null;
      currentList = null;
    }

    // Key with no inline value → start of a list
    const listKeyMatch = line.match(/^(\w[\w-]*):\s*$/);
    if (listKeyMatch) {
      currentListKey = listKeyMatch[1];
      currentList = [];
      continue;
    }

    // Simple key: "value" or key: value
    const kv = line.match(/^(\w[\w-]*):\s*"?([^"]*)"?\s*$/);
    if (kv) {
      result[kv[1]] = kv[2].trim();
    }
  }

  // Flush trailing list
  if (currentListKey !== null && currentList !== null) {
    result[currentListKey] = currentList;
  }

  return result;
}

/**
 * Extract H1–H3 headings from a markdown file.
 */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) headings.push(`${'  '.repeat(m[1].length - 1)}- ${m[2].trim()}`);
  }
  return headings;
}

export interface DocFileSnippet {
  file: string;
  /** Frontmatter values: strings for scalar fields, string[] for list fields. */
  frontmatter: Record<string, string | string[]>;
  headings: string[];
}

/**
 * Build structured snippets for each doc file — frontmatter + headings only.
 * This is compact enough to send all files in a single Claude call.
 */
export function buildDocFileSnippets(repoRoot: string, docFiles: string[]): DocFileSnippet[] {
  const snippets: DocFileSnippet[] = [];
  for (const file of docFiles) {
    const absPath = path.join(repoRoot, file);
    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      // Skip unreadable files
    }
    snippets.push({
      file,
      frontmatter: extractFrontmatter(content),
      headings: extractHeadings(content),
    });
  }
  return snippets;
}

/**
 * Render doc file snippets as a human-readable string for the prompt.
 */
export function renderDocFileSnippets(snippets: DocFileSnippet[]): string {
  return snippets
    .map((s) => {
      // Render frontmatter: scalar fields as `key: value`, list fields as indented items.
      // Skip `related` — it adds noise without helping classification.
      const fm = Object.entries(s.frontmatter)
        .filter(([k]) => k !== 'related')
        .map(([k, v]) => {
          if (Array.isArray(v)) {
            const items = v.map((item) => `    - ${item}`).join('\n');
            return `  ${k}:\n${items}`;
          }
          return `  ${k}: ${v}`;
        })
        .join('\n');
      const headings = s.headings.join('\n');
      const parts: string[] = [`## ${s.file}`];
      if (fm) parts.push(fm);
      if (headings) parts.push(headings);
      return parts.join('\n');
    })
    .join('\n\n');
}
