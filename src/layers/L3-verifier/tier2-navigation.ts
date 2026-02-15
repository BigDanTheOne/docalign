import { randomUUID } from 'crypto';
import type { VerificationResult } from '../../shared/types';
import type { CodebaseIndexService } from '../L0-codebase-index';

const NAV_CONFIG_FILES = [
  'docs/_sidebar.md',
  'mkdocs.yml',
  '_data/nav.yml',
  'mint.json',
  'docs.json',
  '.vitepress/config.ts',
  '.vitepress/config.js',
  '.vitepress/config.mts',
  'docusaurus.config.js',
  'docusaurus.config.ts',
];

/**
 * Verify navigation/sidebar config files.
 * Detects known nav config files and validates that all referenced paths exist.
 */
export async function verifyNavigationConfig(
  repoId: string,
  index: CodebaseIndexService,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const navFile of NAV_CONFIG_FILES) {
    const content = await index.readFileContent(repoId, navFile);
    if (!content) continue;

    const paths = extractPathsFromNavConfig(navFile, content);

    for (const refPath of paths) {
      const exists = await index.fileExists(repoId, refPath);
      if (!exists) {
        results.push({
          id: randomUUID(),
          claim_id: `nav:${navFile}:${refPath}`,
          repo_id: repoId,
          scan_run_id: null,
          verdict: 'drifted',
          confidence: 0.9,
          tier: 2,
          severity: 'high',
          reasoning: `Navigation config '${navFile}' references '${refPath}' which does not exist.`,
          specific_mismatch: `Referenced path '${refPath}' not found.`,
          suggested_fix: null,
          evidence_files: [navFile],
          token_cost: null,
          duration_ms: null,
          post_check_result: null,
          verification_path: null,
          created_at: new Date(),
        });
      }
    }
  }

  return results;
}

function extractPathsFromNavConfig(filename: string, content: string): string[] {
  const paths: string[] = [];

  if (filename.endsWith('.md')) {
    // Markdown sidebar: extract [text](path) links
    const linkPattern = /\[.*?\]\(([^)#]+)\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      const href = match[1].trim();
      if (href && !href.startsWith('http') && !href.startsWith('//')) {
        paths.push(href);
      }
    }
  } else if (filename.endsWith('.yml') || filename.endsWith('.yaml')) {
    // YAML nav configs: extract path-like values
    const pathPattern = /:\s*['"]?([a-zA-Z0-9_\-./]+\.(?:md|mdx|rst|html|txt))['"]?\s*$/gm;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      paths.push(match[1]);
    }
  } else if (filename.endsWith('.json')) {
    // JSON configs: extract string values that look like doc paths
    try {
      const extractFromObj = (obj: unknown): void => {
        if (typeof obj === 'string') {
          if (/\.(md|mdx|rst|html|txt)$/.test(obj) && !obj.startsWith('http')) {
            paths.push(obj);
          }
        } else if (Array.isArray(obj)) {
          for (const item of obj) extractFromObj(item);
        } else if (obj && typeof obj === 'object') {
          for (const val of Object.values(obj)) extractFromObj(val);
        }
      };
      extractFromObj(JSON.parse(content));
    } catch {
      // Skip unparseable JSON
    }
  } else if (filename.endsWith('.ts') || filename.endsWith('.js') || filename.endsWith('.mts')) {
    // JS/TS configs: extract string literals that look like doc paths
    const stringPattern = /['"]([a-zA-Z0-9_\-./]+\.(?:md|mdx|rst|html|txt))['"]/g;
    let match;
    while ((match = stringPattern.exec(content)) !== null) {
      paths.push(match[1]);
    }
  }

  return [...new Set(paths)];
}
